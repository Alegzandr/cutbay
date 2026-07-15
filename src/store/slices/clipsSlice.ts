import type { StoreSet, StoreGet, SliceHelpers } from '../sliceHelpers';
import type { EditorState } from '../editorState';
import { Clip, ClipTransform, Track } from '../../types';
import {
  DEFAULT_TRANSFORM,
  clipDurationMs,
  clipEndMs,
  outputDimensions,
  timelineToSourceMs,
} from '../../model';
import { uid } from '../../lib/id';
import { ensureTrack, findClip, insertTrack, patchClips } from '../projectOps';
import { clamp } from '../../lib/time';
import { MIN_CLIP_DURATION_MS } from '../../app/config';
import { t as translate } from '../../i18n';

export function createClipsSlice(
  set: StoreSet,
  get: StoreGet,
  { withHistory, pruneSelection }: SliceHelpers,
): Pick<
  EditorState,
  | 'addClipFromAsset'
  | 'addClipFromAssetAt'
  | 'addTextClip'
  | 'addSolidClip'
  | 'updateClip'
  | 'updateClipCommitted'
  | 'moveClip'
  | 'moveClips'
  | 'trimClip'
  | 'splitAtPlayhead'
  | 'deleteClip'
  | 'rippleDeleteClip'
  | 'deleteClips'
  | 'duplicateClip'
  | 'punchZoomSelected'
  | 'addSubtitleClips'
  | 'applyStreamLayout'
  | 'setCropEditing'
