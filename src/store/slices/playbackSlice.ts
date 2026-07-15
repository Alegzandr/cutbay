import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import { projectDurationMs } from '../../model';
import { clamp } from '../../lib/time';
import { MIN_REGION_MS } from '../../app/config';

export function createPlaybackSlice(
  set: StoreSet,
  get: StoreGet,
  _helpers: SliceHelpers,
): Pick<
  EditorState,
  | 'seek'
  | 'setCurrentTimeFromEngine'
  | 'setPlaying'
  | 'setPlaybackRate'
  | 'setLoopRegion'
  | 'setRegionEdgeAtPlayhead'
  | 'toggleLoopEnabled'
> {
  return {
    seek: (ms) => {
      const duration = projectDurationMs(get().project);
      set({
        currentTimeMs: clamp(ms, 0, Math.max(duration, 0)),
        seekVersion: get().seekVersion + 1,
      });
    },

    setCurrentTimeFromEngine: (ms) => set({ currentTimeMs: ms }),

    setPlaying: (playing) => {
      const { loopEnabled, loopRegion, currentTimeMs } = get();
      // Hitting play with the loop armed from outside the region starts at its in point.
      if (
        playing &&
        loopEnabled &&
        loopRegion &&
        (currentTimeMs < loopRegion.startMs || currentTimeMs >= loopRegion.endMs)
      ) {
        get().seek(loopRegion.startMs);
      }
      set({ playing, ...(playing ? {} : { playbackRate: 1 }) });
    },

    setPlaybackRate: (rate) => set({ playbackRate: clamp(rate, 0.25, 8) }),

    setLoopRegion: (region) => {
      if (!region) {
        set({ loopRegion: null });
        return;
      }
      const startMs = Math.max(0, Math.min(region.startMs, region.endMs));
      const endMs = Math.max(0, Math.max(region.startMs, region.endMs));
      set({ loopRegion: endMs - startMs < MIN_REGION_MS ? null : { startMs, endMs } });
    },

    setRegionEdgeAtPlayhead: (edge) => {
      const { loopRegion, currentTimeMs } = get();
      const other = edge === 'in' ? loopRegion?.endMs : loopRegion?.startMs;
      // No region yet (or the edge would cross the other one): the untouched edge
      // falls back to the project end (I) or the origin (O).
      const fallback = edge === 'in' ? projectDurationMs(get().project) : 0;
      const anchor = other ?? fallback;
      get().setLoopRegion(
        edge === 'in'
          ? { startMs: currentTimeMs, endMs: Math.max(currentTimeMs, anchor) }
          : { startMs: Math.min(currentTimeMs, anchor), endMs: currentTimeMs },
      );
    },

    toggleLoopEnabled: () => set({ loopEnabled: !get().loopEnabled }),
  };
}
