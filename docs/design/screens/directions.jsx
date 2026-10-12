// Your call: direction (W1 of docs/plans/2026-10-12-visual-language-reset.md).
// Design Lead, 2026-10-12. Three directions for the app's visual language, Dark first:
//   A · Game Night (primary: Sleeper)   B · Broadcast (primary: ESPN)   C · Terminal (primary: Robinhood)
// Same structure (the calm-Home ruling, the UX rules, Giorgio's Matchup ruling), same copy,
// same data (data.js). Only the skin changes. Each direction is ONE token block in
// directions.css; every colour here is a role (var(--c-*) / var(--d-*)), never a literal.
// The studied DNA behind the values: docs/design/design.md.

(function () {
  const { useState, useLayoutEffect, useRef } = React;
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
  function Pair({ refId, trait, caption, note, children }) {
    return (
      <figure className="dr-pair" style={{ margin: 0 }}>
        <RefImg id={refId} trait={trait} />
        <Fit>{children}</Fit>
        <figcaption><b>{caption}</b> {note}</figcaption>
      </figure>
    );
  }

  // ── Shared frame pieces ───────────────────────────────────────────────
  function Phone({ d, tab, label, money, children }) {
    return (
      <div className={`dr dir-${d}`}>
        <Device tab={tab} label={label} style={money ? { background: 'var(--d-money-bg)' } : undefined}>{children}</Device>
      </div>
    );
  }
  const Av = ({ init, you, size = 36 }) => (
    <span className={you ? 'dr-av dr-av--you' : 'dr-av'} style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}>{init}</span>
  );
  function Head({ chip }) {
    return (
      <div className="ks-head" style={{ paddingInline: G }}>
        <span className="ks-pill"><span>{K.LEAGUE.name}</span><span className="ks-pill__more">+{K.OTHER_LEAGUES.length}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
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
        <div style={{ margin: `0 -${G}px`, padding: `14px ${G}px 14px`, background: 'var(--d-band)', color: 'var(--d-on-band)', display: 'grid', gap: 10 }}>
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
  function HomeFrame({ d }) {
    return (
      <Phone d={d} tab="home" label={`Home in season, direction ${d.toUpperCase()}`}>
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

  function Scoreboard({ d, final }) {
    const s = final ? K.MATCHUP.final : K.MATCHUP.live;
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
            <Av init={you ? 'RB' : 'GB'} you={you} size={d === 'b' ? 40 : 44} />
            <span className="dr-call" style={{ fontWeight: you ? 800 : 600, fontSize: 15, color: d === 'b' ? 'var(--d-on-band)' : undefined }}>{you ? 'Roberto B.' : 'Gianluigi B.'}</span>
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
        <div style={{ margin: `0 -${G}px`, color: 'var(--d-on-band)' }}>
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
  function Roster({ d, final, order = 'gain', mid = 'none', limit }) {
    const ps = pairs(final, order).slice(0, limit || 6);
    const midCol = mid === 'none' ? (d === 'b' ? '4px' : '10px') : 'auto';
    return (
      <div style={{ display: 'grid', gap: d === 'b' ? 4 : d === 'a' ? 6 : 4, background: d === 'b' ? 'var(--d-gutter)' : undefined, margin: d === 'b' ? `0 -${G}px` : 0, padding: d === 'b' ? '4px 4px' : 0 }}>
        {d === 'b' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', padding: '6px 8px 2px' }} className="dr-tag">
            <span style={{ color: 'var(--c-you-text)' }}>Roberto B.</span><span className="dr-muted">Week 6</span><span style={{ textAlign: 'right' }} className="dr-muted">Gianluigi B.</span>
          </div>
        ) : null}
        {ps.map(([a, b], i) => (
          <div key={a.t} style={{ display: 'grid', gridTemplateColumns: `minmax(0,1fr) ${midCol} minmax(0,1fr)`, gap: d === 'b' && mid === 'none' ? 0 : 6, alignItems: 'stretch' }}>
            <Half d={d} r={a} final={final} lit={a.weekGain > b.weekGain} />
            <Mid d={d} mid={mid} r={a} i={i} />
            <Half d={d} r={b} final={final} mirror lit={b.weekGain > a.weekGain} />
          </div>
        ))}
      </div>
    );
  }
  function MatchupFrame({ d, final }) {
    return (
      <Phone d={d} tab="matchup" label={`Matchup ${final ? 'final' : 'live'}, direction ${d.toUpperCase()}`}>
        <Head chip={final ? <FinalChip /> : <LiveChip />} />
        <Body gap={d === 'b' ? 0 : 18}>
          <div className="dr-seg" style={{ marginBottom: d === 'b' ? 14 : 0 }}><span className="on">My matchup</span><span>All matchups</span></div>
          <Scoreboard d={d} final={final} />
          <Roster d={d} final={final} />
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
          <div key={n} style={{ ...base, background: d === 'a' ? 'var(--d-clock-cell)' : d === 'b' ? 'var(--d-band)' : 'var(--c-bg)', boxShadow: 'inset 0 0 0 2px var(--c-live)' }}>
            <span className="dr-num" style={{ fontSize: 11, fontWeight: 800, color: 'var(--c-live-text)' }}>{n}</span>
            <span className="dr-num" style={{ fontSize: 13, fontWeight: 900, color: 'var(--c-text)' }}>0:{String(D.secondsLeft).padStart(2, '0')}</span>
          </div>
        );
      }
      if (!t) return <div key={n} style={{ ...base, background: d === 'c' ? 'transparent' : 'var(--c-sunken)', boxShadow: d === 'c' ? 'inset 0 0 0 1px var(--c-line)' : undefined }}><span className="dr-num dr-muted" style={{ fontSize: 11, fontWeight: 700 }}>{n}</span></div>;
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
  function DraftFrame({ d }) {
    return (
      <Phone d={d} tab="league" label={`Draft room on the clock, direction ${d.toUpperCase()}`}>
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
  function StandingsFrame({ d }) {
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
      <Phone d={d} tab="league" label={`League standings, direction ${d.toUpperCase()}`}>
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
  function PortfolioFrame({ d }) {
    const size = { a: 44, b: 48, c: 44 }[d];
    const weight = d === 'b' ? 900 : 500;
    const series = H.series.map((g) => K.LEAGUE.slots * K.LEAGUE.notionalPerSlot + g);
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
          <Spark pts={[r.mon, r.prev, r.thu]} color={toneVar(r.thu - r.mon)} w={52} h={22} />
          <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
            <b className="dr-num" style={{ fontSize: 15 }}>{$(r.value)}</b>
            <span className={`dr-cap dr-num ${tone(r.todayPct)}`} style={{ fontWeight: 700 }}>{pct(r.todayPct)}</span>
          </span>
        </div>
      );
    };
    return (
      <Phone d={d} tab="portfolio" money label={`Portfolio, direction ${d.toUpperCase()}`}>
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
        <div className={`dir-${dir.id} dr-swatches`} style={{ background: 'var(--c-bg)', padding: 10, borderRadius: 12 }}>
          {dir.sw.map(([v, l]) => <SW key={v} v={v} label={<span style={{ color: 'var(--c-text-2)' }}>{l}</span>} />)}
        </div>
        <ul className="dr-motion">{dir.motion.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul>
        <p className="dr-crit"><b>Self-critique</b> (1–5, revise under 3): {dir.crit}. <b>hallmark audit</b>, after fixes: {dir.audit}. Punch list: reviews/hallmark-audit-w1.md.</p>
        <div className="dr-pairs">
          <Pair refId={r.home[0]} trait={r.home[1]} caption={`${dir.id.toUpperCase()} · Home, in season`} note="The calm-Home structure as decided: the hero, its chart with the W/L marks, This week, Standings. Same copy, same numbers."><HomeFrame d={dir.id} /></Pair>
          <Pair refId={r.match[0]} trait={r.match[1]} caption={`${dir.id.toUpperCase()} · Matchup, live`} note="The scoreboard (names, the two totals, who leads), then your stocks against theirs, row by row, best week first on each side. Nothing else."><MatchupFrame d={dir.id} /></Pair>
          <Pair refId="v110" trait="What the last one got right: the leader's half lit, the rows mirrored." caption={`${dir.id.toUpperCase()} · Matchup, final`} note={'Friday close: "Final", "Roberto B. won by …", the same rows at the close.'}><MatchupFrame d={dir.id} final /></Pair>
          <Pair refId={r.draft[0]} trait={r.draft[1]} caption={`${dir.id.toUpperCase()} · Draft room, on the clock`} note="Round 2, pick 11, 0:42. Tile colour = sector (sample; see below)."><DraftFrame d={dir.id} /></Pair>
          <Pair refId={r.stand[0]} trait={r.stand[1]} caption={`${dir.id.toUpperCase()} · League › Standings, in full`} note="After Week 6's Friday close: the movement, the avatars, your row. No grid lines."><StandingsFrame d={dir.id} /></Pair>
          <Pair refId={r.money[0]} trait={r.money[1]} caption={`${dir.id.toUpperCase()} · Portfolio`} note={<>The number, its line, the range, two holdings with sparklines and a sector pill. The chart and the range pills are new on Portfolio<NEW />.</>}><PortfolioFrame d={dir.id} /></Pair>
        </div>
      </>
    );
  }

  /** A compact roster for the "Your call" strips (direction A's skin). */
  function MiniRoster({ order = 'gain', mid = 'none', label }) {
    return (
      <div className="dr dir-a" style={{ background: 'var(--c-bg)', borderRadius: 20, padding: '14px 20px', overflow: 'hidden', color: 'var(--c-text)' }} role="img" aria-label={label}>
        <Roster d="a" order={order} mid={mid} limit={4} />
      </div>
    );
  }

  function Directions() {
    return (
      <section className="b-sec" id="call-direction" aria-labelledby="call-direction-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.3</span>
          <div>
            <h2 id="call-direction-h">Your call: the direction</h2>
            <p className="b-job"><b>Giorgio, 2026-10-12:</b> "everything I'm seeing is just so bland. It's not creative. It's not inspiring." "I want to create a, a kind of a, a blend between a, a, a sleeper and ESPN fantasy football with a Robin Hood". "I want every section to, in its own way, elevate the, the app". Three directions, each led by ONE of your references, drawn on the same league at the same moment (Stock Scudetto, Week 6, Thu 1:37 PM ET, Roberto B.'s phone), Dark first. Each frame sits beside the reference it borrows from, with the trait named. Pick the one that makes you go "wow"; Light follows from the same roles.</p>
          </div>
        </header>

        <ul className="b-inv__notes">
          <li><b>The same in all three:</b> what is on each screen and in what order (the calm Home, the UX rules), every string (all of it already in the app, except where marked <NEW />), and every number (derived from the board's data). Only the skin changes: surfaces, colour, type weight, how rows divide, the chart.</li>
          <li><b>Matchup is your ruling, literally:</b> a scoreboard (names, the two totals, who leads), then your stocks against theirs, row by row, each with its week. No win %, no bars, no projections, no chart, no "yet to play", nothing else, in any direction. The existing My matchup / All matchups switch stays (it isn't page content).</li>
          <li><b>Sample, not data:</b> the sector of each stock (the tile colours and the pill) and the league colour in B. This league has no tiers or categories, so the pill shows what a category league would draw.</li>
          <li><b>Dark only, for now:</b> these frames stay Dark whichever theme the board is in. Light is drawn after you pick, from the same roles.</li>
          <li><b>Every chart has a state for 0 and 1 points:</b> the line stops at the last real point and ends in a dot (Robinhood's "stops at now"), so Monday morning is a short line, never a blank frame.</li>
        </ul>

        {DIRS.map((dir) => <Direction key={dir.id} dir={dir} />)}

        <h3 className="b-sub" id="call-direction-compare">Matchup, side by side, with 1.1.0</h3>
        <div className="b-concepts b-concepts--three">
          {['a', 'b', 'c'].map((d) => (
            <figure key={d} className="b-fig b-fig--inv"><Fit><MatchupFrame d={d} /></Fit><figcaption><b>{d.toUpperCase()} · live</b></figcaption></figure>
          ))}
          <figure className="b-fig b-fig--inv">
            <div className="b-fit" style={{ maxWidth: 402 }}><img src={REF.v110 && REF.v110.src} alt="Stockpile 1.1.0, matchup screen (Light, a test league)" style={{ width: '100%', borderRadius: 40, display: 'block' }} /></div>
            <figcaption><b>1.1.0 · the look you said captured the head-to-head better</b><span>Light, a test league (2026-09-25). The leader's half of the scoreboard is lit with "Leading"; the roster is two mirrored columns with a numbered centre column, the leader's column lit, a total at the foot. All three directions keep the lit half and the mirror.</span></figcaption>
          </figure>
        </div>

        <h3 className="b-sub">Your call, later: the order of the rows</h3>
        <div className="dr-strip">
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster order="gain" label="Rows by week gain" /><figcaption><b>a · By week gain, best first on each side (recommended, drawn above)</b><span>The top of the page is the story of the week. It is also (d) "your best against their best": each row is a mini-matchup.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster order="pick" label="Rows in draft order" /><figcaption><b>b · Draft order</b><span>Your first pick at the top, the roster as drafted. Never moves.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster order="value" label="Rows by position size" /><figcaption><b>c · By position size</b><span>Your largest holding first. Moves only when prices move a lot.</span></figcaption></figure>
        </div>
        <ul className="b-inv__notes">
          <li><b>A clash to settle with it:</b> the plan says rows never re-sort live and "the order is fixed at the Monday open". At the Monday open every week gain is $0.00, so (a) has nothing to sort by. Proposal: under (a), rows re-order at each market close (never while the market is open), and Monday uses the order at Friday's close. (b) and (c) don't have the problem.</li>
        </ul>

        <h3 className="b-sub">Your call, later: the centre column</h3>
        <div className="dr-strip">
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster mid="none" label="Centre column empty" /><figcaption><b>Empty (recommended, drawn above)</b><span>The two numbers face each other across a gap. Nothing to explain.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster mid="cat" label="Centre column with the sector pill" /><figcaption><b>The tier or category pill</b><span>Sleeper's position pill, as a price tier ("$100–$200") or category ("Tech") in leagues that have them; empty in leagues that don't. A pill in the centre names the ROW's slot, so it only reads right if rows pair slot against slot (Tech vs Tech), which settles the row order too. Sector colours here are sample.</span></figcaption></figure>
          <figure className="b-fig b-fig--inv" style={{ margin: 0 }}><MiniRoster mid="num" label="Centre column with row numbers" /><figcaption><b>Row number, as 1.1.0 had it</b><span>1 to 6. Honest, but it reads like a position, which your ruling rules out.</span></figcaption></figure>
        </div>

        <div className="b-ask">
          <h3>The Design Lead's recommendation: A · Game Night</h3>
          <ul>
            <li><b>Why A:</b> it is the only one that looks like a fantasy app first. The lit half and the mirrored rows are 1.1.0's head-to-head, made bigger; the navy steps, the cyan and the colour tiles are Sleeper's game night; and the money screens still go Robinhood (near-black, the number and its line), so the bridge you asked for is built into the system, not bolted on.</li>
            <li><b>Why not B:</b> it is the loudest scoreboard, but it needs a league colour the product doesn't have (who picks it, and what it is in Light, would be new decisions), and its panels make every screen denser. It is also the closest to 1.2.0's Game Day idea, which is the look you called bland.</li>
            <li><b>Why not C:</b> it is the cleanest and the best money screen, but the game screens read as a brokerage. The fantasy feeling you asked for lives only in the type.</li>
            <li><b>What A costs:</b> the your-turn flash changes from gold to cyan (an approved look, so it is part of this pick); the Matchup's lit slab and the colour tiles are new components; the money screens use a second, darker page colour.</li>
            <li><b>When you pick:</b> say which, and anything to take from the others (for example "A, with C's portfolio"). Light comes next from the same roles, then the token spec, then the build (Home first). Two questions ride along for later: the row order and the centre column (above).</li>
          </ul>
        </div>
      </section>
    );
  }

  window.KSDirections = Directions;
})();
