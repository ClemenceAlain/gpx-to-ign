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
| `pageBytesAt` curve | q50->1.28 MB … q90->2.88 MB | Measured; drives the size estimate shown before download |
| `OVERVIEW_WIDTH_PX` | `1400` | At print resolution the overview cost 329 extra tiles; 93 now |
| `overviewQuality` | `max(q - 12, 45)` | Overview tolerates more compression than map pages |
| JPEG chroma | **4:4:4**, never 4:2:0 | 4:2:0 costs ~4 dB on thin saturated map lines |
| Densify / dedupe | 50 m / 5 m | Packing resolution |
| Fetch tuning | concurrency 6, 4 attempts, 400ms<<(n-1) backoff, retry 429/5xx only | The Geoplateforme throttles aggressive clients and publishes no quota |

**PDF size: JPEG quality is the only lever.** Indexed palette (banding — 12 tiles hold
179 925 unique colours, top 256 cover 24.9% of pixels), chroma subsampling (4 dB loss, no
browser control), downsampling (q80@200dpi weighs the same as q60@254dpi and is softer) and
progressive JPEG (2200 vs 2320 KB) were all measured and rejected. Do not re-derive this.

Presets: Compacte q60 / **Standard q72 (default)** / Fine q85.

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
  existing tests are the specification.
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

Branch `rebuild-typescript`. Last commit `ea17b46`. `npx vitest run` => 43 passing.

**Done** — ported test-first from Kotlin, each module's Kotlin test translated,
watched fail, then the implementation:

| Module | Files |
|---|---|
| geo | `packages/core/src/geo/{lambert93,tileGrid}.ts` |
| gpx | `packages/core/src/gpx/{xml,gpx}.ts` (own tokenizer: no DOMParser in Node) |
| pdf | `packages/core/src/pdf/{format,metrics,geometry,pdfPage,pdfDocument}.ts` |
| tiles | `packages/core/src/tiles/{mapSource,tileFetcher}.ts` |

**Next, in order:**
1. `render/mapRenderer.ts` — port `core/.../render/MapRenderer.kt`. 512 px blocks,
   bilinear, 64-entry tile LRU. Platform seam is
   `ImageCodec { decode(bytes), encodeJpeg(img, quality) }`.
2. `pdf/pageDecor.ts` — port `core/.../pdf/PageDecor.kt`. Needed for the ruler test:
   the L93 1 km grid is what gets measured.
3. **Walking skeleton** — `packages/web`, Vite + React, one hardcoded north-up page
   over `fixtures/normandie-traverse-30km.gpx`, fetch -> render -> JPEG -> PDF, in a
   real browser. Drive it headless with Playwright so there is a feedback loop.
4. **Gate: the ruler test.** Print page 1 at 100% on A4; 1 km must measure 40.0 mm.
   Only Clémence can do this. Do not start the layout port before it passes.
5. Then `layout/` (the packing), the biggest and subtlest port.

**Verified by hand, do not re-check:**
- SCAN25 + `ign_scan_ws` works today; CORS is `access-control-allow-origin: *`.
- SCAN25 covers the Normandy fixtures: level 16, `TILECOL=819 TILEROW=7984` returns
  a 128 kB PNG.
- Node 22.14, npm 10.9, Java 21, Android SDK at `/home/clemence/Android`.

**Still missing:** a loop GPX fixture. Nothing exercises `Cover.maxCoverage` yet.
