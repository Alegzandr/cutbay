import { memo, useEffect, useRef } from 'react';
import { Clip, MediaAsset } from '../types';
import { audioTrackForClip, clipDurationMs } from '../model';
import { useTimelineViewport } from './viewport';

interface Props {
  asset: MediaAsset;
  clip: Clip;
  /** On-screen width of the clip in px (canvas resolution is capped, CSS stretches). */
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
    // Full-resolution canvas (one bar per screen pixel) - a CSS-stretched
    // low-res canvas reads as a blurry blob, not a waveform.
    const w = Math.max(16, Math.min(30000, Math.round(sliceW)));
    const h = 64;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    const spanMs = clip.sourceOutMs - clip.sourceInMs;
    const durMs = clipDurationMs(clip);
    for (let x = 0; x < w; x++) {
      // Fraction along the WHOLE clip (not just the drawn slice) so the sampled
      // source frame and the fade envelope stay correct when only a slice shows.
      // Everything here is independent of timelineStartMs, so moving a clip
      // along the timeline never triggers a repaint.
      const t = widthPx > 0 ? (localStart + ((x + 0.5) / w) * sliceW) / widthPx : 0;
      const srcMs = clip.sourceInMs + t * spanMs;
      const idx = Math.min(peaks.length - 1, Math.max(0, Math.floor((srcMs / asset.durationMs) * peaks.length)));
      const localMs = t * durMs;
      let fade = 1;
      if (clip.fadeInMs > 0) fade = Math.min(fade, localMs / clip.fadeInMs);
      if (clip.fadeOutMs > 0) fade = Math.min(fade, (durMs - localMs) / clip.fadeOutMs);
      const gain = clip.volume * Math.max(0, Math.min(1, fade));
      const bar = Math.max(2, peaks[idx]! * gain * h);
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [
    peaks,
    clip.sourceInMs,
    clip.sourceOutMs,
    clip.volume,
    clip.fadeInMs,
    clip.fadeOutMs,
    clip.speed,
    widthPx,
    localStart,
    sliceW,
    visible,
    color,
    asset.durationMs,
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
