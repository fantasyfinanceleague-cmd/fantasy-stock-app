// Key screens: the app's five key screens as React components (Design Lead,
// 2026-09-29). The single source of truth for BOTH the landing's phone
// (3a) and mobile phases 3b-1 / 3b-2 / 3c / 3e.
//
// Written against the web foundation's tokens (tokens.css --sp-*) and the
// canonical data in data.js (window.KS). No build: the board compiles this
// with Babel standalone. Port to apps/web: drop the IIFE, `export` each
// screen, import KS from sampleData, and swap Roll/ScoreRow/Tug for the
// foundation's ScoreDigits/TugBar where they already exist.

(function () {
  const { useState, useEffect, useLayoutEffect, useRef } = React;
  const K = window.KS;
  const $ = (v, o) => K.formatMoney(v, o);
  const $s = (v) => K.formatMoney(v, { sign: 'always' });
  const pct = (v) => K.formatPct(v, { sign: 'always' });
  const tone = (v) => (Math.round(Math.abs(v) * 100) === 0 ? 'ks-zero' : v > 0 ? 'ks-gain' : 'ks-loss');
  // Every score goes through ONE helper (data.js scoreDisplay): the metric
  // that decides the matchup is primary, the tiebreak secondary.
  const SD = (x) => K.scoreDisplay(x, K.LEAGUE.scoring);
  const margin = (a, b) =>
    K.LEAGUE.scoring.decides === 'percent'
      ? `${Math.abs(a.pct - b.pct).toFixed(2)} pts`
      : $(Math.abs(a.gain - b.gain));
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Icons (one outline set; filled weight on the active tab) ──────────
  const ICON = {
    home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
    matchup: 'M4 17 9 11l4 4 7-8M15 7h5v5',
    league: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
    portfolio: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    chevron: 'm6 9 6 6 6-6',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6 6 18',
    right: 'm9 6 6 6-6 6',
  };
  function Icon({ d, size = 24, width = 2 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    );
  }

  // ── Device chrome ─────────────────────────────────────────────────────
  const TABS = [['home', 'Home'], ['matchup', 'Matchup'], ['league', 'League'], ['portfolio', 'Portfolio']];
  function Device({ game, tab, children, overlay, label, noTabs, full, time = '1:37', style }) {
    return (
      <div className={full ? 'ks-device ks-device--full' : 'ks-device'} role="img" aria-label={label} style={style}>
        <div className="ks-os">
          <span>{time}</span>
          <span className="ks-os__island" />
          <span className="ks-os__icons">
            <span className="ks-os__bars"><i /><i /><i /><i /></span>
            <span className="ks-os__batt"><i /></span>
          </span>
        </div>
        <div className="ks-scroll" style={noTabs ? { bottom: 34 } : undefined}>{children}</div>
        {noTabs ? null : <nav className="ks-tabs">
          {TABS.map(([id, name]) => (
            <span key={id} className={id === tab ? 'ks-tabs__t ks-tabs__t--on' : 'ks-tabs__t'}>
              <Icon d={ICON[id]} width={id === tab ? 2.4 : 1.8} />
              {name}
            </span>
          ))}
        </nav>}
        <span className="ks-home-ind" />
        {overlay}
      </div>
    );
  }
  function LeagueHead({ chip, sub }) {
    return (
      <div className="ks-head">
        <span className="ks-pill"><span>{K.LEAGUE.name}</span><span className="ks-pill__more" aria-label={`${K.OTHER_LEAGUES.length} more leagues`}>+{K.OTHER_LEAGUES.length}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
        {chip}
        {sub}
      </div>
    );
  }
  function Chip({ kind, children }) {
    return (
      <span className={`ks-chip ks-chip--${kind}`}>
        {kind === 'live' ? <span className="ks-dot ks-dot--pulse" /> : null}
        {children}
      </span>
    );
  }

  // ── Roll: per-character roll on change, never on first paint ──────────
  function Roll({ text, className }) {
    const first = useRef(true);
    const prev = useRef(text);
    useEffect(() => { first.current = false; prev.current = text; });
    const old = prev.current;
    return (
      <span className={className} aria-label={text}>
        {text.split('').map((c, i) => (
          <span
            key={`${i}-${c}`}
            aria-hidden="true"
            style={{ display: 'inline-block' }}
            className={!first.current && old[i] !== c && !reduced() ? 'ks-rollin' : undefined}
          >
            {c}
          </span>
        ))}
      </span>
    );
  }

  // ── Scores: the shared ScoreRow. Two scores that never touch: a 1fr/1fr
  // grid with a ≥16px gap, and ONE shared size (the largest at which BOTH
  // fit their columns), so the widest pair (+$351.77 / −$38.88) is safe.
  function Scores({ left, right, size = 'xl', leftTone, rightTone }) {
    const ref = useRef(null);
    const [k, setK] = useState(1);
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.style.setProperty('--k', '1');
      let s = 1;
      el.querySelectorAll('.ks-scorerow > div').forEach((cell) => {
        const inner = cell.firstChild;
        if (inner.scrollWidth > cell.clientWidth) s = Math.min(s, cell.clientWidth / inner.scrollWidth);
      });
      el.style.setProperty('--k', String(s));
      setK(s);
    }, [left, right]);
    return (
      <div ref={ref} style={{ fontSize: `calc(var(--sp-type-score-${size}-size) * var(--k, 1))`, lineHeight: 1 }} data-k={k.toFixed(2)}>
        <div className="ks-scorerow">
          <div><Roll text={left} className={`ks-score ${leftTone || ''}`} /></div>
          <div><Roll text={right} className={`ks-score ${rightTone || ''}`} /></div>
        </div>
      </div>
    );
  }

  /** Ticker tile: the full symbol, sized to fit (never a 2-letter guess). */
  function Logo({ t, game }) {
    const size = t.length <= 2 ? 13 : t.length === 3 ? 11 : 9.5;
    const style = game ? { background: 'var(--c-inset)', color: 'var(--c-text)', fontSize: size } : { fontSize: size };
    return <span className="ks-logo" style={style}>{t}</span>;
  }

  function Tug({ you, opp }) {
    const r = K.tugRatio(you, opp);
    return (
      <div className="ks-tug" aria-label={`Tug of war: you ${$s(you)}, opponent ${$s(opp)}`}>
        <span className="ks-tug__you" style={{ flexGrow: r }} />
        <span className="ks-tug__opp" style={{ flexGrow: 1 - r }} />
      </div>
    );
  }

  // ── Line chart helper (zero baseline, gain above / loss below) ─────────
  function GainChart({ series, w = 362, h = 148, marker, weeks, run, label = 'Cumulative gain' }) {
    const pad = { t: 10, b: 22, l: 0, r: 0 };
    const min = Math.min(0, ...series);
    const max = Math.max(0, ...series);
    const x = (i) => pad.l + (i / (series.length - 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (h - pad.t - pad.b);
    const d = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${d} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
    const z = y(0);
    const id = useRef(`c${Math.random().toString(36).slice(2, 8)}`).current;
    const end = series[series.length - 1];
    return (
      <svg className="ks-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: ${$s(end)}`}>
        <defs>
          <clipPath id={`${id}a`}><rect x="0" y="0" width={w} height={z} /></clipPath>
          <clipPath id={`${id}b`}><rect x="0" y={z} width={w} height={h - z} /></clipPath>
        </defs>
        <path d={area} fill="var(--c-gain)" opacity=".1" clipPath={`url(#${id}a)`} />
        <path d={area} fill="var(--c-loss)" opacity=".1" clipPath={`url(#${id}b)`} />
        <line x1="0" x2={w} y1={z} y2={z} stroke="var(--c-border-strong)" strokeDasharray="3 4" strokeWidth="1" />
        <g className={run ? 'ks-draw ks-draw--run' : 'ks-draw'} style={{ '--len': 1 }} key={run ? 'r' : 's'}>
          <path d={d} pathLength="1" className="ks-chart__line" stroke="var(--c-gain)" clipPath={`url(#${id}a)`} strokeDasharray="1" />
          <path d={d} pathLength="1" className="ks-chart__line" stroke="var(--c-loss)" clipPath={`url(#${id}b)`} strokeDasharray="1" />
        </g>
        <circle cx={x(series.length - 1)} cy={y(end)} r="4" fill="var(--c-gain)" stroke="var(--c-surface)" strokeWidth="2" />
        {marker != null ? (
          <g>
            <line x1={x(marker)} x2={x(marker)} y1={z - 5} y2={z + 5} stroke="var(--c-text-2)" strokeWidth="1.5" />
            <text x={x(marker)} y={h - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--c-text-2)">Joined Friday Night Stocks</text>
          </g>
        ) : null}
        {weeks ? weeks.map((ix, k) => (
          <g key={k}>
            <line x1={x(ix)} x2={x(ix)} y1={h - 20} y2={h - 16} stroke="var(--c-border-strong)" strokeWidth="1" />
            <text x={Math.min(x(ix) + 2, w - 18)} y={h - 4} fontSize="11" fontWeight="600" fill="var(--c-text-2)">W{k + 1}</text>
          </g>
        )) : null}
        <text x="2" y={z - 6} fontSize="11" fontWeight="600" fill="var(--c-text-2)">$0</text>
      </svg>
    );
  }

  // Week race chart (the landing /03 chart, small, on a game surface).
  function WeekRace({ upto, live }) {
    const w = 330, h = 118, pb = 20, pt = 10;
    const pts = K.WEEK_CLOSES.slice(0, upto + 1).map((p, i) => ({ ...p, x: i }));
    if (live) pts.push({ day: 'now', x: upto + live.frac, you: live.you, opp: live.opp });
    const all = K.WEEK_CLOSES.flatMap((p) => [p.you, p.opp]).concat(live ? [live.you, live.opp] : []);
    const min = Math.min(0, ...all), max = Math.max(0, ...all);
    const X = (i) => 8 + (i / 5) * (w - 16);
    const Y = (v) => pt + (1 - (v - min) / (max - min)) * (h - pt - pb);
    const line = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Week 6 race: cumulative dollar gain by day">
        <line x1="8" x2={w - 8} y1={Y(0)} y2={Y(0)} stroke="var(--c-line)" strokeDasharray="3 4" />
        <path d={line('opp')} fill="none" stroke="var(--c-opp)" strokeWidth="2.25" strokeLinejoin="round" />
        <path d={line('you')} fill="none" stroke="var(--c-you-text)" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx={X(last.x)} cy={Y(last.opp)} r="3.5" fill="var(--c-opp)" />
        <circle cx={X(last.x)} cy={Y(last.you)} r="4" fill="var(--c-you-text)" />
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
          <text key={d} x={X(i + 1)} y={h - 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--c-text-2)">{d}</text>
        ))}
      </svg>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // 1. HOME
  // ═════════════════════════════════════════════════════════════════════
  function ThisWeekCard({ you, opp, oppName, left }) {
    const y = SD(you), o = SD(opp);
    const ahead = y.value >= o.value;
    return (
      <div className="ks-game" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>This week</span>
          <Chip kind="live">Week {K.LEAGUE.week} · Live</Chip>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-callout">
          <span style={{ color: 'var(--c-you-text)', fontWeight: 700 }}>You</span>
          <span className="ks-muted">{oppName}</span>
        </div>
        <Scores left={y.primary} right={o.primary} size="lg" />
        <Tug you={y.value} opp={o.value} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-caption">
          <span style={{ color: 'var(--c-text)' }}>{ahead ? 'You lead by' : 'You trail by'} <b className="ks-num">{margin(you, opp)}</b></span>
          <span className="ks-muted">{left}</span>
        </div>
      </div>
    );
  }

  /** Home = the league chosen in the pill. Switching leagues swaps ALL of
   * it (Giorgio, 2026-09-29): no cross-league totals. */
  /** Home = the league chosen in the pill (Giorgio, 2026-09-29: Concept B,
   * pill only). Other leagues are reached through the pill, which shows
   * "+N" more leagues; there is no list on Home. `full` renders the whole
   * scroll length. */
  function HomeScreen({ run, full }) {
    const H = K.HOME, L = K.MATCHUP.live;
    const near = K.STANDINGS_BEFORE.slice(0, 3);
    const more = K.OTHER_LEAGUES.length;
    return (
      <Device tab="home" label="Home screen" full={full}>
        <div className="ks-head">
          <span className="ks-pill"><span>{K.LEAGUE.name}</span>
            <span className="ks-pill__more" aria-label={`${more} more leagues`}>+{more}</span>
            <Icon d={ICON.chevron} size={14} width={2.6} /></span>
          <span className="ks-avatar" aria-label="Profile">RB</span>
        </div>
        <div className="ks-pad ks-stack">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="ks-caption">Your team</span>
              <span className="ks-caption ks-num"><b style={{ color: 'var(--c-text)' }}>2nd</b> of 6 · {H.record} · Week {K.LEAGUE.week} of {K.LEAGUE.weeks}</span>
            </div>
            <div className="ks-score ks-num" style={{ fontSize: 48, lineHeight: '50px', fontStretch: '75%' }}>{$(H.value)}</div>
            <div className="ks-callout ks-num" style={{ fontWeight: 700 }}>
              <span className="ks-gain">{$s(H.gain)} · {pct(H.gainPct)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>since the draft</span>
              <span className="ks-muted" style={{ fontWeight: 500 }}> · </span>
              <span className="ks-gain">{$s(H.today)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>today</span>
            </div>
          </div>
          <div className={run ? 'ks-fade-in' : undefined}>
            <ThisWeekCard you={L.you} opp={L.opp} oppName="vs Gianluigi B." left="Ends Fri 4:00 PM ET" />
          </div>
          <div className="ks-card" style={{ padding: '12px 12px 6px' }}>
            <div className="ks-section-h" style={{ padding: '0 2px' }}><h3>Season</h3><span className="ks-caption">Gain since the draft</span></div>
            <GainChart series={H.series} weeks={H.weekStarts} run={run} w={336} h={140} label="Gain since the draft" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, padding: '6px 0 8px' }}>
              {H.weekResults.map((w) => (
                <span key={w.week} className="ks-chip ks-chip--money ks-num" style={{ textTransform: 'none', letterSpacing: 0, fontStretch: '100%', fontSize: 12, height: 26, padding: 0, justifyContent: 'center' }}>
                  <b style={{ color: w.result === 'W' ? 'var(--c-gain)' : 'var(--c-loss)' }}>{w.result}</b>&nbsp;W{w.week}
                </span>
              ))}
              <span className="ks-chip" style={{ height: 26, padding: 0, justifyContent: 'center', gap: 4 }}><span className="ks-dot" />W6</span>
            </div>
            <div className="ks-seg"><span>1W</span><span>1M</span><span className="on">Season</span></div>
          </div>
          <div className="ks-card" style={{ padding: '12px 14px' }}>
            <div className="ks-section-h"><h3>Standings</h3><span className="ks-caption">Through Week 5</span></div>
            <ul className="ks-rows">
              {near.map((r) => (
                <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto auto', padding: '9px 0', background: r.you ? 'var(--c-you-tint)' : undefined }}>
                  <span className="ks-t ks-num">{r.rank}</span>
                  <span className="ks-callout" style={{ fontWeight: 700 }}>{r.name}{r.you ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>
                  <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
                  <span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 78, textAlign: 'right' }}>{$s(r.pf)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // 2. MATCHUP (live + final)
  // ═════════════════════════════════════════════════════════════════════
  function Lineup({ name, rows, align }) {
    return (
      <div>
        <div className="ks-tag" style={{ textAlign: align, marginBottom: 4 }}>{name}</div>
        <ul className="ks-rows">
          {rows.map((r) => (
            <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '1fr auto', padding: '8px 0' }}>
              <span className="ks-t ks-callout">{r.t}</span>
              <span className={`ks-callout ks-num ${tone(r.weekGain)}`} style={{ fontWeight: 600 }}>{$s(r.weekGain)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function MatchupScreen({ final }) {
    const M = K.MATCHUP;
    const s = final ? M.final : M.live;
    const you = s.you.gain, opp = s.opp.gain, lead = you - opp;
    const liveFrac = 0.63; // 1:37 PM is 63% through Thursday's 6.5-hour session
    return (
      <Device game tab="matchup" label={final ? 'Matchup, final' : 'Matchup, live'}>
        <LeagueHead chip={final ? <Chip kind="final">Week 6 · Final</Chip> : <Chip kind="live">Week 6 · Live</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-seg ks-seg--game"><span className="on">My matchup</span><span>All matchups</span></div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="ks-avatar ks-avatar--sm">RB</span>
                <span className="ks-callout" style={{ fontWeight: 700 }}>Roberto B. <span className="ks-muted" style={{ fontWeight: 500 }}>(you)</span></span>
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="ks-callout" style={{ fontWeight: 700 }}>Gianluigi B.</span>
                <span className="ks-avatar ks-avatar--sm ks-avatar--opp">GB</span>
              </span>
            </div>
            <Scores left={SD(s.you).primary} right={SD(s.opp).primary} size="xl" />
            <Tug you={SD(s.you).value} opp={SD(s.opp).value} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="ks-callout">{final ? 'Roberto B. won by' : 'Roberto B. leads by'} <b className="ks-num">{margin(s.you, s.opp)}</b></span>
              <span className="ks-caption ks-muted ks-num">Tiebreak {SD(s.you).secondary} vs {SD(s.opp).secondary}</span>
            </div>
          </div>
          {final ? (
            <div className="ks-winner ks-fade-in"><span>Roberto B. wins Week 6</span><span className="ks-num">W · 5–1</span></div>
          ) : null}
          <div className="ks-chyron ks-chyron--in" key={final ? 'f' : 'l'}>
            {final ? null : <span className="ks-dot ks-dot--pulse" />}
            <span>{final ? K.CHYRONS.Fri : K.CHYRONS.Thu}</span>
          </div>
          <div className="ks-raised" style={{ padding: '10px 8px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
              <span className="ks-tag">This week</span>
              <span className="ks-caption ks-muted">{final ? 'Fri close' : `Live · ${M.live.label}`}</span>
            </div>
            <WeekRace upto={final ? 5 : 3} live={final ? null : { frac: liveFrac, you, opp }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
            <Lineup name="Roberto B." rows={s.you.rows} align="left" />
            <Lineup name="Gianluigi B." rows={s.opp.rows} align="left" />
          </div>
          <div className="ks-caption ks-muted" style={{ textAlign: 'center' }}>
            {final ? 'Next: Week 7 vs Paolo M. · starts Mon 9:30 AM ET' : 'Scored on dollar gain; percent breaks ties · Ends Fri 4:00 PM ET'}
          </div>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // 3. LEAGUE STANDINGS (week final, with the FLIP re-sort)
  // ═════════════════════════════════════════════════════════════════════
  function LeagueScreen({ after }) {
    const rows = after ? K.STANDINGS_FINAL : K.STANDINGS_BEFORE;
    const pos = Object.fromEntries(rows.map((r) => [r.id, r]));
    const ROW = 56;
    return (
      <Device tab="league" label="League standings">
        <LeagueHead chip={<Chip kind={after ? 'final' : 'live'}>{after ? 'Week 6 · Final' : 'Week 6 · Live'}</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-seg"><span className="on">Standings</span><span>Schedule</span><span>History</span></div>
          <div className="ks-game" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 14px 8px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Week 6 of 14</span>
                <span className="ks-caption ks-muted">{after ? 'Records updated · Fri close' : 'Through Week 5'}</span>
              </div>
              {after ? <div className="ks-chyron ks-chyron--in"><span>Roberto B. takes 1st on season gain</span></div> : null}
              <div style={{ display: 'grid', gridTemplateColumns: '22px 30px 30px 1fr auto 86px', gap: 10 }} className="ks-tag">
                <span>#</span><span /><span /><span>Manager</span><span>W–L</span><span style={{ textAlign: 'right', whiteSpace: 'nowrap', fontStretch: '100%' }}>Season gain</span>
              </div>
            </div>
            <div className="ks-lb" style={{ height: ROW * 6 }}>
              {K.PLAYERS.map((p) => {
                const r = pos[p.id];
                const d = after ? r.delta : 0;
                return (
                  <div key={p.id} className={p.you ? 'ks-lbrow ks-lbrow--you' : 'ks-lbrow'} style={{ transform: `translateY(${(r.rank - 1) * ROW}px)` }}>
                    <span className="ks-score" style={{ fontSize: 22 }}>{r.rank}</span>
                    <span className={`ks-delta ${d > 0 ? 'ks-delta--up' : d < 0 ? 'ks-delta--down' : 'ks-delta--flat'}`} key={`${after}${d}`}>
                      {d > 0 ? <span className="ks-pop">▲{d}</span> : d < 0 ? <span className="ks-pop">▼{-d}</span> : '–'}
                    </span>
                    <span className={p.you ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{p.init}</span>
                    <span className="ks-callout" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{p.name}{p.you ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>
                    <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
                    <span className={`ks-callout ks-num ks-right ${tone(r.pf)}`} style={{ fontWeight: 700 }}>{$s(r.pf)}</span>
                  </div>
                );
              })}
            </div>
            <div className="ks-caption ks-muted" style={{ padding: '8px 14px 14px' }}>Ranked by win percentage, then head-to-head, then season gain. This is also the playoff seeding.</div>
          </div>
          {after ? (
          <div className="ks-card ks-fade-in" style={{ padding: '12px 14px' }}>
            <div className="ks-section-h"><h3>Week 6 results</h3><span className="ks-caption">Final</span></div>
            <ul className="ks-rows">
              {K.WEEK6.map((m) => {
                const a = K.byId[m.a], b = K.byId[m.b];
                const aw = m.ga > m.gb;
                return (
                  <li key={m.a} className="ks-row" style={{ gridTemplateColumns: '1fr auto', gap: 4 }}>
                    <span className="ks-callout"><b style={{ fontWeight: aw ? 800 : 500 }}>{a.name}</b> <span className="ks-muted">vs</span> <b style={{ fontWeight: aw ? 500 : 800 }}>{b.name}</b></span>
                    <span className="ks-callout ks-num" style={{ fontWeight: 600 }}>
                      <span className={tone(m.ga)}>{$s(m.ga)}</span> <span className="ks-muted">·</span> <span className={tone(m.gb)}>{$s(m.gb)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          ) : null}
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // 4. DRAFT ROOM (on the clock, the snake board, search, your roster)
  // ═════════════════════════════════════════════════════════════════════
  function SnakeBoard({ current, landed, autoPicks = [] }) {
    const ref = useRef(null);
    const cells = useRef({});
    const [geo, setGeo] = useState(null);
    useLayoutEffect(() => {
      const box = ref.current.getBoundingClientRect();
      const k = box.width / ref.current.offsetWidth || 1; // undo the board's CSS scale
      const c = {};
      for (const [n, el] of Object.entries(cells.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        c[n] = { x: (r.left - box.left + r.width / 2) / k, y: (r.top - box.top + r.height / 2) / k, w: r.width / k, h: r.height / k };
      }
      setGeo({ c, w: ref.current.offsetWidth });
    }, []);
    const picks = K.DRAFT_PICKS;
    const seats = [...K.PLAYERS].sort((a, b) => a.seat - b.seat);
    const rows = [1, 2, 3].map((r) => picks.filter((p) => p.round === r).sort((a, b) => K.seatForPick(a.pick, 6) - K.seatForPick(b.pick, 6)));
    // The track: through every pick centre in pick order; between rounds, a
    // half-loop OUTSIDE the row ends (right after odd rounds, left after even).
    function path(toPick) {
      if (!geo) return '';
      let d = '';
      for (let n = 1; n <= toPick; n++) {
        const p = geo.c[n];
        if (n === 1) { d += `M${p.x},${p.y}`; continue; }
        const q = geo.c[n - 1];
        if (p.y !== q.y) {
          const right = Math.ceil((n - 1) / 6) % 2 === 1;
          const r = (p.y - q.y) / 2;
          // A 14px-deep half-loop just outside the row end (stays inside
          // the 20px screen gutter), then into the next round's first cell.
          const edge = right ? q.x + q.w / 2 + 2 : q.x - q.w / 2 - 2;
          d += ` L${edge},${q.y} A14,${r} 0 0 ${right ? 1 : 0} ${edge},${p.y} L${p.x},${p.y}`;
        } else d += ` L${p.x},${p.y}`;
      }
      return d;
    }
    const chevrons = [];
    if (geo) {
      for (let n = 2; n <= 18; n++) {
        const p = geo.c[n], q = geo.c[n - 1];
        if (p.y !== q.y) continue;
        chevrons.push({ n, x: (p.x + q.x) / 2, y: p.y, dir: p.x > q.x ? 1 : -1 });
      }
    }
    // The blue (drawn) track runs to whoever is on the clock.
    const reach = landed ? current + 1 : current;
    return (
      <div>
        <div className="ks-board__cols" style={{ marginBottom: 6 }}>
          {seats.map((p) => <span key={p.id} className="ks-tag" style={p.you ? { color: 'var(--c-you-text)' } : undefined}>{p.init}</span>)}
        </div>
        <div className="ks-board" ref={ref} style={{ display: 'grid', rowGap: 18 }}>
          <svg className="ks-board__track" width="100%" height="100%" aria-hidden="true">
            <path d={path(18)} fill="none" stroke="var(--c-line)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d={path(reach)} fill="none" stroke="var(--c-you)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'all var(--sp-motion-duration-slow) var(--sp-motion-ease-settle)' }} />
            {chevrons.map((c) => (
              <path key={c.n} d={`M${c.x - 2 * c.dir},${c.y - 4} L${c.x + 2 * c.dir},${c.y} L${c.x - 2 * c.dir},${c.y + 4}`} fill="none" stroke={c.n <= reach ? 'var(--c-on-accent)' : 'var(--c-text-2)'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
          {rows.map((row, ri) => (
            <div key={ri} className="ks-board__row">
              {row.map((p) => {
                const you = K.byId[p.player].you;
                const isClock = landed ? p.pick === current + 1 : p.pick === current;
                const filled = p.pick < current || (landed && p.pick === current);
                const cls = ['ks-cell', you ? 'ks-cell--you' : '', isClock ? 'ks-cell--clock' : '', !filled && !isClock ? 'ks-cell--future' : '', landed && p.pick === current ? 'ks-cell--landed' : ''].join(' ');
                return (
                  <div key={p.pick} className={cls} ref={(el) => (cells.current[p.pick] = el)}>
                    <span className="ks-cell__n">{p.pick}</span>
                    {filled && autoPicks.includes(p.pick) ? <span className="ks-auto" title="Auto-picked">Auto</span> : null}
                    {filled ? <span className="ks-cell__t">{p.intended}</span> : <span className="ks-cell__t" style={{ opacity: 0 }}>·</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="ks-board__rlabel ks-caption ks-muted" style={{ marginTop: 10 }}>
          <span>Round 1 → · Round 2 ← · Round 3 →</span>
          <span>Order reverses each round</span>
        </div>
      </div>
    );
  }

  function DraftScreen({ landed }) {
    const D = K.DRAFT_MOMENT;
    const secs = landed ? D.secondsTotal : D.secondsLeft;
    const frac = secs / D.secondsTotal;
    const R = 36, C = 2 * Math.PI * R;
    return (
      <Device game tab="league" label="Draft room">
        <LeagueHead chip={<Chip kind="live">Drafting</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 16 }}>
          <div className="ks-raised" style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
            <div className="ks-ring">
              <svg width="84" height="84" viewBox="0 0 84 84">
                <circle cx="42" cy="42" r={R} fill="none" stroke="var(--c-line)" strokeWidth="6" />
                <circle cx="42" cy="42" r={R} fill="none" stroke={landed ? 'var(--c-text-2)' : 'var(--c-live)'} strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
              </svg>
              <span className="ks-ring__t">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {landed ? (
                <>
                  <span className="ks-title">Paolo M. is up</span>
                  <span className="ks-callout ks-muted">Round 2 · Pick 12, then 13</span>
                  <span className="ks-caption" style={{ color: 'var(--c-you-text)' }}>You took AAPL · next pick 14</span>
                </>
              ) : (
                <>
                  <span className="ks-title" style={{ color: 'var(--c-live-text)' }}>You're on the clock</span>
                  <span className="ks-callout">Round 2 · Pick 11</span>
                  <span className="ks-caption ks-muted">Then Paolo M. picks twice (12, 13)</span>
                  <span className="ks-caption ks-muted">{D.secondsTotal}-second picks · set by the commissioner</span>
                </>
              )}
            </div>
          </div>
          <SnakeBoard current={D.pick} landed={landed} />
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="ks-search">
              <Icon d={ICON.search} size={18} />
              <span className="ks-callout">{K.DRAFT_SEARCH.query}</span><span className="ks-caret" />
            </div>
            <ul className="ks-rows">
              {K.DRAFT_SEARCH.results.map((r, i) => (
                <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto auto', padding: '9px 0' }}>
                  <Logo t={r.t} game />
                  <span><span className="ks-t ks-callout">{r.t}</span><br /><span className="ks-caption ks-muted">{r.co}</span></span>
                  <span className="ks-callout ks-num ks-muted">{$(r.price)}</span>
                  {i === 0 ? (
                    <span className={landed ? 'ks-chip' : 'ks-btn ks-btn--ongame'} style={landed ? undefined : { height: 34, padding: '0 14px', fontSize: 14 }}>{landed ? 'Drafted' : 'Draft'}</span>
                  ) : (
                    <span className="ks-muted" aria-label="Queue"><Icon d={ICON.plus} size={20} /></span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="ks-section-h"><h3>Your roster</h3><span className="ks-caption ks-muted">{landed ? 2 : 1} of 6 · $2,000 per slot</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['NVDA', landed ? 'AAPL' : null, null, null, null, null].map((t, i) => (
                <span key={i} className={t ? 'ks-slot ks-slot--on' + (i === 1 ? ' ks-fade-in' : '') : 'ks-slot'}>{t || `Rd ${i + 1}`}</span>
              ))}
            </div>
          </div>
        </div>
      </Device>
    );
  }

  /** Create league · Draft step (the same controls appear in League
   * settings until the draft starts). Pick clock: 30–90s, default 60s. */
  function DraftSettingsScreen() {
    const pc = K.LEAGUE.pickClock;
    const opts = [];
    for (let v = pc.min; v <= pc.max; v += pc.step) opts.push(v);
    const Row = ({ k, v, sub }) => (
      <li className="ks-row" style={{ gridTemplateColumns: '1fr auto 16px', padding: '13px 0' }}>
        <span><span className="ks-callout" style={{ fontWeight: 600 }}>{k}</span>{sub ? <><br /><span className="ks-caption">{sub}</span></> : null}</span>
        <span className="ks-callout ks-muted">{v}</span>
        <span className="ks-muted"><Icon d={ICON.right} size={16} /></span>
      </li>
    );
    return (
      <Device noTabs label="Create league, draft settings">
        <div className="ks-head">
          <span className="ks-muted" style={{ display: 'flex', alignItems: 'center', gap: 2 }}><span style={{ transform: 'rotate(180deg)', display: 'flex' }}><Icon d={ICON.right} size={20} /></span><span className="ks-callout">Back</span></span>
          <span className="ks-caption ks-num">Step 3 of 4</span>
        </div>
        <div className="ks-pad ks-stack">
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 14 }}>
              {[1, 2, 3, 4].map((i) => <span key={i} style={{ height: 4, borderRadius: 2, background: i <= 3 ? 'var(--c-accent)' : 'var(--c-border)' }} />)}
            </div>
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>Draft</h2>
            <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>A live snake draft. Everyone picks in turn, and the order reverses each round.</p>
          </div>
          <div className="ks-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="ks-headline" style={{ fontWeight: 700 }}>Pick clock</span>
              <span className="ks-callout ks-num"><b>{pc.seconds} seconds</b></span>
            </div>
            <div className="ks-seg">
              {opts.map((v) => <span key={v} className={v === pc.seconds ? 'on ks-num' : 'ks-num'}>{v}s</span>)}
            </div>
            <span className="ks-caption">Time each manager has to make a pick. 60 seconds is the default.</span>
          </div>
          <div className="ks-card" style={{ padding: '2px 14px' }}>
            <ul className="ks-rows">
              <Row k="Draft date" v="Sat, Oct 3 · 7:00 PM" />
              <li className="ks-row" style={{ gridTemplateColumns: '1fr', padding: '13px 0', gap: 8 }}>
                <span className="ks-callout" style={{ fontWeight: 600 }}>Draft order</span>
                <div className="ks-seg"><span className="on">Random</span><span>Manual</span></div>
                <span className="ks-caption">Random: revealed 1 hour before the draft (Sat 6:00 PM).<br />Manual: arrange it any time up to 1 hour before the draft.<br />You can switch until then.</span>
              </li>
              <Row k="Rounds" v="6" sub="One per roster slot" />
              <li className="ks-row" style={{ gridTemplateColumns: '1fr', padding: '13px 0' }}>
                <span><span className="ks-callout" style={{ fontWeight: 600 }}>If time runs out</span><br /><span className="ks-caption">We pick for you: the first stock still available in your queue, otherwise the biggest company that fits the league's rules. Never a random pick, never a skip.</span></span>
              </li>
            </ul>
          </div>
          <span className="ks-btn">Next</span>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // 5. PORTFOLIO + STOCK SHEET (Sell pre-selected)
  // ═════════════════════════════════════════════════════════════════════
  function StockSheet({ open }) {
    const N = K.NVDA;
    const pts = N.dayPoints;
    const w = 362, h = 120;
    const min = Math.min(...pts) - 1, max = Math.max(...pts) + 1;
    const X = (i) => (i / (pts.length - 1)) * (w - 8);
    const Y = (v) => 6 + (1 - (v - min) / (max - min)) * (h - 12);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const perShare = N.thu - N.prev;
    return (
      <>
        <div className="ks-scrim" style={{ opacity: open ? 1 : 0, pointerEvents: 'none' }} />
        <div className={open ? 'ks-sheet' : 'ks-sheet ks-sheet--hidden'} aria-hidden={!open}>
          <div className="ks-grabber" />
          <div style={{ padding: '10px 20px 20px', display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Logo t="NVDA" />
              <span style={{ flex: 1 }}><span className="ks-headline" style={{ fontWeight: 800 }}>NVDA</span><br /><span className="ks-caption">NVIDIA</span></span>
              <span className="ks-muted"><Icon d={ICON.close} size={22} /></span>
            </div>
            <div>
              <div className="ks-num" style={{ fontSize: 34, lineHeight: '38px', fontWeight: 800 }}>{$(N.thu)}</div>
              <div className="ks-callout ks-gain ks-num" style={{ fontWeight: 700 }}>{$s(perShare)} · {pct(N.todayPct)} <span className="ks-muted" style={{ fontWeight: 500 }}>today</span></div>
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="NVDA today">
              <line x1="0" x2={w} y1={Y(N.prev)} y2={Y(N.prev)} stroke="var(--c-border-strong)" strokeDasharray="3 4" />
              <text x="0" y={Y(N.prev) + 14} fontSize="11" fontWeight="600" fill="var(--c-text-2)">Prev close {$(N.prev)}</text>
              <path d={d} fill="none" stroke="var(--c-gain)" strokeWidth="2.25" strokeLinejoin="round" />
              <circle cx={X(pts.length - 1)} cy={Y(pts[pts.length - 1])} r="4" fill="var(--c-gain)" stroke="var(--c-surface)" strokeWidth="2" />
            </svg>
            <div className="ks-seg">{N.range.map((r, i) => <span key={r} className={i === 0 ? 'on' : undefined}>{r}</span>)}</div>
            <div className="ks-card" style={{ padding: 14, boxShadow: 'none', background: 'var(--c-sunken)', border: 0 }}>
              <div className="ks-section-h"><h3>Your position</h3><span className="ks-caption">{N.ownership}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 10 }} className="ks-num">
                <span><span className="ks-caption">Shares</span><br /><b>{N.qty.toFixed(4)}</b></span>
                <span><span className="ks-caption">Avg entry</span><br /><b>{$(N.draft)}</b></span>
                <span><span className="ks-caption">Value</span><br /><b>{$(N.value)}</b></span>
                <span><span className="ks-caption">Gain</span><br /><b className="ks-gain">{$s(N.gain)} · {pct((N.gain / N.cost) * 100)}</b></span>
              </div>
            </div>
            <div className="ks-seg" style={{ height: 40 }}><span>Buy</span><span className="on">Sell</span></div>
            <div className="ks-callout ks-num"><b>Sell all {N.qty.toFixed(4)} sh ≈ {$(N.value)}</b><br /><span className="ks-caption">A slot holds one stock, so you sell the whole position. The cash stays in this slot to reinvest.</span></div>
            <span className="ks-btn">Review sell</span>
            <span className="ks-caption" style={{ textAlign: 'center' }}>Market data provided by Alpaca</span>
          </div>
        </div>
      </>
    );
  }

  /** Buy with a freed slot's proceeds (fixed-per-slot leagues): the amount
   * is capped at that slot's cash, never a fresh $2,000. */
  function BuySheet({ open }) {
    const S = K.SALE, B = S.buy;
    return (
      <>
        <div className="ks-scrim" style={{ opacity: open ? 1 : 0, pointerEvents: 'none' }} />
        <div className={open ? 'ks-sheet' : 'ks-sheet ks-sheet--hidden'} aria-hidden={!open}>
          <div className="ks-grabber" />
          <div style={{ padding: '10px 20px 20px', display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Logo t={B.t} />
              <span style={{ flex: 1 }}><span className="ks-headline" style={{ fontWeight: 800 }}>{B.t}</span><br /><span className="ks-caption">{B.co}</span></span>
              <span className="ks-muted"><Icon d={ICON.close} size={22} /></span>
            </div>
            <div>
              <div className="ks-num" style={{ fontSize: 34, lineHeight: '38px', fontWeight: 800 }}>{$(B.price)}</div>
              <div className="ks-callout ks-gain ks-num" style={{ fontWeight: 700 }}>{pct(B.todayPct)} <span className="ks-muted" style={{ fontWeight: 500 }}>today · No one in {K.LEAGUE.name} owns {B.t}</span></div>
            </div>
            <div className="ks-seg" style={{ height: 40 }}><span className="on">Buy</span><span>Sell</span></div>
            <div className="ks-card" style={{ padding: 14, boxShadow: 'none', background: 'var(--c-sunken)', border: 0, display: 'grid', gap: 4 }}>
              <span className="ks-headline" style={{ fontWeight: 700 }}>You have {$(S.proceeds)} from selling {S.sold} to invest</span>
              <span className="ks-caption">Your slot's buying power is what the sale brought in, not a fresh {$(K.LEAGUE.notionalPerSlot)}.</span>
            </div>
            <div className="ks-card" style={{ padding: '2px 14px', boxShadow: 'none' }}>
              <ul className="ks-rows">
                <li className="ks-row" style={{ gridTemplateColumns: '1fr auto 16px', padding: '12px 0' }}>
                  <span className="ks-callout" style={{ fontWeight: 600 }}>Invest from</span>
                  <span className="ks-callout ks-muted ks-num">{S.sold} slot · {$(S.proceeds)}</span>
                  <span className="ks-muted"><Icon d={ICON.right} size={16} /></span>
                </li>
              </ul>
            </div>
            <div>
              <div className="ks-caption">You invest</div>
              <span className="ks-num" style={{ fontSize: 30, fontWeight: 800 }}>{$(S.proceeds)}</span>
              <div className="ks-caption ks-num">≈ {B.qty.toFixed(4)} shares at {$(B.price)}. The whole slot goes into {B.t}.</div>
            </div>
            <span className="ks-btn">Review buy</span>
          </div>
        </div>
      </>
    );
  }

  /** variant: 'live' (all six slots invested) | 'cash' (TSLA sold, its slot
   * holds the proceeds) | 'buy' (cash state with the buy sheet open). */
  function PortfolioScreen({ sheet, variant = 'live' }) {
    const P = K.PORTFOLIO_LIVE, S = K.SALE;
    const cash = variant === 'cash' || variant === 'buy';
    const rows = cash ? P.rows.filter((r) => r.t !== S.sold) : P.rows;
    const overlay = variant === 'buy' ? <BuySheet open /> : <StockSheet open={sheet} />;
    return (
      <Device tab="portfolio" label={variant === 'buy' ? 'Buying with sale proceeds' : cash ? 'Portfolio with a slot ready to invest' : sheet ? 'Portfolio with the NVDA sheet open' : 'Portfolio'} overlay={overlay}>
        <LeagueHead chip={<Chip kind="live">Live</Chip>} />
        <div className="ks-pad ks-stack">
          <div>
            <div className="ks-caption">Portfolio value{cash ? ' · includes cash' : ''}</div>
            <div className="ks-score ks-num" style={{ fontSize: 48, lineHeight: '50px', fontStretch: '75%' }}>{$(P.value)}</div>
            <div className="ks-callout ks-num" style={{ fontWeight: 700 }}>
              <span className="ks-gain">{$s(P.gain)} · {pct(P.gainPct)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>since the draft</span>
            </div>
            <div className="ks-callout ks-num" style={{ fontWeight: 700 }}>
              <span className="ks-gain">{$s(P.today)} · {pct(P.todayPct)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>today</span>
            </div>
          </div>
          <div className="ks-card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
            <span className="ks-callout"><b>{cash ? '5 of 6' : '6 of 6'}</b> slots invested</span>
            <span className="ks-callout ks-muted">{cash ? '1 ready to invest' : `${$(K.LEAGUE.notionalPerSlot)} per slot at the draft`}</span>
          </div>
          <div>
            <div className="ks-section-h"><h3>Holdings</h3><span className="ks-caption">Value · today</span></div>
            <div className="ks-card" style={{ padding: '2px 14px' }}>
              <ul className="ks-rows">
                {rows.map((r) => (
                  <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto', background: sheet && r.t === 'NVDA' ? 'var(--c-sunken)' : undefined }}>
                    <Logo t={r.t} />
                    <span><span className="ks-t">{r.t}</span><br /><span className="ks-caption ks-num">{r.co} · {r.qty.toFixed(2)} sh</span></span>
                    <span className="ks-right ks-num"><b>{$(r.value)}</b><br /><span className={`ks-caption ${tone(r.todayPct)}`} style={{ fontWeight: 700 }}>{pct(r.todayPct)}</span></span>
                  </li>
                ))}
                {cash ? (
                  <li className="ks-row ks-fade-in" style={{ gridTemplateColumns: '36px 1fr auto' }}>
                    <span className="ks-logo" style={{ background: 'var(--c-gain-tint)', color: 'var(--c-gain)', fontSize: 16 }}>$</span>
                    <span><span className="ks-t">Cash</span><br /><span className="ks-caption">From selling {S.sold} · ready to invest</span></span>
                    <span className="ks-right ks-num"><b>{$(S.proceeds)}</b><br /><span className="ks-caption" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Invest ›</span></span>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
          <div className="ks-card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><b>Trade history</b><br /><span className="ks-caption">{cash ? `Sold ${S.sold} · includes your 6 draft picks` : 'Includes your 6 draft picks'}</span></span>
            <span className="ks-muted"><Icon d={ICON.right} size={18} /></span>
          </div>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Market data provided by Alpaca</span>
        </div>
      </Device>
    );
  }

  // The building blocks, shared with inventory.jsx (step 2's screens).
  window.KSKit = { SnakeBoard, Device, LeagueHead, Chip, Icon, ICON, Logo, Scores, Tug, GainChart, WeekRace, ThisWeekCard, SD, margin, $, $s, pct, tone };
  window.KSScreens = { HomeScreen, MatchupScreen, LeagueScreen, DraftScreen, DraftSettingsScreen, PortfolioScreen };
})();
