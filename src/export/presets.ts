import { AspectRatio, MediaAsset, Project } from '../types';
import { APP_NAME, PROJECT_FPS } from '../app/config';
import type { ParseKeys } from 'i18next';

interface BaseExportPreset {
  id: string;
  /**
   * Translation keys, not strings: the module is evaluated once at import time,
   * while the locale can still change afterwards. The UI resolves them at render
   * (`description` interpolates `{{fps}}`).
   */
  labelKey: ParseKeys;
  descriptionKey: ParseKeys;
  /** Optional quality shown next to the format name in the export sheet. */
  qualityKey?: ParseKeys;
  audioBitrate: number;
}

/** A video export: carries the frame geometry and bitrate the worker needs. */
export interface Mp4Preset extends BaseExportPreset {
  kind: 'mp4';
  /** MP4 presets are tied to a project aspect ratio. */
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
}

/** An audio-only export: fits any aspect ratio, no video geometry. */
export interface Mp3Preset extends BaseExportPreset {
  kind: 'mp3';
}

/**
 * Discriminated on `kind`: the video fields (width/height/fps/videoBitrate) only
 * exist on MP4 presets, so the worker never needs a non-null assertion and MP3
 * presets can't carry a meaningless fps.
 */
export type ExportPreset = Mp4Preset | Mp3Preset;

export const PRESETS: ExportPreset[] = [
  // Each preset's videoBitrate is the HIGH-frame-rate (48-60 fps) figure; a
  // standard-rate export scales it down (see videoBitrateForFps). The references
  // are YouTube's published SDR recommendations: 720p 7.5, 1080p 12, 1440p 24,
  // 4K 53-68 Mbps. Vertical/square presets mirror the equivalent pixel counts;
  // the platforms cap display at 1080p and re-encode, so a generous source only
  // improves their output.
  ...videoPresets('youtube', 'export.preset.youtube.label', '16:9', [
    ['720', 1280, 720, 7_500_000],
    ['1080', 1920, 1080, 12_000_000],
    ['1440', 2560, 1440, 24_000_000],
    ['4k', 3840, 2160, 60_000_000],
  ]),
  ...videoPresets('tiktok', 'export.preset.tiktok.label', '9:16', [
    ['720', 720, 1280, 7_500_000],
    ['1080', 1080, 1920, 12_000_000],
    ['1440', 1440, 2560, 24_000_000],
    ['4k', 2160, 3840, 60_000_000],
  ]),
  ...videoPresets('square', 'export.preset.square.label', '1:1', [
    ['720', 720, 720, 5_000_000],
    ['1080', 1080, 1080, 8_000_000],
    ['1440', 1440, 1440, 16_000_000],
    ['4k', 2160, 2160, 35_000_000],
  ]),
  ...videoPresets('portrait45', 'export.preset.portrait45.label', '4:5', [
    ['720', 576, 720, 5_000_000],
    ['1080', 1080, 1350, 9_000_000],
    ['1440', 1152, 1440, 16_000_000],
    ['4k', 2160, 2700, 40_000_000],
  ]),
  ...audioPresets('mp3', [
    ['128', 128_000],
    ['192', 192_000],
    ['320', 320_000],
  ]),
];

type VideoQuality = readonly [id: '720' | '1080' | '1440' | '4k', width: number, height: number, bitrate: number];
type AudioQuality = readonly [id: '128' | '192' | '320', bitrate: number];

function videoPresets(
  id: string,
  labelKey: ParseKeys,
  aspect: AspectRatio,
  qualities: readonly VideoQuality[],
): Mp4Preset[] {
  return qualities.map(([quality, width, height, videoBitrate]) => ({
    id: `${id}-${quality}`,
    labelKey,
    descriptionKey: 'export.preset.video.description',
    qualityKey: `export.quality.${quality}` as ParseKeys,
    kind: 'mp4',
    aspect,
    width,
    height,
    fps: PROJECT_FPS,
    videoBitrate,
    // 384 kbps AAC-LC stereo @ 48 kHz — YouTube's recommended audio spec, high
    // enough that the platforms' re-encode stays clean.
    audioBitrate: 384_000,
  }));
}


function audioPresets(id: string, qualities: readonly AudioQuality[]): Mp3Preset[] {
  return qualities.map(([quality, audioBitrate]) => ({
    id: `${id}-${quality}`,
    labelKey: 'export.preset.mp3.label',
    descriptionKey: 'export.preset.audio.description',
    qualityKey: `export.quality.mp3_${quality}` as ParseKeys,
    kind: 'mp3',
    audioBitrate,
  }));
}

export function presetsForAspect(aspect: AspectRatio): ExportPreset[] {
  return PRESETS.filter((p) => p.kind === 'mp3' || p.aspect === aspect);
}

/**
 * Frame rates an export is snapped to. Capped at the project rate (60): we never
 * synthesize frames the timeline doesn't have. NTSC rates (23.976, 29.97, 59.94)
 * land on their integer neighbour.
 */
const EXPORT_FPS_LADDER = [24, 25, 30, 50, 60] as const;

/** YouTube's split: at/above 48 fps an upload wants the full "high frame rate" bitrate. */
const HIGH_FPS_THRESHOLD = 48;

/** Snap a measured source frame rate to the nearest rate we export at. */
export function normalizeExportFps(sourceFps: number): number {
  if (!isFinite(sourceFps) || sourceFps <= 0) return PROJECT_FPS;
  return EXPORT_FPS_LADDER.reduce((best, rate) =>
    Math.abs(rate - sourceFps) < Math.abs(best - sourceFps) ? rate : best,
  );
}

/**
 * The frame rate to export a project at: the fastest source among its video
 * clips (so 60 fps footage stays smooth while an all-30 fps project exports at
 * 30, not an up-sampled 60), snapped to the ladder. Falls back to the project
 * rate when no source frame rate is known (generated-only project, or assets
 * imported before frame-rate probing).
 */
export function projectExportFps(project: Project, assets: Record<string, MediaAsset>): number {
  let fastest = 0;
  for (const track of project.tracks) {
    if (track.kind !== 'video') continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'media') continue;
      const fps = assets[clip.assetId]?.fps;
      if (fps && fps > fastest) fastest = fps;
    }
  }
  return fastest > 0 ? normalizeExportFps(fastest) : PROJECT_FPS;
}

/**
 * Video bitrate for a given export frame rate. Presets carry YouTube's
 * high-frame-rate figure; a standard-rate upload (24-30 fps) wants ~2/3 of it,
 * matching YouTube's own SFR/HFR split (e.g. 1080p 8 vs 12 Mbps) across every
 * resolution.
 */
export function videoBitrateForFps(preset: Mp4Preset, fps: number): number {
  return fps >= HIGH_FPS_THRESHOLD ? preset.videoBitrate : Math.round((preset.videoBitrate * 2) / 3);
}

/**
 * Resolve a video preset against a project: overrides the reference frame rate
 * and bitrate with the values actually used for this project's source footage.
 * The export worker and the export sheet both go through here, so the sheet
 * always previews exactly what will be encoded.
 */
export function resolveMp4Preset(
  preset: Mp4Preset,
  project: Project,
  assets: Record<string, MediaAsset>,
): Mp4Preset {
  const fps = projectExportFps(project, assets);
  return { ...preset, fps, videoBitrate: videoBitrateForFps(preset, fps) };
}

export function exportFileName(preset: ExportPreset): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const ext = preset.kind === 'mp3' ? 'mp3' : 'mp4';
  return `${APP_NAME.toLowerCase()}-${preset.id}-${stamp}.${ext}`;
}
