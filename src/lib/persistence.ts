import { AudioTrackInfo, MediaAsset, Project, isTrackPlayable } from '../types';
import { useStore } from '../store/store';
import { ensureAssetVisuals } from '../media/probe';
import { setTranscodedAudio } from '../media/mediaCache';
// Static, despite only being needed after a restore: both modules are already
// in the main chunk through the store, so importing them lazily would split
// nothing and only cost a round trip. The 32 MB core is NOT pulled in by this -
// the ffmpeg runtime imports it dynamically, on first job.
import { decodeCachedAudio } from '../media/transcodeAudio';
import { isMissingSource } from './missingSource';
import { t } from '../i18n';

// Surface a save failure once per session: repeated debounced saves must not
// spam the toast, but the user has to know their work is not being persisted
// (storage full, or IndexedDB blocked in private mode).
let saveErrorShown = false;
function reportSaveFailure(err: unknown): void {
  console.warn('[persistence] save failed:', err);
  if (saveErrorShown) return;
  saveErrorShown = true;
  useStore.getState().setError(t('errors.persistence.saveFailed'));
}

/**
 * Project persistence in IndexedDB. The project structure and every imported
 * media file (File blobs are structured-cloneable) are saved locally, so a
 * refresh or a closed tab never loses work. Saves are incremental: the
 * project JSON is debounced, assets are written/deleted one by one as the
 * library changes.
 */

const DB_NAME = 'selfcut';
const DB_VERSION = 2;
const PROJECT_STORE = 'project';
const ASSETS_STORE = 'assets';
/** Compressed copies of transcoded audio tracks, keyed `${assetId}#${trackIndex}`. */
const AUDIO_STORE = 'transcodedAudio';
const PROJECT_KEY = 'current';
const SAVE_DEBOUNCE_MS = 500;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(PROJECT_STORE)) d.createObjectStore(PROJECT_STORE);
      if (!d.objectStoreNames.contains(ASSETS_STORE)) {
        d.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(AUDIO_STORE)) d.createObjectStore(AUDIO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function audioCacheKey(assetId: string, audioTrackIndex: number): string {
  return `${assetId}#${audioTrackIndex}`;
}

/**
 * Keep the compressed copy of a transcoded track, so reopening the project does
 * not re-run a conversion that takes minutes.
 *
 * A failure here is deliberately swallowed rather than surfaced: the transcode
 * itself succeeded and the track is audible for this session. All that is lost
 * is the shortcut next time, which is not worth a toast over a full disk.
 */
export async function saveTranscodedAudio(
  assetId: string,
  audioTrackIndex: number,
  bytes: Uint8Array,
): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).put(bytes, audioCacheKey(assetId, audioTrackIndex));
    await txDone(tx);
  } catch (err) {
    console.warn('[persistence] transcoded audio not cached:', err);
  }
}

/** The cached copy of a transcoded track, or null if there is none. */
export async function loadTranscodedAudio(
  assetId: string,
  audioTrackIndex: number,
): Promise<Uint8Array | null> {
  try {
    const d = await db();
    const tx = d.transaction(AUDIO_STORE, 'readonly');
    const bytes = await requestDone(
      tx.objectStore(AUDIO_STORE).get(audioCacheKey(assetId, audioTrackIndex)),
    );
    return bytes instanceof Uint8Array ? bytes : null;
  } catch {
    return null;
  }
}

/** Drop every cached track of an asset, when the asset itself goes away. */
async function dropTranscodedAudio(assetId: string): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    // Keys are `${assetId}#${index}`: bound the range on the prefix rather than
    // walk every entry in the store.
    // U+FFFF sorts above any real key suffix. Written as an escape, not as the
    // character itself: a literal non-character in source survives editors and
    // encoding round-trips far less reliably than it reads.
    const range = IDBKeyRange.bound(`${assetId}#`, `${assetId}#\uffff`);
    for (const key of await requestDone(store.getAllKeys(range))) store.delete(key);
    await txDone(tx);
  } catch (err) {
    console.warn('[persistence] transcoded audio not cleared:', err);
  }
}

function requestDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Resolve when a write transaction actually commits. Firing put/delete and
 * returning is not enough: the write can still fail at commit time (quota
 * exceeded, disk full), and only the transaction's own events report it - so a
 * silent data-loss would otherwise go unnoticed.
 */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Guards against a stale or corrupted database (older schema, interrupted
// write): a project that fails the check is discarded instead of crashing
// hydration, and invalid assets are dropped individually.
export function isValidProject(p: unknown): p is Project {
  if (typeof p !== 'object' || p === null) return false;
  const proj = p as Project;
  return (
    typeof proj.id === 'string' &&
    typeof proj.fps === 'number' &&
    // Absent on projects saved before markers existed - hydrate() defaults it.
    (proj.markers === undefined || Array.isArray(proj.markers)) &&
    Array.isArray(proj.tracks) &&
    proj.tracks.every(
      (tr) => typeof tr?.id === 'string' && Array.isArray(tr.clips) && tr.clips.every((c) => typeof c?.id === 'string'),
    )
  );
}

function isValidAsset(a: unknown): a is MediaAsset {
  if (typeof a !== 'object' || a === null) return false;
  const asset = a as MediaAsset;
  return (
    typeof asset.id === 'string' &&
    asset.file instanceof File &&
    typeof asset.durationMs === 'number' &&
    Array.isArray(asset.thumbnails)
  );
}

/**
 * A persisted File is only a reference to the on-disk file. Between sessions
 * that file can be moved, renamed or deleted, and any read then throws. Probe
 * a single byte so we can flag the asset up front instead of letting every
 * decode fail silently and leave the preview black.
 */
async function isFileReadable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * `transcoded` marks an undecodable track whose PCM sits in the in-memory cache.
 * That cache dies with the tab, so a restored asset must forget the flag:
 * keeping it would claim the track is audible and export it as silence.
 *
 * The flag is re-earned, not assumed: `restoreTranscodedTracks` puts it back
 * only for the tracks whose compressed copy is still in the database AND still
 * decodes. Between the two, a track whose cache is gone degrades to what it did
 * before the cache existed - peaks intact, one transcode to re-run.
 */
function dropTranscodedFlags(asset: MediaAsset): MediaAsset {
  if (!asset.audioTracks.some((track) => track.transcoded)) return asset;
  const audioTracks = asset.audioTracks.map(({ transcoded: _dropped, ...track }) => track);
  return { ...asset, audioTracks, hasAudio: audioTracks.some(isTrackPlayable) };
}

/**
 * Bring an asset stored before multi-track audio up to the current shape: a
 * legacy asset has `hasAudio` + a single top-level `peaks` array but no
 * `audioTracks`, so synthesize a one-entry list (the old primary track) that
 * carries those peaks. Assets already on the new shape pass through untouched.
 */
function migrateAsset(asset: MediaAsset): MediaAsset {
  if (Array.isArray(asset.audioTracks)) return dropTranscodedFlags(asset);
  const legacy = asset as MediaAsset & { peaks?: number[] };
  const audioTracks: AudioTrackInfo[] = legacy.hasAudio
    ? [{ index: 0, channels: 2, ...(legacy.peaks ? { peaks: legacy.peaks } : {}) }]
    : [];
  const { peaks: _dropped, ...rest } = legacy;
  return { ...rest, audioTracks };
}

async function loadPersisted(): Promise<{ project: Project; assets: MediaAsset[] } | null> {
  const d = await db();
  const tx = d.transaction([PROJECT_STORE, ASSETS_STORE], 'readonly');
  const project = await requestDone(tx.objectStore(PROJECT_STORE).get(PROJECT_KEY));
  if (!isValidProject(project)) return null;
  const stored = (await requestDone(tx.objectStore(ASSETS_STORE).getAll()))
    .filter(isValidAsset)
    .map(migrateAsset);
  // Flag every asset whose source file no longer reads (disconnected source).
  // An asset that came from a `.selfcut` file and has not been relinked yet
  // carries a placeholder instead of a real File: it reads fine (it is an empty
  // Blob) but holds no media, so it has to be recognized on its own.
  const assets = await Promise.all(
    stored.map(async (asset) => ({
      ...asset,
      disconnected: isMissingSource(asset.file) || !(await isFileReadable(asset.file)),
    })),
  );
  return { project, assets };
}

/**
 * Republish every transcoded track whose compressed copy survived, so a
 * reopened project is audible without re-running conversions that take minutes.
 *
 * Runs after hydrate rather than inside it: decoding is asynchronous and the
 * editor must not wait on it to appear. Tracks light up as they land, in the
 * same way a background thumbnail pass fills the strip.
 */
async function restoreTranscodedTracks(assets: MediaAsset[]): Promise<void> {
  await Promise.all(
    assets.flatMap((asset) =>
      // Only an undecodable track can have been transcoded; a disconnected
      // asset has no source to fall back on either way, but its cached audio is
      // still perfectly good, so it is deliberately not skipped here.
      asset.audioTracks
        .filter((track) => track.undecodable)
        .map(async (track) => {
          const bytes = await loadTranscodedAudio(asset.id, track.index);
          if (!bytes) return;
          const buffer = await decodeCachedAudio(bytes);
          if (!buffer) return;

          // The library can have changed while this decoded: an asset the user
          // removed in the meantime must not come back audible.
          const current = useStore.getState().assets[asset.id];
          if (!current || current.file !== asset.file) return;

          const peaks = setTranscodedAudio(asset.id, track.index, buffer, {
            alsoPrimary: current.audioTracks.length === 1,
          });
          const audioTracks = current.audioTracks.map((tr) =>
            tr.index === track.index ? { ...tr, transcoded: true, peaks } : tr,
          );
          useStore.setState({
            assets: {
              ...useStore.getState().assets,
              [asset.id]: { ...current, audioTracks, hasAudio: true },
            },
          });
        }),
    ),
  );
}

let saveTimer: number | null = null;

function scheduleProjectSave(project: Project): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void writeProject(project);
  }, SAVE_DEBOUNCE_MS);
}

