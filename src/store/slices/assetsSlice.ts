import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import { disposeAssetResources } from '../../media/mediaCache';
import { ensureAssetVisuals, probeFile } from '../../media/probe';
import { t } from '../../i18n';

export function createAssetsSlice(
  set: StoreSet,
  get: StoreGet,
  { withHistory, pruneSelection }: SliceHelpers,
): Pick<
  EditorState,
  | 'addAsset'
  | 'removeAsset'
  | 'reconnectAsset'
  | 'setAssetPeaks'
  | 'setAssetThumbnails'
  | 'setImporting'
> {
  return {
    addAsset: (asset) => set({ assets: { ...get().assets, [asset.id]: asset } }),

    reconnectAsset: async (assetId, file) => {
      const existing = get().assets[assetId];
      if (!existing) return;
      try {
        // Reuse the id so the asset's clips stay linked; probe re-registers the
        // decoder input (disposing the stale one) under the same id.
        const { asset: probed, warning } = await probeFile(file, assetId);
        // The asset may have been removed while the OS file dialog was open.
        if (!get().assets[assetId]) {
          disposeAssetResources(assetId);
          return;
        }

        // The replacement need not line up with the original: a shorter file
        // leaves clips trimmed past its end, a different kind changes what they
        // render. Warn before committing and let the user keep the original.
        const overrun = get()
          .project.tracks.flatMap((tr) => tr.clips)
          .filter((c) => c.assetId === assetId && c.sourceOutMs > probed.durationMs);
        const message =
          probed.kind !== existing.kind
            ? t('library.reconnectTypeMismatch')
            : overrun.length > 0
              ? t('library.reconnectMismatch', { count: overrun.length })
              : null;
        if (message && !window.confirm(message)) {
          // Put the original file back under the id so its decoder is valid
          // again. A disconnected asset has no readable file to restore: it
          // simply stays disconnected.
          if (!existing.disconnected) {
            await probeFile(existing.file, assetId).catch(() => undefined);
          }
          return;
        }

        set({ assets: { ...get().assets, [assetId]: probed } });
        // Clamp what the new source can no longer cover, as one undoable step.
        if (overrun.length > 0) {
          const ids = new Set(overrun.map((c) => c.id));
          withHistory((p) => {
            for (const track of p.tracks) {
              for (const clip of track.clips) {
                if (!ids.has(clip.id)) continue;
                clip.sourceOutMs = probed.durationMs;
                // Keep a non-empty source window when the in point overran too.
                clip.sourceInMs = Math.min(clip.sourceInMs, Math.max(0, probed.durationMs - 1));
              }
            }
          });
        }
        ensureAssetVisuals(probed, get());
        if (warning) get().setError(warning);
      } catch (err) {
        get().setError(
          err instanceof Error
            ? err.message
            : t('errors.media.importFailed', { name: file.name }),
        );
      }
    },

    setAssetPeaks: (assetId, audioTrackIndex, peaks) => {
      const asset = get().assets[assetId];
      if (!asset) return;
      // Attach the peaks to their own audio track, leaving the others untouched.
      const audioTracks = asset.audioTracks.map((tr) =>
        tr.index === audioTrackIndex ? { ...tr, peaks } : tr,
      );
      set({ assets: { ...get().assets, [assetId]: { ...asset, audioTracks } } });
    },

    setAssetThumbnails: (assetId, thumbnails) => {
      const asset = get().assets[assetId];
      if (!asset) return;
      set({ assets: { ...get().assets, [assetId]: { ...asset, thumbnails } } });
    },

    removeAsset: (assetId) => {
      withHistory((p) => {
        for (const track of p.tracks) {
          track.clips = track.clips.filter((c) => c.assetId !== assetId);
        }
      });
      const assets = { ...get().assets };
      delete assets[assetId];
      set({ assets });
      // No dispose here: the removal is undoable, and the history now holds the
      // asset - freeing its decoder would make the restored card unplayable.
      pruneSelection();
    },

    setImporting: (v) => set({ importing: v }),
  };
}
