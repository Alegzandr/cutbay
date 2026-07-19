import { AspectRatio, Clip, Project, Track } from '../types';
import { clipDurationMs, clipEndMs } from '../model';
import { uid } from '../lib/id';
import { MIN_CLIP_DURATION_MS, PROJECT_FPS } from '../app/config';

/**
 * Pure project operations shared by the store's actions: constructing the empty
 * project, the overlap/crossfade policy, copy-on-write clip edits, and the
 * track/clip lookups. No store access - these take a Project (or an Immer
 * draft) and return/mutate it, which keeps them unit-testable in isolation.
 */

const DEFAULT_ASPECT: AspectRatio = '16:9';

export function createEmptyProject(): Project {
  return { id: uid('proj'), aspectRatio: DEFAULT_ASPECT, fps: PROJECT_FPS, tracks: [], markers: [] };
}

/**
 * Insert a track, keeping video tracks grouped: a new video track goes right
 * after the last existing video track (z-order = array order), audio tracks
 * go at the end. Mutates `p` (called on the withHistory draft).
 */
export function insertTrack(p: Project, track: Track): void {
  if (track.kind === 'video') {
    const lastVideoIdx = p.tracks.map((t) => t.kind).lastIndexOf('video');
    p.tracks.splice(lastVideoIdx + 1, 0, track);
  } else {
    p.tracks.push(track);
  }
}

/**
 * Overlap policy: two consecutive clips on a track MAY overlap - the overlap
 * is rendered as a crossfade (Vegas-style transition by sliding a clip over
 * its neighbor). What stays forbidden, with offenders pushed right:
 * - a clip overlapping the clip two positions back (no triple overlap);
 * - a clip starting less than MIN_CLIP_DURATION_MS after the previous one
 *   (each clip keeps an exposed head, so ordering stays unambiguous).
 * Copy-on-write: returns the same Project reference when nothing moved, and
 * untouched tracks/clips keep their identity.
 */
export function resolveOverlaps(p: Project, priorityClipId?: string | null): Project {
  let projectChanged = false;
  const tracks = p.tracks.map((track) => {
    const sorted = [...track.clips].sort((a, b) => {
      if (a.timelineStartMs !== b.timelineStartMs) return a.timelineStartMs - b.timelineStartMs;
      if (a.id === priorityClipId) return -1;
      if (b.id === priorityClipId) return 1;
      return 0;
    });
    const movedTo = new Map<string, number>();
    let prev: { start: number; end: number } | null = null;
    let prevPrevEnd = 0;
    for (const c of sorted) {
      const minStart = prev ? Math.max(prevPrevEnd, prev.start + MIN_CLIP_DURATION_MS) : 0;
      const start = Math.max(c.timelineStartMs, minStart);
      if (start !== c.timelineStartMs) movedTo.set(c.id, start);
      prevPrevEnd = prev ? prev.end : 0;
      prev = { start, end: start + clipDurationMs(c) };
    }
    if (movedTo.size === 0) return track;
    projectChanged = true;
    return {
      ...track,
      clips: track.clips.map((c) =>
        movedTo.has(c.id) ? { ...c, timelineStartMs: movedTo.get(c.id)! } : c,
      ),
    };
  });
  return projectChanged ? { ...p, tracks } : p;
}

/**
 * Copy-on-write clip edits: only the touched clips (and their tracks) get a
 * new identity, so memoized clip views of untouched clips skip re-rendering.
 * An edit returning the same clip is a no-op; if nothing changed, the same
 * Project reference comes back.
 */
export function patchClips(p: Project, edits: Map<string, (c: Clip) => Clip>): Project {
  let projectChanged = false;
  const tracks = p.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((c) => {
      const edit = edits.get(c.id);
      if (!edit) return c;
      const next = edit(c);
      if (next === c) return c;
      trackChanged = true;
      return next;
    });
    if (!trackChanged) return track;
    projectChanged = true;
    return { ...track, clips };
  });
  return projectChanged ? { ...p, tracks } : p;
}

/** Find (or create) the track a clip of the given kind should land on. Mutates `p`. */
export function ensureTrack(p: Project, kind: Track['kind'], preferredTrackId?: string): Track {
  const preferred = preferredTrackId ? p.tracks.find((t) => t.id === preferredTrackId) : undefined;
  if (preferred && preferred.kind === kind) return preferred;
  const existing = p.tracks.find((t) => t.kind === kind);
  if (existing) return existing;
  const track: Track = { id: uid('track'), kind, clips: [] };
  insertTrack(p, track);
  return track;
}

