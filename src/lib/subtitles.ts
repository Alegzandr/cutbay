/** A parsed subtitle cue, timeline-ready. */
export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export function isSubtitleFile(file: File): boolean {
  return /\.(srt|vtt)$/i.test(file.name);
}

/** "01:02:03,450", "02:03.450" or "03,450" → milliseconds. */
function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d+):(\d+)[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h = '0', min, s, frac] = m;
  return (
    Number(h) * 3_600_000 +
    Number(min) * 60_000 +
    Number(s) * 1000 +
    Number(frac.padEnd(3, '0'))
  );
}

/** Strip inline markup: HTML-ish tags (<i>, <font …>) and VTT voice spans. */
function cleanText(lines: string[]): string {
  return lines
    .map((l) => l.replace(/<[^>]+>/g, '').replace(/\{\\an\d\}/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Parse SRT or WebVTT content into cues. Tolerant: skips numeric counters,
 * the WEBVTT header, NOTE/STYLE blocks and any block without a valid
 * "start --> end" line. Returns cues sorted by start time.
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const [rawStart, rawEnd] = lines[timingIdx].split('-->');
    // VTT allows settings after the end time ("00:02.000 line:0 align:start").
    const startMs = parseTimestamp(rawStart);
    const endMs = parseTimestamp((rawEnd ?? '').trim().split(/\s+/)[0] ?? '');
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    const text = cleanText(lines.slice(timingIdx + 1));
    if (!text) continue;
    cues.push({ startMs, endMs, text });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}
