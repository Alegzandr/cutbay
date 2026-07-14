import { AspectRatio, Clip, Marker, Project } from '../types';
import { clipDurationMs, clipEndMs } from './clip';

/**
 * Timeline/project-level model math: total duration, output geometry, marker
 * ordering and the crossfade windows derived from clip overlap. Pure functions
 * shared by preview, export and the timeline UI.
 */

/** Markers in timeline order - the order that numbers them (1, 2, 3…). */
export function sortedMarkers(project: Project): Marker[] {
  return [...project.markers].sort((a, b) => a.timeMs - b.timeMs);
}

/** Total project duration (end of the last clip), in ms. */
export function projectDurationMs(project: Project): number {
  let max = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clipEndMs(clip));
    }
  }
  return max;
}

export interface CrossfadeWindows {
  /** Overlap with the previous clip on the track (ramp-in duration), ms. */
  inMs: number;
  /** Overlap with the next clip on the track (ramp-out duration), ms. */
  outMs: number;
}

/**
 * Crossfades of a track, derived purely from clip overlap: when two
 * consecutive clips overlap, the incoming clip ramps in and the outgoing
 * clip ramps out over the shared region (Vegas-style transition by sliding).
 */
export function trackCrossfades(clips: Clip[]): Map<string, CrossfadeWindows> {
  const out = new Map<string, CrossfadeWindows>();
  const sorted = [...clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  for (const c of sorted) out.set(c.id, { inMs: 0, outMs: 0 });
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const overlap = clipEndMs(prev) - cur.timelineStartMs;
    if (overlap <= 0) continue;
    const window = Math.min(overlap, clipDurationMs(prev), clipDurationMs(cur));
    out.get(prev.id)!.outMs = Math.max(out.get(prev.id)!.outMs, window);
    out.get(cur.id)!.inMs = Math.max(out.get(cur.id)!.inMs, window);
  }
  return out;
}

/** Output dimensions for an aspect ratio (default export resolution). */
export function outputDimensions(aspect: AspectRatio): { width: number; height: number } {
  switch (aspect) {
    case '16:9':
      return { width: 1920, height: 1080 };
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:5':
      return { width: 1080, height: 1350 };
  }
}
