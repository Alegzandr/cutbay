import { type RefObject, useEffect } from 'react';
import { useStore } from '../../store/store';

interface ScrubRefs {
  programmaticScroll: RefObject<boolean>;
  pinching: RefObject<boolean>;
  lastScrollLeft: RefObject<number>;
}

/**
 * Mobile scroll<->time sync: scrolling scrubs (scrollLeft = t * pxPerMs), and any
 * time/zoom change re-centers the content under the fixed playhead.
 */
export function useMobileScrubSync(
  scrollerRef: RefObject<HTMLDivElement | null>,
  coarse: boolean,
  { programmaticScroll, pinching, lastScrollLeft }: ScrubRefs,
  empty: boolean,
) {
  useEffect(() => {
    if (!coarse) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const sync = () => {
      const s = useStore.getState();
      const target = s.currentTimeMs * (s.pxPerSec / 1000);
      if (Math.abs(scroller.scrollLeft - target) > 1) {
        programmaticScroll.current = true;
        scroller.scrollLeft = target;
      }
    };
    sync();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.currentTimeMs !== prev.currentTimeMs || s.pxPerSec !== prev.pxPerSec) sync();
    });

    const onScroll = () => {
      const left = scroller.scrollLeft;
      if (left === lastScrollLeft.current) return; // vertical-only scroll
      lastScrollLeft.current = left;
      if (programmaticScroll.current) {
        programmaticScroll.current = false;
        return;
      }
      if (pinching.current) return;
      const s = useStore.getState();
      if (s.playing) return; // the engine drives time; touching pauses first
      s.seek(left / (s.pxPerSec / 1000));
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      unsub();
      scroller.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coarse, empty]);
}
