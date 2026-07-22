import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import type { Clip } from '../../types';
import { clipDurationMs, clipEndMs } from '../../model';
import { findClip, linkedPartnerIds } from '../projectOps';
import { EFFECTS_BY_ID } from '../../effects/catalog';
import { resolveEffectTargets } from '../../effects/apply';
import { DEFAULT_CROSSFADE_MS, MIN_CLIP_DURATION_MS } from '../../app/config';

/** The clip immediately before `clip` on its track, or null when it is the first. */
function previousClip(clips: Clip[], clip: Clip): Clip | null {
  let best: Clip | null = null;
  for (const c of clips) {
    if (c.id === clip.id || c.timelineStartMs > clip.timelineStartMs) continue;
    if (!best || c.timelineStartMs > best.timelineStartMs) {
      best = c;
    } else if (c.timelineStartMs === best.timelineStartMs && clipEndMs(c) > clipEndMs(best)) {
      // Of two clips starting together, the one running longest is the one this
      // clip actually emerges from.
      best = c;
    }
  }
  return best;
}

export function createEffectsSlice(
  _set: StoreSet,
  get: StoreGet,
  { withHistory }: SliceHelpers,
): Pick<EditorState, 'applyEffectPreset' | 'applyTransition'> {
  return {
    applyEffectPreset: (effectId, clipIds) => {
      const preset = EFFECTS_BY_ID[effectId];
      if (!preset || clipIds.length === 0) return;
      const state = get();
      // Resolved against the live project: `accepts` needs the backing asset,
      // and an audio preset may redirect onto a linked partner.
      const targets = resolveEffectTargets(state.project, state.assets, effectId, clipIds);
      if (targets.length === 0) return;
      withHistory((p) => {
        for (const id of targets) {
          const found = findClip(p, id);
          if (found) Object.assign(found.clip, preset.patch(found.clip));
        }
      });
    },

    applyTransition: (clipId, type) => {
      const p = get().project;
      const found = findClip(p, clipId);
      if (!found) return false;
      const { clip, track } = found;
      const prev = previousClip(track.clips, clip);
      // Nothing to transition from: a style on the first clip of a track has no
      // overlap to render over, now or ever.
      if (!prev) return false;

      const overlap = clipEndMs(prev) - clip.timelineStartMs;
      if (overlap > 0) {
        // Already crossfading: only the style changes, the edit stays put.
        get().updateClipCommitted(clipId, { transition: type });
        return true;
      }
      // A deliberate gap is not a cut: closing it would move the clip an
      // arbitrary distance and silently retime the edit. Refuse instead.
      if (overlap < 0) return false;

      // Butt cut: slide this clip back over its predecessor to open the window
      // the transition renders in. Both clips must keep a minimum exposed body,
      // and the slide must not reach the clip two positions back (which
      // `resolveOverlaps` would then undo by shoving everything right).
      const prevPrev = previousClip(
        track.clips.filter((c) => c.id !== clip.id),
        prev,
      );
      const headroom = clip.timelineStartMs - (prevPrev ? clipEndMs(prevPrev) : 0);
      const window = Math.min(
        DEFAULT_CROSSFADE_MS,
        clipDurationMs(prev) - MIN_CLIP_DURATION_MS,
        clipDurationMs(clip) - MIN_CLIP_DURATION_MS,
        headroom,
      );
      if (window <= 0) return false;

      // Linked partners follow the same shift, or picture and sound desync.
      const partners = linkedPartnerIds(p, clipId);
      withHistory((draft) => {
        const target = findClip(draft, clipId);
        if (!target) return;
        target.clip.transition = type;
        target.clip.timelineStartMs = Math.max(0, target.clip.timelineStartMs - window);
        for (const pid of partners) {
          const partner = findClip(draft, pid);
          if (partner) {
            partner.clip.timelineStartMs = Math.max(0, partner.clip.timelineStartMs - window);
          }
        }
      }, clipId);
      return true;
    },
  };
}
