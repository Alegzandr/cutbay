import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { MediaAsset } from '../types';

/**
 * On-demand audio conversion for tracks WebCodecs cannot decode (E-AC-3, AC-3,
 * DTS - the usual MKV/Blu-ray rip payload). Nothing here runs unless the user
 * explicitly asks for a track: ffmpeg.wasm is a 32 MB download, so it is
 * dynamically imported on first use and never touches a normal import.
 *
 * The output is plain PCM in a WAV container, which the browser decodes
 * natively. Going through a lossy codec would save memory but degrade sound the
 * user is trying to recover, and the decoded AudioBuffer costs the same either
 * way (see the full-buffer limitation in mediaCache).
 */

/** Where the core is served from, copied out of node_modules at build time. */
const CORE_BASE = `${import.meta.env.BASE_URL}ffmpeg`;

/** Mount point of the source file inside ffmpeg's virtual filesystem. */
const MOUNT_DIR = '/mount';

/**
 * The three stages a conversion goes through, in order. They are reported
 * separately because they fail differently and, above all, take wildly different
 * amounts of time: without the distinction a user watching 0 % for a minute of
 * downloading cannot tell a slow job from a hung one.
 */
export type TranscodePhase = 'downloading' | 'converting' | 'decoding';

export interface TranscodeProgress {
  phase: TranscodePhase;
  /** 0..1 inside the phase, or null when the phase reports no measurable progress. */
  ratio: number | null;
}

/** The loaded instance plus the enum it needs, both from the same lazy chunk. */
interface LoadedFFmpeg {
  ffmpeg: FFmpeg;
  workerFs: string;
}

let ffmpegPromise: Promise<LoadedFFmpeg> | null = null;

/**
 * Subscribers to the one-time core download. Kept module side so a second job
 * started while the first is still fetching sees the same bytes land, instead of
 * sitting at 0 % waiting on a download it cannot observe.
 */
const downloadListeners = new Set<(ratio: number | null) => void>();

/**
 * Load ffmpeg.wasm once per session. Single-threaded on purpose: the
 * multi-threaded core needs COOP/COEP headers, which GitHub Pages cannot send
 * (the CSP already ships as a meta tag for the same reason).
 */
function loadFFmpeg(): Promise<LoadedFFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg, FFFSType }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ]);

      // Fetched by hand rather than handed to load() as plain URLs, purely to
      // get byte progress out of the 32 MB download. Both end up as blob: URLs,
      // which the CSP allows in script-src for exactly this.
      const bytes = new Map<string, { received: number; total: number }>();
      const track = (e: { url: string | URL; received: number; total: number }) => {
        bytes.set(String(e.url), { received: e.received, total: e.total });
        let received = 0;
        let total = 0;
        for (const b of bytes.values()) {
          received += b.received;
          total += b.total;
        }
        // A response without Content-Length reports -1: no bar beats a lying one.
        const ratio = total > 0 ? Math.min(1, received / total) : null;
        for (const listener of downloadListeners) listener(ratio);
      };
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript', true, track),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm', true, track),
      ]);

      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL, wasmURL });
      return { ffmpeg, workerFs: FFFSType.WORKERFS };
    })().catch((err) => {
      // A failed load must not poison the session: let the next attempt retry.
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

/**
 * Drop the cached instance. Terminating kills the worker, so the handle is dead
 * and the next conversion has to load a fresh one (the wasm itself stays in the
 * HTTP cache, so this costs no second download).
 */
function discardFFmpeg(): void {
  ffmpegPromise = null;
}

export class TranscodeCanceled extends Error {
  constructor() {
    super('canceled');
    this.name = 'TranscodeCanceled';
  }
}

export interface TranscodeOptions {
  onProgress?: (progress: TranscodeProgress) => void;
  signal?: AbortSignal;
}

/**
 * Decode one undecodable audio track into an AudioBuffer.
 *
 * `audioTrackIndex` is the track's position among the file's audio tracks,
 * which is exactly what ffmpeg's `0:a:<n>` stream specifier selects, so the
 * index needs no translation.
 *
 * Throws TranscodeCanceled if `signal` aborts, and a plain Error (already
 * translated by the caller) on any ffmpeg failure.
 */
export async function transcodeAudioTrack(
  asset: MediaAsset,
  audioTrackIndex: number,
  { onProgress, signal }: TranscodeOptions = {},
): Promise<AudioBuffer> {
  const report = (phase: TranscodePhase, ratio: number | null): void => {
    onProgress?.({
      phase,
      ratio: ratio == null || !isFinite(ratio) ? null : Math.min(1, Math.max(0, ratio)),
    });
  };

  if (signal?.aborted) throw new TranscodeCanceled();
  report('downloading', 0);
  const onDownload = (ratio: number | null) => report('downloading', ratio);
  downloadListeners.add(onDownload);
  let loaded: LoadedFFmpeg;
  try {
    loaded = await loadFFmpeg();
  } finally {
    downloadListeners.delete(onDownload);
  }
  const { ffmpeg, workerFs } = loaded;
  if (signal?.aborted) throw new TranscodeCanceled();

  const outName = `out-${audioTrackIndex}.wav`;
  report('converting', 0);
  const onFFmpegProgress = ({ progress }: { progress: number }) => report('converting', progress);
  ffmpeg.on('progress', onFFmpegProgress);

  // Terminating is the only way to interrupt a running exec; it destroys the
  // worker, so the cached handle has to go with it.
  const abort = () => {
    discardFFmpeg();
    ffmpeg.terminate();
  };
  signal?.addEventListener('abort', abort, { once: true });

  let mounted = false;
  try {
    // WORKERFS reads the File lazily through the worker instead of copying it
    // into ffmpeg's heap: a multi-GB MKV would never fit in memory otherwise.
    await ffmpeg.createDir(MOUNT_DIR).catch(() => undefined);
    await ffmpeg.mount(workerFs as never, { files: [asset.file] }, MOUNT_DIR);
    mounted = true;

    const code = await ffmpeg.exec([
      '-i',
      `${MOUNT_DIR}/${asset.file.name}`,
      // Picture and subtitles are already handled natively: only lift the sound.
      '-map',
      `0:a:${audioTrackIndex}`,
      '-vn',
      '-sn',
      '-dn',
      // Downmix to stereo: the mix bus is stereo, and a 5.1 source would
      // otherwise waste three channels' worth of memory to be folded anyway.
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      outName,
    ]);
    if (signal?.aborted) throw new TranscodeCanceled();
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

    // decodeAudioData reports nothing and is not interruptible: announce the
    // phase without a ratio rather than freeze the bar at 100 %.
    report('decoding', null);
    const data = await ffmpeg.readFile(outName);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    // Copy into a standalone ArrayBuffer: decodeAudioData detaches what it is
    // given, and ffmpeg's view points into the wasm heap.
    const wav = bytes.slice().buffer as ArrayBuffer;
    // Free the wasm-side copy before decoding, so the WAV and the AudioBuffer
    // are never all three in memory at once on a long source.
    await ffmpeg.deleteFile(outName).catch(() => undefined);

    const ctx = new OfflineAudioContext(1, 1, 48000);
    return await ctx.decodeAudioData(wav);
  } finally {
    ffmpeg.off('progress', onFFmpegProgress);
    signal?.removeEventListener('abort', abort);
    if (mounted) await ffmpeg.unmount(MOUNT_DIR).catch(() => undefined);
  }
}
