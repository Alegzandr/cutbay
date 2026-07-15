import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import { MediaAsset } from '../../types';
import { createEmptyProject } from '../projectOps';
import { disposeAssetResources } from '../../media/mediaCache';

export function createProjectSlice(
  set: StoreSet,
  get: StoreGet,
  { withHistory }: SliceHelpers,
): Pick<EditorState, 'setAspectRatio' | 'hydrate' | 'resetProject'> {
  return {
    setAspectRatio: (a) => withHistory((p) => void (p.aspectRatio = a)),

    hydrate: (project, assets) => {
      const map: Record<string, MediaAsset> = {};
      for (const a of assets) map[a.id] = a;
      set({
        // Projects saved before markers existed restore without the field.
        project: { ...project, markers: project.markers ?? [] },
        assets: map,
        past: [],
        future: [],
        selectedClipId: null,
        selectedClipIds: [],
        currentTimeMs: 0,
        loopRegion: null,
        seekVersion: get().seekVersion + 1,
      });
    },

    resetProject: () => {
      for (const id of Object.keys(get().assets)) disposeAssetResources(id);
      set({
        project: createEmptyProject(),
        assets: {},
        past: [],
        future: [],
        selectedClipId: null,
        selectedClipIds: [],
        clipboard: null,
        inspectorOpen: false,
        currentTimeMs: 0,
        loopRegion: null,
        seekVersion: get().seekVersion + 1,
        playing: false,
      });
    },
  };
}