> {
  return {
    addClipFromAsset: (assetId) => {
      const asset = get().assets[assetId];
      if (!asset) return;
      let newClipId = '';
      withHistory((p) => {
        const track = ensureTrack(p, asset.kind);
        const start = track.clips.reduce((max, c) => Math.max(max, clipEndMs(c)), 0);
        const clip: Clip = {
          kind: 'media',
          id: uid('clip'),
          assetId,
          trackId: track.id,
          timelineStartMs: start,
          sourceInMs: 0,
          sourceOutMs: asset.durationMs,
          speed: 1,
          volume: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
        };
        newClipId = clip.id;
        track.clips.push(clip);
      });
      set({ selectedClipId: newClipId, selectedClipIds: [newClipId] });
    },

    addClipFromAssetAt: (assetId, timelineMs, targetTrackId) => {
      const asset = get().assets[assetId];
      if (!asset) return;
      const newClipId = uid('clip');
      // The dropped clip keeps its position (priority) when overlaps settle.
      withHistory((p) => {
        const track = ensureTrack(p, asset.kind, targetTrackId);
        track.clips.push({
          kind: 'media',
          id: newClipId,
          assetId,
          trackId: track.id,
          timelineStartMs: Math.max(0, timelineMs),
          sourceInMs: 0,
          sourceOutMs: asset.durationMs,
          speed: 1,
          volume: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
        });
      }, newClipId);
      set({ selectedClipId: newClipId, selectedClipIds: [newClipId] });
    },

    addTextClip: () => {
      const { currentTimeMs } = get();
      const newClipId = uid('clip');
      const durMs = 3000;
      withHistory((p) => {
        const start = Math.max(0, currentTimeMs);
        // Topmost video track with the interval free - a text clip is an overlay,
        // it must not crossfade with the footage it sits on. Otherwise stack a new track.
        let track = [...p.tracks]
          .reverse()
          .find(
            (t) =>
              t.kind === 'video' &&
              t.clips.every((c) => clipEndMs(c) <= start || c.timelineStartMs >= start + durMs),
          );
        if (!track) {
          track = { id: uid('track'), kind: 'video', clips: [] };
          insertTrack(p, track);
        }
        track.clips.push({
          kind: 'text',
          id: newClipId,
          assetId: '',
          trackId: track.id,
          timelineStartMs: start,
          sourceInMs: 0,
          sourceOutMs: durMs,
          speed: 1,
          volume: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
          text: { content: translate('clip.defaultText'), color: '#ffffff', sizeFrac: 0.08, bold: true },
        });
      }, newClipId);
      set({ selectedClipId: newClipId, selectedClipIds: [newClipId] });
    },

    addSolidClip: (kind) => {
      const { currentTimeMs } = get();
      const newClipId = uid('clip');
      const durMs = 3000;
      withHistory((p) => {
        const start = Math.max(0, currentTimeMs);
        let track = [...p.tracks]
          .reverse()
          .find(
            (t) =>
              t.kind === 'video' &&
              t.clips.every((c) => clipEndMs(c) <= start || c.timelineStartMs >= start + durMs),
          );
        if (!track) {
          track = { id: uid('track'), kind: 'video', clips: [] };
          insertTrack(p, track);
        }
        track.clips.push({
          kind: 'solid',
          id: newClipId,
          assetId: '',
          trackId: track.id,
          timelineStartMs: start,
          sourceInMs: 0,
          sourceOutMs: durMs,
          speed: 1,
          volume: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
          solid:
            kind === 'color'
              ? { kind, color: '#6366f1' }
              : { kind, color: '#7c3aed', color2: '#ec4899', angle: 45 },
        });
      }, newClipId);
      set({ selectedClipId: newClipId, selectedClipIds: [newClipId] });
    },

    updateClip: (clipId, patch) =>
      set({
        // The spread preserves the clip's discriminant `kind`; the cast tells TS
        // the patched object is still a valid Clip (a Partial<Clip> spread widens).
        project: patchClips(
          get().project,
          new Map([[clipId, (c: Clip): Clip => ({ ...c, ...patch }) as Clip]]),
        ),
      }),

    updateClipCommitted: (clipId, patch) =>
      withHistory((p) => {
        const found = findClip(p, clipId);
        if (found) Object.assign(found.clip, patch);
      }),

    moveClip: (clipId, timelineStartMs, targetTrackId) => {
      const p = get().project;
      const found = findClip(p, clipId);
      if (!found) return;
      const start = Math.max(0, timelineStartMs);
      const target =
        targetTrackId && targetTrackId !== found.track.id
          ? p.tracks.find((t) => t.id === targetTrackId)
          : undefined;
      if (target && target.kind === found.track.kind) {
        const moved: Clip = { ...found.clip, timelineStartMs: start, trackId: target.id };
        const tracks = p.tracks.map((t) => {
          if (t.id === found.track.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          if (t.id === target.id) return { ...t, clips: [...t.clips, moved] };
          return t;
        });
        set({ project: { ...p, tracks } });
        return;
      }
      if (found.clip.timelineStartMs === start) return;
      set({
        project: patchClips(p, new Map([[clipId, (c: Clip) => ({ ...c, timelineStartMs: start })]])),
      });
    },

    moveClips: (entries) => {
      const edits = new Map<string, (c: Clip) => Clip>();
      for (const { clipId, timelineStartMs } of entries) {
        const start = Math.max(0, timelineStartMs);
        edits.set(clipId, (c) => (c.timelineStartMs === start ? c : { ...c, timelineStartMs: start }));
      }
      set({ project: patchClips(get().project, edits) });
    },

    trimClip: (clipId, edge, timelineMs) => {
      const assets = get().assets;
      const edit = (clip: Clip): Clip => {
        const asset = assets[clip.assetId];
        const minSourceSpan = MIN_CLIP_DURATION_MS * clip.speed;
        if (edge === 'left') {
          const proposed = Math.max(0, timelineMs);
          let sourceIn = clip.sourceInMs + (proposed - clip.timelineStartMs) * clip.speed;
          sourceIn = clamp(sourceIn, 0, clip.sourceOutMs - minSourceSpan);
          if (sourceIn === clip.sourceInMs) return clip;
          return {
            ...clip,
            timelineStartMs: clip.timelineStartMs + (sourceIn - clip.sourceInMs) / clip.speed,
            sourceInMs: sourceIn,
          };
        }
        let sourceOut = clip.sourceInMs + (timelineMs - clip.timelineStartMs) * clip.speed;
        const maxOut = asset ? asset.durationMs : Infinity;
        sourceOut = clamp(sourceOut, clip.sourceInMs + minSourceSpan, maxOut);
        if (sourceOut === clip.sourceOutMs) return clip;
        return { ...clip, sourceOutMs: sourceOut };
      };
      set({ project: patchClips(get().project, new Map([[clipId, edit]])) });
    },

    splitAtPlayhead: () => {
      const { currentTimeMs, selectedClipId, project } = get();
      // Target: the selected clip if the playhead is inside it, otherwise every clip under it.
      const collect = (onlySelected: boolean): string[] => {
        const out: string[] = [];
        for (const track of project.tracks) {
          for (const clip of track.clips) {
            const inside =
              currentTimeMs > clip.timelineStartMs + 1 && currentTimeMs < clipEndMs(clip) - 1;
            if (inside && (!onlySelected || clip.id === selectedClipId)) out.push(clip.id);
          }
        }
        return out;
      };
      let targets = selectedClipId ? collect(true) : [];
      if (targets.length === 0) targets = collect(false);
      if (targets.length === 0) return;
      withHistory((p) => {
        for (const track of p.tracks) {
          const additions: Clip[] = [];
          for (const clip of track.clips) {
            if (!targets.includes(clip.id)) continue;
            const splitSource = timelineToSourceMs(clip, currentTimeMs);
            const right: Clip = {
              ...structuredClone(clip),
              id: uid('clip'),
              timelineStartMs: currentTimeMs,
              sourceInMs: splitSource,
              fadeInMs: 0,
            };
            clip.sourceOutMs = splitSource;
            clip.fadeOutMs = 0;
            additions.push(right);
          }
          track.clips.push(...additions);
        }
      });
    },

    deleteClip: (clipId) => get().deleteClips([clipId], false),

    rippleDeleteClip: (clipId) => get().deleteClips([clipId], true),

    deleteClips: (clipIds, ripple) => {
      if (clipIds.length === 0) return;
      withHistory((p) => {
        for (const track of p.tracks) {
          // Right-to-left so each ripple shift leaves the earlier targets in place.
          const doomed = track.clips
            .filter((c) => clipIds.includes(c.id))
            .sort((a, b) => b.timelineStartMs - a.timelineStartMs);
          for (const clip of doomed) {
            const start = clip.timelineStartMs;
            const gap = clipDurationMs(clip);
            track.clips = track.clips.filter((c) => c.id !== clip.id);
            if (ripple) {
              for (const c of track.clips) {
                if (c.timelineStartMs >= start) {
                  c.timelineStartMs = Math.max(0, c.timelineStartMs - gap);
                }
              }
            }
          }
        }
      });
      pruneSelection();
    },

    duplicateClip: (clipId) => {
      let newId = '';
      withHistory((p) => {
        const found = findClip(p, clipId);
        if (!found) return;
        const copy: Clip = {
          ...structuredClone(found.clip),
          id: uid('clip'),
          timelineStartMs: clipEndMs(found.clip),
        };
        newId = copy.id;
        found.track.clips.push(copy);
      });
      if (newId) set({ selectedClipId: newId, selectedClipIds: [newId] });
    },

    punchZoomSelected: () => {
      const { selectedClipId, currentTimeMs, project } = get();
      // Fall back to the topmost video clip under the playhead, so the
      // J/K/L → S → P flow works without ever touching the mouse.
      let targetId = selectedClipId;
      if (!targetId) {
        for (const track of [...project.tracks].reverse()) {
          if (track.kind !== 'video') continue;
          const hit = track.clips.find(
            (c) => currentTimeMs >= c.timelineStartMs && currentTimeMs < clipEndMs(c),
          );
          if (hit) {
            targetId = hit.id;
            break;
          }
        }
      }
      if (!targetId) return;
      withHistory((p) => {
        const found = findClip(p, targetId!);
        if (!found) return;
        const tf = found.clip.transform ?? structuredClone(DEFAULT_TRANSFORM);
        const next = tf.scale < 1.1 ? 1.2 : tf.scale < 1.3 ? 1.4 : 1;
        found.clip.transform = { ...tf, scale: next };
      }, targetId);
      set({ selectedClipId: targetId, selectedClipIds: [targetId] });
    },

    addSubtitleClips: (cues) => {
      if (cues.length === 0) return;
      withHistory((p) => {
        // Captions always live on their own dedicated video track, composited
        // above any footage. Z-order = array order (the last video track draws
        // on top), so the caption track goes LAST, not first.
        const track: Track = { id: uid('track'), kind: 'video', clips: [] };
        p.tracks.push(track);
        for (const cue of cues) {
          track.clips.push({
            kind: 'text',
            id: uid('clip'),
            assetId: '',
            trackId: track.id,
            timelineStartMs: cue.startMs,
            sourceInMs: 0,
            sourceOutMs: Math.max(MIN_CLIP_DURATION_MS, cue.endMs - cue.startMs),
            speed: 1,
            volume: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
            // Caption defaults: outlined, slightly smaller than a title,
            // lower-third position (y 0.82).
            transform: { ...structuredClone(DEFAULT_TRANSFORM), y: 0.82 },
            text: { content: cue.text, color: '#ffffff', sizeFrac: 0.05, bold: true, outline: true },
          });
        }
      }, null);
    },

    applyStreamLayout: (clipId) => {
      const state = get();
      const found = findClip(state.project, clipId);
      const asset = found ? state.assets[found.clip.assetId] : undefined;
      if (!found || found.track.kind !== 'video' || !asset?.width || !asset?.height) return;
      const { width: outW, height: outH } = outputDimensions(state.project.aspectRatio);
      const srcW = asset.width;
      const srcH = asset.height;

      /** Transform that makes `crop` COVER a zone centered at (cx,cy), sized w×h (output px). */
      const coverZone = (
        crop: ClipTransform['crop'],
        cx: number,
        cy: number,
        w: number,
        h: number,
      ): ClipTransform => {
        const cropW = Math.max(1, crop.w * srcW);
        const cropH = Math.max(1, crop.h * srcH);
        const fit = Math.min(outW / cropW, outH / cropH);
        const scale = Math.max(w / (cropW * fit), h / (cropH * fit));
        return { crop, x: cx / outW, y: cy / outH, scale };
      };

      // Facecam: top-left corner of the source by default (adjust in crop mode).
      const camCrop = { x: 0, y: 0, w: 0.3, h: 0.35 };
      // Gameplay: centered band matching the bottom zone's aspect ratio.
      const zoneH = outH * 0.7;
      const gameW = Math.min(1, (outW / zoneH) * (srcH / srcW));
      const gameCrop = { x: (1 - gameW) / 2, y: 0, w: gameW, h: 1 };

      const camClipId = uid('clip');
      withHistory((p) => {
        const inner = findClip(p, clipId);
        if (!inner) return;
        // Gameplay stays on its track, filling the bottom zone.
        inner.clip.transform = coverZone(gameCrop, outW / 2, outH * 0.3 + zoneH / 2, outW, zoneH);
        // Facecam duplicate on a NEW track above (captions/titles keep their own).
        const camTrack: Track = { id: uid('track'), kind: 'video', clips: [] };
        const idx = p.tracks.findIndex((t) => t.id === inner.track.id);
        p.tracks.splice(idx, 0, camTrack);
        camTrack.clips.push({
          ...structuredClone(inner.clip),
          id: camClipId,
          trackId: camTrack.id,
          // The facecam layer is a picture layer: it must not add audio on top.
          volume: 0,
          transform: coverZone(camCrop, outW / 2, (outH * 0.3) / 2, outW, outH * 0.3),
        });
      }, clipId);
      set({ selectedClipId: camClipId, selectedClipIds: [camClipId], cropEditing: true });
    },

    setCropEditing: (v) => set({ cropEditing: v }),
  };
}
