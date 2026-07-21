import { describe, it, expect } from 'vitest';
import { detectSubtitleTracks } from './containerSubtitles';

/**
 * The container parser is the one piece of the embedded-subtitle path that runs
 * on every single import, before anything is downloaded - so it has to be right
 * about files it will never be handed twice. Real rips cannot live in the repo,
 * so the headers are synthesized here, byte for byte, the way a muxer writes them.
 */

/* ------------------------------------------------------------------ *
 * Matroska builders
 * ------------------------------------------------------------------ */

/** An element id, big-endian, marker bits included exactly as they are written. */
function id(value: number): number[] {
  const out: number[] = [];
  for (let n = value; n > 0; n = Math.floor(n / 256)) out.unshift(n & 0xff);
  return out;
}

/** A size, always in the 4-byte form (marker 0x10) - legal for any length. */
function size(n: number): number[] {
  return [0x10 | ((n >> 24) & 0x0f), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function el(elementId: number, payload: number[]): number[] {
  return [...id(elementId), ...size(payload.length), ...payload];
}

function str(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_SEEK = 0x4dbb;
const ID_SEEK_ID = 0x53ab;
const ID_SEEK_POSITION = 0x53ac;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_NAME = 0x536e;
const ID_LANGUAGE = 0x22b59c;
const ID_FLAG_FORCED = 0x55aa;
const ID_VOID = 0xec;

interface FakeTrack {
  type: number;
  codec: string;
  language?: string;
  name?: string;
  forced?: boolean;
}

function trackEntry(track: FakeTrack): number[] {
  return el(ID_TRACK_ENTRY, [
    ...el(ID_TRACK_TYPE, [track.type]),
    ...el(ID_CODEC_ID, str(track.codec)),
    ...(track.language ? el(ID_LANGUAGE, str(track.language)) : []),
    ...(track.name ? el(ID_NAME, str(track.name)) : []),
    ...(track.forced ? el(ID_FLAG_FORCED, [1]) : []),
  ]);
}

function mkv(tracks: FakeTrack[]): File {
  const body = el(ID_SEGMENT, el(ID_TRACKS, tracks.flatMap(trackEntry)));
  return new File([new Uint8Array([...el(ID_EBML, [0x42]), ...body])], 'episode.mkv');
}

/* ------------------------------------------------------------------ *
 * MP4 builders
 * ------------------------------------------------------------------ */

function box(type: string, payload: number[]): number[] {
  const total = 8 + payload.length;
  return [
    (total >> 24) & 0xff,
    (total >> 16) & 0xff,
    (total >> 8) & 0xff,
    total & 0xff,
    ...str(type),
    ...payload,
  ];
}

/** Three letters, each biased by 0x60, packed into 15 bits - the mdhd encoding. */
function packLanguage(code: string): number[] {
  const packed = [...code].reduce((acc, c) => (acc << 5) | (c.charCodeAt(0) - 0x60), 0);
  return [(packed >> 8) & 0xff, packed & 0xff];
}

function mp4(handler: string, format: string, language: string): File {
  const zeros = (n: number) => new Array<number>(n).fill(0);
  const mdhd = box('mdhd', [
    ...zeros(4), // version 0 + flags
    ...zeros(16), // creation, modification, timescale, duration
    ...packLanguage(language),
    ...zeros(2), // quality
  ]);
  const hdlr = box('hdlr', [...zeros(4), ...zeros(4), ...str(handler), ...zeros(12)]);
  const stsd = box('stsd', [
    ...zeros(4), // version + flags
    0,
    0,
    0,
    1, // one entry
    ...box(format, zeros(8)),
  ]);
  const trak = box(
    'trak',
    box('mdia', [...hdlr, ...mdhd, ...box('minf', box('stbl', stsd))]),
  );
  const bytes = [...box('ftyp', str('isom')), ...box('moov', trak)];
  return new File([new Uint8Array(bytes)], 'episode.mp4');
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('detectSubtitleTracks - Matroska', () => {
  it('lists subtitle tracks and skips audio and video', async () => {
    const file = mkv([
      { type: 1, codec: 'V_MPEG4/ISO/AVC' },
      { type: 2, codec: 'A_EAC3', language: 'jpn' },
      { type: 0x11, codec: 'S_TEXT/UTF8', language: 'fre', name: 'Full' },
      { type: 0x11, codec: 'S_TEXT/ASS', language: 'jpn', name: 'Signs', forced: true },
    ]);

    expect(await detectSubtitleTracks(file)).toEqual([
      { index: 0, language: 'fre', label: 'Full', codec: 'S_TEXT/UTF8' },
      { index: 1, language: 'jpn', label: 'Signs', codec: 'S_TEXT/ASS', forced: true },
    ]);
  });

  it('indexes by position among SUBTITLE tracks, which is what 0:s:<n> selects', async () => {
    const file = mkv([
      { type: 0x11, codec: 'S_TEXT/UTF8', language: 'eng' },
      { type: 2, codec: 'A_AAC' },
      { type: 0x11, codec: 'S_TEXT/UTF8', language: 'fre' },
    ]);

    // Not 0 and 2: ffmpeg counts subtitle streams among themselves.
    expect((await detectSubtitleTracks(file)).map((tr) => tr.index)).toEqual([0, 1]);
  });

  it('flags picture-based tracks so the UI never offers to extract text', async () => {
    const file = mkv([
      { type: 0x11, codec: 'S_HDMV/PGS', language: 'eng' },
      { type: 0x11, codec: 'S_VOBSUB', language: 'ger' },
    ]);

    expect((await detectSubtitleTracks(file)).map((tr) => tr.bitmap)).toEqual([true, true]);
  });

  it("drops 'und', which states the absence of a language rather than one", async () => {
    const file = mkv([{ type: 0x11, codec: 'S_TEXT/UTF8', language: 'und' }]);
    expect((await detectSubtitleTracks(file))[0]).not.toHaveProperty('language');
  });

  it('returns nothing for a file carrying no subtitles', async () => {
    const file = mkv([{ type: 1, codec: 'V_VP9' }, { type: 2, codec: 'A_OPUS' }]);
    expect(await detectSubtitleTracks(file)).toEqual([]);
  });

  it('follows the SeekHead when Tracks sits past the header we read', async () => {
    const tracks = el(ID_TRACKS, trackEntry({ type: 0x11, codec: 'S_TEXT/UTF8', language: 'spa' }));
    // Bigger than the 2 MB the detector reads, so Tracks is only reachable
    // through the SeekHead - the layout muxers use when they write Tracks last.
    const padding = el(ID_VOID, new Array<number>(3_000_000).fill(0));

    // SeekPosition is relative to the start of the Segment's payload, so the
    // SeekHead has to know its own encoded length before it can state one.
    const seekHeadFor = (position: number) =>
      el(ID_SEEK_HEAD, [
        ...el(ID_SEEK, [...el(ID_SEEK_ID, id(ID_TRACKS)), ...el(ID_SEEK_POSITION, [
          (position >> 24) & 0xff,
          (position >> 16) & 0xff,
          (position >> 8) & 0xff,
          position & 0xff,
        ])]),
      ]);
    const headLength = seekHeadFor(0).length;
    const seekHead = seekHeadFor(headLength + padding.length);

    const file = new File(
      [
        new Uint8Array([
          ...el(ID_EBML, [0x42]),
          ...el(ID_SEGMENT, [...seekHead, ...padding, ...tracks]),
        ]),
      ],
      'episode.mkv',
    );

    expect(await detectSubtitleTracks(file)).toEqual([
      { index: 0, language: 'spa', codec: 'S_TEXT/UTF8' },
    ]);
  });
});

describe('detectSubtitleTracks - MP4', () => {
  it('reads a timed-text track, its language and its sample format', async () => {
    expect(await detectSubtitleTracks(mp4('sbtl', 'tx3g', 'fre'))).toEqual([
      { index: 0, language: 'fre', codec: 'tx3g' },
    ]);
  });

  it('ignores tracks whose handler is not subtitles', async () => {
    expect(await detectSubtitleTracks(mp4('vide', 'avc1', 'eng'))).toEqual([]);
  });
});

describe('detectSubtitleTracks - unknown input', () => {
  it('treats an unreadable container as carrying nothing', async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'notes.txt');
    expect(await detectSubtitleTracks(junk)).toEqual([]);
  });

  it('survives a container truncated mid-element', async () => {
    const full = new Uint8Array(await mkv([{ type: 0x11, codec: 'S_TEXT/UTF8' }]).arrayBuffer());
    const cut = new File([full.slice(0, full.length - 6)], 'episode.mkv');
    expect(await detectSubtitleTracks(cut)).toEqual([]);
  });
});
