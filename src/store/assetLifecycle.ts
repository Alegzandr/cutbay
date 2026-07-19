import type { MediaAsset } from '../types';
import type { HistoryEntry } from './editorState';
import { disposeAssetResources } from '../media/mediaCache';

/**
 * The library map an undo/redo should land on: the snapshot decides WHICH
 * assets exist, the live map decides WHAT they contain. Peaks and thumbnails
 * are computed in the background and land on the asset long after the snapshot
 * was taken - restoring the snapshot verbatim would throw that work away.
 * Returns `live` unchanged when nothing differs, so subscribers (persistence,
 * the library) don't re-run on a no-op.
 */
export function reviveAssets(
  snapshot: Record<string, MediaAsset>,
  live: Record<string, MediaAsset>,
): Record<string, MediaAsset> {
  const ids = Object.keys(snapshot);
  let unchanged = ids.length === Object.keys(live).length;
  const next: Record<string, MediaAsset> = {};
  for (const id of ids) {
    const asset = live[id] ?? snapshot[id]!;
    next[id] = asset;
    if (unchanged && live[id] !== asset) unchanged = false;
  }
  return unchanged ? live : next;
}

/**
 * Release decoder/peak/thumbnail resources for assets that no longer exist in
 * the library AND that no history entry can bring back. An asset dropped by an
 * undo stays fully alive: the matching redo must restore a working card.
 *
 * Known bound: an asset that falls out of the library and then off the end of
 * the history (HISTORY_LIMIT) is never revisited, so its resources live until
 * the project is reset. Bounded by the history depth, not by session length.
 */
export function disposeUnreachableAssets(
  candidates: Iterable<string>,
  state: { assets: Record<string, MediaAsset>; past: HistoryEntry[]; future: HistoryEntry[] },
): void {
  for (const id of candidates) {
    if (state.assets[id]) continue;
    if (state.past.some((e) => e.assets[id]) || state.future.some((e) => e.assets[id])) continue;
    disposeAssetResources(id);
  }
}
