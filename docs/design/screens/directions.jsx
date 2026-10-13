// Your call: direction (W1 of docs/plans/2026-10-12-visual-language-reset.md).
// Design Lead, 2026-10-12. Three directions for the app's visual language, Light and Dark together:
//   A · Game Night (primary: Sleeper)   B · Broadcast (primary: ESPN)   C · Terminal (primary: Robinhood)
// Same structure (the calm-Home ruling, the UX rules, Giorgio's Matchup ruling), same copy,
// same data (data.js). Only the skin changes. Each direction is ONE token block in
// directions.css; every colour here is a role (var(--c-*) / var(--d-*)), never a literal.
// The studied DNA behind the values: docs/design/design.md.

(function () {
  const { useState, useLayoutEffect, useRef, useContext, createContext } = React;
  // Giorgio picked A with amendments (2026-10-12): the draft tiles take a sector LINE at the
  // bottom (not a fill), and no sparklines on rows. The archived call renders with
  // amended = false, so it still shows the three directions exactly as he chose between them.
  const Amended = createContext(true);
  const K = window.KS;
  const { Device, Icon, ICON, SD, $, $s, pct } = window.KSKit;
  const REF = window.KS_REFS || {};
  const G = 20; // screen gutter
  const tone = (v) => (Math.round(Math.abs(v) * 100) === 0 ? 'dr-zero' : v > 0 ? 'dr-gain' : 'dr-loss');
  const toneVar = (v) => (Math.round(Math.abs(v) * 100) === 0 ? 'var(--c-zero)' : v > 0 ? 'var(--c-gain)' : 'var(--c-loss)');

  // ── Sample data that data.js doesn't carry (captioned "sample" on the board) ──
  // Sector per symbol, for the category pill and the draft tiles' colour.
  const SECTOR = {
    MSFT: 'tech', NVDA: 'tech', AVGO: 'tech', AMD: 'tech', PLTR: 'tech', AAPL: 'tech', CRM: 'tech', ORCL: 'tech',
    META: 'comm', GOOGL: 'comm', DIS: 'comm',
    AMZN: 'cons', TSLA: 'cons', COST: 'cons', NKE: 'cons', KO: 'cons', UBER: 'cons',
    COIN: 'fin', JPM: 'fin', V: 'fin', 'BRK.B': 'fin', BA: 'fin',
    LLY: 'health', UNH: 'health',
  };
  const SECTOR_LABEL = { tech: 'Tech', comm: 'Comm', cons: 'Cons', fin: 'Fin', health: 'Hlth' };
  // A category-slot league (Giorgio, 2026-10-12: grouped by category, in the league's slot
  // order, the category acting as the position label; best week first inside a group).
  // SAMPLE: Stock Scudetto re-cast with four category slots that both rosters fill legally.
  // The holdings and every number are data.js's; only the slot names are invented.
  const CAT_SLOTS = [
    { name: 'Tech & Media', you: ['NVDA', 'AAPL'], opp: ['AMZN', 'DIS'] },
    { name: 'Consumer', you: ['COST', 'TSLA'], opp: ['NKE', 'KO'] },
    { name: 'Financials', you: ['V'], opp: ['JPM'] },
    { name: 'Flex', you: ['CRM'], opp: ['BA'] },
  ];
  // A price-tier league (also slotted, Giorgio 2026-10-12: "$100–$200 ×2", then "$200–$400 ×2").
  // SAMPLE: data.js's own stocks dealt into identical tier slots for two managers; one share each
  // (tier leagues buy one share), tier set by the draft price, week gain = Thursday − Monday open.
  const TIER_SLOTS = [
    { name: '$200–$400', you: ['NVDA', 'CRM', 'TSLA'], opp: ['V', 'AMZN', 'JPM'] },
    { name: '$100–$200', you: ['AAPL'], opp: ['BA'] },
    { name: '$50–$100', you: ['KO'], opp: ['NKE'] },
  ];
  const ALL_ROWS = [...K.lineup('roberto', 'thu'), ...K.lineup('gianluigi', 'thu')];
  const oneShare = (t, final) => {
    const r = ALL_ROWS.find((x) => x.t === t);
    const price = final ? r.fri : r.thu;
    return { ...r, price, weekGain: Math.round((price - r.mon) * 100) / 100 };
  };
  function tierMatch(final) {
    const side = (k) => {
      const rows = TIER_SLOTS.flatMap((g) => g[k]).map((t) => oneShare(t, final));
      const gain = Math.round(rows.reduce((a, r) => a + r.weekGain, 0) * 100) / 100;
      const start = rows.reduce((a, r) => a + r.mon, 0);
      return { gain, pct: (gain / start) * 100, rows };
    };
    return { you: side('you'), opp: side('opp') };
  }
  /** "Tech ×3", "Flex": the count shows only when the slot holds more than one (Giorgio's example). */
  const slotLabel = (g) => (g.you.length > 1 ? `${g.name} ×${g.you.length}` : g.name);

  // ── Frame scaling ─────────────────────────────────────────────────────
  /** Scales a 402pt phone (874 tall, or its measured height when full) to its column. */
  function Fit({ children }) {
    const box = useRef(null);
    const inner = useRef(null);
    const [k, setK] = useState(0.7);
    const [h, setH] = useState(874);
    useLayoutEffect(() => {
      const ro = new ResizeObserver(() => {
        if (!box.current || !inner.current) return;
        setK(Math.min(1, box.current.clientWidth / 402));
        setH(inner.current.firstChild ? inner.current.firstChild.offsetHeight : 874);
      });
      ro.observe(box.current);
      ro.observe(inner.current);
      return () => ro.disconnect();
    }, []);
    return (
      <div className="b-fit" ref={box} style={{ height: h * k, maxWidth: 402 }}>
        <div className="b-fit__in" ref={inner} style={{ transform: `scale(${k})`, width: 402, borderRadius: 56 }}>{children}</div>
      </div>
    );
  }

  /** A reference screenshot, hotlinked and cropped (REF[id].crop = [x0, y0, x1, y1]). */
  function RefImg({ id, trait }) {
    const r = REF[id];
    if (!r) return null;
    const [x0, y0, x1, y1] = r.crop;
    const cw = x1 - x0, ch = y1 - y0;
    const style = {
      backgroundImage: `url("${r.src}")`,
      backgroundSize: `${100 / cw}% auto`,
      backgroundPosition: `${cw < 1 ? (x0 / (1 - cw)) * 100 : 0}% ${ch < 1 ? (y0 / (1 - ch)) * 100 : 0}%`,
      aspectRatio: `${cw * r.w} / ${ch * r.h}`,
    };
    return (
      <div className="dr-ref">
        <div className="dr-ref__img" style={style} role="img" aria-label={`Reference: ${r.name}`} />
        <span className="dr-ref__cap"><b>{r.name}</b>{trait}</span>
      </div>
    );
  }

  /** One board item: the reference on the left, the direction's frame on the right. */
  function Pair({ refId, trait, lightRef, lightTrait, caption, note, frame }) {
    return (
      <figure className="dr-pair" style={{ margin: 0 }}>
        <RefImg id={refId} trait={trait} />
        <div><p className="dr-theme-lbl">Dark</p><Fit>{frame('dark')}</Fit></div>
        <div><p className="dr-theme-lbl">Light</p><Fit>{frame('light')}</Fit></div>
        <RefImg id={lightRef} trait={lightTrait} />
        <figcaption><b>{caption}</b> {note}</figcaption>
      </figure>
    );
  }

  // ── Shared frame pieces ───────────────────────────────────────────────
  function Phone({ d, t = 'dark', tab, label, money, full, overlay, children }) {
    return (
      <div className={`dr dir-${d}${t === 'light' ? ` dir-${d}-light` : ''}`}>
        <Device tab={tab} label={label} full={full} overlay={overlay} style={money ? { background: 'var(--d-money-bg)' } : undefined}>{children}</Device>
      </div>
    );
  }
  const Av = ({ init, you, size = 36 }) => (
    <span className={you ? 'dr-av dr-av--you' : 'dr-av'} style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}>{init}</span>
  );
  function Head({ chip, league = K.LEAGUE.name }) {
    return (
      <div className="ks-head" style={{ paddingInline: G }}>
        <span className="ks-pill"><span>{league}</span><span className="ks-pill__more">+{K.OTHER_LEAGUES.length}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
        {chip || <Av init="RB" you size={34} />}
      </div>
    );
  }
  const LiveChip = () => <span className="dr-chip"><span className="dr-dot" />Live</span>;
  const FinalChip = () => <span className="dr-chip dr-chip--final">Final</span>;
  const Chev = ({ size = 16 }) => <span className="dr-muted" style={{ display: 'inline-flex' }} aria-label="Opens"><Icon d={ICON.right} size={size} width={2.4} /></span>;
  const Body = ({ gap = 24, children, pad = G }) => (
    <div style={{ padding: `0 ${pad}px 24px`, display: 'flex', flexDirection: 'column', gap }}>{children}</div>
  );

  /** A sparkline through the real points only (straight segments; it stops at the last one). */
  function Spark({ pts, w = 44, h = 18, color }) {
    const min = Math.min(...pts), max = Math.max(...pts);
    const X = (i) => (i / (pts.length - 1)) * (w - 4) + 2;
    const Y = (v) => 2 + (1 - (v - min) / (max - min || 1)) * (h - 4);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
        <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(pts.length - 1)} cy={Y(pts[pts.length - 1])} r="2" fill={color} />
      </svg>
    );
  }
  /** A stock's week through the real closes: Monday open → Wednesday close → Thursday live (→ Friday close). */
  const weekPts = (r, final) => (final ? [r.mon, r.prev, r.thu, r.fri] : [r.mon, r.prev, r.thu]);

  // ── The season chart (Home) and the value chart (Portfolio) ───────────
  const RESULTS = [...K.HOME.weekResults.map((w) => w.result), 'live'];
  /** Full-bleed line, edge to edge (S4). `marks` = the W/L marks on the axis (calm-Home). */
  function Line({ d, series, starts, h = 124, marks, base = 0, label }) {
    const w = 402;
    const pad = { t: 14, b: marks ? 24 : 8 };
    const min = Math.min(base, ...series), max = Math.max(base, ...series);
    const X = (i) => (i / (series.length - 1)) * (w - 22) + 1;
    const Y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (h - pad.t - pad.b);
    const path = series.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const end = series[series.length - 1];
    const ex = X(series.length - 1), ey = Y(end);
    const z = Y(base);
    const style = {
      a: { stroke: 'var(--c-gain)', sw: 2.5, fill: false, zero: 'var(--c-border-strong)', dash: '3 5' },
      b: { stroke: 'var(--c-gain)', sw: 3, fill: true, zero: 'var(--c-line)', dash: '0' },
      c: { stroke: 'var(--c-gain)', sw: 2, fill: false, zero: 'var(--c-line)', dash: '2 6' },
    }[d];
    const spans = starts ? starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : series.length - 1]) : [];
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} style={{ display: 'block', marginInline: -G, overflow: 'visible' }}>
        {style.fill ? <path d={`${path} L${ex},${z} L${X(0)},${z} Z`} fill="var(--c-gain)" opacity=".1" /> : null}
        <line x1="0" x2={w} y1={z} y2={z} stroke={style.zero} strokeDasharray={style.dash} strokeWidth="1" opacity=".8" />
        <path d={path} fill="none" stroke={style.stroke} strokeWidth={style.sw} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={ex} cy={ey} r="9" fill="var(--c-live)" opacity=".22" />
        <circle cx={ex} cy={ey} r="4.5" fill="var(--c-live)" />
        {marks ? spans.map(([a, b], k) => {
          const r = RESULTS[k];
          const cx = r === 'live' ? ex : (X(a) + X(b)) / 2;
          if (r === 'live') return <circle key={k} cx={cx} cy={h - 8} r="3.5" fill="var(--c-live)" />;
          const c = r === 'W' ? 'var(--c-gain)' : r === 'L' ? 'var(--c-loss)' : 'var(--c-text-2)';
          if (d === 'b') {
            return (
              <g key={k}>
                <rect x={cx - 9} y={h - 18} width="18" height="16" rx="3" fill={c} opacity=".18" />
                <text x={cx} y={h - 6} textAnchor="middle" fontSize="11" fontWeight="900" fill={c}>{r}</text>
              </g>
            );
          }
          return <text key={k} x={cx} y={h - 4} textAnchor="middle" fontSize="12" fontWeight="800" fill={c}>{r}</text>;
        }) : null}
      </svg>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // HOME, in season (the calm-Home structure, decided 2026-10-12)
  // ═════════════════════════════════════════════════════════════════════
  const H = K.HOME;
  const L = K.MATCHUP.live;
  function HeroText({ d }) {
    const size = { a: 46, b: 56, c: 44 }[d];
    return (
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="dr-cap">Your team</span>
          <span className="dr-cap dr-num">2nd of 6 · {H.record} · Week {K.LEAGUE.week} of {K.LEAGUE.weeks}</span>
        </div>
        <div className="dr-hero" style={{ fontSize: size, lineHeight: `${size + 2}px` }}>{$(H.value)}</div>
        <div className="dr-call dr-num" style={{ fontWeight: 700 }}>
          <span className="dr-gain">{$s(H.gain)} · {pct(H.gainPct)}</span> <span className="dr-muted" style={{ fontWeight: 500 }}>season gain</span>
          <span className="dr-muted" style={{ fontWeight: 500 }}> · </span>
          <span className="dr-gain">{$s(H.today)}</span> <span className="dr-muted" style={{ fontWeight: 500 }}>today</span>
        </div>
      </div>
    );
  }
  function RangeTabs({ d, on = 'Season', labels = ['1W', '1M', 'Season'] }) {
    if (d === 'c') {
      return <div className="dr-range dr-range--perf">{labels.map((s) => <span key={s} className={s === on ? 'on' : undefined} style={{ paddingInline: 10 }}>{s}</span>)}</div>;
    }
    return (
      <div style={{ display: 'flex', gap: 18, justifyContent: 'flex-end' }}>
        {labels.map((s) => (
          <span key={s} className={d === 'b' ? 'dr-tag' : 'dr-call'} style={{ fontWeight: s === on ? 800 : 600, color: s === on ? 'var(--c-text)' : 'var(--c-text-2)', borderBottom: `${d === 'b' ? 3 : 2}px solid ${s === on ? 'var(--c-accent)' : 'transparent'}`, paddingBottom: 2 }}>{s}</span>
        ))}
      </div>
    );
  }
  /** This week (opens Matchup). Scores 28pt, the Tug, the lead line: the calm-Home card. */
  function ThisWeek({ d }) {
    const y = SD(L.you), o = SD(L.opp);
    const frac = K.tugRatio(y.value, o.value);
    const scores = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <span className="dr-score" style={{ fontSize: 28, lineHeight: '30px', color: d === 'c' ? 'var(--c-gain)' : 'var(--c-text)' }}>{y.primary}</span>
        <span className="dr-score" style={{ fontSize: 28, lineHeight: '30px', textAlign: 'right', color: d === 'b' ? 'var(--d-on-band-2)' : 'var(--c-text)' }}>{o.primary}</span>
      </div>
    );
    const tug = (
      <div style={{ display: 'flex', height: d === 'c' ? 3 : 6, borderRadius: 3, overflow: 'hidden', gap: 2 }} role="img" aria-label="You lead">
        <span style={{ flex: frac, background: d === 'b' ? 'var(--d-on-band)' : 'var(--c-you)' }} />
        <span style={{ flex: 1 - frac, background: d === 'b' ? 'var(--d-band-2)' : 'var(--c-track)' }} />
      </div>
    );
    const top = (onBand) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="dr-tag" style={{ color: onBand ? 'var(--d-on-band)' : 'var(--c-live-text)' }}>This week</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><LiveChip /><Chev /></span>
      </div>
    );
    const names = (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="dr-call">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><Av init="RB" you size={24} />You</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }} className={d === 'b' ? undefined : 'dr-muted'}>vs Gianluigi B.<Av init="GB" size={24} /></span>
      </div>
    );
    const foot = (
      <div style={{ display: 'flex', justifyContent: 'space-between' }} className="dr-cap">
        <span style={{ color: 'var(--c-text)' }}>You lead by <b className="dr-num">{K.formatMoney(Math.abs(L.you.gain - L.opp.gain))}</b></span>
        <span style={{ color: d === 'b' ? 'var(--d-on-band-2)' : undefined }}>Ends Fri 4:00 PM ET</span>
      </div>
    );
    if (d === 'a') {
      return (
        <div className="dr-a-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
          {top()}{names}{scores}{tug}{foot}
        </div>
      );
    }
    if (d === 'b') {
      return (
        <div className="dr-onband" style={{ margin: `0 -${G}px`, padding: `14px ${G}px 14px`, background: 'var(--d-band)', color: 'var(--d-on-band)', display: 'grid', gap: 10 }}>
          {top(true)}{names}{scores}{tug}{foot}
        </div>
      );
    }
    return (
      <div className="dr-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        {top()}{names}{scores}{tug}{foot}
      </div>
    );
  }
  /** Standings excerpt (opens League › Standings). One manager row style (S-10). */
  function StandingsExcerpt({ d }) {
    const rows = K.STANDINGS_BEFORE.slice(0, 3);
    const head = (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: d === 'b' ? '0 2px 6px' : '0 0 4px' }}>
        <span className={d === 'b' ? 'dr-tag' : undefined} style={d === 'b' ? undefined : { fontSize: 17, fontWeight: 800 }}>Standings</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dr-cap">Through Week 5</span><Chev /></span>
      </div>
    );
    const row = (r) => (
      <div key={r.id} style={{
        display: 'grid', gridTemplateColumns: '20px 26px 1fr auto 84px', gap: 10, alignItems: 'center',
        padding: d === 'b' ? '10px 12px' : '9px 10px', borderRadius: d === 'b' ? 3 : 10,
        background: r.you ? 'var(--c-you-tint)' : d === 'b' ? 'var(--c-surface)' : undefined,
        boxShadow: d === 'b' && r.you ? 'inset 3px 0 0 var(--c-you)' : undefined,
      }}>
        <span className="dr-score" style={{ fontSize: d === 'b' ? 20 : 15, color: 'var(--c-text-2)' }}>{r.rank}</span>
        <Av init={r.init} you={r.you} size={24} />
        <span className="dr-call" style={{ fontWeight: r.you ? 800 : 500, fontSize: 15 }}>{r.name}</span>
        <span className="dr-call dr-num dr-muted">{r.w}–{r.l}</span>
        <span className={`dr-call dr-num ${tone(r.pf)}`} style={{ fontWeight: 800, textAlign: 'right' }}>{$s(r.pf)}</span>
      </div>
    );
    if (d === 'b') {
      return <div style={{ display: 'grid', gap: 3 }}>{head}{rows.map(row)}</div>;
    }
    return (
      <div className={d === 'a' ? 'dr-a-card' : 'dr-card'} style={{ padding: '14px 10px 8px', display: 'grid', gap: 2 }}>
        <div style={{ padding: '0 6px' }}>{head}</div>
        {rows.map(row)}
      </div>
    );
  }
  function HomeFrame({ d, t }) {
    return (
      <Phone d={d} t={t} tab="home" label={`Home in season, direction ${d.toUpperCase()}`}>
        <Head />
        <Body>
          <div style={{ display: 'grid', gap: 8 }}>
            <HeroText d={d} />
            <Line d={d} series={H.series} starts={H.weekStarts} marks label={`Season gain: ${$s(H.gain)}. Weeks: W, W, L, W, W, Week 6 live.`} />
            <RangeTabs d={d} />
          </div>
          <ThisWeek d={d} />
          <StandingsExcerpt d={d} />
        </Body>
      </Phone>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // MATCHUP: a scoreboard header, then the mirrored roster. Nothing else
  // (Giorgio, 2026-10-12: "There really shouldn't be any other added elements.").
  // ═════════════════════════════════════════════════════════════════════
  /** Rows by week gain, best first on each side (the plan's default order, a). */
  const byGain = (rows) => [...rows].sort((p, q) => q.weekGain - p.weekGain);
  function pairs(final, order = 'gain') {
    const s = final ? K.MATCHUP.final : K.MATCHUP.live;
    const sort = order === 'gain' ? byGain : order === 'value' ? (r) => [...r].sort((p, q) => q.value - p.value) : (r) => [...r].sort((p, q) => p.pick - q.pick);
    const a = sort(s.you.rows), b = sort(s.opp.rows);
    return a.map((r, i) => [r, b[i]]);
  }

  function Scoreboard({ d, final, kind }) {
    const s = kind === 'tier' ? tierMatch(final) : final ? K.MATCHUP.final : K.MATCHUP.live;
    const opp = kind === 'tier' ? { name: 'Paolo M.', init: 'PM' } : { name: 'Gianluigi B.', init: 'GB' };
    const y = SD(s.you), o = SD(s.opp);
    const youLead = s.you.gain >= s.opp.gain;
    const line = (
      <span className="dr-call" style={{ textAlign: 'center' }}>
        Roberto B. {final ? 'won by' : 'leads by'} <b className="dr-num">{K.formatMoney(Math.abs(s.you.gain - s.opp.gain))}</b>
      </span>
    );
    const side = (who, mirror) => {
      const you = who === 'you';
      const lead = you === youLead;
      const sc = you ? y : o;
      const scoreColor = d === 'b' ? (lead ? 'var(--d-on-band)' : 'var(--d-on-band-2)') : d === 'c' ? (lead ? 'var(--c-gain)' : 'var(--c-text)') : 'var(--c-text)';
      return (
        <div style={{
          display: 'grid', gap: 8, justifyItems: mirror ? 'end' : 'start', padding: d === 'a' ? '16px 14px' : '6px 0',
          background: d === 'a' && lead ? 'var(--d-lead-wash)' : undefined,
          borderRadius: d === 'a' ? (mirror ? '0 14px 14px 0' : '14px 0 0 14px') : undefined,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: mirror ? 'row-reverse' : 'row' }}>
            <Av init={you ? 'RB' : opp.init} you={you} size={d === 'b' ? 40 : 44} />
            <span className="dr-call" style={{ fontWeight: you ? 800 : 600, fontSize: 15, color: d === 'b' ? 'var(--d-on-band)' : undefined }}>{you ? 'Roberto B.' : opp.name}</span>
          </span>
          <span className="dr-score" style={{ fontSize: d === 'b' ? 52 : d === 'c' ? 34 : 32, lineHeight: d === 'b' ? '48px' : '36px', color: scoreColor }}>{sc.primary}</span>
        </div>
      );
    };
    if (d === 'a') {
      return (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="dr-a-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>{side('you')}{side('opp', true)}</div>
          {line}
        </div>
      );
    }
    if (d === 'b') {
      return (
        <div className="dr-onband" style={{ margin: `0 -${G}px`, color: 'var(--d-on-band)' }}>
          <div style={{ background: 'var(--d-band)', padding: `14px ${G}px 12px`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{side('you')}{side('opp', true)}</div>
          <div style={{ background: 'var(--d-band-2)', padding: '8px 0', display: 'grid', color: 'var(--d-on-band)' }}>{line}</div>
        </div>
      );
    }
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>{side('you')}{side('opp', true)}</div>
        <span className="dr-muted" style={{ display: 'grid' }}>{line}</span>
      </div>
    );
  }

  /** One side of a roster row. `mid` = what the centre column carries ('none' | 'cat' | 'num'). */
  function Half({ d, r, mirror, final, lit }) {
    const pctWeek = ((r.price - r.mon) / r.mon) * 100;
    const name = (
      <span style={{ display: 'grid', gap: 1, justifyItems: mirror ? 'end' : 'start', minWidth: 0 }}>
        <span className="dr-t" style={{ fontSize: 16 }}>{r.t}</span>
        <span className="dr-cap" style={{ whiteSpace: 'nowrap' }}>{r.co}</span>
      </span>
    );
    const num = (
      <span style={{ display: 'grid', gap: 1, justifyItems: mirror ? 'start' : 'end' }}>
        <span className={`dr-score ${tone(r.weekGain)}`} style={{ fontSize: d === 'b' ? 22 : 17, lineHeight: '22px' }}>{$s(r.weekGain)}</span>
        <span className={`dr-cap dr-num ${tone(pctWeek)}`} style={{ fontWeight: 700 }}>{pct(pctWeek)}</span>
      </span>
    );
    const spark = d === 'c' ? <Spark pts={weekPts(r, final)} color={toneVar(r.weekGain)} w={34} h={16} /> : null;
    const parts = mirror ? [num, spark, name] : [name, spark, num];
    const base = { display: 'grid', alignItems: 'center', gap: 8, gridTemplateColumns: mirror ? (spark ? 'auto auto 1fr' : 'auto 1fr') : (spark ? '1fr auto auto' : '1fr auto') };
    if (d === 'a') {
      return (
        <div style={{
          ...base, padding: '12px 12px', minHeight: 64,
          marginLeft: mirror ? 0 : -G, paddingLeft: mirror ? 12 : G, marginRight: mirror ? -G : 0, paddingRight: mirror ? G : 12,
          background: lit ? 'var(--d-lit)' : undefined, borderRadius: mirror ? '12px 0 0 12px' : '0 12px 12px 0',
        }}>{parts}</div>
      );
    }
    if (d === 'b') {
      return (
        <div style={{
          ...base, padding: '11px 12px', minHeight: 62, background: 'var(--c-surface)', borderRadius: 2,
          boxShadow: `inset ${mirror ? -3 : 3}px 0 0 ${toneVar(r.weekGain)}`,
        }}>{parts}</div>
      );
    }
    return <div style={{ ...base, padding: '10px 0', minHeight: 56 }}>{parts}</div>;
  }
  function Mid({ d, mid, r, i }) {
    if (mid === 'none') return <span />;
    if (mid === 'num') return <span className="dr-cap dr-num" style={{ display: 'grid', placeItems: 'center', alignSelf: 'stretch', background: d === 'b' ? 'var(--d-gutter)' : 'var(--c-inset)', borderRadius: 6, minWidth: 26 }}>{i + 1}</span>;
    const s = SECTOR[r.t];
    return <span className="dr-pillcat" style={{ alignSelf: 'center', background: `var(--d-tile-${s})` }}>{SECTOR_LABEL[s]}</span>;
  }
  /** The group header in a category league: the category is the position label, centred
   * across the mirror (both managers share the slot, so the two columns pair group by group). */
  function GroupHead({ d, g }) {
    const label = slotLabel(g);
    if (d === 'a') {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px' }}>
          <span className="dr-tag" style={{ padding: '5px 12px', borderRadius: 999, background: 'var(--c-inset)', color: 'var(--c-text)', boxShadow: 'inset 0 0 0 1px var(--d-rim)' }}>{label}</span>
        </div>
      );
    }
    if (d === 'b') {
      return <div className="dr-tag" style={{ textAlign: 'center', padding: '7px 0', background: 'var(--c-inset)', color: 'var(--c-text)', borderRadius: 2 }}>{label}</div>;
    }
    return <div className="dr-tag dr-muted" style={{ textAlign: 'center', padding: '14px 0 2px' }}>{label}</div>;
  }
  function groupedPairs(final, kind) {
    const s = kind === 'tier' ? tierMatch(final) : final ? K.MATCHUP.final : K.MATCHUP.live;
    const slots = kind === 'tier' ? TIER_SLOTS : CAT_SLOTS;
    const pick = (rows, ts) => byGain(rows.filter((r) => ts.includes(r.t)));
    return slots.map((g) => {
      const a = pick(s.you.rows, g.you), b = pick(s.opp.rows, g.opp);
      return { g, pairs: a.map((r, i) => [r, b[i]]) };
    });
  }
  function Roster({ d, final, order = 'gain', mid = 'none', limit, groups }) {
    const ps = pairs(final, order).slice(0, limit || 6);
    const midCol = mid === 'none' ? (d === 'b' ? '4px' : '10px') : 'auto';
    const line = ([a, b], i) => (
      <div key={a.t} style={{ display: 'grid', gridTemplateColumns: `minmax(0,1fr) ${midCol} minmax(0,1fr)`, gap: d === 'b' && mid === 'none' ? 0 : 6, alignItems: 'stretch' }}>
        <Half d={d} r={a} final={final} lit={a.weekGain > b.weekGain} />
        <Mid d={d} mid={mid} r={a} i={i} />
        <Half d={d} r={b} final={final} mirror lit={b.weekGain > a.weekGain} />
      </div>
    );
    return (
      <div style={{ display: 'grid', gap: d === 'b' ? 4 : d === 'a' ? 6 : 4, background: d === 'b' ? 'var(--d-gutter)' : undefined, margin: d === 'b' ? `0 -${G}px` : 0, padding: d === 'b' ? '4px 4px' : 0 }}>
        {d === 'b' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', padding: '6px 8px 2px' }} className="dr-tag">
            <span style={{ color: 'var(--c-you-text)' }}>Roberto B.</span><span className="dr-muted">Week 6</span><span style={{ textAlign: 'right' }} className="dr-muted">{groups === 'tier' ? 'Paolo M.' : 'Gianluigi B.'}</span>
          </div>
        ) : null}
        {groups
          ? groupedPairs(final, groups).map(({ g, pairs: gp }) => [<GroupHead key={g.name} d={d} g={g} />, ...gp.map(line)])
          : ps.map(line)}
      </div>
    );
  }
  function MatchupFrame({ d, t, final, groups, overlay }) {
    return (
      <Phone d={d} t={t} overlay={overlay} tab="matchup" full={groups} label={`Matchup ${final ? 'final' : 'live'}${groups ? `, ${groups} league` : ''}, direction ${d.toUpperCase()}`}>
        <Head chip={final ? <FinalChip /> : <LiveChip />} league={groups === 'tier' ? 'Tier Cup' : undefined} />
        <Body gap={d === 'b' ? 0 : 18}>
          <div className="dr-seg" style={{ marginBottom: d === 'b' ? 14 : 0 }}><span className="on">My matchup</span><span>All matchups</span></div>
          <Scoreboard d={d} final={final} kind={groups} />
          <Roster d={d} final={final} groups={groups} />
        </Body>
      </Phone>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // DRAFT ROOM, on the clock (round 2, pick 11, 0:42)
  // ═════════════════════════════════════════════════════════════════════
  const D = K.DRAFT_MOMENT;
  const SEATS = [...K.PLAYERS].sort((p, q) => p.seat - q.seat);
  function ClockCard({ d }) {
    const mmss = `0:${String(D.secondsLeft).padStart(2, '0')}`;
    const frac = D.secondsLeft / D.secondsTotal;
    const ring = (
      <svg width="74" height="74" viewBox="0 0 74 74" aria-hidden="true" style={{ flex: 'none' }}>
        <circle cx="37" cy="37" r="31" fill="none" stroke="var(--c-track)" strokeWidth="6" />
        <circle cx="37" cy="37" r="31" fill="none" stroke="var(--c-live)" strokeWidth="6" strokeLinecap="round" strokeDasharray={2 * Math.PI * 31} strokeDashoffset={2 * Math.PI * 31 * (1 - frac)} transform="rotate(-90 37 37)" />
        <text x="37" y="44" textAnchor="middle" fontSize="20" fontWeight="900" fill="var(--c-text)" style={{ fontVariantNumeric: 'tabular-nums' }}>{mmss}</text>
      </svg>
    );
    const text = (
      <div style={{ display: 'grid', gap: 3 }}>
        <span style={{ fontSize: 26, lineHeight: '28px', fontWeight: 900, fontStretch: d === 'b' ? '75%' : '100%', color: 'var(--c-live-text)' }}>You're on the clock</span>
        <span className="dr-call" style={{ fontWeight: 700 }}>Round 2 of {K.LEAGUE.slots} · Pick 11</span>
        <span className="dr-cap">Then Paolo M. picks twice (12, 13)</span>
      </div>
    );
    const box = {
      a: { background: 'var(--c-accent-tint)', boxShadow: 'inset 0 0 0 2px var(--c-live)', borderRadius: 16 },
      b: { background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 2px var(--c-live)', borderRadius: 3 },
      c: { background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 1.5px var(--c-live)', borderRadius: 16 },
    }[d];
    return <div style={{ ...box, padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>{ring}{text}</div>;
  }
  function Board({ d }) {
    const amended = useContext(Amended);
    const label = (n, s, muted, dot) => (
      <span className={muted ? 'dr-num dr-muted' : 'dr-num'} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span>{n}</span>
        <span style={dot ? { color: `var(--d-tile-${s})` } : undefined}>{SECTOR_LABEL[s]}</span>
      </span>
    );
    const cell = (n) => {
      const p = K.DRAFT_PICKS[n - 1];
      const t = p.t;
      const s = t ? SECTOR[t] : null;
      const onClock = n === D.pick;
      const base = { height: 44, borderRadius: d === 'b' ? 2 : d === 'a' ? 5 : 8, padding: '4px 6px', display: 'grid', alignContent: 'space-between', position: 'relative' };
      if (onClock) {
        return (
          <div key={n} className={d === 'a' ? 'dr-clockcell' : d === 'b' ? 'dr-onband' : undefined} style={{ ...base, background: d === 'a' ? 'var(--d-clock-cell)' : d === 'b' ? 'var(--d-band)' : 'var(--c-bg)', boxShadow: 'inset 0 0 0 2px var(--c-live)' }}>
            <span className="dr-num" style={{ fontSize: 11, fontWeight: 800, color: 'var(--c-live-text)' }}>{n}</span>
            <span className="dr-num" style={{ fontSize: 13, fontWeight: 900, color: 'var(--c-text)' }}>0:{String(D.secondsLeft).padStart(2, '0')}</span>
          </div>
        );
      }
      if (!t) return <div key={n} style={{ ...base, background: d === 'c' ? 'transparent' : 'var(--c-sunken)', boxShadow: d === 'c' ? 'inset 0 0 0 1px var(--c-line)' : undefined }}><span className="dr-num dr-muted" style={{ fontSize: 11, fontWeight: 700 }}>{n}</span></div>;
      if (d === 'a' && amended) return <div key={n} style={{ ...base, background: 'var(--c-surface)', boxShadow: `inset 0 -3px 0 var(--d-tile-${s})`, color: 'var(--c-text)' }}>{label(n, s, true)}<span style={{ fontSize: 13, fontWeight: 900 }}>{t}</span></div>;
      if (d === 'a') return <div key={n} style={{ ...base, background: `var(--d-tile-${s})`, color: 'var(--d-on-tile)' }}>{label(n, s)}<span style={{ fontSize: 13, fontWeight: 900 }}>{t}</span></div>;
      if (d === 'b') return <div key={n} style={{ ...base, background: 'var(--c-surface)', boxShadow: `inset 0 -3px 0 var(--d-tile-${s})` }}>{label(n, s, true)}<span style={{ fontSize: 14, fontWeight: 900, fontStretch: '75%' }}>{t}</span></div>;
      return <div key={n} style={{ ...base, background: 'var(--c-surface)' }}>{label(n, s, true, true)}<span style={{ fontSize: 13, fontWeight: 800 }}>{t}</span></div>;
    };
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, paddingBottom: 2 }}>
          {SEATS.map((p) => (
            <span key={p.id} style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
              <Av init={p.init} you={p.you} size={26} />
              <span className="dr-cap" style={{ fontSize: 11, fontWeight: p.you ? 800 : 500, color: p.you ? 'var(--c-text)' : undefined }}>{p.name.split(' ')[0]}</span>
            </span>
          ))}
        </div>
        {[1, 2, 3].map((round) => (
          <div key={round} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
            {SEATS.map((p) => cell(K.picksForSeat(p.seat, 6, 3)[round - 1]))}
          </div>
        ))}
      </div>
    );
  }
  function DraftFrame({ d, t }) {
    return (
      <Phone d={d} t={t} tab="league" label={`Draft room on the clock, direction ${d.toUpperCase()}`}>
        <Head chip={<span className="dr-chip"><span className="dr-dot" />Drafting</span>} />
        <Body gap={16}>
          <ClockCard d={d} />
          <Board d={d} />
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', borderRadius: d === 'b' ? 3 : 12, background: 'var(--c-surface)' }}>
              <span className="dr-muted" style={{ display: 'flex' }}><Icon d={ICON.search} size={18} /></span><span className="dr-call" style={{ fontSize: 15 }}>{K.DRAFT_SEARCH.query}</span>
            </div>
            {K.DRAFT_SEARCH.results.slice(0, 3).map((r, i) => (
              <div key={r.t} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '8px 2px' }}>
                <span><span className="dr-t" style={{ fontSize: 15 }}>{r.t}</span> <span className="dr-cap">{r.co}{r.tag ? ` · ${r.tag}` : ''}</span></span>
                <span className="dr-call dr-num dr-muted">{$(r.price)}</span>
                {i === 0 ? <span className="dr-btn dr-btn--sm">Draft</span> : <span className="dr-muted" style={{ display: 'inline-flex', width: 44, justifyContent: 'center' }} aria-label="Queue"><Icon d={ICON.plus} size={20} /></span>}
              </div>
            ))}
          </div>
        </Body>
      </Phone>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // LEAGUE › STANDINGS, in full (after Week 6's Friday close)
  // ═════════════════════════════════════════════════════════════════════
  function Move({ n }) {
    if (!n) return <span className="dr-muted" style={{ width: 22, textAlign: 'center' }} aria-label="no change">–</span>;
    const up = n > 0;
    return (
      <span className={up ? 'dr-gain' : 'dr-loss'} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 800, width: 22 }} aria-label={`${up ? 'up' : 'down'} ${Math.abs(n)}`}>
        <Icon d={up ? ICON.up : ICON.chevron} size={12} width={3} />{Math.abs(n)}
      </span>
    );
  }
  function StandingsFrame({ d, t }) {
    const rows = K.STANDINGS_FINAL;
    const cols = '22px 22px 32px minmax(0,1fr) 34px 86px';
    const row = (r) => {
      const style = {
        a: { padding: '12px 10px', borderRadius: 12, background: r.you ? 'var(--c-you-tint)' : 'var(--c-surface)', boxShadow: r.you ? 'inset 0 0 0 1.5px var(--c-you)' : undefined },
        b: { padding: '12px 10px', borderRadius: 2, background: r.you ? 'var(--c-you-tint)' : 'var(--c-surface)', boxShadow: r.you ? 'inset 3px 0 0 var(--c-you)' : undefined },
        c: { padding: '14px 10px', borderRadius: 12, background: r.you ? 'var(--c-you-tint)' : undefined },
      }[d];
      return (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', ...style }}>
          <span className="dr-score" style={{ fontSize: d === 'b' ? 24 : 18, color: r.rank === 1 ? 'var(--c-text)' : 'var(--c-text-2)' }}>{r.rank}</span>
          <Move n={r.delta} />
          <Av init={r.init} you={r.you} size={32} />
          <span style={{ fontSize: 15, fontWeight: r.you ? 800 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
          <span className="dr-call dr-num dr-muted" style={{ textAlign: 'right' }}>{r.w}–{r.l}</span>
          <span className={`dr-num ${tone(r.pf)}`} style={{ fontSize: 15, fontWeight: 800, textAlign: 'right' }}>{$s(r.pf)}</span>
        </div>
      );
    };
    return (
      <Phone d={d} t={t} tab="league" label={`League standings, direction ${d.toUpperCase()}`}>
        <Head />
        <Body gap={14}>
          <div className="dr-seg"><span className="on">Standings</span><span>Schedule</span><span>Playoffs</span><span>History</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '0 10px', alignItems: 'end' }} className="dr-tag">
            <span className="dr-muted">#</span><span /><span /><span className="dr-cap" style={{ textTransform: 'none', letterSpacing: 0, fontStretch: '100%', fontWeight: 500 }}>Through Week 6</span><span className="dr-muted" style={{ textAlign: 'right', fontStretch: '100%', whiteSpace: 'nowrap' }}>W–L</span><span className="dr-muted" style={{ textAlign: 'right', fontStretch: '100%', whiteSpace: 'nowrap' }}>Season gain</span>
          </div>
          <div style={{ display: 'grid', gap: d === 'b' ? 3 : d === 'a' ? 6 : 2, background: d === 'b' ? 'var(--d-gutter)' : undefined, margin: d === 'b' ? `0 -${G}px` : 0, padding: d === 'b' ? '3px' : 0 }}>
            {rows.map(row)}
          </div>
        </Body>
      </Phone>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // PORTFOLIO hero (the money surface)
  // ═════════════════════════════════════════════════════════════════════
  const P = K.PORTFOLIO_LIVE;
  function PortfolioFrame({ d, t, overlay }) {
    const size = { a: 44, b: 48, c: 44 }[d];
    const weight = d === 'b' ? 900 : 500;
    const series = H.series.map((g) => K.LEAGUE.slots * K.LEAGUE.notionalPerSlot + g);
    const amended = useContext(Amended);
    const holding = (t) => {
      const r = P.rows.find((x) => x.t === t);
      const s = SECTOR[t];
      return (
        <div key={t} style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) auto auto', gap: 12, alignItems: 'center', padding: d === 'b' ? '12px 12px' : '12px 0', background: d === 'b' ? 'var(--c-surface)' : undefined, borderRadius: d === 'b' ? 2 : 0 }}>
          <span className="dr-av" style={{ width: 40, height: 40, fontSize: 11, borderRadius: d === 'b' ? 4 : 20 }}>{t}</span>
          <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dr-t" style={{ fontSize: 16 }}>{t}</span><span className="dr-pillcat" style={{ background: `var(--d-tile-${s})`, height: 18, fontSize: 11 }}>{SECTOR_LABEL[s]}</span></span>
            <span className="dr-cap dr-num">{r.co} · {r.qty.toFixed(2)} sh</span>
          </span>
          {d === 'a' && amended ? <span /> : <Spark pts={[r.mon, r.prev, r.thu]} color={toneVar(r.thu - r.mon)} w={52} h={22} />}
          <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
            <b className="dr-num" style={{ fontSize: 15 }}>{$(r.value)}</b>
            <span className={`dr-cap dr-num ${tone(r.todayPct)}`} style={{ fontWeight: 700 }}>{pct(r.todayPct)}</span>
          </span>
        </div>
      );
    };
    return (
      <Phone d={d} t={t} overlay={overlay} tab="portfolio" money label={`Portfolio, direction ${d.toUpperCase()}`}>
        <Head chip={<LiveChip />} />
        <Body gap={20}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <span className="dr-cap">Portfolio value</span>
              <span className="dr-num" style={{ fontSize: size, lineHeight: `${size + 2}px`, fontWeight: weight, fontStretch: d === 'b' ? '62%' : '100%', letterSpacing: '-0.015em' }}>{$(P.value)}</span>
              <span className="dr-call dr-num" style={{ fontWeight: 700 }}><span className="dr-gain">{$s(P.gain)} · {pct(P.gainPct)}</span> <span className="dr-muted" style={{ fontWeight: 500 }}>since the draft</span></span>
              <span className="dr-call dr-num" style={{ fontWeight: 700 }}><span className="dr-gain">{$s(P.today)} · {pct(P.todayPct)}</span> <span className="dr-muted" style={{ fontWeight: 500 }}>today</span></span>
            </div>
            <Line d={d} series={series} base={series[0]} h={150} label={`Portfolio value since the draft: ${$(P.value)}`} />
            {d === 'c' ? <RangeTabs d="c" /> : <div className="dr-range" style={{ justifyContent: 'flex-start', gap: 6 }}>{['1W', '1M', 'Season'].map((s) => <span key={s} className={s === 'Season' ? 'on' : undefined} style={{ paddingInline: 12 }}>{s}</span>)}</div>}
          </div>
          <div style={{ display: 'grid', gap: d === 'b' ? 3 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 800 }}>Holdings</span><span className="dr-cap">Value · today</span>
            </div>
            {holding('NVDA')}
            {holding('AAPL')}
          </div>
        </Body>
      </Phone>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // THE BOARD SECTION
  // ═════════════════════════════════════════════════════════════════════
  const NEW = () => <span className="dr-new">NEW</span>;
  const SW = ({ v, label }) => <span className="dr-sw"><i style={{ background: `var(${v})` }} />{label}</span>;
  const DIRS = [
    {
      crit: 'P5 H4 E4 S5 Earned 4 V4', audit: '0 critical · 0 major · 2 minor (the lit column when one side sweeps; the DRAFT pill\'s 44pt hit area is a build item)',
      light: "it reads like Sleeper's own light mode. The navy becomes the ink and the dark on-the-clock cell; the cyan darkens to a deep teal so it can carry white text (a bright cyan has no edge on white). The lit halves, the colour tiles and the heavy type carry it. What it loses: the night-time glow of the cyan on navy. It changes the most between the two modes, but it is still clearly a fantasy app in both.",
      id: 'a', name: 'A · Game Night', primary: 'Sleeper (S1 matchup, S2 draft)',
      line: 'Flat deep navy in three lightness steps of one hue: the page, a lighter card with a rim, a lighter sheet. Cyan means live, your turn and selected; mint and pink mean up and down; the blue ring and tint mean you. Game numbers are heavy at normal width. Rows divide by space and by a lit slab that runs off the screen edge, never by lines. Money screens drop to near-black with the line in the day\'s colour.',
      sw: [['--c-bg', 'page'], ['--c-surface', 'card'], ['--d-rim', 'rim'], ['--d-lit', 'lit half'], ['--c-accent', 'cyan'], ['--c-gain', 'up'], ['--c-loss', 'down'], ['--c-you', 'you'], ['--d-money-bg', 'money page']],
      motion: [
        ['Hero number', 'rolls its changed digits on a live update (§4 Roll), never on first paint.'],
        ['Chart', 'draws left to right once, then the end dot breathes while the market is open.'],
        ['Your turn', 'the clock card flashes cyan twice (the approved flash, recoloured), then rests with a cyan ring that runs down with the clock.'],
      ],
    },
    {
      crit: 'P4 H3 E4 S4 Earned 3 V4', audit: '0 critical · 1 major (the league band covers 12–17% of Home and Matchup, and competes with the hero) · 1 minor',
      light: "the violet band and its white type are the same in both modes (a frame, not a surface: Yahoo's purple on white is the same idea), and the panels turn white on a pale grey gutter. B looks most like itself in Light; the band is still loud (12–17% of the frame).",
      id: 'b', name: 'B · Broadcast', primary: 'ESPN (S3 matchup)',
      line: 'Charcoal surfaces with ONE league colour as the frame: the scoreboard is a full-width band, like a broadcast score bug. Every stock is its own panel with a gutter between, and its state bar on the outer edge (green up, red down). Numerals are condensed and the largest thing on every game screen. Labels are small capitals. The band colour here is a sample violet: no league colour exists in the product yet.',
      sw: [['--c-bg', 'page'], ['--c-surface', 'panel'], ['--d-gutter', 'gutter'], ['--d-band', 'league band'], ['--d-band-2', 'band, lower'], ['--c-live', 'live'], ['--c-gain', 'up'], ['--c-loss', 'down'], ['--c-you', 'you']],
      motion: [
        ['Hero number', 'condensed digits slot-roll on change (the scoreboard\'s lively spring, §4).'],
        ['Chart', 'the filled area rises from the zero line once; the W/L boxes stamp in left to right.'],
        ['Your turn', 'the clock card\'s edge bar and the board\'s on-the-clock cell flash gold twice (the approved flash), then rest.'],
      ],
    },
    {
      crit: 'P4 H5 E4 S3 Earned 5 V4', audit: '0 critical · 0 major · 2 minor (the selected pill changes colour on a down day; the DRAFT pill\'s hit area)',
      light: "Robinhood's own light mode: near-white, one green. The neon can't hold text on white, so it darkens to a plain green, and with no surfaces to speak of, C in Light is the plainest of the three.",
      id: 'c', name: 'C · Terminal', primary: 'Robinhood (S4 portfolio hero)',
      line: 'Near-black and one neon that is the day\'s colour: green on an up day (shown), orange-red on a down day, used for the line, the selected pill and the leading score. Groups separate by space alone. Money numbers are regular weight; game scores are bold but not condensed. Sleeper\'s energy lives only in the type scale and the avatars. Stock rows carry sparklines.',
      sw: [['--c-bg', 'page'], ['--c-surface', 'card'], ['--c-accent', 'neon (up day)'], ['--c-loss', 'down'], ['--c-you', 'you'], ['--c-text-2', 'secondary']],
      motion: [
        ['Hero number', 'no roll; it crossfades to the new value in 150 ms, the way Robinhood\'s number ticks.'],
        ['Chart', 'the line is there on arrival; scrubbing it moves the number (the Robinhood interaction).'],
        ['Your turn', 'the clock card\'s neon outline flashes twice, then the ring runs down.'],
      ],
    },
  ];
  const REFS_FOR = {
    a: { home: ['s1', 'The navy card with a rim; the lit half.'], match: ['s1', 'Avatars at the edges, the mirrored roster, the lit slab off the edge.'], draft: ['s2', 'Colour tiles with dark text; the dark on-the-clock cell.'], stand: ['s1', 'Rows divided by space and surface, never lines.'], money: ['s4', 'The number, then its line, edge to edge.'] },
    b: { home: ['s3', 'The scoreboard as the loudest thing on the screen.'], match: ['s3', 'Panels with a gutter; state on the outer edge; numbers facing each other.'], draft: ['s2', 'Tiles, here as panels with a sector bar.'], stand: ['s3', 'Dense panels, small-capital labels, strong numerals.'], money: ['s5', 'The key figures and right-aligned tabular numbers.'] },
    c: { home: ['s4', 'Black, one neon, the number and its line.'], match: ['s1', 'The arrangement only: avatars at the edges, the mirrored roster.'], draft: ['s2', 'The board, reduced to type and a sector dot.'], stand: ['s4', 'Space alone does the dividing.'], money: ['s4', 'Regular-weight number, neon line, filled range pill.'] },
  };

  function Direction({ dir }) {
    const r = REFS_FOR[dir.id];
    return (
      <>
        <div className="dr-dirhead" id={`dir-${dir.id}`}>
          <h3>{dir.name} <span className="dr-muted" style={{ fontSize: 15, fontWeight: 600, fontStretch: '100%' }}>· primary reference: {dir.primary}</span></h3>
          <p>{dir.line}</p>
        </div>
        {['dark', 'light'].map((t) => (
          <div key={t} className={`dir-${dir.id}${t === 'light' ? ` dir-${dir.id}-light` : ''} dr-swatches`} style={{ background: 'var(--c-bg)', padding: 10, borderRadius: 12, marginBottom: 6 }}>
            <span className="dr-sw" style={{ fontWeight: 800, color: 'var(--c-text)', minWidth: 44 }}>{t === 'dark' ? 'Dark' : 'Light'}</span>
            {dir.sw.map(([v, l]) => <SW key={v} v={v} label={<span style={{ color: 'var(--c-text-2)' }}>{l}</span>} />)}
          </div>
        ))}
        <p className="dr-crit" style={{ fontSize: 15, color: 'var(--c-text)' }}><b>In Light:</b> {dir.light}</p>
        <ul className="dr-motion">{dir.motion.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul>
        <p className="dr-crit"><b>Self-critique</b> (1–5, revise under 3): {dir.crit}. <b>hallmark audit</b>, after fixes: {dir.audit}. Punch list: reviews/hallmark-audit-w1.md.</p>
        <div className="dr-pairs">
          <Pair refId={r.home[0]} trait={r.home[1]} lightRef="y4" lightTrait="Off-white page, white cards, one vivid accent." caption={`${dir.id.toUpperCase()} · Home, in season`} note="The calm-Home structure as decided: the hero, its chart with the W/L marks, This week, Standings. Same copy, same numbers." frame={(t) => <HomeFrame d={dir.id} t={t} />} />
          <Pair refId={r.match[0]} trait={r.match[1]} lightRef="y4" lightTrait="Team-coloured cards on white; the feed reads in daylight." caption={`${dir.id.toUpperCase()} · Matchup, live`} note="The scoreboard (names, the two totals, who leads), then your stocks against theirs, row by row, best week first on each side. Nothing else." frame={(t) => <MatchupFrame d={dir.id} t={t} />} />
          <Pair refId={r.match[0]} trait={r.match[1]} lightRef="v110" lightTrait="1.1.0, Light: the leader's half lit, the rows mirrored." caption={`${dir.id.toUpperCase()} · Matchup, final`} note={'Friday close: "Final", "Roberto B. won by …", the same rows at the close.'} frame={(t) => <MatchupFrame d={dir.id} t={t} final />} />
          <Pair refId={r.draft[0]} trait={r.draft[1]} lightRef="y1" lightTrait="Your turn as a filled pill with white ink, on white." caption={`${dir.id.toUpperCase()} · Draft room, on the clock`} note="Round 2, pick 11, 0:42. Tile colour = sector (sample)." frame={(t) => <DraftFrame d={dir.id} t={t} />} />
          <Pair refId={r.stand[0]} trait={r.stand[1]} lightRef="s5" lightTrait="White cards, right-aligned tabular numbers." caption={`${dir.id.toUpperCase()} · League › Standings, in full`} note="After Week 6's Friday close: the movement, the avatars, your row. No grid lines." frame={(t) => <StandingsFrame d={dir.id} t={t} />} />
          <Pair refId={r.money[0]} trait={r.money[1]} lightRef="s5" lightTrait="The number on a brand bar; gains in green; key figures." caption={`${dir.id.toUpperCase()} · Portfolio`} note={<>The number, its line, the range, two holdings with sparklines and a sector pill. The chart and the range pills are new on Portfolio<NEW />.</>} frame={(t) => <PortfolioFrame d={dir.id} t={t} />} />
        </div>
      </>
    );
  }

  /** A compact roster for the "Your call" strips (direction A's skin). */
  function MiniRoster({ order = 'gain', mid = 'none', label, t = 'dark' }) {
    return (
      <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`} style={{ background: 'var(--c-bg)', borderRadius: 20, padding: '14px 20px', overflow: 'hidden', color: 'var(--c-text)' }} role="img" aria-label={label}>
        <Roster d="a" order={order} mid={mid} limit={4} />
      </div>
    );
  }


  // ═════════════════════════════════════════════════════════════════════
  // THE PLAYER CARD (Giorgio, 2026-10-12): tapping ANY stock, yours or theirs, on Portfolio
  // or Matchup, opens it, on the ESPN player-card model.
  // ═════════════════════════════════════════════════════════════════════
  // SAMPLE (captioned on the board): each stock's Friday closes for weeks 1–5 and a midday +
  // close for Mon–Wed of this week. data.js has the draft price, Monday's open, Wednesday's
  // close and Thursday's price; those are real. Sample calendar: drafted Tue Sep 29, weekly
  // Friday closes Oct 2 … Oct 30, this week Mon Nov 2 → now (Thu Nov 5, 1:37 PM ET).
  const SEASON_CLOSES = { NVDA: [292.4, 296.8, 288.9, 295.6, 299.1], NKE: [81.9, 80.4, 78.8, 79.9, 79.3] };
  const WEEK_MID = { NVDA: { mon: [302.6, 303.9], tue: [299.8, 301.4], wed: 304.1, thu: 312.5 }, NKE: { mon: [80.3, 80.1], tue: [79.2, 78.9], wed: 79.4, thu: 80.6 } };
  /** A price line over a labelled X axis (§9C): `span` is the axis length in trading days, so a
   * week can run Mon→Fri while the line stops at now; `axis` = [{ d, text, align }]. */
  function CardLine({ pts, days, span, base, h = 128, axis = [], label }) {
    const w = 402, padT = 10, padB = 26;
    const min = Math.min(base, ...pts), max = Math.max(base, ...pts);
    const X = (d) => 14 + (d / span) * (w - 28); // inside the sheet, so the end dot never clips
    const Y = (v) => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${X(days[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const last = pts.length - 1;
    const c = pts[last] >= base ? 'var(--c-gain)' : 'var(--c-loss)';
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} style={{ display: 'block', marginInline: -G, overflow: 'visible' }}>
        <line x1="0" x2={w} y1={Y(base)} y2={Y(base)} stroke="var(--c-border-strong)" strokeDasharray="3 5" opacity=".8" />
        <path d={path} fill="none" stroke={c} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(days[last])} cy={Y(pts[last])} r="9" fill="var(--c-live)" opacity=".22" />
        <circle cx={X(days[last])} cy={Y(pts[last])} r="4.5" fill="var(--c-live)" />
        {axis.map((a) => (
          <text key={a.text} x={a.align === 'start' ? G : a.align === 'end' ? w - G : X(a.d)} y={h - 6} textAnchor={a.align === 'start' ? 'start' : a.align === 'end' ? 'end' : 'middle'} fontSize="12" fontWeight="500" fill="var(--c-text-2)" style={{ fontVariantNumeric: 'tabular-nums' }}>{a.text}</text>
        ))}
      </svg>
    );
  }
  const WEEK_AXIS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((t, i) => ({ d: i + 0.5, text: t }));
  const SEASON_AXIS = [{ d: 0, text: 'Sep 29', align: 'start' }, { d: 8, text: 'Oct 9' }, { d: 18, text: 'Oct 23' }, { d: 26.63, text: 'Nov 5', align: 'end' }];
  function PlayerCard({ who }) {
    const you = who === 'you';
    const t = you ? 'NVDA' : 'NKE';
    const r = (you ? K.MATCHUP.live.you.rows : K.MATCHUP.live.opp.rows).find((x) => x.t === t);
    const m = WEEK_MID[t];
    const weekPct = ((r.thu - r.mon) / r.mon) * 100;
    const season = [r.draft, ...SEASON_CLOSES[t], r.mon, r.prev, r.thu];
    const seasonDays = [0, 3, 8, 13, 18, 23, 23.02, 26, 26.63];
    const week = [r.mon, m.mon[0], m.mon[1], m.tue[0], m.tue[1], m.wed, r.prev, m.thu, r.thu];
    const weekDays = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.63];
    const fig = (lbl, v, sub, cls) => (
      <span>
        <span className="dr-tag dr-muted" style={{ fontStretch: '100%', letterSpacing: '.04em' }}>{lbl}</span>
        <b className={`dr-num ${cls || ''}`} style={{ fontSize: 18, lineHeight: '24px', fontWeight: 800 }}>{v}</b>
        <span className={`dr-cap dr-num ${sub[1] || ''}`} style={{ fontWeight: 700 }}>{sub[0]}</span>
      </span>
    );
    return (
      <>
        <div className="dr-scrim" />
        <div className="dr-sheet" role="dialog" aria-label={`${t}, player card`}>
          <span className="dr-grab" />
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 44px', gap: 12, alignItems: 'center' }}>
            <span className="dr-av" style={{ width: 52, height: 52, fontSize: 13, background: 'var(--c-inset)' }}>{t}</span>
            <span style={{ display: 'grid', gap: 2 }}>
              <span style={{ fontSize: 26, lineHeight: '28px', fontWeight: 900, letterSpacing: '.01em' }}>{t}</span>
              <span className="dr-call dr-muted">{r.co}</span>
            </span>
            <span className="dr-muted" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44 }} aria-label="Close"><Icon d={ICON.close} size={22} /></span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {you ? <span className="dr-pill dr-pill--you">Yours</span> : <span className="dr-pill">Owned by Gianluigi B.</span>}
          </div>
          <div className="dr-strip4" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {fig('Price', $(r.thu), [`${pct(r.todayPct)} today`, tone(r.todayPct)])}
            {fig('Week gain', $s(r.weekGain), [pct(weekPct), tone(weekPct)], tone(r.weekGain))}
            {fig('Since the draft', $s(r.gain), [pct((r.gain / r.cost) * 100), tone(r.gain)], tone(r.gain))}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>Season</span>
              <span className="dr-cap dr-num">{$(r.draft)} → {$(r.thu)}</span>
            </div>
            <CardLine pts={season} days={seasonDays} span={26.63} base={r.draft} h={132} axis={SEASON_AXIS} label={`${t} from Sep 29 to Nov 5: ${$(r.draft)} to ${$(r.thu)}`} />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>This week</span>
              <span className={`dr-call dr-num ${tone(r.weekGain)}`} style={{ fontWeight: 800 }}>{$s(r.weekGain)} · {pct(weekPct)}</span>
            </div>
            <CardLine pts={week} days={weekDays} span={5} base={r.mon} h={104} axis={WEEK_AXIS} label={`${t} this week, from Monday's open at ${$(r.mon)} to ${$(r.thu)} now, Thursday`} />
          </div>
          {you
            ? <span className="dr-btn dr-btn--line" style={{ width: '100%' }}>Sell</span>
            : <span className="dr-btn dr-btn--line" style={{ width: '100%', gap: 8 }}><Icon d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" size={18} width={2} />Save</span>}
          <div style={{ display: 'grid', gap: 4, padding: '12px 14px', borderRadius: 14, background: 'var(--c-inset)' }}>
            <span className="dr-tag dr-muted" style={{ fontStretch: '100%', letterSpacing: '.04em' }}>{you ? 'How you got it' : 'How they got it'}</span>
            <span className="dr-call dr-num" style={{ fontSize: 15, fontWeight: 700 }}>Drafted {K.ordinal(r.pick)} overall · Sep 29 · {$(r.draft)}</span>
          </div>
          <span className="dr-cap" style={{ textAlign: 'center' }}>Market data provided by Alpaca</span>
        </div>
      </>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // OPEN: Game Night as he picked it, and the player card.
  // ═════════════════════════════════════════════════════════════════════
  function GameNight() {
    const A = (title, note, frame, ref = ['s1', 'The arrangement he picked.'], lref = ['y4', 'Off-white page, white cards.']) => (
      <Pair refId={ref[0]} trait={ref[1]} lightRef={lref[0]} lightTrait={lref[1]} caption={title} note={note} frame={frame} />
    );
    return (
      <section className="b-sec" id="call-game-night" aria-labelledby="call-game-night-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="call-game-night-h">Your look: Game Night, as you picked it, and the player card</h2>
            <p className="b-job"><b>Giorgio, 2026-10-12:</b> "I'm leaning more towards the game night as like the color palette and the styling." The draft board's colour "just with that line at the bottom", because the filled squares are "a little too similar to Sleeper", and you want it "without it being like a carbon copy of Sleeper". No row lines: "I don't want that like line thing there visible." Tapping any stock opens it as a player card. Every frame in Dark and Light; look it over and say if it is right.</p>
          </div>
        </header>
        <div className="b-ask" style={{ marginTop: 0 }} id="call-game-night-ask">
          <h3>What I need from you</h3>
          <ol>
            <li><b>Is this Game Night as you picked it?</b> Every frame below, Dark and Light.</li>
            <li><b>The player card</b> (the first two rows): right, or what to change.</li>
            <li><b>One label:</b> "Since the draft" (your Portfolio rule) or "Season gain" (your list) in the card's key figures.</li>
            <li><b>Still open from before:</b> Portfolio gets a chart and range pills<NEW /> (yes or no), and the your-turn flash in cyan instead of the approved gold (yes, or keep gold).</li>
          </ol>
        </div>
        <ul className="b-inv__notes">
          <li><b>What changed from the A you picked:</b> the draft tiles carry their sector as a line at the bottom (Broadcast's treatment, in Game Night's surfaces); the Portfolio rows lose their small lines; the Matchup keeps the shaded side for whoever leads the row and the "leads by" line; the centre column stays empty.</li>
          <li><b>Your question:</b> was the small line on each Portfolio row the whole season? No: it was this week only (Monday's open, Wednesday's close, now). It is gone now; the player card carries the season line instead, with a marker where the stock was acquired.</li>
          <li><b>The player card, redrawn after your review (2026-10-12):</b> three key figures (Price · Week gain · Since the draft; no position: "a little cluttered. Maybe we just go with three"); the season line with a date axis and no "Drafted" marker; this week's line on a Mon…Fri axis (the days still to come stay empty); the one action (Sell on yours, never Save: "there probably shouldn't be a save option if you already have the stock"; Save on theirs); "How you got it" at the bottom, like ESPN's Latest transaction. The top card is as you liked it.</li>
          <li><b>A label clash for you:</b> your list says "season gain" in the key figures. Your rule from 2026-10-05 keeps "season gain" for a manager's regular-season total and says Portfolio's gain is "since the draft", never one for the other. Drawn as "Since the draft"; a stock bought or claimed later would read "Since Oct 2"<NEW />. Say if you want "Season gain" there anyway.</li>
          <li><b>New copy</b><NEW />: "Yours", "How they got it" (your words: "How you got it", "Drafted 2nd overall · Sep 29 · $290.10"). Everything else is the app's own ("Owned by …", "Your position", "Week gain", "Sell", "Save").</li>
          <li><b>SAMPLE:</b> each stock's Friday closes for weeks 1–5, a midday and a close for Mon–Wed of this week, and the calendar (drafted Sep 29, now Thu Nov 5). The draft price, Monday's open, Wednesday's close and Thursday's price are data.js's.</li>
        </ul>
        <div className="dr-pairs">
          {A('Player card · opened from Matchup (their stock: Gianluigi B.\'s NKE)', 'Tap any row on either side. The header says whose it is; the action is Save, since another manager owns it.', (t) => <MatchupFrame d="a" t={t} overlay={<PlayerCard who="opp" />} />, ['pc', 'ESPN: the big name, the stat strip, the action.'], ['s5', 'E*TRADE: the key figures, right-aligned and tabular.'])}
          {A('Player card · opened from Portfolio (yours: NVDA)', 'Your words for the "How you got it" line. The one action is Sell (the whole position, as always).', (t) => <PortfolioFrame d="a" t={t} overlay={<PlayerCard who="you" />} />, ['pc', 'ESPN: the player card as a sheet over the screen.'], ['s5', 'E*TRADE: the key figures.'])}
          {A('Home, in season', 'Unchanged from the A you picked.', (t) => <HomeFrame d="a" t={t} />, ['s1', 'The navy card with a rim; the lit half.'])}
          {A('Matchup, live', 'Unchanged: the shaded side and the "leads by" line; the centre column empty.', (t) => <MatchupFrame d="a" t={t} />)}
          {A('Matchup, final', 'Unchanged.', (t) => <MatchupFrame d="a" t={t} final />, ['s1', 'The mirrored roster.'], ['v110', '1.1.0, Light: the leader\'s half lit.'])}
          {A('Draft room, on the clock', 'Changed: the sector is a line at the bottom of each tile, on Game Night\'s surfaces.', (t) => <DraftFrame d="a" t={t} />, ['s3', 'Broadcast\'s line at the bottom (ESPN\'s panel edge).'], ['y1', 'Your turn as a filled pill on white.'])}
          {A('League › Standings, in full', 'Unchanged.', (t) => <StandingsFrame d="a" t={t} />, ['s1', 'Rows divided by space and surface.'], ['s5', 'White cards, right-aligned numbers.'])}
          {A('Portfolio', <>Changed: no small lines on the rows. The chart and the range pills are still new on Portfolio<NEW /> (one of your open questions).</>, (t) => <PortfolioFrame d="a" t={t} />, ['s4', 'The number, then its line.'], ['s5', 'Key figures on white.'])}
        </div>
      </section>
    );
  }

  /** Decided 2026-10-12 (PR #229): the Matchup row order. Archived; rendered by board.jsx. */
  function RowOrder() {
    return (
      <section className="b-sec" id="call-row-order" aria-labelledby="call-row-order-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="call-row-order-h">Decided: the order of the Matchup rows</h2>
            <p className="b-job"><b>Decided by Giorgio (2026-10-12).</b> Drawn in all three directions so it holds whichever wins.</p>
          </div>
        </header>
        <h3 className="b-sub" id="call-direction-order">Decided: the order of the rows (Giorgio, 2026-10-12)</h3>
        <ul className="b-inv__notes">
          <li><b>Giorgio, 2026-10-12:</b> "It'll just be ordered by who's performing the best, uh, since there aren't like positions." <b>Unslotted leagues</b> (fixed per-slot, budget-cap; Stock Scudetto is one): one list per side, by week gain, best first, no grouping (a, below, and every Matchup frame above). <b>Slotted leagues</b> (category slots and price tiers) group by slot (next).</li>
          <li><b>When it updates (decided):</b> "it should be at the end of each day, like the start of the next day, it'll reorder it to show like who's been doing the best. So it doesn't update like live per se, but updates at the end of the day." The order is recomputed once at each market close and holds through the next trading day; nothing re-sorts live. On Monday, before the first close, every week gain is $0.00, so the rows show the draft/slot order.</li>
        </ul>
        <div className="dr-strip">
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster order="gain" label="Rows by week gain" /><div style={{ height: 10 }} /><MiniRoster order="gain" label="Rows by week gain" t="light" /><figcaption><b>✓ a · By week gain, best first on each side (chosen)</b><span>The top of the page is the story of the week. It is also (d) "your best against their best": each row is a mini-matchup.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster order="pick" label="Rows in draft order" /><div style={{ height: 10 }} /><MiniRoster order="pick" label="Rows in draft order" t="light" /><figcaption><b>b · Draft order (not chosen)</b><span>Your first pick at the top, the roster as drafted. Never moves.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster order="value" label="Rows by position size" /><div style={{ height: 10 }} /><MiniRoster order="value" label="Rows by position size" t="light" /><figcaption><b>c · By position size (not chosen)</b><span>Your largest holding first. Moves only when prices move a lot.</span></figcaption></figure>
        </div>
        <ul className="b-inv__notes">
        </ul>

        <h3 className="b-sub" id="call-direction-categories">Decided: slotted leagues group by slot (categories and price tiers)</h3>
        <ul className="b-inv__notes">
          <li><b>The ruling:</b> the roster is grouped by slot group, in the league's slot order ("Tech ×3", then "Autos & Transport ×2", then "Flex"; or "$100–$200 ×2", then "$200–$400 ×2"), the group acting as the position label; inside a group, best week first. Both managers share the slots, so the two columns pair up group by group.</li>
          <li><b>How the header sits in the mirror:</b> centred across both columns, above its rows, so it reads as the position for the whole group (Sleeper's centre pill, said once per group instead of once per row). The centre column itself stays empty. A as a pill, B as a band, C as small capitals.</li>
          <li><b>SAMPLE, categories:</b> Stock Scudetto re-cast with four category slots (Tech &amp; Media ×2, Consumer ×2, Financials, Flex) that both rosters fill legally. The holdings and every number are the same as above; only the slot names are invented<NEW />.</li>
          <li><b>SAMPLE, price tiers:</b> a "Tier Cup" week, Roberto B. vs Paolo M., built from the board's own stocks: one share each (tier leagues buy one share), the tier set by the draft price, the week gain = Thursday's price − Monday's open. Which stocks each manager holds is invented; every price is data.js's.</li>
        </ul>

        <div className="b-concepts b-concepts--three">
          {['a', 'b', 'c'].flatMap((d) => (
            ['dark', 'light'].map((t) => <figure key={d + t} className="b-fig b-fig--inv"><Fit><MatchupFrame d={d} t={t} groups="category" /></Fit><figcaption><b>{d.toUpperCase()} · {t === 'dark' ? 'Dark' : 'Light'} · Matchup live, a category league (sample slots)</b><span>The whole scroll. Each group: its header, then its rows, best week first.</span></figcaption></figure>)
          ))}
        </div>
        <div className="b-concepts b-concepts--three">
          {['a', 'b', 'c'].flatMap((d) => (
            ['dark', 'light'].map((t) => <figure key={d + t} className="b-fig b-fig--inv"><Fit><MatchupFrame d={d} t={t} groups="tier" /></Fit><figcaption><b>{d.toUpperCase()} · {t === 'dark' ? 'Dark' : 'Light'} · Matchup live, a price-tier league (sample)</b><span>Tier Cup: "$200–$400 ×3", then "$100–$200", then "$50–$100", the league's slot order.</span></figcaption></figure>)
          ))}
        </div>

      </section>
    );
  }

  function Directions({ archived }) {
    return (
      <section className="b-sec" id="call-direction" aria-labelledby="call-direction-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="call-direction-h">{archived ? 'Decided: the direction · A, Game Night' : 'Your call: the direction'}</h2>
            <p className="b-job"><b>Giorgio, 2026-10-12:</b> "everything I'm seeing is just so bland. It's not creative. It's not inspiring." "I want to create a, a kind of a, a blend between a, a, a sleeper and ESPN fantasy football with a Robin Hood". "I want every section to, in its own way, elevate the, the app". Three directions, each led by ONE of your references, drawn on the same league at the same moment (Stock Scudetto, Week 6, Thu 1:37 PM ET, Roberto B.'s phone), each in Dark and in Light side by side. <b>Giorgio, 2026-10-12:</b> "I want one that it doesn't matter what mode you're in, it's going to be built for either." Each frame sits between the Dark reference it borrows from (left) and the Light one (right), with the trait named. Pick the one that makes you go "wow" in both.</p>
          </div>
        </header>

        {archived ? null : <div className="b-ask" style={{ marginTop: 0 }}>
          <h3>What I need from you</h3>
          <ol>
            <li><b>The direction:</b> A, B or C (or one with a piece of another). <a href="#call-direction-rec">The recommendation</a> is at the end of this section.</li>
            <li><b>The centre column</b> in leagues without slots: empty, or something in it. <a href="#call-direction-centre">Drawn here.</a></li>
            <li><b>Portfolio gets a chart and range pills</b><NEW />, as the plan asked: yes or no.</li>
            <li><b>If A:</b> the your-turn flash changes from the approved gold to cyan. Yes, or keep gold.</li>
          </ol>
        </div>}

        <ul className="b-inv__notes">
          <li><b>The same in all three:</b> what is on each screen and in what order (the calm Home, the UX rules), every string (all of it already in the app, except where marked <NEW />), and every number (derived from the board's data). Only the skin changes: surfaces, colour, type weight, how rows divide, the chart.</li>
          <li><b>Matchup is your ruling, literally:</b> a scoreboard (names, the two totals, who leads), then your stocks against theirs, row by row, each with its week. No win %, no bars, no projections, no chart, no "yet to play", nothing else, in any direction. The existing My matchup / All matchups switch stays (it isn't page content).</li>
          <li><b>Sample, not data:</b> the sector of each stock (the tile colours and the pill) and the league colour in B. This league has no tiers or categories, so the pill shows what a category league would draw.</li>
          <li><b>Both themes, every frame:</b> each screen is drawn in Dark and in Light from the same roles, side by side, whichever theme the board itself is in. Light references: E*TRADE and Yahoo; Dark: Sleeper, ESPN, Robinhood. Where a direction loses something in Light, its "In Light" line says so.</li>
          <li><b>Every chart has a state for 0 and 1 points:</b> the line stops at the last real point and ends in a dot (Robinhood's "stops at now"), so Monday morning is a short line, never a blank frame.</li>
        </ul>

        {DIRS.map((dir) => <Direction key={dir.id} dir={dir} />)}

        <h3 className="b-sub" id="call-direction-compare">Matchup, side by side, with 1.1.0</h3>
        <div className="b-concepts b-concepts--three">
          {['a', 'b', 'c'].flatMap((d) => ['dark', 'light'].map((t) => (
            <figure key={d + t} className="b-fig b-fig--inv"><Fit><MatchupFrame d={d} t={t} /></Fit><figcaption><b>{d.toUpperCase()} · live · {t === 'dark' ? 'Dark' : 'Light'}</b></figcaption></figure>
          )))}
          <figure className="b-fig b-fig--inv">
            <div className="b-fit" style={{ maxWidth: 402 }}><img src={REF.v110 && REF.v110.src} alt="Stockpile 1.1.0, matchup screen (Light, a test league)" style={{ width: '100%', borderRadius: 40, display: 'block' }} /></div>
            <figcaption><b>1.1.0 · the look you said captured the head-to-head better</b><span>Light, a test league (2026-09-25). The leader's half of the scoreboard is lit with "Leading"; the roster is two mirrored columns with a numbered centre column, the leader's column lit, a total at the foot. All three directions keep the lit half and the mirror.</span></figcaption>
          </figure>
        </div>

        <h3 className="b-sub" id="call-direction-centre">Your call: the centre column (unslotted leagues)</h3>
        <div className="dr-strip">
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster mid="none" label="Centre column empty" /><div style={{ height: 10 }} /><MiniRoster mid="none" label="Centre column empty" t="light" /><figcaption><b>Empty (recommended, drawn above)</b><span>The two numbers face each other across a gap. Nothing to explain.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster mid="cat" label="Centre column with the sector pill" /><div style={{ height: 10 }} /><MiniRoster mid="cat" label="Centre column with the sector pill" t="light" /><figcaption><b>The tier or sector pill</b><span>In slotted leagues the group header now does this job (above). Elsewhere a pill would name each stock's price tier or sector; but rows pair best against best, not slot against slot, so the two sides' pills would disagree. Sector colours here are sample.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster mid="num" label="Centre column with row numbers" /><div style={{ height: 10 }} /><MiniRoster mid="num" label="Centre column with row numbers" t="light" /><figcaption><b>Row number, as 1.1.0 had it</b><span>1 to 6. Honest, but it reads like a position, which your ruling rules out.</span></figcaption></figure>
        </div>

        <div className="b-ask" id="call-direction-rec">
          <h3>The Design Lead's recommendation: A · Game Night</h3>
          <ul>
            <li><b>Why A, in both modes:</b> it is the only one that looks like a fantasy app first, in Dark and in Light. The lit half and the mirrored rows are 1.1.0's head-to-head, made bigger; the navy steps, the cyan and the colour tiles are Sleeper's game night; and the money screens still go Robinhood (near-black, the number and its line), so the bridge you asked for is built into the system, not bolted on.</li>
            <li><b>Why not B:</b> it is the one that changes least between the modes (the violet band reads the same on white as on charcoal, like Yahoo's purple), so if Light matters most to you, B is the strong alternative. But it is the loudest scoreboard, it needs a league colour the product doesn't have (who picks it, and what it is in Light, would be new decisions), and its panels make every screen denser. It is also the closest to 1.2.0's Game Day idea, which is the look you called bland.</li>
            <li><b>Why not C:</b> it is the cleanest and the best money screen, but the game screens read as a brokerage, and in Light, with the neon gone, it is the plainest of the three. The fantasy feeling you asked for lives only in the type.</li>
            <li><b>What A costs:</b> the your-turn flash changes from gold to cyan in Dark and deep teal in Light (an approved look, so it is part of this pick); the Matchup's lit slab and the colour tiles are new components; in Dark the money screens use a second, darker page colour; in Light the cyan loses its glow.</li>
            <li><b>When you pick:</b> say which, and anything to take from the others (for example "A, with C's portfolio"). Then the token spec (both themes at once), then the build (Home first). The row order and when it updates are decided (above); still open: the centre column in unslotted leagues.</li>
          </ul>
        </div>
      </section>
    );
  }

  window.KSDirections = GameNight;
  window.KSDirectionsArchived = () => <Amended.Provider value={false}><Directions archived /></Amended.Provider>;
  window.KSRowOrder = RowOrder;
})();
