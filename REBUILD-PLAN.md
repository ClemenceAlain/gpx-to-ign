# Rebuild gpx-to-ign as a TypeScript web + Android app

## Context

`gpx-to-ign` turns GPX hiking traces into a printable IGN 1:25000 A4 map book. The current
implementation (8 commits on `main`, ~4500 lines) is Kotlin: a JVM `core`, an Android Compose
`app`, and a JVM `cli`. It works, but it only runs on Android and on a JVM command line.

You want to use it on your computer too. The Kotlin app cannot become a web app without a
Compose/Wasm rewrite of the whole UI, so the rebuild moves the codebase to TypeScript: one pure-TS
core shared by a React web app (which is also the desktop experience), a Node CLI, and an Android
APK produced by wrapping that same web app with Capacitor.

Every feature requested across the previous sessions is carried over, including the two that were
built but never committed — the vector preview before validation, and the PDF overview page
defaulting to off.

### Decisions taken
| Question | Answer |
|---|---|
| Stack | TypeScript monorepo — pure-TS core, React + Vite PWA, Capacitor APK, Node CLI |
| Platforms | Android + web. No iOS. |
| Repo | Same repo `ClemenceAlain/gpx-to-ign`, rebuild on a branch, then replace `main` |
| Web architecture | Fully client-side and static. No backend, no hosting cost. |
| Android background | Resumable job, no custom native code. Leaving the app pauses; returning resumes. |

### Feasibility confirmed before planning
- `https://data.geopf.fr/private/wmts` returns `access-control-allow-origin: *`. A browser can
  fetch IGN tiles directly, so the static/no-backend choice holds.
- SCAN25 and the shared key still work today: a Chamonix tile at
  `TILEMATRIXSET=LAMB93_2.5m&TILEMATRIX=16&TILECOL=1565&TILEROW=8542` returns `200 image/png`,
  164 952 bytes.
- The keyless public endpoint rejects SCAN25:
  `<Exception exceptionCode="InvalidParameterValue">Layer GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR unknown</Exception>`.
  The key is genuinely required.
- The `.L93` layer publishes matrix set `LAMB93_2.5m_3_16` — **levels 3 to 16 only**, and
  **metropolitan France only**. Both constraints must stay enforced in code.
- Local toolchain: Node 22.14, npm 10.9, Java 21, Android SDK at `/home/clemence/Android`.

### Two questions from previous sessions, now answered

**`https://jgn.superheros.fr/fr/`** — you asked whether it could supply the maps instead; that
session was interrupted before an answer. It cannot, and the reason is concrete: its JS bundles
show an **OpenLayers app calling the very same endpoint we do**,
`` `https://data.geopf.fr/private/wmts?apikey=${ce.geoportalKey}` ``, over the same layers
(`GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR`, `PLANIGNV2`, `ORTHOIMAGERY.ORTHOPHOTOS`), with a
Supabase backend. It is a competing print-your-IGN-map product holding its own Géoplateforme key,
not a map provider, and it exposes no API. Nothing to gain; we already talk to the source. Its key
is its own and will not be reused.

**Your own IGN key.** The shared `ign_scan_ws` key is documented by IGN as having a limited life.
The route to a personal one is
`https://cartes.gouv.fr/aide/fr/partenaires/ign/representations-cartographiques-souveraines/creation-cles-donnees-scan/`.
The key field stays editable in the UI for that day.

## The complete feature set to rebuild

Collected from every session. Each line is something you asked for.

1. Accept one **or several** GPX files.
2. Produce **one multi-page A4 PDF**, not a ZIP of separate files.
3. True **1:25000** scale, from IGN SCAN25.
4. **Fewest possible pages**, including rotation — with the north direction marked, which you asked
   for when you accepted rotation.
