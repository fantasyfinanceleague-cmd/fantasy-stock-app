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
  const TOKEN_ROWS = [
    // [token, role, min contrast vs surface (text 4.5, graphics 3)]
    ['text', 'Primary text', 4.5], ['text-2', 'Secondary text', 4.5], ['accent', 'Links, accent text', 4.5],
    ['you-text', 'Your name / score text', 4.5], ['opp-text', 'Opponent text', 4.5], ['live-text', 'Live tags', 4.5],
    ['gain', 'Money up', 4.5], ['loss', 'Money down', 4.5], ['zero', 'Money flat', 4.5], ['danger', 'Errors', 4.5],
    ['you', 'Your fills (tug, avatar)', 3], ['opp', 'Opponent fills', 3], ['live', 'Live dot, clock ring', 3], ['border-strong', 'Control borders', 3],
    ['text-3', 'Disabled / decorative text ONLY, never information', 0],
  ];
  // Every foreground-on-fill pair the components actually render, with the
  // background it really sits on. rgba tints are composited over `over`.
  // [fg token, bg token, over (for translucent bgs), min, where it's used]
  const PAIRS = [
    ['on-accent', 'you', null, 4.5, 'Avatar initials, winner banner, filled roster slots'],
    ['on-opp', 'opp', null, 4.5, 'Opponent avatar initials'],
    ['on-accent', 'loss-fill', null, 4.5, 'Sell button label'],
    ['primary-fg', 'primary-bg', null, 4.5, 'Primary button label'],
    ['inverse-fg', 'inverse-bg', null, 4.5, 'FINAL chip, selected toggle'],
    ['secondary-fg', 'secondary-bg', 'surface', 4.5, 'Secondary button label'],
    ['text', 'inset', null, 4.5, 'Chips, draft cells, search field, panels'],
    ['text-2', 'inset', null, 4.5, 'Chip meta, race-chart day labels'],
    ['live-text', 'inset', null, 4.5, 'LIVE chip'],
    ['live-text', 'surface', null, 4.5, 'Broadcast tags on cards'],
    ['text-2', 'sunken', null, 4.5, 'Segmented-control labels'],
    ['text', 'bg', null, 4.5, 'Screen text'],
    ['text-2', 'bg', null, 4.5, 'Captions on the screen background'],
    ['gain', 'bg', null, 4.5, 'Gain on the screen background (Home hero)'],
    ['loss', 'bg', null, 4.5, 'Loss on the screen background'],
    ['gain', 'inset', null, 4.5, 'Gain inside panels'],
    ['accent', 'accent-tint', 'surface', 4.5, 'Selected web nav, icon tiles'],
    ['gain', 'gain-tint', 'surface', 4.5, 'Cash tile "$", done check'],
    ['text', 'you-tint', 'surface', 4.5, 'Your standings row'],
    ['accent', 'tabbar', 'bg', 4.5, 'Active tab label'],
    ['text-2', 'tabbar', 'bg', 4.5, 'Inactive tab labels'],
    ['warn-text', 'warn-tint', 'bg', 4.5, '"Your call" notes'],
    ['text', 'warn-tint', 'bg', 4.5, 'Sign-ups-paused banner'],
    ['text', 'warn-tint', 'surface', 4.5, 'Uneven-bye heads-up (inside a card)'],
    ['on-accent', 'you', null, 3, 'Chevrons on the drawn draft track (graphic)'],
    ['surface', 'live', null, 3, 'Trophy icon on the champion badge (graphic)'],
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
            <li><b>The money/game split is gone as a colour.</b> Matchup, Draft room, scoreboards and onboarding are light in Light; Portfolio, sheets and forms are dark in Dark. No dark card inside a light screen, or the reverse.</li>
            <li><b>What replaces the dark scoreboard for emphasis:</b> the condensed 900 score type (the biggest thing on any screen), a faint accent wash at the top of the scoreboard card, the tug bar and live dot in colour, broadcast-style tags, and motion (digit rolls, lead changes, re-sorts).</li>
            <li><b>Text-safe cuts.</b> Yellow, orange and bright blue are too light for text on white, so each has a darker "-text" value in Light. The fills (tug bar, live dot, avatars) keep their colour.</li>
            <li><b>Rules that still hold:</b> team colours mark people (you blue, opponent orange); data colours mark money (gain green, loss red, zero grey, never green).</li>
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
            <span className="b-brand__meta">App screens · v3 · 29 Sep 2026</span>
          </div>
          <h1>The app, as it will ship.</h1>
          <p className="b-lead">
            Five key screens, built as real components on the Game Day tokens. They are the
            source of truth for the mobile app and for the landing page's phone, so the landing
            can only show what the app will actually look like. Every screen tells one story:
            the same league, the same week, and numbers that add up.
          </p>
          <p className="b-changed"><b>New in v3:</b> one design in two complete themes, Light and Dark (switch at the top right). <b>From your earlier answers:</b> Home shows one league at a time (switch with the league pill, which shows "+2" more leagues; no list on Home); the standings column is "Season gain"; the draft pick clock defaults to 60 seconds and the commissioner can set 30–90; dollars decide matchups, with percent as the tiebreak; and a sold slot reinvests exactly its sale proceeds.</p>
          <dl className="b-canon">
            <div><dt>League</dt><dd>{K.LEAGUE.name} · 6 managers</dd></div>
            <div><dt>Moment</dt><dd>Week 6 of 14 · Thu 1:37 PM ET</dd></div>
            <div><dt>You</dt><dd>Roberto B. vs Gianluigi B.</dd></div>
            <div><dt>Stakes</dt><dd>$2,000 per slot · 6 slots</dd></div>
          </dl>
          <nav className="b-toc" aria-label="Screens">
            {[['themes', 'Themes'], ['home', 'Home'], ['matchup', 'Matchup'], ['league', 'League'], ['draft', 'Draft room'], ['portfolio', 'Portfolio'], ['inventory', 'Every screen'], ['shell', 'Sign in'], ['phases', 'Home phases'], ['game', 'Game'], ['money', 'Trading'], ['web', 'Web'], ['ledger', 'Ledger']].map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
          </nav>
        </header>

        <ThemesSection />

        <Section
          id="home" n="1" name="Home" job="How is my team doing in this league, and how is this week going?"
          phones={<Fit key={homeN}><S.HomeScreen run={homeRun} /></Fit>}
          notes={<Notes
            shows={[
              <><b>One league at a time</b> (your call, v1.1). The league pill picks it; switching swaps everything on Home. No cross-league totals.</>,
              <>Your team in this league: value {$(K.HOME.value)}, gain since the draft {$s(K.HOME.gain)}, today {$s(K.HOME.today)}, and rank and record (2nd of 6, {K.HOME.record}).</>,
              <>This week's matchup comes first: the live scoreboard card, with the lead in the metric that decides the matchup.</>,
              <>The season chart plots gain since the draft against $0, with week ticks and each week's result (W/L) underneath. This week's rise on the chart equals this week's matchup score.</>,
              <>Top of the standings with you highlighted. The avatar opens Profile.</>,
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
              <>▲/▼ show the move since last week. You are highlighted wherever you land.</>,
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
              <>Any ticker row opens the stock sheet: price and today's chart against the previous close, your position, who in the league owns it, and <b>Sell pre-selected</b> because you hold it.</>,
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
      ['Home (this league)', `Value = Portfolio = ${$(H.value)}`, `Gain since the draft ${$s(H.gain)} = weeks 1–5 ${$s(H.throughW5)} + this week ${$s(K.MATCHUP.live.you.gain)}`, `Chart ends at ${$s(H.series[H.series.length - 1])}`],
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
          <li>The hero phone's matchup (+$322.45 vs −$71.20, "3d 4h left") contradicted the week's daily closes. The live moment is now Thu 1:37 PM: {$s(L.you.gain)} vs {$s(L.opp.gain)}.</li>
          <li>Thursday's close for Gianluigi B. is +$71.35 (was −$12.55), so the live game is close enough for the tug bar to move. Friday is derived from the holdings: {$s(F.you.gain)} vs {$s(F.opp.gain)} (was +$351.80 vs −$40.25).</li>
          <li>Lineups are six stocks (the landing showed four); the portfolio is {$(P.value)} across six holdings.</li>
        </ol>
      </section>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<Board />);
})();
