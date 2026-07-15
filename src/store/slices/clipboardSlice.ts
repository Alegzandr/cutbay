import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import { uid } from '../../lib/id';
import { ensureTrack, findClip } from '../projectOps';

export function createClipboardSlice(
  set: StoreSet,
  get: StoreGet,
  { withHistory }: SliceHelpers,
): Pick<EditorState, 'copyClip' | 'cutClip' | 'pasteAtPlayhead'> {
  return {
    copyClip: (clipId) => {
      const found = findClip(get().project, clipId);
      if (!found) return;
      // A pasted clip is standalone - drop the A/V link so it does not attach to
      // the original's partner.
      const clip = structuredClone(found.clip);
      delete clip.linkId;
      set({ clipboard: { clip, kind: found.track.kind } });
    },

    cutClip: (clipId) => {
      get().copyClip(clipId);
      get().deleteClip(clipId);
    },

    pasteAtPlayhead: () => {
      const { clipboard, currentTimeMs } = get();
      if (!clipboard) return;
      const newId = uid('clip');
      // The pasted clip keeps the playhead position (priority) when overlaps settle.
      withHistory((p) => {
        const track = ensureTrack(p, clipboard.kind, clipboard.clip.trackId);
        track.clips.push({
          ...structuredClone(clipboard.clip),
          id: newId,
          trackId: track.id,
          timelineStartMs: currentTimeMs,
        });
      }, newId);
      set({ selectedClipId: newId, selectedClipIds: [newId] });
    },
  };
}
