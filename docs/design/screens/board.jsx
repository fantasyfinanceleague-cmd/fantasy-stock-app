// The review board around the key screens: one section per screen, each
// with the live component, what it shows, its motion moments (playable),
// and the questions only Giorgio can answer. Then the ledger, computed
// from data.js, proving the numbers tie out.

(function () {
  const { useState, useEffect, useLayoutEffect, useRef } = React;
  const K = window.KS;
  const S = window.KSScreens;
  const $ = (v, o) => K.formatMoney(v, o);
  const $s = (v) => K.formatMoney(v, { sign: 'always' });
  const pct = (v) => K.formatPct(v, { sign: 'always' });

  /** Scales a 402×874 device to its column (never above 1:1). */
  function Fit({ children, caption }) {
    const ref = useRef(null);
    const [k, setK] = useState(1);
    useLayoutEffect(() => {
      const el = ref.current;
      const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / 402)));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    return (
      <figure className="b-fig">
        <div className="b-fit" ref={ref} style={{ height: 874 * k }}>
          <div className="b-fit__in" style={{ transform: `scale(${k})` }}>{children}</div>
        </div>
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  }

  function Play({ label, onPlay, playing }) {
    return (
      <button type="button" className="b-play" onClick={onPlay} aria-pressed={playing}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor" /></svg>
        {label}
      </button>
    );
  }

  function Section({ id, n, name, job, phones, notes }) {
    return (
      <section className="b-sec" id={id} aria-labelledby={`${id}-h`}>
        <header className="b-sec__head">
          <span className="b-sec__n">{n}</span>
          <div>
            <h2 id={`${id}-h`}>{name}</h2>
            <p className="b-job">{job}</p>
          </div>
        </header>
        <div className={phones.length > 1 ? 'b-sec__grid b-sec__grid--two' : 'b-sec__grid'}>
          <div className="b-phones">{phones}</div>
          <div className="b-notes">{notes}</div>
        </div>
      </section>
    );
  }

  function Notes({ shows, motion, reduced, ask }) {
    return (
      <>
        <h3>On screen</h3>
        <ul>{shows.map((s, i) => <li key={i}>{s}</li>)}</ul>
        <h3>Motion</h3>
        <ul className="b-motion">{motion}</ul>
        <p className="b-reduced"><b>Reduce Motion:</b> {reduced}</p>
        {ask ? (
          <div className="b-ask">
            <h3>Your call</h3>
            <ul>{ask.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        ) : null}
      </>
    );
  }

  // One replayable moment: toggles a boolean for `ms`, then settles.
  function useMoment(initial) {
    const [v, setV] = useState(initial);
    const [n, setN] = useState(0);
    return [v, n, (next) => { setV(next); setN((x) => x + 1); }];
  }

  // ── Themes: one design, two complete themes ───────────────────────────
  // Both tables are apps/mobile/constants/tokens/contrastPairs.ts, row for row, with each
  // ThemeColors key in the board's kebab form (`text2` → `text-2`). Keep them identical:
  // add a pair there AND here when a component puts text or a graphic on a fill.
  const TOKEN_ROWS = [
    // [token, role, min contrast vs surface (text 4.5, graphics 3, 0 = unscored)]
    ['text', 'Primary text', 4.5],
    ['text-2', 'Secondary text', 4.5],
    ['accent', 'Links, accent text', 4.5],
    ['you-text', 'Your name / score text', 4.5],
    ['opp-text', 'Opponent text', 4.5],
    ['live-text', 'Live tags', 4.5],
    ['gain', 'Money up', 4.5],
    ['loss', 'Money down', 4.5],
    ['zero', 'Money flat', 4.5],
    ['danger', 'Errors', 4.5],
    ['you', 'Your fills (tug, avatar)', 3],
    ['opp', 'Opponent fills', 3],
    ['live', 'Live dot, clock ring', 3],
    ['border-strong', 'Control borders', 3],
    // Disabled/decorative text ONLY, never information — measured, not scored.
    ['text-3', 'Disabled / decorative text ONLY, never information', 0],
    // Medals (§9A, season complete only): each disc is a graphic on the surface.
    ['medal-gold', 'Medal disc, gold, on the surface', 3],
    ['medal-silver', 'Medal disc, silver, on the surface', 3],
    ['medal-bronze', 'Medal disc, bronze, on the surface', 3],
  ];
  // Every foreground-on-fill pair the components actually render, with the
  // background it really sits on. rgba tints are composited over `over`.
  // [fg token, bg token, over (for translucent bgs), min, where it's used]
  const PAIRS = [
    // §9C: `onAccent` split — fills that take white in BOTH themes (you, loss-fill) read `onYou`.
    ['on-you', 'you', null, 4.5, 'Avatar initials, winner banner, filled roster slots'],
    ['on-opp', 'opp', null, 4.5, 'Opponent avatar initials'],
    ['on-you', 'loss-fill', null, 4.5, 'Sell button label'],
    ['primary-fg', 'primary-bg', null, 4.5, 'Primary button label'],
    ['inverse-fg', 'inverse-bg', null, 4.5, 'FINAL chip, selected toggle'],
    ['secondary-fg', 'secondary-bg', 'surface', 4.5, 'Secondary button label'],
    ['text', 'inset', null, 4.5, 'Chips, draft cells, search field, panels'],
    ['text-2', 'inset', null, 4.5, 'Chip meta, race-chart day labels'],
    ['live-text', 'inset', null, 4.5, 'LIVE chip'],
    // 3b-1 carry-over, fixed 3b-2: the header phase chip's `inset` fill was
    // nearly invisible against `bg` in Light (#F0F3F7 vs #F3F5F8) — the chip
    // sits on the PAGE background there, not a card, so it now uses
    // `surface` + a hairline instead (PhaseChip's `onPageBackground` prop,
    // ShellHeader — retrofits Matchup/League/Portfolio's header chip too).
    ['live-text', 'surface', null, 4.5, 'Broadcast tags on cards, and the header chip on the page background (3b-2 retrofit)'],
    ['text', 'surface', null, 4.5, 'Default-style header chip on the page background (3b-2 retrofit)'],
    ['text-2', 'sunken', null, 4.5, 'Segmented-control labels'],
    ['text', 'bg', null, 4.5, 'Screen text'],
    ['text-2', 'bg', null, 4.5, 'Captions on the screen background'],
    ['gain', 'bg', null, 4.5, 'Gain on the screen background (Home hero)'],
    ['loss', 'bg', null, 4.5, 'Loss on the screen background'],
    ['danger', 'bg', null, 4.5, 'Field errors on the screen background (3b-1 auth, username)'],
    ['gain', 'inset', null, 4.5, 'Gain inside panels'],
    ['loss', 'inset', null, 4.5, 'Loss inside panels (3b-1 onboarding FINAL vignette)'],
    ['accent', 'accent-tint', 'surface', 4.5, 'Selected web nav, icon tiles'],
    ['gain', 'gain-tint', 'surface', 4.5, 'Cash tile "$", done check'],
    ['text', 'you-tint', 'surface', 4.5, 'Your standings row'],
    ['accent', 'tabbar', 'bg', 4.5, 'Active tab label'],
    ['text-2', 'tabbar', 'bg', 4.5, 'Inactive tab labels'],
    ['warn-text', 'warn-tint', 'bg', 4.5, '"Your call" notes'],
    ['text', 'warn-tint', 'bg', 4.5, 'Draft blockers card: title and lines (on the page)'],
    ['text', 'warn-tint', 'surface', 4.5, 'Text on the warn tint over a surface (no current use: the signups and bye notes read warnText since W4 Onboarding)'],
    // W4 Portfolio: the money sheet's warn panel on the sheet's surface (Light 6.23, Dark 9.56).
    ['warn-text', 'warn-tint', 'surface', 4.5, 'Money sheet warn panel (refusals, pre-review blocks)'],
    ['live', 'inset', null, 3, 'Live dot inside a LIVE chip (graphic)'],
    ['text', 'line', null, 4.5, 'Initials on a neutral (other manager) avatar'],
    ['text-2', 'line', null, 4.5, 'Neutral "?" avatar fallback'],
    ['on-you', 'you', null, 3, 'Chevrons on the drawn draft track (graphic)'],
    ['surface', 'live', null, 3, 'Trophy icon on the champion badge (graphic)'],
    // Medals: the rank numeral on each disc (text, 4.5)...
    ['on-medal', 'medal-gold', null, 4.5, 'Medal rank numeral on the gold disc'],
    ['on-medal', 'medal-silver', null, 4.5, 'Medal rank numeral on the silver disc'],
    ['on-medal', 'medal-bronze', null, 4.5, 'Medal rank numeral on the bronze disc'],
    // ...and each disc on the caller's you-tint row, composited over the surface (graphic, 3).
    ['medal-gold', 'you-tint', 'surface', 3, 'Medal disc, gold, on the you-tint row (graphic)'],
    ['medal-silver', 'you-tint', 'surface', 3, 'Medal disc, silver, on the you-tint row (graphic)'],
    ['medal-bronze', 'you-tint', 'surface', 3, 'Medal disc, bronze, on the you-tint row (graphic)'],
    // Your turn (Design Lead, 2026-10-06; board #your-turn): the flash fills the clock card with
    // live gold, text in on-live; at rest the card is warn-tint with the title in liveText.
    // W4 Draft (§9C, accent-tint = "your-turn card at rest"): the rest moved to the accent tint
    // over the page; the title there is the LIVE chip row's pair (live-text on accent-tint over
    // bg), and the round line, the captions and the last-10 s clock are these three.
    ['on-live', 'live', null, 4.5, 'Your-turn flash: text on the live fill'],
    ['text', 'accent-tint', 'bg', 4.5, 'Your-turn rest: the round line and the clock on the accent-tint card'],
    ['text-2', 'accent-tint', 'bg', 4.5, 'Your-turn rest: the captions on the accent-tint card'],
    ['loss', 'accent-tint', 'bg', 4.5, 'Your-turn rest: the clock in the last 10 seconds'],

    // ── Game Night, §9C v3.1 (2026-10-12): the 49 new scored pairs. §9C names them by group
    // (your side on the card surface and on the page, the clock cell, the money page, the
    // "Yours" pill, the accent fill, your ring, the owner's avatar disc, the 11 category pills
    // and the 11 category lines on the tile and on an inset); these are those groups row by
    // row. The owner's avatar disc is the existing `onOpp` on `opp` row above, and your text on
    // your card-surface half is the existing "Your standings row" row. The board's PAIRS must
    // carry the same rows.
    // Your side, shaded in your colour, win or lose (shading B): on the card surface (your
    // Scoreboard half, your Standings row)...
    ['text-2', 'you-tint', 'surface', 4.5, 'Your side on a card: secondary text (your Scoreboard half, your Standings record)'],
    ['gain', 'you-tint', 'surface', 4.5, 'Your side on a card: gain (your Standings season gain, movement up)'],
    ['loss', 'you-tint', 'surface', 4.5, 'Your side on a card: loss (your Standings season gain, movement down)'],
    // ...and on the page (your roster column, its slab off the screen edge).
    ['text', 'you-tint', 'bg', 4.5, 'Your roster column: your ticker'],
    ['text-2', 'you-tint', 'bg', 4.5, 'Your roster column: company and week %'],
    ['gain', 'you-tint', 'bg', 4.5, 'Your roster column: week gain'],
    ['loss', 'you-tint', 'bg', 4.5, 'Your roster column: week loss'],
    // The draft's on-the-clock cell.
    ['on-clock-cell', 'clock-cell', null, 4.5, 'Draft: the clock in the on-the-clock cell'],
    ['clock-cell-live', 'clock-cell', null, 4.5, 'Draft: the pick number (and its ring) in the on-the-clock cell'],
    // The money page (Portfolio, the stock sheet's screen).
    ['text', 'money-bg', null, 4.5, 'Money page: the value and rows'],
    ['text-2', 'money-bg', null, 4.5, 'Money page: captions'],
    ['gain', 'money-bg', null, 4.5, 'Money page: gain'],
    ['loss', 'money-bg', null, 4.5, 'Money page: loss'],
    // The "Yours" pill on the player card (the sheet's surface).
    ['you-text', 'you-tint', 'surface', 4.5, 'Player card: the "Yours" pill'],
    // The accent fill (the money range pills, the Draft button).
    ['on-accent', 'accent', null, 4.5, 'Filled accent pill: the money range pills, the Draft button'],
    // Your ring: the 2pt `you` ring sits across a 2pt `bg` gap, so it reads against the page.
    ['you', 'bg', null, 3, 'Your avatar ring across its bg gap (graphic)'],
    // The owner's avatar disc against the "Owned by" pill it sits in (§9C; the board draws it).
    ['opp', 'inset', null, 3, 'Owner avatar disc in the "Owned by" pill (graphic)'],
    // The 11 category pills (text on the fill)...
    ['on-cat', 'cat-tech', null, 4.5, 'Category pill: Tech'],
    ['on-cat', 'cat-finance', null, 4.5, 'Category pill: Finance'],
    ['on-cat', 'cat-health', null, 4.5, 'Category pill: Health'],
    ['on-cat', 'cat-energy', null, 4.5, 'Category pill: Energy'],
    ['on-cat', 'cat-transport', null, 4.5, 'Category pill: Autos'],
    ['on-cat', 'cat-retail', null, 4.5, 'Category pill: Retail'],
    ['on-cat', 'cat-food', null, 4.5, 'Category pill: Food'],
    ['on-cat', 'cat-media', null, 4.5, 'Category pill: Media'],
    ['on-cat', 'cat-industrials', null, 4.5, 'Category pill: Industry'],
    ['on-cat', 'cat-real-estate', null, 4.5, 'Category pill: Property'],
    ['on-cat', 'cat-misc', null, 4.5, 'Category pill: Misc'],
    // ...the 11 category lines on the draft tile's surface (graphic)...
    ['cat-tech', 'surface', null, 3, 'Draft tile: the TEC line (graphic)'],
    ['cat-finance', 'surface', null, 3, 'Draft tile: the FIN line (graphic)'],
    ['cat-health', 'surface', null, 3, 'Draft tile: the HLT line (graphic)'],
    ['cat-energy', 'surface', null, 3, 'Draft tile: the NRG line (graphic)'],
    ['cat-transport', 'surface', null, 3, 'Draft tile: the AUT line (graphic)'],
    ['cat-retail', 'surface', null, 3, 'Draft tile: the RTL line (graphic)'],
    ['cat-food', 'surface', null, 3, 'Draft tile: the F&B line (graphic)'],
    ['cat-media', 'surface', null, 3, 'Draft tile: the MED line (graphic)'],
    ['cat-industrials', 'surface', null, 3, 'Draft tile: the IND line (graphic)'],
    ['cat-real-estate', 'surface', null, 3, 'Draft tile: the PRP line (graphic)'],
    ['cat-misc', 'surface', null, 3, 'Draft tile: the MSC line (graphic)'],
    // ...and on an inset (graphic).
    ['cat-tech', 'inset', null, 3, 'The Tech line on an inset (graphic)'],
    ['cat-finance', 'inset', null, 3, 'The Finance line on an inset (graphic)'],
    ['cat-health', 'inset', null, 3, 'The Health line on an inset (graphic)'],
    ['cat-energy', 'inset', null, 3, 'The Energy line on an inset (graphic)'],
    ['cat-transport', 'inset', null, 3, 'The Autos line on an inset (graphic)'],
    ['cat-retail', 'inset', null, 3, 'The Retail line on an inset (graphic)'],
    ['cat-food', 'inset', null, 3, 'The Food line on an inset (graphic)'],
    ['cat-media', 'inset', null, 3, 'The Media line on an inset (graphic)'],
    ['cat-industrials', 'inset', null, 3, 'The Industry line on an inset (graphic)'],
    ['cat-real-estate', 'inset', null, 3, 'The Property line on an inset (graphic)'],
    ['cat-misc', 'inset', null, 3, 'The Misc line on an inset (graphic)'],

    // W3's own, beyond §9C's 49 — the Chip renders text and a dot on its tint (§9C "Chip":
    // accentTint + liveText, the dot drawn), on the page (the header) and on cards / sheets.
    ['live-text', 'accent-tint', 'bg', 4.5, 'LIVE chip on the page background'],
    ['live-text', 'accent-tint', 'surface', 4.5, 'LIVE chip on a card or sheet'],
    ['live', 'accent-tint', 'bg', 3, 'Live dot inside the LIVE chip (graphic)'],
  ];
  function readTheme(theme) {
    const el = document.createElement('div');
    el.setAttribute('data-ks-theme', theme);
    el.style.display = 'none';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = {};
    const names = new Set(TOKEN_ROWS.map((r) => r[0]).concat(['surface', 'bg']));
    for (const p of PAIRS) { names.add(p[0]); names.add(p[1]); if (p[2]) names.add(p[2]); }
    for (const t of names) out[t] = cs.getPropertyValue(`--c-${t}`).trim();
    el.remove();
    return out;
  }
  /** '#RRGGBB' | 'rgba(r, g, b, a)' | 'transparent' → [r, g, b, a] (0–255, 0–1). */
  function parse(c) {
    if (c === 'transparent') return [0, 0, 0, 0];
    if (c.startsWith('#')) { const h = c.slice(1); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)).concat(1); }
    const m = c.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m[3] ?? 1];
  }
  /** Composite `top` over opaque `base` → opaque [r, g, b]. */
  const over = (top, base) => { const t = parse(top), b = parse(base); return [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])); };
  function lumRGB(rgb) {
    return rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  const ratio = (fgRGB, bgRGB) => { const x = lumRGB(fgRGB), y = lumRGB(bgRGB); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const contrast = (a, b) => ratio(over(a, b), over(b, '#FFFFFF'));
  /** A pair's real ratio: the bg composited over its base, then the fg over that. */
  function pairRatio(T, fg, bg, base) {
    const bgRGB = base ? over(T[bg], T[base]) : over(T[bg], '#FFFFFF');
    const hex = '#' + bgRGB.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return ratio(over(T[fg], hex), bgRGB);
  }

  function ThemesSection() {
    const [vals, setVals] = useState(null);
    useEffect(() => { setVals({ light: readTheme('light'), dark: readTheme('dark') }); }, []);
    const cell = (t, tok, min) => {
      const v = vals[t][tok], c = contrast(v, vals[t].surface);
      return <td><span className="b-swatch" style={{ background: v }} />{v} <span className={min === 0 ? '' : c >= min ? 'b-pass' : 'b-fail'}>{c.toFixed(2)}</span></td>;
    };
    const pairCell = (t, [fg, bg, base, min]) => {
      const T = vals[t], c = pairRatio(T, fg, bg, base);
      return <td><span className="b-swatch" style={{ background: T[fg], outline: `3px solid ${T[bg]}` }} /><span className={c >= min ? 'b-pass' : 'b-fail'}>{c.toFixed(2)}</span></td>;
    };
    const scored = vals ? ['light', 'dark'].flatMap((t) => [
      ...TOKEN_ROWS.filter((r) => r[2] > 0).map(([tok, , min]) => contrast(vals[t][tok], vals[t].surface) >= min),
      ...PAIRS.map((p) => pairRatio(vals[t], p[0], p[1], p[2]) >= p[3]),
    ]) : [];
    const passed = scored.filter(Boolean).length;
    return (
      <section className="b-sec" id="themes" aria-labelledby="themes-h">
        <header className="b-sec__head">
          <span className="b-sec__n">◐</span>
          <div>
            <h2 id="themes-h">One design, two themes</h2>
            <p className="b-job">Every screen is entirely Light or entirely Dark. Same layout, same components, same names; only the values change. Use the switch at the top right to see every screen in either theme.</p>
          </div>
        </header>
        <div className="b-tokens">
          <ul className="b-inv__notes" style={{ margin: 0 }}>
            <li><b>The values are Game Night v3.1</b> (DESIGN_DIRECTION §9C, 2026-10-12): the app's <code>color.ts</code> key for key, and the table below is the app's <code>contrastPairs.ts</code> row for row. The 1.2.0 screens on this board now take these colours but keep their 1.2.0 shapes until W4 redraws them; the Game Night frames are under Approved screens.</li>
            <li><b>Never a dark card inside a light screen, or the reverse.</b> Money screens (Portfolio, the stock sheet) have their own page, <code>--c-money-bg</code>: near-black in Dark, the white surface in Light.</li>
            <li><b>Emphasis:</b> ExtraBold 800 game numbers, your side shaded in your colour win or lose (<code>--c-you-tint</code>), the cyan accent (deep teal in Light) for live and your turn, and motion. Depth: in Dark, lightness steps of one hue and no shadows; in Light, white cards with a 1pt rim on the tinted page, and only the sheet casts a shadow.</li>
            <li><b>Every fill has its own ink:</b> <code>--c-on-accent</code> is dark in Dark and white in Light; <code>--c-on-you</code> is white in both; the 11 category pills read <code>--c-on-cat</code>; the on-the-clock cell reads <code>--c-on-clock-cell</code>.</li>
            <li><b>Rules that still hold:</b> you are blue; the opponent is marked by position (the right-hand side) on a slate, not by colour; data colours mark money (gain green, loss red, zero grey, never green).</li>
            <li><b>Settings:</b> Profile › Appearance, with System, Light and Dark; System is the default and the choice is saved on the device. All three options stay (your call).</li>
          </ul>
          {vals ? (
            <p className="b-changed" style={{ margin: 0 }}>
              <b>{passed} of {scored.length} checks pass</b>: {TOKEN_ROWS.filter((r) => r[2] > 0).length} tokens against the card surface, and {PAIRS.length} foreground-on-fill pairs exactly as the components render them, each in both themes. Translucent tints are measured composited over what they sit on. <code>--c-text-3</code> is measured but not scored: it is for disabled or decorative text only, never information.
            </p>
          ) : null}
          {vals ? (
            <div className="b-table-wrap">
              <table className="b-table">
                <thead><tr><th scope="col">Token</th><th scope="col">Role</th><th scope="col">Light (contrast on surface)</th><th scope="col">Dark (contrast on surface)</th><th scope="col">Needs</th></tr></thead>
                <tbody>
                  {TOKEN_ROWS.map(([tok, role, min]) => (
                    <tr key={tok}><th scope="row">--c-{tok}</th><td>{role}</td>{cell('light', tok, min)}{cell('dark', tok, min)}<td>{min ? `${min}:1` : 'n/a (disabled only)'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {vals ? (
            <div className="b-table-wrap">
              <table className="b-table">
                <thead><tr><th scope="col">Text or icon</th><th scope="col">On</th><th scope="col">Where</th><th scope="col">Light</th><th scope="col">Dark</th><th scope="col">Needs</th></tr></thead>
                <tbody>
                  {PAIRS.map((p, i) => (
                    <tr key={i}><th scope="row">--c-{p[0]}</th><td>--c-{p[1]}{p[2] ? ` over ${p[2]}` : ''}</td><td>{p[4]}</td>{pairCell('light', p)}{pairCell('dark', p)}<td>{p[3]}:1</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 800, fontStretch: '125%', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c-text-2)' }}>Component API changes (foundation, PR #53 + web)</h3>
            <ul className="b-inv__notes" style={{ margin: 0 }}>
              <li><code>&lt;Surface kind="money" | "game"&gt;</code> → removed. A <code>ThemeProvider</code> at the root supplies <code>theme: 'light' | 'dark'</code> (System resolves via <code>useColorScheme()</code> on mobile and <code>prefers-color-scheme</code> on web). Cards use one <code>&lt;Card&gt;</code> (with a <code>variant="scoreboard"</code> that adds the accent wash).</li>
              <li>Tokens: every <code>*.onGame</code> leaf is deleted (<code>text.onGame.*</code>, <code>team.you.onGame</code>, <code>data.gain/loss/zero.onGame</code>, <code>action.*.onGame</code>, <code>surface.game.*</code>, <code>surface.money.*</code>). They are replaced by the semantic set in this table, one value per theme. New leaves: <code>*-text</code> cuts, <code>inset</code>, <code>track</code>, <code>scrim</code>, <code>tabbar</code>, <code>inverse</code>.</li>
              <li><code>Button</code>: drop the on-game variant; <code>primary</code> reads <code>primary.bg/fg</code> from the theme (navy on Light, white on Dark).</li>
              <li><code>ScoreDigits</code>, <code>Scoreboard</code>/<code>TeamRow</code>, <code>TugBar</code>, <code>Chyron</code>, <code>LiveDot</code>, <code>PhaseChip</code>, <code>SegmentedControl</code>, <code>Sheet</code>, <code>EmptyState</code>, <code>Money</code>: any prop or style that picks an <code>onGame</code> colour or checks <code>surface === 'game'</code> goes; they read theme tokens only. <code>Money</code>'s gain/loss/zero colours come from the theme.</li>
              <li>Web: <code>tokens.css</code> gains <code>[data-theme="light"]</code> / <code>[data-theme="dark"]</code> blocks with these values (the app sets the attribute from Settings; System uses the media query). <code>tokens.parity.test.ts</code> checks both themes leaf by leaf.</li>
              <li>Tests to add: a contrast test that asserts BOTH tables for both themes, token-on-surface and every foreground-on-fill pair above (same pair list, tints composited over their base), so a token edit can't silently fail AA. A new component that puts text on a fill adds its pair to the list.</li>
            </ul>
          </div>
        </div>
      </section>
    );
  }

  function ThemeBar({ theme, setTheme }) {
    return (
      <div className="b-themebar">
        <div className="b-themebar__in" role="group" aria-label="Board theme">
          <span>Theme</span>
          {['light', 'dark'].map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>{t === 'light' ? 'Light' : 'Dark'}</button>
          ))}
        </div>
      </div>
    );
  }

  // ── Waiting on you: ONLY the open calls, newest first (Giorgio, 2026-10-12). ──
  const OPEN = [
  ];
  // ── The Archive: every decided call, newest first, stamped. A call moves here the moment
  // its decision is recorded in PRODUCT_RULES. `render` resolves to the section's component. ──
  const ARCHIVE = [
    { id: 'call-ob-arrival', title: 'The invite arrival before sign-in', decision: 'B with C1: before sign-in, only "{inviter} invited you to {league}" and the three sign-ins (the no-sign-in preview returns only the name, the inviter and the refusal reason); the facts (Managers, Stakes, Season; the web adds Draft) move to "You\'re in {league}". A dead link shows only the panel and "Sign in".', date: '2026-10-14', rec: 'PRODUCT_RULES (Onboarding)', render: () => window.KSObArrivalArchived },
    { id: 'call-ob-cards', title: 'The three onboarding cards\' scenes', decision: 'B: the real screens (the draft squares, the Matchup scoreboard with the lead changing, FINAL with the real scoreboard). The titles stay as approved on 2026-09-29.', date: '2026-10-14', rec: 'PRODUCT_RULES (Onboarding)', render: () => window.KSObCardsArchived },
    { id: 'call-ob-username', title: 'The suggested username\'s style', decision: 'None of the three drawn: an Xbox-style gamertag, an adjective or word + an animal + digits ("HelpfulHornet151"), never a first name or anything from Apple, Google or the email. "You can change it later in Profile." approved.', date: '2026-10-14', rec: 'PRODUCT_RULES (Onboarding)', render: () => window.KSObUsernameArchived },
    { id: 'call-share-locked', title: 'The invite code\'s Share while teams are locked', decision: 'B: Share is hidden while teams are locked (from an hour before the draft until the season ends); the code stays visible; Share is back at renewal and before the draft. The commissioner too.', date: '2026-10-13', rec: 'PRODUCT_RULES (on feat/gn-w4-league)', render: () => window.KSShareLockedArchived('B', <li><b>Decided by Giorgio (2026-10-13): B</b>, from this image: Share hidden while teams are locked, the code still shown, for the commissioner as for everyone.</li>) },
    { id: 'call-draft-auto', title: 'Marking an auto-pick on the draft board', decision: 'A, as built: no tag on an auto-picked square ("no auto tag"). The card, the pick log and VoiceOver still say it.', date: '2026-10-13', rec: 'PRODUCT_RULES (on feat/gn-w4-draft)', render: () => window.KSDraftAutoArchived },
    { id: 'call-mx-order', title: 'Saying why the Matchup rows are in this order', decision: 'B: one small line over the rows, "Ordered by Wednesday\'s close" (the last close whose trading has ended; "Thursday\'s close" from that evening).', date: '2026-10-13', rec: 'PRODUCT_RULES (Matchup: four states)', render: () => window.KSMxCalls.order },
    { id: 'call-mx-empty', title: 'How an empty slot reads', decision: 'B: the empty half keeps its row, with a dashed edge and "Empty"; yours keeps your shade.', date: '2026-10-13', rec: 'PRODUCT_RULES (Matchup: four states)', render: () => window.KSMxCalls.empty },
    { id: 'call-mx-bye', title: 'The bye week', decision: 'B: your half of the scoreboard, "Bye week" in the opponent\'s half, the shipped "Bye week · no result" line, then your stocks in one column.', date: '2026-10-13', rec: 'PRODUCT_RULES (Matchup: four states)', render: () => window.KSMxCalls.bye },
    { id: 'call-mx-withheld', title: 'A final whose stock-by-stock results can\'t be shown', decision: 'B: "Stock-by-stock results aren\'t available for this week." and both lineups as ticker and company, no figures, draft order, your side shaded.', date: '2026-10-13', rec: 'PRODUCT_RULES (Matchup: four states)', render: () => window.KSMxCalls.withheld },
    { id: 'call-shading', title: 'The Matchup shading, and the 11 category names', decision: 'B: your side is always shaded in your colour, win or lose ("it\'s you … Not whoever\'s winning"); no row-winner lighting. The 11 categories with their short names and 3-letter codes as drawn.', date: '2026-10-12', rec: 'docs/rules-redesign-decisions', render: () => window.KSShadingArchived },
    { id: 'call-redesign-answers', title: 'The redesign\'s open questions', decision: '"Go with your recommendations": cyan your turn; "Since the draft"; the Portfolio chart; two end dates on Home; price per share; the navy clock cell; the owner\'s avatar on the card; 1.3, one build.', date: '2026-10-12', rec: 'docs/rules-redesign-decisions', render: () => window.KSRedesignAnswers },
    { id: 'call-direction', title: 'The direction', decision: 'A, Game Night, for Home, Matchup, Standings and Portfolio; the draft tiles take Broadcast\'s line at the bottom; no small lines on rows; the centre column empty. B closed ("doing a little too much"), C closed ("a little too robotic").', date: '2026-10-12', rec: 'docs/rules-direction-game-night', render: () => window.KSDirectionsArchived },
    { id: 'call-row-order', title: 'The order of the Matchup rows', decision: 'Best week first; slotted leagues (categories and price tiers) grouped by slot; re-ordered at each market close, never live.', date: '2026-10-12', rec: 'PR #229 (rules) · #230 (board)', render: () => window.KSRowOrder },
    { id: 'call-calm-home', title: 'A calmer Home', decision: 'A, same content, calmer, in every state as drawn.', date: '2026-10-12', rec: 'PR #218 (rules) · #219 (board) · #222 (build)', render: () => window.KSHomeCalm },
    { id: 'call-leaver-names', title: 'Managers who left, in past seasons', decision: 'A with frozen names: they stay named in the seasons they played, frozen as they were when they left.', date: '2026-10-11', rec: 'PR #203 (rules) · #204 (board)' },
    { id: 'call-join-commissioner', title: "The commissioner's name before you join", decision: 'A: the Join preview names nobody, not even the commissioner.', date: '2026-10-11', rec: 'PR #202' },
    { id: 'call-medals', title: 'Who gets the gold once the season is over', decision: 'A: medals follow the playoffs; records stay the regular season\'s.', date: '2026-10-10', rec: 'PR #191' },
    { id: 'call-sell-from-search', title: 'Selling a stock you own, found through search', decision: 'A: a stock you hold can be sold from any sheet, search included.', date: '2026-10-10', rec: 'PR #188 (rules) · #190 (board)' },
    { id: 'call-watchlist', title: 'The watchlist and daily claims', decision: 'C, plus rulings (a)–(d): a Watchlist tab in Buy a stock and "Watching" on Portfolio; claims while the market is closed.', date: '2026-10-09', rec: 'PR #185 (plan) · #193 (board)' },
    { id: 'call-manager-row', title: 'One manager row everywhere', decision: 'S-10: your name bold with the blue tint; no "(you)"; movement arrows on League only.', date: '2026-10-08', rec: 'PR #179 · #180' },
    { id: 'call-ux-pass1', title: 'Two fixes from the UX audit', decision: 'B and B: the draft time commits on a full-width button; "Set draft time" is Home\'s primary when no time is set.', date: '2026-10-06', rec: 'PR #140' },
    { id: 'your-turn', title: 'Your turn must be unmissable', decision: 'The top flashes, a buzz and a chime, once per turn; the gold rest state.', date: '2026-10-06', rec: 'PR #156' },
    { id: 'call-auto-start', title: 'The draft starts by itself', decision: 'The room opens at T−1h; not ready then means postponed, never a late start.', date: '2026-10-06', rec: 'PR #128' },
    { id: 'call-leave', title: 'Leaving a league', decision: 'Only before the season (until T−1h) or after it; the commissioner reconfirms; Stay stays a button.', date: '2026-10-06', rec: 'PRODUCT_RULES · League lifecycle' },
    { id: 'call-tier-trades', title: 'Which tier a traded stock fills', decision: 'A: replace in the same tier ("Fills your $100–$200 slot").', date: '2026-10-06', rec: 'PR #114' },
    { id: 'run-it-back', title: 'Run it back', decision: 'Opt-in: every Season 1 player answers; the commissioner reconciles; always a new draft.', date: '2026-10-04', rec: 'commit 4538f60f' },
  ];
  function Archive() {
    const calls = window.KSArchivedCalls || {};
    return (
      <section className="b-sec b-archive" id="archive" aria-labelledby="archive-h">
        <header className="b-sec__head">
          <span className="b-sec__n">✓</span>
          <div>
            <h2 id="archive-h">Archive: calls you've made</h2>
            <p className="b-job">Newest first. Each one is closed; open it to see the mockups as you decided them. The decision itself lives in PRODUCT_RULES.md.</p>
          </div>
        </header>
        <div className="b-archive__list">
          {ARCHIVE.map((a) => {
            const C = a.render ? a.render() : calls[a.id];
            return (
              <details key={a.id} className="b-arch" id={`arch-${a.id}`}>
                <summary>
                  <span className="b-arch__t">{a.title}</span>
                  <span className="b-arch__d">{a.decision}</span>
                  <span className="b-arch__m">Decided {a.date} · {a.rec}</span>
                </summary>
                <div className="b-arch__body">{C ? <C /> : <p className="b-job">Section not found.</p>}</div>
              </details>
            );
          })}
        </div>
      </section>
    );
  }

  function Board() {
    const [theme, setThemeState] = useState(() => document.documentElement.dataset.ksTheme || 'light');
    const setTheme = (t) => {
      setThemeState(t);
      document.documentElement.dataset.ksTheme = t;
      try { localStorage.setItem('ks-theme', t); } catch (e) { /* private mode: board still switches */ }
    };
    const [homeRun, homeN, setHome] = useMoment(false);
    const [final, finalN, setFinal] = useMoment(false);
    const [after, afterN, setAfter] = useMoment(true);
    const [landed, landedN, setLanded] = useMoment(false);
    const [sheet, sheetN, setSheet] = useMoment(false);
    const L = K.MATCHUP.live, F = K.MATCHUP.final;

    return (
      <main className="b-page">
        <ThemeBar theme={theme} setTheme={setTheme} />
        <header className="b-hero">
          <div className="b-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1" fill="var(--c-text-2)" /><rect x="9.75" y="9" width="4.5" height="12" rx="1" fill="var(--c-text-2)" /><rect x="16.5" y="4" width="4.5" height="17" rx="1" fill="var(--c-you)" /></svg>
            <span>Stockpile</span>
            <span className="b-brand__meta">Design board · updated 12 Oct 2026</span>
          </div>
          <h1>Your calls, then the app.</h1>
          <p className="b-lead">
            The board in three parts. <b>Waiting on you</b> comes first: only the calls you
            haven't made yet, newest first. Then the <b>approved screens</b>, the reference the app
            is built from. Every call you've already made is in the <b>Archive</b> at the end,
            closed, with what you decided, when, and where it was recorded.
          </p>
          <dl className="b-canon">
            <div><dt>League</dt><dd>{K.LEAGUE.name} · 6 managers</dd></div>
            <div><dt>Moment</dt><dd>Week 6 of 14 · Thu 1:37 PM ET</dd></div>
            <div><dt>You</dt><dd>Roberto B. vs Gianluigi B.</dd></div>
            <div><dt>Stakes</dt><dd>$2,000 per slot · 6 slots</dd></div>
          </dl>
          <div className="b-open" aria-label="Waiting on you">
            <span className="b-open__lbl">Waiting on you ({OPEN.length})</span>
            {OPEN.length ? (
              <nav className="b-toc" aria-label="Open calls">
                {OPEN.map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
              </nav>
            ) : <p className="b-open__more" style={{ color: 'var(--c-text)' }}>Nothing right now. Game Night is approved: <a href="#game-night">see it under Approved screens</a>.</p>}
            <p className="b-open__more"><a href="#approved">Approved screens</a> · <a href="#archive">Archive ({ARCHIVE.length} decided)</a></p>
          </div>
        </header>

        {window.KSDirections ? <window.KSDirections /> : null}
        {window.KSOnboarding ? <window.KSOnboarding /> : null}

        <header className="b-part" id="approved">
          <span className="b-part__eyebrow">Reference</span>
          <h2>Approved screens</h2>
          <p>What the app is built from. First Game Night, the new look (approved 2026-10-12, both themes); then the five key screens and every other screen, which show the STRUCTURE on the 1.2.0 skin until each is rebuilt in Game Night.</p>
        </header>

        {window.KSGameNight ? <window.KSGameNight /> : null}

        <ThemesSection />

        <Section
          id="home" n="1" name="Home" job="How is my team doing in this league, and how is this week going?"
          phones={<Fit key={homeN}><S.HomeScreen run={homeRun} /></Fit>}
          notes={<Notes
            shows={[
              <><b>One league at a time</b> (your call, v1.1). The league pill picks it; switching swaps everything on Home. No cross-league totals.</>,
              <>Your team in this league: value {$(K.HOME.value)} as the big number, then <b>season gain</b> {$s(K.HOME.gain)} (the scored weeks plus this week live), today {$s(K.HOME.today)}, and rank and record (2nd of 6, {K.HOME.record}).</>,
              <><b>The Home hero</b> (your call: Concept A). Team value is the big number; the line under it is the season gain, the same words as the Standings column. It is not value − $12,000: the value also moves between the draft and Week 1's open and over every Friday close → Monday open, when no matchup is scoring. Portfolio keeps its own gain, value − cost, labelled "since the draft".</>,
              <>This week's matchup comes first: the live scoreboard card, with the lead in the metric that decides the matchup.</>,
              <>The season chart ("Season gain, week by week") plots the same season gain against $0, with week ticks and each week's result (W/L) underneath. It ends at the hero's season gain, and this week's rise equals this week's matchup score. <b>Past weeks are one point each</b> (that week's scored result, at Friday's close) joined by straight lines; only this week has day-by-day points. Time stays to scale: every week is five trading days wide. Scrubbing a past week reads that week's own result ("Week 3 · {$s(K.ROBERTO_WEEKS[2].gain)}"); this week reads the day and the running total.</>,
              <>Top of the standings with your row tinted and your name bold. The avatar opens Profile.</>,
              <><b>Other leagues</b> (your call: Concept B, pill only): there is no list on Home. The league pill shows "+2" (two more leagues) on every tab and opens the league sheet with every league grouped by phase.</>,
            ]}
            motion={<>
              <li><Play label="Open Home" playing={homeRun} onPlay={() => setHome(true)} /> The week card rises in (slow, 380ms); the season line draws on (feature, 700ms).</li>
              <li>Switching league in the pill: the sheet closes (spring.snappy) and Home crossfades to the new league (quick, 160ms). Numbers roll only where the value changed.</li>
            </>}
            reduced="the line and cards appear in place; digits swap without rolling."
            ask={null}
          />}
        />

        <Section
          id="matchup" n="2" name="Matchup" job="Am I winning this week, by how much, and why?"
          phones={<>
            <Fit caption={final ? 'Final (played from Live)' : 'Live · Thu 1:37 PM ET'}><S.MatchupScreen final={final} /></Fit>
            <Fit caption="Final · Fri close"><S.MatchupScreen final /></Fit>
          </>}
          notes={<Notes
            shows={[
              <>A broadcast scoreboard: both managers, both scores in the condensed 62% cut, and the tug bar. Live: {$s(L.you.gain)} vs {$s(L.opp.gain)}.</>,
              <><b>Dollars decide</b> (your call, v1.2): the scores and the lead are in dollars ({$(L.you.gain - L.opp.gain)} lead), with the tiebreak beside it, small ({pct(L.you.pct)} vs {pct(L.opp.pct)}). Every score on every screen comes from one helper, so if you change what decides, it changes everywhere at once.</>,
              <>A chyron names what just moved the game. The race chart replaces the Mon–Fri bars and is the same chart as the landing's /03.</>,
              <>Both lineups, each stock's dollar contribution this week. They add up to the score exactly.</>,
              <>Final: the winner banner, the new record, and next week's opponent.</>,
            ]}
            motion={<>
              <li><Play label={final ? 'Back to Live' : 'Final whistle'} playing={final} onPlay={() => setFinal(!final)} /> Scores roll to the close, the chip flips Live → Final, the tug settles, and the winner banner rises (slow, 380ms).</li>
              <li>Lead change (live): the chyron slides in (base), the tug crosses centre with the lively spring, one light haptic.</li>
            </>}
            reduced="scores swap, the tug jumps to its split, the banner and chyron fade in place."
            ask={null}
          />}
        />

        <Section
          id="league" n="3" name="League standings" job="Where do I stand, and what changed this week?"
          phones={<Fit><S.LeagueScreen after={after} /></Fit>}
          notes={<Notes
            shows={[
              <><b>One order, also the playoff seeding</b> (your call): win percentage, then head-to-head, then <b>season gain</b> (the sum of your weekly matchup gains). Paolo M. and Roberto B. are both 5–1 and haven't played each other, so season gain decides: Roberto's {$s(K.STANDINGS_FINAL[0].pf)} beats Paolo's {$s(K.STANDINGS_FINAL[1].pf)}. A bye is no result: it counts as neither a win nor a loss and is left out of win percentage. Records read W–L, with –T only when there are ties.</>,
              <>▲/▼ show the move since last week. Your row is tinted and your name bold wherever you land.</>,
              <>Week 6 results underneath: every matchup, both scores.</>,
            ]}
            motion={<>
              <li><Play label="Replay Friday's re-sort" playing={false} onPlay={() => { setAfter(false); setTimeout(() => setAfter(true), 700); }} /> Rows slide to their new ranks (FLIP, slow 380ms, settle), then the ▲/▼ badges pop.</li>
            </>}
            reduced="rows jump to their new order; the badges appear without scaling."
            ask={null}
          />}
        />

        <Section
          id="draft" n="4" name="Draft room" job="Whose pick is it, what's left, and how does the snake run?"
          phones={<>
            <Fit caption={landed ? 'After the pick' : 'On the clock · Round 2, pick 11'}><S.DraftScreen landed={landed} /></Fit>
            <Fit caption="Create league · Draft step (also in League settings)"><S.DraftSettingsScreen /></Fit>
          </>}
          notes={<Notes
            shows={[
              <>The on-the-clock ring counts down; the card says what the snake means for you right now ("Then Paolo M. picks twice").</>,
              <>The snake board: a track runs through every pick in order, with chevrons in the gaps and a half-loop at every row end, so the reversal reads without the labels. Your picks are outlined in team blue.</>,
              <>Search with your queue; Draft is one tap. Your roster fills slot by slot at $2,000 each.</>,
              <><b>When the clock runs out</b> (your call): the server auto-picks a good stock, never a random one: the manager's queue first, then the best available: the largest market cap that fits the league's rules (price brackets, category slots, budget). An auto-pick never breaks them.</>,
              <><b>Pick clock</b> (your call, v1.1): 60 seconds by default; the commissioner sets 30–90s when creating the league or in League settings before the draft. The draft room shows the league's clock.</>,
            ]}
            motion={<>
              <li><Play label={landed ? 'Reset' : 'Make the pick'} playing={landed} onPlay={() => setLanded(!landed)} /> AAPL lands in pick 11, the blue track extends to 12, the ring hands over to Paolo M., and the roster slot fills.</li>
              <li>The clock ring pulses its outline at 1.2s; the last 10 seconds turn the ring to loss red.</li>
            </>}
            reduced="the ticker appears in place; the track extends without drawing; no pulse."
            ask={null}
          />}
        />

        <Section
          id="portfolio" n="5" name="Portfolio and stock sheet" job="What do I own, how is it doing, and how do I act on one stock?"
          phones={<>
            <Fit caption={sheet ? 'NVDA tapped' : 'Portfolio · live'}><S.PortfolioScreen sheet={sheet} /></Fit>
            <Fit caption="Stock sheet · Sell pre-selected"><S.PortfolioScreen sheet /></Fit>
            <Fit caption="After selling TSLA · the slot holds the proceeds"><S.PortfolioScreen variant="cash" /></Fit>
            <Fit caption="Buying with the proceeds"><S.PortfolioScreen variant="buy" /></Fit>
          </>}
          notes={<Notes
            shows={[
              <>Value {$(K.PORTFOLIO_LIVE.value)}; gain since the draft {$s(K.PORTFOLIO_LIVE.gain)} against a $12,000.00 basis; today {$s(K.PORTFOLIO_LIVE.today)}.</>,
              <>Six holdings, each with value and today's move. Trade history includes the draft picks.</>,
              <>Any ticker row opens the stock sheet: price and today's change, a chart of daily closes (1W by default; 1W, 1M, 3M, 1Y, no 1D, because the price history is daily only: Giorgio's ruling), your position, who in the league owns it, and <b>Sell pre-selected</b> because you hold it.</>,
              <><b>Trading</b> (your call, v1.2): buy and sell freely, whole positions only, but a slot you sell out of can only reinvest what the sale brought in ({$(K.SALE.proceeds)} from TSLA), never a fresh $2,000. The freed slot shows as a Cash row ready to invest; cash earns nothing but counts in value, so the portfolio value doesn't change on the sale. The buy sheet says "You have {$(K.SALE.proceeds)} from selling TSLA to invest" and lets you pick which freed slot pays.</>,
            ]}
            motion={<>
              <li><Play label={sheet ? 'Close sheet' : 'Tap NVDA'} playing={sheet} onPlay={() => setSheet(!sheet)} /> The sheet springs up (spring.snappy, no overshoot) while the scrim fades in (base).</li>
            </>}
            reduced="the sheet fades in place."
            ask={null}
          />}
        />

        {window.KSInventoryBoard ? <window.KSInventoryBoard /> : null}

        <Ledger />

        <Archive />
      </main>
    );
  }

  function Ledger() {
    const L = K.MATCHUP.live, F = K.MATCHUP.final, P = K.PORTFOLIO_LIVE, H = K.HOME;
    const rowsSum = (rows) => rows.map((r) => $s(r.weekGain)).join(' ');
    const wins = K.STANDINGS_FINAL.reduce((a, r) => a + r.w, 0);
    const losses = K.STANDINGS_FINAL.reduce((a, r) => a + r.l, 0);
    const lines = [
      ['Matchup, live', `Roberto B.: ${rowsSum(L.you.rows)} = ${$s(L.you.gain)}`, `Gianluigi B.: ${rowsSum(L.opp.rows)} = ${$s(L.opp.gain)}`, `Lead ${$(L.you.gain - L.opp.gain)}`],
      ['Matchup, final', `Roberto B. = ${$s(F.you.gain)} (${pct(F.you.pct)} of ${$(F.you.startValue)})`, `Gianluigi B. = ${$s(F.opp.gain)} (${pct(F.opp.pct)} of ${$(F.opp.startValue)})`, `Margin ${$(F.you.gain - F.opp.gain)}`],
      ['Portfolio', `Σ 6 holdings = ${$(P.value)}`, `Basis 6 × $2,000.00 = ${$(P.cost)}`, `Gain ${$s(P.gain)} (${pct(P.gainPct)})`],
      ['Home (this league)', `Value = Portfolio = ${$(H.value)}`, `Season gain ${$s(H.gain)} = weeks 1–5 ${$s(H.throughW5)} + this week ${$s(K.MATCHUP.live.you.gain)}`, `Chart ends at ${$s(H.series[H.series.length - 1])}`],
      ['Trade (fixed per slot)', `Sell TSLA: ${K.SALE.buy && K.lineup('roberto', 'thu').find((r) => r.t === 'TSLA').qty} sh × ${$(248.36)} = ${$(K.SALE.proceeds)}`, `Realized vs the $2,000.00 slot: ${$s(K.SALE.realized)}`, `Buy SHOP with exactly ${$(K.SALE.proceeds)} ≈ ${K.SALE.buy.qty.toFixed(4)} sh; value unchanged`],
      ['Standings', `After Week 6: ${wins} wins = ${losses} losses`, 'Ranked: win %, then head-to-head, then season gain (= playoff seeds); byes excluded', `Roberto B. ${$s(K.STANDINGS_FINAL[0].pf)} > Paolo M. ${$s(K.STANDINGS_FINAL[1].pf)}`],
      ['Draft', 'Seat on the clock at pick n: odd rounds 1→6, even rounds 6→1', 'Roberto B. (seat 2): picks 2, 11, 14, 23, 26, 35', 'Gianluigi B. (seat 5): picks 5, 8, 17, 20, 29, 32'],
    ];
    return (
      <section className="b-sec b-ledger" id="ledger" aria-labelledby="ledger-h">
        <header className="b-sec__head">
          <span className="b-sec__n">$</span>
          <div>
            <h2 id="ledger-h">The ledger</h2>
            <p className="b-job">Computed live from the same data the screens use, so it cannot drift from them.</p>
          </div>
        </header>
        <div className="b-table-wrap">
          <table className="b-table">
            <tbody>
              {lines.map(([k, ...v]) => (
                <tr key={k}><th scope="row">{k}</th>{v.map((x, i) => <td key={i}>{x}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Changes from the landing's current sample data</h3>
        <ol className="b-changes">
          <li>Records: the landing's 5–0, 4–1, 4–1, 3–2, 2–3, 1–4 add up to 19 wins against 11 losses, which no league can produce. Now 5–0, 4–1, 3–2, 2–3, 1–4, 0–5 after Week 5.</li>
          <li>Standings rank by win percentage, then head-to-head, then season gain in dollars (one order, also the playoff seeding), not by season percent.</li>
          <li>Pick 12 was TSLA for Paolo M., but TSLA is in Roberto B.'s lineup. Paolo M. now takes LLY; Roberto B. took TSLA in round 4.</li>
          <li>The hero phone's matchup (+$322.45 vs −$71.20, "3d 4h left") contradicted the week's daily closes. The live moment is now Thu 1:37 PM ET: {$s(L.you.gain)} vs {$s(L.opp.gain)}.</li>
          <li>Thursday's close for Gianluigi B. is +$71.35 (was −$12.55), so the live game is close enough for the tug bar to move. Friday is derived from the holdings: {$s(F.you.gain)} vs {$s(F.opp.gain)} (was +$351.80 vs −$40.25).</li>
          <li>Lineups are six stocks (the landing showed four); the portfolio is {$(P.value)} across six holdings.</li>
        </ol>
      </section>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<Board />);
})();
