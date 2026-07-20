import { memo } from 'react';
import { Clip, MediaAsset } from '../types';
import { useStore } from '../store/store';
import { useTimelineViewport } from './viewport';

/**
 * Filmstrip: thumbnails tiled at the source aspect ratio (never stretched),
 * each tile showing the frame closest to its position in the clip.
 */
export const Filmstrip = memo(function Filmstrip({
  asset,
  clip,
  widthPx,
  clipLeftPx,
}: {
  asset: MediaAsset;
  clip: Clip;
  widthPx: number;
  /** Content-x of the clip's left edge, to intersect the filmstrip with the viewport. */
  clipLeftPx: number;
}) {
  const viewport = useTimelineViewport();
  const trackHeightPx = useStore((s) => s.trackHeightPx);
  const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9;
  const tileW = Math.max(24, Math.round((trackHeightPx - 8) * aspect));
  const total = Math.max(1, Math.ceil(widthPx / tileW));
  const spanMs = clip.sourceOutMs - clip.sourceInMs;
  const thumbs = asset.thumbnails;

  // Only the tiles inside the visible window are put in the DOM: a long clip at
  // deep zoom is otherwise up to thousands of <img> nodes, rebuilt on every
  // zoom. Until the viewport is known, render a bounded prefix (the virtualized
  // pass corrects it on the same commit).
  let startTile = 0;
  let endTile = viewport ? total : Math.min(total, 400);
  if (viewport) {
    startTile = Math.max(0, Math.floor((viewport.left - clipLeftPx) / tileW));
    endTile = Math.min(total, Math.max(0, Math.ceil((viewport.right - clipLeftPx) / tileW)));
  }
  if (endTile <= startTile) return <div className="h-full w-full" />;

  const tiles: number[] = [];
  for (let i = startTile; i < endTile; i++) tiles.push(i);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {tiles.map((i) => {
        const srcMs = clip.sourceInMs + ((i + 0.5) / total) * spanMs;
        const idx = Math.min(
          thumbs.length - 1,
          Math.max(0, Math.round((srcMs / asset.durationMs) * (thumbs.length - 1))),
        );
        return (
          <img
            key={i}
            src={thumbs[idx]}
            className="absolute top-0 h-full object-cover"
            style={{ left: i * tileW, width: tileW }}
            alt=""
            draggable={false}
            decoding="async"
          />
        );
      })}
    </div>
  );
});
