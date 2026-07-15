import type { DragEvent } from 'react';
import { useStore } from '../../store/store';
import { msFromContentX, timelineContentEl } from '../coords';
import { ASSET_DRAG_MIME } from '../../app/config';

/**
 * Drag from the media library: drop an asset at a precise time (and track).
 */
export function useAssetDrop() {
  const onAssetDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onAssetDrop = (e: DragEvent) => {
    const assetId = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!assetId) return;
    e.preventDefault();
    e.stopPropagation();
    const s = useStore.getState();
    const content = timelineContentEl(e.currentTarget as HTMLElement);
    if (!content) {
      s.addClipFromAssetAt(assetId, 0);
      return;
    }
    const ms = msFromContentX(content, e.clientX);
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-track-id]');
    s.addClipFromAssetAt(assetId, ms, row?.dataset.trackId);
  };

  return { onAssetDragOver, onAssetDrop };
}
