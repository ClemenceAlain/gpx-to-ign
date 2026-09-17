# gpx-to-ign

Turns GPX traces into one printable multi-page A4 PDF at true 1:25000, cut from the IGN
SCAN25 map, using as few pages as possible. Built for printing hiking maps.

The same app runs in a browser and as an Android APK — one TypeScript codebase, no backend,
no hosting cost. It is fully client-side: your traces never leave the device.

The GPX only decides where the pages go. It is drawn on the preview, and on the map pages
only if you ask for it.

## Use it

- **In a browser**: <https://clemencealain.github.io/gpx-to-ign>
- **On Android**: grab the APK from the
  [latest release](https://github.com/ClemenceAlain/gpx-to-ign/releases/latest) and sideload
  it (Android 6.0 or newer). You will need to allow installs from your browser or file
  manager the first time.

Releases are signed with a build-time debug key unless a release keystore is configured, so
Android may refuse to install over a previous version. Uninstall the old one first.

1. Add one or more GPX traces. On Android you can also share a GPX to the app from Komoot, a
   file manager or a mail client.
2. Adjust the margin (default 500 m of map around the trace), whether the pages may rotate,
   whether to print the trace, and the print quality.
3. Check the plan: the preview draws every page footprint, numbered in walking order, over
   the trace, next to the page count and the download size. It follows the settings live,
   because planning costs no network at all.
4. Generate the PDF and choose where to save it.

The preview is the overview. The PDF carries one A4 page per map sheet and nothing else,
unless you turn **Plan d'ensemble dans le PDF** on, which prepends the same plan as a
printed index page. Each map page has:

- the SCAN25 map at exactly 1:25000, at its native 2.5 m per pixel (254 dpi),
- a scale bar whose kilometre is exactly 40 mm, so a ruler can check the print,
- a north arrow showing the page rotation, and the page number,
- tabs naming the page that continues the map off each edge.

Send the whole file to a printer and you get the book in order. Print at 100%, not
fit-to-page, or the scale is no longer 1:25000.

## File size

A Normandy page is about 0.9 MB at the default quality. Three presets trade size against
print quality:

| Preset | JPEG | One A4 page |
|---|---|---|
| Compacte | 60 | 0.79 MB |
| Standard (default) | 72 | 0.93 MB |
| Fine | 85 | 1.24 MB |

Quality is the only lever worth pulling. SCAN25 carries continuous relief shading and about
180 000 distinct colours per page, so an indexed palette would band it. Dropping below the
native 2.5 m per pixel loses more to blurred map text than it saves in bytes: q80 at 200 dpi
is the same size as q60 at 254 dpi and visibly softer.

Chroma subsampling is the one thing the web platform took away. `OffscreenCanvas` gives no
control over it and Chrome subsamples at every quality except 100, where a block costs four
times as much for one step of chroma. The Kotlin build encoded 4:4:4; this one is 4:2:0,
which is why every figure above is roughly half its predecessor. On paper the difference
lives in thin saturated lines, not in place names.

The optional overview page is compressed a step harder than the map pages, since it is an
index rather than something to navigate by, and the vector content streams are Flate
compressed.

## How the page count is minimised

An A4 page with 5 mm printer margins and a 10 mm footer leaves 200 × 277 mm of map, which at
1:25000 is exactly **5000 × 6925 m** of ground. Subtracting the requested margin gives the
rectangle the trace has to fit inside.

The app then searches every rotation from 0° to 179° in 1° steps. For each one it covers the
densified trace with two greedy strategies and keeps the better:

- the longest run of still-uncovered points that fits on one page, swept forwards and
  backwards along the walk;
- repeatedly placing the page that covers the most uncovered points, which is what saves the
  duplicate pages a loop or an out-and-back would otherwise cost.

Redundant pages are then dropped, the survivors re-centred, and adjacent ones merged where
they fit. Ties are broken towards north-up, so a north-south walk still prints north-up.

Rotation matters more than it sounds: a 20 km east-west track needs 5 north-up pages but
only 3 rotated, because a page can swallow a straight run as long as its own diagonal
(7.1 km) rather than its width (4 km).

Minimum rectangle cover is NP-hard, so the result is near-minimal rather than provably
minimal. It matches the brute-force optimum on every small case in the test suite. Plans are
deterministic — the randomised restarts are seeded — which is what lets an interrupted job
replan and land on the tiles it already downloaded.

## Map source and the IGN key

SCAN25 is not open data, so the Géoplateforme serves it from a private endpoint behind a
key. The app ships with `ign_scan_ws`, the shared transitional key IGN published during the
migration to cartes.gouv.fr. That key has a limited life. If it stops working:

- request your own SCAN key at
  [cartes.gouv.fr](https://cartes.gouv.fr/aide/fr/partenaires/ign/representations-cartographiques-souveraines/creation-cles-donnees-scan/)
  and paste it under **Réglages avancés**, or
- switch the source to **Plan IGN**, which is open data and needs no key, though it is not a
  1:25000 topographic map.

| | |
|---|---|
| Layer | `GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR.L93` |
| Tile matrix set | `LAMB93_2.5m`, level 16 |
| Resolution | 2.5 m/px, i.e. 254 dpi at 1:25000 |
| Coverage | Metropolitan France only |

Lambert-93 rather than Web Mercator because its scale is constant across France, so an A4
page is always the same ground rectangle and 1:25000 is literally true.

The tiles are served with `access-control-allow-origin: *`, which is the reason the web app
needs no backend of its own.

## Command line

The same engine runs on Node, which is how PDFs get checked during development:

```
npm ci && npm run build
node packages/cli/dist/main.js --help
node packages/cli/dist/main.js -o cartes.pdf --title "Tour du Mont Blanc" trace.gpx
node packages/cli/dist/main.js --dry-run --explain trace.gpx
```

`--dry-run` reports the plan without downloading anything; `--explain` lists the page count
for every candidate rotation angle; `--index` prepends the printed overview page; `--track`
prints the trace on the map pages. Tiles are cached under `.tilecache/`, so a second run of
the same walk downloads nothing.

## Development

```
npm ci
npm run typecheck                        # all four projects
npx vitest run                           # core and CLI
npm run test --workspace @gpx-to-ign/web # Playwright, against synthetic tiles
npm run dev                              # the web app on :5173
npm run apk --workspace @gpx-to-ign/mobile
```

```
packages/
  core/    pure TypeScript. No DOM, no Node API, no framework.
  web/     React + Vite. The real app, and the desktop experience.
  cli/     Node entry point over core.
  mobile/  Capacitor project wrapping the web build.
```

`core` is the only place any algorithm lives — projection, GPX parsing, page layout,
rendering, the PDF writer, the job. `web`, `cli` and `mobile` supply platform seams and UI.
The two seams are an `ImageCodec` (`OffscreenCanvas` in the browser, Skia on Node) and a
`TileCache` (the Cache API in the browser, files on Node).

Nothing heavy runs on the main thread: planning and the whole job each have a worker.
Planning a 30 km trace takes about 300 ms, which run inline froze the margin slider the live
preview exists to serve.

The PDF writer is hand-rolled rather than a dependency: the app only ever places
already-encoded JPEGs and draws a few lines, so the map is embedded as `DCTDecode` without
recompression. It serialises each page as soon as it is drawn, so a thirty-page book never
holds more than one page of raster in memory.

Leaving the app costs only the time you were away, never the megabytes. Tiles go to the
Cache API as they arrive and finished pages to IndexedDB, so a resumed job replans — which
is deterministic — and downloads only what is missing.

This app was rebuilt from a Kotlin/Compose original. That implementation is tagged
[`kotlin-oracle`](https://github.com/ClemenceAlain/gpx-to-ign/tree/kotlin-oracle); the page
plans it produced for the test fixtures are pinned in
`packages/core/test/layout/fixtures.test.ts`, and the TypeScript port reproduces them
exactly.

### Signing releases with your own key

Optional. Add four repository secrets and the release workflow will use them:
`KEYSTORE_BASE64` (`base64 -w0 your.keystore`), `KEYSTORE_PASSWORD`, `KEY_ALIAS`,
`KEY_PASSWORD`. Without them the APK is signed with a debug key.

## Licence

MIT, see [LICENSE](LICENSE). Map data © IGN — SCAN25® is subject to IGN's own licence terms.
