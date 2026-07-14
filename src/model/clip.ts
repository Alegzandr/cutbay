import { Clip, ClipTransform, SolidClip, TextClip } from '../types';

/**
 * Clip-level model math: durations, source<->timeline mapping, fade/zoom
 * envelopes and the kind guards. Pure functions, no DOM — the single source of
 * truth shared by preview, export and the timeline UI.
 */

export const DEFAULT_TRANSFORM: ClipTransform = {
  crop: { x: 0, y: 0, w: 1, h: 1 },
  x: 0.5,
  y: 0.5,
  scale: 1,
};

/** A clip that renders generated text instead of a media asset. */
export function isTextClip(clip: Clip): clip is TextClip {
  return clip.kind === 'text';
}

/** A clip with no backing media asset (text or solid). */
export function isGeneratedClip(clip: Clip): clip is TextClip | SolidClip {
  return clip.kind !== 'media';
}

/** Duration of a clip on the timeline, in ms. */
export function clipDurationMs(clip: Clip): number {
  return (clip.sourceOutMs - clip.sourceInMs) / clip.speed;
}

/** End of a clip on the timeline, in ms. */
export function clipEndMs(clip: Clip): number {
  return clip.timelineStartMs + clipDurationMs(clip);
}

/** Source time (ms) corresponding to a timeline time (ms) for a clip. */
export function timelineToSourceMs(clip: Clip, timelineMs: number): number {
  return clip.sourceInMs + (timelineMs - clip.timelineStartMs) * clip.speed;
}

/**
 * Zoom-animation multiplier of a clip at a timeline time: ramps 1 → zoomEnd
 * across the clip. Applied on top of transform.scale everywhere a dest rect
 * is computed, so preview, hit-testing and export stay in lockstep.
 */
export function clipZoomAt(clip: Clip, timelineMs: number): number {
  const zoomEnd = clip.zoomEnd ?? 1;
  if (zoomEnd === 1) return 1;
  const dur = clipDurationMs(clip);
  if (dur <= 0) return 1;
  const progress = Math.min(1, Math.max(0, (timelineMs - clip.timelineStartMs) / dur));
  return 1 + (zoomEnd - 1) * progress;
}

/** Fade gain of a clip at a given timeline time (0..1), used for both opacity and audio. */
export function clipFadeGainAt(clip: Clip, timelineMs: number): number {
  return clipEnvelopeGainAt(clip, timelineMs, 0, 0);
}

/**
 * Fade gain including crossfade windows (overlap with neighboring clips).
 * A crossfade behaves like an implicit fade of the overlap duration; when the
 * clip also has an explicit fade on the same edge, the longer one wins so the
 * envelope stays a single linear ramp.
 */
export function clipEnvelopeGainAt(
  clip: Clip,
  timelineMs: number,
  xfadeInMs: number,
  xfadeOutMs: number,
): number {
  const dur = clipDurationMs(clip);
  const local = timelineMs - clip.timelineStartMs;
  const fadeIn = Math.max(clip.fadeInMs, xfadeInMs);
  const fadeOut = Math.max(clip.fadeOutMs, xfadeOutMs);
  let gain = 1;
  if (fadeIn > 0) gain = Math.min(gain, local / fadeIn);
  if (fadeOut > 0) gain = Math.min(gain, (dur - local) / fadeOut);
  return Math.max(0, Math.min(1, gain));
}
