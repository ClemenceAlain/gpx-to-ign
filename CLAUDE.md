# gpx-to-ign

Turns GPX hiking traces into a printable IGN 1:25000 A4 map book (one multi-page PDF).
Being rebuilt from Kotlin to a TypeScript monorepo — see `REBUILD-PLAN.md`.

## Invariants — breaking any of these is a bug, not a refactor

- **1 km must print at exactly 40.0 mm.** A4 210x297 mm, 5 mm safe margin, 10 mm footer
  => map area 200x277 mm => exactly 5000x6925 m at 1:25000 => 2000x2770 px at 2.5 m/px
  => 254 dpi with no upsampling. Every one of those numbers is load-bearing.
- **The GPX trace is never drawn on the map pages.** It only drives the layout. It *is*
  drawn in the on-screen preview; that inconsistency is deliberate and was accepted.
- **Plans are deterministic.** Same input, same plan, every time. The resumable-job design
  depends on it: a resumed job replans and must land on the identical tile set.
- **The UI is French.**
- **Print geometry uses Lambert-93 (EPSG:2154), not Web Mercator.** Constant scale across
  metropolitan France, so an A4 page is always the same ground rectangle and 1:25000 is
  literally true.

## Measured constants — do not "clean up"

Each of these came from a measurement, not a guess. Changing one silently degrades output.

| Constant | Value | Why |
|---|---|---|
| Layout seed | `0x6A7E1E15` | Keeps the 24 randomised restarts deterministic |
| `AVERAGE_TILE_BYTES` | `145_000` | Measured mean SCAN25 tile; was 170 000 and over-estimated |
| `pageBytesAt` curve | q50->0.71 MB … q90->1.49 MB | Re-measured on the browser encoder, 2026-09-17. See below |
| `OVERVIEW_WIDTH_PX` | `1400` | At print resolution the overview cost 329 extra tiles; 93 now |
| `overviewQuality` | `max(q - 12, 45)` | Overview tolerates more compression than map pages |
| JPEG chroma | **4:2:0** — the browser gives nothing else | See below. Was 4:4:4 under Kotlin |
| Densify / dedupe | 50 m / 5 m | Packing resolution |
| Fetch tuning | concurrency 6, 4 attempts, 400ms<<(n-1) backoff, retry 429/5xx only | The Geoplateforme throttles aggressive clients and publishes no quota |

**PDF size: JPEG quality is the only lever.** Indexed palette (banding — 12 tiles hold
179 925 unique colours, top 256 cover 24.9% of pixels), downsampling (q80@200dpi weighs the
same as q60@254dpi and is softer) and progressive JPEG (2200 vs 2320 KB) were all measured
and rejected. Do not re-derive this.

Presets: Compacte q60 / **Standard q72 (default)** / Fine q85.

### Chroma: the one invariant the web platform took away

Kotlin encoded 4:4:4 because 4:2:0 costs ~4 dB on the thin saturated lines a 1:25000 map is
made of. `OffscreenCanvas.convertToBlob` exposes no chroma control, and Chrome subsamples at
**every quality except 100**. Measured on one 512 px block of real SCAN25 (2026-09-17):

| q | 60 | 72 | 85 | 88 | 90 | 92 | 94 | 95 | 100 |
|---|---|---|---|---|---|---|---|---|---|
| kB | 69 | 83 | 111 | 122 | 133 | 144 | 163 | 174 | **436** |
| chroma | 4:2:0 | 4:2:0 | 4:2:0 | 4:2:0 | 4:2:0 | 4:2:0 | 4:2:0 | 4:2:0 | **4:4:4** |

q100 is 4x q85 for one step of chroma, so it is not a usable lever. **Clémence accepted
4:2:0** on 2026-09-17 rather than ship a WASM MozJPEG encoder. Do not re-open this without
new evidence from a print.

**Every size number below is therefore about half the Kotlin equivalent.** One A4 page of the
Normandy fixture, browser encoder, real SCAN25:

