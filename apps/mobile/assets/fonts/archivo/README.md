# Archivo (static instances)

Cut from Google Fonts' Archivo variable font for use with React Native, which
cannot drive a variable font's width (`wdth`) axis at render time (Phase 2
foundation, `docs/design/DESIGN_DIRECTION.md` §9).

**Source:** `https://github.com/google/fonts/blob/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf`
(axes: `wght` 100–900, `wdth` 62–125). Downloaded 2026-09-26.

**Licence:** SIL Open Font License 1.1 — see [`OFL.txt`](OFL.txt) in this
directory (copied verbatim from the same Google Fonts source directory).

## Instances

| File | Family name (fontFamily key) | wdth | wght | Used for |
|---|---|---|---|---|
| `Archivo-Condensed-Black.ttf` | `Archivo-Condensed-Black` | 62 | 900 | `type.score.*` |
| `Archivo-Expanded-ExtraBold.ttf` | `Archivo-Expanded-ExtraBold` | 125 | 800 | `type.tag` |
| `Archivo-Regular.ttf` | `Archivo-Regular` | 100 | 400 | `type.body` |
| `Archivo-Medium.ttf` | `Archivo-Medium` | 100 | 500 | `type.callout`, `type.caption` |
| `Archivo-SemiBold.ttf` | `Archivo-SemiBold` | 100 | 600 | `type.headline` |
| `Archivo-Bold.ttf` | `Archivo-Bold` | 100 | 700 | `type.title` |
| `Archivo-ExtraBold.ttf` | `Archivo-ExtraBold` | 100 | 800 | `type.display` |

Each instance was verified to retain the `tnum` (tabular figures) GSUB
feature — money and scores in `constants/tokens/type.ts` render with
`fontVariant: ['tabular-nums']`, which depends on it.

Total: 7 files, 849,064 bytes (≈829 KiB) added to the app bundle and to the
size of any OTA update that touches them.

## Reproducing

```bash
python3 -m venv venv && source venv/bin/activate
pip install fonttools brotli zopfli

curl -sL -o "Archivo[wdth,wght].ttf" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf"
curl -sL -o OFL.txt \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt"
```

Then, with `Archivo[wdth,wght].ttf` in the working directory:

```python
from fontTools.varLib import instancer
from fontTools.ttLib import TTFont

INSTANCES = [
    ("Archivo-Condensed-Black", {"wdth": 62, "wght": 900}),
    ("Archivo-Expanded-ExtraBold", {"wdth": 125, "wght": 800}),
    ("Archivo-Regular", {"wdth": 100, "wght": 400}),
    ("Archivo-Medium", {"wdth": 100, "wght": 500}),
    ("Archivo-SemiBold", {"wdth": 100, "wght": 600}),
    ("Archivo-Bold", {"wdth": 100, "wght": 700}),
    ("Archivo-ExtraBold", {"wdth": 100, "wght": 800}),
]

for family, axes in INSTANCES:
    font = TTFont("Archivo[wdth,wght].ttf")
    # updateFontNames=False: the source STAT table has no named Axis Value
    # for wdth=62/125 at every weight, so fontTools can't synthesize a name
    # automatically — the name table is set by hand instead (see the repo's
    # instance.py, kept out of the repo, only run from a scratch dir).
    instancer.instantiateVariableFont(font, axes, inplace=True, updateFontNames=False)
    # set name IDs 1/2/4/6/16/17 to `family` / "Regular" here.
    font.save(f"{family}.ttf")
```

The full script (with name-table logic) was run from a throwaway scratchpad
directory, never committed to the repo, per CLAUDE.md's fonttools convention.
Re-run it from scratch if these instances ever need regenerating (e.g. a new
weight or a font update) — do not hand-edit the `.ttf` files.
