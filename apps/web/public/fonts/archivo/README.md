# Archivo Condensed Black: self-hosted Latin subset (landing display face)

`archivo-condensed-black-latin.woff2` (11,620 bytes) is the landing page's display face: every piece of type in
the `type.hero` / `type.score.*` family (62% width, 900 weight). That covers the hero headline, section titles
and scoreboard numbers. It is self-hosted and preloaded from the prerendered HTML, so the condensed face is ready
for the first visible frame and the hero count-up never swaps fonts mid-sequence (Design Lead, phase 3a review,
2026-09-27). Reading text (100% width) and broadcast tags (125%) still come from Google Fonts' Archivo variable
font, loaded asynchronously.

**Licence:** SIL Open Font License 1.1. See [`OFL.txt`](OFL.txt), copied verbatim from Google Fonts' `ofl/archivo/`.
No Reserved Font Name is declared, so the subset may keep the name.

**Provenance:** the static instance `Archivo-Condensed-Black.ttf` (wdth 62, wght 900; SHA-256
`368d4c1695b0afafb1d6a12b3b593f7267a59cb97a4e79a929b392eba22d6de3`) cut by the mobile foundation from
`https://github.com/google/fonts/blob/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf`. Its README
(`apps/mobile/assets/fonts/archivo/README.md`, commit `758ebd9` on `ui/foundation-mobile`) has the instancing
script. This file is that instance, subset to Latin.

## Reproducing (tooling in a scratch directory, never in the repo)

```bash
python3 -m venv venv
./venv/bin/pip install fonttools==4.60.2 brotli

git show 758ebd9:apps/mobile/assets/fonts/archivo/Archivo-Condensed-Black.ttf > Archivo-Condensed-Black.ttf
# or re-cut it from the variable font with the mobile README's instancer script ({"wdth": 62, "wght": 900})

./venv/bin/pyftsubset Archivo-Condensed-Black.ttf \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" \
  --layout-features="kern,liga,clig,calt,ccmp,locl,mark,mkmk,tnum,lnum,case" \
  --flavor=woff2 --no-hinting --desubroutinize \
  --output-file=archivo-condensed-black-latin.woff2
```

The unicode range is Google Fonts' `latin` subset. It includes U+2212 (the minus the money formatter uses) and the
curly quotes the copy uses. `tnum` is kept because scores render with `tabular-nums`. Expected SHA-256 of the output:
`dfa2c75d40b5447850354b557d8b16a8e28f71d6d86766f03a8e1fd7500f7e09`.

Used by `src/pages/landing/landing.css` (`@font-face 'Archivo Display'`) and preloaded by
`scripts/prerender-landing.mjs` (via `DISPLAY_FONT_URL` in `src/pages/landing/head.ts`).