5. A configurable **margin** around the traces (default 500 m).
6. Printable for hiking: km grid, north arrow, scale bar, neighbour tabs, page numbers, footer.
7. **Optimised PDF size**, with a user-visible quality/size trade-off.
8. A **vector overview preview before validation** — built in Kotlin, never committed.
9. The overview page **off by default** in the produced PDF — same.
10. Installable **APK published on GitHub releases**.
11. **New:** the same app runs in a browser, on desktop and phone.
12. **New:** an **Apple-like design — sober and efficient**. See the section below.

Invariant honoured throughout and easy to lose in a rewrite: **the GPX trace is never drawn on the
map pages.** It only drives the layout. It *is* drawn in the preview — an inconsistency that was
raised with you and accepted.

## Design direction

Apple-like, sober, efficient. This is not a new direction — the current Compose app was already
restyled on an iOS grouped-list design in commit `d06ba4f`, and that work is the reference to port
rather than reinvent: `app/src/main/kotlin/io/gpxtoign/app/ui/Theme.kt` (iOS semantic palette,
text scale) and `ui/Components.kt` (`Section`, `SettingsRow`, `SegmentedControl`, `AppSlider`,
`Chevron`, `TextFieldRow`, `PrimaryButton`). Each of those becomes a small React component with the
same name and the same visual contract.

**Rules the implementation must hold to.**

- **Grouped inset lists, not cards-with-shadows.** Sections are rounded rectangles (10 px radius)
  on a grouped background, rows separated by hairlines inset to the label's left edge. The
  separator stops before the section edge, as on iOS. No drop shadows, no gradients, no borders
  beyond those hairlines.
- **One accent colour.** System blue for every interactive element and nothing else. Destructive
  actions in system red. The only other saturated colour in the whole app is the `#D91919` of the
  page rectangles, which exists to match the printed page and must not be reused as UI chrome.
- **Semantic, not literal, colour.** Define `label` / `secondaryLabel` / `tertiaryLabel`,
  `systemBackground` / `secondarySystemBackground` / `systemGroupedBackground`, `separator`,
  `fill`. Light and dark are two values of the same token, driven by `prefers-color-scheme`. Never
  hardcode a hex in a component.
- **Type.** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` — the system face
  on every platform, which is what makes it feel native rather than themed. An iOS-like scale:
  largeTitle 34 / title 22 / body 17 / subhead 15 / footnote 13 / caption 12, all in `rem` so
  browser and OS text-size settings work. Section headers are uppercase 13 px `secondaryLabel`.
- **Controls, hand-built, no component library.** A real segmented control with a sliding pill for
  the quality presets; iOS-style switches; a slider with a proper round thumb and a continuous
  track, not Material's gapped one; a full-width filled primary button. Adding MUI or shadcn would
  fight this style rather than serve it, so the app ships its own ~300 lines of components.
- **Sober means restraint, not sparseness.** No icons used decoratively — an icon appears only
  where it carries meaning (the chevron, the share glyph). No emoji. No animated progress
  flourishes: a determinate bar and a number.
- **Efficient means the screen answers the question.** One scrolling screen, French, sections in
  the order you work: Traces → Mise en page → Source (collapsed as "Réglages avancés") → Aperçu →
  action. The advanced section stays closed by default, because the key field and the source picker
  matter on the day the shared IGN key dies and on no other day. The primary action is always
  reachable at the bottom without hunting.
- **The preview is the hero.** It is the largest element on the screen and it updates live as you
  move the margin slider, because it costs no network. Everything above it is input; everything
  below it is a consequence. The numeric summary sits directly under it in one quiet row —
  pages, rotation, PDF size, download, tiles — in `secondaryLabel`, not as five separate cards.
- **Motion.** 200 ms ease-out, and only for state that genuinely changes: the advanced section
  disclosing, the segmented pill sliding. Honour `prefers-reduced-motion`.
- **Touch and pointer both.** 44 px minimum hit targets for the phone; hover and focus-visible
  states for the desktop browser, which the Compose app never needed.

Verify it the way the Kotlin app did, only better: the web app renders in a real browser, so
capture the six screen states (empty / planning / planned / running / done / dark) as Playwright
screenshots in CI, replacing the Robolectric + Roborazzi workaround that existed only because there
was no emulator.

## Target layout

```
gpx-to-ign/
  package.json                 npm workspaces, no pnpm/yarn needed
  packages/
    core/                      pure TS. No DOM, no Node API, no framework.
      src/gpx/                 parser -> GpxSegment[]
      src/geo/                 lambert93.ts, tileGrid.ts
      src/layout/              rect.ts, cover.ts, pageLayout.ts, planPreview.ts
      src/tiles/               mapSource.ts, tileFetcher.ts     (injected fetch + cache)
      src/render/              mapRenderer.ts                   (injected ImageCodec)
      src/pdf/                 pdfDocument.ts, pdfPage.ts, pageDecor.ts, geometry.ts
      src/job.ts               plan() / estimate() / run(), checkpointed
    web/                       React + Vite PWA. The real app.
      src/platform/            BrowserImageCodec, CacheStorage tiles, IndexedDB checkpoints
      src/worker/              render worker
      src/ui/                  screens + the SVG preview
    mobile/                    Capacitor project wrapping packages/web's build
      android/                 generated, committed
    cli/                       Node entry point, thin
