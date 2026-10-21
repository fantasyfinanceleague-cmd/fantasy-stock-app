// Account deletion, W1 (plan docs/plans/2026-10-21-account-deletion.md, approved 2026-10-21).
// Design Lead, 2026-10-21. Game Night, Light AND Dark. Giorgio decided all three calls the same
// day (A "Former manager"; B one line per league; B the Members pill + the seat's team view) and
// approved the new strings as written; the calls are in the Archive and "Decided" below is the
// set W4 builds.
// Review notes sit UNDER the phones (Giorgio, 2026-10-14), never inside them.

(function () {
  const { Device, Icon, ICON, $s } = window.KSKit;
  const K = window.KS;
  const GN = window.KSGN;
  const { Fit, Av, NEW } = GN;
  const G = GN.G;
  const tone = (v) => (Math.round(Math.abs(v) * 100) === 0 ? 'dr-zero' : v > 0 ? 'dr-gain' : 'dr-loss');

  // ── The moment: Stock Scudetto after Week 6. Gianluigi B. deleted his account; Roberto B. is
  // the commissioner and the one holding the phone. ──
  const LEAGUE = 'Stock Scudetto';
  const GONE = 'gianluigi';
  const PERSON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5';
  const APPLE = 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z';

  const Th = ({ t, children }) => <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`}>{children}</div>;
  /** The default avatar a deleted seat shows: a neutral disc with a person glyph, never initials of the label. */
  const Seat = ({ size = 32 }) => (
    <span aria-label="Default avatar" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--c-inset)', color: 'var(--c-text-2)', display: 'grid', placeItems: 'center', flex: 'none' }}>
      <Icon d={PERSON} size={Math.round(size * 0.58)} width={2} />
    </span>
  );
  const Title = ({ children, size = 28, x = 1 }) => <span style={{ fontSize: size * Math.min(x, 1.4), lineHeight: `${Math.round(size * Math.min(x, 1.4) + 4)}px`, fontWeight: 800, color: 'var(--c-text)' }}>{children}</span>;
  const Sub = ({ children, x = 1, strong }) => <span className="dr-call" style={{ fontSize: 15 * x, lineHeight: `${Math.round(21 * x)}px`, color: strong ? 'var(--c-text)' : 'var(--c-text-2)' }}>{children}</span>;
  const Btn = ({ children, kind = 'primary', x = 1, disabled, style }) => {
    const k = Math.min(x, 1.6);
    const base = { width: '100%', minHeight: 50 * Math.min(x, 1.3), height: 'auto', padding: '10px 16px', fontSize: 16 * k, boxSizing: 'border-box', textAlign: 'center' };
    const danger = kind === 'danger' ? { background: 'var(--c-loss-fill)', color: 'var(--c-on-you)', boxShadow: 'none' } : null;
    return <span className={kind === 'line' ? 'dr-btn dr-btn--line' : 'dr-btn'} style={{ ...base, ...danger, ...(disabled ? { opacity: 0.45 } : null), ...style }}>{children}</span>;
  };
  const TextLink = ({ children, x = 1, color = 'var(--c-accent)' }) => <span className="dr-call" style={{ textAlign: 'center', fontSize: 15 * Math.min(x, 1.6), fontWeight: 700, color }}>{children}</span>;
  const Card = ({ children, pad = '4px 16px', style }) => <div className="dr-a-card" style={{ padding: pad, ...style }}>{children}</div>;
  const Back = ({ to, x = 1 }) => <span className="dr-call" style={{ color: 'var(--c-accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, fontSize: 15 * Math.min(x, 1.6) }}><Icon d={ICON.left} size={18} width={2.4} />{to}</span>;

  // ════════════════════════════════════════════════════════════════════════
  // Call 1 · the placeholder label, on the four surfaces that name a seat
  // ════════════════════════════════════════════════════════════════════════
  function Standings({ t, label, commish, findLink }) {
    const rows = K.STANDINGS_FINAL;
    const cols = '22px 32px minmax(0,1fr) 34px 86px';
    return (
      <Th t={t}>
        <Device tab="league" full label={`League standings, a deleted manager shown as ${label}, ${t}`}>
          <div className="ks-head" style={{ paddingInline: G }}>
            <span className="ks-pill"><span>{LEAGUE}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
            <Av init="RB" you size={34} />
          </div>
          <div style={{ padding: `0 ${G}px 24px`, display: 'grid', gap: 14 }}>
            <div className="dr-seg"><span className="on">Standings</span><span>Schedule</span><span>History</span></div>
            <div style={{ display: 'grid', gap: 6 }}>
              {rows.map((r) => {
                const gone = r.id === GONE;
                return (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '12px 10px', borderRadius: 12, background: r.you ? 'var(--c-you-tint)' : 'var(--c-surface)', boxShadow: r.you ? 'inset 0 0 0 1.5px var(--c-you)' : undefined }}>
                    <span className="dr-score" style={{ fontSize: 18, color: 'var(--c-text-2)' }}>{r.rank}</span>
                    {gone ? <Seat /> : <Av init={r.init} you={r.you} size={32} />}
                    <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: r.you ? 800 : 500, color: gone ? 'var(--c-text-2)' : 'var(--c-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gone ? label : r.name}</span>
                      {gone && commish && findLink ? <span className="dr-call" style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-accent)' }}>Find a new manager</span> : null}
                    </span>
                    <span className="dr-call dr-num dr-muted" style={{ textAlign: 'right' }}>{r.w}–{r.l}</span>
                    <span className={`dr-num ${tone(r.pf)}`} style={{ fontSize: 15, fontWeight: 800, textAlign: 'right' }}>{$s(r.pf)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Device>
      </Th>
    );
  }
  function Matchup({ t, label }) {
    const s = K.MATCHUP.live;
    const half = (you) => (
      <div style={{ display: 'grid', gap: 8, justifyItems: you ? 'start' : 'end', padding: '16px 14px', background: you ? 'var(--c-you-tint)' : undefined, borderRadius: you ? '14px 0 0 14px' : '0 14px 14px 0' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: you ? 'row' : 'row-reverse' }}>
          {you ? <Av init="RB" you size={44} /> : <Seat size={44} />}
          <span className="dr-call" style={{ fontWeight: you ? 800 : 600, fontSize: 15, color: you ? 'var(--c-text)' : 'var(--c-text-2)' }}>{you ? 'Roberto B.' : label}</span>
        </span>
        <span className="dr-score" style={{ fontSize: 32, lineHeight: '36px' }}>{$s(you ? s.you.gain : s.opp.gain)}</span>
      </div>
    );
    return (
      <Th t={t}>
        <Device tab="matchup" full label={`Matchup against a deleted manager shown as ${label}, ${t}`}>
          <div className="ks-head" style={{ paddingInline: G }}>
            <span className="ks-pill"><span>{LEAGUE}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
            <span className="dr-chip"><span className="dr-dot" />Live</span>
          </div>
          <div style={{ padding: `0 ${G}px 24px`, display: 'grid', gap: 12 }}>
            <div className="dr-seg"><span className="on">My matchup</span><span>All matchups</span></div>
            <div className="dr-a-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>{half(true)}{half(false)}</div>
            <span className="dr-call" style={{ textAlign: 'center' }}>Roberto B. leads by <b className="dr-num">{K.formatMoney(Math.abs(s.you.gain - s.opp.gain))}</b></span>
          </div>
        </Device>
      </Th>
    );
  }
  function History({ t, label }) {
    const S1 = K.SEASON1;
    return (
      <Th t={t}>
        <Device tab="league" full label={`League history, a deleted manager shown as ${label}, ${t}`}>
          <div className="ks-head" style={{ paddingInline: G }}>
            <span className="ks-pill"><span>{LEAGUE}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
            <Av init="RB" you size={34} />
          </div>
          <div style={{ padding: `0 ${G}px 24px`, display: 'grid', gap: 14 }}>
            <div className="dr-seg"><span>Standings</span><span>Schedule</span><span className="on">History</span></div>
            <Card pad="14px 12px">
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px 8px' }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)' }}>Season 1</span>
                <span className="dr-cap">Final standings</span>
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                {S1.rows.map((r) => {
                  const gone = r.id === GONE;
                  return (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '20px 28px minmax(0,1fr) auto 84px', gap: 10, alignItems: 'center', padding: '8px 4px', borderRadius: 8, background: r.you ? 'var(--c-you-tint)' : undefined }}>
                      <span className="dr-score" style={{ fontSize: 15, color: 'var(--c-text-2)' }}>{r.rank}</span>
                      {gone ? <Seat size={28} /> : <Av init={r.init} you={r.you} size={28} />}
                      <span style={{ fontSize: 14, fontWeight: r.you ? 800 : 500, color: gone ? 'var(--c-text-2)' : 'var(--c-text)' }}>{gone ? label : r.name}</span>
                      <span className="dr-call dr-num dr-muted">{r.w}–{r.l}</span>
                      <span className={`dr-call dr-num ${tone(r.pf)}`} style={{ fontWeight: 800, textAlign: 'right' }}>{$s(r.pf)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </Device>
      </Th>
    );
  }
  /** League › Members (League settings). `find`: the commissioner's "Find a new manager" pill on the seat. */
  function Members({ t, label, find }) {
    const members = K.STANDINGS_FINAL.slice().sort((a, b) => (a.id === 'roberto' ? -1 : b.id === 'roberto' ? 1 : 0));
    return (
      <Th t={t}>
        <Device noTabs full label={`League settings members, a deleted manager shown as ${label}${find ? ', with Find a new manager' : ''}, ${t}`}>
          <div style={{ padding: `56px ${G}px 24px`, display: 'grid', gap: 16 }}>
            <span className="dr-call dr-muted" style={{ fontSize: 15 }}>Cancel</span>
            <span style={{ fontSize: 34, lineHeight: '40px', fontWeight: 800, color: 'var(--c-text)' }}>League settings</span>
            <span className="dr-tag dr-muted">Members · 6</span>
            <Card pad="6px 14px">
              {members.map((r) => {
                const gone = r.id === GONE;
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52 }}>
                    {gone ? <Seat /> : <Av init={r.init} you={r.you} size={32} />}
                    <span style={{ flex: 1, fontSize: 15, fontWeight: r.you ? 800 : 500, color: gone ? 'var(--c-text-2)' : 'var(--c-text)' }}>{gone ? label : r.name}</span>
                    {r.id === 'roberto' ? <span className="dr-cap">Commissioner</span> : null}
                    {gone && find ? <span className="dr-btn dr-btn--line" style={{ height: 34, padding: '0 12px', fontSize: 13, fontWeight: 700 }}>Find a new manager</span> : null}
                  </div>
                );
              })}
            </Card>
          </div>
        </Device>
      </Th>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Call 2 · Profile's last row, then the delete screen
  // ════════════════════════════════════════════════════════════════════════
  function Profile({ t }) {
    const rows = [['Username', 'roberto_b'], ['Email', 'roberto@example.com'], ['Change password', ''], ['Appearance', 'System'], ['How it works', '']];
    return (
      <Th t={t}>
        <Device noTabs full label={`Profile with Delete account as the last row, ${t}`}>
          <div style={{ padding: `56px ${G}px 32px`, display: 'grid', gap: 16 }}>
            <Back to="Home" />
            <span style={{ display: 'grid', justifyItems: 'center', gap: 8 }}><Av init="RB" you size={64} /><Title size={22}>roberto_b</Title></span>
            <Card>
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, gap: 10 }}>
                  <span className="dr-call" style={{ fontSize: 16, color: 'var(--c-text)' }}>{k}</span>
                  <span className="dr-call dr-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15 }}>{v}{k === 'Email' ? null : <Icon d={ICON.right} size={16} />}</span>
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ minHeight: 50, display: 'flex', alignItems: 'center' }}><span className="dr-call" style={{ fontSize: 16, color: 'var(--c-danger)', fontWeight: 700 }}>Sign out</span></div>
              <div style={{ minHeight: 50, display: 'flex', alignItems: 'center' }}><span className="dr-call" style={{ fontSize: 16, color: 'var(--c-danger)', fontWeight: 700 }}>Delete account</span></div>
            </Card>
            <span className="dr-cap" style={{ textAlign: 'center' }}>Stockpile 1.3.0</span>
          </div>
        </Device>
      </Th>
    );
  }
  const FORMER = 'Former manager';
  /** The plan's draft body (A), verbatim, with the placeholder filled in. */
  const BODY_A = `This deletes your account right away. Your leagues keep playing: in any league that has already drafted this season, your team stays as '${FORMER}' and your commissioner can hand it to a new manager. Past seasons keep your results under that name too.`;
  /** Roberto's leagues for the screen: one he runs, one he plays in, one he runs alone, one before its draft. */
  const MY_LEAGUES = [
    { name: 'Stock Scudetto', a: `You run Stock Scudetto. Paolo M. becomes the commissioner.`, b: `Your team stays as “${FORMER}”. Paolo M. becomes the commissioner.` },
    { name: 'Friday Night Stocks', a: null, b: `Your team stays as “${FORMER}”. The commissioner can hand it to a new manager.` },
    { name: 'Serie A Traders', a: null, b: 'It hasn’t drafted yet, so you leave it.' },
    { name: 'Solo Stocks', a: 'Solo Stocks has no other managers, so it is deleted with your account.', b: 'No other managers, so it’s deleted with your account.' },
  ];
  /** The proof block, by how they signed in. state: 'empty' | 'filled' | 'done'. */
  function Proof({ kind, state, x }) {
    if (kind === 'password') {
      return (
        <span style={{ display: 'grid', gap: 6 }}>
          <span className="dr-cap" style={{ fontWeight: 700, fontSize: 13 * Math.min(x, 2), lineHeight: `${Math.round(18 * Math.min(x, 2))}px` }}>Enter your password to continue</span>
          <span style={{ minHeight: 50, borderRadius: 12, background: 'var(--c-inset)', boxShadow: state === 'empty' ? 'inset 0 0 0 1.5px var(--c-accent)' : 'inset 0 0 0 1px var(--d-rim)', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 17 * Math.min(x, 1.6), color: 'var(--c-text)', letterSpacing: '0.12em' }}>{state === 'empty' ? '' : '••••••••••'}</span>
        </span>
      );
    }
    const who = kind === 'apple' ? 'Apple' : 'Google';
    if (state === 'done') {
      return <span className="dr-call" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 * Math.min(x, 2), fontWeight: 700, color: 'var(--c-gain)' }}><Icon d={ICON.check} size={18} width={2.6} />Confirmed with {who}</span>;
    }
    return (
      <span style={{ display: 'grid', gap: 8 }}>
        <span className="dr-cap" style={{ fontWeight: 700, fontSize: 13 * Math.min(x, 2), lineHeight: `${Math.round(18 * Math.min(x, 2))}px` }}>Confirm it's you to continue</span>
        {kind === 'apple'
          ? <Btn x={x} style={{ background: 'var(--c-text)', color: 'var(--c-bg)', gap: 8 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={APPLE} /></svg>Continue with Apple</Btn>
          : <Btn kind="line" x={x} style={{ gap: 10 }}><b style={{ fontSize: 17, color: 'var(--c-you-text)' }}>G</b>Continue with Google</Btn>}
      </span>
    );
  }
  /** The delete screen. v: 'A' (the plan's paragraph) | 'B' (one line per league). */
  function DeleteScreen({ t, v = 'B', proof = 'password', state = 'empty', x = 1, failed, running, label }) {
    const ready = state !== 'empty';
    return (
      <Th t={t}>
        <Device noTabs full label={`Delete your account, option ${v}, ${proof} ${state}${x > 1 ? ', Accessibility XXXL (approximate)' : ''}, ${t}`}>
          <div style={{ padding: `56px ${G}px 32px`, display: 'grid', gap: 16 }}>
            <Back to="Profile" x={x} />
            <Title x={x}>Delete your account?</Title>
            {v === 'A' ? (
              <>
                <Sub x={x} strong>{BODY_A}</Sub>
                {MY_LEAGUES.filter((l) => l.a).map((l) => <Sub key={l.name} x={x} strong>{l.a}</Sub>)}
              </>
            ) : (
              <>
                <Sub x={x} strong>This deletes your account right away.</Sub>
                <Card pad="6px 14px">
                  {MY_LEAGUES.map((l) => (
                    <div key={l.name} style={{ display: 'grid', gap: 2, padding: '10px 0' }}>
                      <span className="dr-call" style={{ fontSize: 15 * x, fontWeight: 700, color: 'var(--c-text)' }}>{l.name}</span>
                      <span className="dr-call" style={{ fontSize: 14 * x, lineHeight: `${Math.round(20 * x)}px`, color: 'var(--c-text-2)' }}>{l.b}</span>
                    </div>
                  ))}
                </Card>
                <Sub x={x}>Past seasons keep your results under “{FORMER}”.</Sub>
              </>
            )}
            <Proof kind={proof} state={state} x={x} />
            {failed ? <div style={{ background: 'var(--c-warn-tint)', boxShadow: 'inset 0 0 0 1px var(--c-warn-line)', borderRadius: 14, padding: '12px 14px' }}><span className="dr-call" style={{ fontSize: 15 * Math.min(x, 1.6), fontWeight: 600, color: 'var(--c-warn-text)' }}>Couldn't delete your account. Try again.</span></div> : null}
            <Btn kind="danger" x={x} disabled={!ready || running}>{running ? <span className="dr-spin" aria-label="Deleting" style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid var(--c-on-you)', borderRightColor: 'transparent', display: 'inline-block' }} /> : 'Delete my account'}</Btn>
          </div>
        </Device>
      </Th>
    );
  }
  /** The final native alert over the delete screen. */
  function Alert({ t }) {
    return (
      <Th t={t}>
        <Device noTabs full label={`Are you sure? alert, ${t}`} overlay={(
          <div style={{ position: 'absolute', inset: 0, background: 'var(--c-scrim)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
            <div style={{ width: 270, borderRadius: 14, background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 1px var(--d-rim)', textAlign: 'center', overflow: 'hidden' }}>
              <div style={{ padding: '18px 16px 16px', display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text)' }}>Are you sure?</span>
                <span className="dr-cap" style={{ fontSize: 13 }}>This can't be undone. Your account and sign-in are deleted for good.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--c-line)' }}>
                <span style={{ padding: 12, color: 'var(--c-you-text)', fontSize: 17, fontWeight: 700, borderRight: '1px solid var(--c-line)' }}>Keep my account</span>
                <span style={{ padding: 12, color: 'var(--c-danger)', fontSize: 17 }}>Delete</span>
              </div>
            </div>
          </div>
        )}>
          <div style={{ padding: `56px ${G}px 32px`, display: 'grid', gap: 16 }}>
            <Back to="Profile" />
            <Title>Delete your account?</Title>
            <Sub strong>This deletes your account right away.</Sub>
            <Card pad="40px 14px"><span /></Card>
            <Btn kind="danger">Delete my account</Btn>
          </div>
        </Device>
      </Th>
    );
  }
  /** Sign in, once, after a deletion. */
  function SignedOut({ t }) {
    return (
      <Th t={t}>
        <Device noTabs full label={`Sign in after deleting, the one-time line, ${t}`}>
          <div style={{ padding: `56px ${G}px 32px`, display: 'grid', gap: 16 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--c-text)' }}>Stockpile</span>
            <span style={{ display: 'grid', gap: 4 }}><Title>Welcome back</Title><Sub>Sign in to your league</Sub></span>
            <Card pad="12px 8px 12px 14px" style={{ display: 'grid', gridTemplateColumns: '22px 1fr 44px', gap: 10, alignItems: 'center' }}>
              <span style={{ color: 'var(--c-text-2)', display: 'flex' }}><Icon d={ICON.info} size={20} /></span>
              <span className="dr-call" style={{ fontSize: 15, color: 'var(--c-text)' }}>Your account is deleted.</span>
              <span className="dr-muted" style={{ display: 'grid', placeItems: 'center', height: 44 }} aria-label="Dismiss"><Icon d={ICON.close} size={18} /></span>
            </Card>
            <Btn style={{ background: 'var(--c-text)', color: 'var(--c-bg)', gap: 8 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={APPLE} /></svg>Continue with Apple</Btn>
            <Btn kind="line" style={{ gap: 10 }}><b style={{ fontSize: 17, color: 'var(--c-you-text)' }}>G</b>Continue with Google</Btn>
            {['Email address', 'Password'].map((f) => <span key={f} style={{ display: 'grid', gap: 6 }}><span className="dr-cap" style={{ fontWeight: 700 }}>{f}</span><span style={{ height: 48, borderRadius: 12, background: 'var(--c-inset)' }} /></span>)}
            <Btn>Sign in</Btn>
          </div>
        </Device>
      </Th>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Call 3 · "Find a new manager", the seat's team, and the takeover landing
  // ════════════════════════════════════════════════════════════════════════
  /** B · the seat's team view (opened from its standings row), with the commissioner's pill. */
  function SeatTeam({ t }) {
    const rows = [['AMZN', 'Amazon.com', '$2,136.47', -1.18], ['JPM', 'JPMorgan Chase', '$2,102.99', 0.22], ['KO', 'Coca-Cola', '$2,052.87', 0.62], ['BA', 'Boeing', '$2,049.83', 0.5]];
    return (
      <Th t={t}>
        <Device noTabs full label={`The deleted seat's team, with Find a new manager for the commissioner, ${t}`}>
          <div style={{ padding: `56px ${G}px 24px`, display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Title size={24}>{FORMER}</Title><span className="dr-muted" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44 }}><Icon d={ICON.close} size={20} /></span></div>
            <span className="dr-cap">Portfolio value · includes cash</span>
            <span className="dr-score" style={{ fontSize: 40, lineHeight: '44px' }}>$6,290.48</span>
            <span className="dr-call"><b className="dr-gain">+$290.48 · +4.84%</b> <span className="dr-muted">since the draft</span></span>
            <Btn>Find a new manager</Btn>
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)', marginTop: 4 }}>Holdings</span>
            {rows.map(([tk, co, v, p]) => (
              <div key={tk} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', minHeight: 48 }}>
                <span style={{ display: 'grid' }}><span className="dr-t" style={{ fontSize: 16 }}>{tk}</span><span className="dr-cap">{co}</span></span>
                <span style={{ display: 'grid', justifyItems: 'end' }}><span className="dr-num" style={{ fontWeight: 700 }}>{v}</span><span className={`dr-cap dr-num ${tone(p)}`} style={{ fontWeight: 700 }}>{p > 0 ? '+' : '−'}{Math.abs(p).toFixed(2)}%</span></span>
              </div>
            ))}
          </div>
        </Device>
      </Th>
    );
  }
  /** The share sheet the pill opens (iOS draws it; the app supplies the message). */
  function Share({ t }) {
    return (
      <Th t={t}>
        <Device noTabs full label={`Share sheet with the takeover link, ${t}`} overlay={(
          <div style={{ position: 'absolute', inset: 0, background: 'var(--c-scrim)', zIndex: 5, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: 'var(--c-surface)', padding: `16px ${G}px 34px`, display: 'grid', gap: 14 }}>
              <span style={{ justifySelf: 'center', width: 36, height: 5, borderRadius: 3, background: 'var(--c-line)' }} />
              <div className="dr-a-card" style={{ padding: 14, display: 'grid', gap: 4 }}>
                <span className="dr-call" style={{ fontWeight: 700, color: 'var(--c-text)' }}>Take over a team in Stock Scudetto</span>
                <span className="dr-cap">stockpile.app/take/QX7P4K</span>
              </div>
              <div style={{ display: 'flex', gap: 18, justifyContent: 'center', padding: '6px 0' }}>
                {['Messages', 'Mail', 'WhatsApp', 'Copy'].map((a) => <span key={a} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}><span style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--c-inset)' }} /><span className="dr-cap">{a}</span></span>)}
              </div>
            </div>
          </div>
        )}>
          <div style={{ padding: `56px ${G}px 24px`, display: 'grid', gap: 14 }}>
            <Title size={24}>{FORMER}</Title>
            <span className="dr-score" style={{ fontSize: 40, lineHeight: '44px' }}>$6,290.48</span>
          </div>
        </Device>
      </Th>
    );
  }
  /** The takeover landing (with the app, signed in). taken: a second person opens the same link. */
  function Takeover({ t, taken }) {
    if (taken) {
      return (
        <Th t={t}>
          <Device noTabs full label={`Takeover link, already taken, ${t}`}>
            <div style={{ padding: `56px ${G}px 24px`, minHeight: 786, marginBottom: -66, boxSizing: 'border-box', display: 'grid', alignContent: 'center', gap: 16 }}>
              <div style={{ background: 'var(--c-warn-tint)', boxShadow: 'inset 0 0 0 1px var(--c-warn-line)', borderRadius: 14, padding: '12px 14px' }}><span className="dr-call" style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-warn-text)' }}>Someone already took this team.</span></div>
              <TextLink>Go to Home</TextLink>
            </div>
          </Device>
        </Th>
      );
    }
    return (
      <Th t={t}>
        <Device noTabs full label={`Takeover landing, ${t}`}>
          <div style={{ padding: `56px ${G}px 24px`, minHeight: 786, marginBottom: -66, boxSizing: 'border-box', display: 'grid', gridTemplateRows: '1fr auto', gap: 18 }}>
            <div style={{ display: 'grid', gap: 16, alignContent: 'center', justifyItems: 'center', textAlign: 'center', textWrap: 'balance' }}>
              <Seat size={64} />
              <Title>Take over {FORMER}'s team in {LEAGUE}?</Title>
              <Card pad="12px 18px"><span className="dr-call dr-num" style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)' }}>1–5, 6th</span></Card>
            </div>
            <div style={{ display: 'grid', gap: 10 }}><Btn>Take the team</Btn><TextLink color="var(--c-text-2)">Not now</TextLink></div>
          </div>
        </Device>
      </Th>
    );
  }

  // ── Layout helpers (onboarding.jsx's, with the note under the frame) ──
  const fig = (key, cap, node, note) => (
    <figure key={key} className="b-fig b-fig--inv" style={{ margin: 0 }}><Fit>{node}</Fit><figcaption><b>{cap}</b>{note ? <span className="b-annot">Review note: {note}</span> : null}</figcaption></figure>
  );
  const quad = (key, cap, F, note) => ['dark', 'light'].map((t) => fig(`${key}${t}`, `${cap} · ${t === 'dark' ? 'Dark' : 'Light'}`, <F t={t} />, note));
  const Sec = ({ id, title, intro, notes, children }) => (
    <section className="b-sec" id={id} aria-labelledby={`${id}-h`}>
      <header className="b-sec__head">
        <span className="b-sec__n b-sec__n--code">1.3</span>
        <div><h2 id={`${id}-h`}>{title}</h2>{intro ? <p className="b-job">{intro}</p> : null}</div>
      </header>
      {notes ? <ul className="b-inv__notes">{notes}</ul> : null}
      {children}
    </section>
  );
  const Grid = ({ children }) => <div className="b-concepts b-concepts--three">{children}</div>;

  const LABELS = { A: FORMER, B: 'Open team' };
  function CallLabel({ archived }) {
    return (
      <Sec id="call-del-label" title={archived ? 'Decided: the deleted manager\'s seat label' : 'Your call: what a deleted manager\'s seat is called'}
        intro={<>When someone deletes their account mid-season, their team keeps playing and keeps its record, but their name and avatar are scrubbed (your "we stick with the plan and change the product rules"). The seat needs one label, shown everywhere a name would be, with the default avatar. Gianluigi B. deleted his account after Week 6 of Stock Scudetto; this is what everyone else in the league sees.</>}
        notes={<>
          <li><b>A · "Former manager":</b> the Planner's recommendation. It reads the same in the standings, a matchup and a past season.</li>
          <li><b>B · "Open team":</b> says the seat can be taken. But after the season (History) nothing is open about it, and a few lines get awkward: the takeover screen would read "Take over Open team's team", and your push "{'{Name}'} took over Open team's team." B would need those two rewritten.</li>
          <li><b>Both:</b> the default avatar (a person glyph on a neutral disc), never initials of the label; the label in the secondary text colour, so it reads as a placeholder, not a person.</li>
          <li><b>Recommended: A.</b> It stays true in every season and every sentence it goes into, with no rewrites.</li>
          {archived ? <li><b>Decided by Giorgio (2026-10-21): A, "Former manager".</b></li> : null}
        </>}>
        {['A', 'B'].map((v) => ['dark', 'light'].map((t) => (
          <React.Fragment key={v + t}>
            <h3 className="b-sub">{v} · "{LABELS[v]}" · {t === 'dark' ? 'Dark' : 'Light'}</h3>
            <Grid>{[
              fig(`${v}${t}s`, `${v} · Standings`, <Standings t={t} label={LABELS[v]} />),
              fig(`${v}${t}m`, `${v} · Matchup`, <Matchup t={t} label={LABELS[v]} />),
              fig(`${v}${t}h`, `${v} · History, Season 1`, <History t={t} label={LABELS[v]} />),
              fig(`${v}${t}b`, `${v} · Members`, <Members t={t} label={LABELS[v]} />),
            ]}</Grid>
          </React.Fragment>
        )))}
      </Sec>
    );
  }
  function CallScreen({ archived }) {
    return (
      <Sec id="call-del-screen" title={archived ? 'Decided: the delete screen' : 'Your call: how the delete screen explains what happens'}
        intro={<>You picked where it lives ("last row in profile works but we shouldnt have it be highlighted") and the flow ("the flow is also good"): confirm it's you, tap "Delete my account", then "Are you sure?" with "Keep my account" as the safe answer. What's left is how the screen says what happens to each of your leagues. Roberto runs Stock Scudetto, plays in Friday Night Stocks, has joined Serie A Traders (not drafted yet), and runs Solo Stocks alone.</>}
        notes={<>
          <li><b>A · the plan's paragraph</b>, verbatim: one block of text, then a "You run…" line per league you run.</li>
          <li><b>B · one line per league</b> <NEW />: "This deletes your account right away.", then each league by name with what happens to it. It also covers the league that hasn't drafted yet (you simply leave it), which A's paragraph doesn't mention.</li>
          <li><b>Recommended: B.</b> You see each league's outcome before you decide, nothing is buried in a paragraph, and the case A leaves out is covered. The new lines are a proposal.</li>
          <li><b>The same in both:</b> the password field (or the Apple / Google button) above "Delete my account", which stays dimmed until you've confirmed; the alert; the failure line; and the one-time "Your account is deleted." on Sign in.</li>
          {archived ? <li><b>Decided by Giorgio (2026-10-21): B</b>, one line per league, and every new string "Use as written".</li> : null}
        </>}>
        <h3 className="b-sub">Where it starts: Profile's last row, plain, danger text only (decided)</h3>
        <Grid>{quad('pr', 'Profile', Profile)}</Grid>
        <h3 className="b-sub">A · the plan's paragraph</h3>
        <Grid>{quad('sa', 'A · password', (p) => <DeleteScreen {...p} v="A" />)}</Grid>
        <h3 className="b-sub">B · one line per league</h3>
        <Grid>{quad('sb', 'B · password', (p) => <DeleteScreen {...p} v="B" />, 'NEW (proposals): "Your team stays as \u201cFormer manager\u201d. Paolo M. becomes the commissioner." / "… The commissioner can hand it to a new manager." / "It hasn\u2019t drafted yet, so you leave it." / "No other managers, so it\u2019s deleted with your account." / "Past seasons keep your results under \u201cFormer manager\u201d."')}</Grid>
        <h3 className="b-sub">Confirming it's you (drawn in B): password typed, Apple, Google</h3>
        <Grid>{[
          fig('pw', 'Password typed · Delete my account is ready', <DeleteScreen t="light" proof="password" state="filled" />),
          fig('ap', 'Apple · before', <DeleteScreen t="light" proof="apple" />, 'NEW: "Confirm it\u2019s you to continue" (the password version\u2019s line is the plan\u2019s).'),
          fig('apd', 'Apple · confirmed', <DeleteScreen t="light" proof="apple" state="done" />, 'NEW: "Confirmed with Apple" (Google: "Confirmed with Google").'),
          fig('go', 'Google · before', <DeleteScreen t="dark" proof="google" />),
        ]}</Grid>
        <h3 className="b-sub">Are you sure? (the native alert), and the failure line</h3>
        <Grid>{[...quad('al', 'Are you sure?', Alert), fig('fl', 'Couldn\'t delete · Light', <DeleteScreen t="light" state="filled" failed />)]}</Grid>
        <h3 className="b-sub">At Accessibility XXXL (B)</h3>
        <Grid>{quad('xx', 'B · XXXL', (p) => <DeleteScreen {...p} x={2.4} />, 'An approximation of Accessibility XXXL (body text about 2.4×, buttons capped at 1.6×). The build gate checks the real thing on the simulator.')}</Grid>
        <h3 className="b-sub">After: Sign in, once</h3>
        <Grid>{quad('so', 'Your account is deleted.', SignedOut)}</Grid>
      </Sec>
    );
  }
  function CallFind({ archived }) {
    return (
      <Sec id="call-del-find" title={archived ? 'Decided: where "Find a new manager" sits' : 'Your call: where "Find a new manager" sits'}
        intro={<>Only the commissioner sees it, on the deleted manager's seat (your "A plus C"). It opens the share sheet with a takeover link, like Share league; whoever opens it first and isn't in the league takes the team with its record ("keep the teams record just the owner is gone"). Roberto is the commissioner here.</>}
        notes={<>
          <li><b>A · on both lists:</b> a "Find a new manager" pill on the seat's Members row, and the same words as a link under the seat's name in the standings.</li>
          <li><b>B · Members, and the seat's team:</b> the same pill on Members; in the standings the row looks like every other row, and tapping it opens the seat's team (as any row does since the team view), where "Find a new manager" is the button.</li>
          <li><b>Recommended: B.</b> The standings stay a clean table for everyone, the commissioner still reaches it in one tap from either list, and the team screen shows exactly what the new manager would inherit.</li>
          <li><b>The same in both:</b> the share sheet; the takeover landing with the record ("1–5, 6th") and "Take the team"; and what a second person sees once it's taken.</li>
          {archived ? <li><b>Decided by Giorgio (2026-10-21): B</b>, the Members pill, the standings row uniform (it opens the seat's team view, where the button is).</li> : null}
        </>}>
        <h3 className="b-sub">A · on both lists</h3>
        <Grid>{[...quad('fam', 'A · Members', (p) => <Members {...p} label={FORMER} find />), ...quad('fas', 'A · Standings', (p) => <Standings {...p} label={FORMER} commish findLink />)]}</Grid>
        <h3 className="b-sub">B · Members, and the seat's team</h3>
        <Grid>{[...quad('fbm', 'B · Members', (p) => <Members {...p} label={FORMER} find />), ...quad('fbt', 'B · the seat\'s team', SeatTeam, 'Opened by tapping the seat\'s standings row (which looks like any other row). The commissioner sees the button; nobody else does.')]}</Grid>
        <h3 className="b-sub">Then: the share sheet, the landing, and "already taken"</h3>
        <Grid>{[
          fig('sh', 'Share sheet · Light', <Share t="light" />, 'iOS draws the sheet; the app supplies the message and the link. NEW: "Take over a team in Stock Scudetto".'),
          ...quad('tk', 'Takeover landing', (p) => <Takeover {...p} />, '"Not now" is the shipped words from the notifications ask, reused here (a proposal).'),
          fig('tt', 'Already taken · Light', <Takeover t="light" taken />, 'NEW: "Someone already took this team." and "Go to Home". No heading, the panel centred: the dead-link pattern from the invite arrival.'),
        ]}</Grid>
      </Sec>
    );
  }

  // ── As decided (2026-10-21): the frames W4 builds ──
  function Decided() {
    return (
      <Sec id="account-deletion" title="Account deletion, as decided (2026-10-21): the frames"
        intro={<>Giorgio's picks: the seat reads "Former manager" (A); the delete screen explains each league on its own line (B); "Find a new manager" is a pill on Members, and the standings row stays like every other row and opens the seat's team, where the button is (B). Every new string was approved as written. The three calls are in the Archive. The wording is in PRODUCT_RULES "Account deletion".</>}
        notes={<>
          <li><b>For W4 · the destructive button</b> is the lossFill pill with onYou ink (both themes), the same as Sell and Leave league.</li>
          <li><b>For W4 · "Delete my account" stays dimmed until the proof is in hand</b>; the proof line right above it ("Enter your password to continue" / "Confirm it's you to continue") is its visible reason (UX rule 8). After an Apple or Google proof, "Confirmed with Apple / Google" replaces the button above it.</li>
          <li><b>For W4 · the seat's avatar is the default avatar</b> (a person glyph on a neutral disc), never initials of the label; the label is in the secondary text colour, on every surface a name appears.</li>
          <li><b>For W4 · nothing is sent until "Delete"</b> on the alert; "Keep my account" is the alert's default (cancel style).</li>
          <li><b>For W4 · "already taken"</b> has no heading and centres its panel and "Go to Home", the invite arrival's dead-link pattern.</li>
        </>}>
        <h3 className="b-sub">The seat reads "Former manager": Standings, Matchup, History, Members</h3>
        {['dark', 'light'].map((t) => <Grid key={t}>{[
          fig(`ds${t}`, `Standings · ${t === 'dark' ? 'Dark' : 'Light'}`, <Standings t={t} label={FORMER} />),
          fig(`dm${t}`, `Matchup · ${t === 'dark' ? 'Dark' : 'Light'}`, <Matchup t={t} label={FORMER} />),
          fig(`dh${t}`, `History · ${t === 'dark' ? 'Dark' : 'Light'}`, <History t={t} label={FORMER} />),
          fig(`db${t}`, `Members · ${t === 'dark' ? 'Dark' : 'Light'}`, <Members t={t} label={FORMER} />),
        ]}</Grid>)}
        <h3 className="b-sub">Profile's last row, then the delete screen (one line per league)</h3>
        <Grid>{[...quad('dpr', 'Profile', Profile), ...quad('dsb', 'Delete your account?', (p) => <DeleteScreen {...p} v="B" />)]}</Grid>
        <h3 className="b-sub">Confirming it's you</h3>
        <Grid>{[
          fig('dpw', 'Password typed · ready', <DeleteScreen t="light" proof="password" state="filled" />),
          fig('dap', 'Apple · before', <DeleteScreen t="light" proof="apple" />),
          fig('dapd', 'Apple · confirmed', <DeleteScreen t="light" proof="apple" state="done" />),
          fig('dgo', 'Google · before', <DeleteScreen t="dark" proof="google" />),
        ]}</Grid>
        <h3 className="b-sub">Are you sure?, the failure line, XXXL, and Sign in afterwards</h3>
        <Grid>{[...quad('dal', 'Are you sure?', Alert), fig('dfl', 'Couldn\'t delete · Light', <DeleteScreen t="light" state="filled" failed />)]}</Grid>
        <Grid>{[...quad('dxx', 'XXXL', (p) => <DeleteScreen {...p} x={2.4} />, 'An approximation of Accessibility XXXL; the build gate checks the real thing.'), ...quad('dso', 'Your account is deleted.', SignedOut)]}</Grid>
        <h3 className="b-sub">The commissioner: the Members pill, the uniform standings row, the seat's team</h3>
        <Grid>{[...quad('dfm', 'Members', (p) => <Members {...p} label={FORMER} find />), ...quad('dfs', 'Standings (the row opens the team)', (p) => <Standings {...p} label={FORMER} commish />)]}</Grid>
        <Grid>{quad('dft', 'The seat\'s team', SeatTeam, 'The commissioner sees "Find a new manager"; nobody else does.')}</Grid>
        <h3 className="b-sub">The takeover: share, landing, already taken</h3>
        <Grid>{[fig('dsh', 'Share sheet · Light', <Share t="light" />), ...quad('dtk', 'Takeover landing', (p) => <Takeover {...p} />), fig('dtt', 'Already taken · Light', <Takeover t="light" taken />)]}</Grid>
      </Sec>
    );
  }

  window.KSAccountDeletion = () => <Decided />; // all three calls decided 2026-10-21, archived in board.jsx
  window.KSDelLabelArchived = () => <CallLabel archived />;
  window.KSDelScreenArchived = () => <CallScreen archived />;
  window.KSDelFindArchived = () => <CallFind archived />;
})();
