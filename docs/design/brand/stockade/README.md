# Stockade brand kit

Primary mark: **A · Palisade**. The refined bars recut as three pointed
stakes rising in height, with the tallest in brand blue. Confirmed by
Giorgio on 2026-09-26 (see `docs/design/NAMING.md`, "Decision: Stockade —
CONFIRMED"). Colours are the Game Day tokens (`docs/design/DESIGN_DIRECTION.md`
§9): stadium `#0D1B2E`, brand `#2860F0`, white `#FFFFFF`.

## Files

| File | Use |
|---|---|
| `stockade-lockup.svg` / `stockade-lockup-ongame.svg` | Mark + wordmark, on light / on dark (game) surfaces. The wordmark is **outlined** (paths), so no font is needed |
| `stockade-mark.svg` / `stockade-mark-ongame.svg` | Icon-only mark, on light / on dark |
| `stockade-mark-mono-navy.svg` / `stockade-mark-mono-white.svg` | One-colour mark, for photos, embossing, or when blue isn't available |
| `stockade-app-icon-1024.svg` | **App icon master** (iOS / Expo `icon`). Full-bleed square with no rounding and no transparency; the OS applies its own mask |
| `stockade-android-adaptive-foreground.svg` | Android adaptive icon foreground (transparent; mark inside the safe zone). Background colour: `#0D1B2E` |
| `stockade-apple-touch-icon-180.svg` | Web `apple-touch-icon` (full-bleed; iOS rounds it) |
| `stockade-favicon-32.svg` / `stockade-favicon-16.svg` | Web favicons. The 16px version is hand-simplified and pixel-aligned; don't substitute a scaled-down mark |
| `preview.html` | A contact sheet of everything above |

Wordmark: **Archivo ExtraBold** (width 100, weight 800, `type.display`),
tracked −0.01em, outlined from `apps/mobile/assets/fonts/archivo/Archivo-ExtraBold.ttf`
(OFL, which allows use in a logo). Glyphs are set on advance widths without
kerning pairs; the lockup is final as drawn.

## Usage rules

- **Minimum size:** the mark at **20px tall** or larger; below that, use the
  favicon files (32 / 16), never a scaled-down mark. The lockup at **96px wide**
  or larger.
- **Clear space:** keep a margin of **one stake width (¼ of the mark's width)**
  on every side of the mark or lockup, free of text and other graphics.
- **On light surfaces:** navy stakes + a blue tallest stake (`stockade-mark.svg`).
- **On game / dark surfaces:** white stakes + a blue tallest stake
  (`-ongame`). Blue on stadium is 3.3:1, above the 3:1 needed for graphics.
- **On photos or busy backgrounds:** a mono file (navy or white), whichever
  contrasts more.
- **Don't:** add horizontal rails or make the stakes equal height (that turns
  it into a fence-company logo); recolour the tallest stake in a team or
  gain/loss colour (orange, green, red); rotate, outline, add gradients or
  shadows; retype the wordmark in another font; or put "Stockade" in the
  bundle ID, slug or scheme (those stay as they are; see NAMING.md D.5).
- **Rasterising:** PNG exports (Expo `icon.png`, `adaptive-icon.png`,
  `favicon.ico`, `apple-touch-icon.png`) are made by the rename worker from
  these SVGs, with a tool declared as a devDependency, not a global install.
