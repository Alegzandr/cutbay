/**
 * Geometry and bounds math for the keyframe box-selection: which diamonds a
 * marquee encloses, and how far the whole set may be dragged as one.
 *
 * A keyframe has no id — it is named by `(clipId, prop, t)` — so the selection
 * is a list of those triples and every lookup here goes through `keyframeKey`.
 * Times are compared with the same 1ms tolerance the store's keyframe actions
 * use, so a key found by the box is the key those actions will edit.
 */
import type { Clip, KeyframeRef, Project, Track } from '../types';
import { clipDurationMs } from '../model';
import {
  EXPANDED_TRACK_PROPS,
  KEYFRAME_LANE_HEIGHT_PX,
  KEYFRAME_LANES_GAP_PX,
  expandedLanesHeightPx,
} from './trackHeight';

/** Two keyframe times within this many ms are the same key (matches the store). */
const SAME_KEY_EPSILON_MS = 1;

/** Stable string identity of a keyframe, for `Set`/`Map` membership. */
export function keyframeKey(ref: KeyframeRef): string {
  return `${ref.clipId}:${ref.prop}:${Math.round(ref.t)}`;
}

/** Lookup set for "is this diamond selected", built once per render. */
export function keyframeKeySet(refs: KeyframeRef[]): Set<string> {
  return new Set(refs.map(keyframeKey));
}

/**
 * Y band (relative to the top of the tracks area) occupied by the lane of
 * `prop` on the track whose row spans `[rowTop, rowBottom)`. Mirrors the layout
 * of `TrackKeyframeLanes`: the stack is pinned to the bottom of the row, one
 * lane per entry of `EXPANDED_TRACK_PROPS`, under a small gap.
 */
function laneBand(rowBottom: number, laneIndex: number): [number, number] {
  const stackTop = rowBottom - expandedLanesHeightPx + KEYFRAME_LANES_GAP_PX;
  const top = stackTop + laneIndex * KEYFRAME_LANE_HEIGHT_PX;
  return [top, top + KEYFRAME_LANE_HEIGHT_PX];
}

export interface KeyframeBox {
  /** Vertical span of the marquee, in px from the top of the tracks area. */
  minY: number;
  maxY: number;
  /** Horizontal span of the marquee, in timeline ms. */
  t0: number;
  t1: number;
}

/**
 * Every keyframe the marquee encloses. Only expanded tracks contribute: a
 * collapsed row shows no property lanes, so there is nothing there to box.
 */
export function keyframesInBox(
  tracks: Track[],
  expanded: Set<string>,
  tops: number[],
  box: KeyframeBox,
): KeyframeRef[] {
  const hits: KeyframeRef[] = [];
  for (let row = 0; row < tracks.length; row++) {
    const track = tracks[row]!;
    if (track.locked || !expanded.has(track.id)) continue;
    const rowBottom = tops[row + 1]!;
    for (let lane = 0; lane < EXPANDED_TRACK_PROPS.length; lane++) {
      const [laneTop, laneBottom] = laneBand(rowBottom, lane);
      if (laneBottom <= box.minY || laneTop >= box.maxY) continue;
      const prop = EXPANDED_TRACK_PROPS[lane]!;
      for (const clip of track.clips) {
        for (const k of clip.animation?.[prop] ?? []) {
          const at = clip.timelineStartMs + k.t;
          if (at >= box.t0 && at <= box.t1) hits.push({ clipId: clip.id, prop, t: k.t });
        }
      }
    }
  }
  return hits;
}

/**
 * How far (in ms) the whole selection may be dragged, as `[minDelta, maxDelta]`.
 *
 * Each selected key is bounded by its nearest *unselected* neighbours on its own
 * property and by its clip's extent; a selected neighbour moves by the same
 * delta, so it imposes no constraint. The tightest bound across the set wins,
 * which keeps relative spacing intact — the set slides, it never compresses.
 */
export function selectionDragBounds(project: Project, refs: KeyframeRef[]): [number, number] {
  const selected = keyframeKeySet(refs);
  let minDelta = -Infinity;
  let maxDelta = Infinity;
  const clips = new Map<string, Clip>();
  for (const track of project.tracks) {
    for (const clip of track.clips) clips.set(clip.id, clip);
  }
  for (const ref of refs) {
    const clip = clips.get(ref.clipId);
    if (!clip) continue;
    const keys = clip.animation?.[ref.prop];
    if (!keys?.length) continue;
    const idx = keys.findIndex((k) => Math.abs(k.t - ref.t) < SAME_KEY_EPSILON_MS);
    if (idx < 0) continue;
    let lo = 0;
    let hi = clipDurationMs(clip);
    for (let i = idx - 1; i >= 0; i--) {
      if (selected.has(keyframeKey({ clipId: ref.clipId, prop: ref.prop, t: keys[i]!.t }))) continue;
      lo = keys[i]!.t + SAME_KEY_EPSILON_MS;
      break;
    }
    for (let i = idx + 1; i < keys.length; i++) {
      if (selected.has(keyframeKey({ clipId: ref.clipId, prop: ref.prop, t: keys[i]!.t }))) continue;
      hi = keys[i]!.t - SAME_KEY_EPSILON_MS;
      break;
    }
    minDelta = Math.max(minDelta, lo - ref.t);
    maxDelta = Math.min(maxDelta, hi - ref.t);
  }
  if (minDelta === -Infinity) return [0, 0];
  // A set boxed across clips of very different lengths can end up with no room
  // at all; collapse to a no-op rather than letting maxDelta < minDelta invert.
  return [minDelta, Math.max(minDelta, maxDelta)];
}
