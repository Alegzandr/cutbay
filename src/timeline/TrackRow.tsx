import { memo } from 'react';
import { Track } from '../types';
import { trackCrossfades } from '../model';
import { ClipView } from './ClipView';
import { TRACK_HEIGHT_PX } from '../app/config';

interface Props {
  track: Track;
  pxPerMs: number;
}

/**
 * The clip lane for one track. Its controls live in {@link TrackHeader}, in the
 * fixed pane to the left, so this row is pure timeline: background + clips.
 */
export const TrackRow = memo(function TrackRow({ track, pxPerMs }: Props) {
  const xfades = trackCrossfades(track.clips);

  return (
    <div
      className={`relative border-b border-zinc-800/80 ${track.hidden ? 'opacity-40' : ''}`}
      style={{ height: TRACK_HEIGHT_PX }}
      data-rowbg
      data-track-id={track.id}
    >
      {track.clips.map((clip) => (
        <ClipView
          key={clip.id}
          clip={clip}
          trackKind={track.kind}
          pxPerMs={pxPerMs}
          xfadeInMs={xfades.get(clip.id)?.inMs ?? 0}
          xfadeOutMs={xfades.get(clip.id)?.outMs ?? 0}
        />
      ))}
    </div>
  );
});
