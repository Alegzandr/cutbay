/**
 * Keyframe markers on the selected clip: a diamond at every keyframe time,
 * aggregated across the clip's animated properties. Clicking one seeks the
 * playhead to it — the Adobe/Vegas reflex of navigating an animation by its
 * keys. Shown on selection, like the fade handles, so an idle timeline stays
 * quiet (progressive disclosure).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clip } from '../types';
import { useStore } from '../store/store';
import { formatTime } from '../lib/time';

/** Unique keyframe times (clip-local ms) across every animated property of a clip. */
function keyframeTimes(clip: Clip): number[] {
  const anim = clip.animation;
  if (!anim) return [];
  const set = new Set<number>();
  for (const keys of Object.values(anim)) {
    if (keys) for (const k of keys) set.add(k.t);
  }
  return [...set].sort((a, b) => a - b);
}

export const ClipKeyframes = memo(function ClipKeyframes({
  clip,
  pxPerMs,
  coarse,
}: {
  clip: Clip;
  pxPerMs: number;
  coarse: boolean;
}) {
  const { t } = useTranslation();
  const times = keyframeTimes(clip);
  if (!times.length) return null;
  const size = coarse ? 'h-3 w-3' : 'h-2 w-2';
  return (
    // A thin lane along the clip's bottom edge; the diamonds themselves take
    // pointer events, the lane does not, so it never blocks a clip drag.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-3">
      {times.map((time) => (
        <button
          key={time}
          type="button"
          aria-label={`${t('inspector.keyframe')} · ${formatTime(clip.timelineStartMs + time)}`}
          title={`${t('inspector.keyframe')} · ${formatTime(clip.timelineStartMs + time)}`}
          className={`pointer-events-auto absolute bottom-0.5 -translate-x-1/2 rotate-45 rounded-[1px] border border-zinc-900 bg-zinc-100 shadow active:bg-sky-300 ${size}`}
          style={{ left: time * pxPerMs }}
          // Seek on pointerdown and swallow it, so tapping a key navigates to it
          // instead of arming a clip move.
          onPointerDown={(e) => {
            e.stopPropagation();
            useStore.getState().seek(clip.timelineStartMs + time);
          }}
        />
      ))}
    </div>
  );
});
