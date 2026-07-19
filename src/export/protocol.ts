import { Project } from '../types';
import { ExportPreset } from './presets';

/** Messages between the main thread and the export worker. */

export interface ExportRequest {
  type: 'export';
  project: Project;
  /** assetId → File, for every asset referenced by the project. */
  files: Record<string, File>;
  /**
   * assetId → rasterized bitmap, for every still-image asset on the timeline.
   * Rasterized on the main thread (SVG needs the DOM) and transferred.
   */
  stills: Record<string, ImageBitmap>;
  preset: ExportPreset;
  /** First timeline ms to render (loop region in point, 0 for the whole project). */
  startMs: number;
  /** Length of the rendered span, from startMs. */
  durationMs: number;
  /** Pre-rendered audio mix (OfflineAudioContext runs on the main thread only). */
  audio: { channels: Float32Array[]; sampleRate: number } | null;
  /**
   * Destination picked by the user, when the browser supports the File System
   * Access API. The worker then muxes straight into the file instead of holding
   * the whole output in memory: a 5 min 4K render is ~2 GB, which the buffered
   * path had to allocate contiguously and then copy again into a Blob.
   * Null on browsers without the API - the buffered path stays the fallback.
   */
  fileHandle: FileSystemFileHandle | null;
}

/**
 * Business failures the worker can report. The worker runs in its own bundle
 * and knows nothing about the user locale, so it never sends a human message:
 * it sends a code, and the main thread turns it into a translated string.
 */
export type ExportErrorCode = 'noAudibleAudio' | 'videoEncoderUnsupported';

export type WorkerReply =
  | { type: 'progress'; value: number }
  /** `buffer` is null when the output went straight to the user's file. */
  | { type: 'done'; buffer: ArrayBuffer | null; mime: string }
  | { type: 'error'; code: ExportErrorCode }
  /** Anything the worker did not expect: not translatable, kept for diagnosis. */
  | { type: 'crash'; detail: string };
