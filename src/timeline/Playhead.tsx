import { RefObject, useEffect, useRef } from 'react';
import { useStore } from '../store/store';
import { msFromClientX } from './coords';

interface Props {
  scrollerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Desktop playhead: positioned at the current time, draggable, paged into view
 * while playing. Positioned via a direct DOM transform from a store
 * subscription - at 60 updates/sec during playback, going through React
 * reconciliation (and a layout-invalidating `left`) is pure overhead.
 */
export function Playhead({ scrollerRef }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    const handle = handleRef.current;
    if (!bar || !handle) return;
    let lastX = -1;
    const apply = () => {
      const s = useStore.getState();
      const x = s.timelinePadLeft + s.currentTimeMs * (s.pxPerSec / 1000);
      if (x !== lastX) {
        lastX = x;
        bar.style.transform = `translateX(${x}px)`;
        handle.style.transform = `translateX(${x}px)`;
      }
      // Keep the playhead in view while playing.
      const scroller = scrollerRef.current;
      if (s.playing && scroller) {
        const margin = 48;
        if (x > scroller.scrollLeft + scroller.clientWidth - margin) {
          scroller.scrollLeft = x - margin;
        } else if (x < scroller.scrollLeft + s.timelinePadLeft) {
          scroller.scrollLeft = Math.max(0, x - s.timelinePadLeft);
        }
      }
    };
    apply();
    return useStore.subscribe((s, prev) => {
      if (
        s.currentTimeMs !== prev.currentTimeMs ||
        s.pxPerSec !== prev.pxPerSec ||
        s.timelinePadLeft !== prev.timelinePadLeft ||
        s.playing !== prev.playing
      ) {
        apply();
      }
    });
  }, [scrollerRef]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    useStore.getState().seek(msFromClientX(e.currentTarget as HTMLElement, e.clientX));
  };

  // Bar and handle are siblings rather than one transformed wrapper: a wrapper
  // with a transform would create a stacking context, forcing both to share a
  // single z-index. The bar has to slide *under* the sticky track headers
  // (z-20) while the handle stays *over* the marker bar / ruler (z-30).
  return (
    <>
      <div
        ref={barRef}
        className="pointer-events-none absolute inset-y-0 -ml-px left-0 z-10 w-0.5 bg-red-500 will-change-transform"
      />
      <div
        ref={handleRef}
        className="absolute -ml-2 left-0 top-0 z-40 h-5 w-4 cursor-col-resize touch-none rounded-b-md bg-red-500 will-change-transform"
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={onPointerMove}
      />
    </>
  );
}
