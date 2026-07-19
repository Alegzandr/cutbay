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

/**
 * Whether any meter is currently mounted. The engine reads the analysers and
 * scans 1024 samples per track every frame to produce these levels, which is
 * pure waste when the track headers are collapsed or off-screen.
 */
export function hasLevelListeners(): boolean {
  return listeners.size > 0;
}

export function subscribeLevels(fn: (levels: TrackLevels) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
