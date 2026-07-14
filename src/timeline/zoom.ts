import { useStore, projectDurationMs } from '../store/store';
import { clamp } from '../lib/time';

/** Zoom keeping the playhead at the same screen position (falls back to plain zoom). */
export function zoomAtPlayhead(factor: number): void {
  const s = useStore.getState();
  const scroller = document.querySelector<HTMLElement>('.timeline-scroller');
  const oldPxMs = s.pxPerSec / 1000;
  s.setPxPerSec(s.pxPerSec * factor);
  const newPxMs = useStore.getState().pxPerSec / 1000;
  if (!scroller) return;
  const pad = s.timelinePadLeft;
  const anchorView = clamp(pad + s.currentTimeMs * oldPxMs - scroller.scrollLeft, 0, scroller.clientWidth);
  scroller.scrollLeft = pad + s.currentTimeMs * newPxMs - anchorView;
}

/** Fit the whole project into the visible timeline width and scroll back to 0. */
export function zoomToFit(): void {
  const s = useStore.getState();
  const scroller = document.querySelector<HTMLElement>('.timeline-scroller');
  const durationMs = projectDurationMs(s.project);
  if (!scroller || durationMs <= 0) return;
  const usable = Math.max(80, scroller.clientWidth - s.timelinePadLeft - 24);
  s.setPxPerSec((usable / durationMs) * 1000);
  scroller.scrollLeft = 0;
}