```

`core` is the only place any algorithm lives. `web`, `cli` and `mobile` supply platform seams and
UI.

## Step-by-step build

### 1. Scaffold the monorepo
`package.json` with npm workspaces, a shared `tsconfig.base.json` (strict, ES2022, no `any`),
Vitest at the root, ESLint + Prettier. Delete nothing yet — the Kotlin tree stays until step 12 so
its 48 tests remain available as an oracle.

### 2. Port `core/geo`
Direct transliteration of `Lambert93.kt` and `TileGrid.kt`; both are pure math with no JVM
dependency. Port `Lambert93Test.kt` and `TileGridTest.kt` to Vitest first and make them pass.

Facts to preserve: EPSG:2154, no datum shift (RGF93/WGS84 agree within 1 m, well under the 2.5 m
pixel — verified against pyproj within 0.5 m at five reference points); matrix set `LAMB93_2.5m`,
origin `(0, 12 000 000)`, 256 px tiles, so **one tile is 640 m**; level 16 scale denominator
8928.5714 × 0.28 mm = 2.5 m/px exactly.

Add a guard the Kotlin code lacks: reject levels outside 3–16 and coordinates outside the
metropolitan L93 box, with a clear error rather than a blank page.

### 3. Port `core/gpx`
The Kotlin parser uses SAX. Browsers have `DOMParser`, Node 22 does not, and adding a DOM shim to
`core` breaks its purity. Write a ~150-line streaming XML tokenizer in `core/src/gpx/xml.ts`
instead, keeping the existing semantics: namespace-prefix stripping, DTDs ignored, only lat/lon
kept, one `GpxSegment` per `<trkseg>` / `<rte>` / standalone `<wpt>`, out-of-range coordinates
skipped, `GpxParseError` when a file yields no coordinates. Port `GpxParserTest.kt`.

**Fix while porting:** the Android picker filtered `*/*`, so any file could be chosen and would
then fail in the parser. The web input uses `accept=".gpx,application/gpx+xml"`.

### 4. Port `core/layout` — the page packing
The most valuable code in the repo. A faithful port, not a redesign.

Geometry: A4 210 × 297 mm − 5 mm safe margins − 10 mm footer = map area 200 × 277 mm = exactly
**5000 × 6925 m** at 1:25000 = **2000 × 2770 px** at 2.5 m/px = **254 dpi with no upsampling**.
The margin is subtracted on both sides before packing, so every track point must fall inside a
shrunk **4000 × 5925 m** rect; pages are grown back afterwards.

Points are densified to ≤ 50 m and deduped below 5 m. For each angle, two greedy covers run and the
better wins:
1. **Sequential** — two-pointer scan for the longest contiguous run whose bbox fits the shrunk
   rect, swept forwards and backwards, tolerating up to 512 already-covered points mid-run.
   Optimal for the common linear hike.
2. **Anchored set-cover** (`maxCoverage`) — candidates anchored on each uncovered point, repeatedly
   taking the rect covering the most uncovered points, anchor budget 300. This is what saves
   duplicate pages on loops and out-and-backs.

Then `refine()` = prune redundant → recentre on own points for maximum slack → merge adjacent →
prune. Angle search 0–179° at 1° steps, shortlist of 5 within +1 page of the best re-solved
thoroughly, then 24 randomised restarts on the winner seeded `0x6A7E1E15` so plans are
deterministic. Selection: fewest pages, then smallest angle (north-up), then most slack. A `byU`
sorted index keeps rectangle queries to a slice.

Why rotation earns its complexity: a page swallows a run as long as its **diagonal, 7.1 km**,
rather than its width, 4 km. A measured 20 km east-west track needs **5 north-up pages but 3
rotated**, and the planner was observed packing 7148 m of track per page against 5925 m north-up.

The problem is NP-hard, so the result is near-minimal; port the brute-force test that asserts
optimality on 60 random small cases, along with `CoverTest.kt`, `PageLayoutTest.kt` and `Tracks.kt`.

**Fix while porting:** `Cover.maxCoverage`'s `out.size <= n` safety valve becomes a real error
instead of silently emitting one rectangle per point.

### 5. Port `core/tiles`
`mapSource.ts` builds the same WMTS KVP GetTile URL. `tileFetcher.ts` takes an injected
`fetch`-compatible function and an injected `TileCache`, keeping concurrency 6, 4 attempts with
`400ms << (n-1)` backoff, retry only on 429/5xx, a 30 s timeout, an explicit User-Agent, and
rejection of non-`image/*` responses. Those numbers are not arbitrary — they were tuned because
the Géoplateforme throttles aggressive clients, and IGN publishes no quota we could read instead.

**Fix while porting — the Plan IGN fallback is broken today.** `MapSource.PLAN_IGN` declares
`TILEMATRIXSET=PM` (Web Mercator) but the pipeline hardcodes the Lambert-93 origin and 2.5 m/px,
so the fallback silently downloads geographically unrelated tiles while the README and UI present
it as working. In TS the tile grid becomes a property of the map source (`Lamb93Grid` and
`WebMercatorGrid` behind one interface) and the renderer reads the grid from the source. Add a test
asserting a known lat/lon maps to the documented tile in each grid.

**Fix while porting:** `bytesDownloaded` was a racy `+=` across 6 coroutines and could undercount;
the TS event loop makes it safe by construction.

Keep Lambert-93 as the printing grid. It has constant scale across metropolitan France, so an A4
page is always the same ground rectangle and 1:25000 is literally true; Web Mercator would need a
per-latitude correction and only upsamples the same 2.5 m source.

### 6. Port `core/render` and `core/pdf`
`MapRenderer` keeps the 512 px block strategy, bilinear resampling and the 64-entry tile LRU, so a
2000 × 2770 px page is never fully materialised as RGBA more than one block at a time. This is what
keeps the browser and the phone inside their memory budget.

The platform seam is one interface:

```ts
interface ImageCodec {
  decode(bytes: Uint8Array): Promise<RgbaImage>
  encodeJpeg(img: RgbaImage, quality: number): Promise<Uint8Array>
}
```

Port the hand-rolled PDF writer in spirit: PDF 1.4, JPEG blocks embedded untouched as `/DCTDecode`
XObjects so tiles are never recompressed, vector content streams Flate-compressed (~4:1), pages
serialised the moment they are drawn with a number→offset xref map so a 30-page job holds one page
of raster rather than thirty, objects 1–4 reserved, WinAnsi text with baked-in Helvetica metrics.
Flate comes from `fflate` (≈2 kB, browser and Node); the browser's `CompressionStream` is async and
would complicate the writer.

Port `PageDecor.kt` unchanged: Lambert-93 1 km grid (Liang-Barsky clipped), north arrow labelled
with the rotation in degrees, neighbour tabs, page number, 5-segment scale bar, footer
`1:25000 · © IGN — SCAN25® · grille Lambert-93 (1 km)`.

**Do not re-derive the size optimisation.** It was measured, and four of the five obvious levers
were ruled out by measurement:

| Lever | Verdict | Evidence |
|---|---|---|
| Indexed palette | Rejected | 12 IGN tiles hold 179 925 unique colours; the top 256 cover 24.9% of pixels. Relief shading would band. |
| Chroma subsampling 4:2:0 | Rejected | Costs ~4 dB on thin saturated lines (q85: 32.48 dB at 4:4:4 vs 28.20 dB), and the browser canvas exposes no control over it. |
| Downsampling | Rejected | q80 at 200 dpi weighs the same as q60 at 254 dpi and is visibly softer on map text. |
| Progressive JPEG | Marginal | 2200 KB vs 2320 KB. Not the lever. |
| **JPEG quality** | **The lever** | See the sweep below. |

Measured sweep on one 2000 × 2770 page (KB / PSNR dB, 4:4:4): q90 3857/34.65 · q85 3159/32.48 ·
q80 2724/31.10 · q75 2413/30.06 · q70 2205/29.33 · q65 2024/28.69 · q60 1881/28.16 · q55 1761/27.71.
Shipped presets for the four-page Chamonix book, down from an 11.10 MB baseline that was 99.6%
JPEG payload:

| Preset | q | Book | vs baseline |
|---|---|---|---|
| Compacte | 60 | 6.26 MB | −44% |
| **Standard (default)** | **72** | **7.51 MB** | **−32%** |
| Fine | 85 | 10.13 MB | −9% |

Keep `overviewQuality = max(q − 12, 45)`, and keep the estimator's measured constants:
`AVERAGE_TILE_BYTES = 145 000` and the `pageBytesAt` curve. Keep the overview rendered from a
coarse level via `matrixFor(width / 1400)` — at near-print resolution it cost 329 uncounted tiles
on a four-page job, against 93 now.

**Change:** `includeOverviewPage` now defaults to `false` (request 9).

### 7. Checkpointing — how "leaving the app" stops costing you anything
This is the answer to the Android background limit rather than a workaround bolted on later, so it
belongs in `core`, not in the mobile shell.

A job gets a `jobId` = hash of (track points, margin, rotation flag, source, key, quality). Two
levels of durable state, both shared by web and Android because both are the same WebView:

- **Tiles.** The cache *is* the resume state. Every tile is written to the Cache API under its URL
  as it arrives. On resume the planner reruns — it is deterministic, same seed, same plan — and the
  fetcher finds every previous tile instantly, downloading only what is missing. No bookkeeping
  needed for the expensive phase.
- **Rendered pages.** Each finished page's JPEG blocks go to IndexedDB keyed by
  `(jobId, pageIndex, quality)`, so a resumed job skips re-rendering what it already drew.

On launch, if a checkpoint exists that is not `done`, the app offers
*"Reprendre — 312 / 468 tuiles"* instead of starting over. Storage is bounded: show usage, and
offer an explicit "vider le cache" action, since a job is roughly 70 MB of tiles.

Screen sleep is the most common interruption in a three-minute download, and it is avoidable
without any plugin: request the standard `navigator.wakeLock.request('screen')` while a job runs,
release it on completion. If the API is unavailable the app shows a plain warning instead. Verify
on your device — Screen Wake Lock is a Chrome API and I have not confirmed it in the Capacitor
WebView.

**What this does and does not give you.** It does not make the download continue while you are in
another app; Chrome gives a hidden WebView a timer budget that regenerates at 0.01 s per second,
and no plugin changes that. It does mean that leaving the app, the screen sleeping, or Android
killing the WebView outright costs you only the time you were away — never the megabytes.

### 8. The web app
React + Vite, one screen, same information architecture as the Compose screen
(`app/src/main/kotlin/io/gpxtoign/app/ScreenContent.kt`): Traces / Mise en page / Source
(collapsible "Réglages avancés") / Aperçu / job status. French UI, as today, built to the
**Design direction** section above — the iOS grouped-list style ported from `ui/Theme.kt` and
`ui/Components.kt`.

- **Platform seam**: `BrowserImageCodec` using `createImageBitmap` + `OffscreenCanvas` +
  `convertToBlob({ type: 'image/jpeg', quality })`, inside a dedicated Worker so the UI never
  blocks. JPEG encoding therefore happens in native browser code, not in JS.
- **The vector preview (request 8).** Port the design that was finished in Kotlin but never
  committed, `core/layout/PlanPreview.kt` → `core/src/layout/planPreview.ts`: `PagePoint(u, v)` in
  the page frame in metres; `bounds` = pages bounds expanded by 4% of the longer side; one polyline
  per leg (`Layout` gains `segmentStart` + `trackSegments()` so a polyline never joins two legs);
  `angleDeg`; north as a unit vector on the page. `of(layout, widthPx = 720)` thins samples at
  `tolerance = bounds.width / widthPx` — two samples in one pixel cannot both show — while always
  keeping each leg's last point.

  Rendered as **SVG in the DOM** (the Kotlin version used a Compose `Canvas`), aspect ratio
  clamped to 0.75–1.6, page outlines in `#D91919` with a `#D9191914` wash — deliberately the same
  red as the printed overview page — numbered in walking order, plus the north arrow. **Zero tiles
  fetched**: raster preview was rejected because it downloads 1–4 MB before you validate, which is
  exactly what the estimate screen exists to avoid. A test asserts it by planning against a
  fetcher that throws on any request.

  The numeric summary stays underneath: page count, rotation, estimated PDF size, estimated
  download, tile count.
- **Controls**: quality segmented control (Compacte 60 / Standard 72 / Fine 85), margin slider
  100–2000 m snapped to 50 m, rotation toggle, "Plan d'ensemble dans le PDF" toggle **off by
  default** with the footnote *"ne l'ajoutez au PDF que pour l'imprimer"*, source picker, IGN key
  field, title field.
- **Settings persist** in `localStorage`. The Kotlin app declared `datastore-preferences` but never
  used it, so settings were lost on process death.
- **Output**: File System Access API save picker where available, `<a download>` fallback.
- **PWA**: installable, service worker precaches the app shell.

### 9. The Android APK
`packages/mobile` is a Capacitor project whose `webDir` is `packages/web/dist`. No second UI, no
custom native plugin.

- GPX input: the same `<input type="file" accept=".gpx">` — Android WebView opens the system
  picker. Keep the `ACTION_SEND` / `ACTION_SEND_MULTIPLE` / `ACTION_VIEW` intent filters for
  `application/gpx+xml` from the current manifest so "share to gpx-to-ign" still works, bridged
  into the web layer.
- Output: `@capacitor/filesystem` writes the PDF to Documents, `@capacitor/share` offers it, and
  the app names the file it wrote. This removes the SAF persistable-grant machinery behind the
  Android 13+ save-dialog bug (`670a3a2`) and the background-grant bug (`e936bdc`).
- Resumability from step 7 is what covers backgrounding.
- Signing and versioning reuse the current `release.yml` approach: `KEYSTORE_BASE64` secret,
  `versionName` from the tag, `versionCode` from `github.run_number`.

### 10. The CLI
`packages/cli`, a thin Node entry point over `core`, same flags as the Kotlin `Main.kt`: `-o`,
`-m`, `--no-rotation`, `--source`, `--key`, `--cache`, `--title`, `--quality`, `--index` (inverted
from `--no-index`, which keeps working for old scripts), `--dry-run`, `--explain`, `-h`. Filesystem
tile cache at `.tilecache/{source}/{z}/{col}/{row}.png`. `ImageCodec` via `@napi-rs/canvas`
(prebuilt binaries, no native compile step, same canvas API as the browser seam).

`--explain` keeps grouping angles by resulting page count, but only re-solves the shortlist rather
than running the full thorough solve for all 180 angles as it does today.

### 11. CI
- `ci.yml`: `npm ci`, typecheck, lint, `vitest run`, `vite build`, then Playwright screenshots of
  the six screen states in light and dark, compared against committed baselines. On `main`, also
  build the debug APK and upload it as an artifact.
- `pages.yml`: build `packages/web` and deploy to GitHub Pages, so the web app is live at
  `clemencealain.github.io/gpx-to-ign`.
- `release.yml`: on a `v*` tag, run tests, `npx cap sync android`, `assembleRelease`, rename to
  `gpx-to-ign-<tag>.apk`, `gh release create --generate-notes` with the APK attached.

### 12. Cut over
Once the web app produces a PDF equivalent to the Kotlin one for the reference alpine trace, delete
`core/`, `app/`, `cli/`, `gradle/`, `gradlew*`, `settings.gradle.kts`, `build.gradle.kts`,
`local.properties`. Rewrite `README.md` for the new stack, keeping the sections that explain the
*why*: page minimisation, the JPEG-quality reasoning and its measured table, the map-source and key
story, the design rules above so they survive the next change, and the attribution note *"Map data
© IGN — SCAN25® is subject to IGN's own licence terms."* Merge into `main`.

## How this gets executed

Sequential, me driving, stopping at each gate. No subagent fan-out: the layout port is the part
most likely to go subtly wrong, and holding the whole context is worth more than wall-clock here.

### Step 0 — before any implementation code
1. **Write `CLAUDE.md`.** The repo has none. It must carry the constants that look arbitrary and
   are not: the seed `0x6A7E1E15` (plans must stay deterministic), `AVERAGE_TILE_BYTES = 145 000`,
   the `pageBytesAt` curve, 4:4:4 over 4:2:0, `OVERVIEW_WIDTH_PX = 1400`. Plus the invariants a
   rewrite silently breaks: the trace is never drawn on map pages, 1 km must print at 40.0 mm, the
   UI is French, the Kotlin tree is not deleted until equivalence passes.
2. **Fixtures — you supply them.** There is no `.gpx` anywhere on this machine and no `.tilecache`;
   the reference alpine traverse behind every measured number in the commit history is gone. Drop
   three traces in the repo and I commit them: a **linear traverse** (proves the rotation payoff,
   5 pages north-up vs 3 rotated), a **loop** (exercises the anchored set-cover), and a **pair of
   files** (multi-GPX input). Needed by wave 2, not before — the skeleton runs on a hand-written
   ten-point GPX.
3. **Differential harness, built before the port.** `--dump-json` on both CLIs emitting each stage
   — projected points, winning angle, page rectangles, tile list, page count — and one script that
   diffs Kotlin against TS. Comparing two PDFs by eye finds the bug on page 3; diffing stage output
   finds it in `refine()`. Prime `.tilecache` once with the Kotlin CLI and point both at it, or
   every iteration re-downloads 68 MB and IGN throttles us.

### Step 0bis — walking skeleton, before the full port
One GPX, one hardcoded north-up page, fetch → decode → render → JPEG → PDF, in a real browser.
This exercises only what is genuinely new: `OffscreenCanvas` encoding, WebView memory under a
2000 × 2770 page, the PDF writer, and CORS from a page origin rather than curl. It ends with the
ruler test. Once 1 km measures 40.0 mm on paper, steps 2–6 are mechanical ports with an oracle.

### Then the numbered steps, in order
Steps 1–12 above, sequentially. Gates that do not move:

1. Port the Kotlin test file, watch it fail, then port the implementation. The 48 existing tests
   are the specification.
2. No Kotlin deletion until stage-diff equivalence passes on all three fixtures.
3. The ruler test on actual paper, by you, after the skeleton and again before cutover. Nothing in
   CI can check that 1 km is 40.0 mm.
4. Device test on your phone, by you, before cutover. The Kotlin UI was never once run on a device
   or emulator — only rendered by Robolectric. Do not repeat that.

## Verification

Run in order; each step gates the next.

1. `npm run test` — the ported suites for geo, gpx, layout, pdf, render must pass. They are
   translations of tests that pass today in Kotlin, so a failure means the port is wrong.
2. **Planner equivalence.** On a real GPX, `./gradlew :cli:run --args="--dry-run --explain t.gpx"`
   and `node packages/cli --dry-run --explain t.gpx` must report the same page count and the same
   winning angle.
3. **PDF equivalence.** Generate the reference alpine book with both. Compare page count, page size
   (must be exactly 595.28 × 841.89 pt), embedded image dimensions (2000 × 2770), and file size
   within 10% at the same quality. `pdfimages -list` should show the JPEG payload at ≈99% of the
   file, as it does today.
4. **Scale check — the one that matters for printing.** `pdftoppm -r 254`, then print page 1 at
   100% on A4 and measure the km grid with a ruler: 1 km must be **40.0 mm**. This was verified on
   the Kotlin output and must stay true.
5. **Web.** `npm run dev`, load two GPX files, confirm the SVG preview appears with **zero**
   requests to `data.geopf.fr` in the Network tab, then generate and save the PDF.
5b. **Design.** Review the six Playwright screenshots in light and dark against the rules in the
   Design direction section, and against the Kotlin app's own renders under
   `app/build/screenshots` while they still exist. Check the slider moves the preview live with no
   network, that the advanced section is closed on first load, and that the page renders sensibly
   at 320 px wide and at a desktop width.
6. **Resumability — the point of step 7.** Start a job, let it reach ~30%, background the app for a
   minute, return. It must offer to resume and must not re-download the tiles it already has;
   confirm against the Cache API entry count. Repeat by force-stopping the app.
7. **Android.** `npx cap run android` on your device: pick a GPX, generate, confirm the file lands
   in Documents and opens. Then install the CI release APK and repeat. Check whether
   `navigator.wakeLock` actually holds in the WebView.
8. **Size trade-off.** Generate the same book at all three presets and confirm the sizes track the
   measured table (6.26 / 7.51 / 10.13 MB for the four-page alpine book) and that the estimate
   shown beforehand is within ~15% of the real file.

## Risks

| Risk | Handling |
|---|---|
| Download does not progress while you are in another app | Accepted, by your decision. Step 7 makes it cost time, never data. A native foreground-service plugin remains the only real fix if the pause turns out to annoy you. |
| Browser memory on a 30-page book | 512 px block rendering and page-at-a-time PDF serialisation, both proven in the Kotlin design |
| Storage quota — ~70 MB of tiles per job | Show usage, offer "vider le cache", handle `QuotaExceededError` by evicting oldest jobs |
| The shared key `ign_scan_ws` is transitional and will die | Key stays editable; the Plan IGN fallback gets fixed in step 5 so there is a real fallback; the personal-key URL goes in the README |
| The packing port drifts from the Kotlin behaviour | Verification step 2 compares both implementations before the Kotlin code is deleted |
| The Android UI was never run on a device in the Kotlin build either — only Robolectric renders | The web app removes this blind spot: the same UI is testable in a real browser, and step 7 of verification runs it on your phone |
