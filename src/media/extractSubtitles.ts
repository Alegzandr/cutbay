import type { MediaAsset } from '../types';
import { parseSubtitles, type SubtitleCue } from '../lib/subtitles';
import { runFFmpegJob, type FFmpegProgress } from './ffmpeg';

/**
 * Pull one embedded subtitle track out of a container and turn it into cues.
 *
 * The track is transcoded to a text subtitle format and then handed to the very
 * same parser sidecar .srt/.ass files go through, so an embedded track and an
 * imported file produce identical caption clips - placement tags included.
 */

/** Key for the shared progress map, distinct from the audio transcodes'. */
export function subtitleKey(assetId: string, subtitleTrackIndex: number): string {
  return `${assetId}#s${subtitleTrackIndex}`;
}

export interface ExtractOptions {
  onProgress?: (progress: FFmpegProgress) => void;
  signal?: AbortSignal;
}

/**
 * Output formats to try, in order.
 *
 * ASS first because it is the only one of the two that carries placement: a
 * track that puts a sign at the top of the frame keeps it, where SubRip would
 * flatten everything into the lower third. SubRip is the fallback for the case
 * where the core was built without the ASS encoder - cheaper to find out by
 * trying than to probe for.
 */
const FORMATS = ['ass', 'srt'] as const;

/**
 * Set once the core has proved it cannot write ASS, so later tracks stop paying
 * for the discovery.
 *
 * The cost of retrying is not "one failed exec": ffmpeg demuxes the whole source
 * before it can fail, so on a disc rip that is a full read of several GB, per
 * track, every time. Whether the ASS encoder exists is a property of the core,
 * identical for every track of every file in the session - learning it once is
 * enough.
 *
 * Only a failure the FALLBACK then survives counts. An ASS exec can also fail
 * because that particular track is broken, and SubRip failing right after it is
 * exactly what tells the two apart: if neither worked, the track is the
 * suspect and ASS keeps its turn for the next one.
 */
let assUnavailable = false;

/**
 * Extract the cues of one subtitle track.
 *
 * `subtitleTrackIndex` is the track's position among the file's subtitle tracks,
 * which is what ffmpeg's `0:s:<n>` selects - the same convention
 * detectSubtitleTracks() indexes by, so it needs no translation.
 *
 * Throws FFmpegCanceled if `signal` aborts, and a plain Error (translated by the
 * caller) when no format worked or the track held nothing readable.
 */
export async function extractSubtitleTrack(
  asset: MediaAsset,
  subtitleTrackIndex: number,
  { onProgress, signal }: ExtractOptions = {},
): Promise<SubtitleCue[]> {
  const formats = assUnavailable ? FORMATS.filter((f) => f !== 'ass') : FORMATS;
  let lastError: unknown;
  let assFailed = false;
  for (const format of formats) {
    const output = `sub-${subtitleTrackIndex}.${format}`;
    try {
      const [bytes] = await runFFmpegJob({
        file: asset.file,
        args: trackArgs(subtitleTrackIndex, format, output),
        outputs: [output],
        onProgress,
        signal,
      });
      // A fallback that succeeds where ASS failed indicts the encoder, not the
      // track: remember it so no later track pays for the same discovery.
      if (assFailed) assUnavailable = true;
      const cues = parseSubtitles(new TextDecoder().decode(bytes!));
      // An empty result is not worth retrying in another format: the track
      // decoded fine and simply had nothing in it.
      return cues;
    } catch (err) {
      // A cancel is the user's decision, not a format problem: stop here.
      if (signal?.aborted) throw err;
      if (format === 'ass') assFailed = true;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('subtitle extraction failed');
}

/** Arguments writing one subtitle track to `output` in `format`. */
function trackArgs(subtitleTrackIndex: number, format: string, output: string): string[] {
  return [
    '-map',
    `0:s:${subtitleTrackIndex}`,
    '-vn',
    '-an',
    '-dn',
    '-c:s',
    format,
    '-f',
    format,
    output,
  ];
}

/**
 * Extract several subtitle tracks of one file, in a single pass.
 *
 * This is the whole reason the batch path exists: an exec demuxes the container
 * from end to end whatever it is asked for, so pulling six tracks of a disc rip
 * one at a time reads several GB six times over, for a few hundred kB of text.
 * One exec with six outputs reads it once.
 *
 * Returns the cues per track index. A track that could not be extracted is
 * absent from the map rather than empty: "failed" and "had nothing in it" are
 * different things to tell the user about.
 */
export async function extractSubtitleTracks(
  asset: MediaAsset,
  subtitleTrackIndexes: number[],
  { onProgress, signal }: ExtractOptions = {},
): Promise<Map<number, SubtitleCue[]>> {
  const out = new Map<number, SubtitleCue[]>();
  if (subtitleTrackIndexes.length === 0) return out;
  // A single track has nothing to batch, and the per-track path carries the
  // format fallback: use it as it is.
  if (subtitleTrackIndexes.length === 1) {
    const index = subtitleTrackIndexes[0]!;
    out.set(index, await extractSubtitleTrack(asset, index, { onProgress, signal }));
    return out;
  }

  const format = assUnavailable ? 'srt' : 'ass';
  const outputs = subtitleTrackIndexes.map((i) => `sub-${i}.${format}`);
  try {
    const parts = await runFFmpegJob({
      file: asset.file,
      args: subtitleTrackIndexes.flatMap((i, n) => trackArgs(i, format, outputs[n]!)),
      outputs,
      onProgress,
      signal,
    });
    subtitleTrackIndexes.forEach((i, n) => {
      out.set(i, parseSubtitles(new TextDecoder().decode(parts[n]!)));
    });
    return out;
  } catch (err) {
    if (signal?.aborted) throw err;
    // One unreadable track fails the whole exec and takes five good ones with
    // it. Fall back to extracting them separately: slower by exactly the reads
    // the batch was meant to save, but it costs the user one track instead of
    // the lot - and it is also where the per-track format fallback lives.
    console.warn('batched subtitle extraction failed, retrying track by track', err);
  }

  let lastError: unknown;
  for (const index of subtitleTrackIndexes) {
    try {
      out.set(index, await extractSubtitleTrack(asset, index, { onProgress, signal }));
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  // Every track failed: this is not a partial result, it is a failure.
  if (out.size === 0) {
    throw lastError instanceof Error ? lastError : new Error('subtitle extraction failed');
  }
  return out;
}
