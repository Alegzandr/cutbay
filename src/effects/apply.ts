import type { Clip, MediaAsset, Project } from '../types';
import { EFFECTS_BY_ID } from './catalog';

/**
 * The clip an audio effect should really land on. A linked video clip delegates
 * its sound to the audio clip on the lane below (it is silent in the mix), so
 * an effect dropped on the picture half has to follow the link or it would sit
 * on a muted node and do nothing audible. Mirrors the inspector's `audioClip`.
 */
export function audioTarget(p: Project, clip: Clip): Clip {
  if (!clip.linkId) return clip;
  for (const track of p.tracks) {
    if (track.kind !== 'audio') continue;
    const partner = track.clips.find((c) => c.linkId === clip.linkId && c.id !== clip.id);
    if (partner) return partner;
  }
  return clip;
}

/**
 * Which clips a preset would actually change, given a selection: the audio
 * redirect resolved and the clips the preset rejects dropped. Shared by the
 * store action and the library UI, so a tile is enabled exactly when applying
 * it would do something.
 */
export function resolveEffectTargets(
  p: Project,
  assets: Record<string, MediaAsset>,
  effectId: string,
  clipIds: string[],
): string[] {
  const preset = EFFECTS_BY_ID[effectId];
  if (!preset) return [];
  const seen = new Set<string>();
  for (const clipId of clipIds) {
    const source = p.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!source) continue;
    const clip = preset.group === 'audio' ? audioTarget(p, source) : source;
    if (preset.accepts(clip, assets[clip.assetId])) seen.add(clip.id);
  }
  return [...seen];
}