| q | 50 | 60 | 70 | 72 | 80 | 85 | 90 |
|---|---|---|---|---|---|---|---|
| MB | 0.71 | 0.79 | 0.90 | **0.93** | 1.09 | 1.24 | 1.49 |

Caveat before reusing these: the Kotlin sweep was a *Chamonix* page and this one is
*Normandy*, which is far less detailed. The clean encoder comparison is the 512 px block
table above, not this one. Re-measure the book totals once the packing lands.

## Map source

SCAN25 needs a key; the keyless endpoint rejects the layer outright.

```
https://data.geopf.fr/private/wmts?apikey=ign_scan_ws
  &LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR.L93
  &TILEMATRIXSET=LAMB93_2.5m&TILEMATRIX=16
```

- Grid `LAMB93_2.5m`: origin `(0, 12 000 000)`, 256 px tiles => **one tile is 640 m**.
- The `.L93` layer serves **levels 3-16 only**, **metropolitan France only**.
- `ign_scan_ws` is IGN's shared transitional key with a limited life. Keep the key field
  editable in the UI. Personal keys: https://cartes.gouv.fr/aide/fr/partenaires/ign/representations-cartographiques-souveraines/creation-cles-donnees-scan/
- Tiles are served with `access-control-allow-origin: *`, which is why the web app needs no
  backend.
- Attribution must appear on every page: `© IGN — SCAN25®`.

## Rebuild rules, while both codebases exist

- **Do not delete the Kotlin tree** (`core/ app/ cli/ gradle/ gradlew* *.gradle.kts`) until
  stage-diff equivalence passes on every fixture. It is the oracle for the port.
- **Port the Kotlin test first, watch it fail, then port the implementation.** The 48
  existing tests are the specification. Where Kotlin had none — `PageDecor` — write the
  test against the invariants instead, and still watch it fail first.
- Prime `.tilecache` once and point both implementations at it. Never let an iteration loop
  re-download ~68 MB from IGN.

## Fixtures

`fixtures/` — real Komoot traces in Normandy, used for differential testing.

| File | Shape | Length | Points |
|---|---|---|---|
| `normandie-traverse-30km.gpx` | linear | 29.7 km | 543 |
| `bec-hellouin-bourgtheroulde-22km.gpx` | linear | 22.0 km | 262 |

**Missing: a loop.** Nothing currently exercises `Cover.maxCoverage`, the anchored set-cover
that saves pages on loops and out-and-backs. Ask before relying on that path being covered.

## Design

Apple-like, sober, efficient — grouped inset lists, one accent colour, system font stack,
hand-built controls, no component library. Full rules in `REBUILD-PLAN.md`.

## Where the rebuild is

Branch `rebuild-typescript`. Last commit `29d31a1`.
`npx vitest run` => 103 passing. `npm run typecheck` clean.
`npm run -w @gpx-to-ign/web test` => 8 Playwright tests passing.

**Done** — ported test-first from Kotlin, each module's Kotlin test translated,
watched fail, then the implementation:

| Module | Files |
|---|---|
| geo | `packages/core/src/geo/{lambert93,tileGrid}.ts` |
| gpx | `packages/core/src/gpx/{xml,gpx}.ts` (own tokenizer: no DOMParser in Node) |
| pdf | `packages/core/src/pdf/{format,metrics,geometry,pdfPage,pdfDocument,pageDecor}.ts` |
| tiles | `packages/core/src/tiles/{mapSource,tileFetcher}.ts` |
| render | `packages/core/src/render/{image,mapRenderer}.ts` |
| layout | `packages/core/src/layout/{rect,random,cover,pageLayout,planPreview}.ts` |
| job | `packages/core/src/job.ts` — plan / estimate / run, checkpointed |
| web | `packages/web` — the real app: screen, preview, platform seams |

**Decisions taken while porting, do not re-litigate:**
- The raster is `RgbaImage` (8-bit RGBA in a `Uint8ClampedArray`), not Kotlin's packed ARGB
  ints, because that is what `getImageData` returns. `ImageCodec` is async because
  `convertToBlob` is.
