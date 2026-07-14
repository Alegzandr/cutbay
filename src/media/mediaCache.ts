import {
  Input,
  ALL_FORMATS,
  BlobSource,
  VideoSampleSink,
  AudioBufferSink,
} from 'mediabunny';
import { MediaAsset } from '../types';

/**
 * Decoding resource cache for the preview side (main thread).
 * Export uses its own Inputs inside the worker — the two pipelines share nothing.
 */

const inputs = new Map<string, Input>();

export function createInput(file: File): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

export function registerInput(assetId: string, input: Input): void {
  inputs.get(assetId)?.dispose();
  inputs.set(assetId, input);
}

/** Release everything cached for an asset (decoder input, audio buffer, peaks). */
export function disposeAssetResources(assetId: string): void {
  inputs.get(assetId)?.dispose();
  inputs.delete(assetId);
  audioPromises.delete(assetId);
  peaksPromises.delete(assetId);
}

export function getInput(asset: MediaAsset): Input {
  let input = inputs.get(asset.id);
  if (!input) {
    input = createInput(asset.file);
    inputs.set(asset.id, input);
  }
  return input;
}

/** Create a dedicated video sink (one per playback cursor, for independent iteration). */
export async function createVideoSink(asset: MediaAsset): Promise<VideoSampleSink | null> {
  const input = getInput(asset);
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) return null;
  return new VideoSampleSink(track);
}

const audioPromises = new Map<string, Promise<AudioBuffer | null>>();

/**
 * Decode the full audio track of an asset into a single AudioBuffer (memoized).
 * Good enough for footage of a few minutes; documented as a v1 limitation.
 */
export function getAudioBuffer(asset: MediaAsset): Promise<AudioBuffer | null> {
  let promise = audioPromises.get(asset.id);
  if (!promise) {
    promise = decodeFullAudio(asset).catch(() => null);
    audioPromises.set(asset.id, promise);
  }
  return promise;
}

async function decodeFullAudio(asset: MediaAsset): Promise<AudioBuffer | null> {
  if (!asset.hasAudio) return null;
  const input = getInput(asset);
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return null;

  const sink = new AudioBufferSink(track);
  const sampleRate = track.sampleRate;
  const numberOfChannels = Math.max(1, track.numberOfChannels);
  const totalFrames = Math.ceil((asset.durationMs / 1000) * sampleRate) + sampleRate;
  const target = new AudioBuffer({ length: totalFrames, numberOfChannels, sampleRate });

  for await (const wrapped of sink.buffers()) {
    const offset = Math.round(wrapped.timestamp * sampleRate);
    if (offset < 0 || offset >= totalFrames) continue;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const srcCh = Math.min(ch, wrapped.buffer.numberOfChannels - 1);
      const data = wrapped.buffer.getChannelData(srcCh);
      const room = totalFrames - offset;
      target.copyToChannel(room < data.length ? data.subarray(0, room) : data, ch, offset);
    }
  }
  return target;
}

/** Kick off background audio decoding right after import. */
export function warmAudio(asset: MediaAsset): void {
  void getAudioBuffer(asset);
}

const peaksPromises = new Map<string, Promise<number[] | null>>();

/** Peak resolution: 50 bins per second, enough for one bin per pixel at high zoom. */
export function expectedPeakBins(durationMs: number): number {
  return Math.round(Math.min(30000, Math.max(200, (durationMs / 1000) * 50)));
}

/** Normalized waveform peaks (0..1) across the asset's duration (memoized). */
export function getPeaks(asset: MediaAsset): Promise<number[] | null> {
  let promise = peaksPromises.get(asset.id);
  if (!promise) {
    promise = streamPeaks(asset).catch(() => null);
    peaksPromises.set(asset.id, promise);
  }
  return promise;
}

/**
 * Compute peaks by streaming decoded chunks — never materializes the full
 * AudioBuffer, so hour-long footage works without a 100s-of-MB allocation.
 */
async function streamPeaks(asset: MediaAsset): Promise<number[] | null> {
  if (!asset.hasAudio) return null;
  const input = getInput(asset);
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return null;

  const sink = new AudioBufferSink(track);
  const durationSec = asset.durationMs / 1000;
  const bins = expectedPeakBins(asset.durationMs);
  const out = new Array<number>(bins).fill(0);

  for await (const wrapped of sink.buffers()) {
    const data = wrapped.buffer.getChannelData(0);
    const sr = wrapped.buffer.sampleRate;
    // Sampling every few frames is plenty for a visual envelope.
    const stride = Math.max(1, Math.floor(((durationSec / bins) * sr) / 32));
    for (let j = 0; j < data.length; j += stride) {
      const bin = Math.floor(((wrapped.timestamp + j / sr) / durationSec) * bins);
      if (bin < 0 || bin >= bins) continue;
      const v = Math.abs(data[j]);
      if (v > out[bin]) out[bin] = v;
    }
  }

  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < bins; i++) out[i] /= max;
  return out;
}
