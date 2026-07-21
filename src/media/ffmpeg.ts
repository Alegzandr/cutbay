import type { FFmpeg } from '@ffmpeg/ffmpeg';

/**
 * Shared ffmpeg.wasm runtime: load it once, run one job at a time, report
 * progress, allow cancellation.
 *
 * Everything the app cannot do with native browser codecs goes through here -
 * today an audio transcode and a subtitle extraction, tomorrow whatever else an
 * exotic import needs. Callers describe a job (a source file, the arguments, the
 * file it writes) and get bytes back; the download, the virtual filesystem and
 * the worker lifecycle are this module's business alone.
 *
 * Nothing in here runs unless a caller explicitly asks for a job: the core is a
 * 32 MB download, so it is dynamically imported on first use and never touches a
 * normal import path.
 *
 * A job that needs several things out of the same file asks for them in ONE
 * exec: ffmpeg walks the container end to end whatever it is told to extract, so
 * the number of execs, not the number of streams, is what a multi-GB source is
 * read for.
 */

/**
 * Where the cores are served from, copied out of node_modules at build time.
 *
 * Two builds ship: the single-threaded one, which runs anywhere, and the
 * multi-threaded one, which needs the page to be crossOriginIsolated (see
 * `src/app/coop.ts`) and is roughly three times faster on the codecs this module
 * exists for. Only one is ever fetched - the choice is made once, at load time.
 */
const CORE_BASE = `${import.meta.env.BASE_URL}ffmpeg`;
const CORE_MT_BASE = `${import.meta.env.BASE_URL}ffmpeg-mt`;

/**
 * How many threads the multi-threaded core is allowed.
 *
 * Deliberately modest. A transcode is a background errand: the user asked for a
 * track to become audible, not for the editor to stop responding until it does.
 * Given every core, ffmpeg takes every core - and preview playback and export,
 * which have their own workers and a frame deadline, are what pay for it. Two
 * cores are held back for them, and the total is capped besides.
 *
 * There is little lost: the audio codecs this path exists for (E-AC-3, DTS)
 * decode largely single-threaded anyway, so most of what threading buys here is
 * in the muxing and I/O around them, which flattens out early.
 */
const MAX_THREADS = 4;
const RESERVED_CORES = 2;

/**
 * Threads to pass to a job, or null when the runtime is single-threaded.
 *
 * Read at call time rather than at module load: the page only becomes isolated
 * after the service worker has taken over, which happens on a later navigation.
 */
export function ffmpegThreads(): number | null {
  if (!globalThis.crossOriginIsolated) return null;
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(MAX_THREADS, cores - RESERVED_CORES));
}

/** Mount point of the source file inside ffmpeg's virtual filesystem. */
const MOUNT_DIR = '/mount';

/**
 * The stages a job goes through, in order. They are reported separately because
 * they fail differently and, above all, take wildly different amounts of time:
 * without the distinction a user watching 0 % for a minute of downloading cannot
 * tell a slow job from a hung one.
 *
 * 'queued' is the wait for the single-job queue below; the runtime only reports
 * the later phases, so it is set by whoever registers the job and is replaced as
 * soon as the job actually starts. Without it a job waiting behind three others
 * looks exactly like one that is downloading.
 *
 * 'decoding' is the caller's own post-processing (decoding PCM, parsing cues),
 * which the runtime cannot measure - it is reported by whoever does that work.
 */
export type FFmpegPhase = 'queued' | 'downloading' | 'converting' | 'decoding';

export interface FFmpegProgress {
  phase: FFmpegPhase;
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
 * The core's files as blob: URLs, cached separately from the instance.
 *
 * Cancelling a job terminates the worker, so the instance has to be rebuilt -
 * but the bytes behind it have not changed. Keeping the blobs here means a
 * cancel-then-retry costs a fresh instance, not another 32 MB round trip
 * through fetch, a second full copy in memory and a re-blob of both files.
 */
let coreURLsPromise: Promise<{
  coreURL: string;
  wasmURL: string;
  workerURL?: string;
}> | null = null;

/**
 * Subscribers to the one-time core download. Kept module side so a second job
 * started while the first is still fetching sees the same bytes land, instead of
 * sitting at 0 % waiting on a download it cannot observe.
 */
const downloadListeners = new Set<(ratio: number | null) => void>();

/**
 * Fetch one file into a blob: URL, reporting bytes as they arrive.
 *
 * @ffmpeg/util ships toBlobURL for exactly this, but its progress path is unsafe:
 * it treats Content-Length as a checksum and throws when it disagrees with the
 * bytes read, which every compressed response guarantees - the header counts
 * bytes on the wire while the reader yields decoded ones. Its fallback then
 * calls arrayBuffer() on the body it has just consumed, which throws in turn, so
 * a single compressing host between us and the core makes load() fail outright.
 * Owning the fetch is less code than working around that.
 *
 * `total` is passed through as a hint, never as a contract: 0 means unknown.
 */
export async function fetchToBlobURL(
  url: string,
  mimeType: string,
  onBytes: (received: number, total: number) => void,
): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  const declared = Number(resp.headers.get('Content-Length'));
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0;

