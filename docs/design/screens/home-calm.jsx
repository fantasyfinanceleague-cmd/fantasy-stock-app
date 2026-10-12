// Your call: a calmer Home (Design Lead, 2026-10-12).
// Giorgio on 1.2.0 (TestFlight build 4), verbatim: "this UI on the home screen is awful.
// section bubbles are touching, it feels clunky, and there is too much going on".
// The touching sections were a bug (fixed by PR #217). This section answers the rest:
// "clunky" and "too much going on". Same league, same moment, same numbers as the key
// screens (data.js). Every frame is FULL LENGTH, with a dashed line where the first
// screen ends (above the tab bar on a 402×874 phone).

(function () {
  const { useState, useLayoutEffect, useRef } = React;
  const K = window.KS;
  const { Device, Chip, Icon, ICON, Tug, SD, margin, $, $s, pct, tone } = window.KSKit;

  const GUTTER = 20; // the app's screen gutter (space[6])
  const FOLD = 874 - 83; // the first screen ends where the tab bar starts

  // ── Frame helpers ────────────────────────────────────────────────────
  /** Scales a full-length phone to its column, measuring its real height. */
  function FitFull({ caption, note, children }) {
    const box = useRef(null);
    const inner = useRef(null);
    const [k, setK] = useState(0.7);
    const [h, setH] = useState(874);
    useLayoutEffect(() => {
      const ro = new ResizeObserver(() => {
        setK(Math.min(1, box.current.clientWidth / 402));
        setH(inner.current.firstChild ? inner.current.firstChild.offsetHeight : 874);
      });
      ro.observe(box.current);
      ro.observe(inner.current);
      return () => ro.disconnect();
    }, []);
    return (
      <figure className="b-fig b-fig--inv">
        <div className="b-fit" ref={box} style={{ height: h * k, maxWidth: 402 }}>
          <div className="b-fit__in" ref={inner} style={{ transform: `scale(${k})`, width: 402, borderRadius: 56 }}>{children}</div>
        </div>
        {caption ? <figcaption><b>{caption}</b>{note ? <span>{note}</span> : null}</figcaption> : null}
      </figure>
    );
  }

  /** The dashed "first screen ends here" marker, drawn over a full-length device. */
  const Fold = () => (
    <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: FOLD, zIndex: 7, borderTop: '2px dashed var(--c-warn-text)', pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', right: 14, top: -22, fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--c-warn-text)', background: 'var(--c-bg)', padding: '2px 6px', borderRadius: 6 }}>First screen ends</span>
    </div>
  );

  const Pill = () => (
    <span className="ks-pill"><span>{K.LEAGUE.name}</span><span className="ks-pill__more">+{K.OTHER_LEAGUES.length}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
  );
  const Head = () => (
    <div className="ks-head" style={{ paddingInline: GUTTER }}>
      <Pill />
      <span className="ks-avatar">RB</span>
    </div>
  );
  const Phone = ({ label, gap = 24, children, tab = 'home', head }) => (
    <Device full tab={tab} label={label} overlay={<Fold />}>
      {head || <Head />}
      <div style={{ padding: `0 ${GUTTER}px`, display: 'flex', flexDirection: 'column', gap, paddingBottom: 24 }}>{children}</div>
    </Device>
  );
  const Card = ({ children, pad = 16, style }) => (
    <div className="ks-card" style={{ padding: pad, display: 'grid', gap: 12, ...style }}>{children}</div>
  );
  const Chev = () => <span className="ks-muted" style={{ display: 'inline-flex' }} aria-label="Opens"><Icon d={ICON.right} size={16} width={2.4} /></span>;
  const NewTag = () => <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', background: 'var(--c-warn-tint)', color: 'var(--c-warn-text)', border: '1px solid var(--c-warn-line)', verticalAlign: 2 }}>NEW</span>;

  // ── The season chart, with the result marks on the axis (A) or plain ticks (today) ──
  const RESULTS = [...K.HOME.weekResults.map((w) => w.result), 'live'];
  function SeasonLine({ h = 148, w = 362, marks = false }) {
    const series = K.HOME.series;
    const starts = K.HOME.weekStarts;
    const pad = { t: 10, b: marks ? 26 : 22 };
    const min = Math.min(0, ...series), max = Math.max(0, ...series);
    const X = (i) => (i / (series.length - 1)) * (w - 8) + 2;
    const Y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (h - pad.t - pad.b);
    const d = series.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const area = `${d} L${X(series.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z`;
    const z = Y(0);
    const end = series[series.length - 1];
    // A week's mark sits under the middle of its span; the live week under its last point.
    const spans = starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : series.length - 1]);
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`Season gain: ${$s(end)}`} style={{ display: 'block', overflow: 'visible' }}>
        <path d={area} fill="var(--c-gain)" opacity=".1" />
        <line x1="0" x2={w} y1={z} y2={z} stroke="var(--c-border-strong)" strokeDasharray="3 4" />
        <path d={d} fill="none" stroke="var(--c-gain)" strokeWidth="2.25" strokeLinejoin="round" />
        <circle cx={X(series.length - 1)} cy={Y(end)} r="4.5" fill="var(--c-live)" stroke="var(--c-surface)" strokeWidth="2" />
        <text x="2" y={z - 6} fontSize="11" fontWeight="600" fill="var(--c-text-2)">$0</text>
        {starts.map((s) => <line key={s} x1={X(s)} x2={X(s)} y1={h - pad.b + 2} y2={h - pad.b + 6} stroke="var(--c-border-strong)" />)}
        {marks ? spans.map(([a, b], k) => {
          const r = RESULTS[k];
          const cx = r === 'live' ? X(series.length - 1) - 4 : (X(a) + X(b)) / 2;
          if (r === 'live') return <circle key={k} cx={cx} cy={h - 7} r="3.5" fill="var(--c-live)" />;
          return <text key={k} x={cx} y={h - 3} textAnchor="middle" fontSize="12" fontWeight="800" fill={r === 'W' ? 'var(--c-gain)' : r === 'L' ? 'var(--c-loss)' : 'var(--c-text-2)'}>{r}</text>;
        }) : null}
      </svg>
    );
  }

  // ── Shared blocks ─────────────────────────────────────────────────────
  const L = K.MATCHUP.live;
  const H = K.HOME;
  const near = K.STANDINGS_BEFORE.slice(0, 3);

  function HeroText({ meta = `2nd of 6 · ${H.record} · Week ${K.LEAGUE.week} of ${K.LEAGUE.weeks}` }) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="ks-caption">Your team</span>
          <span className="ks-caption ks-num">{meta}</span>
        </div>
        <div className="ks-score ks-num" style={{ fontSize: 48, lineHeight: '50px', fontStretch: '75%' }}>{$(H.value)}</div>
        <div className="ks-callout ks-num" style={{ fontWeight: 700 }}>
          <span className="ks-gain">{$s(H.gain)} · {pct(H.gainPct)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>season gain</span>
          <span className="ks-muted" style={{ fontWeight: 500 }}> · </span>
          <span className="ks-gain">{$s(H.today)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>today</span>
        </div>
      </div>
    );
  }

  /** The this-week scoreboard. `today` = 1.2.0 as built; otherwise the calmer card. */
  function WeekCard({ today }) {
    const y = SD(L.you), o = SD(L.opp);
    return (
      <div className="ks-game" style={{ padding: 16, display: 'grid', gap: today ? 10 : 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>This week</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Chip kind="live">{today ? `Week ${K.LEAGUE.week} · Live` : 'Live'}</Chip>
            {today ? null : <Chev />}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-callout">
          <span style={{ color: 'var(--c-you-text)', fontWeight: 700 }}>You</span>
          <span className="ks-muted">vs Gianluigi B.</span>
        </div>
        <div className="ks-scorerow">
          {[[y.primary, 'var(--c-you-text)'], [o.primary, 'var(--c-opp-text, var(--c-opp))']].map(([v, c], i) => (
            <div key={i}><span className="ks-score ks-num" style={{ fontSize: today ? 40 : 28, lineHeight: today ? '38px' : '28px', color: c }}>{v}</span></div>
          ))}
        </div>
        <Tug you={y.value} opp={o.value} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-caption">
          <span style={{ color: 'var(--c-text)' }}>You lead by <b className="ks-num">{margin(L.you, L.opp)}</b></span>
          <span className="ks-muted">Ends Fri 4:00 PM ET</span>
        </div>
      </div>
    );
  }

  function StandingsCard({ today }) {
    return (
      <Card pad={today ? 20 : 16}>
        <div className="ks-section-h" style={{ margin: 0 }}>
          <h3>Standings</h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="ks-caption">Through Week 5</span>{today ? null : <Chev />}</span>
        </div>
        <ul className="ks-rows">
          {near.map((r) => (
            <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto auto', padding: '9px 6px', background: r.you ? 'var(--c-you-tint)' : undefined, borderTop: 0 }}>
              <span className="ks-callout ks-num ks-muted">{r.rank}</span>
              <span className="ks-callout" style={{ fontWeight: r.you ? 700 : 500 }}>{r.name}</span>
              <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
              <span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 78, textAlign: 'right' }}>{$s(r.pf)}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const Seg = ({ on = 'Season' }) => (
    <div className="ks-seg">{['1W', '1M', 'Season'].map((s) => <span key={s} className={s === on ? 'on' : undefined}>{s}</span>)}</div>
  );
  const RangeText = ({ on = 'Season' }) => (
    <div style={{ display: 'flex', gap: 18, justifyContent: 'flex-end' }}>
      {['1W', '1M', 'Season'].map((s) => (
        <span key={s} className="ks-callout" style={{ fontWeight: s === on ? 800 : 600, color: s === on ? 'var(--c-text)' : 'var(--c-text-2)', borderBottom: s === on ? '2px solid var(--c-text)' : '2px solid transparent', paddingBottom: 2 }}>{s}</span>
      ))}
    </div>
  );

  // ── In season: today, A, B ────────────────────────────────────────────
  /** 1.2.0 as built (with PR #217's gap): hero, This week, Season, Standings. */
  function Today() {
    return (
      <Phone label="Home today, in season" gap={20}>
        <HeroText />
        <WeekCard today />
        <Card pad={16} style={{ gap: 8 }}>
          <div style={{ padding: '0 4px', display: 'grid', gap: 2 }}><h3 className="ks-title" style={{ fontSize: 17, lineHeight: '22px' }}>Season</h3><span className="ks-caption">Season gain, week by week</span></div>
          <SeasonLine w={328} h={148} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0', margin: '0 -4px' }}>
            {H.weekResults.map((w) => (
              <span key={w.week} className="ks-chip ks-chip--money ks-num" style={{ textTransform: 'none', letterSpacing: 0, fontStretch: '100%', fontSize: 12, height: 26, padding: '0 7px' }}>
                <b style={{ color: w.result === 'W' ? 'var(--c-gain)' : 'var(--c-loss)' }}>{w.result}</b>&nbsp;W{w.week}
              </span>
            ))}
            <span className="ks-chip ks-chip--money" style={{ textTransform: 'none', letterSpacing: 0, fontStretch: '100%', fontSize: 12, height: 26, gap: 4, padding: '0 7px' }}><span className="ks-dot" />W6</span>
          </div>
          <Seg />
        </Card>
        <StandingsCard today />
      </Phone>
    );
  }

  /** A: the same content, calmer. The chart joins the hero (no card), one big number. */
  function OptionA() {
    return (
      <Phone label="Home, option A: same content, calmer">
        <div style={{ display: 'grid', gap: 10 }}>
          <HeroText />
          <SeasonLine w={362} h={124} marks />
          <RangeText />
        </div>
        <WeekCard />
        <StandingsCard />
      </Phone>
    );
  }

  /** B: fewer things. The chart and the week-by-week results move to League › Standings. */
  function OptionB() {
    return (
      <Phone label="Home, option B: fewer things on Home">
        <HeroText />
        <WeekCard />
        <StandingsCard />
      </Phone>
    );
  }

  /** B's other half: League › Standings gets the season chart on top. */
  function OptionBLeague() {
    return (
      <Phone label="League tab under option B" tab="league" head={
        <div className="ks-head" style={{ paddingInline: GUTTER }}><Pill /><span className="ks-avatar">RB</span></div>
      }>
        <div className="ks-seg"><span className="on">Standings</span><span>Schedule</span><span>Playoffs</span><span>History</span></div>
        <Card pad={16} style={{ gap: 8 }}>
          <div className="ks-section-h" style={{ margin: 0 }}><h3>Season</h3><span className="ks-caption">Season gain, week by week</span></div>
          <SeasonLine w={328} h={124} marks />
          <RangeText />
        </Card>
        <Card pad={16}>
          <ul className="ks-rows">
            {K.STANDINGS_BEFORE.map((r) => (
              <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto auto', padding: '10px 6px', background: r.you ? 'var(--c-you-tint)' : undefined }}>
                <span className="ks-callout ks-num ks-muted">{r.rank}</span>
                <span className="ks-callout" style={{ fontWeight: r.you ? 700 : 500 }}>{r.name}</span>
                <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
                <span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 78, textAlign: 'right' }}>{$s(r.pf)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Phone>
    );
  }

  // ── Before the draft ──────────────────────────────────────────────────
  const MEMBERS = ['RB', 'PM', 'GB', 'LV', 'CR', 'MT'];
  function MembersCard() {
    return (
      <Card pad={16}>
        <div className="ks-section-h" style={{ margin: 0 }}><h3>Members</h3><span className="ks-caption ks-num">6 of 6 joined</span></div>
        <div style={{ display: 'flex', gap: 6 }}>{MEMBERS.map((m, i) => <span key={m} className={i === 0 ? 'ks-avatar' : 'ks-avatar ks-avatar--neutral'}>{m}</span>)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'var(--c-sunken)' }}>
          <span><span className="ks-caption">Invite code</span><br /><b className="ks-num" style={{ letterSpacing: '0.12em' }}>SCUD26</b></span>
          <span className="ks-btn ks-btn--secondary" style={{ height: 36, padding: '0 16px', fontSize: 15 }}>Share</span>
        </div>
      </Card>
    );
  }
  function PreDraftToday() {
    return (
      <Phone label="Home today, before the draft" gap={20}>
        <div className="ks-game" style={{ padding: 20, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Draft</span>
            <span className="ks-chip">Pre-draft</span>
          </div>
          <span className="ks-title">Sat, Oct 3 · 7:00 PM ET</span>
          <span className="ks-score ks-num" style={{ fontSize: 40, lineHeight: '38px' }}>3d 04h 12m</span>
          <span className="ks-callout ks-muted">60-second picks · 6 rounds</span>
          <span className="ks-callout" style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span className="ks-dot" style={{ transform: 'translateY(-1px)' }} />The draft room opens Sat 6:00 PM ET, when the order is set.</span>
          <span className="ks-btn">Build your queue</span>
        </div>
        <MembersCard />
        <Card pad={20}><span className="ks-callout ks-muted">No buying before the draft. Your team is set at the draft.</span></Card>
      </Phone>
    );
  }
  function PreDraftCalm() {
    return (
      <Phone label="Home calmer, before the draft">
        <div className="ks-game" style={{ padding: 20, display: 'grid', gap: 6 }}>
          <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Draft</span>
          <span className="ks-score ks-num" style={{ fontSize: 48, lineHeight: '48px', fontStretch: '75%' }}>3d 04h 12m</span>
          <span className="ks-callout" style={{ fontWeight: 700 }}>Sat, Oct 3 · 7:00 PM ET</span>
          <span className="ks-callout ks-muted">60-second picks · 6 rounds</span>
          <span className="ks-callout ks-muted">The draft room opens Sat 6:00 PM ET, when the order is set.</span>
          <span className="ks-btn" style={{ marginTop: 10 }}>Build your queue</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>No buying before the draft. Your team is set at the draft.</span>
        </div>
        <MembersCard />
      </Phone>
    );
  }

  // ── Season over ───────────────────────────────────────────────────────
  const TROPHY = ICON.league;
  const Stats = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 14 }} className="ks-num">
      <span><span className="ks-caption">Season gain</span><br /><b className="ks-gain">+$481.78</b></span>
      <span><span className="ks-caption">Best week</span><br /><b>Week 6 · <span className="ks-gain">+$351.79</span></b></span>
      <span><span className="ks-caption">Regular season</span><br /><b>2nd of 6 · 5–1</b></span>
      <span><span className="ks-caption">Playoffs</span><br /><b>2–0 · won the Final</b></span>
    </div>
  );
  const Medallion = ({ size = 72 }) => (
    <span style={{ width: size, height: size, borderRadius: size / 2, display: 'grid', placeItems: 'center', background: 'var(--c-live)', color: 'var(--c-surface)' }}><Icon d={TROPHY} size={size / 2} width={2.2} /></span>
  );
  const RunItBack = () => (
    <Card pad={16}>
      <span className="ks-tag">Season 2</span>
      <span style={{ fontSize: 17, fontWeight: 700 }}>Run it back?</span>
      <span className="ks-callout ks-muted">Everyone from Season 1 gets asked if they're in. Once you've heard from everyone, you set up the draft.</span>
      <span className="ks-btn">Run it back</span>
    </Card>
  );
  function CompleteToday() {
    return (
      <Phone label="Home today, season complete (commissioner)" gap={20}>
        <div className="ks-game" style={{ padding: 20, display: 'grid', justifyItems: 'center', gap: 8, textAlign: 'center', background: 'radial-gradient(120% 90% at 50% 0%, var(--c-live-glow) 0%, var(--c-surface) 70%)' }}>
          <Medallion />
          <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season complete</span>
          <span className="ks-score" style={{ fontSize: 44, lineHeight: '44px' }}>Champion</span>
          <span className="ks-callout">You won {K.LEAGUE.name}</span>
        </div>
        <Card pad={20}><Stats /></Card>
        <span className="ks-btn">See the final standings</span>
        <RunItBack />
      </Phone>
    );
  }
  /** The member's ask (RenewalAsk): every string is the app's own. */
  const Ask = () => (
    <Card pad={16}>
      <span className="ks-tag">Season 2</span>
      <span style={{ fontSize: 17, fontWeight: 700 }}>Paolo M. is running it back. Are you in?</span>
      <span className="ks-callout ks-muted">Same league, new season. The draft is set once everyone has replied.</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <span className="ks-btn ks-btn--secondary">I'm out</span>
        <span className="ks-btn">I'm in</span>
      </div>
      <span className="ks-caption">You can change your answer until the draft is set.</span>
    </Card>
  );
  /** A: the medal and the season's numbers are one card; the standings link is a row in it. */
  function CompleteA({ member }) {
    return (
      <Phone label={`Home option A, season complete (${member ? 'member' : 'commissioner'})`}>
        <div className="ks-game" style={{ padding: 20, display: 'grid', gap: 16, background: 'radial-gradient(120% 70% at 50% 0%, var(--c-live-glow) 0%, var(--c-surface) 60%)' }}>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 6, textAlign: 'center' }}>
            <Medallion size={60} />
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season complete</span>
            <span className="ks-score" style={{ fontSize: 44, lineHeight: '44px' }}>Champion</span>
            <span className="ks-callout">You won {K.LEAGUE.name}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--c-line)', paddingTop: 14 }}><Stats /></div>
          <span className="ks-callout" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--c-line)', paddingTop: 12, fontWeight: 700 }}>See the final standings <Chev /></span>
        </div>
        {member ? <Ask /> : <RunItBack />}
      </Phone>
    );
  }
  /** B: the result is one tappable line; the action leads. The four tiles move to the final standings. */
  function CompleteB({ member }) {
    return (
      <Phone label={`Home option B, season complete (${member ? 'member' : 'commissioner'})`}>
        <div className="ks-game" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 14, background: 'radial-gradient(140% 120% at 0% 0%, var(--c-live-glow) 0%, var(--c-surface) 70%)' }}>
          <Medallion size={52} />
          <span style={{ display: 'grid', gap: 2 }}>
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season complete</span>
            <span className="ks-score" style={{ fontSize: 30, lineHeight: '30px' }}>Champion</span>
            <span className="ks-caption">You won {K.LEAGUE.name}</span>
          </span>
          <Chev />
        </div>
        {member ? <Ask /> : <RunItBack />}
      </Phone>
    );
  }
  /** B's other half: the four tiles sit on top of the final standings (League). */
  function CompleteBLeague() {
    return (
      <Phone label="Final standings under option B" tab="league">
        <Card pad={16}><Stats /></Card>
        <Card pad={16}>
          <div className="ks-section-h" style={{ margin: 0 }}><h3>Final standings</h3></div>
          <ul className="ks-rows">
            {[['1', 'Roberto B.', '5–1', 'Champion', true], ['2', 'Paolo M.', '6–0', 'Runner-up'], ['3', 'Luca V.', '4–2', ''], ['4', 'Gianluigi B.', '3–3', ''], ['5', 'Chiara R.', '2–4', ''], ['6', 'Matteo T.', '0–6', '']].map(([r, n, rec, medal, you]) => (
              <li key={r} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto auto', padding: '10px 6px', background: you ? 'var(--c-you-tint)' : undefined }}>
                <span className="ks-callout ks-num ks-muted">{r}</span>
                <span className="ks-callout" style={{ fontWeight: you ? 700 : 500 }}>{n}</span>
                <span className="ks-caption">{medal}</span>
                <span className="ks-callout ks-num ks-muted" style={{ minWidth: 40, textAlign: 'right' }}>{rec}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Phone>
    );
  }

  // ── The count (a visual, not a paragraph) ────────────────────────────
  const COUNT = [
    ['', 'Today (1.2.0)', 'A · calmer', 'B · fewer'],
    ['Blocks on Home', '4 (hero + 3 cards)', '3 (hero with its chart + 2 cards)', '3 (hero + 2 cards)'],
    ['Big condensed numbers', '3 (value 48, two scores 40)', '1 (value 48; scores 28)', '1 (value 48; scores 28)'],
    ['"Week 6" said', '3 times (meta, chip, W6 chip)', 'once (meta)', 'once (meta)'],
    ['Titles, tags and captions', '6', '3', '3'],
    ['Controls inside cards', 'segmented 1W/1M/Season', 'text tabs under the chart', 'none on Home'],
    ['Week results', '6 chips (wrap to a 2nd row in week 7+)', 'one mark per week on the axis, never wraps', 'on League, same marks'],
    ['Taps through', 'nothing on Home is tappable', 'This week → Matchup, Standings → League', 'same as A'],
    ['First screen shows', 'hero, This week, Season (Standings below the fold)', 'everything: hero + chart, This week, Standings', 'everything, with room to spare'],
  ];
  function CountTable() {
    return (
      <div style={{ overflowX: 'auto', margin: '6px 0 26px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <tbody>
            {COUNT.map((row, i) => (
              <tr key={i} style={{ borderTop: i ? '1px solid var(--c-border)' : 0 }}>
                {row.map((c, j) => {
                  const T = i === 0 || j === 0 ? 'th' : 'td';
                  return <T key={j} scope={i === 0 ? 'col' : j === 0 ? 'row' : undefined} style={{ textAlign: 'left', padding: '8px 14px 8px 0', fontWeight: i === 0 || j === 0 ? 800 : 500, color: j === 2 && i ? 'var(--c-text)' : 'var(--c-text-2)', verticalAlign: 'top', background: j === 2 && i ? 'var(--c-you-tint)' : undefined }}>{c}</T>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function HomeCalm() {
    return (
      <section className="b-sec" id="call-calm-home" aria-labelledby="call-calm-home-h">
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">1.2.1</span>
          <div>
            <h2 id="call-calm-home-h">Your call: a calmer Home</h2>
            <p className="b-job"><b>Giorgio on 1.2.0, 2026-10-12:</b> "this UI on the home screen is awful. section bubbles are touching, it feels clunky, and there is too much going on". The touching sections were a bug (the gap sat on a wrapper that held one child), fixed by PR #217 and drawn fixed below. The rest is design: four equal cards, three big numbers fighting for attention, the same facts said two or three times, a control inside a card, and nothing to tap. Stock Scudetto, Week 6, Thu 1:37 PM ET, Roberto B.'s phone. Every frame shows the whole scroll; the dashed line is where the first screen ends. Use the Theme switch for Dark.</p>
          </div>
        </header>

        <ul className="b-inv__notes">
          <li><b>What a player needs in the first three seconds</b>, mid-week: how is my team doing (the value, the season gain), and am I winning this week. Everything else (the season's shape, the table) is a second look.</li>
          <li><b>Both options keep your rules:</b> one league at a time with the pill; team value is the big number with "+$X · +Y% season gain · +$Z today" under it; dollars decide. <b>B reopens one:</b> "The Home chart plots season gain, week by week" (2026-09-29). Under B the chart moves to League.</li>
          <li><b>New behaviour in both:</b> the This week card opens Matchup, and the Standings card opens League › Standings (a chevron shows it). No new copy for that.</li>
          <li><b>New copy:</b> none in A or B. Every string is already in the app; A only drops repeats ("Week 6" in the chip; the "Season" title and its caption, since the hero line right above the chart already says "season gain"). The week chips become one W/L mark per week under the chart's axis; scrubbing still names the week.</li>
        </ul>

        <h3 className="b-sub">In season · today, A, B</h3>
        <CountTable />
        <div className="b-concepts b-concepts--three">
          <FitFull caption="Today · 1.2.0 with the gap fixed" note="Hero, This week, Season, Standings: four blocks of equal weight. Three condensed numbers (the value and two 40pt scores in blue and orange) compete for the eye. The Season card adds a title, a caption, a chart, six chips and a segmented control. Standings starts below the fold."><Today /></FitFull>
          <FitFull caption="★ A · Same content, calmer" note="The chart joins the hero, with no card, title or chips (the Robinhood pattern: the number, then its line). The week results are W/L marks on the axis, and the range is text tabs. The This week scores drop to 28pt, so the value is the one standout. Two quiet cards, both tappable. The gap is 24pt. It all fits on the first screen."><OptionA /></FitFull>
          <FitFull caption="B · Fewer things on Home" note="Hero, This week, Standings, and nothing else; it all fits on the first screen. The season chart and the week-by-week results move to League › Standings (next frame). The cards are the same as A's."><OptionB /></FitFull>
          <FitFull caption="B · where the chart goes: League › Standings" note="The same Season card as today's Home, above the table. Under B it's one tap from Home's Standings card."><OptionBLeague /></FitFull>
        </div>

        <h3 className="b-sub">Before the draft · calmer under A or B alike</h3>
        <div className="b-concepts b-concepts--three">
          <FitFull caption="Before the draft · today" note="Three cards. The tag and the chip both say draft; the date (title size) outranks the countdown's meaning; the no-buying note is a card of its own."><PreDraftToday /></FitFull>
          <FitFull caption="Before the draft · calmer" note={'Rule 6: the question is "when is the draft?", so the countdown is the big number and the date sits under it. The "Pre-draft" chip goes (the tag says Draft). The no-buying line moves under the button it explains. Two cards, no new copy.'}><PreDraftCalm /></FitFull>
        </div>

        <h3 className="b-sub">Season over, with Run it back · today, A, B</h3>
        <div className="b-concepts b-concepts--three">
          <FitFull caption="Today · commissioner" note="Four blocks and two filled primary buttons (See the final standings, Run it back); rule 2 allows one. The medal card and the tiles card say one thing in two cards."><CompleteToday /></FitFull>
          <FitFull caption="★ A · commissioner" note="The medal and the season's four numbers are one card; See the final standings is a row inside it. Run it back is the only primary. Two blocks."><CompleteA /></FitFull>
          <FitFull caption="★ A · member" note="Same card; the I'm in / I'm out ask (unchanged) in Run it back's place, with I'm in the one primary."><CompleteA member /></FitFull>
          <FitFull caption="B · commissioner" note="The result shrinks to one tappable line (it opens the final standings); the action leads. The four numbers move to the final standings (next frame)."><CompleteB /></FitFull>
          <FitFull caption="B · member" note="The same line, then the ask."><CompleteB member /></FitFull>
          <FitFull caption="B · where the numbers go: the final standings" note="Season gain, best week, regular season and playoffs above the medal-ordered table (League)."><CompleteBLeague /></FitFull>
        </div>

        <div className="b-ask">
          <h3>Design Lead recommends A</h3>
          <ul>
            <li><b>Why A:</b> what made 1.2.0 feel clunky was not how much Home knows; it was four cards of equal weight, three big numbers, every fact said twice, and a dashboard you can't tap. A fixes all of that and keeps the chart, which is your own call (D1) and the one thing on Home that tells the season's story. Merging it into the hero is how Robinhood does it: the number, then its line.</li>
            <li><b>Why not B (yet):</b> B is the calmest Home, but it reopens "The Home chart plots season gain, week by week", and it sends the season's shape to a tab you visit less. If A still feels busy on your phone, B is a one-step follow-up: the A cards are the same.</li>
            <li><b>What moves where under A:</b> Season card title and caption → removed (the hero line says "season gain"); the chart → under the hero, no card; the week chips → W/L marks on the chart's axis; the 1W/1M/Season control → text tabs under the chart; "Week 6" in the This week chip → removed (the hero meta keeps "Week 6 of 14"); the This week scores 40 → 28pt; This week card → opens Matchup; Standings card → opens League › Standings; the gap between blocks 20 → 24pt. Before the draft: 3 cards → 2 (the countdown leads, the no-buying note sits under its button, the "Pre-draft" chip goes). Season complete: 4 blocks → 2 (one primary).</li>
            <li><b>Season over, under A:</b> the medal card + the tiles card → one card; "See the final standings" → a row inside it (no longer a filled button); Run it back (commissioner) or the I'm in / I'm out ask (member) is the one primary. Same copy. It keeps the ending as a peak (rule 11): the champion is the first thing you see.</li>
            <li><b>Under B, in addition:</b> in season, the chart, the marks and the range tabs → League › Standings, above the table. Season over, the four tiles → the final standings; the result → one tappable line that opens them.</li>
          </ul>
        </div>
      </section>
    );
  }

  window.KSHomeCalm = HomeCalm;
})();
