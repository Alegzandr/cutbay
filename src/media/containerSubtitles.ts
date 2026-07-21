import type { SubtitleTrackInfo } from '../types';

/**
 * Detect the subtitle tracks embedded in a container, by reading its header.
 *
 * mediabunny demuxes video and audio but has no notion of an input subtitle
 * track, and ffmpeg cannot answer the question without pulling a 32 MB core -
 * which no import should ever pay for just to find out there is nothing to
 * offer. So the header is parsed here directly: a few hundred kilobytes off the
 * front of the file, no decoding, no dependency.
 *
 * The result is deliberately shallow. It says which tracks exist and how to name
 * them, nothing more; the cues themselves are extracted on demand, through
 * ffmpeg, only once the user asks for a specific track.
 *
 * Anything unrecognized yields an empty list: a container we cannot read is
 * indistinguishable from one carrying no subtitles, and both mean "show nothing".
 */

/** How much of the header to read. Tracks/moov sit well inside this in practice. */
const HEADER_BYTES = 2 * 1024 * 1024;

/**
 * Matroska codec ids that carry pictures rather than text. They can be shown
 * over a video but never turned into editable cues without OCR, so they are
 * listed and flagged rather than silently dropped: a user staring at a disc rip
 * deserves to know the subtitles are there and why they cannot come in.
 */
function isBitmapCodec(codecId: string): boolean {
  return /^(S_HDMV|S_VOBSUB|S_DVBSUB|S_IMAGE)/i.test(codecId);
}

