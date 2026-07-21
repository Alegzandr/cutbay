import { MediaAsset } from '../types';
import {
  FFmpegCanceled,
  FFmpegLoadFailed,
  runFFmpegJob,
  toOwnedBuffer,
  type FFmpegProgress,
} from './ffmpeg';

/**
 * On-demand audio conversion for tracks WebCodecs cannot decode (E-AC-3, AC-3,
 * DTS - the usual MKV/Blu-ray rip payload). The heavy lifting (loading the core,
 * mounting the file, cancellation) belongs to the shared ffmpeg runtime; what is
 * here is only the audio-specific part.
 *
 * The session output is plain PCM in a WAV container, which the browser decodes
 * natively. Going through a lossy codec would save memory but degrade sound the
 * user is trying to recover, and the decoded AudioBuffer costs the same either
 * way (see the full-buffer limitation in mediaCache).
 *
 * A second, compressed output rides on the same exec for the on-disk cache
 * alone - see TranscodeResult for why that one is allowed to be lossy.
 */

export interface TranscodeOptions {
  onProgress?: (progress: FFmpegProgress) => void;
  signal?: AbortSignal;
}

export interface TranscodeResult {
  /** The track, decoded and ready for the mix bus. */
  buffer: AudioBuffer;
  /**
   * The same audio as AAC in MP4, for the on-disk cache, or null when the core
   * could not write it. Lossy on purpose: this copy exists so a reopened project
   * does not re-run a transcode that takes minutes, and PCM at 690 MB per hour
   * is not something to put next to the source file in IndexedDB. The session
   * itself keeps the lossless `buffer` - the compressed copy is only ever
   * decoded after a reload, before any export re-encodes anyway.
   */
  compressed: Uint8Array | null;
}

/**
 * How the cached copy is written.
 *
 * AAC in MP4, and the container is not a detail: a codec with encoder delay
 * needs somewhere to record it, and MP4's edit list is that. The same AAC in a
 * raw ADTS stream decodes back with 1026 samples of silence bolted onto the
 * front - 21 ms of drift against picture, on every reopen, silently. MP4 comes
 * back sample-exact.
 *
 * Opus would have been the obvious pick on size, and is what this first used:
 * libopus is present in the core but traps on the first frame, so it is not an
 * option. Vorbis is smaller still but Safari cannot decode it, and this cache is
 * read by whichever browser opens the project, not the one that wrote it.
 */
const CACHE_ARGS = ['-c:a', 'aac', '-b:a', '128k', '-f', 'mp4'];
const CACHE_EXT = 'm4a';

/**
 * Set once the core has proved it cannot write the cached copy, so later tracks
 * stop paying for the discovery - the same reasoning, and the same evidence
 * rule, as `assUnavailable` in extractSubtitles: only a failure that the
 * plain-WAV retry then survives indicts the encoder rather than the track.
 */
let compressionUnavailable = false;

/** Arguments common to both outputs: one track, downmixed, nothing else. */
function selectTrack(audioTrackIndex: number): string[] {
  return [
    // Picture, subtitles and data streams are handled elsewhere: lift the
    // sound alone.
    '-map',
    `0:a:${audioTrackIndex}`,
    '-vn',
    '-sn',
    '-dn',
    // Downmix to stereo: the mix bus is stereo, and a 5.1 source would
    // otherwise waste three channels' worth of memory to be folded anyway.
    '-ac',
    '2',
  ];
}

/**
 * Decode one undecodable audio track into an AudioBuffer.
 *
 * `audioTrackIndex` is the track's position among the file's audio tracks,
 * which is exactly what ffmpeg's `0:a:<n>` stream specifier selects, so the
 * index needs no translation.
 *
 * Throws FFmpegCanceled if `signal` aborts, and a plain Error (translated by the
 * caller) on any ffmpeg failure.
 */
export async function transcodeAudioTrack(
  asset: MediaAsset,
  audioTrackIndex: number,
  { onProgress, signal }: TranscodeOptions = {},
): Promise<TranscodeResult> {
  const wav = `out-${audioTrackIndex}.wav`;
  const cached = `out-${audioTrackIndex}.${CACHE_EXT}`;
  const select = selectTrack(audioTrackIndex);
  const pcmArgs = ['-c:a', 'pcm_s16le', '-f', 'wav', wav];
  // Both outputs on ONE exec. ffmpeg reads the container end to end whatever it
  // is asked for, so writing the cached copy in a second job would double the
  // cost of the whole operation to save a re-transcode later - which is the
  // opposite of the trade this cache exists to make.
  const cacheArgs = [...CACHE_ARGS, cached];

  let wavBytes: Uint8Array;
  let cacheBytes: Uint8Array | null = null;
  const run = (args: string[], outputs: string[]) =>
    runFFmpegJob({ file: asset.file, args, outputs, onProgress, signal });

  if (compressionUnavailable) {
    [wavBytes!] = (await run([...select, ...pcmArgs], [wav])) as [Uint8Array];
  } else {
    try {
      [wavBytes!, cacheBytes] = (await run(
        [...select, ...pcmArgs, ...select, ...cacheArgs],
        [wav, cached],
      )) as [Uint8Array, Uint8Array];
    } catch (err) {
      if (signal?.aborted) throw err;
      // The core never came up, so the arguments are not what failed: retrying
      // them only spends the load timeout again for the same outcome.
      if (err instanceof FFmpegLoadFailed) throw err;
      // Retry without the cached copy. If THIS works, the encoder is what
      // failed and no later track should try it again; if it fails too, the
      // track is the problem and the encoder keeps its turn. Safe to retry on
      // the same runtime: a trapped instance is discarded at the point it
      // trapped, so this call gets a fresh one.
      [wavBytes!] = (await run([...select, ...pcmArgs], [wav])) as [Uint8Array];
      compressionUnavailable = true;
      console.warn('audio cache encoding unavailable, falling back to PCM only', err);
    }
  }
  if (signal?.aborted) throw new FFmpegCanceled();

  // decodeAudioData reports nothing and is not interruptible: announce the
  // phase without a ratio rather than freeze the bar at 100 %.
  onProgress?.({ phase: 'decoding', ratio: null });
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const buffer = await ctx.decodeAudioData(toOwnedBuffer(wavBytes));
  return { buffer, compressed: cacheBytes };
}

/**
 * Decode a cached copy back into an AudioBuffer, or null if it will not decode.
 *
 * A cache entry written by one browser can be read by another (the project
 * lives on disk, the browser opening it does not have to be the one that wrote
 * it), and AAC leans on system codecs that not every install has. A refusal is
 * not an
 * error worth surfacing: it means the track simply has to be transcoded again,
 * which is exactly what happened before this cache existed.
 */
export async function decodeCachedAudio(bytes: Uint8Array): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    return await ctx.decodeAudioData(toOwnedBuffer(bytes));
  } catch {
    return null;
  }
}
