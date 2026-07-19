import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { MediaAsset } from '../types';

/**
 * History covers the media library, not just the timeline: undoing an import
 * has to take the library card back out with the track it created.
 * Store bootstrapped like proInteractions.test.ts (node env, stubbed document).
 */

let useStore: typeof import('./store').useStore;

beforeAll(async () => {
  const g = globalThis as { document?: unknown };
  g.document ??= { documentElement: {} };
  ({ useStore } = await import('./store'));
});

function videoAsset(id: string): MediaAsset {
  return {
    id,
    file: new File([], `${id}.mp4`),
    kind: 'video',
    durationMs: 5000,
    width: 1920,
    height: 1080,
    hasAudio: true,
    audioTracks: [{ index: 0, channels: 2 }],
    thumbnails: [],
  };
}

const s = () => useStore.getState();

/** What `useImport` does per file: one asset + its clips, as one undo step. */
function importAsset(id: string) {
  s().beginGesture();
  s().addAsset(videoAsset(id));
  s().addClipFromAsset(id);
  s().endGesture();
}

beforeEach(() => {
  s().resetProject();
});

describe('undo of an import', () => {
  it('removes the tracks AND the library entry in one step', () => {
    importAsset('v');
    expect(s().project.tracks.length).toBeGreaterThan(0);

    s().undo();

    expect(s().project.tracks).toHaveLength(0);
    expect(s().assets).toEqual({});
  });

  it('brings both back on redo', () => {
    importAsset('v');
    const tracks = s().project.tracks.length;

    s().undo();
    s().redo();

    expect(s().project.tracks).toHaveLength(tracks);
    expect(s().assets.v).toBeDefined();
  });

  it('undoes one imported file per step', () => {
    importAsset('a');
    importAsset('b');

    s().undo();

    expect(Object.keys(s().assets)).toEqual(['a']);
  });

  it('keeps thumbnails computed after the import when undoing past it', () => {
    importAsset('v');
    // Peaks and thumbnails land in the background, after the history entry was
    // taken - a restore must not roll them back to the bare probed asset.
    s().setAssetThumbnails('v', ['data:image/png;base64,x']);
    s().setAspectRatio('1:1');

    s().undo();

    expect(s().assets.v?.thumbnails).toEqual(['data:image/png;base64,x']);
  });
});

describe('undo of a library removal', () => {
  it('restores the asset and its clips', () => {
    importAsset('v');
    const tracks = s().project.tracks.length;

    s().removeAsset('v');
    expect(s().assets.v).toBeUndefined();

    s().undo();

    expect(s().assets.v).toBeDefined();
    expect(s().project.tracks).toHaveLength(tracks);
  });
});
