# Scope — Transitions, Video effects, Audio effects

Status: agreed scope for the next three-feature epic. Written to fix the
decisions before implementation and to record what is deliberately left out.

## Why this document

The app is stable and users are happy. The three features expected next —
**transitions**, **video effects** (blur, colour…), **audio effects** — are
benchmarked against CapCut (mobile reflexes), Vegas and Premiere (desktop
reflexes). Every inclusion is filtered through `PRODUCT.md`: a short-form
editor that is *efficient, discreet, reliable*, borrows reflexes rather than
reinventing them, and is explicitly **not** the Premiere "gas factory" nor a
big-buttoned toy.

## The one principle that drives the scope

Two facts about the current architecture decide almost everything:

1. **Video is a pure Canvas 2D compositor.** No WebGL pipeline exists
   (`src/lib/gpu.ts` only *probes* WebGL to detect software rendering).
   Preview and export share one `drawClip` (`src/preview/compositor.ts`), so an
   effect added there lands in both pipelines for free.
2. **Audio is a native Web Audio graph**, and `scheduleProjectAudio`
   (`src/preview/audioMix.ts`) is shared by preview (`AudioContext`) and export
   (`OfflineAudioContext`). A node inserted into the per-clip chain exports
   itself.

That yields a sharp **"free line"** — what the existing single pass can do
cheaply vs. what needs a structural investment:

| Domain | Free (existing pass, ~1 op) | Costly (WebGL / WASM) |
|---|---|---|
| Video | `ctx.filter`: brightness, contrast, saturate, blur, hue-rotate, grayscale, sepia, invert (chainable) | temperature/tint, curves, **LUT**, HSL secondary, highlights/shadows, vignette, sharpen |
| Audio | `BiquadFilter` (EQ, hi/lo-pass, "telephone"), `DynamicsCompressor` (VO leveler), `Convolver` (reverb), `Delay` (echo), `WaveShaper` (drive) | constant-duration pitch shift, denoise (RNNoise) |
| Transitions | dissolve (done), dip to black/white, slide/push, wipe, iris — Canvas 2D already composites two frames during an overlap | glitch, RGB-split, 3D flip, zoom-blur, morph (also off-brand "toy") |

The left column *is* the product `PRODUCT.md` describes. Short-form does not
need Lumetri curves; it needs CapCut reflexes placed fast and well.

## Decisions locked

1. **Video-effect ceiling — Canvas 2D first, then an isolated WebGL colour
   pass; not a compositor rewrite.** Canvas 2D keeps doing geometry,
   compositing and transitions unchanged. A per-clip WebGL pass grades pixels
   *before* the existing `drawClipSample` (a WebGL canvas is `drawImage`-able
   into the 2D context — a clean seam). This buys real grading (temperature,
   tint, **LUT**, vignette, better blur) without destabilising the most
   load-bearing, best-tested code. LUT support alone unlocks a whole library of
   one-tap looks (what CapCut "filters" are).
2. **Transition model — overlap / Vegas.** Extend `trackCrossfades`
   (`src/model/timeline.ts`) with a transition *type* on the overlap window,
   rather than introducing a Premiere-style transition object bound to the cut
   (which would rework the data model, drag and snapping). The dissolve already
   works exactly this way.
3. **Delivery order — Audio → Video → Transitions.** Start with the strong
   hand (audio is almost entirely native nodes, biggest quality-per-effort win),
   then video effects, then transitions.

## Phase 1 — Audio effects

Presented as **named presets** (CapCut "voice effects" reflex), not a mixing
desk (anti-"gas-factory"). Each preset is a small chain of native nodes
inserted into `scheduleClip`, so export parity is automatic.

- **Leveler / Compressor** — one toggle + amount → `DynamicsCompressorNode`.
  Turns amateur VO consistent; the highest-value single effect.
- **Voice EQ** + presets — high-pass anti-rumble + presence; "Telephone/Radio",
  "Bass boost" via `BiquadFilterNode`.
- **Reverb** — `ConvolverNode` + 2–3 short bundled impulse responses
  (Room / Hall / Plate).
- **Echo** — `DelayNode` + feedback.

Implementation notes:

- New clip fields (plain data on `BaseClip`) → undo/autosave/persistence work
  unchanged.
- **`sameAudioClip` must gain every new field** (`src/preview/audioMix.ts`), or
  the preview will not rebuild the graph on edit — this is called out in that
  file's own comment.
- New `AudioFxSection` in the inspector, following the existing
  `AudioSection` / `FadeSection` pattern.
- i18n strings across all five locales (`src/i18n/locales/`).

Deferred: formant-preserving pitch shift, denoise, de-ess, gate — WASM/heavy,
outside the short-form reflex.

## Phase 2 — Video effects

- **2a — "Adjust" (free, `ctx.filter`)**: brightness, contrast, saturation,
  blur. Four sliders, an inspector section modelled on CapCut "Adjust".
- **2a — "Filters" (one-tap presets)**: B&W, Sepia, Warm, Cool, Vintage — just
  preconfigured `ctx.filter` chains.
- **2b — isolated WebGL colour pass**: temperature/tint, LUT (unlocks a look
  library), vignette. Rendered per clip before Canvas 2D compositing; the
  compositor itself is untouched.

Excluded from short-form scope: curves, scopes, HSL secondary, masks/tracking —
Premiere depth, off-brand.

## Phase 3 — Transitions

- **v1 set (Canvas 2D, reads as "pro tool" not "toy")**: cross-dissolve (done),
  dip to black, dip to white, slide/push (4 directions), wipe (linear),
  optionally zoom. ~6 transitions, sensible default duration, adjustable.
- **UX**: desktop = drag a transition onto the cut + a duration handle (Vegas
  reflex); mobile = tap the cut → a small gallery (CapCut reflex).
- Modelled as a `type` on the overlap window (decision 2).

Excluded v1: the flashy GPU catalogue (glitch, 3D, particles) — WebGL *and*
the "toy" anti-reference.

## Cross-cutting

- **Effects are static per clip in v1.** Keyframed/animated effects are a
  separate future epic (keyframes are already out of scope per the README). The
  existing Ken Burns `zoomEnd` stays the one time-varying transform.
- Persistence/undo come for free: effects are plain fields on `Clip`, snapshotted
  by the existing history and autosave.
