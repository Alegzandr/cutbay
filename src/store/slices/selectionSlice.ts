import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';

export function createSelectionSlice(
  set: StoreSet,
  get: StoreGet,
  _helpers: SliceHelpers,
): Pick<EditorState, 'selectClip' | 'selectAllClips' | 'toggleSelectClip'> {
  return {
    selectClip: (id) =>
      set({
        selectedClipId: id,
        selectedClipIds: id ? [id] : [],
        // Crop-edit mode is bound to one clip; any selection change ends it.
        cropEditing: false,
        ...(id === null ? { inspectorOpen: false } : {}),
      }),

    selectAllClips: () => {
      const ids = get().project.tracks.flatMap((t) => t.clips.map((c) => c.id));
      set({ selectedClipIds: ids, selectedClipId: ids[ids.length - 1] ?? null });
    },

    toggleSelectClip: (id) => {
      const ids = get().selectedClipIds.includes(id)
        ? get().selectedClipIds.filter((x) => x !== id)
        : [...get().selectedClipIds, id];
      set({
        selectedClipIds: ids,
        selectedClipId: ids[ids.length - 1] ?? null,
        ...(ids.length === 0 ? { inspectorOpen: false } : {}),
      });
    },
  };
}
