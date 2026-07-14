/**
 * Tiny pub/sub for live audio levels, decoupling the playback engine from the
 * track header meters. The engine publishes per-track peak levels (linear,
 * 0..~2, >1 = clipping) every animation frame while playing, and an empty
 * object once when playback stops so meters fall back to silence.
 */
export type TrackLevels = Record<string, number>;

const listeners = new Set<(levels: TrackLevels) => void>();

export function publishLevels(levels: TrackLevels): void {
  for (const fn of listeners) fn(levels);
}

export function subscribeLevels(fn: (levels: TrackLevels) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
