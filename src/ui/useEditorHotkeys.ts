import { useEffect } from 'react';
import { useStore, getSelectedClip, projectDurationMs, clipEndMs, sortedMarkers } from '../store/store';
import { zoomAtPlayhead, zoomToFit } from '../timeline/zoom';

/**
 * Jump to the previous/next edit point (clip edges, markers, region corners,
 * origin, project end) — Vegas-style.
 */
function jumpToEdge(dir: -1 | 1) {
  const s = useStore.getState();
  const points = new Set<number>([0, projectDurationMs(s.project)]);
  for (const track of s.project.tracks) {
    for (const clip of track.clips) {
      points.add(clip.timelineStartMs);
      points.add(clipEndMs(clip));
    }
  }
  for (const marker of sortedMarkers(s.project)) points.add(marker.timeMs);
  if (s.loopRegion) {
    points.add(s.loopRegion.startMs);
    points.add(s.loopRegion.endMs);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const cur = s.currentTimeMs;
  const target =
    dir === 1
      ? sorted.find((p) => p > cur + 1)
      : [...sorted].reverse().find((p) => p < cur - 1);
  if (target !== undefined) s.seek(target);
}

/** Trim the selected clip's edge to the playhead (only when the playhead is inside it). */
function trimSelectedToPlayhead(edge: 'left' | 'right') {
  const s = useStore.getState();
  const clip = getSelectedClip(s);
  if (!clip) return;
  if (s.currentTimeMs <= clip.timelineStartMs + 1 || s.currentTimeMs >= clipEndMs(clip) - 1) return;
  s.beginGesture();
  s.trimClip(clip.id, edge, s.currentTimeMs);
  s.endGesture();
}

function stepBy(ms: number) {
  const s = useStore.getState();
  s.seek(s.currentTimeMs + ms);
}

/** Move the selected clip(s) by N frames (one undo step per press). */
function nudgeSelected(frames: number) {
  const s = useStore.getState();
  if (s.selectedClipIds.length === 0) return;
  const step = (1000 / s.project.fps) * frames;
  const entries: { clipId: string; timelineStartMs: number }[] = [];
  for (const track of s.project.tracks) {
    for (const clip of track.clips) {
      if (s.selectedClipIds.includes(clip.id)) {
        entries.push({ clipId: clip.id, timelineStartMs: clip.timelineStartMs + step });
      }
    }
  }
  s.beginGesture();
  s.moveClips(entries);
  s.endGesture();
}

export function useEditorHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.code === 'Space') {
        e.preventDefault();
        s.setPlaying(!s.playing);
        return;
      }

      if (mod) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            return;
          case 'y':
            e.preventDefault();
            s.redo();
            return;
          case 'c':
            if (s.selectedClipId) {
              e.preventDefault();
              s.copyClip(s.selectedClipId);
            }
            return;
          case 'x':
            if (s.selectedClipId) {
              e.preventDefault();
              s.cutClip(s.selectedClipId);
            }
            return;
          case 'v':
            e.preventDefault();
            s.pasteAtPlayhead();
            return;
          case 'd':
            if (s.selectedClipId) {
              e.preventDefault();
              s.duplicateClip(s.selectedClipId);
            }
            return;
          case 'arrowleft':
            e.preventDefault();
            jumpToEdge(-1);
            return;
          case 'arrowright':
            e.preventDefault();
            jumpToEdge(1);
            return;
        }
        return;
      }

      // 1…9: jump to the n-th marker (Vegas-style cue keys).
      if (/^[1-9]$/.test(e.key)) {
        const marker = sortedMarkers(s.project)[Number(e.key) - 1];
        if (marker) s.seek(marker.timeMs);
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          stepBy(e.shiftKey ? -1000 : -1000 / s.project.fps);
          return;
        case 'ArrowRight':
          e.preventDefault();
          stepBy(e.shiftKey ? 1000 : 1000 / s.project.fps);
          return;
        case 'ArrowUp':
          e.preventDefault();
          zoomAtPlayhead(1.25);
          return;
        case 'ArrowDown':
          e.preventDefault();
          zoomAtPlayhead(1 / 1.25);
          return;
        case 'Home':
          e.preventDefault();
          s.seek(0);
          return;
        case 'End':
          e.preventDefault();
          s.seek(projectDurationMs(s.project));
          return;
        case '+':
        case '=':
          zoomAtPlayhead(1.25);
          return;
        case '-':
        case '_':
          zoomAtPlayhead(1 / 1.25);
          return;
        case '[':
          trimSelectedToPlayhead('left');
          return;
        case ']':
          trimSelectedToPlayhead('right');
          return;
        case '?':
          s.setShortcutsOpen(!s.shortcutsOpen);
          return;
        case 'Escape':
          if (s.shortcutsOpen) s.setShortcutsOpen(false);
          else if (s.inspectorOpen) s.setInspectorOpen(false);
          else s.selectClip(null);
          return;
        case 'Delete':
        case 'Backspace':
          s.deleteClips(s.selectedClipIds, e.shiftKey);
          return;
        case ',':
          nudgeSelected(-1);
          return;
        case '.':
          nudgeSelected(1);
          return;
      }

      switch (e.key.toLowerCase()) {
        case 's':
          s.splitAtPlayhead();
          return;
        case 't':
          s.addTextClip();
          return;
        case 'i':
          s.setRegionEdgeAtPlayhead('in');
          return;
        case 'o':
          s.setRegionEdgeAtPlayhead('out');
          return;
        case 'q':
          s.toggleLoopEnabled();
          return;
        case 'm':
          s.addMarkerAtPlayhead();
          return;
        case 'z':
          if (e.shiftKey) zoomToFit();
          return;
        case 'j':
          // Playing: halve the shuttle rate (slow review). Paused: step back 1s.
          if (s.playing) s.setPlaybackRate(s.playbackRate / 2);
          else stepBy(-1000);
          return;
        case 'k':
          if (s.playing) s.setPlaying(false);
          return;
        case 'l':
          // First press plays at 1×, repeats double the shuttle rate (up to 8×).
          if (!s.playing) s.setPlaying(true);
          else s.setPlaybackRate(s.playbackRate < 1 ? 1 : s.playbackRate * 2);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
