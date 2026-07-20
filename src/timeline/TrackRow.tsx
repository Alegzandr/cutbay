import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Track } from '../types';
import { trackCrossfades } from '../model';
import { ClipView } from './ClipView';
import { useStore } from '../store/store';

interface Props {
  track: Track;
  /** Position in the track list (0-based), for the accessible name. */
  index: number;
  pxPerMs: number;
}

/**
 * The clip lane for one track. Its controls live in {@link TrackHeader}, in the
 * fixed pane to the left, so this row is pure timeline: background + clips.
 */
export const TrackRow = memo(function TrackRow({ track, index, pxPerMs }: Props) {
  const { t } = useTranslation();
  const xfades = trackCrossfades(track.clips);
  const trackHeightPx = useStore((s) => s.trackHeightPx);

  // "Video track 2, muted, locked" - the row's name plus its toggled states,
  // so a screen reader hears why the clips inside refuse to change.
  const rowLabel = [
    t(track.kind === 'video' ? 'a11y.track.video' : 'a11y.track.audio', { n: index + 1 }),
    track.muted ? t('a11y.track.state.muted') : null,
    track.hidden ? t('a11y.track.state.hidden') : null,
    track.locked ? t('a11y.track.state.locked') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      role="listitem"
      aria-label={rowLabel}
      className={`relative border-b border-zinc-800/80 ${track.hidden ? 'opacity-40' : ''}`}
      style={{ height: trackHeightPx }}
      data-rowbg
      data-track-id={track.id}
    >
      {/* A locked lane reads as frozen and swallows every pointer gesture on its
          clips, so a drag that starts here cannot move, trim or fade anything.
          The row background stays live underneath, so scrubbing still works. */}
      {track.locked && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgb(250_204_21/0.06)_6px,rgb(250_204_21/0.06)_12px)]"
        />
      )}
      {/* `contents` when unlocked so the wrapper adds no box at all; when locked
          it turns into a plain static div, which swallows pointer events for
          its children without becoming their positioning ancestor. */}
      <div className={track.locked ? 'pointer-events-none' : 'contents'}>
      {track.clips.map((clip) => (
        <ClipView
          key={clip.id}
          clip={clip}
          trackKind={track.kind}
          trackNumber={index + 1}
          pxPerMs={pxPerMs}
          xfadeInMs={xfades.get(clip.id)?.inMs ?? 0}
          xfadeOutMs={xfades.get(clip.id)?.outMs ?? 0}
        />
      ))}
      </div>
    </div>
  );
});
