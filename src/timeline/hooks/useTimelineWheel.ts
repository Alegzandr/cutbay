import { type RefObject, useEffect } from 'react';
import { useStore } from '../../store/store';

/**
 * Wheel. Desktop (Vegas-style): plain wheel pans horizontally, Ctrl/Cmd+wheel zooms
 * at the cursor (also covers trackpad pinch), Alt+wheel keeps native vertical scroll.
 */
export function useTimelineWheel(
  scrollerRef: RefObject<HTMLDivElement | null>,
  coarse: boolean,
  empty: boolean,
) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (e.ctrlKey || e.metaKey || coarse) {
        e.preventDefault();
        const state = useStore.getState();
        const factor = Math.exp(-e.deltaY * 0.0018);
        const rect = scroller.getBoundingClientRect();
        const pad = state.timelinePadLeft;
        const contentX = scroller.scrollLeft + e.clientX - rect.left;
        const anchorMs = (contentX - pad) / (state.pxPerSec / 1000);
        state.setPxPerSec(state.pxPerSec * factor);
        const newPxPerMs = useStore.getState().pxPerSec / 1000;
        scroller.scrollLeft = anchorMs * newPxPerMs + pad - (e.clientX - rect.left);
      } else if (!e.altKey && !e.shiftKey) {
        e.preventDefault();
        scroller.scrollLeft += e.deltaY;
      }
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coarse, empty]);
}
