# SSGG · Split signal

Original vector identity created for the SSGG Linux control app. Two opposed,
rounded signal loops suggest the two sides of ChatMix and a paired-earcup
silhouette. The inner turns also form a compact double-G monogram. The mark
stays the same in color and monochrome; it contains no letters or fine detail
that must be legible at panel size.

The graphite `#20282d` and porcelain `#f8fafb` come from the existing desktop
palette. Mint `#96dfc8` distinguishes the second channel on the graphite icon;
it is an identity color, not a new success/control-state token. No gradients,
shadows, fonts, filters, external images, or network-loaded resources are used.

## Source and license

- **Canonical source:** `ssgg.svg`, authored directly as original SVG geometry.
- **Author:** SSGG contributors, assisted by Hermes Agent.
- **License:** MIT, matching the repository. See `LICENSE` in this directory.
- **Method:** Original hand-specified vector paths, locally rasterized using
  resvg. No image-generation service, stock imagery, icon-library glyph,
  traced manufacturer mark, or product photography was used.
- **Trademark boundary:** This is an independent app identity, not the
  SteelSeries logo and not a statement of endorsement. SteelSeries and ChatMix
  remain their respective owners' names/marks. No trademark clearance is claimed.
- Every generated PNG embeds this source/license/recipe provenance in a PNG
  `Description` text chunk. `proof/verification.json` records the output hashes.

## Asset contract

| Asset | Intended use |
| --- | --- |
| `ssgg.svg` | Canonical full-color 64-unit vector, default 512px size. |
| `ssgg.png` | 512×512 launcher/window icon; transparent outside the graphite shell. |
| `sizes/{16,24,32,48,64,128,256,512}.png` | Native-resolution PNG launcher variants. |
| `ssgg-symbolic.svg` | Single-color, transparent GNOME symbolic icon; same geometry, no shell. |
| `ssgg-tray-light.png` | **White glyph** on transparent, 22×22; use on **dark panels**. |
| `ssgg-tray-dark.png` | **Graphite glyph** on transparent, 22×22; use on **light panels**. |
| `tray/{light,dark}-{16,22,24,32,44}.png` | Matching tray size variants; 44px supports a 22px 2× panel. |
| `proof/contact-sheet.png` | Actual native-size app/panel render comparison; not a runtime asset. |
| `proof/verification.json` | Machine-verified dimensions, alpha coverage, and SHA-256 hashes. |

GNOME integration should install renamed copies under the icon name
`io.github.MrTheSoulz.SSGG`, with the symbolic copy named
`io.github.MrTheSoulz.SSGG-symbolic.svg`. Packaging owns the desktop file and
hicolor installation locations; these assets do not modify the user's icon
cache, launcher, running app, service, audio, or HID configuration.

## Reproduce locally

From the repository root, install pinned **build-only** dependencies in a cache,
not the app manifest or a system package directory:

```sh
npm install --prefix "$HOME/.cache/ssgg-branding-renderer" --no-save --package-lock=false @resvg/resvg-js@2.6.2 sharp@0.34.5
node desktop/scripts/generate-branding.mjs
node desktop/scripts/generate-branding.mjs --check
```

Set `SSGG_BRANDING_RENDERER=/absolute/path/to/cache` to override the dependency
prefix. `--check` performs no writes: it reproduces all shipping rasters and the
symbolic SVG in memory and compares them byte-for-byte against the committed
files. The renderer versions are checked before execution. Neither dependency
is needed at application runtime. The proof sheet uses system sans-serif labels;
shipping icons contain no text and do not depend on installed fonts.

The generator verifies all PNG dimensions, alpha channels, transparent corners,
opaque foreground colors, antialiased edges, embedded provenance, identical
light/dark tray masks, and symbolic/tray parity at 16/22/32px. A bounded visual
review of the proof sheet found no clipped, merged, missing, or invisible marks;
16px remains recognizable as a paired silhouette rather than literal letters.
This is asset-level verification, not a claim of tested desktop integration.