export function findClip(
  project: Project,
  clipId: string,
): { track: Track; clip: Clip; index: number } | null {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index !== -1) return { track, clip: track.clips[index]!, index };
  }
  return null;
}

/** Ids of the clips A/V-linked to `clipId` (same non-empty `linkId`), excluding it. */
export function linkedPartnerIds(project: Project, clipId: string): string[] {
  const linkId = findClip(project, clipId)?.clip.linkId;
  if (!linkId) return [];
  const out: string[] = [];
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.id !== clipId && c.linkId === linkId) out.push(c.id);
    }
  }
  return out;
}

/** Expand a set of clip ids to also include every A/V-linked partner. */
export function withLinkedIds(project: Project, clipIds: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const id of clipIds) {
    set.add(id);
    for (const partner of linkedPartnerIds(project, id)) set.add(partner);
  }
  return [...set];
}

/**
 * The A/V-link partners for a lone clip (empty if none). Drives the
 * single-select "Link" path: unlinked media clips on the OPPOSITE-kind tracks,
 * from the SAME asset, preferring the one that overlaps it in time (falling
 * back to the closest start). Same-asset matching makes the unlink → re-link
 * round trip pick the original partners back.
 *
 * A video clip takes the best candidate from EACH audio track, because an
 * import splits a multi-stream source into one audio lane per stream and all of
 * them belong to the same group. An audio clip takes a single video partner.
 */
export function linkCandidates(project: Project, clipId: string): string[] {
  const found = findClip(project, clipId);
  if (!found) return [];
  const { clip, track } = found;
  if (clip.linkId != null || clip.kind !== 'media' || clip.assetId === '') return [];
  const wantKind: Track['kind'] = track.kind === 'video' ? 'audio' : 'video';
  const start = clip.timelineStartMs;
  const end = clipEndMs(clip);
  const perTrack: { id: string; overlap: number; gap: number }[] = [];
  for (const t of project.tracks) {
    if (t.kind !== wantKind) continue;
    let best: { id: string; overlap: number; gap: number } | null = null;
    for (const c of t.clips) {
      if (c.linkId != null || c.kind !== 'media' || c.assetId !== clip.assetId) continue;
      const overlap = Math.max(0, Math.min(end, clipEndMs(c)) - Math.max(start, c.timelineStartMs));
      const gap = Math.abs(c.timelineStartMs - start);
      if (!best || overlap > best.overlap || (overlap === best.overlap && gap < best.gap)) {
        best = { id: c.id, overlap, gap };
      }
    }
    if (best) perTrack.push(best);
  }
  if (perTrack.length === 0) return [];
  // Only one video side per link: keep the single best when pairing up from audio.
  if (wantKind === 'video') {
    let best = perTrack[0]!;
    for (const cand of perTrack) {
      if (cand.overlap > best.overlap || (cand.overlap === best.overlap && cand.gap < best.gap)) {
        best = cand;
      }
    }
    return [best.id];
  }
  return perTrack.map((c) => c.id);
}

/**
 * Which clips a "Link" action would join, or null if the selection can't be
 * linked. A multi-clip selection must be entirely unlinked and hold exactly one
 * clip on a video track plus at least one on an audio track (an A/V group is
 * one video side with one lane per audio stream); a single selected clip
 * auto-pairs with its `linkCandidates`. Used for both the command's enabled
 * state and its handler, so they never disagree.
 */
export function linkableSelection(project: Project, selectedClipIds: string[]): string[] | null {
  if (selectedClipIds.length >= 2) {
    let videoCount = 0;
    let audioCount = 0;
    for (const id of selectedClipIds) {
      const found = findClip(project, id);
      if (!found || found.clip.linkId != null) return null;
      if (found.track.kind === 'video') videoCount++;
      else audioCount++;
    }
    if (videoCount !== 1 || audioCount === 0) return null;
    return [...selectedClipIds];
  }
  if (selectedClipIds.length === 1) {
    const partners = linkCandidates(project, selectedClipIds[0]!);
    return partners.length > 0 ? [selectedClipIds[0]!, ...partners] : null;
  }
  return null;
}