export async function detectSubtitleTracks(file: File): Promise<SubtitleTrackInfo[]> {
  try {
    const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    if (isMatroska(head)) return await parseMatroska(file, head);
    if (isIsoBmff(head)) return parseIsoBmff(head);
    return [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Matroska / WebM (EBML)
 * ------------------------------------------------------------------ */

const EBML_HEADER = 0x1a45dfa3;
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
const ID_LANGUAGE_BCP47 = 0x22b59d;
const ID_FLAG_DEFAULT = 0x88;
const ID_FLAG_FORCED = 0x55aa;

/** TrackType value for a subtitle track. */
const TRACK_TYPE_SUBTITLE = 0x11;

function isMatroska(head: Uint8Array): boolean {
  return (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  );
}

interface Vint {
  /** Element id (marker bits kept) or element size (marker stripped). */
  value: number;
  /** Bytes consumed. */
  length: number;
  /** Size fields may declare "unknown", which ids never do. */
  unknown: boolean;
}

/** Number of bytes of a vint, from its leading byte. 0 means malformed. */
function vintLength(first: number): number {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
  return 0;
}

/** Read an element id: every byte kept, marker included, as ids are written. */
function readId(buf: Uint8Array, pos: number): Vint | null {
  const first = buf[pos];
  if (first === undefined) return null;
  const length = vintLength(first);
  if (length === 0 || length > 4 || pos + length > buf.length) return null;
  let value = 0;
  // Multiplication rather than shifting: a 4-byte id overflows a signed int32.
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i]!;
  return { value, length, unknown: false };
}

/** Read a size: the marker bit is stripped, all-ones means "unknown length". */
function readSize(buf: Uint8Array, pos: number): Vint | null {
  const first = buf[pos];
  if (first === undefined) return null;
  const length = vintLength(first);
  if (length === 0 || pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    const byte = buf[pos + i]!;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

interface Element {
  id: number;
  /** Offset of the payload within the buffer. */
  start: number;
  /** Payload length, or -1 when the element declared an unknown size. */
  size: number;
  /** Offset just past the element, for the walk to continue from. */
  next: number;
}

/** Read the element starting at `pos`, or null if the buffer runs out. */
function readElement(buf: Uint8Array, pos: number): Element | null {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readSize(buf, pos + id.length);
  if (!size) return null;
  const start = pos + id.length + size.length;
  return {
    id: id.value,
    start,
    size: size.unknown ? -1 : size.value,
    next: size.unknown ? start : start + size.value,
  };
}

/** Iterate the direct children of a payload range, stopping at the first tear. */
function* children(buf: Uint8Array, start: number, end: number): Generator<Element> {
  let pos = start;
  while (pos < end) {
    const el = readElement(buf, pos);
    // A truncated tail is normal: the buffer is only the head of the file.
    if (!el || el.size < 0 || el.next > end) return;
    yield el;
    pos = el.next;
  }
}

function readUint(buf: Uint8Array, el: Element): number {
  let value = 0;
  for (let i = 0; i < el.size; i++) value = value * 256 + buf[el.start + i]!;
  return value;
}

function readString(buf: Uint8Array, el: Element): string {
  const text = new TextDecoder().decode(buf.subarray(el.start, el.start + el.size));
  // EBML pads strings with NULs, so the first one ends the value.
  const end = text.indexOf(String.fromCharCode(0));
  return end === -1 ? text : text.slice(0, end);
}

/**
 * Locate the Tracks element, following the SeekHead when it is not among the
 * children already in the buffer.
 *
 * Most muxers write Tracks right after Info, well inside the head we read. Some
 * put it after the clusters, which is exactly what SeekHead exists to survive:
 * its positions are relative to the start of the Segment's payload.
 */
async function findTracks(
  file: File,
  head: Uint8Array,
  segment: Element,
): Promise<{ buf: Uint8Array; el: Element } | null> {
  let seekPosition: number | null = null;
  const end = segment.size < 0 ? head.length : Math.min(head.length, segment.next);

  for (const el of children(head, segment.start, end)) {
    if (el.id === ID_TRACKS) return { buf: head, el };
    if (el.id !== ID_SEEK_HEAD) continue;
    for (const seek of children(head, el.start, el.start + el.size)) {
      if (seek.id !== ID_SEEK) continue;
      let isTracks = false;
      let position: number | null = null;
      for (const field of children(head, seek.start, seek.start + seek.size)) {
        if (field.id === ID_SEEK_ID) isTracks = readUint(head, field) === ID_TRACKS;
        else if (field.id === ID_SEEK_POSITION) position = readUint(head, field);
      }
      if (isTracks && position !== null) seekPosition = position;
    }
  }

  if (seekPosition === null) return null;
  // SeekPosition is relative to the Segment payload, and points at the element
  // header itself - so the slice starts on an id, exactly like a walk would.
  const absolute = segment.start + seekPosition;
  if (absolute >= file.size) return null;
  const buf = new Uint8Array(
    await file.slice(absolute, Math.min(file.size, absolute + HEADER_BYTES)).arrayBuffer(),
  );
  const el = readElement(buf, 0);
  return el && el.id === ID_TRACKS && el.size >= 0 ? { buf, el } : null;
}

async function parseMatroska(file: File, head: Uint8Array): Promise<SubtitleTrackInfo[]> {
  // The layout is fixed: the EBML header, then the Segment. Both are read by
  // hand rather than walked, because the Segment is the one element that
  // legitimately declares an unknown size (a file still being written) and a
  // generic walk has to stop on those.
  const header = readElement(head, 0);
  if (!header || header.id !== EBML_HEADER || header.size < 0) return [];
  const segment = readElement(head, header.next);
  if (!segment || segment.id !== ID_SEGMENT) return [];

  const found = await findTracks(file, head, segment);
  if (!found) return [];
  const { buf, el: tracks } = found;

  const out: SubtitleTrackInfo[] = [];
  for (const entry of children(buf, tracks.start, tracks.start + tracks.size)) {
    if (entry.id !== ID_TRACK_ENTRY) continue;
    let type = -1;
    let codecId = '';
    let language: string | undefined;
    let bcp47: string | undefined;
    let label: string | undefined;
    let isDefault = false;
    let forced = false;
    for (const field of children(buf, entry.start, entry.start + entry.size)) {
      switch (field.id) {
        case ID_TRACK_TYPE:
          type = readUint(buf, field);
          break;
        case ID_CODEC_ID:
          codecId = readString(buf, field);
          break;
        case ID_LANGUAGE:
          language = readString(buf, field);
          break;
        case ID_LANGUAGE_BCP47:
          bcp47 = readString(buf, field);
          break;
        case ID_NAME:
          label = readString(buf, field);
          break;
        case ID_FLAG_DEFAULT:
          isDefault = readUint(buf, field) === 1;
          break;
        case ID_FLAG_FORCED:
          forced = readUint(buf, field) === 1;
          break;
      }
    }
    if (type !== TRACK_TYPE_SUBTITLE) continue;
    // BCP-47 wins when present: it is the more precise of the two, and 'und' is
    // Matroska's default for "unstated", not a language.
    const code = bcp47 || language;
    out.push({
      // Position among subtitle tracks in file order, which is what ffmpeg's
      // `0:s:<n>` selects. Deliberately NOT the Matroska track number.
      index: out.length,
      ...(code && code !== 'und' ? { language: code } : {}),
      ...(label ? { label } : {}),
      ...(codecId ? { codec: codecId } : {}),
      ...(isBitmapCodec(codecId) ? { bitmap: true as const } : {}),
      ...(isDefault ? { default: true as const } : {}),
      ...(forced ? { forced: true as const } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * MP4 / MOV (ISO base media)
 * ------------------------------------------------------------------ */

/** Handler types that mark a track as subtitles or timed text. */
const SUBTITLE_HANDLERS = new Set(['sbtl', 'text', 'subp', 'clcp']);

/** Sample entry formats that are pictures, not text. */
const BITMAP_FORMATS = new Set(['mp4s', 'subp', 'c608']);

function fourcc(buf: Uint8Array, pos: number): string {
  return String.fromCharCode(buf[pos]!, buf[pos + 1]!, buf[pos + 2]!, buf[pos + 3]!);
}

function isIsoBmff(head: Uint8Array): boolean {
  return head.length >= 12 && fourcc(head, 4) === 'ftyp';
}

interface Box {
  type: string;
  start: number;
  end: number;
  next: number;
}

/** Iterate the boxes in a range. Stops at the first malformed or truncated one. */
function* boxes(buf: Uint8Array, start: number, end: number): Generator<Box> {
  let pos = start;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = fourcc(buf, pos + 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      // 64-bit size. Anything past 2^53 is not a real box in a real file.
      size = Number(view.getBigUint64(pos + 8));
      header = 16;
    } else if (size === 0) {
      // "To the end of the container", per the spec.
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type, start: pos + header, end: pos + size, next: pos + size };
    pos += size;
  }
}

function findBox(buf: Uint8Array, start: number, end: number, type: string): Box | null {
  for (const box of boxes(buf, start, end)) if (box.type === type) return box;
  return null;
}

/**
 * Unpack an mdhd language: three 5-bit values, each an ASCII letter biased by
 * 0x60, spelling an ISO 639-2/T code.
 */
function unpackLanguage(packed: number): string | undefined {
  const code = [10, 5, 0]
    .map((shift) => String.fromCharCode(((packed >> shift) & 0x1f) + 0x60))
    .join('');
  return /^[a-z]{3}$/.test(code) && code !== 'und' ? code : undefined;
}

function parseIsoBmff(head: Uint8Array): SubtitleTrackInfo[] {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const moov = findBox(head, 0, head.length, 'moov');
  if (!moov) return [];

  const out: SubtitleTrackInfo[] = [];
  for (const trak of boxes(head, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = findBox(head, trak.start, trak.end, 'mdia');
    if (!mdia) continue;
    const hdlr = findBox(head, mdia.start, mdia.end, 'hdlr');
    // hdlr payload: version+flags (4), predefined (4), then the handler type.
    if (!hdlr || hdlr.start + 12 > hdlr.end) continue;
    if (!SUBTITLE_HANDLERS.has(fourcc(head, hdlr.start + 8))) continue;

    let language: string | undefined;
    const mdhd = findBox(head, mdia.start, mdia.end, 'mdhd');
    if (mdhd && mdhd.start + 4 <= mdhd.end) {
      // Everything before the language field is fixed-width, and only its size
      // differs between versions: 4+4+4+4 (v0) or 8+8+4+8 (v1) after the flags.
      const offset = mdhd.start + 4 + (view.getUint8(mdhd.start) === 1 ? 28 : 16);
      if (offset + 2 <= mdhd.end) language = unpackLanguage(view.getUint16(offset));
    }

    // The sample entry names the format: minf > stbl > stsd > first entry.
    let codec: string | undefined;
    const minf = findBox(head, mdia.start, mdia.end, 'minf');
    const stbl = minf && findBox(head, minf.start, minf.end, 'stbl');
    const stsd = stbl && findBox(head, stbl.start, stbl.end, 'stsd');
    // stsd payload: version+flags (4), entry count (4), then the sample entries,
    // each of which opens with its own size (4) and format (4).
    if (stsd && stsd.start + 16 <= stsd.end) codec = fourcc(head, stsd.start + 12);

    out.push({
      index: out.length,
      ...(language ? { language } : {}),
      ...(codec ? { codec } : {}),
      ...(codec && BITMAP_FORMATS.has(codec) ? { bitmap: true as const } : {}),
    });
  }
  return out;
}
