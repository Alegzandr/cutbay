import { describe, expect, it } from 'vitest';
import {
  MAX_DB,
  MAX_GAIN,
  MIN_DB,
  UNITY_FADER,
  faderToGain,
  faderToLinePos,
  gainToFader,
  linePosToFader,
} from './gain';

const db = (gain: number) => 20 * Math.log10(gain);

describe('gain fader scale', () => {
  it('puts silence at the bottom and +12 dB at the top', () => {
    expect(faderToGain(0)).toBe(0);
    expect(gainToFader(0)).toBe(0);
    expect(db(faderToGain(1))).toBeCloseTo(MAX_DB, 5);
    expect(faderToGain(1)).toBeCloseTo(MAX_GAIN, 5);
  });

  it('places unity gain at the documented tick', () => {
    expect(UNITY_FADER).toBeCloseTo(-MIN_DB / (MAX_DB - MIN_DB), 10);
    expect(db(faderToGain(UNITY_FADER))).toBeCloseTo(0, 5);
  });

  it('round-trips a fader position through the gain', () => {
    for (const pos of [0.1, 0.25, 0.5, UNITY_FADER, 0.9, 1]) {
      // 0.1 dB quantization on the way out, so allow that much drift back.
      expect(gainToFader(faderToGain(pos))).toBeCloseTo(pos, 2);
    }
  });

  it('clamps anything below the floor to silence and above the ceiling to 1', () => {
    expect(gainToFader(10 ** ((MIN_DB - 6) / 20))).toBe(0);
    expect(gainToFader(MAX_GAIN * 4)).toBe(1);
  });

  it('rests the volume line dead centre at unity', () => {
    expect(faderToLinePos(UNITY_FADER)).toBeCloseTo(0.5, 10);
    expect(linePosToFader(0.5)).toBeCloseTo(UNITY_FADER, 10);
  });

  it('keeps the line position monotonic and anchored at both ends', () => {
    expect(faderToLinePos(0)).toBe(0);
    expect(faderToLinePos(1)).toBeCloseTo(1, 10);
    let prev = -1;
    for (let f = 0; f <= 1; f += 0.02) {
      const pos = faderToLinePos(f);
      expect(pos).toBeGreaterThan(prev);
      prev = pos;
    }
  });

  it('round-trips a line position through the fader', () => {
    for (const pos of [0, 0.13, 0.5, 0.77, 1]) {
      expect(faderToLinePos(linePosToFader(pos))).toBeCloseTo(pos, 10);
    }
  });

  it('puts attenuation below the middle and boost above it', () => {
    expect(faderToLinePos(gainToFader(0.5))).toBeLessThan(0.5);
    expect(faderToLinePos(gainToFader(2))).toBeGreaterThan(0.5);
  });

  it('quantizes to 0.1 dB so the stored gain matches the read-out', () => {
    for (const pos of [0.137, 0.481, 0.762, 0.913]) {
      const d = db(faderToGain(pos));
      expect(d * 10).toBeCloseTo(Math.round(d * 10), 6);
    }
  });
});