  const reader = resp.body?.getReader();
  // No streaming body to read: the response is still perfectly usable.
  if (!reader) {
    const buf = await resp.arrayBuffer();
    onBytes(buf.byteLength, buf.byteLength);
    return URL.createObjectURL(new Blob([buf], { type: mimeType }));
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(received, total);
  }
  // Blob takes the chunks as they are: concatenating first would cost a second
  // full copy of 32 MB for nothing.
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mimeType }));
}

/**
 * Fetch the core's files into blob: URLs once per session, reporting bytes.
 *
 * Fetched by hand rather than handed to load() as plain URLs, purely to get
 * byte progress out of the 32 MB download. They end up as blob: URLs, which the
 * CSP allows in script-src for exactly this.
 *
 * Which build gets fetched is decided here and never revisited: a page that is
 * not isolated will not become so without a navigation, and one that is will
 * not lose it.
 */
function loadCoreURLs(): Promise<{ coreURL: string; wasmURL: string; workerURL?: string }> {
  if (!coreURLsPromise) {
    coreURLsPromise = (async () => {
      const mt = ffmpegThreads() != null;
      const base = mt ? CORE_MT_BASE : CORE_BASE;
      const jsURL = `${base}/ffmpeg-core.js`;
      const binURL = `${base}/ffmpeg-core.wasm`;
      // The MT core spawns its threads from this file. It is a few kB, so it
      // rides along without its own progress accounting.
      const threadURL = mt ? `${base}/ffmpeg-core.worker.js` : null;

      // Seeded so the ratio only goes measurable once both downloads have
      // declared a size, instead of jumping while the second one is still
      // opening its response.
      const bytes = new Map<string, { received: number; total: number }>([
        [jsURL, { received: 0, total: 0 }],
        [binURL, { received: 0, total: 0 }],
      ]);
      const track = (url: string) => (received: number, total: number) => {
        // Content-Length counts bytes on the wire, so on a compressed response
        // the reader outruns it. Once that happens the header says nothing
        // useful: drop it rather than pin the bar at 100 % for the rest.
        bytes.set(url, { received, total: received > total ? 0 : total });
        let got = 0;
        let expected = 0;
        let measurable = true;
        for (const b of bytes.values()) {
          got += b.received;
          if (b.total > 0) expected += b.total;
          else measurable = false;
        }
        // An unmeasurable download reports null: no bar beats a lying one.
        const ratio = measurable && expected > 0 ? Math.min(1, got / expected) : null;
        for (const listener of downloadListeners) listener(ratio);
      };
      const [coreURL, wasmURL, workerURL] = await Promise.all([
        fetchToBlobURL(jsURL, 'text/javascript', track(jsURL)),
        fetchToBlobURL(binURL, 'application/wasm', track(binURL)),
        threadURL
          ? fetchToBlobURL(threadURL, 'text/javascript', () => undefined)
          : Promise.resolve(undefined),
      ]);
      return { coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) };
    })().catch((err) => {
      // A failed download must not poison the session: let the next attempt retry.
      coreURLsPromise = null;
      throw err;
    });
  }
  return coreURLsPromise;
}

/**
 * Load ffmpeg.wasm once per session, or after a cancel destroyed the last
 * instance. The blobs are cached above, so this second path only pays for
 * instantiating the module, never for fetching it again.
 */
function loadFFmpeg(): Promise<LoadedFFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg, FFFSType } = await import('@ffmpeg/ffmpeg');
      const urls = await loadCoreURLs();
      const ffmpeg = new FFmpeg();
      await ffmpeg.load(urls);
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
 * and the next job has to build a fresh one - but not download anything: the
 * blob: URLs the module was instantiated from survive in `coreURLsPromise`.
 */
function discardFFmpeg(): void {
  ffmpegPromise = null;
}

export class FFmpegCanceled extends Error {
  constructor() {
    super('canceled');
    this.name = 'FFmpegCanceled';
  }
}

