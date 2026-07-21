import { MediaAsset } from '../types';
import { FFmpegCanceled, runFFmpegJob, toOwnedBuffer, type FFmpegProgress } from './ffmpeg';

/**
 * On-demand audio conversion for tracks WebCodecs cannot decode (E-AC-3, AC-3,
 * DTS - the usual MKV/Blu-ray rip payload). The heavy lifting (loading the core,
 * mounting the file, cancellation) belongs to the shared ffmpeg runtime; what is
 * here is only the audio-specific part.
 *
 * The output is plain PCM in a WAV container, which the browser decodes
 * natively. Going through a lossy codec would save memory but degrade sound the
 * user is trying to recover, and the decoded AudioBuffer costs the same either
 * way (see the full-buffer limitation in mediaCache).
 */

export interface TranscodeOptions {
  onProgress?: (progress: FFmpegProgress) => void;
  signal?: AbortSignal;
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
): Promise<AudioBuffer> {
  const output = `out-${audioTrackIndex}.wav`;
  const bytes = await runFFmpegJob({
    file: asset.file,
    args: [
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
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      output,
    ],
    output,
    onProgress,
    signal,
  });
  if (signal?.aborted) throw new FFmpegCanceled();

  // decodeAudioData reports nothing and is not interruptible: announce the
  // phase without a ratio rather than freeze the bar at 100 %.
  onProgress?.({ phase: 'decoding', ratio: null });
  const ctx = new OfflineAudioContext(1, 1, 48000);
  return await ctx.decodeAudioData(toOwnedBuffer(bytes));
}
