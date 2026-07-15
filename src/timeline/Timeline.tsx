import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useStore, projectDurationMs } from '../store/store';
import { TrackRow } from './TrackRow';
import { Ruler } from './Ruler';
import { Playhead } from './Playhead';
import { MarkerBar, TimelineOverlay } from './MarkerBar';
import { msFromClientX } from './coords';
import { TIMELINE_PAD_LEFT } from '../app/config';
import { useImport } from '../ui/useImport';
import { useIsCoarsePointer } from '../lib/device';
import { useTimelineWheel } from './hooks/useTimelineWheel';
import { usePinchZoom } from './hooks/usePinchZoom';
import { useMobileScrubSync } from './hooks/useMobileScrubSync';
import { useAssetDrop } from './hooks/useAssetDrop';

export function Timeline() {
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const importing = useStore((s) => s.importing);
  const coarse = useIsCoarsePointer();
  const importFiles = useImport();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [halfW, setHalfW] = useState(0);
  const programmaticScroll = useRef(false);
  const pinching = useRef(false);
  const lastScrollLeft = useRef(0);

  const empty = project.tracks.length === 0;
  const pxPerMs = pxPerSec / 1000;
  const durationMs = projectDurationMs(project);
  // Mobile: half the viewport on both sides so t=0 and the end can sit under the
  // fixed center playhead. Desktop: fixed pad + room to drag clips past the end.
  const padLeft = coarse ? halfW : TIMELINE_PAD_LEFT;
  const contentWidth = coarse
    ? padLeft + durationMs * pxPerMs + halfW
    : TIMELINE_PAD_LEFT + (durationMs + 60_000) * pxPerMs;

  // Measure the viewport half-width (mobile centered playhead).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setHalfW(scroller.clientWidth / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [coarse, empty]);

  // Publish the pad so Ruler/ClipView/Playhead convert px<->ms consistently.
  useEffect(() => {
    useStore.getState().setTimelinePadLeft(padLeft);
  }, [padLeft]);

  useTimelineWheel(scrollerRef, coarse, empty);
  usePinchZoom(scrollerRef, coarse, pinching, empty);
  useMobileScrubSync(scrollerRef, coarse, { programmaticScroll, pinching, lastScrollLeft }, empty);
  const { onAssetDragOver, onAssetDrop } = useAssetDrop();

  if (empty) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        onDragOver={onAssetDragOver}
        onDrop={onAssetDrop}
      >
        <p className="text-sm text-zinc-500">
          {importing ? t('timeline.importing') : t('timeline.dropzone.title')}
        </p>
        <label className="cursor-pointer rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 active:bg-zinc-700">
          {t('timeline.dropzone.choose')}
          <input
            type="file"
            accept="video/*,audio/*,.srt,.vtt"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void importFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {!coarse && !importing && (
          <p className="text-xs text-zinc-600">
            {/* One sentence, one key: the <kbd> keycaps are markup inside the translation,
                so translators keep control of the word order around them. */}
            <Trans
              i18nKey="timeline.hint"
              components={{ kbd: <kbd className="font-mono text-zinc-500" /> }}
            />
          </p>
        )}
      </div>
    );
  }

  const { addTrack, selectClip } = useStore.getState();

  // Desktop: click on empty track background moves the playhead there (and scrubs while held).
  const seekToClientX = (e: React.PointerEvent) => {
    useStore.getState().seek(msFromClientX(e.currentTarget as HTMLElement, e.clientX));
  };
  const onBgPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.rowbg === undefined) return;
    selectClip(null);
    if (coarse || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekToClientX(e);
  };
  const onBgPointerMove = (e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) seekToClientX(e);
  };

  return (
    <div className="relative min-h-0 flex-1" onDragOver={onAssetDragOver} onDrop={onAssetDrop}>
      <div
        ref={scrollerRef}
        className="timeline-scroller h-full overflow-auto overscroll-none bg-zinc-950"
      >
        <div
          data-timeline-content
          className="relative min-h-full"
          style={{ width: contentWidth, minWidth: '100%' }}
        >
          <MarkerBar pxPerMs={pxPerMs} />
          <Ruler durationMs={durationMs} pxPerMs={pxPerMs} overscanMs={coarse ? 0 : 30_000} />
          <div onPointerDown={onBgPointerDown} onPointerMove={onBgPointerMove}>
            {project.tracks.map((track) => (
              <TrackRow key={track.id} track={track} pxPerMs={pxPerMs} />
            ))}
          </div>
          {/* Region shading + marker lines: after the tracks, so they paint over the clips. */}
          <TimelineOverlay pxPerMs={pxPerMs} trackCount={project.tracks.length} />

          <div className="sticky left-0 flex w-fit gap-2 p-2">
            <button
              className="rounded-md border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 active:bg-zinc-800"
              onClick={() => addTrack('video')}
            >
              <Plus className="mr-1 inline h-3 w-3" />
              {t('timeline.addVideoTrack')}
            </button>
            <button
              className="rounded-md border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 active:bg-zinc-800"
              onClick={() => addTrack('audio')}
            >
              <Plus className="mr-1 inline h-3 w-3" />
              {t('timeline.addAudioTrack')}
            </button>
          </div>

          {!coarse && <Playhead scrollerRef={scrollerRef} />}
        </div>
      </div>

      {/* Mobile: fixed playhead at the center of the viewport (the timeline scrolls under it). */}
      {coarse && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-0.5 -translate-x-1/2 bg-red-500">
          <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-red-500" />
        </div>
      )}
    </div>
  );
}
