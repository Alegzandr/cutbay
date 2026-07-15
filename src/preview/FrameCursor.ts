import type { VideoSample, VideoSampleSink } from 'mediabunny';
import { MediaAsset } from '../types';
import { createVideoSink } from '../media/mediaCache';

/**
 * Non-blocking video frame cursor for one clip. Requests are coalesced:
 * if a decode is in flight, only the latest requested time is kept
 * (frames are dropped rather than queued - important on mobile).
 *
 * Two access modes:
 * - sequential (playback): frames come from a `samples()` async iterator,
 *   which decodes each packet once and pre-decodes ahead. Using `getSample`
 *   here would re-decode from the previous keyframe for every single frame.
 * - random (paused scrub / seek): plain `getSample`.
 */
export class FrameCursor {
  private sinkPromise: Promise<VideoSampleSink | null>;
  private current: VideoSample | null = null;
  private busy = false;
  private pending: { sourceSec: number; sequential: boolean } | null = null;
  private disposed = false;

  private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private iteratorDone = false;
  private lookahead: VideoSample | null = null;
  private lastSec = 0;

  constructor(
    asset: MediaAsset,
    /** Called whenever a new decoded frame becomes available (to trigger a redraw). */
    private onFrame?: () => void,
  ) {
    this.sinkPromise = createVideoSink(asset);
  }

  request(sourceSec: number, sequential: boolean): void {
    // Paused on the same time with a frame already decoded: nothing to do.
    // Without this guard a paused preview re-decodes the same frame forever.
    if (!sequential && !this.busy && this.current && sourceSec === this.lastSec) return;
    if (this.busy) {
      this.pending = { sourceSec, sequential };
      return;
    }
    this.busy = true;
    void this.fetch(Math.max(0, sourceSec), sequential);
  }

  private async fetch(sourceSec: number, sequential: boolean): Promise<void> {
    try {
      const sink = await this.sinkPromise;
      if (sink && !this.disposed) {
        if (sequential) await this.fetchSequential(sink, sourceSec);
        else await this.fetchSeek(sink, sourceSec);
      }
    } catch {
      // Decode errors surface as a stale frame; playback keeps going.
    } finally {
      this.busy = false;
      if (this.disposed) {
        this.releaseAll();
      } else if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.request(next.sourceSec, next.sequential);
      }
    }
  }

  private async fetchSeek(sink: VideoSampleSink, sourceSec: number): Promise<void> {
    await this.stopIterator();
    const sample = await sink.getSample(sourceSec);
    if (sample) {
      this.current?.close();
      this.current = sample;
      this.onFrame?.();
    }
    this.lastSec = sourceSec;
  }

  private async fetchSequential(sink: VideoSampleSink, sourceSec: number): Promise<void> {
    // A backward jump or a large forward jump is a seek: restart the iterator.
    if (this.iterator && (sourceSec < this.lastSec || sourceSec > this.lastSec + 1)) {
      await this.stopIterator();
    }
    if (!this.iterator) {
      this.iterator = sink.samples(sourceSec);
      this.iteratorDone = false;
    }
    // Advance until the next frame starts after sourceSec; the last one reached is shown.
    while (!this.iteratorDone) {
      if (!this.lookahead) {
        const { value, done } = await this.iterator.next();
        if (done || !value) {
          this.iteratorDone = true;
          break;
        }
        // Take exclusive ownership: mediabunny's iterator can close a yielded
        // sample again from closeSamples() when iteration starts past the last
        // frame (lastSample is queued without being nulled). Cloning is cheap
        // (VideoFrame refcount) and makes that stray close() a no-op.
        this.lookahead = value.clone();
        value.close();
      }
      if (this.current && this.lookahead.timestamp > sourceSec) break;
      this.current?.close();
      this.current = this.lookahead;
      this.lookahead = null;
      this.onFrame?.();
    }
    this.lastSec = sourceSec;
  }

  private async stopIterator(): Promise<void> {
    this.lookahead?.close();
    this.lookahead = null;
    const it = this.iterator;
    this.iterator = null;
    this.iteratorDone = false;
    if (it) {
      try {
        await it.return(undefined);
      } catch {
        // Iterator cleanup failures are non-fatal.
      }
    }
  }

  private releaseAll(): void {
    void this.stopIterator();
    this.current?.close();
    this.current = null;
  }

  get sample(): VideoSample | null {
    return this.current;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    // If a fetch is in flight, it releases everything on completion.
    if (!this.busy) this.releaseAll();
  }
}
