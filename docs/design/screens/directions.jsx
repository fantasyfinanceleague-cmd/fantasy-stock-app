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
  // The app's real categories (supabase/seed/categories.json), approved names and codes
  // (Giorgio, 2026-10-12). Category per ticker is SAMPLE (the app assigns it from GICS).
  const CAT_OF = {
    MSFT: 'tech', NVDA: 'tech', AVGO: 'tech', AMD: 'tech', PLTR: 'tech', AAPL: 'tech', CRM: 'tech', ORCL: 'tech',
    META: 'media', GOOGL: 'media', DIS: 'media', AMZN: 'retail', COST: 'retail', NKE: 'retail', KO: 'food',
    TSLA: 'transport', UBER: 'transport', COIN: 'finance', JPM: 'finance', V: 'finance', 'BRK.B': 'finance',
    BA: 'industrials', LLY: 'health', UNH: 'health',
  };
  const CAT_NAME = { tech: 'Tech', finance: 'Finance', health: 'Health', energy: 'Energy', transport: 'Autos', retail: 'Retail', food: 'Food', media: 'Media', industrials: 'Industry', realestate: 'Property', misc: 'Misc' };
  const CAT_CODE = { tech: 'TEC', finance: 'FIN', health: 'HLT', energy: 'NRG', transport: 'AUT', retail: 'RTL', food: 'F&B', media: 'MED', industrials: 'IND', realestate: 'PRP', misc: 'MSC' };
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
  function Line({ d, series, starts, h = 124, marks, base = 0, label, axis }) {
    const w = 402;
    const pad = { t: 14, b: (marks ? 24 : 8) + (axis ? 18 : 0) };
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
          if (r === 'live') return <circle key={k} cx={cx} cy={h - 8 - (axis ? 18 : 0)} r="3.5" fill="var(--c-live)" />;
          const c = r === 'W' ? 'var(--c-gain)' : r === 'L' ? 'var(--c-loss)' : 'var(--c-text-2)';
          if (d === 'b') {
            return (
              <g key={k}>
                <rect x={cx - 9} y={h - 18} width="18" height="16" rx="3" fill={c} opacity=".18" />
                <text x={cx} y={h - 6} textAnchor="middle" fontSize="11" fontWeight="900" fill={c}>{r}</text>
              </g>
            );
          }
          return <text key={k} x={cx} y={h - 4 - (axis ? 18 : 0)} textAnchor="middle" fontSize="12" fontWeight="800" fill={c}>{r}</text>;
        }) : null}
        {axis ? axis.map((a, i) => <text key={a} x={i === 0 ? G : i === axis.length - 1 ? w - G : G + (i / (axis.length - 1)) * (w - 2 * G)} y={h - 3} textAnchor={i === 0 ? 'start' : i === axis.length - 1 ? 'end' : 'middle'} fontSize="12" fontWeight="500" fill="var(--c-text-2)" style={{ fontVariantNumeric: 'tabular-nums' }}>{a}</text>) : null}
      </svg>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // HOME, in season (the calm-Home structure, decided 2026-10-12)
  // ═════════════════════════════════════════════════════════════════════
  const H = K.HOME;
  const L = K.MATCHUP.live;
  function HomeLine({ d }) {
    const amended = useContext(Amended);
    const ax = d === 'a' && amended ? ['Sep 29', 'Nov 5'] : null; // two end dates (Giorgio, 2026-10-12)
    return <Line d={d} series={H.series} starts={H.weekStarts} marks axis={ax} h={ax ? 142 : 124} label={`Season gain${ax ? ', Sep 29 to Nov 5' : ''}: ${$s(H.gain)}. Weeks: W, W, L, W, W, Week 6 live.`} />;
  }
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
    const amended = useContext(Amended);
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
      // Shading B (Giorgio, 2026-10-12: "when it's you versus someone, it shades it so that it's
      // clear"): your half of This week is tinted, win or lose, as on Matchup (W4 Home gate).
      const halves = amended ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', margin: '0 -16px' }}>
          <div style={{ display: 'grid', gap: 10, padding: '12px 16px', background: 'var(--c-you-tint)' }}>
            <span className="dr-call" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><Av init="RB" you size={24} />You</span>
            <span className="dr-score" style={{ fontSize: 28, lineHeight: '30px' }}>{y.primary}</span>
          </div>
          <div style={{ display: 'grid', gap: 10, padding: '12px 16px', justifyItems: 'end' }}>
            <span className="dr-call dr-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>vs Gianluigi B.<Av init="GB" size={24} /></span>
            <span className="dr-score" style={{ fontSize: 28, lineHeight: '30px' }}>{o.primary}</span>
          </div>
        </div>
      ) : <>{names}{scores}</>;
      return (
        <div className="dr-a-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
          {top()}{halves}{tug}{foot}
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
            <HomeLine d={d} />
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
    const amended = useContext(Amended);
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
          background: d === 'a' ? (amended ? (you ? 'var(--c-you-tint)' : undefined) : (lead ? 'var(--d-lead-wash)' : undefined)) : undefined,
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
  function Half({ d, r, mirror, final, lit, litBg }) {
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
          background: lit ? (litBg || 'var(--d-lit)') : undefined, borderRadius: mirror ? '12px 0 0 12px' : '0 12px 12px 0',
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
    const amended = useContext(Amended);
    const B = d === 'a' && amended; // Giorgio, 2026-10-12: "it's you … Not whoever's winning"
    const ps = pairs(final, order).slice(0, limit || 6);
    const midCol = mid === 'none' ? (d === 'b' ? '4px' : '10px') : 'auto';
    const line = ([a, b], i) => (
      <div key={a.t} style={{ display: 'grid', gridTemplateColumns: `minmax(0,1fr) ${midCol} minmax(0,1fr)`, gap: d === 'b' && mid === 'none' ? 0 : 6, alignItems: 'stretch' }}>
        <Half d={d} r={a} final={final} lit={B ? true : a.weekGain > b.weekGain} litBg={B ? 'var(--c-you-tint)' : undefined} />
        <Mid d={d} mid={mid} r={a} i={i} />
        <Half d={d} r={b} final={final} mirror lit={B ? false : b.weekGain > a.weekGain} />
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
    // Giorgio, 2026-10-13, on the built room: "it just should show the you're on the clock and then
    // what round and pick number it is. I don't think it needs that last thing at the bottom."
    // The snake line is gone from the current frame; archived frames keep it as they were.
    const amended = useContext(Amended);
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
        {amended ? null : <span className="dr-cap">Then Paolo M. picks twice (12, 13)</span>}
      </div>
    );
    const box = {
      a: { background: 'var(--c-accent-tint)', boxShadow: 'inset 0 0 0 2px var(--c-live)', borderRadius: 16 },
      b: { background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 2px var(--c-live)', borderRadius: 3 },
      c: { background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 1.5px var(--c-live)', borderRadius: 16 },
    }[d];
    return <div style={{ ...box, padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>{ring}{text}</div>;
  }
  function Board({ d, autoPicks = [], autoMark = false }) {
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
      if (d === 'a' && amended) {
        const c = CAT_OF[t] || 'misc';
        // The 1.2.0 "Auto" tag, redrawn (the auto-pick call, 2026-10-13): pinned over the tile's
        // top-right corner in the inverse pair, so it never takes the label row's room.
        const autoTag = autoMark && autoPicks.includes(n)
          ? <span aria-label="Auto-picked" style={{ position: 'absolute', top: -7, right: -4, zIndex: 2, padding: '1px 5px', borderRadius: 6, fontSize: 11, lineHeight: '13px', fontWeight: 800, letterSpacing: '.04em', background: 'var(--c-inverse-bg)', color: 'var(--c-inverse-fg)' }}>AUTO</span>
          : null;
        return <div key={n} style={{ ...base, background: 'var(--c-surface)', boxShadow: `inset 0 -3px 0 var(--d-cat-${c})`, color: 'var(--c-text)' }}>{autoTag}<span className="dr-num dr-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}><span>{n}</span><span>{CAT_CODE[c]}</span></span><span style={{ fontSize: 13, fontWeight: 900 }}>{t}</span></div>;
      }
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dr-t" style={{ fontSize: 16 }}>{t}</span>{d === 'a' && amended ? <span className="dr-pillcat" style={{ background: `var(--d-cat-${CAT_OF[t]})`, color: 'var(--d-on-cat)', height: 18, fontSize: 11 }}>{CAT_NAME[CAT_OF[t]]}</span> : <span className="dr-pillcat" style={{ background: `var(--d-tile-${s})`, height: 18, fontSize: 11 }}>{SECTOR_LABEL[s]}</span>}</span>
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
            <Line d={d} series={series} base={series[0]} h={d === 'a' && amended ? 168 : 150} axis={d === 'a' && amended ? ['Sep 29', 'Oct 9', 'Oct 23', 'Nov 5'] : null} label={`Portfolio value from Sep 29 to Nov 5: ${$(P.value)}`} />
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
            {you ? <span className="dr-pill dr-pill--you">Yours</span> : <span className="dr-pill" style={{ gap: 6, paddingLeft: 3 }}><span className="dr-av" style={{ width: 20, height: 20, fontSize: 11, background: 'var(--c-opp)', color: 'var(--c-on-opp)' }}>GB</span>Owned by Gianluigi B.</span>}
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
      <section className="b-sec" id="game-night" aria-labelledby="game-night-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="game-night-h">Game Night: the new look, approved (both themes)</h2>
            <p className="b-job"><b>Giorgio, 2026-10-12:</b> "I'm leaning more towards the game night as like the color palette and the styling", with his tweaks, and on the open questions: "go with your recommendations". This is the reference W3 and W4 build to (DESIGN_DIRECTION §9C). Every frame in Dark and Light, beside its references.</p>
          </div>
        </header>
        <ul className="b-inv__notes">
          <li><b>Matchup shading (decided B):</b> your side is always shaded in your colour, win or lose; who leads is the totals and "{'{name}'} leads by …". No row-winner lighting.</li>
          <li><b>Draft tiles:</b> the category is a 3pt line along the bottom with its 3-letter code (TEC, FIN, HLT, NRG, AUT, RTL, F&amp;B, MED, IND, PRP, MSC); the on-the-clock cell stays navy in Light. Your turn is cyan (teal in Light).</li>
          <li><b>Charts:</b> every chart has a labelled X axis; Home's season chart keeps its W/L marks plus two end dates; Portfolio has its chart and range pills.</li>
          <li><b>The player card:</b> three figures (Price · Week gain · Since the draft, or "Since Oct 2" for a later buy); the season line on dates; this week on Mon…Fri; Sell on yours, never Save; Save on theirs; the owner's avatar next to "Owned by"; "How you got it" at the bottom, the price per share. The weekly log comes later.</li>
          <li><b>SAMPLE:</b> each stock's category, the weeks 1–5 closes, midday points this week, and the calendar (drafted Sep 29, now Thu Nov 5). Everything else is data.js's.</li>
        </ul>
        <div className="dr-pairs">
          {A('Player card · opened from Matchup (their stock: Gianluigi B.\'s NKE)', 'Tap any row on either side. The owner\'s avatar sits next to "Owned by"; the action is Save, since another manager owns it.', (t) => <MatchupFrame d="a" t={t} overlay={<PlayerCard who="opp" />} />, ['pc', 'ESPN: the big name, the stat strip, the owner, the action.'], ['s5', 'E*TRADE: the key figures, right-aligned and tabular.'])}
          {A('Player card · opened from Portfolio (yours: NVDA)', 'The one action is Sell (the whole position, as always); never Save on a stock you own.', (t) => <PortfolioFrame d="a" t={t} overlay={<PlayerCard who="you" />} />, ['pc', 'ESPN: the player card as a sheet over the screen.'], ['s5', 'E*TRADE: the key figures.'])}
          {A('Home, in season', 'The season chart with its W/L marks and the two end dates.', (t) => <HomeFrame d="a" t={t} />, ['s1', 'The navy card with a rim.'])}
          {A('Matchup, live (you lead)', 'Your side shaded; the totals and "leads by" say who leads.', (t) => <MatchupFrame d="a" t={t} />)}
          {A('Matchup, live (you\'re behind): Gianluigi B.\'s phone', 'Still your side shaded; Roberto B.\'s totals and "leads by" say he leads.', (t) => <ShadeFrame t={t} mode="B" scene="scud" />)}
          {A('Matchup, final', 'Your side shaded; "won by".', (t) => <MatchupFrame d="a" t={t} final />, ['s1', 'The mirrored roster.'], ['v110', '1.1.0, Light: the mirrored rows.'])}
          {A('Matchup, a category league (sample slots)', 'Grouped by slot in the league\'s order, the group header centred; your column shaded.', (t) => <MatchupFrame d="a" t={t} groups="category" />)}
          {A('Matchup, a price-tier league (sample): Paolo M.\'s phone, behind', 'Grouped by tier; your column shaded in every group, a mixed week.', (t) => <ShadeFrame t={t} mode="B" scene="tier" />)}
          {A('Draft room, on the clock', 'Category lines with their codes; the navy on-the-clock cell; your turn in cyan.', (t) => <DraftFrame d="a" t={t} />, ['s3', 'Broadcast\'s line at the bottom (ESPN\'s panel edge).'], ['y1', 'Your turn as a filled pill on white.'])}
          {A('League › Standings, in full', 'Rows as tiles; your row tinted and ringed.', (t) => <StandingsFrame d="a" t={t} />, ['s1', 'Rows divided by space and surface.'], ['s5', 'White cards, right-aligned numbers.'])}
          {A('Portfolio', 'The chart on a date axis with its range pills; category pills on the rows; no small lines.', (t) => <PortfolioFrame d="a" t={t} />, ['s4', 'The number, then its line.'], ['s5', 'Key figures on white.'])}
        </div>
      </section>
    );
  }

  /** The answers to the redesign's open list (Giorgio, 2026-10-12), for the Archive. */
  function RedesignAnswers() {
    return (
      <section className="b-sec" id="call-redesign-answers" aria-labelledby="call-redesign-answers-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="call-redesign-answers-h">Decided: the redesign's open questions</h2>
            <p className="b-job"><b>Giorgio, 2026-10-12:</b> "go with your recommendations" (on everything but the shading, decided separately).</p>
          </div>
        </header>
        <ul className="b-inv__notes">
          <li><b>Your turn:</b> cyan in Dark, deep teal in Light (not the approved gold).</li>
          <li><b>The card's third figure:</b> "Since the draft" ("Since Oct 2" for a stock bought later); "season gain" stays a manager's total.</li>
          <li><b>Portfolio:</b> the chart and range pills, yes.</li>
          <li><b>Every chart's X axis:</b> Home's season chart keeps its W/L marks and adds two end dates.</li>
          <li><b>"How you got it":</b> the price per share.</li>
          <li><b>The on-the-clock cell in Light:</b> stays navy.</li>
          <li><b>The owner's avatar</b> next to "Owned by" on the card: yes; the weekly game log later.</li>
          <li><b>My matchup / All matchups:</b> stays, as navigation. <b>Display face:</b> Archivo only. <b>Release:</b> 1.3, one build.</li>
        </ul>
      </section>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // YOUR CALL: the Matchup shading when you're BEHIND (A follows the leader, B is always you)
  // and the 11 category labels. Game Night, Light + Dark.
  // ═════════════════════════════════════════════════════════════════════
  /** Matchup from a TRAILING manager's phone. scene 'scud' = Stock Scudetto live from
   * Gianluigi B.'s phone (real data.js numbers, Roberto sweeps every row); scene 'tier' =
   * the Tier Cup sample from Paolo M.'s phone (a mixed week). mode 'A' = the shade follows the
   * leader (the scoreboard half and each row's winning half); mode 'B' = your side is always
   * shaded and the lead is said only by the line and the numbers. */
  function ShadeFrame({ t, mode, scene }) {
    const tier = scene === 'tier';
    const m = tier ? tierMatch(false) : K.MATCHUP.live;
    const me = m.opp, them = m.you; // the trailing manager is "you" on this phone
    const meN = tier ? { name: 'Paolo M.', init: 'PM' } : { name: 'Gianluigi B.', init: 'GB' };
    const themN = { name: 'Roberto B.', init: 'RB' };
    const meLead = me.gain >= them.gain;
    const half = (who, mirror) => {
      const mine = who === 'me';
      const lead = mine === meLead;
      const shaded = mode === 'A' ? lead : mine;
      return (
        <div style={{ display: 'grid', gap: 8, justifyItems: mirror ? 'end' : 'start', padding: '16px 14px', background: shaded ? (mode === 'A' ? 'var(--d-lead-wash)' : 'var(--c-you-tint)') : undefined, borderRadius: mirror ? '0 14px 14px 0' : '14px 0 0 14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: mirror ? 'row-reverse' : 'row' }}>
            <Av init={(mine ? meN : themN).init} you={mine} size={44} />
            <span className="dr-call" style={{ fontWeight: mine ? 800 : 600, fontSize: 15 }}>{(mine ? meN : themN).name}</span>
          </span>
          <span className="dr-score" style={{ fontSize: 32, lineHeight: '36px' }}>{SD(mine ? me : them).primary}</span>
        </div>
      );
    };
    const row = ([a, b]) => {
      const litA = mode === 'A' ? a.weekGain > b.weekGain : true;
      const litB = mode === 'A' ? b.weekGain > a.weekGain : false;
      const bg = mode === 'A' ? 'var(--d-lit)' : 'var(--c-you-tint)';
      return (
        <div key={a.t} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 10px minmax(0,1fr)', gap: 6 }}>
          <Half d="a" r={a} lit={litA} litBg={bg} />
          <span />
          <Half d="a" r={b} mirror lit={litB} litBg={bg} />
        </div>
      );
    };
    const sortG = (rows) => [...rows].sort((p, q) => q.weekGain - p.weekGain);
    const body = tier
      ? TIER_SLOTS.map((g) => {
          const a = sortG(me.rows.filter((r) => g.opp.includes(r.t))), b = sortG(them.rows.filter((r) => g.you.includes(r.t)));
          return [<GroupHead key={g.name} d="a" g={g} />, ...a.map((r, i) => row([r, b[i]]))];
        })
      : sortG(me.rows).map((r, i) => row([r, sortG(them.rows)[i]]));
    return (
      <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`}>
        <Device tab="matchup" full label={`Matchup when you're behind, option ${mode}, ${t}`}>
          <div className="ks-head" style={{ paddingInline: G }}>
            <span className="ks-pill"><span>{tier ? 'Tier Cup' : K.LEAGUE.name}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
            <LiveChip />
          </div>
          <Body gap={18}>
            <div className="dr-seg"><span className="on">My matchup</span><span>All matchups</span></div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="dr-a-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>{half('me')}{half('them', true)}</div>
              <span className="dr-call" style={{ textAlign: 'center' }}>Roberto B. leads by <b className="dr-num">{K.formatMoney(Math.abs(me.gain - them.gain))}</b></span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>{body}</div>
          </Body>
        </Device>
      </div>
    );
  }

  // The 11 product categories (supabase/seed/categories.json), each a colour (--d-cat-*) and
  // PROPOSED short names: `label` for pills and legends (≤ 8 letters), `code` for the narrow
  // draft tile (3 letters, the way fantasy apps write positions). All NEW copy.
  const CATS = [
    ['tech', 'Technology', 'Tech', 'TEC', 'NVDA'], ['finance', 'Financials', 'Finance', 'FIN', 'JPM'], ['health', 'Healthcare', 'Health', 'HLT', 'LLY'],
    ['energy', 'Energy & Utilities', 'Energy', 'NRG', 'XOM'], ['transport', 'Autos & Transport', 'Autos', 'AUT', 'TSLA'], ['retail', 'Retail & Consumer Goods', 'Retail', 'RTL', 'COST'],
    ['food', 'Food & Beverage', 'Food', 'F&B', 'KO'], ['media', 'Entertainment & Media', 'Media', 'MED', 'DIS'], ['industrials', 'Industrials & Materials', 'Industry', 'IND', 'BA'],
    ['realestate', 'Real Estate & Construction', 'Property', 'PRP', 'PLD'], ['misc', 'Misc', 'Misc', 'MSC', 'BRK.B'],
  ];
  function CategoryStrip({ t }) {
    return (
      <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`} style={{ background: 'var(--c-bg)', color: 'var(--c-text)', borderRadius: 18, padding: 16, display: 'grid', gap: 12 }} role="img" aria-label={`The 11 categories, ${t}`}>
        <span className="dr-tag dr-muted">{t === 'dark' ? 'Dark' : 'Light'}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {CATS.map(([slug, name, label, code, tk]) => (
            <div key={slug} style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 1px var(--d-rim)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dr-pillcat" style={{ background: `var(--d-cat-${slug})`, color: 'var(--d-on-cat)', height: 22, fontSize: 12 }}>{label}</span>
                <span style={{ height: 44, width: 57, borderRadius: 5, background: 'var(--c-inset)', boxShadow: `inset 0 -3px 0 var(--d-cat-${slug})`, padding: '4px 6px', display: 'grid', alignContent: 'space-between' }}>
                  <span className="dr-num dr-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}><span>14</span><span>{code}</span></span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--c-text)' }}>{tk}</span>
                </span>
              </div>
              <span className="dr-cap">{name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  function ShadingCall({ archived }) {
    const pair = (scene, mode) => ['dark', 'light'].map((t) => <figure key={scene + mode + t} className="b-fig b-fig--inv" style={{ margin: 0 }}><Fit><ShadeFrame t={t} mode={mode} scene={scene} /></Fit><figcaption><b>{mode === 'A' ? 'A · the shade follows the leader' : 'B · your side is always shaded'} · {t === 'dark' ? 'Dark' : 'Light'}</b></figcaption></figure>);
    return (
      <section className="b-sec" id="call-shading" aria-labelledby="call-shading-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="call-shading-h">{archived ? 'Decided: B, your side is always shaded; the 11 categories as drawn' : 'Your call: the Matchup shading when you\'re behind, and the category labels'}</h2>
            <p className="b-job"><b>Giorgio, 2026-10-12:</b> "I like the way that where you are is kind of shaded." In the frames you picked you were winning, so the shaded half was both yours and the leader's. Here you are BEHIND, to tell the two readings apart. The moment is real: Thu 1:37 PM ET on Gianluigi B.'s phone (Roberto B. leads every row), and a mixed week on Paolo M.'s phone in the Tier Cup sample.</p>
          </div>
        </header>
        <ul className="b-inv__notes">
          <li><b>A · the shade follows the leader:</b> the leader's half of the scoreboard is shaded, and in each row the stock that's winning sits on the lit slab. What 1.1.0 did ("Leading"). You read "am I winning?" from the shade alone.</li>
          <li><b>B · your side is always shaded:</b> your half of the scoreboard and your column are tinted blue (your colour, as on your Standings row), win or lose. Who leads is said by the line and the numbers only.</li>
          <li><b>Decided by Giorgio (2026-10-12): B.</b> "For the matchup shading, I was going more on the side of it's you. So when it's you versus someone, it shades it so that it's clear. Not whoever's winning. That's going to be able to be seen by the uh, the point total up top." The Design Lead had recommended A (kept for the record).</li>
        </ul>
        <h3 className="b-sub">Stock Scudetto, live, on Gianluigi B.'s phone (he's behind; Roberto B. wins every row)</h3>
        <div className="b-concepts b-concepts--three">{pair('scud', 'A')}{pair('scud', 'B')}</div>
        <h3 className="b-sub">Tier Cup (sample), live, on Paolo M.'s phone (behind, but winning two rows)</h3>
        <div className="b-concepts b-concepts--three">{pair('tier', 'A')}{pair('tier', 'B')}</div>
        <h3 className="b-sub" id="call-categories">The 11 categories: a colour and a short name each<NEW /></h3>
        <ul className="b-inv__notes">
          <li><b>Why:</b> the draft tiles' line and the sector pill follow the app's real categories (11, from the league setup), not the five sample sectors on the earlier frames. Each needs a colour and a name short enough for a tile.</li>
          <li><b>Two lengths:</b> a short name for pills and lists (≤ 8 letters), and a 3-letter code for the draft tile, the way fantasy apps write positions (QB, RB). Misc is neutral grey. Say which names you'd change.</li>
        </ul>
        <div style={{ display: 'grid', gap: 14 }}><CategoryStrip t="dark" /><CategoryStrip t="light" /></div>
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

  // ═════════════════════════════════════════════════════════════════════
  // YOUR CALL (2026-10-12, from the W4 Matchup gate): four Matchup states the approved frames
  // never drew. Game Night as built, both themes; data.js's numbers at the canonical moment.
  // ═════════════════════════════════════════════════════════════════════
  /** A Game Night Matchup phone: header, the My/All switch, then the state's body. */
  function MxPhone({ t, label, final, children }) {
    return (
      <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`}>
        <Device tab="matchup" full label={label}>
          <Head chip={final ? <FinalChip /> : <LiveChip />} />
          <Body gap={18}>
            <div className="dr-seg"><span className="on">My matchup</span><span>All matchups</span></div>
            {children}
          </Body>
        </Device>
      </div>
    );
  }
  /** One mirrored row; a missing side is an empty slot, drawn per `empty` ('blank' | 'marked'). */
  function MxRow({ a, b, empty = 'blank', bare }) {
    const slot = (r, mirror) => {
      if (r) return bare ? <NameHalf r={r} mirror={mirror} /> : <Half d="a" r={r} mirror={mirror} lit={!mirror} litBg="var(--c-you-tint)" />;
      return <EmptyHalf mirror={mirror} marked={empty === 'marked'} />;
    };
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 10px minmax(0,1fr)', gap: 6 }}>
        {slot(a, false)}<span />{slot(b, true)}
      </div>
    );
  }
  /** Your side's slab geometry (runs off the screen edge, inner corners rounded), shared by every half. */
  const slab = (mirror, you) => ({
    minHeight: 64, padding: '12px 12px', display: 'flex', alignItems: 'center', justifyContent: mirror ? 'flex-end' : 'flex-start',
    marginLeft: mirror ? 0 : -G, paddingLeft: mirror ? 12 : G, marginRight: mirror ? -G : 0, paddingRight: mirror ? G : 12,
    borderRadius: mirror ? '12px 0 0 12px' : '0 12px 12px 0', background: you ? 'var(--c-you-tint)' : undefined,
  });
  /** A held stock with no figures: the ticker and the company only. */
  function NameHalf({ r, mirror }) {
    return (
      <div style={slab(mirror, !mirror)}>
        <span style={{ display: 'grid', gap: 1, justifyItems: mirror ? 'end' : 'start', minWidth: 0 }}>
          <span className="dr-t" style={{ fontSize: 16 }}>{r.t}</span>
          <span className="dr-cap" style={{ whiteSpace: 'nowrap' }}>{r.co}</span>
        </span>
      </div>
    );
  }
  /** An empty slot. Blank = as built (your tint stays, nothing in it). Marked = a dashed rim and "Empty". */
  function EmptyHalf({ mirror, marked }) {
    const s = slab(mirror, !mirror);
    if (!marked) return <div style={s} aria-label="Empty slot, as built" />;
    return (
      <div style={{ ...s, boxSizing: 'border-box', border: '1.5px dashed var(--c-border-strong)', [mirror ? 'borderRight' : 'borderLeft']: 'none' }}>
        <span className="dr-t dr-muted" style={{ fontSize: 16 }}>Empty</span>
      </div>
    );
  }
  const mxLine = (text) => <span className="dr-call" style={{ textAlign: 'center' }}>{text}</span>;
  const mxNote = (text) => <span className="dr-cap" style={{ textAlign: 'center', display: 'block' }}>{text}</span>;
  /** Four figures per call: A Dark, A Light, B Dark, B Light. */
  function MxCall({ id, title, intro, a, b, rec, notes, frame, archived, decided = 'B', decidedNote }) {
    const fig = (opt, t) => (
      <figure key={opt + t} className="b-fig b-fig--inv" style={{ margin: 0 }}>
        <Fit>{frame(opt, t)}</Fit>
        <figcaption><b>{opt === 'A' ? `A · ${a}` : `B · ${b}`} · {t === 'dark' ? 'Dark' : 'Light'}</b></figcaption>
      </figure>
    );
    return (
      <section className="b-sec" id={id} aria-labelledby={`${id}-h`}>
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id={`${id}-h`}>{archived ? `Decided: ${decided}, ${title}` : `Your call: ${title}`}</h2>
            <p className="b-job">{intro}</p>
          </div>
        </header>
        <ul className="b-inv__notes">
          {notes}
          <li><b>Recommended: {rec}</b></li>
          {archived ? (decidedNote || <li><b>Decided by Giorgio (2026-10-13): B</b>, one call at a time from these images, with the new words exactly as drawn.</li>) : null}
        </ul>
        <div className="b-concepts b-concepts--three">{fig('A', 'dark')}{fig('A', 'light')}{fig('B', 'dark')}{fig('B', 'light')}</div>
      </section>
    );
  }

  const MX_FINAL = K.MATCHUP.final;
  const byPick = (rows) => [...rows].sort((p, q) => p.pick - q.pick);
  function CallWithheld({ archived }) {
    const a = byPick(MX_FINAL.you.rows), b = byPick(MX_FINAL.opp.rows);
    const note = "Stock-by-stock results aren't available for this week.";
    return (
      <MxCall
        archived={archived}
        id="call-mx-withheld" title="a final week whose stock-by-stock results can't be shown"
        intro={<>Rare, but real: a week is scored and its final is posted, but the stored figures for each stock don't add up to that final to the cent (a price that was corrected later, for example). The app then shows no rows at all, because a row that disagrees with the score would be wrong. Today the screen is the banner and the scoreboard, and nothing under them. Week 6's final, both rows withheld; the scores are data.js's.</>}
        a="the scoreboard and one line" b="who held what, without figures"
        notes={<>
          <li><b>A:</b> the scoreboard as usual, then one line saying why nothing follows: "{note}"<NEW /></li>
          <li><b>B:</b> the same line, then both lineups as rows with the ticker and company only, no numbers, in draft order. You can still see who held what, and nothing contradicts the score. Your side keeps its shade.</li>
        </>}
        rec="B. The page doesn't sit blank, and it shows only what is certain. The line is new copy either way."
        frame={(opt, t) => (
          <MxPhone t={t} final label={`Final with the rows withheld, option ${opt}, ${t}`}>
            <Scoreboard d="a" final />
            {mxNote(note)}
            {opt === 'B' ? <div style={{ display: 'grid', gap: 6 }}>{a.map((r, i) => <MxRow key={r.t} a={r} b={b[i]} bare />)}</div> : null}
          </MxPhone>
        )}
      />
    );
  }

  // SAMPLE for the empty-slot call: Stock Scudetto as a category league where you sold TSLA on
  // Tuesday and Gianluigi B. sold BA, and neither has bought a replacement yet. The holdings and
  // every number are data.js's; the slots and the two sales are invented.
  const EMPTY_SLOTS = [
    { name: 'Tech & Media', you: ['NVDA', 'AAPL'], opp: ['AMZN', 'DIS'] },
    { name: 'Consumer', you: ['COST', null], opp: ['NKE', 'KO'] },
    { name: 'Financials', you: ['V'], opp: ['JPM'] },
    { name: 'Flex', you: ['CRM'], opp: [null] },
  ];
  function CallEmpty({ archived }) {
    const L = K.MATCHUP.live;
    const row = (side, t) => (t ? L[side].rows.find((r) => r.t === t) : null);
    const groups = EMPTY_SLOTS.map((g) => {
      const sort = (side, ts) => [...ts.filter(Boolean).map((t) => row(side, t)).sort((p, q) => q.weekGain - p.weekGain), ...ts.filter((t) => !t).map(() => null)];
      return { g, a: sort('you', g.you), b: sort('opp', g.opp) };
    });
    return (
      <MxCall
        archived={archived}
        id="call-mx-empty" title="how an empty slot reads"
        intro={<>A slot is empty when a manager has sold a stock and not yet bought its replacement (cash from a sale). In a slotted league the row still exists, so one side has nothing in it. Today your empty half is your shade with nothing inside, and the other side's is blank. In the frames: a category league (SAMPLE slots) where you sold TSLA and Gianluigi B. sold BA; Thu 1:37 PM ET.</>}
        a="as built: the slot is just space" b="marked: a dashed edge and “Empty”"
        notes={<>
          <li><b>A:</b> as built. Your empty half is a plain tinted slab; theirs is nothing. The worry from the gate: a blank slab looks like a row that is still loading.</li>
          <li><b>B:</b> the empty half keeps its place and says so: a dashed edge and "Empty"<NEW />, the way Sleeper and ESPN mark an open lineup spot. Yours keeps your shade inside it.</li>
        </>}
        rec="B. An open spot is a fact about the lineup, and fantasy apps always say it."
        frame={(opt, t) => (
          <MxPhone t={t} label={`Matchup with an empty slot, option ${opt}, ${t}`}>
            <Scoreboard d="a" />
            <div style={{ display: 'grid', gap: 6 }}>
              {groups.map(({ g, a, b }) => [
                <GroupHead key={g.name} d="a" g={{ ...g, you: g.you }} />,
                ...a.map((r, i) => <MxRow key={`${g.name}${i}`} a={r} b={b[i]} empty={opt === 'A' ? 'blank' : 'marked'} />),
              ])}
            </div>
          </MxPhone>
        )}
      />
    );
  }

  function CallBye({ archived }) {
    const L = K.MATCHUP.live;
    const mine = [...L.you.rows].sort((p, q) => q.weekGain - p.weekGain);
    const bye = 'Bye week · no result';
    return (
      <MxCall
        archived={archived}
        id="call-mx-bye" title="the bye week"
        intro={<>With an odd number of managers, someone sits out each week. Today Matchup shows one line on an empty page ("{bye}", the shipped copy). Your stocks still move that week; it just doesn't count. Roberto B. on a bye in Week 6, Thu 1:37 PM ET; his holdings and numbers are data.js's.</>}
        a="as built: one line" b="your half, and your stocks"
        notes={<>
          <li><b>A:</b> as built. The line and nothing else.</li>
          <li><b>B:</b> the scoreboard card with your half as usual (avatar, name, this week's total) and the other half saying "Bye week" where an opponent would be; the shipped line under the card; then your stocks in one column, best week first, so you can still follow them. No new words: both phrases are the shipped line's.</li>
        </>}
        rec="B. Nothing on Matchup sits blank, and the bye still reads as a bye."
        frame={(opt, t) => (
          <MxPhone t={t} label={`Bye week, option ${opt}, ${t}`}>
            {opt === 'A' ? mxLine(bye) : <>
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="dr-a-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ display: 'grid', gap: 8, justifyItems: 'start', padding: '16px 14px', background: 'var(--c-you-tint)', borderRadius: '14px 0 0 14px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Av init="RB" you size={44} /><span className="dr-call" style={{ fontWeight: 800, fontSize: 15 }}>Roberto B.</span></span>
                    <span className="dr-score" style={{ fontSize: 32, lineHeight: '36px' }}>{SD(L.you).primary}</span>
                  </div>
                  <div style={{ display: 'grid', placeItems: 'center', padding: '16px 14px' }}><span className="dr-call dr-muted" style={{ fontWeight: 700, fontSize: 15 }}>Bye week</span></div>
                </div>
                {mxLine(bye)}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {mine.map((r) => <Half key={r.t} d="a" r={r} lit litBg="var(--c-you-tint)" />)}
              </div>
            </>}
          </MxPhone>
        )}
      />
    );
  }

  function CallOrder({ archived }) {
    const L = K.MATCHUP.live;
    // The order at Thu 1:37 PM: each stock's gain at Wednesday's close (the last close whose
    // trading has ended, Giorgio's rule); the numbers shown are live.
    const wed = (r) => r.qty * (r.prev - r.mon);
    const sortWed = (rows) => [...rows].sort((p, q) => wed(q) - wed(p));
    const a = sortWed(L.you.rows), b = sortWed(L.opp.rows);
    const cap = "Ordered by Wednesday's close";
    return (
      <MxCall
        archived={archived}
        id="call-mx-order" title="saying why the rows are in this order"
        intro={<>Your rule: the rows are re-ordered once a day, after trading ends, never while you watch. So at Thu 1:37 PM ET the order is Wednesday's close, while every number is live. On a day that turns, a column can look unsorted: Gianluigi B.'s AMZN was his best stock at Wednesday's close and sits on top, but it is down {K.formatMoney(Math.abs(b[0].weekGain))} this week right now. Week 6, data.js's numbers.</>}
        a="as built: no label" b="a short label over the rows"
        notes={<>
          <li><b>A:</b> as built. The order is right by your rule, but nothing says what it is.</li>
          <li><b>B:</b> one small line between the scoreboard and the rows: "{cap}"<NEW />. It changes with the day ("Thursday's close" from Thursday evening on).</li>
          <li><b>Not offered:</b> re-ordering live. You ruled it out (rows that jump while you look).</li>
        </>}
        rec="B. One line keeps the order from reading as a bug, at the cost of a little more text."
        frame={(opt, t) => (
          <MxPhone t={t} label={`Matchup order at midday, option ${opt}, ${t}`}>
            <Scoreboard d="a" />
            {opt === 'B' ? mxNote(cap) : null}
            <div style={{ display: 'grid', gap: 6, marginTop: opt === 'B' ? -8 : 0 }}>{a.map((r, i) => <MxRow key={r.t} a={r} b={b[i]} />)}</div>
          </MxPhone>
        )}
      />
    );
  }

  // SAMPLE for the auto-pick call: picks 4 and 9 were made by the clock (their managers ran out
  // of time); everything else on the board is data.js's.
  const AUTO_PICKS = [4, 9];
  function CallAuto({ archived }) {
    return (
      <MxCall
        archived={archived} decided="A"
        decidedNote={<li><b>Decided by Giorgio (2026-10-13): A, as built</b> ("no auto tag"), after looking at the built draft room; he ruled before seeing these frames, which record the two options.</li>}
        id="call-draft-auto" title="marking an auto-pick on the draft board"
        intro={<>When a manager's clock runs out, the app picks for them (from their queue, or the best available). In 1.2.0 every such pick wore a small "Auto" tag on its square, for the whole draft. The new board, as approved, has no tag, so today an auto-pick looks like any other pick. What still says it: your own card ("Auto-picked AAPL for you", until your next turn), the pick log (the last 8 picks), and VoiceOver. The frames: Serie A Traders on the clock, round 2, pick 11; picks 4 and 9 were auto-picks (SAMPLE).</>}
        a="as built: no mark" b={'the shipped "Auto" tag, redrawn'}
        notes={<>
          <li><b>A:</b> as built. Squares 4 and 9 look like every other pick. A cleaner board; who was auto-picked is in the log while it's recent.</li>
          <li><b>B:</b> the 1.2.0 "Auto" tag, redrawn for Game Night: a small dark tag over the square's top-right corner, for the whole draft. Same word, nothing new to read; the square keeps its number, category and ticker.</li>
        </>}
        rec="B. Seeing who got auto-picked is part of a draft's story (the friend who slept through it), and the word already shipped."
        frame={(opt, t) => (
          <Phone d="a" t={t} tab="league" label={`Draft room, auto-pick marking option ${opt}, ${t}`}>
            <Head chip={<span className="dr-chip"><span className="dr-dot" />Drafting</span>} />
            <Body gap={16}>
              <ClockCard d="a" />
              <Board d="a" autoPicks={AUTO_PICKS} autoMark={opt === 'B'} />
            </Body>
          </Phone>
        )}
      />
    );
  }
  // The mid-season Share call (from the W4 League gate): League settings, a MEMBER mid-season
  // (Stock Scudetto, Week 6; Paolo M. is commissioner). Copy is the shipped screen's, verbatim.
  function SettingsSheet({ t, share }) {
    const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 };
    return (
      <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`}>
        <Device noTabs full label={`League settings mid-season, ${share ? 'Share shown' : 'Share hidden'}, ${t}`}>
          <div style={{ padding: `56px ${G}px 24px`, display: 'grid', gap: 16 }}>
            <span className="dr-call dr-muted" style={{ fontSize: 15 }}>Cancel</span>
            <span style={{ fontSize: 34, lineHeight: '40px', fontWeight: 800, color: 'var(--c-text)' }}>League settings</span>
            <div className="dr-a-card" style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
              <div style={row}>
                <span style={{ display: 'grid', gap: 2 }}>
                  <span className="dr-call" style={{ fontWeight: 700, fontSize: 15 }}>Invite code</span>
                  <span className="dr-num" style={{ fontWeight: 800, fontSize: 15, letterSpacing: '.02em', color: 'var(--c-text)' }}>SCUD26</span>
                </span>
                {share ? <span className="dr-btn dr-btn--line" style={{ height: 40, padding: '0 18px', fontSize: 15, fontWeight: 600 }}>Share</span> : null}
              </div>
              <div style={row}>
                <span className="dr-call" style={{ fontWeight: 700, fontSize: 15 }}>Commissioner</span>
                <span className="dr-call dr-muted" style={{ fontSize: 15 }}>Paolo M.</span>
              </div>
            </div>
            <div className="dr-a-card" style={{ padding: '14px 16px', display: 'grid', gap: 4 }}>
              <span className="dr-call" style={{ fontWeight: 700, fontSize: 15, color: 'var(--c-text-3)' }}>Leave league</span>
              <span className="dr-call dr-muted" style={{ fontSize: 14 }}>Teams are locked in from an hour before the draft until the season ends.</span>
            </div>
          </div>
        </Device>
      </div>
    );
  }
  function CallShareLocked({ archived, decided, decidedNote }) {
    return (
      <MxCall
        archived={archived} decided={decided} decidedNote={decidedNote}
        id="call-share-locked" title="the invite code's Share while teams are locked"
        intro={<>League settings shows the invite code with a Share button. Mid-season, the same screen says teams are locked ("Teams are locked in from an hour before the draft until the season ends."), so a friend who gets the code can't join until the league runs it back. The commissioner gets the same Share as everyone (decided at the gate); this call is only WHEN it shows. A member's settings, Week 6.</>}
        a="Share always shown" b="Share hidden while teams are locked"
        notes={<>
          <li><b>A:</b> Share is always there. A friend can get the code now and use it when the next season opens (renewal, before its draft).</li>
          <li><b>B:</b> while teams are locked (from an hour before the draft until the season ends), the code still shows but Share is hidden; it comes back at renewal and before the draft, when a code can actually be used. No new words either way.</li>
        </>}
        rec="B. A Share that sends a code nobody can use yet invites a confused friend; the code itself stays visible for anyone who wants it."
        frame={(opt, t) => <SettingsSheet t={t} share={opt === 'A'} />}
      />
    );
  }
  window.KSDirections = () => null; // nothing waiting on Giorgio (2026-10-13)
  window.KSShareLockedArchived = (decided, note) => () => <CallShareLocked archived decided={decided} decidedNote={note} />;
  window.KSDraftAutoArchived = () => <CallAuto archived />;
  window.KSMxCalls = {
    order: () => <CallOrder archived />,
    empty: () => <CallEmpty archived />,
    bye: () => <CallBye archived />,
    withheld: () => <CallWithheld archived />,
  };
  window.KSGameNight = GameNight;
  window.KSShadingArchived = () => <Amended.Provider value={false}><ShadingCall archived /></Amended.Provider>;
  window.KSRedesignAnswers = RedesignAnswers;
  window.KSDirectionsArchived = () => <Amended.Provider value={false}><Directions archived /></Amended.Provider>;
  window.KSRowOrder = () => <Amended.Provider value={false}><RowOrder /></Amended.Provider>;
})();
