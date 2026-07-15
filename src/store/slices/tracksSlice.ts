import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import { uid } from '../../lib/id';
import { insertTrack } from '../projectOps';

export function createTracksSlice(
  set: StoreSet,
  get: StoreGet,
  { withHistory, pruneSelection }: SliceHelpers,
): Pick<
  EditorState,
  | 'addTrack'
  | 'updateTrack'
  | 'removeTrack'
  | 'moveTrack'
  | 'toggleTrackMuted'
  | 'toggleTrackHidden'
> {
  return {
    addTrack: (kind) =>
      withHistory((p) => {
        insertTrack(p, { id: uid('track'), kind, clips: [] });
      }),

    removeTrack: (trackId) => {
      withHistory((p) => {
        p.tracks = p.tracks.filter((t) => t.id !== trackId);
      });
      pruneSelection();
    },

    moveTrack: (trackId, dir) =>
      withHistory((p) => {
        const i = p.tracks.findIndex((t) => t.id === trackId);
        const j = i + dir;
        if (i === -1 || j < 0 || j >= p.tracks.length) return;
        [p.tracks[i], p.tracks[j]] = [p.tracks[j]!, p.tracks[i]!];
      }),

    toggleTrackMuted: (trackId) =>
      withHistory((p) => {
        const track = p.tracks.find((tr) => tr.id === trackId);
        if (track) track.muted = !track.muted;
      }),

    toggleTrackHidden: (trackId) =>
      withHistory((p) => {
        const track = p.tracks.find((tr) => tr.id === trackId);
        if (track) track.hidden = !track.hidden;
      }),

    updateTrack: (trackId, patch) => {
      const p = get().project;
      const tracks = p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t));
      set({ project: { ...p, tracks } });
    },
  };
}
