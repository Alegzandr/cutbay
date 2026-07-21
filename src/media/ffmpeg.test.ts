import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchToBlobURL } from './ffmpeg';

/**
 * Regression guard on the core download.
 *
 * @ffmpeg/util's toBlobURL, which this replaced, threw whenever Content-Length
 * disagreed with the bytes it read - so any host that compresses the 32 MB core
 * (GitHub Pages does) made ffmpeg fail to load, every time, with the download
 * progress reporting as the only clue. The header is a hint for the bar and
 * nothing more; the download must survive it being wrong in either direction.
 */

function respondWith(chunks: Uint8Array[], headers: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

const chunk = (n: number, fill: number) => new Uint8Array(n).fill(fill);

function stubFetch(resp: Response): void {
  vi.stubGlobal('fetch', vi.fn(async () => resp));
  const urls = new Map<string, Blob>();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (b: Blob) => {
      const u = `blob:test/${urls.size}`;
      urls.set(u, b);
      return u;
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchToBlobURL', () => {
  it('keeps every byte when Content-Length undercounts them (compressed response)', async () => {
    // What a gzipping host sends: the header measures the wire, the reader
    // yields the decoded stream, and the two are not meant to match.
    stubFetch(respondWith([chunk(4000, 1), chunk(4000, 2)], { 'Content-Length': '900' }));
    const seen: Array<[number, number]> = [];

    const url = await fetchToBlobURL('/ffmpeg/core.js', 'text/javascript', (received, total) =>
      seen.push([received, total]),
    );

    expect(url).toMatch(/^blob:/);
    // The bar is told the truth about the header being useless, and the caller
    // still gets the whole file.
    expect(seen.at(-1)).toEqual([8000, 900]);
  });

  it('reports measurable progress when the header is honest', async () => {
    stubFetch(respondWith([chunk(500, 1), chunk(500, 2)], { 'Content-Length': '1000' }));
    const seen: Array<[number, number]> = [];

    await fetchToBlobURL('/ffmpeg/core.js', 'text/javascript', (received, total) =>
      seen.push([received, total]),
    );

    expect(seen).toEqual([
      [500, 1000],
      [1000, 1000],
    ]);
  });

  it('reports an unknown total rather than zero when there is no header', async () => {
    stubFetch(respondWith([chunk(300, 1)], {}));
    const seen: Array<[number, number]> = [];

    await fetchToBlobURL('/ffmpeg/core.wasm', 'application/wasm', (received, total) =>
      seen.push([received, total]),
    );

    expect(seen).toEqual([[300, 0]]);
  });

  it('fails loudly on an HTTP error instead of blob-wrapping the error page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));

    await expect(
      fetchToBlobURL('/ffmpeg/core.js', 'text/javascript', () => {}),
    ).rejects.toThrow('HTTP 404');
  });
});
