import { describe, it, expect } from 'vitest';
import { PRESETS, presetsForAspect, exportFileName } from './presets';
import type { Mp4Preset } from './presets';

describe('presetsForAspect', () => {
  it('returns the matching video presets plus the aspect-agnostic audio ones', () => {
    const got = presetsForAspect('16:9');
    // every returned preset is either 16:9 or aspect-agnostic (mp3)
    expect(got.every((p) => p.kind === 'mp3' || p.aspect === '16:9')).toBe(true);
    // no preset tied to a different aspect leaks through
    expect(got.some((p) => p.kind === 'mp4' && p.aspect === '9:16')).toBe(false);
    // the mp3 presets are always available
    expect(got.some((p) => p.kind === 'mp3')).toBe(true);
  });

  it('gives each aspect the same audio presets', () => {
    const audio = (aspect: '16:9' | '9:16') => presetsForAspect(aspect).filter((p) => p.kind === 'mp3').map((p) => p.id);
    expect(audio('16:9')).toEqual(audio('9:16'));
  });

  it('all presets carry translation keys and a kind', () => {
    for (const p of PRESETS) {
      expect(p.labelKey).toBeTruthy();
      expect(p.descriptionKey).toBeTruthy();
      expect(p.kind === 'mp4' || p.kind === 'mp3').toBe(true);
    }
  });
});

describe('bitrates meet the platforms’ upload recommendations', () => {
  const mp4 = (id: string): Mp4Preset => {
    const preset = PRESETS.find((p) => p.id === id);
    expect(preset, `missing preset ${id}`).toBeDefined();
    expect(preset!.kind).toBe('mp4');
    return preset as Mp4Preset;
  };

  // The project exports at 60 fps, so YouTube's 48-60 fps SDR figures are the
  // reference floor (720p 7.5, 1080p 12, 1440p 24, 4K 53-68 Mbps).
  it.each([
    ['youtube-720', 7_500_000],
    ['youtube-1080', 12_000_000],
    ['youtube-1440', 24_000_000],
    ['youtube-4k', 53_000_000],
  ])('%s meets the YouTube 60fps SDR floor', (id, floor) => {
    expect(mp4(id).videoBitrate).toBeGreaterThanOrEqual(floor);
  });

  it('every video preset ships 384 kbps AAC (YouTube AAC-LC recommendation)', () => {
    for (const p of PRESETS) {
      if (p.kind === 'mp4') expect(p.audioBitrate).toBeGreaterThanOrEqual(384_000);
    }
  });
});

describe('exportFileName', () => {
  it('uses the mp4 extension and embeds the preset id for video', () => {
    const preset = PRESETS.find((p) => p.kind === 'mp4')!;
    const name = exportFileName(preset);
    expect(name.endsWith('.mp4')).toBe(true);
    expect(name).toContain(preset.id);
  });
  it('uses the mp3 extension for audio', () => {
    const preset = PRESETS.find((p) => p.kind === 'mp3')!;
    expect(exportFileName(preset).endsWith('.mp3')).toBe(true);
  });
});
