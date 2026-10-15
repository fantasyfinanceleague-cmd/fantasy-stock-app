// Onboarding, as planned (docs/plans/2026-10-14-onboarding.md, "The board brief (W1)").
// Design Lead, 2026-10-14. Game Night, Light AND Dark. Every string is Giorgio's, the plan's
// (approved), or already shipped; anything else is flagged NEW. Three calls, all decided
// 2026-10-14 and archived in board.jsx: the card scenes, the username style, the invite arrival.

(function () {
  const { Device, Icon, ICON } = window.KSKit;
  const GN = window.KSGN;
  const { Fit, Av, Head, Scoreboard, FinalChip, NEW } = GN;
  const G = GN.G;

  // ── The moment: Roberto B. invites a friend to Stock Scudetto before its draft ──
  const LG = { name: 'Stock Scudetto', inviter: 'Roberto B.', init: 'RB', managers: '5 of 6', draft: 'Sat, Oct 3 · 7:00 PM ET', stakes: '$2,000 per slot', season: '14 weeks' };
  const BELL = 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0';
  const MAIL = 'M4 6h16v12H4zM4 7l8 6 8-6';
  const APPLE = 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z';

  const Th = ({ t, children }) => <div className={`dr dir-a${t === 'light' ? ' dir-a-light' : ''}`}>{children}</div>;
  /** A phone with no tab bar; 56pt clears the status bar (Device doesn't reserve it without a header). */
  const Page = ({ t, label, children, tab, gap = 18, top = 56 }) => (
    <Th t={t}>
      <Device noTabs={!tab} tab={tab} full label={label}>
        <div style={{ padding: `${top}px ${G}px 32px`, display: 'grid', gap }}>{children}</div>
      </Device>
    </Th>
  );
  const Title = ({ children, size = 28 }) => <span style={{ fontSize: size, lineHeight: `${size + 4}px`, fontWeight: 800, color: 'var(--c-text)' }}>{children}</span>;
  const Sub = ({ children }) => <span className="dr-call dr-muted" style={{ fontSize: 15, lineHeight: '21px' }}>{children}</span>;
  const Btn = ({ children, kind = 'primary', style }) => (
    <span className={kind === 'line' ? 'dr-btn dr-btn--line' : 'dr-btn'} style={{ width: '100%', height: 50, fontSize: 16, ...style }}>{children}</span>
  );
  const Link = ({ pre, children }) => <span className="dr-call dr-muted" style={{ textAlign: 'center', fontSize: 15 }}>{pre}<b style={{ color: 'var(--c-accent)' }}>{children}</b></span>;
  const Disc = ({ d, fill = 'var(--c-inset)', ink = 'var(--c-text)', size = 64 }) => (
    <span style={{ width: size, height: size, borderRadius: '50%', background: fill, color: ink, display: 'grid', placeItems: 'center', justifySelf: 'center' }}><Icon d={d} size={size * 0.45} width={2.2} /></span>
  );
  /** The facts card frame 1 had before sign-in (Archive only: nothing can fill it then). */
  const Facts = () => (
    <div className="dr-a-card" style={{ padding: '4px 16px' }}>
      {[['Managers', LG.managers], ['Draft', LG.draft], ['Stakes', LG.stakes], ['Season', LG.season]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12 }}>
          <span className="dr-call dr-muted" style={{ fontSize: 15 }}>{k}</span>
          <span className="dr-call" style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
  /** Apple's and Google's buttons follow their own guidelines (Apple: solid, inverse of the page). */
  const SignIns = () => (
    <div style={{ display: 'grid', gap: 10 }}>
      <Btn style={{ background: 'var(--c-text)', color: 'var(--c-bg)', gap: 8 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={APPLE} /></svg>Continue with Apple</Btn>
      <Btn kind="line" style={{ gap: 10 }}><b style={{ fontSize: 17, color: 'var(--c-you-text)' }}>G</b>Continue with Google</Btn>
      <Btn kind="line">Use email</Btn>
    </div>
  );
  const Warn = ({ children }) => (
    <div style={{ background: 'var(--c-warn-tint)', boxShadow: 'inset 0 0 0 1px var(--c-warn-line)', borderRadius: 14, padding: '12px 14px' }}>
      <span className="dr-call" style={{ fontSize: 15, lineHeight: '21px', fontWeight: 600, color: 'var(--c-warn-text)' }}>{children}</span>
    </div>
  );
  const Wordmark = () => <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--c-text)' }}>Stockpile</span>;
  const AppStore = () => (
    <span style={{ justifySelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 8, height: 50, padding: '0 16px', borderRadius: 10, background: 'var(--c-text)', color: 'var(--c-bg)' }} aria-label="Download on the App Store">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={APPLE} /></svg>
      <span style={{ display: 'grid', lineHeight: 1.05 }}><span style={{ fontSize: 10 }}>Download on the</span><span style={{ fontSize: 19, fontWeight: 700 }}>App Store</span></span>
    </span>
  );

  // 1-A · The invite arrival as first approved (2026-10-14), before the preview was limited to
  // {name, inviter, reason}. Archive only: superseded by ArrivalB the same day.
  function Arrival({ t, web }) {
    return (
      <Page t={t} top={web ? 40 : 56} label={`${web ? 'Web' : 'App'} invite arrival, as first approved, ${t}`}>
        {web ? <Wordmark /> : null}
        <Av init={LG.init} size={56} />
        <Title>{LG.inviter} invited you to {LG.name}</Title>
        <Facts />
        <SignIns />
      </Page>
    );
  }

  // 2 · Username, pre-filled (one screen after ANY sign-in)
  function Username({ t, value, web, confirmed }) {
    return (
      <Page t={t} top={web ? 40 : 56} label={`Pick a username, ${value}, ${t}`}>
        {web ? <Wordmark /> : <span className="dr-call dr-muted" style={{ fontSize: 15 }}>Sign out</span>}
        {confirmed ? <span className="dr-chip" style={{ justifySelf: 'start', background: 'var(--c-gain-tint)', color: 'var(--c-gain)' }}><Icon d={ICON.check} size={14} width={2.6} />Email confirmed</span> : null}
        <span style={{ display: 'grid', gap: 6 }}><Title>Pick a username</Title><Sub>Shown to your league on standings and matchups</Sub></span>
        <span style={{ display: 'grid', gap: 6 }}>
          <span className="dr-cap" style={{ fontWeight: 700 }}>Username</span>
          <span style={{ height: 50, borderRadius: 12, background: 'var(--c-inset)', boxShadow: 'inset 0 0 0 1.5px var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text)' }}>{value}</span>
            <span style={{ color: 'var(--c-gain)', display: 'flex' }}><Icon d={ICON.check} size={20} width={2.6} /></span>
          </span>
          <span className="dr-cap">You can change it later in Profile.</span>
        </span>
        <span style={{ display: 'grid', gap: 10 }}><Btn>Keep</Btn><Btn kind="line">Change</Btn></span>
      </Page>
    );
  }

  // 3 · "You're in {league}" (YoureIn, below with the arrival), then the pre-draft Home with the week-window tip
  function PreDraftTip({ t }) {
    return (
      <Th t={t}>
        <Device tab="home" full label={`Pre-draft Home with the week-window tip, ${t}`}>
          <Head chip={<span className="dr-chip"><span className="dr-dot" />Pre-draft</span>} />
          <div style={{ padding: `0 ${G}px 24px`, display: 'grid', gap: 16 }}>
            <div className="dr-a-card" style={{ padding: '12px 8px 12px 14px', display: 'grid', gridTemplateColumns: '22px 1fr 44px', gap: 10, alignItems: 'center' }}>
              <span style={{ color: 'var(--c-accent)', display: 'flex' }}><Icon d={ICON.info} size={20} /></span>
              <span className="dr-call" style={{ fontSize: 15, lineHeight: '21px', color: 'var(--c-text)' }}>Your week runs Monday's open to Friday's close. Best performance wins.</span>
              <span className="dr-muted" style={{ display: 'grid', placeItems: 'center', height: 44 }} aria-label="Dismiss"><Icon d={ICON.close} size={18} /></span>
            </div>
            <div className="dr-a-card" style={{ padding: 18, display: 'grid', gap: 8 }}>
              <span className="dr-tag" style={{ color: 'var(--c-live-text)' }}>Draft</span>
              <span className="dr-score" style={{ fontSize: 32, lineHeight: '36px' }}>2d 06h 40m</span>
              <span className="dr-call" style={{ fontWeight: 700 }}>{LG.draft}</span>
              <span className="dr-cap">60-second picks · 6 rounds</span>
              <Btn style={{ marginTop: 6 }}>Build your queue</Btn>
            </div>
          </div>
        </Device>
      </Th>
    );
  }

  // 4 · The push pre-prompt, then the iOS sheet
  function Push({ t, ios }) {
    return (
      <Th t={t}>
        <Device noTabs full label={`Notifications ask${ios ? ', iOS sheet' : ''}, ${t}`} overlay={ios ? (
          <div style={{ position: 'absolute', inset: 0, background: 'var(--c-scrim)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
            <div style={{ width: 270, borderRadius: 14, background: 'var(--c-surface)', boxShadow: 'inset 0 0 0 1px var(--d-rim)', textAlign: 'center', overflow: 'hidden' }}>
              <div style={{ padding: '18px 16px 16px', display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text)' }}>“Stockpile” Would Like to Send You Notifications</span>
                <span className="dr-cap" style={{ fontSize: 13 }}>Notifications may include alerts, sounds, and icon badges. These can be configured in Settings.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--c-line)' }}>
                <span style={{ padding: 12, color: 'var(--c-you-text)', fontSize: 17, borderRight: '1px solid var(--c-line)' }}>Don't Allow</span>
                <span style={{ padding: 12, color: 'var(--c-you-text)', fontSize: 17, fontWeight: 700 }}>Allow</span>
              </div>
            </div>
          </div>
        ) : null}>
          <div style={{ padding: `140px ${G}px 32px`, display: 'grid', gap: 18 }}>
            <Disc d={BELL} fill="var(--c-accent-tint)" ink="var(--c-accent)" size={72} />
            <span style={{ textAlign: 'center' }}><Title size={24}>Turn on notifications so you don't miss the draft room opening or your turn.</Title></span>
            <Btn>Continue</Btn>
            <Link pre="">Not now</Link>
          </div>
        </Device>
      </Th>
    );
  }

  // 5 · The three cards, A (2026-09-29 scenes) vs B (the W4 Game Night scenes)
  const CARD_TITLES = ['Fantasy football, but with stocks.', 'Draft real stocks. Face one friend each week.', "Best performance by Friday's close wins."];
  const TILES = [['NVDA', 'TEC', 'tech'], ['AAPL', 'TEC', 'tech'], ['CRM', 'TEC', 'tech'], ['TSLA', 'AUT', 'transport'], ['COST', 'RTL', 'retail'], ['V', 'FIN', 'finance']];
  /** The Matchup scoreboard is drawn for a 362pt phone width; inside a card's panel it keeps that
   * layout and scales down whole (names and totals never re-wrap). */
  const Fitted = ({ children }) => (
    <div style={{ width: 362 * 0.86, height: 'auto' }}><div style={{ width: 362, transform: 'scale(0.86)', transformOrigin: 'top left', marginBottom: -24 }}>{children}</div></div>
  );
  function Scene({ i, v }) {
    if (i === 0) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: v === 'A' ? 10 : 6, width: '100%' }}>
          {TILES.map(([tk, code, cat], k) => v === 'A' ? (
            <span key={tk} style={{ height: 70, borderRadius: 10, background: 'var(--c-surface)', display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 2 }}>
              <span className="dr-cap" style={{ fontWeight: 700 }}>Rd {k + 1}</span><span className="dr-t" style={{ fontSize: 15 }}>{tk}</span>
            </span>
          ) : (
            <span key={tk} style={{ height: 56, borderRadius: 5, background: 'var(--c-surface)', boxShadow: `inset 0 -3px 0 var(--d-cat-${cat})`, padding: '5px 7px', display: 'grid', alignContent: 'space-between' }}>
              <span className="dr-num dr-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}><span>{k + 1}</span><span>{code}</span></span>
              <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--c-text)' }}>{tk}</span>
            </span>
          ))}
        </div>
      );
    }
    if (i === 1) {
      if (v === 'B') return <Fitted><Scoreboard d="a" /></Fitted>;
      return (
        <div style={{ display: 'grid', gap: 14, width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Av init="RB" you size={64} /><span className="dr-score" style={{ fontSize: 40 }}>VS</span><span className="dr-av" style={{ width: 64, height: 64, fontSize: 22, background: 'var(--c-opp)', color: 'var(--c-on-opp)' }}>GB</span></div>
          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 }}><span style={{ flex: 0.7, background: 'var(--c-you)' }} /><span style={{ flex: 0.3, background: 'var(--c-track)' }} /></div>
          <span className="dr-tag dr-muted" style={{ textAlign: 'center' }}>Week 6 · Mon–Fri</span>
        </div>
      );
    }
    if (v === 'B') return <div style={{ width: '100%', display: 'grid', gap: 12, justifyItems: 'center' }}><FinalChip /><Fitted><Scoreboard d="a" final /></Fitted><span style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)' }}>You win Week 6</span></div>;
    return (
      <div style={{ display: 'grid', gap: 12, width: '100%', justifyItems: 'center' }}>
        <FinalChip />
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}><span className="dr-score" style={{ fontSize: 32 }}>+$351.77</span><span className="dr-score" style={{ fontSize: 32 }}>−$38.88</span></div>
        <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)' }}>You win Week 6</span>
      </div>
    );
  }
  function Card({ t, i, v, still }) {
    return (
      <Th t={t}>
        <Device noTabs full label={`Onboarding card ${i + 1}, ${v}, ${t}`}>
          <div style={{ padding: `56px ${G}px 32px`, display: 'grid', gap: 22 }}>
            <span className="dr-call dr-muted" style={{ justifySelf: 'end', fontSize: 15, minHeight: 24 }}>{still ? '' : 'Skip'}</span>
            <div style={{ height: 300, borderRadius: 20, background: 'var(--c-inset)', display: 'grid', placeItems: 'center', padding: 18 }}><Scene i={i} v={v} /></div>
            <Title size={30}>{CARD_TITLES[i]}</Title>
            {still ? null : <>
              <div style={{ display: 'flex', gap: 6 }}>{CARD_TITLES.map((_, k) => <span key={k} style={{ height: 6, width: k === i ? 22 : 6, borderRadius: 3, background: k === i ? 'var(--c-text)' : 'var(--c-line)' }} />)}</div>
              <Btn>{i === 2 ? 'Get started' : 'Next'}</Btn>
            </>}
          </div>
        </Device>
      </Th>
    );
  }

  // 6 · Get started (the cold path)
  function GetStarted({ t }) {
    const Choice = ({ d, title, desc }) => (
      <div className="dr-a-card" style={{ padding: 16, display: 'grid', gridTemplateColumns: '48px 1fr 18px', gap: 14, alignItems: 'center' }}>
        <span style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--c-inset)', color: 'var(--c-text)', display: 'grid', placeItems: 'center' }}><Icon d={d} size={24} /></span>
        <span style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text)' }}>{title}</span><span className="dr-cap" style={{ fontSize: 14 }}>{desc}</span></span>
        <span className="dr-muted" style={{ display: 'flex' }}><Icon d={ICON.right} size={18} /></span>
      </div>
    );
    return (
      <Page t={t} label={`Get started, ${t}`}>
        <Wordmark />
        <span style={{ display: 'grid', gap: 6 }}><Title>Get started</Title><Sub>Start a league for your friends, or join one with a code.</Sub></span>
        <Choice d={ICON.plus} title="Create a league" desc="Pick the rules, invite friends, set the draft." />
        <Choice d={ICON.league} title="Join with a code" desc="Got a code from a friend? Enter it here." />
        <Link pre="Already have an account? ">Sign in</Link>
      </Page>
    );
  }

  // ── 1 and 7 · The invite arrival (Giorgio, 2026-10-14: B). Before sign-in the no-session preview
  // returns only {name, inviter, reason}, so the page shows the league's name and the inviter and
  // nothing else. The facts move to "You're in" (C1). ──
  const B_REFUSE = {
    full: `${LG.name} is full. Ask whoever invited you if they can make room.`,
    closed: `${LG.name} isn't taking new players right now.`,
    dead: "This invite link doesn't work anymore. Ask for a new one.",
  };
  /** Heading by what the preview returned: the inviter and the name, or the name only. */
  const inviteTitle = (who) => who === 'name' ? `You're invited to ${LG.name}` : `${LG.inviter} invited you to ${LG.name}`;
  /** The invite block sits centred above the actions; the actions keep the thumb's reach at the bottom.
   * 786 = the 874pt phone less the status bar (54) and the home indicator (34); the -66 hands back
   * the Device's own 100pt bottom pad so the frame stays 874pt tall. */
  /** A dead link has no heading (the Planner, 2026-10-14): the panel and "Sign in", centred. */
  function ArrivalB({ t, web, who = 'both', block }) {
    const dead = block === 'dead';
    const refusal = block ? <div style={{ display: 'grid', gap: 16, alignContent: 'center' }}><Warn>{B_REFUSE[block]}</Warn><Link pre="">Sign in</Link></div> : null;
    return (
      <Th t={t}>
        <Device noTabs full label={`${web ? 'Web' : 'App'} invite arrival${block ? `, refusal ${block}` : ''}${who === 'name' ? ', no inviter' : ''}, ${t}`}>
          <div style={{ padding: `${web ? 40 : 56}px ${G}px 24px`, minHeight: 786, marginBottom: -66, boxSizing: 'border-box', display: 'grid', gridTemplateRows: `${web ? 'auto ' : ''}1fr${dead ? '' : ' auto'}`, gap: 18 }}>
            {web ? <Wordmark /> : null}
            {dead ? refusal : <>
              <div style={{ display: 'grid', gap: 16, alignContent: 'center', justifyItems: 'center', textAlign: 'center', textWrap: 'balance' }}>
                {who === 'both' ? <Av init={LG.init} size={64} /> : <Disc d={ICON.league} ink="var(--c-text-2)" size={64} />}
                <Title>{inviteTitle(who)}</Title>
              </div>
              {refusal || <SignIns />}
            </>}
          </div>
        </Device>
      </Th>
    );
  }
  function DesktopB({ t }) {
    return (
      <Th t={t}>
        <div style={{ width: 600, height: 384, overflow: 'hidden', borderRadius: 14, boxShadow: '0 0 0 1px var(--d-rim)' }} role="img" aria-label={`Web invite page, desktop, name and inviter only, ${t}`}>
          <div style={{ width: 1000, height: 640, transform: 'scale(0.6)', transformOrigin: 'top left', background: 'var(--c-bg)', padding: '28px 40px', boxSizing: 'border-box', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
            <Wordmark />
            <div style={{ display: 'grid', placeItems: 'center' }}>
              <div style={{ width: 400, display: 'grid', gap: 18 }}>
                <span style={{ display: 'grid', gap: 16, justifyItems: 'center', textAlign: 'center', marginBottom: 14 }}><Av init={LG.init} size={64} /><Title>{inviteTitle('both')}</Title></span>
                <SignIns />
              </div>
            </div>
          </div>
        </div>
      </Th>
    );
  }
  /** The facts once the friend is a member (readable under the league's own rules). */
  const JOINED = { managers: '6 of 6' };
  const FactRows = ({ rows }) => (
    <div className="dr-a-card" style={{ padding: '4px 16px' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12 }}>
          <span className="dr-call dr-muted" style={{ fontSize: 15 }}>{k}</span>
          <span className="dr-call" style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
  /** "You're in" carries the facts (C1): the app keeps its draft sentence (so no Draft row); the web page has none, so it keeps the row. */
  function YoureIn({ t, web }) {
    const rows = [['Managers', JOINED.managers], ...(web ? [['Draft', LG.draft]] : []), ['Stakes', LG.stakes], ['Season', LG.season]];
    return (
      <Page t={t} top={web ? 40 : 96} gap={18} label={`You're in with the league's facts, ${web ? 'web' : 'app'}, ${t}`}>
        {web ? <Wordmark /> : null}
        <Disc d={ICON.check} fill="var(--c-you)" ink="var(--c-on-you)" size={72} />
        <span style={{ textAlign: 'center', display: 'grid', gap: 8 }}>
          <Title>{web ? `You're in ${LG.name}.` : `You're in ${LG.name}`}</Title>
          <Sub>{web ? 'Get the app to draft and play.' : `The draft is ${LG.draft}. The draft order is set an hour before.`}</Sub>
        </span>
        <FactRows rows={rows} />
        {web ? <AppStore /> : <Btn>Go to the league</Btn>}
      </Page>
    );
  }
  /** C2 (not picked) · the facts as a card on the pre-draft Home, under the draft card. */
  function PreDraftFacts({ t }) {
    return (
      <Th t={t}>
        <Device tab="home" full label={`Pre-draft Home with the league's facts, ${t}`}>
          <Head chip={<span className="dr-chip"><span className="dr-dot" />Pre-draft</span>} />
          <div style={{ padding: `0 ${G}px 24px`, display: 'grid', gap: 16 }}>
            <div className="dr-a-card" style={{ padding: 18, display: 'grid', gap: 8 }}>
              <span className="dr-tag" style={{ color: 'var(--c-live-text)' }}>Draft</span>
              <span className="dr-score" style={{ fontSize: 32, lineHeight: '36px' }}>2d 06h 40m</span>
              <span className="dr-call" style={{ fontWeight: 700 }}>{LG.draft}</span>
              <span className="dr-cap">60-second picks · 6 rounds</span>
              <Btn style={{ marginTop: 6 }}>Build your queue</Btn>
            </div>
            <FactRows rows={[['Managers', JOINED.managers], ['Stakes', LG.stakes], ['Season', LG.season]]} />
          </div>
        </Device>
      </Th>
    );
  }
  /** Reviewer notes sit under the phone, never inside it (Giorgio, 2026-10-14: a stamp drawn in
   * the mock read as something users would see). */
  const NOTE_A = "The box with Managers, Draft, Stakes and Season can't be filled before sign-in: privacy rule.";
  function CallArrival({ archived }) {
    const quad = (key, cap, F, note) => ['dark', 'light'].map((t) => fig(`${key}${t}`, `${cap} · ${t === 'dark' ? 'Dark' : 'Light'}`, <F t={t} />, note));
    return (
      <Sec id="call-ob-arrival" n="1.3" title={archived ? 'Decided: B with C1, the invite arrival before sign-in' : 'Your call: the invite arrival before sign-in'}
        intro={<>Frame 1 (and the web page, frame 7) was approved with the league's facts under the invite: Managers, Draft, Stakes, Season. Before someone signs in, the app may only ask the server for the league's name, the inviter and why a link can't be used (the Planner's security ruling for the no-sign-in preview), so nothing can fill those facts at that point. A couldn't ship; B is what can. The facts move to the first moment the friend is signed in and a member (C1 or C2).</>}
        notes={<>
          <li><b>A · as first approved:</b> the invite, the four facts, then the sign-in buttons. The facts card is the part nothing can fill before sign-in.</li>
          <li><b>B:</b> "{'{inviter}'} invited you to {'{league}'}" over the inviter's initials, then Continue with Apple, Continue with Google, Use email. Nothing else. The invite sits centred and the three buttons at the bottom, within the thumb's reach. With no inviter: "You're invited to {'{league}'}", with the league icon in place of initials.</li>
          <li><b>B · when the link can't be used:</b> the warning panel in the buttons' place, then "Sign in": "{'{league}'} is full. Ask whoever invited you if they can make room." / "{'{league}'} isn't taking new players right now." / "This invite link doesn't work anymore. Ask for a new one." A dead link has no heading (the Planner, 2026-10-14).</li>
          <li><b>C1:</b> "You're in {'{league}'}" gains a card with Managers, Stakes and Season; the web page adds a Draft row because it has no draft sentence. <b>C2:</b> the same card under the draft card on the pre-draft Home.</li>
          <li><b>Recommended: B, with C1.</b> "You're in" is one screen after the old frame and answers the same question at the first moment the app can: what did I just join? C2 would change the approved, built Home.</li>
          {archived ? <li><b>Decided by Giorgio (2026-10-14): B, with C1.</b> The Planner added two copy rulings the same day: a dead link shows only the panel and "Sign in"; and inside the invite-link flow a "full" refusal after the join also says "Ask whoever invited you", while the shipped "Ask your commissioner" stays everywhere else.</li> : null}
        </>}>
        <h3 className="b-sub">A · as first approved (can't ship: no data before sign-in)</h3>
        <Grid>{[...quad('aa', 'A · app', Arrival, NOTE_A), ...quad('aw', 'A · web', (p) => <Arrival {...p} web />, NOTE_A)]}</Grid>
        <h3 className="b-sub">B · the name and the inviter, then the three sign-ins</h3>
        <Grid>{[...quad('ba', 'B · app', ArrivalB), ...quad('bw', 'B · web', (p) => <ArrivalB {...p} web />)]}</Grid>
        <h3 className="b-sub">C1 · "You're in" carries the facts (app, then web)</h3>
        <Grid>{[...quad('c1a', "C1 · You're in · app", YoureIn), ...quad('c1w', "C1 · You're in · web", (p) => <YoureIn {...p} web />)]}</Grid>
        <h3 className="b-sub">C2 · a card on the pre-draft Home</h3>
        <Grid>{quad('c2', 'C2 · pre-draft Home', PreDraftFacts)}</Grid>
      </Sec>
    );
  }

  // 8 · Profile, with "How it works", and its sheet
  function Profile({ t, sheet }) {
    const rows = [['Username', 'roberto_b'], ['Email', 'roberto@example.com'], ['Change password', ''], ['Appearance', 'System'], ['How it works', '']];
    return (
      <Th t={t}>
        <Device noTabs full label={`Profile${sheet ? ', How it works' : ''}, ${t}`} overlay={sheet ? (
          <div style={{ position: 'absolute', inset: 0, background: 'var(--c-scrim)', zIndex: 5, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: 'var(--c-surface)', padding: `14px ${G}px 34px`, display: 'grid', gap: 14 }}>
              <span style={{ justifySelf: 'center', width: 36, height: 5, borderRadius: 3, background: 'var(--c-line)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Title size={22}>How it works</Title><span className="dr-muted" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44 }}><Icon d={ICON.close} size={20} /></span></div>
              {CARD_TITLES.map((title, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 120, height: 88, borderRadius: 12, background: 'var(--c-inset)', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 6, top: 6, width: 362, transform: 'scale(0.3)', transformOrigin: 'top left' }}><Scene i={i} v="B" /></div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, lineHeight: '21px', color: 'var(--c-text)' }}>{title}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}>
          <div style={{ padding: `56px ${G}px 32px`, display: 'grid', gap: 16 }}>
            <span className="dr-call" style={{ color: 'var(--c-accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><Icon d={ICON.left} size={18} width={2.4} />Home</span>
            <span style={{ display: 'grid', justifyItems: 'center', gap: 8 }}><Av init="RB" you size={64} /><Title size={22}>roberto_b</Title></span>
            <div className="dr-a-card" style={{ padding: '4px 16px' }}>
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, gap: 10 }}>
                  <span className="dr-call" style={{ fontSize: 16, color: 'var(--c-text)' }}>{k}{k === 'How it works' ? <NEW /> : null}</span>
                  <span className="dr-call dr-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15 }}>{v}{k === 'Email' ? null : <Icon d={ICON.right} size={16} />}</span>
                </div>
              ))}
            </div>
            <div className="dr-a-card" style={{ padding: '4px 16px' }}><div style={{ minHeight: 50, display: 'flex', alignItems: 'center' }}><span className="dr-call" style={{ fontSize: 16, color: 'var(--c-danger)', fontWeight: 700 }}>Sign out</span></div></div>
          </div>
        </Device>
      </Th>
    );
  }

  // 9 · The email path: check your inbox, then the return
  function CheckEmail({ t, invite = true }) {
    return (
      <Page t={t} top={120} gap={16} label={`Check your email after sign-up${invite ? ', with an invite' : ', no invite'}, ${t}`}>
        <Disc d={MAIL} size={72} />
        <span style={{ textAlign: 'center', display: 'grid', gap: 8 }}>
          <Title>Check your email</Title>
          <Sub>{invite ? `We sent a link to roberto@example.com. Tap it to finish joining ${LG.name}.` : 'We sent a link to roberto@example.com. Tap it to finish creating your account.'}</Sub>
        </span>
        <Btn kind="line">Didn't receive it? Send again</Btn>
      </Page>
    );
  }

  // 10 · The one no-league state (Home, Matchup, League, Portfolio)
  function NoLeague({ t, tab = 'home' }) {
    return (
      <Th t={t}>
        <Device tab={tab} full label={`No leagues, ${tab}, ${t}`}>
          <div className="ks-head" style={{ paddingInline: G }}><span /><Av init="RB" you size={34} /></div>
          <div style={{ padding: `120px ${G}px 24px`, display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center' }}>
            <Disc d={ICON.league} ink="var(--c-text-2)" size={72} />
            <Title size={24}>No leagues yet</Title>
            <Sub>Create or join a league to get started.</Sub>
            <Btn style={{ marginTop: 8 }}>Create a league</Btn>
            <Btn kind="line">Join with a code</Btn>
          </div>
        </Device>
      </Th>
    );
  }

  // ── Layout helpers ──
  const fig = (key, cap, node, note) => (
    <figure key={key} className="b-fig b-fig--inv" style={{ margin: 0 }}><Fit>{node}</Fit><figcaption><b>{cap}</b>{note ? <span className="b-annot">Review note: {note}</span> : null}</figcaption></figure>
  );
  const pair = (key, cap, F) => [fig(`${key}d`, `${cap} · Dark`, <F t="dark" />), fig(`${key}l`, `${cap} · Light`, <F t="light" />)];
  const Sec = ({ id, n, title, intro, notes, children }) => (
    <section className="b-sec" id={id} aria-labelledby={`${id}-h`}>
      <header className="b-sec__head">
        <span className="b-sec__n b-sec__n--code">{n}</span>
        <div><h2 id={`${id}-h`}>{title}</h2>{intro ? <p className="b-job">{intro}</p> : null}</div>
      </header>
      {notes ? <ul className="b-inv__notes">{notes}</ul> : null}
      {children}
    </section>
  );
  const Grid = ({ children }) => <div className="b-concepts b-concepts--three">{children}</div>;

  // ── Giorgio's two calls ──
  function CallCards({ archived }) {
    return (
      <Sec id="call-ob-cards" n="1.3" title={archived ? "Decided: B, the three cards' scenes" : "Your call: the three cards' scenes"}
        intro={<>The cards show only on a cold install (your "B, cards only for cold installs"), with your titles, unchanged since 2026-09-29. What changes is the picture above each title. A is the scene you approved on 2026-09-29; B is the scene the W4 build drew from the approved Game Night pieces. Both are drawn in Game Night colours, so only the content differs.</>}
        notes={<>
          <li><b>A · the 2026-09-29 scenes:</b> six "Rd 1…6" squares; your avatar vs Gianluigi's with "VS" and a tug bar, "Week 6 · Mon–Fri"; FINAL with the two scores and "You win Week 6".</li>
          <li><b>B · the Game Night scenes:</b> the real draft squares (category line, 3-letter code); the real Matchup scoreboard, your half shaded, where the lead changes as the card opens ("Gianluigi B. leads by $37.66" turns into "Roberto B. leads by $123.16"); FINAL with the real scoreboard and "You win Week 6". No VS, no tug bar.</li>
          <li><b>Recommended: B.</b> Each card shows the screen you'll actually see a minute later, so the first run teaches the app instead of a poster of it.</li>
          {archived ? <li><b>Decided by Giorgio (2026-10-14): B</b>, the real screens.</li> : null}
        </>}>
        {['dark', 'light'].map((t) => ['A', 'B'].map((v) => (
          <div key={t + v} style={{ marginBottom: 20 }}>
            <h3 className="b-sub">{v} · {v === 'A' ? 'the 2026-09-29 scenes' : 'the Game Night scenes'} · {t === 'dark' ? 'Dark' : 'Light'}</h3>
            <Grid>{[0, 1, 2].map((i) => fig(`${t}${v}${i}`, `Card ${i + 1}`, <Card t={t} i={i} v={v} />))}</Grid>
          </div>
        )))}
      </Sec>
    );
  }
  // Giorgio's style (2026-10-14): {adjective or word}{Animal}{digits}; 3–20 letters/digits, never a name.
  const GAMERTAGS = ['HelpfulHornet151', 'BoldBadger27', 'SwiftOtter904'];
  const NAMES = [['A', 'Roberto26', 'your first name + two digits (the app\'s suggestions already work this way)'], ['B', 'RobertoB', 'your first name + your last initial'], ['C', 'BullMarket47', 'a game-style name, no name of yours']];
  function CallUsername({ archived }) {
    return (
      <Sec id="call-ob-username" n="1.3" title={archived ? "Decided: none of the three; a gamertag (adjective + animal + digits)" : "Your call: the suggested username's style"}
        intro={<>After any sign-in, one screen offers a ready-made username with one tap to keep it (your "a pre-set username that they can just go with and they can change later"). Which style should the suggestion be? Roberto signed in with Apple or Google, which gave his first name.</>}
        notes={<>
          {NAMES.map(([k, v, d]) => <li key={k}><b>{k} · {v}:</b> {d}.</li>)}
          <li><b>When there's no first name</b> (email sign-up, or Apple's "Hide My Email" with no name), A and B can't be built, so the suggestion falls back to C's style.</li>
          <li><b>Recommended: A.</b> In a league of friends, a name people recognise beats a clever one, and the app's "taken" suggestions already use this pattern ("Roberto" → "Roberto26").</li>
          <li><NEW /> "You can change it later in Profile." under the field. "Keep" and "Change" are the plan's words.</li>
          {archived ? <li><b>Decided by Giorgio (2026-10-14): none of these.</b> An Xbox-style gamertag, an adjective or word, then an animal, then digits ("helpedhornet151"), and never the first name: "we don't know if users want to keep their name visible. So let's not expose their first names". The helper line is approved. The new samples are frame 2 of the onboarding frames.</li> : null}
        </>}>
        {['dark', 'light'].map((t) => (
          <div key={t} style={{ marginBottom: 20 }}>
            <h3 className="b-sub">{t === 'dark' ? 'Dark' : 'Light'}</h3>
            <Grid>{NAMES.map(([k, v]) => fig(`${t}${k}`, `${k} · ${v}`, <Username t={t} value={v} />))}</Grid>
          </div>
        ))}
      </Sec>
    );
  }

  // ── The W1 frames ──
  function Frames() {
    return (
      <Sec id="onboarding-w1" n="1.3" title="Onboarding, as planned (2026-10-14): the frames"
        intro={<>The plan's board brief, frames 1 to 10, in Game Night, Light and Dark. The flow: an invited friend taps the link, lands on the invite, signs in with one tap, keeps the suggested username, and is in the league; then the notifications ask. A cold install sees the cards and Get started. Giorgio picked the cards (B), the username style (a gamertag, never a name) and the invite arrival (B, with the facts on "You're in": C1) on 2026-10-14; all three calls are in the Archive.</>}
        notes={<>
          <li><b>Copy:</b> "{'{inviter}'} invited you to {'{league}'}", "Continue with Apple / Google", "Use email", "Keep / Change", "You're in {'{league}'}. Get the app to draft and play.", the notifications line, the week-window line and "How it works" are the approved plan's words. Everything else is shipped copy except what's marked NEW.</li>
          <li><b>Approved by Giorgio (2026-10-14, via the Planner: "fine"):</b> "Not now" under the notifications ask (a decline there is never pre-prompted again; Settings still reaches it).</li>
          <li><b>Approved (2026-10-14):</b> Check your email after an email sign-up, "We sent a link to {'{email}'}. Tap it to finish joining {'{league}'}." with an invite, or "… Tap it to finish creating your account." with none; and the "Email confirmed" chip on the return.</li>
          <li><b>The week-window tip</b> follows PRODUCT_RULES "Generic scoring copy" (onboarding says "best performance wins", never "biggest dollar gain"): "Your week runs Monday's open to Friday's close. Best performance wins." The plan's draft line ("Best dollar gain wins.") is not used.</li>
          <li><b>Before sign-in, the league's name and the inviter only</b> (Giorgio, 2026-10-14: B). When the link can't be used, the warning panel and "Sign in" (approved via the Planner): "{'{league}'} is full. Ask whoever invited you if they can make room." / "{'{league}'} isn't taking new players right now." (the room has opened, or the season is over) / "This invite link doesn't work anymore. Ask for a new one." (no heading). A "full" refusal after the join, in this flow only, uses the same "whoever invited you" line.</li>
          <li><b>The facts are on "You're in"</b> (Giorgio, 2026-10-14: C1): Managers, Stakes, Season; the web page adds Draft.</li>
          <li><b>Reference:</b> the plan names Yahoo's "Marvin has invited you…" screen; I don't have that screenshot, so frame 1 stands without its reference. Send it and I'll pair them.</li>
        </>}>
        <h3 className="b-sub">1 · Invite arrival, in the app: the league's name and the inviter, nothing else before sign-in (Giorgio, 2026-10-14: B)</h3>
        <Grid>{pair('a1', 'Invite arrival', ArrivalB)}</Grid>
        <Grid>{pair('a2', 'Invite arrival · no inviter', (p) => <ArrivalB {...p} who="name" />)}</Grid>
        <Grid>{pair('a3', 'Refusal: full', (p) => <ArrivalB {...p} block="full" />)}</Grid>
        <Grid>{pair('a4', 'Refusal: not taking new players', (p) => <ArrivalB {...p} block="closed" />)}</Grid>
        <Grid>{pair('a5', 'Refusal: a dead link', (p) => <ArrivalB {...p} block="dead" />)}</Grid>
        <h3 className="b-sub">2 · Pick a username, pre-filled with a gamertag (Giorgio, 2026-10-14): an adjective or word, an animal, digits; never the first name</h3>
        {['dark', 'light'].map((t) => <Grid key={t}>{GAMERTAGS.map((g) => fig(`u${t}${g}`, `${g} · ${t === 'dark' ? 'Dark' : 'Light'}`, <Username t={t} value={g} />))}</Grid>)}
        <h3 className="b-sub">3 · You're in, with the league's facts (Giorgio, 2026-10-14: C1), then the pre-draft Home with the week-window tip (once, dismissable)</h3>
        <Grid>{pair('y1', "You're in", YoureIn)}</Grid>
        <Grid>{pair('h1', 'Pre-draft Home, the tip', PreDraftTip)}</Grid>
        <h3 className="b-sub">4 · The notifications ask (after joining or creating a league), then the iOS sheet</h3>
        <Grid>{pair('p1', 'The ask', Push)}</Grid>
        <Grid>{pair('p2', 'The iOS sheet', (p) => <Push {...p} ios />)}</Grid>
        <h3 className="b-sub">5 · The cards, B (Giorgio, 2026-10-14): the real screens, cold install only</h3>
        {['dark', 'light'].map((t) => <Grid key={t}>{[0, 1, 2].map((i) => fig(`c${t}${i}`, `Card ${i + 1} · ${t === 'dark' ? 'Dark' : 'Light'}`, <Card t={t} i={i} v="B" />))}</Grid>)}
        <h3 className="b-sub">6 · Get started (cold install only)</h3>
        <Grid>{pair('g1', 'Get started', GetStarted)}</Grid>
        <h3 className="b-sub">7 · The web invite page: phone width (arrival, username, You're in + Get the app, three refusals) and desktop</h3>
        <Grid>{pair('w1', 'Web · arrival', (p) => <ArrivalB {...p} web />)}</Grid>
        <Grid>{pair('w2', 'Web · username', (p) => <Username {...p} web value="HelpfulHornet151" />)}</Grid>
        <Grid>{pair('w3', "Web · You're in + Get the app", (p) => <YoureIn {...p} web />)}</Grid>
        <Grid>{pair('w4', 'Web · refusal: full', (p) => <ArrivalB {...p} web block="full" />)}</Grid>
        <Grid>{pair('w5', 'Web · refusal: not taking new players', (p) => <ArrivalB {...p} web block="closed" />)}</Grid>
        <Grid>{pair('w6', 'Web · refusal: a dead link', (p) => <ArrivalB {...p} web block="dead" />)}</Grid>
        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 600px))', marginBottom: 18 }}>
          {['dark', 'light'].map((t) => <figure key={t} className="b-fig b-fig--inv" style={{ margin: 0, maxWidth: 600 }}><DesktopB t={t} /><figcaption><b>Web · desktop · {t === 'dark' ? 'Dark' : 'Light'}</b></figcaption></figure>)}
        </div>
        <h3 className="b-sub">8 · "How it works" in Profile, and its sheet (the three cards, still; scenes follow your pick)</h3>
        <Grid>{pair('f1', 'Profile', Profile)}</Grid>
        <Grid>{pair('f2', 'How it works', (p) => <Profile {...p} sheet />)}</Grid>
        <h3 className="b-sub">9 · The email path: check your inbox, then the link brings you back exactly here</h3>
        <Grid>{pair('e1', 'Check your email · with an invite', CheckEmail)}</Grid>
        <Grid>{pair('e0', 'Check your email · no invite', (p) => <CheckEmail {...p} invite={false} />)}</Grid>
        <Grid>{pair('e2', 'The return: username', (p) => <Username {...p} value="HelpfulHornet151" confirmed />)}</Grid>
        <h3 className="b-sub">10 · No leagues: the same state on Home, Matchup, League and Portfolio</h3>
        <Grid>{pair('n1', 'No leagues (same on every tab)', NoLeague)}</Grid>
      </Sec>
    );
  }

  window.KSOnboarding = () => <Frames />; // all three calls decided (2026-10-14), archived in board.jsx
  window.KSObCardsArchived = () => <CallCards archived />;
  window.KSObUsernameArchived = () => <CallUsername archived />;
  window.KSObArrivalArchived = () => <CallArrival archived />;
})();
