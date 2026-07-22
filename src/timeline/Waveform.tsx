import { memo, useEffect, useRef } from 'react';
import { Clip, MediaAsset } from '../types';
import { audioTrackForClip } from '../model';
import { useTimelineViewport } from './viewport';

interface Props {
  asset: MediaAsset;
  clip: Clip;
  /** On-screen width of the clip in CSS px. */
  widthPx: number;
  /** Content-x of the clip's left edge, to intersect the waveform with the viewport. */
  clipLeftPx: number;
  /** CSS color of the bars. */
  color: string;
}

/** Waveform of the clip's source window [sourceInMs, sourceOutMs], mirrored around the center. */
export const Waveform = memo(function Waveform({ asset, clip, widthPx, clipLeftPx, color }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewport = useTimelineViewport();
  // The clip's own source audio track (a multi-track video's clips each draw a
  // different track's waveform).
  const peaks = audioTrackForClip(asset, clip)?.peaks;
  // Destructure the fields the draw depends on, so the effect depends on those
  // primitives (a repaint only when the shape/gain actually changes) rather than
  // the whole clip object - which would repaint on any unrelated edit.
  const { sourceInMs, sourceOutMs, volume, fadeInMs, fadeOutMs, speed } = clip;
  const { durationMs } = asset;

  // Only the visible slice of the clip is drawn: the canvas covers [localStart,
  // localEnd] (clip-local px) instead of the whole clip, so the per-pixel scan
  // stays bounded to the viewport no matter how wide the clip gets at deep zoom.
  const localStart = viewport ? Math.max(0, viewport.left - clipLeftPx) : 0;
  const localEnd = viewport ? Math.min(widthPx, viewport.right - clipLeftPx) : widthPx;
  const sliceW = localEnd - localStart;
  const visible = sliceW > 0.5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks?.length || !visible) return;
    // One bar per PHYSICAL pixel - a CSS-stretched low-res canvas reads as a
    // blurry blob, and sizing the backing store in CSS px leaves the browser
    // upscaling by the device ratio, which is the same blur one step later.
    // Only the width is scaled: the height stays a fixed backing size that CSS
    // stretches to the lane, since a full-height bar has nothing to blur.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(16, Math.min(30000, Math.round(sliceW * dpr)));
    const h = 64;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    const spanMs = sourceOutMs - sourceInMs;
    const durMs = spanMs / speed;
    // How many peak bins one bar spans, which decides how the envelope is
    // sampled: zoomed in, bars are narrower than a bin and must interpolate
    // (reading the nearest bin repeats one height across many bars, drawing
    // flat blocks); zoomed out, a bar covers many bins and must take their max
    // (reading one bin drops the loudest content and flickers while scrolling).
    const binsPerBar = widthPx > 0 ? ((spanMs / durationMs) * peaks.length * (sliceW / w)) / widthPx : 0;
    const half = binsPerBar / 2;
    for (let x = 0; x < w; x++) {
      // Fraction along the WHOLE clip (not just the drawn slice) so the sampled
      // source frame and the fade envelope stay correct when only a slice shows.
      // Everything here is independent of timelineStartMs, so moving a clip
      // along the timeline never triggers a repaint.
      const t = widthPx > 0 ? (localStart + ((x + 0.5) / w) * sliceW) / widthPx : 0;
      const srcMs = sourceInMs + t * spanMs;
      // Continuous bin position; bin i is centered at i + 0.5.
      const center = (srcMs / durationMs) * peaks.length;
      let peak: number;
      if (binsPerBar >= 2) {
        const from = Math.max(0, Math.floor(center - half));
        const to = Math.min(peaks.length, Math.ceil(center + half));
        peak = 0;
        for (let i = from; i < to; i++) if (peaks[i]! > peak) peak = peaks[i]!;
      } else {
        const f = center - 0.5;
        const i0 = Math.min(peaks.length - 1, Math.max(0, Math.floor(f)));
        const i1 = Math.min(peaks.length - 1, i0 + 1);
        const frac = Math.min(1, Math.max(0, f - i0));
        peak = peaks[i0]! * (1 - frac) + peaks[i1]! * frac;
      }
      const localMs = t * durMs;
      let fade = 1;
      if (fadeInMs > 0) fade = Math.min(fade, localMs / fadeInMs);
      if (fadeOutMs > 0) fade = Math.min(fade, (durMs - localMs) / fadeOutMs);
      const gain = volume * Math.max(0, Math.min(1, fade));
      const bar = Math.max(2, peak * gain * h);
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [
    peaks,
    sourceInMs,
    sourceOutMs,
    volume,
    fadeInMs,
    fadeOutMs,
    speed,
    widthPx,
    localStart,
    sliceW,
    visible,
    color,
    durationMs,
  ]);

  if (!peaks?.length || !visible) return null;
  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 h-full"
      style={{ left: localStart, width: sliceW }}
    />
  );
});
