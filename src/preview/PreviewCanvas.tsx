import { useEffect, useRef } from 'react';
import { PlaybackEngine } from './PlaybackEngine';
import { useStore, getSelectedClip } from '../store/store';
import { Clip, DEFAULT_TRANSFORM, clipEndMs, isTextClip, outputDimensions } from '../types';
import { DestRect, clipDestRect, clipsAt, textClipRect } from './compositor';

interface PreviewDrag {
  clipId: string;
  startNx: number;
  startNy: number;
  origX: number;
  origY: number;
  moved: boolean;
}

/**
 * Output monitor + direct manipulation: dragging a clip in the preview moves
 * its transform position, the wheel over the preview scales the selected clip.
 * The hit-test and the selection outline reuse the compositor's dest-rect math,
 * expressed in % of the canvas so no pixel measuring is needed.
 */
export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<PreviewDrag | null>(null);
  const wheelGesture = useRef<number | null>(null);

  const project = useStore((s) => s.project);
  const assets = useStore((s) => s.assets);
  const currentTimeMs = useStore((s) => s.currentTimeMs);
  const selectedClip = useStore(getSelectedClip);

  const { width: outW, height: outH } = outputDimensions(project.aspectRatio);

  useEffect(() => {
    const engine = new PlaybackEngine(canvasRef.current!);
    return () => engine.dispose();
  }, []);

  /** Bounding rect of a clip in output coordinates (null when unknown). */
  const rectOf = (clip: Clip): DestRect | null => {
    if (isTextClip(clip)) return textClipRect(clip, outW, outH);
    const asset = assets[clip.assetId];
    // The dest rect only depends on the source aspect ratio, known from the probe.
    if (!asset?.width || !asset?.height) return null;
    return clipDestRect(clip, asset.width, asset.height, outW, outH);
  };

  /** Topmost visible clip under a normalized point at the current time. */
  const hitTest = (nx: number, ny: number): Clip | null => {
    const px = nx * outW;
    const py = ny * outH;
    for (const track of [...project.tracks].reverse()) {
      if (track.kind !== 'video' || track.hidden || (track.opacity ?? 1) <= 0) continue;
      const visible = clipsAt(track.clips, currentTimeMs);
      for (let i = visible.length - 1; i >= 0; i--) {
        const r = rectOf(visible[i]);
        if (r && px >= r.dx && px <= r.dx + r.dw && py >= r.dy && py <= r.dy + r.dh) {
          return visible[i];
        }
      }
    }
    return null;
  };

  const normPoint = (e: React.PointerEvent): { nx: number; ny: number } => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { nx: (e.clientX - rect.left) / rect.width, ny: (e.clientY - rect.top) / rect.height };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { nx, ny } = normPoint(e);
    const clip = hitTest(nx, ny);
    if (!clip) return;
    const state = useStore.getState();
    state.selectClip(clip.id);
    state.beginGesture();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t = clip.transform ?? DEFAULT_TRANSFORM;
    drag.current = { clipId: clip.id, startNx: nx, startNy: ny, origX: t.x, origY: t.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { nx, ny } = normPoint(e);
    if (!d.moved && Math.abs(nx - d.startNx) < 0.004 && Math.abs(ny - d.startNy) < 0.004) return;
    d.moved = true;
    const state = useStore.getState();
    const clip = state.project.tracks.flatMap((t) => t.clips).find((c) => c.id === d.clipId);
    if (!clip) return;
    const tf = clip.transform ?? DEFAULT_TRANSFORM;
    state.updateClip(d.clipId, {
      transform: {
        ...tf,
        x: Math.min(1.5, Math.max(-0.5, d.origX + (nx - d.startNx))),
        y: Math.min(1.5, Math.max(-0.5, d.origY + (ny - d.startNy))),
      },
    });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    useStore.getState().endGesture();
    drag.current = null;
  };

  // Wheel over the preview scales the selected clip. Native listener: React's
  // onWheel is passive, and scaling must preventDefault to not scroll the page.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      const state = useStore.getState();
      const clip = getSelectedClip(state);
      if (!clip) return;
      e.preventDefault();
      if (wheelGesture.current === null) state.beginGesture();
      else window.clearTimeout(wheelGesture.current);
      wheelGesture.current = window.setTimeout(() => {
        useStore.getState().endGesture();
        wheelGesture.current = null;
      }, 350);
      const tf = clip.transform ?? DEFAULT_TRANSFORM;
      const scale = Math.min(8, Math.max(0.05, tf.scale * Math.exp(-e.deltaY * 0.0012)));
      state.updateClip(clip.id, { transform: { ...tf, scale } });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // Selection outline: only when the selected clip is actually on screen now.
  const selectedRect =
    selectedClip &&
    currentTimeMs >= selectedClip.timelineStartMs &&
    currentTimeMs < clipEndMs(selectedClip) &&
    project.tracks.some(
      (t) => t.kind === 'video' && !t.hidden && t.clips.some((c) => c.id === selectedClip.id),
    )
      ? rectOf(selectedClip)
      : null;

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-zinc-950 p-1">
      <div
        ref={stageRef}
        className="relative max-h-full w-full max-w-full touch-none"
        style={{ aspectRatio: `${outW} / ${outH}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} className="h-full w-full rounded-lg shadow-lg shadow-black/50" />
        {selectedRect && (
          <div
            className="pointer-events-none absolute rounded-sm ring-2 ring-sky-400/90"
            style={{
              left: `${(selectedRect.dx / outW) * 100}%`,
              top: `${(selectedRect.dy / outH) * 100}%`,
              width: `${(selectedRect.dw / outW) * 100}%`,
              height: `${(selectedRect.dh / outH) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