/**
 * Jobs run strictly one at a time. There is a single worker with a single
 * virtual filesystem, so two concurrent jobs would fight over the mount point
 * and interleave their progress events - and the user can perfectly well ask for
 * a subtitle track while an audio transcode is still running.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  // Runs on both settle paths: a job that failed must not block the next one.
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Run one exec, throwing away the instance if the wasm trapped.
 *
 * The two ways an exec fails are not the same failure. A non-zero exit code is
 * ffmpeg declining the work and returning cleanly: the instance is fine and the
 * next job can reuse it. An exception out of exec ("memory access out of
 * bounds") is a wasm trap, and a trapped module stays trapped - every later call
 * on it fails the same way, whatever it is asked to do.
 *
 * Without this, one unsupported codec did not fail one job: it silently broke
 * the runtime for the rest of the session, including the fallbacks whose whole
 * purpose is to recover from that first failure.
 */
async function execOrDiscard(ffmpeg: FFmpeg, args: string[]): Promise<number> {
  try {
    return await ffmpeg.exec(args);
  } catch (err) {
    discardFFmpeg();
    ffmpeg.terminate();
    throw err;
  }
}

export interface FFmpegJob {
  /** Source file, mounted lazily rather than copied into the wasm heap. */
  file: File;
  /**
   * Arguments AFTER `-i <input>`. Every name listed in `outputs` must appear
   * here as the output it belongs to.
   */
  args: string[];
  /**
   * Names of the files the job writes, as they appear in `args`, in the order
   * their bytes come back.
   *
   * More than one is the whole point: an exec demuxes the source from end to
   * end whatever it is asked for, so pulling three tracks in three jobs reads a
   * multi-GB container three times. Listing several outputs on one exec makes
   * that a single pass.
   */
  outputs: string[];
  onProgress?: (progress: FFmpegProgress) => void;
  signal?: AbortSignal;
}

/**
 * Run one ffmpeg job over a local file and return the bytes each output holds.
 *
 * Outputs are read and deleted from the virtual filesystem before returning, so
 * a long source never holds the wasm-side copy and the caller's copy at the
 * same time.
 *
 * Throws FFmpegCanceled if `signal` aborts, and a plain Error on any ffmpeg
 * failure (the caller owns the user-facing message).
 */
export function runFFmpegJob({
  file,
  args,
  outputs,
  onProgress,
  signal,
}: FFmpegJob): Promise<Uint8Array[]> {
  return enqueue(async () => {
    const report = (phase: FFmpegPhase, ratio: number | null): void => {
      onProgress?.({
        phase,
        ratio: ratio == null || !isFinite(ratio) ? null : Math.min(1, Math.max(0, ratio)),
      });
    };

    if (signal?.aborted) throw new FFmpegCanceled();
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
    if (signal?.aborted) throw new FFmpegCanceled();

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
      await ffmpeg.mount(workerFs as never, { files: [file] }, MOUNT_DIR);
      mounted = true;

      const threads = ffmpegThreads();
      const code = await execOrDiscard(ffmpeg, [
        // Every log line crosses the worker boundary as its own postMessage,
        // and a long transcode emits thousands of them for nobody to read.
        // Errors are kept: they are what a failed job is diagnosed from.
        // -nostats would go further and is deliberately NOT set - the core
        // drives its progress callback from the stats path, so silencing it
        // would take the progress bar with it.
        '-loglevel',
        'error',
        ...(threads ? ['-threads', String(threads)] : []),
        '-i',
        `${MOUNT_DIR}/${file.name}`,
        ...args,
      ]);
      if (signal?.aborted) throw new FFmpegCanceled();
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

      const result: Uint8Array[] = [];
      for (const output of outputs) {
        const data = await ffmpeg.readFile(output);
        result.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
        // Free the wasm-side copy before the caller starts building anything of
        // its own from these bytes.
        await ffmpeg.deleteFile(output).catch(() => undefined);
      }
      return result;
    } finally {
      ffmpeg.off('progress', onFFmpegProgress);
      signal?.removeEventListener('abort', abort);
      if (mounted) await ffmpeg.unmount(MOUNT_DIR).catch(() => undefined);
    }
  });
}

/**
 * Detach a view produced by a job into an ArrayBuffer its consumer can own.
 *
 * decodeAudioData (and anything else taking ownership) detaches the buffer it is
 * handed, so it must own it whole. Crossing the worker boundary already produced
 * a standalone copy, and on an episode-length track that copy is hundreds of
 * megabytes: only re-copy when the view really is a window onto something larger.
 */
export function toOwnedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}