async function writeProject(project: Project): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).put(project, PROJECT_KEY);
    await txDone(tx);
  } catch (err) {
    reportSaveFailure(err);
  }
}

async function syncAssets(
  next: Record<string, MediaAsset>,
  prev: Record<string, MediaAsset>,
): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(ASSETS_STORE, 'readwrite');
    const store = tx.objectStore(ASSETS_STORE);
    for (const [id, asset] of Object.entries(next)) {
      if (prev[id] !== asset) store.put(asset);
    }
    for (const id of Object.keys(prev)) {
      if (!(id in next)) {
        store.delete(id);
        // The cached audio is worthless without the asset it belongs to, and it
        // is the largest thing this database holds after the media itself.
        void dropTranscodedAudio(id);
      }
    }
    await txDone(tx);
  } catch (err) {
    reportSaveFailure(err);
  }
}

let started = false;

/**
 * Restore the last session (if the editor is still pristine), then keep
 * IndexedDB in sync with the store. Call once at startup.
 */
export async function initPersistence(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const saved = await loadPersisted();
    const s = useStore.getState();
    const pristine =
      s.project.tracks.length === 0 && Object.keys(s.assets).length === 0 && s.past.length === 0;
    if (saved && pristine && (saved.project.tracks.length > 0 || saved.assets.length > 0)) {
      s.hydrate(saved.project, saved.assets);
      // Recompute anything saved before it finished (peaks, thumbnail strip).
      // Skip disconnected assets: their file cannot be read, so decoding would
      // only throw - they wait for the user to reconnect the source.
      for (const asset of saved.assets) if (!asset.disconnected) ensureAssetVisuals(asset, s);
      // Not awaited: the editor is usable now, and transcoded tracks light up
      // as their cached audio decodes.
      void restoreTranscodedTracks(saved.assets);
    }
  } catch (err) {
    console.warn('[persistence] restore failed:', err);
  }

  useStore.subscribe((s, prev) => {
    if (s.project !== prev.project) scheduleProjectSave(s.project);
    if (s.assets !== prev.assets) void syncAssets(s.assets, prev.assets);
  });

  // Flush the pending debounced save when the page goes away.
  window.addEventListener('pagehide', () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
      void writeProject(useStore.getState().project);
    }
  });
}
