// Key screens: canonical sample data (Design Lead, 2026-09-29).
//
// ONE league, ONE week, ONE set of people, shared by every key screen AND
// by the landing's phone (3a) AND by the mobile phases' dev fixtures.
// Everything a screen shows is DERIVED here from a few inputs (share
// quantities and prices), so the numbers reconcile by construction:
//   matchup score  = Σ per-holding week gain (each row rounded to cents first)
//   lead           = your score − their score
//   portfolio      = Σ quantity × price
//   standings      = records + points-for (season $ gain), sorted the way the
//                    app sorts (win %, then wins, then points-for:
//                    apps/mobile/app/(tabs)/league.tsx sortedStandings)
// Records are a legal league: after N weeks of 3 matchups, wins = losses.
//
// Scoring copy stays generic ("best performance wins"); data displays show
// the scorer's actual metric (dollar gain, percent as the tiebreak).
//
// Plain JS (no imports) so the board runs without a build; the port to
// apps/web is `export` on each const. formatMoney / tugRatio below are
// byte-for-byte ports of apps/web/src/design/lib/{money,tugRatio}.ts.

(function () {
  // ── Formatters (ports; keep in sync with design/lib) ───────────────────
  const MINUS = '−';
  const FIGURE_SPACE = ' ';
  function roundToCents(v) { return Math.round(Math.abs(v) * 100); }
  function formatMoney(value, opts) {
    const o = opts || {};
    const sign = o.sign || 'negative';
    const cents = roundToCents(value);
    const isZero = cents === 0;
    const isNeg = !isZero && value < 0;
    let s;
    if (isZero) s = o.alignSign ? FIGURE_SPACE : '';
    else if (isNeg) s = MINUS;
    else s = sign === 'always' ? '+' : o.alignSign ? FIGURE_SPACE : '';
    const dollars = Math.floor(cents / 100);
    if (o.compact && dollars >= 1000) {
      const tiers = [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]];
      let i = tiers.findIndex((t) => dollars >= t[1]);
      let h = Math.round((cents * 100) / (tiers[i][1] * 100));
      while (h >= 100000 && i > 0) { i -= 1; h = Math.round((cents * 100) / (tiers[i][1] * 100)); }
      return `${s}$${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}${tiers[i][0]}`;
    }
    const cp = String(cents % 100).padStart(2, '0');
    return `${s}$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cp}`;
  }
  /** Percent with the same sign rules as money: U+2212, zero unsigned. */
  function formatPct(v, opts) {
    const o = opts || {};
    const h = Math.round(Math.abs(v) * 100);
    if (h === 0) return '0.00%';
    const s = v < 0 ? MINUS : o.sign === 'always' ? '+' : '';
    return `${s}${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}%`;
  }
  function tugRatio(you, opp) {
    const d = Math.max(Math.abs(you) + Math.abs(opp), 1);
    return Math.min(0.92, Math.max(0.08, 0.5 + (0.5 * (you - opp)) / d));
  }
  const cents = (v) => Math.round(v * 100) / 100;
  const sum = (xs) => cents(xs.reduce((a, b) => a + b, 0));

  // ── The league ─────────────────────────────────────────────────────────
  const LEAGUE = {
    name: 'Stock Scudetto',
    week: 6,
    weeks: 14,
    stakeMode: 'fixed_notional',
    notionalPerSlot: 2000,
    slots: 6,
  };

  const PLAYERS = [
    { id: 'paolo', name: 'Paolo M.', init: 'PM', seat: 1 },
    { id: 'roberto', name: 'Roberto B.', init: 'RB', seat: 2, you: true },
    { id: 'alessandro', name: 'Alessandro D.', init: 'AD', seat: 3 },
    { id: 'francesco', name: 'Francesco T.', init: 'FT', seat: 4 },
    { id: 'gianluigi', name: 'Gianluigi B.', init: 'GB', seat: 5 },
    { id: 'andrea', name: 'Andrea P.', init: 'AP', seat: 6 },
  ];
  const byId = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));

  // ── The draft (6 teams, snake, 6 rounds) ───────────────────────────────
  /** Seat on the clock at overall pick n (1-based), snake order. */
  function seatForPick(n, teams) {
    const r = Math.ceil(n / teams);
    const i = (n - 1) % teams;
    return r % 2 === 1 ? i + 1 : teams - i;
  }
  // Overall picks 1–18 in order (R1 →, R2 ←, R3 →). A stock is drafted
  // once per league. Roberto (seat 2) picks 2, 11, 14, 23, 26, 35;
  // Gianluigi (seat 5) picks 5, 8, 17, 20, 29, 32 — matching H below.
  const DRAFT_BOARD = [
    'MSFT', 'NVDA', 'META', 'AVGO', 'AMZN', 'GOOGL',
    'COIN', 'JPM', 'AMD', 'PLTR', 'AAPL', 'LLY',
    'NFLX', 'CRM', 'ORCL', 'UBER', 'DIS', 'UNH',
  ];

  /** The Draft room screen's moment: draft night, round 2, pick 11,
   * you're on the clock, 0:42 left. Picks 1–10 are in. */
  const DRAFT_MOMENT = { pick: 11, secondsLeft: 42, secondsTotal: 60, queued: 'AAPL' };
  const DRAFT_PICKS = Array.from({ length: 18 }, (_, k) => {
    const n = k + 1;
    const seat = seatForPick(n, 6);
    const player = PLAYERS.find((p) => p.seat === seat);
    const t = DRAFT_BOARD[k];
    return {
      pick: n,
      round: Math.ceil(n / 6),
      player: player.id,
      t: n < DRAFT_MOMENT.pick ? t : null, // not yet picked at the moment
      intended: t,
    };
  });
  /** Search results in the draft room at the moment (AAPL queued). */
  const DRAFT_SEARCH = {
    query: 'app',
    results: [
      { t: 'AAPL', co: 'Apple', price: 198.6, tag: 'Queued' },
      { t: 'APP', co: 'AppLovin', price: 88.4 },
      { t: 'APPF', co: 'AppFolio', price: 231.15 },
      { t: 'APPN', co: 'Appian', price: 30.72 },
    ],
  };

  // ── Holdings (fixed notional: $2,000 per slot at the draft price) ──────
  // Prices: draft = season start; mon = Week 6 Monday open (the week-start
  // price every week gain is measured from); thu = Thursday 1:37 PM ET
  // (the LIVE moment; also the landing tape's prices); fri = Friday close.
  // prev = Wednesday close (today's change base on Thursday).
  const H = {
    roberto: [
      { t: 'NVDA', co: 'NVIDIA', draft: 290.1, mon: 300.2, prev: 306.68, thu: 318.37, fri: 321.9, pick: 2 },
      { t: 'AAPL', co: 'Apple', draft: 198.6, mon: 205.1, prev: 208.83, thu: 211.42, fri: 214.8, pick: 11 },
      { t: 'CRM', co: 'Salesforce', draft: 262.4, mon: 268.0, prev: 269.96, thu: 271.35, fri: 274.1, pick: 14 },
      { t: 'TSLA', co: 'Tesla', draft: 262.8, mon: 251.9, prev: 249.66, thu: 248.36, fri: 250.1, pick: 23 },
      { t: 'COST', co: 'Costco', draft: 905.2, mon: 912.4, prev: 915.22, thu: 918.1, fri: 921.7, pick: 26 },
      { t: 'V', co: 'Visa', draft: 281.5, mon: 284.2, prev: 285.04, thu: 286.1, fri: 291.4, pick: 35 },
    ],
    gianluigi: [
      { t: 'AMZN', co: 'Amazon', draft: 221.3, mon: 238.1, prev: 239.22, thu: 236.4, fri: 234.9, pick: 5 },
      { t: 'JPM', co: 'JPMorgan', draft: 204.9, mon: 214.2, prev: 214.98, thu: 215.45, fri: 216.3, pick: 8 },
      { t: 'DIS', co: 'Disney', draft: 104.2, mon: 101.3, prev: 101.41, thu: 102.9, fri: 100.2, pick: 17 },
      { t: 'NKE', co: 'Nike', draft: 82.4, mon: 79.6, prev: 79.71, thu: 81.3, fri: 79.1, pick: 20 },
      { t: 'KO', co: 'Coca-Cola', draft: 68.1, mon: 69.4, prev: 69.47, thu: 69.9, fri: 69.85, pick: 29 },
      { t: 'BA', co: 'Boeing', draft: 172.6, mon: 176.3, prev: 176.02, thu: 176.9, fri: 175.4, pick: 32 },
    ],
  };
  // Draft shares, 4 dp (fractional shares under fixed notional).
  for (const side of Object.values(H)) {
    for (const h of side) h.qty = Math.round((LEAGUE.notionalPerSlot / h.draft) * 1e4) / 1e4;
  }

  /** Per-holding view at a moment ('thu' live or 'fri' final). Each row's
   * dollar gain is rounded to cents FIRST, and the score is the sum of the
   * rounded rows, so the lineup always adds up to the scoreboard. */
  function lineup(id, at) {
    return H[id].map((h) => {
      const price = h[at];
      const weekGain = cents(h.qty * (price - h.mon));
      const value = cents(h.qty * price);
      // Fixed notional: each slot's cost basis IS the notional ($2,000).
      const cost = LEAGUE.notionalPerSlot;
      const todayPct = ((h.thu - h.prev) / h.prev) * 100;
      const today = cents(h.qty * (h.thu - h.prev));
      return { ...h, price, weekGain, value, cost, gain: cents(value - cost), gainPct: ((price - h.draft) / h.draft) * 100, todayPct, today };
    });
  }
  function score(id, at) {
    const rows = lineup(id, at);
    const gain = sum(rows.map((r) => r.weekGain));
    const startValue = sum(H[id].map((h) => cents(h.qty * h.mon)));
    return { gain, pct: (gain / startValue) * 100, startValue, rows };
  }

  const MATCHUP = {
    you: 'roberto',
    opp: 'gianluigi',
    live: { label: 'Thu 1:37 PM ET', left: 'Ends Fri 4:00 PM ET · 1d 2h', you: score('roberto', 'thu'), opp: score('gianluigi', 'thu') },
    final: { label: 'Final', you: score('roberto', 'fri'), opp: score('gianluigi', 'fri') },
  };
  // Daily closes (cumulative week gain) for the matchup's week strip and
  // the landing's race chart. Mon–Wed closes are the landing's WEEK_CLOSES;
  // Thu is CHANGED (Gianluigi +$71.35, was −$12.55) so the LIVE moment
  // (Thu 1:37 PM, Gianluigi +$90.44) is a real game, not a pinned tug bar;
  // Fri is DERIVED from the holdings above (so the FINAL screen, the race
  // chart's end and the lineup all agree).
  const WEEK_CLOSES = [
    { day: 'Open', you: 0, opp: 0 },
    { day: 'Mon', you: 61.2, opp: 88.4 },
    { day: 'Tue', you: 142.75, opp: 101.3 },
    { day: 'Wed', you: 118.4, opp: 34.9 },
    { day: 'Thu', you: 238.6, opp: 71.35 },
    { day: 'Fri', you: MATCHUP.final.you.gain, opp: MATCHUP.final.opp.gain },
  ];
  // Chyrons, one per beat, each TRUE against WEEK_CLOSES.
  const CHYRONS = {
    Mon: 'Gianluigi B. opens the week ahead',
    Tue: 'NVDA +2.9% puts Roberto B. ahead',
    Wed: 'Roberto B. holds the lead through a red day',
    Thu: 'NKE +2.0% keeps Gianluigi B. in it',
    Fri: 'DIS −2.6% on Friday seals it', // (100.20 − 102.90) / 102.90
  };

  // ── Standings ──────────────────────────────────────────────────────────
  // Weeks 1–5 are a legal league (15 wins = 15 losses). Week 6 pairings:
  // Roberto–Gianluigi, Paolo–Alessandro, Francesco–Andrea.
  const THROUGH_W5 = {
    paolo: { w: 5, l: 0, pf: 1188.4 },
    roberto: { w: 4, l: 1, pf: 842.35 },
    alessandro: { w: 3, l: 2, pf: 903.1 },
    francesco: { w: 2, l: 3, pf: 410.25 },
    gianluigi: { w: 1, l: 4, pf: -122.6 },
    andrea: { w: 0, l: 5, pf: -385.9 },
  };
  const WEEK6 = [
    { a: 'roberto', b: 'gianluigi', ga: MATCHUP.final.you.gain, gb: MATCHUP.final.opp.gain },
    { a: 'paolo', b: 'alessandro', ga: -48.3, gb: 96.15 },
    { a: 'francesco', b: 'andrea', ga: 61.4, gb: -22.75 },
  ];
  function standings(rec) {
    return PLAYERS.map((p) => ({ ...p, ...rec[p.id] }))
      .sort((x, y) => {
        const px = x.w / (x.w + x.l);
        const py = y.w / (y.w + y.l);
        if (py !== px) return py - px;
        if (y.w !== x.w) return y.w - x.w;
        return y.pf - x.pf;
      })
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
  const AFTER_W6 = JSON.parse(JSON.stringify(THROUGH_W5));
  for (const m of WEEK6) {
    const aWins = m.ga > m.gb;
    AFTER_W6[m.a].w += aWins ? 1 : 0;
    AFTER_W6[m.a].l += aWins ? 0 : 1;
    AFTER_W6[m.b].w += aWins ? 0 : 1;
    AFTER_W6[m.b].l += aWins ? 1 : 0;
    AFTER_W6[m.a].pf = cents(AFTER_W6[m.a].pf + m.ga);
    AFTER_W6[m.b].pf = cents(AFTER_W6[m.b].pf + m.gb);
  }
  const STANDINGS_BEFORE = standings(THROUGH_W5);
  const STANDINGS_FINAL = standings(AFTER_W6).map((r) => {
    const before = STANDINGS_BEFORE.find((b) => b.id === r.id).rank;
    return { ...r, delta: before - r.rank };
  });

  // ── Portfolio + Home ───────────────────────────────────────────────────
  const PORTFOLIO_LIVE = (() => {
    const rows = lineup('roberto', 'thu');
    const value = sum(rows.map((r) => r.value));
    const cost = sum(rows.map((r) => r.cost));
    const today = sum(rows.map((r) => r.today));
    const prevValue = sum(rows.map((r) => cents(r.qty * r.prev)));
    return { rows, value, cost, gain: cents(value - cost), gainPct: ((value - cost) / cost) * 100, today, todayPct: (today / prevValue) * 100 };
  })();

  // A second live league so Home's cross-league view is real.
  const OTHER_LEAGUES = [
    {
      name: 'Friday Night Stocks',
      phase: 'live_open',
      week: 2,
      weeks: 10,
      opp: 'Marco R.',
      you: 42.18,
      oppGain: -15.6,
      value: 5058.3,
      cost: 5000,
      rank: 3,
      record: '1–0',
      members: 8,
    },
    {
      name: 'Serie A Traders',
      phase: 'pre_draft',
      draftAt: 'Draft Sat 7:00 PM',
      members: 6,
      of: 8,
    },
  ];
  // Home chart: cumulative gain (value − cost + realized) across leagues,
  // one point per trading day, 1M window, rebased to the window start.
  // It ends EXACTLY at the header's 1M gain (see HOME below).
  const HOME_SERIES_RAW = [
    // Stock Scudetto contributes from day 0; Friday Night Stocks joins on
    // day 13 (a deposit: NO jump, because the line is gain, not value).
    118.2, 131.6, 109.4, 95.8, 122.9, 140.3, 151.7, 138.2, 162.5, 171.9,
    158.4, 149.6, 176.3, 188.1, 201.4, 215.8, 196.2, 224.6, 262.3, 319.5, 294.1,
  ];
  const HOME = (() => {
    const scudetto = PORTFOLIO_LIVE;
    const fns = OTHER_LEAGUES[0];
    const totalValue = cents(scudetto.value + fns.value);
    const nowGain = cents(scudetto.gain + (fns.value - fns.cost));
    // Replace the last point with the true current all-time gain, then
    // rebase the window to its first point.
    const raw = HOME_SERIES_RAW.slice();
    raw.push(nowGain);
    const base = raw[0];
    const series = raw.map((v) => cents(v - base));
    return { totalValue, allTimeGain: nowGain, windowGain: series[series.length - 1], series, joinedIndex: 13 };
  })();

  // The stock sheet (NVDA), Thursday live.
  const NVDA = (() => {
    const r = PORTFOLIO_LIVE.rows.find((x) => x.t === 'NVDA');
    return {
      ...r,
      dayPoints: [306.68, 307.9, 309.4, 308.7, 311.2, 313.05, 312.4, 314.9, 316.2, 315.6, 317.1, 318.37],
      range: ['1D', '1W', '1M', '3M', '1Y'],
      ownership: 'Drafted by you · Round 1, pick 2',
    };
  })();

  window.KS = {
    formatMoney, formatPct, tugRatio,
    LEAGUE, PLAYERS, byId, seatForPick,
    DRAFT_MOMENT, DRAFT_PICKS, DRAFT_SEARCH,
    MATCHUP, WEEK_CLOSES, CHYRONS,
    STANDINGS_BEFORE, STANDINGS_FINAL, WEEK6,
    PORTFOLIO_LIVE, OTHER_LEAGUES, HOME, NVDA,
    lineup, score,
  };
})();
