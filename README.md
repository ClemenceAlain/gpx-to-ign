# gpx-to-ign

Turns GPX traces into one printable multi-page A4 PDF at true 1:25000, cut from the IGN
SCAN25 map, using as few pages as possible. Built for printing hiking maps.

The GPX only decides where the pages go — the trace is never drawn on the map.

## Install

Grab the APK from the [latest release](https://github.com/ClemenceAlain/gpx-to-ign/releases/latest)
and sideload it (Android 8.0 or newer). You will need to allow installs from your browser or
file manager the first time.

Releases are signed with a build-time debug key unless a release keystore is configured, so
Android may refuse to install over a previous version. Uninstall the old one first.

## Use

1. Open the app, tap **Ajouter des GPX**, pick one or more traces. You can also share a GPX
   to the app from any other app.
2. Adjust the margin (default 500 m of map around the trace), whether the pages may rotate,
   and the print quality.
3. Check the page count and download size, then tap **Générer le PDF** and choose where to
   save it.

The PDF opens on an overview page showing every page footprint, numbered, then carries one
A4 page per map sheet. Each map page has:

- the SCAN25 map at exactly 1:25000, at its native 2.5 m per pixel (254 dpi),
- the Lambert-93 kilometre grid, so 1 km is always 40 mm on paper,
- a north arrow showing the page rotation, a scale bar and the page number,
- tabs naming the page that continues the map off each edge.

Send the whole file to a printer and you get the book in order.

## File size

A dense alpine page is about 1.7 MB, so a seven-page book lands near 12 MB. Three presets
trade size against print quality:

| Preset | JPEG | Four-page alpine book |
|---|---|---|
| Compacte | 60 | 6.3 MB |
| Standard (default) | 72 | 7.5 MB |
| Fine | 85 | 10.1 MB |

All three are indistinguishable from the source raster when printed at 254 dpi, and still
hold up under a 3× magnifier; the differences live in the relief shading, not in place
names or contour lines.

Quality is the only lever worth pulling here. SCAN25 carries continuous relief shading and
about 180 000 distinct colours per page, so an indexed palette would band it. Chroma
subsampling would help, but Android's encoder gives no control over it. Dropping below the
native 2.5 m per pixel loses more to blurred map text than it saves in bytes: q80 at 200 dpi
is the same size as q60 at 254 dpi and visibly softer.

The overview page is compressed a step harder than the map pages, since it is an index
rather than something to navigate by, and the vector content streams are Flate compressed.

## How the page count is minimised

An A4 page with 5 mm printer margins and a 10 mm footer leaves 200 × 277 mm of map, which
at 1:25000 is exactly **5000 × 6925 m** of ground. Subtracting the requested margin gives
the rectangle the trace has to fit inside.

The app then searches every rotation from 0° to 179° in 1° steps. For each one it covers
the densified trace with two greedy strategies and keeps the better:

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
minimal. It matches the brute-force optimum on every small case in the test suite.

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

## Command line

The same engine runs on the desktop, which is how the PDFs get checked during development:

```
./gradlew :cli:installDist
./cli/build/install/cli/bin/cli --help
./cli/build/install/cli/bin/cli -o cartes.pdf --title "Tour du Mont Blanc" trace.gpx
./cli/build/install/cli/bin/cli --dry-run --explain trace.gpx
```

`--dry-run` reports the plan without downloading anything; `--explain` lists the page count
for every candidate rotation angle.

## Development

```
./gradlew :core:test              # geodesy, GPX parsing, page cover, PDF writer, renderer
./gradlew :app:testDebugUnitTest  # app logic, plus screenshots of every screen state
./gradlew :app:assembleDebug      # APK at app/build/outputs/apk/debug/
```

There is no emulator in this project's environment, so the UI is checked by rendering it:
`:app:testDebugUnitTest` drives the real Compose tree through Robolectric and writes every
screen state to `app/build/screenshots/`.

- `core` is plain Kotlin on the JVM with no Android dependency: projection, tiles, page
  layout, rendering and the PDF writer all live there and are unit tested.
- `cli` adds an AWT codec and a desktop entry point.
- `app` is a thin Compose shell plus an Android codec and a WorkManager foreground job.

The PDF writer is hand-rolled rather than a dependency: the app only ever places
already-encoded JPEGs and draws a few lines, so the map is embedded as `DCTDecode` without
recompression, and the output is byte-identical on desktop and on a phone. It serialises
each page as soon as it is drawn, so a thirty-page book never holds more than one page of
raster in memory.

### Signing releases with your own key

Optional. Add four repository secrets and the release workflow will use them:
`KEYSTORE_BASE64` (`base64 -w0 your.keystore`), `KEYSTORE_PASSWORD`, `KEY_ALIAS`,
`KEY_PASSWORD`. Without them the APK is signed with a freshly generated debug key.

## Licence

MIT, see [LICENSE](LICENSE). Map data © IGN — SCAN25® is subject to IGN's own licence terms.
