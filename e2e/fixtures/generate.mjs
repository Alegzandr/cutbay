/**
 * One-shot fixture generator for the e2e suite. Run manually when a fixture
 * needs to change:
 *
 *   node e2e/fixtures/generate.mjs
 *
 * The generated files are checked in, so CI never runs this.
 *
 * - clip.mp4: 3 s of 320x180 H.264, 30 fps, no audio. Encoded in headless
 *   Chromium (Node has no WebCodecs) with mediabunny's browser bundle: a
 *   canvas animation feeds a CanvasSource whose output is muxed to MP4.
 *   Video-only on purpose - a video with audio imports as a *linked pair*
 *   (two clips), which would complicate every clip-count assertion.
 * - tone.wav: 2 s of 16-bit PCM mono at 22.05 kHz with an amplitude
 *   envelope, written directly from Node (RIFF header + samples).
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

async function generateMp4() {
  const bundle = await readFile(
    path.join(root, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.mjs'),
    'utf8',
  );
  // channel 'chromium' selects the full browser in new-headless mode; the
  // default headless shell has a WebCodecs VideoEncoder that stalls forever.
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage();
    // WebCodecs requires a secure context, which about:blank (opaque origin) is
    // not. localhost qualifies, so serve an empty page there straight from the
    // route handler - no actual server involved.
    await page.route('http://localhost/', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fixture</title>' }),
    );
    await page.goto('http://localhost/');
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    const base64 = await page.evaluate(async (bundleCode) => {
      const url = URL.createObjectURL(new Blob([bundleCode], { type: 'text/javascript' }));
      const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = await import(url);

      const width = 320;
      const height = 180;
      const fps = 30;
      const seconds = 3;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 400_000 });
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();

      const total = fps * seconds;
      for (let i = 0; i < total; i++) {
        const t = i / total;
        // A hue sweep plus a moving box and a frame counter: every frame is
        // distinct, so a split/seek bug shows up as the wrong picture.
        ctx.fillStyle = `hsl(${Math.round(t * 360)} 60% 35%)`;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        ctx.fillRect((width - 40) * t, height / 2 - 20, 40, 40);
        ctx.font = 'bold 28px monospace';
        ctx.fillText(String(i), 12, 34);
        await source.add(i / fps, 1 / fps);
      }
      source.close();
      await output.finalize();

      const bytes = new Uint8Array(output.target.buffer);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    }, bundle);
    const buffer = Buffer.from(base64, 'base64');
    await writeFile(path.join(here, 'clip.mp4'), buffer);
    console.log(`clip.mp4: ${buffer.length} bytes`);
  } finally {
    await browser.close();
  }
}

async function generateWav() {
  const sampleRate = 22050;
  const seconds = 2;
  const count = sampleRate * seconds;
  const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    // 440 Hz tone with a slow tremolo so the waveform has a visible envelope.
    const envelope = 0.4 + 0.35 * Math.sin(2 * Math.PI * 1.5 * t);
    const sample = Math.sin(2 * Math.PI * 440 * t) * envelope;
    data.writeInt16LE(Math.round(sample * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const wav = Buffer.concat([header, data]);
  await writeFile(path.join(here, 'tone.wav'), wav);
  console.log(`tone.wav: ${wav.length} bytes`);
}

await generateMp4();
await generateWav();