- `PageDecor` takes a `PageFrame` (angleRad / toL93 / toPage / northOnPage), not the whole
  `Layout`. That is what let the page furniture land before the packing. `Layout` will
  implement it.
- `core` compiles with the DOM lib: `fetch`, `AbortController` and the timers live nowhere
  else. Keep `core` free of the real DOM by review, not by the compiler.
- `layout/random.ts` reproduces `kotlin.random.Random`'s XorWow **bit for bit**, checked
  against values printed from the JVM. The restarts pick the page plan, so a generator that
  merely looked random would quietly produce different books from the oracle.
- Platform packages import from `@gpx-to-ign/core` only — never a deeper path. Vite is
  configured to alias that to `../core/src/index.ts` and exclude it from `optimizeDeps`;
  without both, Vite pre-bundles core once and an edit to it silently does nothing.
- `/Filter /FlateDecode` is **zlib** (RFC 1950), so the writer uses fflate's `zlibSync`.
  `deflateSync` emits raw RFC 1951, which passes every structural check and still renders a
  blank page in every real viewer. That shipped once. `pdfDocument.test.ts` asserts the
  zlib header, and so does the Playwright skeleton test.

**Two test loops, deliberately separate:**
- `npm run -w @gpx-to-ign/web test` routes `data.geopf.fr` to a synthetic tile. Free, fast,
  deterministic. **Use this one while iterating.**
- `npm run -w @gpx-to-ign/web test:real` hits IGN. `ruler` writes a printable book,
  `pageSizes` re-measures the size curve, `shot` captures light and dark screenshots into
  `packages/web/out/`. Re-running within one browser session costs 0 downloads — the Cache
  API resume path works.

**Headless Chrome defines `showSaveFilePicker` but nothing can answer its dialog**, so every
browser test deletes it in an init script and exercises the `<a download>` fallback instead.
A test that forgets this hangs until the timeout with no useful error.

`packages/web/src/skeleton.ts` is no longer the app — it is the measurement harness the
`pageSizes` run drives. The app is `ui/App.tsx`.

Rendered at 254 dpi with `pdftoppm`, the blue kilometre grid measures **400.0 px = 40.00 mm**
between lines. The geometry is right; only printer scaling is left to check on paper.

**The ruler test passed** on 2026-09-17. 1 km measures 40.0 mm on paper.

**Differential test against Kotlin.** `test/layout/fixtures.test.ts` pins the plan for both
fixtures to what `PageLayout.plan` printed on the JVM: same page count, same rotation
(9.0000° on the traverse), same sample count, same rectangles to 0.1 m. Regenerate it by
dropping a throwaway JUnit test in the Kotlin tree that prints the plan — that is what the
Kotlin tree is still here for.

**Next, in order:**
1. `job.ts` — plan / estimate / run, checkpointed. The size estimate uses the re-measured
   browser curve above, not the Kotlin one.
2. The real web UI: Traces / Mise en page / Source / Aperçu, the SVG plan preview, French,
   to the design rules in `REBUILD-PLAN.md`. The walking skeleton's `App.tsx` is a
   placeholder and should be replaced wholesale.
3. `packages/cli`, then `packages/mobile` (Capacitor), then delete the Kotlin tree.

**Verified by hand, do not re-check:**
- SCAN25 + `ign_scan_ws` works today; CORS is `access-control-allow-origin: *`.
- SCAN25 covers the Normandy fixtures: level 16, `TILECOL=819 TILEROW=7984` returns
  a 128 kB PNG.
- Node 22.14, npm 10.9, Java 21, Android SDK at `/home/clemence/Android`.
- Playwright chromium-headless-shell 1243 is installed.

**Still missing:** a loop GPX *fixture*. `Cover.maxCoverage` is now exercised by a
synthetic 12 km ring in `pageLayout.test.ts`, but no real Komoot loop has been through the
whole pipeline.
