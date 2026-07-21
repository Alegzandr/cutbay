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
 * trying than to probe for, and the cost is one failed exec on an already-loaded
 * runtime.
 */
const FORMATS = ['ass', 'srt'] as const;

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
  let lastError: unknown;
  for (const format of FORMATS) {
    const output = `sub-${subtitleTrackIndex}.${format}`;
    try {
      const bytes = await runFFmpegJob({
        file: asset.file,
        args: [
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
        ],
        output,
        onProgress,
        signal,
      });
      const cues = parseSubtitles(new TextDecoder().decode(bytes));
      // An empty result is not worth retrying in another format: the track
      // decoded fine and simply had nothing in it.
      return cues;
    } catch (err) {
      // A cancel is the user's decision, not a format problem: stop here.
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('subtitle extraction failed');
}
