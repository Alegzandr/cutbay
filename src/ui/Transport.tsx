import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag,
  Keyboard,
  Magnet,
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  StretchHorizontal,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useStore, projectDurationMs } from '../store/store';
import { formatTime, formatTimecodeParts } from '../lib/time';
import { useIsCoarsePointer } from '../lib/device';
import { zoomAtPlayhead, zoomToFit } from '../timeline/zoom';

/**
 * Timecode updated 60×/sec during playback - written straight to the DOM from
 * a store subscription instead of re-rendering through React every frame.
 */
function TimeReadout() {
  const { t } = useTranslation();
  const currentRef = useRef<HTMLSpanElement>(null);
  const framesRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const apply = () => {
      const s = useStore.getState();
      const cur = formatTimecodeParts(s.currentTimeMs, s.project.fps);
      const total = formatTimecodeParts(projectDurationMs(s.project), s.project.fps);
      if (currentRef.current) currentRef.current.textContent = cur.main;
      if (framesRef.current) framesRef.current.textContent = `.${cur.frames}`;
      if (totalRef.current) totalRef.current.textContent = total.main;
    };
    apply();
    return useStore.subscribe((s, prev) => {
      if (s.currentTimeMs !== prev.currentTimeMs || s.project !== prev.project) apply();
    });
  }, []);

  return (
    <span
      className="min-w-[118px] text-center font-mono text-xs tabular-nums text-zinc-400"
      title={t('transport.timecode')}
    >
      <span ref={currentRef} className="text-zinc-100" />
      <span ref={framesRef} className="text-[10px] text-zinc-500" /> / <span ref={totalRef} />
    </span>
  );
}

export function Transport() {
  const { t } = useTranslation();
  const playing = useStore((s) => s.playing);
  const playbackRate = useStore((s) => s.playbackRate);
  const hasSelection = useStore((s) => s.selectedClipIds.length > 0);
  const region = useStore((s) => s.loopRegion);
  const loopEnabled = useStore((s) => s.loopEnabled);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const coarse = useIsCoarsePointer();
  const {
    setPlaying,
    seek,
    splitAtPlayhead,
    deleteClips,
    setShortcutsOpen,
    toggleLoopEnabled,
    toggleSnap,
    addMarkerAtPlayhead,
    setLoopRegion,
  } = useStore.getState();

  return (
    <div className="flex h-11 flex-none items-center justify-center gap-1 border-y border-zinc-800 bg-zinc-900 px-2">
      <button
        className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
        onClick={() => seek(0)}
        title={t('transport.backToStart')}
      >
        <SkipBack className="h-4 w-4" />
      </button>
      <button
        className="relative rounded-full bg-zinc-100 p-2.5 text-zinc-950 active:bg-white"
        onClick={() => setPlaying(!playing)}
        title={playing ? t('transport.pause') : t('transport.play')}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
        {/* Shuttle badge: visible while J/L drive playback at a non-1× rate. */}
        {playing && playbackRate !== 1 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-sky-500 px-1 text-[9px] font-bold leading-4 text-white">
            {playbackRate < 1 ? playbackRate.toFixed(2).replace(/0$/, '') : playbackRate}×
          </span>
        )}
      </button>
      <TimeReadout />

      <div className="mx-1 h-5 w-px bg-zinc-800" />

      <button
        className={`rounded-lg p-2 ${loopEnabled ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-400'} active:bg-zinc-800`}
        onClick={toggleLoopEnabled}
        title={t('transport.loop')}
      >
        <Repeat className="h-4 w-4" />
      </button>
      <button
        className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
        onClick={addMarkerAtPlayhead}
        title={t('transport.addMarker')}
      >
        <Flag className="h-4 w-4" />
      </button>

      {/* Selection readout: clicking it clears the region (like clicking the empty bar). */}
      {region && (
        <button
          className="rounded-lg px-2 py-1 font-mono text-[11px] tabular-nums text-amber-300 active:bg-zinc-800"
          onClick={() => setLoopRegion(null)}
          title={t('transport.region.clear')}
        >
          {formatTime(region.startMs)} → {formatTime(region.endMs)}
        </button>
      )}

      {/* Touch devices: split/delete live in the clip action bar, zoom is pinch. */}
      {!coarse && (
        <>
          <div className="mx-1 h-5 w-px bg-zinc-800" />

          <button
            className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
            onClick={() => splitAtPlayhead()}
            title={t('transport.split')}
          >
            <Scissors className="h-4 w-4" />
          </button>
          <button
            className="rounded-lg p-2 text-zinc-400 enabled:active:bg-zinc-800 disabled:opacity-30"
            disabled={!hasSelection}
            onClick={() => deleteClips(useStore.getState().selectedClipIds, false)}
            title={t('transport.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            className={`rounded-lg p-2 ${snapEnabled ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-500'} active:bg-zinc-800`}
            onClick={toggleSnap}
            title={snapEnabled ? t('transport.snapping.on') : t('transport.snapping.off')}
          >
            <Magnet className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-zinc-800" />

          <button
            className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
            onClick={() => zoomAtPlayhead(1 / 1.4)}
            title={t('transport.zoomOut')}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
            onClick={() => zoomAtPlayhead(1.4)}
            title={t('transport.zoomIn')}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
            onClick={() => zoomToFit()}
            title={t('transport.zoomFit')}
          >
            <StretchHorizontal className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-zinc-800" />

          <button
            className="rounded-lg p-2 text-zinc-400 active:bg-zinc-800"
            onClick={() => setShortcutsOpen(true)}
            title={t('transport.shortcuts')}
          >
            <Keyboard className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
