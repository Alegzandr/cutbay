import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { announce, subscribeAnnouncements, type Announcement } from '../lib/a11yBus';
import { useStore } from '../store/store';

/**
 * Visually hidden polite live region: screen readers speak key state changes
 * (play/pause, split, delete, undo/redo) without stealing focus or repainting
 * anything visible.
 *
 * Edits publish onto the a11y bus from the store slices; play/pause is derived
 * here from the store's `playing` flag instead, so every code path that
 * toggles playback (Space, transport button, J/K/L, menu) announces the same
 * way without each caller having to remember to.
 */
export function A11yAnnouncer() {
  const { t } = useTranslation();
  const [msg, setMsg] = useState<(Announcement & { n: number }) | null>(null);

  useEffect(
    () => subscribeAnnouncements((a) => setMsg((prev) => ({ ...a, n: (prev?.n ?? 0) + 1 }))),
    [],
  );

  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.playing !== prev.playing) {
          announce(s.playing ? 'a11y.announce.play' : 'a11y.announce.pause');
        }
      }),
    [],
  );

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {/* The alternating no-break space forces a DOM mutation when the same
          message repeats (two splits in a row), so it is re-announced. */}
      {msg ? t(msg.key, msg.params) + (msg.n % 2 ? ' ' : '') : ''}
    </div>
  );
}
