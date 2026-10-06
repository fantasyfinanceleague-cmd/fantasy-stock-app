// Step 2: the full screen inventory (Design Lead, 2026-09-29). Every screen
// the mobile phases 3b-1 / 3b-2 / 3c / 3e build, plus the 3d web shell.
// Same building blocks (window.KSKit), same league, same people, same money
// rules as the key screens. Existing app wording is kept verbatim (casing
// normalised to sentence case); new copy is marked on the board.

(function () {
  const { useState } = React;
  const K = window.KS;
  const { Device, Chip, Icon, ICON, Logo, Scores, Tug, SD, margin, $, $s, pct, tone } = window.KSKit;
  const BRAND = 'Stockpile'; // brand.name placeholder (naming deferred)

  // Secure fields render as bullets, so a mock password is only a length.
  // Never put credential-looking strings here (secret scanners flag them).
  const MASK = (n) => 'x'.repeat(n);
  // The server's real password policy (5 rules), labels verbatim from the app.
  const PASSWORD_RULES_OK = [[true, 'At least 8 characters'], [true, 'A lowercase letter (a–z)'], [true, 'An uppercase letter (A–Z)'], [true, 'A number (0–9)'], [true, 'A symbol (! ? @ # …)']];

  // ── Small shared pieces ───────────────────────────────────────────────
  // The league pill with its "+N more leagues" hint (Concept B, decided).
  const Pill = ({ name = K.LEAGUE.name }) => (
    <span className="ks-pill"><span>{name}</span><span className="ks-pill__more" aria-label={`${K.OTHER_LEAGUES.length} more leagues`}>+{K.OTHER_LEAGUES.length}</span><Icon d={ICON.chevron} size={14} width={2.6} /></span>
  );
  const Head = ({ name, chip, avatar }) => (
    <div className="ks-head">
      <Pill name={name} />
      {chip}
      {avatar ? <span className="ks-avatar">RB</span> : null}
    </div>
  );
  const Back = ({ label = 'Back', right }) => (
    <div className="ks-head">
      <span className="ks-muted" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <span style={{ transform: 'rotate(180deg)', display: 'flex' }}><Icon d={ICON.right} size={20} /></span>
        <span className="ks-callout">{label}</span>
      </span>
      {right || null}
    </div>
  );
  const Field = ({ label, value, placeholder, error, helper, focused, secure, rules }) => (
    <label className="ks-field">
      <span className="ks-field__label">{label}</span>
      <span className={['ks-field__box', focused ? 'is-focus' : '', error ? 'is-error' : ''].join(' ')}>
        <span className={value ? '' : 'ks-muted'}>{value ? (secure ? '•'.repeat(value.length) : value) : placeholder}</span>
        {focused ? <span className="ks-caret ks-caret--dark" /> : null}
      </span>
      {error ? <span className="ks-field__error">{error}</span> : null}
      {helper ? <span className="ks-caption">{helper}</span> : null}
      {rules ? (
        <span className="ks-rules">
          {rules.map(([ok, t]) => <span key={t} className={ok ? 'ks-gain' : 'ks-muted'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon d={ok ? ICON.check : ICON.circle} size={12} width={2.6} />{t}</span>)}
        </span>
      ) : null}
    </label>
  );
  const Brand = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 20 }}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1" fill="var(--c-text-2)" /><rect x="9.75" y="9" width="4.5" height="12" rx="1" fill="var(--c-text-2)" /><rect x="16.5" y="4" width="4.5" height="17" rx="1" fill="var(--c-you)" /></svg>
      {BRAND}
    </div>
  );
  const Keyboard = () => (
    <div className="ks-kbd" aria-hidden="true">
      {['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((r) => (
        <div key={r} className="ks-kbd__row">{r.split('').map((c) => <span key={c}>{c}</span>)}</div>
      ))}
      <div className="ks-kbd__row"><span className="ks-kbd__wide">123</span><span className="ks-kbd__space">space</span><span className="ks-kbd__wide">return</span></div>
    </div>
  );
  const Empty = ({ icon, title, line, primary, secondary }) => (
    <div className="ks-card" style={{ padding: '28px 20px', display: 'grid', justifyItems: 'center', gap: 10, textAlign: 'center' }}>
      <span style={{ width: 64, height: 64, borderRadius: 32, display: 'grid', placeItems: 'center', background: 'var(--c-sunken)', color: 'var(--c-text-2)' }}><Icon d={icon} size={28} /></span>
      <span className="ks-title" style={{ fontSize: 20 }}>{title}</span>
      <span className="ks-callout ks-muted">{line}</span>
      {primary ? <span className="ks-btn" style={{ width: '100%', marginTop: 6 }}>{primary}</span> : null}
      {secondary ? <span className="ks-btn ks-btn--secondary" style={{ width: '100%' }}>{secondary}</span> : null}
    </div>
  );
  const Row = ({ k, v, sub, danger, chevron = true }) => (
    <li className="ks-row" style={{ gridTemplateColumns: '1fr auto 16px', padding: '13px 0' }}>
      <span><span className="ks-callout" style={{ fontWeight: 600, color: danger ? 'var(--c-danger)' : undefined }}>{k}</span>{sub ? <><br /><span className="ks-caption">{sub}</span></> : null}</span>
      <span className="ks-callout ks-muted ks-num">{v}</span>
      <span className="ks-muted">{chevron ? <Icon d={ICON.right} size={16} /> : null}</span>
    </li>
  );
  const Card = ({ children, pad = '2px 14px', style }) => <div className="ks-card" style={{ padding: pad, ...style }}>{children}</div>;
  const Sheet = ({ children, top = 64 }) => (
    <>
      <div className="ks-scrim" />
      <div className="ks-sheet" style={{ top }}>
        <div className="ks-grabber" />
        <div style={{ padding: '10px 20px 20px', display: 'grid', gap: 14 }}>{children}</div>
      </div>
    </>
  );
  const TROPHY = ICON.league;
  const CHECK = 'M5 12.5 10 17 19 7';
  const LOCK = 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3';
  const MAIL = 'M3 6h18v12H3zM3 7l9 7 9-7';

  // ═════════════════════════════════════════════════════════════════════
  // A. SHELL + FIRST RUN (3b-1)
  // ═════════════════════════════════════════════════════════════════════
  function SignIn() {
    return (
      <Device noTabs label="Sign in">
        <div className="ks-pad ks-stack" style={{ paddingTop: 40, gap: 22 }}>
          <Brand />
          <div>
            <h2 className="ks-head__title">Welcome back</h2>
            <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>Sign in to your league</p>
          </div>
          <Field label="Email address" value="roberto@example.com" />
          <Field label="Password" value={MASK(13)} secure focused />
          <span className="ks-callout" style={{ color: 'var(--c-accent)', fontWeight: 600, justifySelf: 'end' }}>Forgot password?</span>
          <span className="ks-btn">Sign in</span>
          <span className="ks-callout ks-muted" style={{ textAlign: 'center' }}>New here? <b style={{ color: 'var(--c-accent)' }}>Create an account</b></span>
        </div>
      </Device>
    );
  }

  /** The server's refusal while sign-ups are paused. Giorgio's final text,
   * verbatim; the product name comes from brand.name. */
  function SignUpPaused() {
    return (
      <Device noTabs label="Create account, sign-ups paused">
        <div className="ks-pad ks-stack" style={{ paddingTop: 8, gap: 14 }}>
          <div>
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>Create account</h2>
            <p className="ks-callout ks-muted" style={{ margin: '2px 0 0' }}>Join the competition</p>
          </div>
          <Field label="Username" value="roberto_b" helper="Displayed on leaderboards" />
          <Field label="Email address" value="roberto@example.com" />
          <Field label="Password" value={MASK(10)} secure rules={PASSWORD_RULES_OK} />
          <div role="alert" className="ks-card" style={{ padding: 14, display: 'grid', gap: 4, background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
            <b className="ks-callout" style={{ color: 'var(--c-text)' }}>{BRAND} is not open for new signups yet — check back soon. Existing accounts can still sign in.</b>
          </div>
          <span className="ks-btn ks-btn--secondary">Sign in instead</span>
        </div>
      </Device>
    );
  }

  function SignUp() {
    return (
      <Device noTabs label="Create account, keyboard up">
        <div className="ks-pad ks-stack" style={{ paddingTop: 8, gap: 14, paddingBottom: 330 }}>
          <div>
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>Create account</h2>
            <p className="ks-callout ks-muted" style={{ margin: '2px 0 0' }}>Join the competition</p>
          </div>
          <Field label="Username" value="roberto_b" helper="Displayed on leaderboards" />
          <Field label="Email address" value="roberto@example.com" />
          <Field label="Password" value={MASK(7)} secure focused rules={[[false, 'At least 8 characters'], [true, 'A lowercase letter (a–z)'], [true, 'An uppercase letter (A–Z)'], [false, 'A number (0–9)'], [false, 'A symbol (! ? @ # …)']]} />
        </div>
        <div className="ks-kbd-dock">
          <span className="ks-btn" style={{ margin: '0 16px 8px' }}>Create account</span>
          <Keyboard />
        </div>
      </Device>
    );
  }

  function Forgot({ sent }) {
    return (
      <Device noTabs label={sent ? 'Check your email' : 'Forgot password'}>
        <Back label="Back to sign in" />
        <div className="ks-pad ks-stack" style={{ gap: 18 }}>
          {sent ? (
            <Empty icon={MAIL} title="Check your email" line="We sent a reset link to roberto@example.com. It opens the app to set a new password." primary="Back to sign in" secondary="Didn't receive it? Send again" />
          ) : (
            <>
              <div>
                <h2 className="ks-head__title" style={{ fontSize: 28 }}>Forgot password?</h2>
                <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>Enter your email address and we'll send you a link to reset your password.</p>
              </div>
              <Field label="Email address" value="roberto@example.com" focused />
              <span className="ks-btn">Send reset link</span>
            </>
          )}
        </div>
      </Device>
    );
  }

  const ONBOARD = [
    { t: 'Fantasy football, but with stocks.', art: 'field' },
    { t: 'Draft real stocks. Face one friend each week.', art: 'versus' },
    { t: "Best performance by Friday's close wins.", art: 'final' },
  ];
  function Onboarding({ card = 0 }) {
    const c = ONBOARD[card];
    return (
      <Device noTabs game label={`Onboarding card ${card + 1}`}>
        <div className="ks-head"><span /><span className="ks-callout ks-muted">Skip</span></div>
        <div className="ks-pad" style={{ display: 'grid', gap: 26, paddingTop: 20 }} key={card}>
          <div className="ks-fade-in" style={{ height: 340, borderRadius: 20, background: 'var(--c-inset)', display: 'grid', placeItems: 'center', padding: 20 }}>
            {c.art === 'field' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, width: '100%' }}>
                {['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V'].map((t, i) => <span key={t} className="ks-cell" style={{ height: 70 }}><span className="ks-cell__n">Rd {i + 1}</span><span className="ks-cell__t">{t}</span></span>)}
              </div>
            ) : c.art === 'versus' ? (
              <div style={{ display: 'grid', gap: 14, width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ks-avatar" style={{ width: 64, height: 64, fontSize: 20 }}>RB</span><span className="ks-score" style={{ fontSize: 40, alignSelf: 'center' }}>VS</span><span className="ks-avatar ks-avatar--opp" style={{ width: 64, height: 64, fontSize: 20 }}>GB</span></div>
                <Tug you={213.6} opp={90.44} />
                <div className="ks-tag" style={{ textAlign: 'center' }}>Week 6 · Mon–Fri</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, width: '100%', textAlign: 'center' }}>
                <span className="ks-chip ks-chip--final" style={{ justifySelf: 'center' }}>Final</span>
                <Scores left="+$351.77" right="−$38.88" size="lg" />
                <div className="ks-winner" style={{ justifyContent: 'center' }}>You win Week 6</div>
              </div>
            )}
          </div>
          <h2 className="ks-score" style={{ fontSize: 44, lineHeight: '44px', margin: 0, wordSpacing: '0.12em', whiteSpace: 'normal', textWrap: 'balance' }}>{c.t}</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {ONBOARD.map((_, i) => <span key={i} style={{ height: 6, width: i === card ? 22 : 6, borderRadius: 3, background: i === card ? 'var(--c-text)' : 'var(--c-line)', transition: 'width var(--sp-motion-duration-quick) var(--sp-motion-ease-settle)' }} />)}
          </div>
          <span className="ks-btn ks-btn--ongame">{card === 2 ? 'Get started' : 'Next'}</span>
        </div>
      </Device>
    );
  }

  function GetStarted() {
    const Choice = ({ icon, t, d }) => (
      <div className="ks-card" style={{ padding: 18, display: 'grid', gridTemplateColumns: '48px 1fr 16px', gap: 14, alignItems: 'center' }}>
        <span style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}><Icon d={icon} size={24} /></span>
        <span><span className="ks-headline" style={{ fontWeight: 700 }}>{t}</span><br /><span className="ks-callout ks-muted">{d}</span></span>
        <span className="ks-muted"><Icon d={ICON.right} size={18} /></span>
      </div>
    );
    return (
      <Device noTabs label="Get started">
        <div className="ks-pad ks-stack" style={{ paddingTop: 40, gap: 16 }}>
          <Brand />
          <h2 className="ks-head__title">Get started</h2>
          <p className="ks-callout ks-muted" style={{ margin: 0 }}>Start a league for your friends, or join one with a code.</p>
          <Choice icon={ICON.plus} t="Create a league" d="Pick the rules, invite friends, set the draft." />
          <Choice icon={ICON.league} t="Join with a code" d="Got a code from a friend? Enter it here." />
        </div>
      </Device>
    );
  }

  function PickUsername() {
    return (
      <Device noTabs label="Pick a username, name taken">
        <div className="ks-pad ks-stack" style={{ paddingTop: 40, gap: 16 }}>
          <div>
            <h2 className="ks-head__title">Pick a username</h2>
            <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>Shown to your league on standings and matchups</p>
          </div>
          <Field label="Username" value="roberto" focused error="This username is already taken." rules={[[true, '3–20 characters'], [true, 'Letters, numbers and underscores']]} />
          <div>
            <div className="ks-caption" style={{ marginBottom: 6 }}>Available</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['roberto_b', 'roberto26', 'rob_bianchi'].map((s) => <span key={s} className="ks-chip ks-chip--money" style={{ height: 32, padding: '0 14px', fontSize: 14, textTransform: 'none', fontStretch: '100%', letterSpacing: 0, color: 'var(--c-text)' }}>{s}</span>)}
            </div>
          </div>
          <span className="ks-btn" style={{ opacity: 0.4 }}>Continue</span>
          <span className="ks-callout ks-muted" style={{ textAlign: 'center' }}>Sign out</span>
        </div>
      </Device>
    );
  }

  function LeagueSheet() {
    const Lg = ({ n, meta, chip, live }) => (
      <li className="ks-row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 0' }}>
        <span><span className="ks-t">{n}</span><br /><span className="ks-caption ks-num">{meta}</span></span>
        {live ? <Chip kind="live">{chip}</Chip> : <span className="ks-chip ks-chip--money">{chip}</span>}
      </li>
    );
    return (
      <Device tab="home" label="League sheet" overlay={
        <Sheet top={210}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="ks-title">Your leagues</span><span className="ks-muted"><Icon d={ICON.close} size={22} /></span></div>
          <div>
            <div className="ks-tag" style={{ color: 'var(--c-text-2)' }}>Live this week</div>
            <ul className="ks-rows">
              <li className="ks-row" style={{ gridTemplateColumns: '1fr auto 20px', padding: '12px 0' }}>
                <span><span className="ks-t">{K.LEAGUE.name}</span><br /><span className="ks-caption ks-num">2nd of 6 · 4–1</span></span>
                <Chip kind="live">Week 6</Chip>
                <span style={{ color: 'var(--c-accent)' }}><Icon d={CHECK} size={18} width={2.6} /></span>
              </li>
              <Lg n="Friday Night Stocks" meta="3rd of 8 · 1–0" chip="Week 2" live />
            </ul>
          </div>
          <div>
            <div className="ks-tag" style={{ color: 'var(--c-text-2)' }}>Upcoming</div>
            <ul className="ks-rows"><Lg n="Serie A Traders" meta="6 of 8 joined" chip="Draft Sat 7:00 PM ET" /></ul>
          </div>
          <div>
            <div className="ks-tag" style={{ color: 'var(--c-text-2)' }}>Finished</div>
            <ul className="ks-rows"><Lg n="Summer Cup" meta="Champion · 1st of 8 · 10–4" chip="Final" /></ul>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <span className="ks-btn">Create league</span>
            <span className="ks-btn ks-btn--secondary">Join with code</span>
          </div>
        </Sheet>
      }>
        <Head avatar />
        <div className="ks-pad"><div className="ks-score" style={{ fontSize: 48, fontStretch: '75%' }}>{$(K.HOME.value)}</div></div>
      </Device>
    );
  }

  function Profile() {
    return (
      <Device tab="home" label="Profile">
        <Back label="Home" />
        <div className="ks-pad ks-stack">
          <div style={{ display: 'grid', justifyItems: 'center', gap: 8, paddingTop: 6 }}>
            <span className="ks-avatar" style={{ width: 84, height: 84, fontSize: 28 }}>RB</span>
            <span className="ks-title">roberto_b</span>
          </div>
          <Card>
            <ul className="ks-rows">
              <Row k="Username" v="roberto_b" />
              <Row k="Email" v="roberto@example.com" chevron={false} />
              <Row k="Change password" v="" />
              <Row k="Appearance" v="System" />
            </ul>
          </Card>
          <Card>
            <ul className="ks-rows">
              <Row k="Sign out" v="" danger chevron={false} />
            </ul>
          </Card>
          <span className="ks-caption" style={{ textAlign: 'center' }}>{BRAND} 1.1.0</span>
        </div>
      </Device>
    );
  }

  /** Appearance: one design in two complete themes. System follows the
   * phone; stored on the device. The option previews are the only place
   * both themes appear together. */
  const THEMES = [['system', 'System', 'Matches your phone'], ['light', 'Light', ''], ['dark', 'Dark', '']];
  function Swatch({ kind }) {
    const L = { bg: '#F3F5F8', card: '#FFFFFF', ink: '#0D1B2E', line: '#DDE3EA' };
    const D = { bg: '#0D1B2E', card: '#16263D', ink: '#F3F6FA', line: '#263A58' };
    const half = (t, clip) => (
      <g clipPath={clip}>
        <rect width="72" height="96" rx="10" fill={t.bg} />
        <rect x="8" y="12" width="40" height="7" rx="3.5" fill={t.ink} />
        <rect x="8" y="26" width="56" height="30" rx="6" fill={t.card} stroke={t.line} />
        <rect x="14" y="34" width="26" height="9" rx="3" fill={t.ink} />
        <rect x="14" y="47" width="44" height="3" rx="1.5" fill="#2860F0" />
        <rect x="8" y="62" width="56" height="10" rx="5" fill={t.card} stroke={t.line} />
      </g>
    );
    return (
      <svg width="72" height="96" viewBox="0 0 72 96" aria-hidden="true">
        <defs><clipPath id="sw-l"><rect width="36" height="96" /></clipPath><clipPath id="sw-r"><rect x="36" width="36" height="96" /></clipPath></defs>
        {kind === 'system' ? <>{half(L, 'url(#sw-l)')}{half(D, 'url(#sw-r)')}</> : half(kind === 'light' ? L : D)}
        <rect x=".5" y=".5" width="71" height="95" rx="10" fill="none" stroke="var(--c-border)" />
      </svg>
    );
  }
  function Appearance({ selected = 'system' }) {
    return (
      <Device noTabs label="Appearance">
        <Back label="Profile" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Appearance</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {THEMES.map(([id, name, sub]) => (
              <div key={id} className="ks-card" style={{ padding: '14px 8px', display: 'grid', justifyItems: 'center', gap: 8, boxShadow: id === selected ? '0 0 0 2px var(--c-accent)' : 'var(--c-shadow)' }}>
                <Swatch kind={id} />
                <b className="ks-callout">{name}</b>
                <span style={{ width: 20, height: 20, borderRadius: 10, boxSizing: 'border-box', display: 'block', border: id === selected ? '6px solid var(--c-accent)' : '2px solid var(--c-border-strong)' }} />
              </div>
            ))}
          </div>
          <span className="ks-callout ks-muted">System follows your phone's light or dark setting. Saved on this device.</span>
        </div>
      </Device>
    );
  }

  function ChangePassword() {
    return (
      <Device noTabs label="Change password">
        <Back label="Profile" />
        <div className="ks-pad ks-stack" style={{ gap: 16 }}>
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Set a new password</h2>
          <Field label="New password" value={MASK(10)} secure rules={PASSWORD_RULES_OK} />
          <Field label="Confirm new password" value={MASK(9)} secure focused error="Passwords don't match." />
          <span className="ks-btn" style={{ opacity: 0.4 }}>Update password</span>
          <span className="ks-callout ks-muted" style={{ textAlign: 'center' }}>Cancel</span>
        </div>
      </Device>
    );
  }

  function EmptyHome() {
    return (
      <Device tab="home" label="Home, no leagues">
        <div className="ks-head"><h2 className="ks-head__title">Home</h2><span className="ks-avatar">RB</span></div>
        <div className="ks-pad ks-stack">
          <Empty icon={TROPHY} title="No leagues yet" line="Create or join a league to get started." primary="Create a league" secondary="Join with a code" />
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // B. HOME IN EVERY PHASE (3b-2)
  // ═════════════════════════════════════════════════════════════════════
  const GameCard = ({ tag, chip, children }) => (
    <div className="ks-game" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>{tag}</span>{chip}
      </div>
      {children}
    </div>
  );
  // The approved assumption caption (plCoverage.ts): an unpriced holding
  // counts at cost, and the screen says so. Appears instantly, never animates.
  const AtCost = ({ who, n }) => (
    <span className="ks-caption ks-muted" style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', alignSelf: 'center' }}><Icon d={ICON.info} size={14} width={2} /></span>
      <span>{who ? `${who}: ` : ''}{n} {n === 1 ? 'holding' : 'holdings'} counted at cost (no live price yet)</span>
    </span>
  );
  const Hero = ({ value, gain, gainLabel = 'season gain', meta, note }) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ks-caption">Your team</span><span className="ks-caption ks-num">{meta}</span></div>
      <div className="ks-score ks-num" style={{ fontSize: 48, lineHeight: '50px', fontStretch: '75%' }}>{$(value)}</div>
      <div className="ks-callout ks-num" style={{ fontWeight: 700 }}><span className={tone(gain)}>{$s(gain)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>{gainLabel}</span></div>
      {note}
    </div>
  );

  /** Draft order waits for the start minimum (backend: waiting_for_members,
   * member_count, min_members). The order is set at the LATER of 1 hour
   * before the draft and the league reaching the minimum. New copy. */
  function OrderWaiting({ count = 3, min = 4, pastReveal }) {
    const need = min - count;
    return (
      <div className="ks-raised" style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>
        <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Draft order · waiting</span>
        <span className="ks-callout" style={{ fontWeight: 600 }}>
          {pastReveal
            ? `Set as soon as ${need} more ${need === 1 ? 'manager joins' : 'managers join'}.`
            : `Set 1 hour before the draft, once ${min} managers have joined.`}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${min}, 1fr)`, gap: 4 }} aria-label={`${count} of ${min} managers`}>
          {Array.from({ length: min }, (_, i) => <span key={i} style={{ height: 6, borderRadius: 3, background: i < count ? 'var(--c-you)' : 'var(--c-track)' }} />)}
        </div>
        <span className="ks-caption ks-num">{count} of {min} managers</span>
      </div>
    );
  }

  function HomePreDraft({ waiting }) {
    const members = waiting ? ['RB', 'MR', 'LC'] : ['RB', 'MR', 'LC', 'SF', 'GV', 'TP'];
    if (waiting) {
      return (
        <Device tab="home" label="Home, pre-draft, waiting for managers">
          <Head name="Weekend Warriors" avatar />
          <div className="ks-pad ks-stack">
            <GameCard tag="Draft" chip={<span className="ks-chip">Pre-draft</span>}>
              <span className="ks-title">Sat, Oct 3 · 7:00 PM ET</span>
              <span className="ks-score ks-num" style={{ fontSize: 40 }}>3d 04h 12m</span>
              <span className="ks-callout ks-muted">60-second picks · 6 rounds</span>
            </GameCard>
            <OrderWaiting count={3} min={4} />
            <Card pad="14px">
              <div className="ks-section-h"><h3>Members</h3><span className="ks-caption ks-num">3 joined · 4 needed to draft</span></div>
              <div style={{ display: 'flex', gap: 6 }}>{members.map((m, i) => <span key={m} className={i === 0 ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m}</span>)}<span className="ks-avatar ks-avatar--sm" style={{ background: 'transparent', border: '1.5px dashed var(--c-border-strong)', color: 'var(--c-text-2)' }}>+1</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--c-sunken)' }}>
                <span><span className="ks-caption">Invite code</span><br /><b className="ks-num" style={{ letterSpacing: '0.12em' }}>WKND4ME</b></span>
                <span className="ks-callout" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Share</span>
              </div>
            </Card>
          </div>
        </Device>
      );
    }
    return (
      <Device tab="home" label="Home, pre-draft">
        <Head name="Serie A Traders" avatar />
        <div className="ks-pad ks-stack">
          <GameCard tag="Draft" chip={<span className="ks-chip">Pre-draft</span>}>
            <span className="ks-title">Sat, Oct 3 · 7:00 PM ET</span>
            <span className="ks-score ks-num" style={{ fontSize: 40 }}>3d 04h 12m</span>
            <span className="ks-callout ks-muted">60-second picks · 6 rounds</span>
            <span className="ks-callout" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="ks-dot" />Draft order set Sat 6:00 PM ET, an hour before the draft</span>
            <span className="ks-btn ks-btn--ongame">Build your queue</span>
          </GameCard>
          <Card pad="14px">
            <div className="ks-section-h"><h3>Members</h3><span className="ks-caption ks-num">6 of 8 joined</span></div>
            <div style={{ display: 'flex', gap: 6 }}>{members.map((m, i) => <span key={m} className={i === 0 ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m}</span>)}<span className="ks-avatar ks-avatar--sm" style={{ background: 'transparent', border: '1.5px dashed var(--c-border-strong)', color: 'var(--c-text-2)' }}>+2</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--c-sunken)' }}>
              <span><span className="ks-caption">Invite code</span><br /><b className="ks-num" style={{ letterSpacing: '0.12em' }}>SERIEA7</b></span>
              <span className="ks-callout" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Share</span>
            </div>
          </Card>
          <Card pad="14px"><span className="ks-callout ks-muted">No buying before the draft. Your team is set at the draft.</span></Card>
        </div>
      </Device>
    );
  }

  function HomeDrafting() {
    return (
      <Device tab="home" label="Home, drafting">
        <Head avatar />
        <div className="ks-pad ks-stack">
          <GameCard tag="Draft is live" chip={<Chip kind="live">Drafting</Chip>}>
            <span className="ks-title" style={{ color: 'var(--c-live-text)' }}>You're on the clock</span>
            <span className="ks-callout">Round 2 · Pick 11 · 0:42 left</span>
            <span className="ks-btn ks-btn--ongame">Go to the draft room</span>
          </GameCard>
          <Card pad="14px">
            <div className="ks-section-h"><h3>Your team so far</h3><span className="ks-caption">1 of 6</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['NVDA', null, null, null, null, null].map((t, i) => <span key={i} className="ks-slot" style={t ? { background: 'var(--c-you)', color: 'var(--c-on-accent)', border: 0 } : { borderColor: 'var(--c-border)', color: 'var(--c-text-2)' }}>{t || `Rd ${i + 1}`}</span>)}
            </div>
          </Card>
        </div>
      </Device>
    );
  }

  function HomePreSeason() {
    return (
      <Device tab="home" label="Home, pre-season">
        <Head avatar chip={null} />
        <div className="ks-pad ks-stack">
          <Hero value={12000} gain={0} gainLabel="Season starts Mon 9:30 AM ET" meta="Week 1 of 14 · 0–0" />
          <GameCard tag="Week 1" chip={<span className="ks-chip">Pre-season</span>}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="ks-avatar ks-avatar--sm">RB</span><b>You</b></span>
              <span className="ks-tag">vs</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>Gianluigi B.</b><span className="ks-avatar ks-avatar--sm ks-avatar--opp">GB</span></span>
            </div>
            <Scores left="$0.00" right="$0.00" size="lg" leftTone="ks-zero" rightTone="ks-zero" />
            <span className="ks-caption ks-muted" style={{ textAlign: 'center' }}>No leader yet. Scoring starts at Monday's open.</span>
          </GameCard>
        </div>
      </Device>
    );
  }

  function HomeClosed() {
    const w = K.WEEK_CLOSES[4];
    const you = { gain: w.you, pct: 0 }, opp = { gain: w.opp, pct: 0 };
    return (
      <Device tab="home" label="Home, market closed">
        <Head avatar />
        <div className="ks-pad ks-stack">
          {/* Thursday close: value = $12,000 basis + season gain (weeks 1–5 + Thu close) */}
          <Hero value={12000 + K.HOME.throughW5 + w.you} gain={K.HOME.throughW5 + w.you} meta="2nd of 6 · 4–1 · Week 6 of 14" />
          <GameCard tag="This week" chip={<span className="ks-chip">Market closed</span>}>
            <Scores left={$s(you.gain)} right={$s(opp.gain)} size="lg" />
            <Tug you={you.gain} opp={opp.gain} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-caption">
              <span>You lead by <b className="ks-num">{$(you.gain - opp.gain)}</b> at Thursday's close</span>
              <span className="ks-muted">Resumes Fri 9:30 AM ET</span>
            </div>
          </GameCard>
        </div>
      </Device>
    );
  }

  /** A symbol with no live price: counted at cost (zero gain, never $0 of
   * value), and the screen says so in the approved caption. */
  function HomeUnpriced() {
    const L = K.MATCHUP.live, y = SD(L.you), o = SD(L.opp);
    return (
      <Device tab="home" label="Home, a holding without a live price">
        <Head avatar />
        <div className="ks-pad ks-stack">
          <Hero value={K.HOME.value} gain={K.HOME.gain} meta="2nd of 6 · 4–1 · Week 6 of 14" note={<AtCost n={1} />} />
          <GameCard tag="This week" chip={<Chip kind="live">Week 6 · Live</Chip>}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-callout">
              <span style={{ color: 'var(--c-you-text)', fontWeight: 700 }}>You</span>
              <span className="ks-muted">vs Gianluigi B.</span>
            </div>
            <Scores left={y.primary} right={o.primary} size="lg" />
            <Tug you={y.value} opp={o.value} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-caption">
              <span>You lead by <b className="ks-num">{margin(L.you, L.opp)}</b></span>
              <span className="ks-muted">Ends Fri 4:00 PM ET</span>
            </div>
            <div style={{ display: 'grid', gap: 2, paddingTop: 8, borderTop: '1px solid var(--c-line)' }}>
              <AtCost who="You" n={1} />
              <AtCost who="Gianluigi B." n={2} />
            </div>
          </GameCard>
        </div>
      </Device>
    );
  }

  function HomeScoring() {
    return (
      <Device tab="home" label="Home, week final, scoring">
        <Head avatar />
        <div className="ks-pad ks-stack">
          <Hero value={12000 + K.HOME.throughW5 + K.MATCHUP.final.you.gain} gain={K.HOME.throughW5 + K.MATCHUP.final.you.gain} meta="Week 6 of 14" />
          <GameCard tag="Week 6" chip={<span className="ks-chip">Scoring…</span>}>
            <div className="ks-skel" style={{ height: 40 }} />
            <div className="ks-skel" style={{ height: 12 }} />
            <span className="ks-callout" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="ks-dot ks-dot--pulse" />Results post a few minutes after Friday's close.</span>
          </GameCard>
        </div>
      </Device>
    );
  }

  function HomeComplete() {
    return (
      <Device tab="home" label="Home, season complete">
        <Head avatar chip={null} />
        <div className="ks-pad ks-stack">
          <div className="ks-game" style={{ padding: 20, display: 'grid', justifyItems: 'center', gap: 8, textAlign: 'center', background: 'radial-gradient(120% 90% at 50% 0%, var(--c-live-glow) 0%, var(--c-surface) 70%)' }}>
            <span style={{ width: 72, height: 72, borderRadius: 36, display: 'grid', placeItems: 'center', background: 'var(--c-live)', color: 'var(--c-surface)' }}><Icon d={TROPHY} size={36} width={2.2} /></span>
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season complete</span>
            <span className="ks-score" style={{ fontSize: 44, lineHeight: '44px', whiteSpace: 'normal' }}>Champion</span>
            <span className="ks-callout">You won {K.LEAGUE.name}</span>
          </div>
          <Card pad="14px">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 12 }} className="ks-num">
              <span><span className="ks-caption">Season gain</span><br /><b className="ks-gain">+$1,962.40</b></span>
              <span><span className="ks-caption">Best week</span><br /><b>Week 11 · +$412.08</b></span>
              <span><span className="ks-caption">Regular season</span><br /><b>1st of 6 · 11–3</b></span>
              <span><span className="ks-caption">Playoffs</span><br /><b>2–0 · won the Final</b></span>
            </div>
          </Card>
          <span className="ks-btn">See the final standings</span>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // C. GAME (3c)
  // ═════════════════════════════════════════════════════════════════════
  function AllMatchups() {
    const live = [
      { a: 'Roberto B.', b: 'Gianluigi B.', ga: K.MATCHUP.live.you.gain, gb: K.MATCHUP.live.opp.gain, you: true },
      { a: 'Paolo M.', b: 'Alessandro D.', ga: -22.4, gb: 61.85 },
      { a: 'Francesco T.', b: 'Andrea P.', ga: 34.1, gb: 12.75 },
    ];
    return (
      <Device game tab="matchup" label="All matchups">
        <Head chip={<Chip kind="live">Week 6 · Live</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 12 }}>
          <div className="ks-seg ks-seg--game"><span>My matchup</span><span className="on">All matchups</span></div>
          {live.map((m) => (
            <div key={m.a} className="ks-raised" style={{ padding: 14, display: 'grid', gap: 8, boxShadow: m.you ? 'inset 3px 0 0 var(--c-you)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-callout"><b>{m.a}{m.you ? ' (you)' : ''}</b><b>{m.b}</b></div>
              <Scores left={$s(m.ga)} right={$s(m.gb)} size="md" />
              <Tug you={m.ga} opp={m.gb} />
            </div>
          ))}
          <span className="ks-caption ks-muted" style={{ textAlign: 'center' }}>Thu 1:37 PM ET · Ends Fri 4:00 PM ET</span>
        </div>
      </Device>
    );
  }

  function MatchupPreSeason() {
    const rows = K.lineup('roberto', 'mon');
    const opp = K.lineup('gianluigi', 'mon');
    return (
      <Device game tab="matchup" label="Matchup before the season">
        <Head chip={<span className="ks-chip">Pre-season</span>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="ks-avatar ks-avatar--sm">RB</span><b className="ks-callout">Roberto B.</b></span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b className="ks-callout">Gianluigi B.</b><span className="ks-avatar ks-avatar--sm ks-avatar--opp">GB</span></span>
          </div>
          <Scores left="$0.00" right="$0.00" size="xl" leftTone="ks-zero" rightTone="ks-zero" />
          <Tug you={0} opp={0} />
          <div className="ks-chyron"><span>Week 1 starts Mon 9:30 AM ET. No leader until the market opens.</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
            {[['Roberto B.', rows], ['Gianluigi B.', opp]].map(([n, rs]) => (
              <div key={n}>
                <div className="ks-tag" style={{ marginBottom: 4 }}>{n}</div>
                <ul className="ks-rows">{rs.map((r) => <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '1fr auto', padding: '8px 0' }}><span className="ks-t ks-callout">{r.t}</span><span className="ks-callout ks-num ks-zero">$0.00</span></li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </Device>
    );
  }

  /** Uneven-bye heads-up (new copy). Informational only, never blocking,
   * and only when byes are actually uneven (odd count, weeks not a multiple). */
  function ByeNotice({ members, weeks, expected }) {
    const b = K.byeNotice(members, weeks);
    if (!b) return null;
    return (
      <div role="note" className="ks-card" style={{ padding: '10px 12px', display: 'grid', gap: 2, background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
        <span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-text)' }}>With {members} managers and {weeks} weeks, byes won't be even: some get {b.hi}, some get {b.lo}.</span>
        {expected ? <span className="ks-caption" style={{ color: 'var(--c-text)' }}>Based on the {members} you expect. This updates as people join.</span> : null}
      </div>
    );
  }
  const Stepper = ({ label, value, unit, sub }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10 }}>
      <span><span className="ks-callout" style={{ fontWeight: 600 }}>{label}</span>{sub ? <><br /><span className="ks-caption">{sub}</span></> : null}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border)', borderRadius: 10, overflow: 'hidden' }}>
        <span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', fontSize: 20, color: 'var(--c-text-2)' }}>−</span>
        <b className="ks-num" style={{ minWidth: 64, textAlign: 'center', borderInline: '1px solid var(--c-border)', lineHeight: '36px' }}>{value}{unit ? ` ${unit}` : ''}</b>
        <span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', fontSize: 20, color: 'var(--c-text-2)' }}>+</span>
      </span>
    </div>
  );

  /** Create league · Season step (the same controls live in League settings
   * until the draft). The member count isn't final yet, so the notice is
   * based on the expected size and says so. */
  function CreateSeason() {
    return (
      <Device noTabs label="Create league, season settings">
        <Back right={<span className="ks-caption ks-num">Step 2 of 4</span>} />
        <div className="ks-pad ks-stack">
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 14 }}>
              {[1, 2, 3, 4].map((i) => <span key={i} style={{ height: 4, borderRadius: 2, background: i <= 2 ? 'var(--c-accent)' : 'var(--c-border)' }} />)}
            </div>
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>Season</h2>
            <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>How big the league is and how long it runs.</p>
          </div>
          <div className="ks-card" style={{ padding: 14, display: 'grid', gap: 14 }}>
            <Stepper label="Managers" value={7} sub="How many you expect, you included" />
            <Stepper label="Regular season" value={13} unit="weeks" />
            <ByeNotice members={7} weeks={13} expected />
            <div style={{ display: 'grid', gap: 6 }}>
              <Stepper label="Playoff teams" value={6} sub="2 to 7, up to your expected managers" />
              <span className="ks-caption ks-num" style={{ color: 'var(--c-text)' }}>{K.playoffLine(6)}</span>
              <span className="ks-caption ks-num">Season: 13 weeks + {K.playoffPlan(6).weeks} playoff weeks. We check this again when the draft starts.</span>
            </div>
          </div>
          <span className="ks-btn">Next</span>
        </div>
      </Device>
    );
  }

  /** Commissioner's Start draft confirm. The member count is final here;
   * the notice is informational and never blocks. */
  /** managers = who's in now (final); playoff = the league's P. If P >
   * managers the draft can't start: the sheet says why in one line and puts
   * the playoff stepper right there, capped at the member count; Start
   * draft stays disabled until P ≤ managers (friendly, blocking). */
  function StartDraftConfirm({ managers = 7, playoff = 6, weeks = 10, order = 'random', min = 4 }) {
    const short = managers < min;
    if (short) {
      return (
        <Device tab="league" label="Start the draft, not enough managers" overlay={
          <Sheet top={400}>
            <span className="ks-title">Start the draft?</span>
            <div role="alert" className="ks-card" style={{ padding: '10px 12px', background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
              <span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-text)' }}>A draft needs at least {min} managers. {managers} are in, so invite {min - managers} more to start.</span>
            </div>
            <span className="ks-callout"><b>Draft order:</b> set as soon as the {K.ordinal(min)} manager joins.</span>
            <span className="ks-btn ks-btn--secondary">Share invite code</span>
            <span className="ks-btn" style={{ opacity: 0.4 }} aria-disabled="true">Start draft</span>
          </Sheet>
        }>
          <Head name="Weekend Warriors" chip={<span className="ks-chip">Pre-draft</span>} />
        </Device>
      );
    }
    const blocked = playoff > managers;
    const StepInline = () => (
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <span className="ks-callout" style={{ fontWeight: 600 }}>Playoff teams</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', border: `${blocked ? 2 : 1}px solid ${blocked ? 'var(--c-warn-line)' : 'var(--c-border)'}`, borderRadius: 10, overflow: 'hidden' }}>
            <span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', fontSize: 20, color: 'var(--c-text)' }}>−</span>
            <b className="ks-num" style={{ minWidth: 48, textAlign: 'center', borderInline: '1px solid var(--c-border)', lineHeight: '36px' }}>{playoff}</b>
            <span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', fontSize: 20, color: 'var(--c-text-3)' }} aria-disabled="true">+</span>
          </span>
        </div>
        <span className="ks-caption ks-num">{blocked ? `Up to ${managers}, one per manager.` : `${K.playoffLine(playoff)}. Season: ${weeks} weeks + ${K.playoffPlan(playoff).weeks} playoff weeks.`}</span>
      </div>
    );
    return (
      <Device tab="league" label={blocked ? 'Start the draft, playoff teams too many' : 'Start the draft, confirm'} overlay={
        <Sheet top={blocked ? 330 : 380}>
          <span className="ks-title">Start the draft?</span>
          <span className="ks-callout ks-muted">{managers} managers are in, and each pick gets 60 seconds.</span>
          <span className="ks-callout"><b>Draft order:</b> {order === 'manual' ? 'set by the commissioner, final since 6:00 PM ET' : 'random, final since 6:00 PM ET'}</span>
          {blocked ? (
            <>
              <div role="alert" className="ks-card" style={{ padding: '10px 12px', background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
                <span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-text)' }}>{playoff} playoff teams, but {managers} managers are in. Lower the playoff teams to start.</span>
              </div>
              <StepInline />
            </>
          ) : (
            <>
              <span className="ks-callout ks-num"><b>Playoffs:</b> {K.playoffLine(playoff)}. Season: {weeks} weeks + {K.playoffPlan(playoff).weeks} playoff weeks.</span>
              <ByeNotice members={managers} weeks={weeks} />
            </>
          )}
          <span className="ks-btn" style={blocked ? { opacity: 0.4 } : undefined} aria-disabled={blocked}>Start draft</span>
          <span className="ks-btn ks-btn--secondary">Not yet</span>
        </Sheet>
      }>
        <Head name="Office League" chip={<span className="ks-chip">Pre-draft</span>} />
      </Device>
    );
  }

  /** The revealed draft order (after 6:00 PM), your slot highlighted, with
   * what the snake means for you. New copy. */
  /** The in-app "order is set" card (posted at T−1h in either mode, with a
   * push). mode: 'random' | 'manual'. New copy. */
  function OrderSetCard({ mode = 'random' }) {
    const L = K.SERIE_A, teams = L.order.length;
    const seat = L.order.findIndex((m) => m.you) + 1;
    const picks = K.picksForSeat(seat, teams, L.rounds);
    return (
      <div className="ks-raised" style={{ padding: '12px 14px', display: 'grid', gap: 4 }}>
        <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Draft order set · 6:00 PM ET</span>
        <span><span className="ks-headline" style={{ fontWeight: 800, color: 'var(--c-you-text)' }}>You pick {K.ordinal(seat)}</span>
          <span className="ks-callout ks-muted">, then {picks.slice(1, 3).map(K.ordinal).join(', ')}…</span></span>
        <span className="ks-caption">{mode === 'manual' ? 'Set by the commissioner.' : 'Random draw.'} It's final. The order reverses each round.</span>
      </div>
    );
  }

  function DraftOrder({ mode = 'random' }) {
    const L = K.SERIE_A;
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="ks-section-h" style={{ margin: 0 }}><h3>Draft order</h3><span className="ks-chip ks-chip--final">Final</span></div>
        <OrderSetCard mode={mode} />
        <ol className="ks-rows" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
          {L.order.map((m, i) => (
            <li key={m.name} className="ks-row" style={{ gridTemplateColumns: '18px 28px 1fr', padding: '7px 6px', borderRadius: 8, background: m.you ? 'var(--c-you-tint)' : undefined }}>
              <span className="ks-caption ks-num">{i + 1}</span>
              <span className={m.you ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m.init}</span>
              <span className="ks-callout" style={{ fontWeight: m.you ? 800 : 600, whiteSpace: 'nowrap' }}>{m.name}{m.bot ? <span className="ks-caption"> · Bot</span> : null}</span>
            </li>
          ))}
        </ol>
        <span className="ks-caption">Anyone who joins now picks last.</span>
      </div>
    );
  }

  /** The push at T−1h (OS lock screen, so theme-independent). */
  function OrderPush({ mode = 'random' }) {
    const seat = K.SERIE_A.order.findIndex((m) => m.you) + 1;
    return (
      <Device noTabs time="6:00" label={`Push notification, draft order set (${mode})`} style={{ background: 'linear-gradient(160deg, #3B4F7A 0%, #1B2540 55%, #0E1426 100%)', color: '#fff' }}>
        <div style={{ position: 'relative', textAlign: 'center', color: '#fff', paddingTop: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 600, opacity: 0.9 }}>Saturday, October 3</div>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: '90px', letterSpacing: '-2px' }}>6:00</div>
        </div>
        <div style={{ position: 'relative', margin: '28px 12px 0', padding: '12px 14px', borderRadius: 22, background: 'rgba(245, 246, 250, 0.82)', backdropFilter: 'blur(20px)', color: '#0D1B2E', display: 'grid', gridTemplateColumns: '38px 1fr', gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 9, background: '#0D1B2E', display: 'grid', placeItems: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1" fill="#8DA0BD" /><rect x="9.75" y="9" width="4.5" height="12" rx="1" fill="#8DA0BD" /><rect x="16.5" y="4" width="4.5" height="17" rx="1" fill="#6E9BFF" /></svg>
          </span>
          <span>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}><b>Serie A Traders</b><span style={{ color: '#5B6678', fontSize: 13 }}>now</span></span>
            <span style={{ fontSize: 15, lineHeight: '20px' }}>{mode === 'manual' ? `The commissioner set the draft order. You pick ${K.ordinal(seat)}.` : `The draft order is set. You pick ${K.ordinal(seat)}.`} The draft starts at 7:00 PM ET.</span>
          </span>
        </div>
      </Device>
    );
  }

  /** The commissioner's Arrange order (Manual mode): drag to reorder, pre-
   * filled with a random order (never commissioner-first), Save. Locked
   * once the draft starts. Row 3 is shown mid-drag. New copy. */
  function ArrangeOrder({ locked }) {
    const L = K.SERIE_A;
    if (locked) {
      return (
        <Device noTabs label="Draft order, locked">
          <Back label="League settings" />
          <div className="ks-pad ks-stack" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="ks-head__title" style={{ fontSize: 28 }}>Draft order</h2>
              <span className="ks-chip ks-chip--final">Final</span>
            </div>
            <p className="ks-callout ks-muted" style={{ margin: 0 }}>Locked at 6:00 PM ET, an hour before the draft. Anyone who joins now picks last.</p>
            <div className="ks-card" style={{ padding: '2px 8px' }}>
              <ol className="ks-rows">
                {L.order.map((m, i) => (
                  <li key={m.name} className="ks-row" style={{ gridTemplateColumns: '22px 32px 1fr auto', padding: '10px 6px', background: m.you ? 'var(--c-you-tint)' : undefined }}>
                    <span className="ks-callout ks-num" style={{ fontWeight: 700 }}>{i + 1}</span>
                    <span className={m.you ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m.init}</span>
                    <span className="ks-callout" style={{ fontWeight: 700 }}>{m.name}{m.you ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>
                    <span>{m.bot ? <span className="ks-chip ks-chip--money">Bot</span> : null}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Device>
      );
    }
    return (
      <Device noTabs label="Arrange the draft order">
        <Back label="League settings" />
        <div className="ks-pad ks-stack" style={{ gap: 12 }}>
          <div>
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>Arrange order</h2>
            <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>Drag to set who picks first. The order reverses each round. Set it by Sat 6:00 PM ET (1 hour before the draft). After that it's final.</p>
          </div>
          <div className="ks-card" role="note" style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
            <span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-text)' }}>Locks in 2h 14m</span>
            <span className="ks-callout ks-num" style={{ color: 'var(--c-text)' }}>Sat 6:00 PM ET</span>
          </div>
          <div className="ks-card" style={{ padding: '2px 8px' }}>
            <ol className="ks-rows">
              {L.order.map((m, i) => (
                <li key={m.name} className="ks-row" style={{ gridTemplateColumns: '22px 32px 1fr auto 24px', padding: '10px 6px', ...(i === 2 ? { background: 'var(--c-surface)', boxShadow: 'var(--c-sheet-shadow)', borderRadius: 10, transform: 'scale(1.02) translateY(-4px)', position: 'relative', zIndex: 1 } : {}) }}>
                  <span className="ks-callout ks-num" style={{ fontWeight: 700 }}>{i + 1}</span>
                  <span className={m.you ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m.init}</span>
                  <span className="ks-callout" style={{ fontWeight: 700 }}>{m.name}{m.you ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>
                  <span>{m.bot ? <span className="ks-chip ks-chip--money">Bot</span> : m.commish ? <span className="ks-chip ks-chip--money">Commish</span> : null}</span>
                  <span className="ks-muted" aria-label="Drag handle" style={{ fontSize: 18, textAlign: 'center' }}>≡</span>
                </li>
              ))}
            </ol>
          </div>
          <span className="ks-caption">Started from a random order. Shuffle again or drag anyone anywhere. If you never save, this order is used. Until you save, anyone who joins lands in a random slot; after you save, they're added at the end.</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <span className="ks-btn ks-btn--secondary">Shuffle again</span>
            <span className="ks-btn">Save order</span>
          </div>
        </div>
      </Device>
    );
  }

  function DraftLobby({ waiting }) {
    const queue = ['NVDA', 'MSFT', 'AAPL', 'CRM', 'COST'];
    return (
      <Device game tab="league" label={waiting ? 'Draft lobby, waiting for managers' : 'Draft lobby'}>
        <Head name={waiting ? 'Weekend Warriors' : 'Serie A Traders'} chip={<span className="ks-chip">Pre-draft</span>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-raised" style={{ padding: 16, display: 'grid', gap: 4, textAlign: 'center' }}>
            <span className="ks-tag">Draft starts in</span>
            <span className="ks-score ks-num" style={{ fontSize: 56, lineHeight: '56px' }}>04:59</span>
            <span className="ks-caption ks-muted">Sat 7:00 PM ET · 60-second picks</span>
          </div>
          {waiting ? <OrderWaiting count={3} min={4} pastReveal /> : <DraftOrder />}
          <div>
            <div className="ks-section-h"><h3>Your queue</h3></div>
            <span className="ks-caption" style={{ display: 'block', marginBottom: 4 }}>If you step away, we'll auto-pick from your queue when your time runs out. You can come back any time.</span>
            <ul className="ks-rows">{queue.map((t, i) => <li key={t} className="ks-row" style={{ gridTemplateColumns: '20px 36px 1fr 20px', padding: '8px 0' }}><span className="ks-caption ks-muted ks-num">{i + 1}</span><Logo t={t} game /><span className="ks-t ks-callout">{t}</span><span className="ks-muted">≡</span></li>)}</ul>
          </div>
        </div>
      </Device>
    );
  }

  /** Paolo M. timed out twice in a row (picks 12 and 13, back to back at
   * the snake turn): 12 came from their queue, 13 from the best available.
   * New copy throughout. */
  function DraftAutoPick() {
    const { SnakeBoard } = window.KSKit;
    const log = [
      { n: 13, who: 'Paolo M.', t: 'BRK.B', how: 'Auto-picked · best available' },
      { n: 12, who: 'Paolo M.', t: 'LLY', how: 'Auto-picked · from their queue' },
      { n: 11, who: 'Roberto B.', t: 'AAPL', how: 'Picked', you: true },
    ];
    return (
      <Device game tab="league" label="Draft room, after two auto-picks">
        <Head chip={<Chip kind="live">Drafting</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-chyron ks-chyron--in" style={{ display: 'grid', gap: 2 }}>
            <b>Paolo M. ran out of time</b>
            <span className="ks-caption">Auto-picked LLY from their queue, then BRK.B (best available).</span>
          </div>
          <div className="ks-raised" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="ks-title" style={{ color: 'var(--c-live-text)' }}>You're on the clock</span><br /><span className="ks-callout">Round 3 · Pick 14</span></span>
            <span className="ks-score ks-num" style={{ fontSize: 34 }}>1:00</span>
          </div>
          <SnakeBoard current={13} landed autoPicks={[12, 13]} />
          <div>
            <div className="ks-section-h"><h3>Latest picks</h3></div>
            <ul className="ks-rows">
              {log.map((p) => (
                <li key={p.n} className="ks-row" style={{ gridTemplateColumns: '22px 36px 1fr', padding: '9px 0' }}>
                  <span className="ks-caption ks-num">{p.n}</span>
                  <Logo t={p.t} game />
                  <span><span className="ks-t ks-callout">{p.t}</span> <span className="ks-callout ks-muted">· {p.who}{p.you ? ' (you)' : ''}</span><br />
                    <span className="ks-caption" style={p.how.startsWith('Auto') ? { color: 'var(--c-live-text)', fontWeight: 700 } : undefined}>{p.how}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Device>
    );
  }

  function DraftRecap() {
    const mine = K.PORTFOLIO_LIVE.rows.slice().sort((a, b) => b.gainPct - a.gainPct);
    const R = { NVDA: 1, AAPL: 2, CRM: 3, TSLA: 4, COST: 5, V: 6 };
    return (
      <Device tab="league" label="Draft recap">
        <Back label="League" right={<span className="ks-caption">Drafted Sep 13</span>} />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Draft recap</h2>
          <div className="ks-seg"><span className="on">Your picks</span><span>By round</span><span>By manager</span></div>
          <Card>
            <ul className="ks-rows">
              {mine.map((r) => (
                <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}>
                  <Logo t={r.t} />
                  <span><span className="ks-t">{r.t}</span><br /><span className="ks-caption">Round {R[r.t]} · pick {r.pick} · {$(r.draft)}</span></span>
                  <span className="ks-right ks-num"><b className={tone(r.gainPct)}>{pct(r.gainPct)}</b><br /><span className="ks-caption">since the draft</span></span>
                </li>
              ))}
            </ul>
          </Card>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Best pick so far: NVDA, round 1, pick 2</span>
        </div>
      </Device>
    );
  }

  function Playoffs() {
    const M = ({ a, b, sa, sb, win, live }) => (
      <div className="ks-raised" style={{ padding: '10px 12px', display: 'grid', gap: 6 }}>
        {[[a, sa, win === 0], [b, sb, win === 1]].map(([n, s, w]) => (
          <div key={n} style={{ display: 'flex', justifyContent: 'space-between', opacity: win != null && !w ? 0.55 : 1 }} className="ks-callout">
            <b style={{ color: n.startsWith('Roberto') ? 'var(--c-you-text)' : undefined }}>{n}</b><span className="ks-num">{s}</span>
          </div>
        ))}
        {live ? <span className="ks-caption" style={{ color: 'var(--c-live-text)' }}>Live · ends Fri 4:00 PM ET</span> : null}
      </div>
    );
    return (
      <Device game tab="league" label="Playoff bracket">
        <Head chip={<Chip kind="live">Playoffs</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-seg ks-seg--game"><span>Standings</span><span className="on">Playoffs</span><span>History</span></div>
          <div className="ks-tag">Semifinals · playoff week 1 · Final</div>
          <M a="1 Roberto B." b="4 Francesco T." sa="+$288.10" sb="+$96.42" win={0} />
          <M a="2 Paolo M." b="3 Alessandro D." sa="−$41.30" sb="+$120.55" win={1} />
          <div className="ks-tag">Championship · playoff week 2</div>
          <M a="1 Roberto B." b="3 Alessandro D." sa="+$164.20" sb="+$131.05" live />
          <span className="ks-caption ks-muted">The top 4 in the standings make the playoffs: 1 plays 4, 2 plays 3. A tied game goes to the higher seed.</span>
        </div>
      </Device>
    );
  }

  /** 6-team bracket: 3 playoff weeks, seeds 1–2 get first-round byes and
   * advance; fixed bracket (1 meets the 4/5 winner, 2 meets the 3/6 winner). */
  function Playoffs6() {
    const plan = K.playoffPlan(6);
    const S = K.STANDINGS_FINAL;
    const nm = (i) => `${i} ${S[i - 1].name}`;
    const Game = ({ a, b, sa, sb, live, bye, pending }) => (
      <div className="ks-raised" style={{ padding: '10px 12px', display: 'grid', gap: 6 }}>
        {[[a, sa], [b, sb]].map(([n, s], i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: pending && !n ? 'var(--c-text-2)' : undefined }} className="ks-callout">
            <b style={{ color: n && n.includes('Roberto') ? 'var(--c-you-text)' : bye && i === 1 ? 'var(--c-text-2)' : undefined, fontWeight: bye && i === 1 ? 500 : 700 }}>{n}</b>
            <span className="ks-num">{s}</span>
          </div>
        ))}
        {live ? <span className="ks-caption" style={{ color: 'var(--c-live-text)' }}>Live · ends Fri 4:00 PM ET</span> : null}
        {bye ? <span className="ks-caption">Advances to the {plan.rounds[1]}</span> : null}
      </div>
    );
    return (
      <Device game tab="league" label="Playoff bracket, 6 teams">
        <Head chip={<Chip kind="live">Playoffs</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 12 }}>
          <div className="ks-seg ks-seg--game"><span>Standings</span><span className="on">Playoffs</span><span>History</span></div>
          <span className="ks-caption ks-num">{K.playoffLine(6)}</span>
          <div className="ks-tag">{plan.rounds[0]} · playoff week 1</div>
          <Game a={nm(1)} b="Bye" bye />
          <Game a={nm(2)} b="Bye" bye />
          <Game a={nm(4)} b={nm(5)} sa="+$84.20" sb="+$112.65" live />
          <Game a={nm(3)} b={nm(6)} sa="+$58.10" sb="−$21.40" live />
          <div className="ks-tag">{plan.rounds[1]} · playoff week 2</div>
          <Game a={nm(1)} b="Winner of 4 v 5" pending />
          <Game a={nm(2)} b="Winner of 3 v 6" pending />
          <div className="ks-tag">{plan.rounds[2]} · playoff week 3</div>
          <Game a="Semifinal winners" b="" pending />
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // D. MONEY (3e): sell → cash slot → buy with the proceeds
  // ═════════════════════════════════════════════════════════════════════
  const TS = () => K.PORTFOLIO_LIVE.rows.find((r) => r.t === 'TSLA');
  const Sum = ({ rows }) => (
    <ul className="ks-rows">{rows.map(([k, v, cls]) => <li key={k} className="ks-row" style={{ gridTemplateColumns: '1fr auto', padding: '11px 0' }}><span className="ks-callout ks-muted">{k}</span><span className={`ks-callout ks-num ${cls || ''}`} style={{ fontWeight: 700 }}>{v}</span></li>)}</ul>
  );

  function SellSheet() {
    const t = TS();
    return (
      <Device tab="portfolio" label="Sell TSLA" overlay={
        <Sheet top={180}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Logo t="TSLA" /><span style={{ flex: 1 }}><span className="ks-headline" style={{ fontWeight: 800 }}>TSLA</span><br /><span className="ks-caption">Tesla · {$(t.thu)}</span></span><span className="ks-muted"><Icon d={ICON.close} size={22} /></span></div>
          <div className="ks-seg" style={{ height: 40 }}><span>Buy</span><span className="on">Sell</span></div>
          <div>
            <div className="ks-num" style={{ fontSize: 26, fontWeight: 800, lineHeight: '32px' }}>Sell all {t.qty.toFixed(4)} sh</div>
            <div className="ks-callout ks-num">≈ {$(t.value)} at {$(t.thu)}</div>
            <div className="ks-caption" style={{ marginTop: 4 }}>A slot holds one stock, so you sell the whole position. The cash stays in this slot to reinvest.</div>
          </div>
          <span className="ks-btn">Review sell</span>
        </Sheet>
      }>
        <Head chip={<Chip kind="live">Live</Chip>} />
      </Device>
    );
  }

  function ReviewSell() {
    const t = TS();
    return (
      <Device noTabs label="Review sell">
        <Back label="Edit" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Review sell</h2>
          <Card><Sum rows={[
            ['Sell', `${t.qty.toFixed(4)} TSLA`],
            ['Price', `${$(t.thu)} · market`],
            ['You get', $(t.value)],
            ['Vs. the slot\'s $2,000.00', $s(K.SALE.realized), tone(K.SALE.realized)],
          ]} /></Card>
          <Card pad="14px"><span className="ks-callout">{$(t.value)} stays in this slot, ready to invest in any stock. It doesn't earn until you buy.</span></Card>
          <span className="ks-btn">Sell TSLA</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Prices can move before the order fills.</span>
        </div>
      </Device>
    );
  }

  function Done({ kind }) {
    const sold = kind === 'sold';
    return (
      <Device noTabs label={sold ? 'Sold' : 'Bought'}>
        <div className="ks-pad ks-stack" style={{ paddingTop: 120, justifyItems: 'center', textAlign: 'center' }}>
          <span className="ks-pop" style={{ width: 88, height: 88, borderRadius: 44, display: 'grid', placeItems: 'center', background: 'var(--c-gain-tint)', color: 'var(--c-gain)', alignSelf: 'center' }}><Icon d={CHECK} size={44} width={2.6} /></span>
          <h2 className="ks-head__title" style={{ fontSize: 30 }}>{sold ? 'Sold TSLA' : 'Bought SHOP'}</h2>
          <p className="ks-callout ks-muted" style={{ margin: 0 }}>
            {sold ? `${$(K.SALE.proceeds)} is ready to invest in this slot.` : `${K.SALE.buy.qty.toFixed(4)} shares at ${$(K.SALE.buy.price)}. Slot 4 is invested again.`}
          </p>
          <span className="ks-btn" style={{ width: '100%', marginTop: 16 }}>{sold ? 'Invest now' : 'Done'}</span>
          {sold ? <span className="ks-btn ks-btn--secondary" style={{ width: '100%' }}>Later</span> : null}
        </div>
      </Device>
    );
  }

  function ReviewBuy() {
    const B = K.SALE.buy;
    return (
      <Device noTabs label="Review buy">
        <Back label="Edit" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Review buy</h2>
          <Card><Sum rows={[
            ['Buy', `≈ ${B.qty.toFixed(4)} SHOP`],
            ['Price', `${$(B.price)} · market`],
            ['Paid from', `TSLA slot · ${$(K.SALE.proceeds)}`],
            ['Left in the slot', '$0.00', 'ks-zero'],
          ]} /></Card>
          <span className="ks-btn">Buy SHOP</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Prices can move before the order fills.</span>
        </div>
      </Device>
    );
  }

  /** record-trade preview can return several sources (one per sale with
   * unspent proceeds). The buyer picks which sale pays; a buy never mixes
   * two slots. */
  function PickSource() {
    const src = K.SALE.sources;
    return (
      <Device tab="portfolio" label="Which sale pays for this" overlay={
        <Sheet top={250}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="ks-title">Which sale pays for this?</span><span className="ks-muted"><Icon d={ICON.close} size={22} /></span></div>
          <span className="ks-callout ks-muted">Each sale's cash stays in its own slot. Pick one; the buy uses all of it.</span>
          <Card>
            <ul className="ks-rows">
              {src.map((s, i) => (
                <li key={s.symbol} className="ks-row" style={{ gridTemplateColumns: '24px 36px 1fr auto', padding: '12px 0' }}>
                  <span style={{ display: 'block', boxSizing: 'border-box', alignSelf: 'center', width: 20, height: 20, borderRadius: 10, border: i === 0 ? '6px solid var(--c-accent)' : '2px solid var(--c-border-strong)' }} />
                  <Logo t={s.symbol} />
                  <span><span className="ks-t">{s.symbol} slot</span><br /><span className="ks-caption">Sold {s.when}</span></span>
                  <b className="ks-num">{$(s.amount)}</b>
                </li>
              ))}
            </ul>
          </Card>
          <span className="ks-btn">Use the TSLA sale</span>
        </Sheet>
      }>
        <Head chip={<Chip kind="live">Live</Chip>} />
      </Device>
    );
  }

  // ── Budget-cap / price-tier leagues (your call: A, decided 2026-09-30) ──
  // budget_cap and price_tiers leagues draft ONE share per pick, and the
  // server (record-trade → fillQuantity) buys exactly one share per trade; a
  // sale's cash goes back into the budget (userCashSpent). Numbers derive from
  // Roberto's draft prices, one share each, in a $2,500.00 budget league.
  const ONE = (() => {
    const rows = K.lineup('roberto', 'thu');
    const drafted = rows.reduce((a, r) => a + r.draft, 0);
    const budget = 2500;
    const tsla = rows.find((r) => r.t === 'TSLA');
    const sellPx = tsla.thu;
    const afterSell = Math.round((budget - drafted + sellPx) * 100) / 100;
    const buyPx = K.SALE.buy.price;
    const afterBuy = Math.round((afterSell - buyPx) * 100) / 100;
    return { budget, drafted, sellPx, afterSell, buyPx, afterBuy };
  })();
  function OneShareSell() {
    return (
      <Device noTabs label="Review sell, one-share league">
        <Back label="Edit" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Review sell</h2>
          <Card><Sum rows={[
            ['Sell', '1 TSLA · all you hold'],
            ['Price', `${$(ONE.sellPx)} · market`],
            ['Back to your budget', $(ONE.sellPx)],
            ['Budget left after', $(ONE.afterSell)],
          ]} /></Card>
          <span className="ks-btn">Sell TSLA</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Office League · {$(ONE.budget)} budget · one share per stock</span>
        </div>
      </Device>
    );
  }
  function OneShareBuy() {
    return (
      <Device noTabs label="Review buy, one-share league">
        <Back label="Edit" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Review buy</h2>
          <Card><Sum rows={[
            ['Buy', '1 SHOP'],
            ['Price', `${$(ONE.buyPx)} · market`],
            ['Budget now', $(ONE.afterSell)],
            ['Budget left after', $(ONE.afterBuy)],
          ]} /></Card>
          <span className="ks-btn">Buy SHOP</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Prices can move before the order fills.</span>
        </div>
      </Device>
    );
  }

  function MarketClosed() {
    const N = K.NVDA;
    return (
      <Device tab="portfolio" label="Trading closed" overlay={
        <Sheet top={200}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Logo t="NVDA" /><span style={{ flex: 1 }}><span className="ks-headline" style={{ fontWeight: 800 }}>NVDA</span><br /><span className="ks-caption">NVIDIA · last close {$(N.fri)}</span></span></div>
          <div className="ks-card" style={{ padding: 14, boxShadow: 'none', background: 'var(--c-sunken)', border: 0, display: 'grid', gap: 4 }}>
            <span className="ks-headline" style={{ fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}><Icon d={LOCK} size={18} />Market closed</span>
            <span className="ks-callout ks-muted">Trading opens Mon 9:30 AM ET. Prices show Friday's close.</span>
          </div>
          <div className="ks-seg" style={{ height: 40, opacity: 0.5 }}><span>Buy</span><span className="on">Sell</span></div>
          <span className="ks-btn" style={{ opacity: 0.35 }}>Review sell</span>
        </Sheet>
      }>
        <Head chip={<span className="ks-chip">Closed</span>} />
      </Device>
    );
  }

  function TradeHistory() {
    const picks = K.PORTFOLIO_LIVE.rows.slice().sort((a, b) => a.pick - b.pick);
    return (
      <Device tab="portfolio" label="Trade history">
        <Back label="Portfolio" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Trade history</h2>
          <div>
            <div className="ks-section-h"><h3>This week</h3></div>
            <Card><ul className="ks-rows">
              <li className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}><Logo t="SHOP" /><span><span className="ks-t">Bought SHOP</span><br /><span className="ks-caption ks-num">Thu 1:41 PM ET · {K.SALE.buy.qty.toFixed(4)} sh at {$(K.SALE.buy.price)}</span></span><span className="ks-num"><b>{$(K.SALE.proceeds)}</b></span></li>
              <li className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}><Logo t="TSLA" /><span><span className="ks-t">Sold TSLA</span><br /><span className="ks-caption ks-num">Thu 1:38 PM ET · {TS().qty.toFixed(4)} sh at {$(248.36)}</span></span><span className="ks-right ks-num"><b>{$(K.SALE.proceeds)}</b><br /><span className={`ks-caption ${tone(K.SALE.realized)}`} style={{ fontWeight: 700 }}>{$s(K.SALE.realized)}</span></span></li>
            </ul></Card>
          </div>
          <div>
            <div className="ks-section-h"><h3>Draft · Sep 13</h3><span className="ks-caption">$2,000.00 per pick</span></div>
            <Card><ul className="ks-rows">
              {picks.map((r) => <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}><Logo t={r.t} /><span><span className="ks-t">Drafted {r.t}</span><br /><span className="ks-caption ks-num">Pick {r.pick} · {r.qty.toFixed(4)} sh at {$(r.draft)}</span></span><span className="ks-num"><b>$2,000.00</b></span></li>)}
            </ul></Card>
          </div>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // E. WEB (3d): the same screens in the left-rail shell
  // ═════════════════════════════════════════════════════════════════════
  function WebFrame({ active, children, panel }) {
    return (
      <div className="ks-web" role="img" aria-label={`Web app, ${active}`}>
        <div className="ks-web__bar"><i /><i /><i /><span>app.stockpile.example</span></div>
        <div className="ks-web__body">
          <aside className="ks-web__rail">
            <div style={{ padding: '4px 8px 18px' }}><Brand /></div>
            {[['home', 'Home'], ['matchup', 'Matchup'], ['league', 'League'], ['portfolio', 'Portfolio']].map(([id, n]) => (
              <span key={id} className={id === active ? 'ks-web__nav is-on' : 'ks-web__nav'}><Icon d={ICON[id]} size={20} width={id === active ? 2.4 : 1.8} />{n}</span>
            ))}
            <span style={{ flex: 1 }} />
            <span className="ks-web__nav"><span className="ks-avatar ks-avatar--sm">RB</span>roberto_b</span>
          </aside>
          <main className="ks-web__main">{children}</main>
          {panel ? <aside className="ks-web__panel">{panel}</aside> : null}
        </div>
      </div>
    );
  }

  function WebHome() {
    const H = K.HOME, L = K.MATCHUP.live;
    const { GainChart, ThisWeekCard } = window.KSKit;
    return (
      <WebFrame active="home">
        <div className="ks-head" style={{ padding: '0 0 18px' }}><Pill /><span className="ks-caption ks-num">2nd of 6 · {H.record} · Week 6 of 14</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 20 }}>
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <Hero value={H.value} gain={H.gain} meta="" />
            <ThisWeekCard you={L.you} opp={L.opp} oppName="vs Gianluigi B." left="Ends Fri 4:00 PM ET" />
          </div>
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div className="ks-card" style={{ padding: 14 }}><div className="ks-section-h"><h3>Season</h3><span className="ks-caption">Season gain, week by week</span></div><GainChart series={H.series} weeks={H.weekStarts} w={440} h={170} label="Season gain" /></div>
            <div className="ks-card" style={{ padding: '10px 14px' }}>
              <div className="ks-section-h"><h3>Standings</h3><span className="ks-caption">Through Week 5</span></div>
              <ul className="ks-rows">{K.STANDINGS_BEFORE.slice(0, 4).map((r) => <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto auto', padding: '8px 0' }}><b className="ks-num">{r.rank}</b><b className="ks-callout">{r.name}</b><span className="ks-callout ks-muted ks-num">{r.w}–{r.l}</span><span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>{$s(r.pf)}</span></li>)}</ul>
            </div>
          </div>
        </div>
      </WebFrame>
    );
  }

  function WebSettings() {
    return (
      <WebFrame active="none">
        <h2 className="ks-head__title" style={{ margin: '0 0 18px' }}>Settings</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 28 }}>
          <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
            {['Account', 'Appearance', 'Password'].map((n) => <span key={n} className={n === 'Appearance' ? 'ks-web__nav is-on' : 'ks-web__nav'}>{n}</span>)}
          </div>
          <div className="ks-card" style={{ padding: 22, display: 'grid', gap: 16, maxWidth: 620 }}>
            <div><div className="ks-title">Appearance</div><div className="ks-callout ks-muted">One look everywhere, in light or dark. System follows your computer.</div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 150px)', gap: 12 }}>
              {THEMES.map(([id, name]) => (
                <div key={id} className="ks-card" style={{ padding: 12, display: 'grid', justifyItems: 'center', gap: 8, boxShadow: id === 'system' ? '0 0 0 2px var(--c-accent)' : 'none' }}>
                  <Swatch kind={id} /><b className="ks-callout">{name}</b>
                </div>
              ))}
            </div>
            <span className="ks-caption">Saved in this browser.</span>
          </div>
        </div>
      </WebFrame>
    );
  }

  function WebPortfolio() {
    const P = K.PORTFOLIO_LIVE, N = K.NVDA;
    return (
      <WebFrame active="portfolio" panel={
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Logo t="NVDA" /><span style={{ flex: 1 }}><b>NVDA</b><br /><span className="ks-caption">NVIDIA</span></span><Icon d={ICON.close} size={18} /></div>
          <div className="ks-num" style={{ fontSize: 28, fontWeight: 800 }}>{$(N.thu)}</div>
          <div className="ks-callout ks-gain ks-num" style={{ fontWeight: 700 }}>{$s(N.thu - N.prev)} · {pct(N.todayPct)} today</div>
          <div className="ks-card" style={{ padding: 12, background: 'var(--c-sunken)', border: 0, boxShadow: 'none' }} >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 8 }} className="ks-num"><span><span className="ks-caption">Shares</span><br /><b>{N.qty.toFixed(4)}</b></span><span><span className="ks-caption">Value</span><br /><b>{$(N.value)}</b></span></div>
          </div>
          <div className="ks-callout ks-num"><b>Sell all {N.qty.toFixed(4)} sh ≈ {$(N.value)}</b></div>
          <div className="ks-seg"><span>Buy</span><span className="on">Sell</span></div>
          <span className="ks-btn">Review sell</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Market data provided by Alpaca</span>
        </div>
      }>
        <div className="ks-head" style={{ padding: '0 0 18px' }}><Pill /><Chip kind="live">Live</Chip></div>
        <div style={{ display: 'flex', gap: 28, alignItems: 'end', marginBottom: 16 }}>
          <div><div className="ks-caption">Portfolio value</div><div className="ks-score ks-num" style={{ fontSize: 44, fontStretch: '75%' }}>{$(P.value)}</div></div>
          <div className="ks-callout ks-num" style={{ fontWeight: 700, paddingBottom: 8 }}><span className="ks-gain">{$s(P.gain)} · {pct(P.gainPct)}</span> <span className="ks-muted">since the draft</span></div>
        </div>
        <div className="ks-card" style={{ padding: '2px 14px' }}>
          <ul className="ks-rows">{P.rows.map((r) => <li key={r.t} className="ks-row" style={{ gridTemplateColumns: '36px 1fr 90px 90px 70px', background: r.t === 'NVDA' ? 'var(--c-sunken)' : undefined }}><Logo t={r.t} /><span><b>{r.t}</b> <span className="ks-caption">{r.co}</span></span><span className="ks-num ks-muted ks-right">{r.qty.toFixed(2)} sh</span><b className="ks-num ks-right">{$(r.value)}</b><span className={`ks-num ks-right ${tone(r.todayPct)}`} style={{ fontWeight: 700 }}>{pct(r.todayPct)}</span></li>)}</ul>
        </div>
      </WebFrame>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // RUN IT BACK (decided by Giorgio, 2026-10-04; copy approved). Season 1 is
  // over; the commissioner (Roberto B., you) renews Stock Scudetto for Season 2:
  // opt-in replies, the commissioner reconciles, then a NEW draft. Backend:
  // feat/run-it-back (docs/migrations/RUN_IT_BACK_DESIGN.md); each season is a
  // new league row linked by previous_league_id.
  // ═════════════════════════════════════════════════════════════════════
  const S1 = K.SEASON1, NX = K.SEASON1.next;
  const BackendTag = ({ children }) => (
    <span className="ks-caption" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '4px 8px', borderRadius: 8, background: 'var(--c-warn-tint)', color: 'var(--c-warn-text)', fontWeight: 700 }}>Backend · {children}</span>
  );
  // `me` = whose phone this is (the "you" fill follows the viewer).
  const Avatars = ({ ids, extra, me = 'roberto' }) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ids.map((id) => { const p = K.byId[id]; return <span key={id} className={id === me ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{p.init}</span>; })}
      {extra}
    </div>
  );
  const ALL = S1.rows.map((r) => r.id);
  const Radio = ({ on, title, line }) => (
    <li className="ks-row" style={{ gridTemplateColumns: '22px 1fr', alignItems: 'start', padding: '12px 0' }}>
      <span style={{ width: 20, height: 20, borderRadius: 10, marginTop: 1, display: 'grid', placeItems: 'center', border: `2px solid ${on ? 'var(--c-accent)' : 'var(--c-border-strong)'}` }}>{on ? <span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--c-accent)' }} /> : null}</span>
      <span><span className="ks-callout" style={{ fontWeight: 700 }}>{title}</span><br /><span className="ks-caption">{line}</span></span>
    </li>
  );
  // Medals (season complete only): ranks 1–3 become a filled disc with the
  // numeral; 4+ stay a plain numeral. Tokens --c-medal-* / --c-on-medal.
  const Medal = ({ rank }) => {
    const fill = ['gold', 'silver', 'bronze'][rank - 1];
    return fill
      ? <span aria-label={`${K.ordinal(rank)} place`} className="ks-num" style={{ width: 20, height: 20, borderRadius: 10, display: 'grid', placeItems: 'center', background: `var(--c-medal-${fill})`, color: 'var(--c-on-medal)', fontSize: 11, fontWeight: 800 }}>{rank}</span>
      : <span className="ks-t ks-num" style={{ textAlign: 'center' }}>{rank}</span>;
  };
  const Season1Rows = ({ n = 6 }) => (
    <ul className="ks-rows">
      {S1.rows.slice(0, n).map((r) => (
        <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '20px 1fr auto auto', padding: '9px 0', background: r.you ? 'var(--c-you-tint)' : undefined }}>
          <Medal rank={r.rank} />
          <span className="ks-callout" style={{ fontWeight: 700 }}>{r.name}{r.id === S1.champion ? <span className="ks-muted" style={{ fontWeight: 500 }}> · Champion</span> : null}</span>
          <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
          <span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 78, textAlign: 'right' }}>{$s(r.pf)}</span>
        </li>
      ))}
    </ul>
  );
  const ChampBanner = ({ compact }) => (
    <div className="ks-game" style={{ padding: compact ? '12px 14px' : 20, display: 'grid', justifyItems: compact ? 'start' : 'center', gap: 6, textAlign: compact ? 'left' : 'center', background: 'radial-gradient(120% 90% at 50% 0%, var(--c-live-glow) 0%, var(--c-surface) 70%)' }}>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: compact ? 32 : 56, height: compact ? 32 : 56, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--c-live)', color: 'var(--c-surface)' }}><Icon d={TROPHY} size={compact ? 18 : 28} width={2.2} /></span>
        {compact ? <span><span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 1 champion</span><br /><b className="ks-callout">Roberto B. · 11–3 · won the Final</b></span> : null}
      </span>
      {compact ? null : <><span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 1 · Final</span><span className="ks-title">Roberto B. won {K.LEAGUE.name}</span><span className="ks-callout ks-muted">11–3 · won the Final 2–0</span></>}
    </div>
  );

  /** Entry point 1: Home's season-complete card, commissioner. */
  function RibHome() {
    return (
      <Device tab="home" label="Home, season complete, commissioner can run it back">
        <Head avatar chip={null} />
        <div className="ks-pad ks-stack">
          <div className="ks-game" style={{ padding: 20, display: 'grid', justifyItems: 'center', gap: 8, textAlign: 'center', background: 'radial-gradient(120% 90% at 50% 0%, var(--c-live-glow) 0%, var(--c-surface) 70%)' }}>
            <span style={{ width: 72, height: 72, borderRadius: 36, display: 'grid', placeItems: 'center', background: 'var(--c-live)', color: 'var(--c-surface)' }}><Icon d={TROPHY} size={36} width={2.2} /></span>
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season complete</span>
            <span className="ks-score" style={{ fontSize: 44, lineHeight: '44px', whiteSpace: 'normal' }}>Champion</span>
            <span className="ks-callout">You won {K.LEAGUE.name}</span>
          </div>
          <Card pad="14px">
            <div style={{ display: 'grid', gap: 4 }}>
              <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 2</span>
              <span className="ks-title" style={{ fontSize: 20 }}>Run it back?</span>
              <span className="ks-callout ks-muted">Everyone from Season 1 gets asked if they're in. Once you've heard from everyone, you set up the draft.</span>
            </div>
            <span className="ks-btn" style={{ marginTop: 12 }}>Run it back</span>
          </Card>
          <span className="ks-btn ks-btn--secondary">See the final standings</span>
        </div>
      </Device>
    );
  }
  /** Entry point 2: the League tab after the season, commissioner. */
  function RibLeague() {
    return (
      <Device tab="league" label="League tab, season over">
        <Head chip={<span className="ks-chip ks-chip--final">Final</span>} />
        <div className="ks-pad ks-stack">
          <ChampBanner />
          <div className="ks-raised" style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>
            <span className="ks-callout" style={{ fontWeight: 700 }}>You're the commissioner</span>
            <span className="ks-caption">Start Season 2 with the same group. Season 1 stays in History.</span>
            <span className="ks-btn">Run it back</span>
          </div>
          <Card pad="12px 14px">
            <div className="ks-section-h"><h3>Final standings</h3><span className="ks-caption">Season 1 · 14 weeks</span></div>
            <Season1Rows n={4} />
          </Card>
        </div>
      </Device>
    );
  }
  /** Entry point 3: what a member gets (a push), shown on Gianluigi B.'s phone. */
  function RibPush({ mode = 'ask' }) {
    const R = NX.replies;
    const body = mode === 'ask'
      ? 'Roberto B. is running it back. Are you in for Season 2?'
      : `Gianluigi B. is running back for Season 2. ${R.in.length} running back · ${R.out.length} out · ${R.none.length} no reply yet.`;
    return (
      <Device noTabs time={mode === 'ask' ? '7:42' : '9:15'} label={mode === 'ask' ? "Push to a member: are you in?" : 'Push to the commissioner: a reply'} style={{ background: 'linear-gradient(160deg, #3B4F7A 0%, #1B2540 55%, #0E1426 100%)', color: '#fff' }}>
        <div style={{ position: 'relative', textAlign: 'center', color: '#fff', paddingTop: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 600, opacity: 0.9 }}>{mode === 'ask' ? 'Saturday, January 16' : 'Sunday, January 17'}</div>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: '90px', letterSpacing: '-2px' }}>{mode === 'ask' ? '7:42' : '9:15'}</div>
        </div>
        <div style={{ position: 'relative', margin: '28px 12px 0', padding: '12px 14px', borderRadius: 22, background: 'rgba(245, 246, 250, 0.82)', backdropFilter: 'blur(20px)', color: '#0D1B2E', display: 'grid', gridTemplateColumns: '38px 1fr', gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 9, background: '#0D1B2E', display: 'grid', placeItems: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1" fill="#8DA0BD" /><rect x="9.75" y="9" width="4.5" height="12" rx="1" fill="#8DA0BD" /><rect x="16.5" y="4" width="4.5" height="17" rx="1" fill="#6E9BFF" /></svg>
          </span>
          <span>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}><b>{K.LEAGUE.name}</b><span style={{ color: '#5B6678', fontSize: 13 }}>now</span></span>
            <span style={{ fontSize: 15, lineHeight: '20px' }}>{body}</span>
          </span>
        </div>
      </Device>
    );
  }

  /** (a) Who's in — decided: opt-in + commissioner reconciliation. */
  const Countline = () => {
    const R = NX.replies;
    return <span className="ks-callout ks-num"><b>{R.in.length} running back</b> · {NX.joined.length} new · {R.out.length} out · {R.none.length} no reply yet</span>;
  };
  const NameGroup = ({ title, ids, children }) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="ks-caption" style={{ fontWeight: 700 }}>{title} · {ids.length}</span>
      {children || <span className="ks-callout">{ids.map((id) => K.byId[id].name).join(', ')}</span>}
    </div>
  );
  /** The prompt every Season 1 player gets (Gianluigi B.'s phone): Home and League tab. */
  function RibMemberPrompt() {
    return (
      <Device tab="home" label="Member: are you in for Season 2?">
        <div className="ks-head"><Pill /><span className="ks-avatar">GB</span></div>
        <div className="ks-pad ks-stack">
          <div className="ks-game" style={{ padding: 16, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 2</span>
              <span className="ks-chip">Reply</span>
            </div>
            <span className="ks-title" style={{ fontSize: 20 }}>Roberto B. is running it back. Are you in?</span>
            <span className="ks-callout ks-muted">Same league, new season. The draft is set once everyone has replied.</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><span className="ks-btn ks-btn--secondary">I'm out</span><span className="ks-btn">I'm in</span></div>
            <span className="ks-caption">You can change your answer until the draft is set.</span>
          </div>
          <Card pad="12px 14px">
            <div className="ks-section-h"><h3>Season 1</h3><span className="ks-caption">Final</span></div>
            <span className="ks-callout">Roberto B. won · you finished {K.ordinal(5)} (4–10)</span>
          </Card>
        </div>
      </Device>
    );
  }
  /** The commissioner's Home card while replies come in. */
  function RibHomeCounts() {
    const R = NX.replies;
    return (
      <Device tab="home" label="Commissioner Home: replies coming in">
        <Head avatar chip={null} />
        <div className="ks-pad ks-stack">
          <ChampBanner compact />
          <div className="ks-game" style={{ padding: 16, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 2 · running back</span>
              <span className="ks-chip">Waiting on {R.none.length}</span>
            </div>
            <Countline />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ALL.length}, 1fr)`, gap: 4 }} aria-hidden="true">
              {[...R.in, ...R.out, ...R.none].map((id) => <span key={id} style={{ height: 6, borderRadius: 3, background: R.in.includes(id) ? 'var(--c-you)' : R.out.includes(id) ? 'var(--c-border-strong)' : 'var(--c-track)' }} />)}
            </div>
            <span className="ks-caption">Waiting on {R.none.map((id) => K.byId[id].name).join(', ')} You'll set up the draft once everyone has replied.</span>
            <span className="ks-btn">See who's in</span>
          </div>
        </div>
      </Device>
    );
  }
  /** One row per player in Season 1's final order, answer right-aligned.
   * "Running back" is Giorgio's copy (verbatim); "Out", "No reply yet",
   * "Joining", "New" are new copy; "Nudge again" and "Remove" are Giorgio's
   * (2026-10-04). `actions` = the commissioner's per-row actions; a member
   * who is in sees the same full list without them. */
  function ReplyRows({ actions = true, me = 'roberto' }) {
    const R = NX.replies;
    const state = (id) => (R.in.includes(id) ? 'in' : R.out.includes(id) ? 'out' : 'none');
    const rows = S1.rows;
    return (
      <ul className="ks-rows">
        {rows.map((r) => {
          const st = state(r.id);
          return (
            <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto', padding: '10px 0', alignItems: 'center' }}>
              <span className="ks-t ks-num" style={{ color: st === 'in' ? undefined : 'var(--c-text-2)' }}>{r.rank}</span>
              <span className="ks-callout" style={{ fontWeight: st === 'in' ? 700 : 500, color: st === 'in' ? 'var(--c-text)' : 'var(--c-text-2)' }}>{r.name}{r.id === me ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>
              {st === 'in' ? <span className="ks-callout" style={{ fontWeight: 700, color: 'var(--c-accent)', display: 'flex', gap: 6, alignItems: 'center' }}><Icon d={CHECK} size={14} width={3} />Running back</span> : null}
              {st === 'out' ? <span className="ks-callout ks-muted">Out</span> : null}
              {st === 'none' ? (
                <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
                  <span className="ks-callout" style={{ color: 'var(--c-live-text)', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}><span className="ks-dot" />No reply yet</span>
                  {actions ? <span className="ks-caption" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Nudge again · Remove</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
        {NX.joined.map((j) => (
          <li key={j.id} className="ks-row" style={{ gridTemplateColumns: '18px 1fr auto', padding: '10px 0', alignItems: 'center' }}>
            <span />
            <span className="ks-callout" style={{ fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>{j.name}<span className="ks-chip" style={{ height: 20, fontSize: 11 }}>New</span></span>
            <span className="ks-callout" style={{ fontWeight: 700, color: 'var(--c-accent)', display: 'flex', gap: 6, alignItems: 'center' }}><Icon d={CHECK} size={14} width={3} />Joining</span>
          </li>
        ))}
      </ul>
    );
  }
  /** The reconcile view on the League tab (commissioner). */
  function RibReconcile() {
    const R = NX.replies;
    return (
      <Device tab="league" label="Commissioner League tab: who's running back">
        <Head chip={<span className="ks-chip">Season 2</span>} />
        <div className="ks-pad ks-stack">
          <div><span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 2</span><h2 className="ks-head__title" style={{ fontSize: 26, margin: '2px 0 0' }}>Who's running back</h2></div>
          <Countline />
          <Card pad="4px 14px">
            <div className="ks-section-h" style={{ paddingTop: 8 }}><h3>Season 1 order</h3><span className="ks-caption">Answer</span></div>
            <ReplyRows />
          </Card>
          <Card>
            <ul className="ks-rows" style={{ opacity: 0.5 }}>
              <Row k="Draft date" v="Not set" />
              <Row k="Draft order" v="Random" />
            </ul>
          </Card>
          <span className="ks-caption">You can set the draft once everyone has replied. Waiting on {R.none.map((id) => K.byId[id].name).join(', ')}</span>
          <div className="ks-raised" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="ks-caption">Invite someone new</span><br /><b className="ks-num" style={{ letterSpacing: '0.12em' }}>{NX.invite}</b></span>
            <span className="ks-callout" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Share</span>
          </div>
        </div>
      </Device>
    );
  }
  /** A member who answered "I'm in" lands here (auto-redirect): the same
   * list, every answer, no actions. Out / unanswered players don't get it
   * (assumed; to confirm). */
  function RibMemberList() {
    return (
      <Device tab="league" label="Member who is in: who's running back">
        <div className="ks-head"><Pill /><span className="ks-chip">Season 2</span><span className="ks-avatar">GB</span></div>
        <div className="ks-pad ks-stack">
          <div className="ks-raised" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ks-callout" style={{ fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', color: 'var(--c-accent)' }}><Icon d={CHECK} size={14} width={3} />You're running back</span>
            <span className="ks-caption" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Change</span>
          </div>
          <div><span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 2</span><h2 className="ks-head__title" style={{ fontSize: 26, margin: '2px 0 0' }}>Who's running back</h2></div>
          <Countline />
          <Card pad="4px 14px">
            <div className="ks-section-h" style={{ paddingTop: 8 }}><h3>Season 1 order</h3><span className="ks-caption">Answer</span></div>
            <ReplyRows actions={false} me="gianluigi" />
          </Card>
          <span className="ks-caption">The draft is set once everyone has replied. You can change your answer until then.</span>
        </div>
      </Device>
    );
  }
  /** How the commissioner clears a non-reply (Giorgio, 2026-10-04: "Nudge again" / "Remove"). */
  function RibResolve() {
    const who = K.byId[NX.replies.none[0]].name;
    return (
      <Device tab="league" label="Commissioner: resolve a missing reply" overlay={
        <Sheet top={430}>
          <span className="ks-title" style={{ fontSize: 20 }}>{who} hasn't replied</span>
          <span className="ks-callout ks-muted">Asked Sat, Jan 16. Nudged Sun, Jan 17.</span>
          <span className="ks-btn">Nudge again</span>
          <span className="ks-btn ks-btn--secondary">Remove</span>
          <span className="ks-caption">You can nudge once a day. If you remove {who.split(' ')[0]}, they're out of Season 2 and get a message saying so.</span>
        </Sheet>
      }>
        <Head chip={<span className="ks-chip">Season 2</span>} />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 26 }}>Who's running back</h2>
          <Countline />
        </div>
      </Device>
    );
  }

  /** (c) The commissioner's review: everything carried over, editable. */
  function RibReview() {
    return (
      <Device noTabs label="Season 2 settings review">
        <Back label="Cancel" />
        <div className="ks-pad ks-stack">
          <div><span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>{K.LEAGUE.name}</span><h2 className="ks-head__title" style={{ fontSize: 28, margin: '2px 0 0' }}>Season 2</h2></div>
          <span className="ks-callout ks-muted">Everything carries over from Season 1. Change anything before the draft.</span>
          <Card>
            <ul className="ks-rows">
              <Row k="Who's in" v={`${NX.replies.in.length} back · ${NX.joined.length} new`} sub="Everyone has replied" />
              <Row k="Teams" v={`${NX.replies.in.length + NX.joined.length}`} sub={`Follows who's in, up to ${NX.maxTeams}. More can join with ${NX.invite} until the draft.`} chevron={false} />
              <Row k="Draft" v="Sat, Jan 23 · 7:00 PM ET" />
              <Row k="Draft order" v="Random" />
              <Row k="Pick clock" v={`${K.LEAGUE.pickClock.seconds} seconds`} />
              <Row k="Season" v={`${K.LEAGUE.weeks} weeks`} />
              <Row k="Playoffs" v="4 teams" sub={K.playoffLine(4).replace(/^4 teams · /, '')} />
              <Row k="Stakes" v={`${$(K.LEAGUE.notionalPerSlot)} a slot`} sub={`${K.LEAGUE.slots} slots`} />
            </ul>
          </Card>
          <ByeNotice members={NX.replies.in.length + NX.joined.length} weeks={K.LEAGUE.weeks} />
          <BackendTag>num_participants stays 16 until the draft, then the member count</BackendTag>
          <span className="ks-btn">Schedule the draft</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>Everyone who's in gets a notification. Season 1 stays in History.</span>
        </div>
      </Device>
    );
  }

  /** (d) History: the Season 2 League tab keeps Season 1 visible. */
  function RibHistory({ view }) {
    if (view === 'list') {
      return (
        <Device tab="league" label="League › History">
          <Back label="League" />
          <div className="ks-pad ks-stack">
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>History</h2>
            <Card>
              <ul className="ks-rows">
                <Row k="Season 2" v="Draft Sat" sub="6 managers · drafting Jan 23" />
                <Row k="Season 1" v="11–3" sub="Champion Roberto B. · you" />
              </ul>
            </Card>
            <Card pad="12px 14px">
              <div className="ks-section-h"><h3>Season 1 · final standings</h3><span className="ks-caption">Season gain</span></div>
              <Season1Rows />
            </Card>
            <span className="ks-caption">Every week's matchups and the draft recap stay here too. New players see Season 1 as well.</span>
            <BackendTag>get_league_history (Season 1 is its own frozen league)</BackendTag>
          </div>
        </Device>
      );
    }
    return (
      <Device tab="league" label="League tab, Season 2 before the draft">
        <Head chip={<span className="ks-chip">Pre-draft</span>} />
        <div className="ks-pad ks-stack">
          <ChampBanner compact />
          <div className="ks-game" style={{ padding: 16, display: 'grid', gap: 8 }}>
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Season 2 · Draft</span>
            <span className="ks-title">{NX.draft}</span>
            <span className="ks-callout ks-muted">6 managers · new draft</span>
            <span className="ks-btn">Go to the draft lobby</span>
          </div>
          <Card>
            <ul className="ks-rows">
              <Row k="History" v="2 seasons" />
              <Row k="League settings" v="" />
            </ul>
          </Card>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // DRAFT FEASIBILITY (2026-10-05): "a draft pick can never be unused".
  // New copy for Giorgio's audit. Specific wording when the backend returns
  // who/which/how much; the generic line otherwise.
  // ═════════════════════════════════════════════════════════════════════
  const Alert = ({ children }) => (
    <div role="alert" className="ks-card" style={{ padding: '10px 12px', background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
      <span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-text)' }}>{children}</span>
    </div>
  );
  /** A pick the server refused (would_strand_slot | budget_reserve). */
  function DraftRefused({ kind = 'strand' }) {
    return (
      <Device tab="league" label={`Draft room, pick refused (${kind})`} overlay={
        <Sheet top={470}>
          <span className="ks-title">Pick a different stock</span>
          <Alert>{kind === 'strand'
            ? 'Taking ORCL would leave Paolo M. with no stock that fits their Tech slot. Every slot has to be fillable.'
            : 'ORCL would leave $640.00 for your 4 remaining picks. You need at least $780.00 to fill them.'}</Alert>
          <span className="ks-caption">Your clock is still running. Pick from the list, or let your queue pick for you.</span>
          <span className="ks-btn">Back to the list</span>
        </Sheet>
      }>
        <Head name="Office League" chip={<Chip kind="live">Drafting</Chip>} />
        <div className="ks-pad ks-stack"><span className="ks-title" style={{ color: 'var(--c-live-text)' }}>You're on the clock</span><span className="ks-callout">Round 2 · Pick 11 · 0:31 left</span></div>
      </Device>
    );
  }
  /** Start the draft, blocked by the feasibility check. */
  function StartBlocked({ unavailable }) {
    return (
      <Device tab="league" label={unavailable ? 'Start the draft, check unavailable' : 'Start the draft, setup blocked'} overlay={
        <Sheet top={unavailable ? 470 : 330}>
          <span className="ks-title">Start the draft?</span>
          {unavailable ? (
            <>
              <Alert>We couldn't check the draft setup just now. Try again in a moment.</Alert>
              <span className="ks-btn ks-btn--secondary">Try again</span>
            </>
          ) : (
            <>
              <span className="ks-callout ks-muted">Every slot has to be fillable before the draft can start. Fix these in League settings:</span>
              <Alert>There aren't enough eligible stocks to fill every manager's slots. Loosen a slot rule or a price bracket.</Alert>
              <Alert>The budget isn't enough to fill every manager's slots. Raise the budget or change the price brackets.</Alert>
              <span className="ks-btn ks-btn--secondary">League settings</span>
            </>
          )}
          <span className="ks-btn" style={{ opacity: 0.4 }} aria-disabled="true">Start draft</span>
        </Sheet>
      }>
        <Head name="Office League" chip={<span className="ks-chip">Pre-draft</span>} />
      </Device>
    );
  }
  /** A stalled turn: no legal stock for the manager on the clock. */
  function DraftStalled({ commish }) {
    return (
      <Device tab="league" label={commish ? 'Draft paused, commissioner' : 'Draft paused, member'}>
        <Head chip={<span className="ks-chip">Paused</span>} />
        <div className="ks-pad ks-stack">
          <div className="ks-game" style={{ padding: 16, display: 'grid', gap: 8 }}>
            <span className="ks-tag" style={{ color: 'var(--c-live-text)' }}>Draft paused</span>
            <span className="ks-title" style={{ fontSize: 20 }}>No stock left fits Paolo M.'s next slot</span>
            <span className="ks-callout ks-muted">{commish
              ? "The clock is stopped and nobody is skipped. You've been notified; the draft continues once the slot can be filled."
              : 'The clock is stopped and nobody is skipped. The commissioner has been told.'}</span>
          </div>
          <span className="ks-caption">Round 2 · Pick 12 · Paolo M.</span>
        </div>
      </Device>
    );
  }
  function StallPush() {
    return (
      <Device noTabs time="7:24" label="Push to the commissioner: draft paused" style={{ background: 'linear-gradient(160deg, #3B4F7A 0%, #1B2540 55%, #0E1426 100%)', color: '#fff' }}>
        <div style={{ position: 'relative', textAlign: 'center', color: '#fff', paddingTop: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 600, opacity: 0.9 }}>Saturday, October 3</div>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: '90px', letterSpacing: '-2px' }}>7:24</div>
        </div>
        <div style={{ position: 'relative', margin: '28px 12px 0', padding: '12px 14px', borderRadius: 22, background: 'rgba(245, 246, 250, 0.82)', backdropFilter: 'blur(20px)', color: '#0D1B2E', display: 'grid', gridTemplateColumns: '38px 1fr', gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 9, background: '#0D1B2E', display: 'grid', placeItems: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1" fill="#8DA0BD" /><rect x="9.75" y="9" width="4.5" height="12" rx="1" fill="#8DA0BD" /><rect x="16.5" y="4" width="4.5" height="17" rx="1" fill="#6E9BFF" /></svg>
          </span>
          <span>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}><b>{K.LEAGUE.name}</b><span style={{ color: '#5B6678', fontSize: 13 }}>now</span></span>
            <span style={{ fontSize: 15, lineHeight: '20px' }}>The draft is paused: no stock left fits Paolo M.'s next slot.</span>
          </span>
        </div>
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // YOUR CALL: which tier a traded stock fills (price-tier leagues),
  // 2026-10-05. "Tier Cup": six one-share tiers. Roberto sold DIS (his
  // $100–$200 stock) and wants to buy. New copy throughout.
  // ═════════════════════════════════════════════════════════════════════
  const TIER = (() => {
    const tiers = [['Under $50', 0, 50], ['$50–$100', 50, 100], ['$100–$200', 100, 200], ['$200–$400', 200, 400], ['$400–$800', 400, 800], ['$800+', 800, Infinity]];
    const tierOf = (p) => tiers.find(([, lo, hi]) => p >= lo && p < hi)[0];
    const held = [['F', 'Ford', 11.42], ['KO', 'Coca-Cola', 68.1], ['NVDA', 'NVIDIA', K.NVDA.thu], ['NFLX', 'Netflix', 612.3], ['COST', 'Costco', 918.1]];
    return { tiers, tierOf, held, sold: ['DIS', 'Disney', 102.9], shop: ['SHOP', 'Shopify', K.SALE.buy.price], aapl: ['AAPL', 'Apple', 211.42] };
  })();
  const TAlert = ({ children }) => (
    <div role="alert" className="ks-card" style={{ padding: '10px 12px', background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
      <span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-text)' }}>{children}</span>
    </div>
  );
  /** Portfolio rows in a tier league under each option. */
  function TierPortfolio({ mode }) {
    const rows = mode === 'C' ? [...TIER.held, TIER.aapl].sort((a, b) => a[2] - b[2]) : TIER.held;
    const sub = (t, p) => mode === 'A' ? `${TIER.tierOf(p)} slot · 1 sh` : mode === 'B' ? `${TIER.tierOf(p)} tier · 1 sh` : '1 sh';
    return (
      <Device tab="portfolio" label={`Tier league portfolio, option ${mode}`}>
        <Head name="Tier Cup" chip={null} />
        <div className="ks-pad ks-stack">
          <div className="ks-card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
            <span className="ks-callout"><b>{mode === 'C' ? '6 of 6' : '5 of 6'}</b> {mode === 'C' ? 'stocks held' : 'tiers filled'}</span>
            <span className="ks-callout ks-muted">{mode === 'C' ? 'Tiers applied at the draft' : 'One stock per tier'}</span>
          </div>
          <div className="ks-card" style={{ padding: '2px 14px' }}>
            <ul className="ks-rows">
              {rows.map(([t, co, p]) => (
                <li key={t} className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}>
                  <Logo t={t} />
                  <span><span className="ks-t">{t}</span><br /><span className="ks-caption ks-num">{co} · {sub(t, p)}</span></span>
                  <span className="ks-right ks-num"><b>{$(p)}</b></span>
                </li>
              ))}
              {mode !== 'C' ? (
                <li className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}>
                  <span className="ks-logo" style={{ background: 'var(--c-sunken)', color: 'var(--c-text-2)', fontSize: 11 }}>Open</span>
                  <span><span className="ks-t">{mode === 'A' ? '$100–$200 slot' : '$100–$200 tier'}</span><br /><span className="ks-caption">Sold DIS · {mode === 'A' ? 'buy a stock priced $100 to $200' : 'any stock that keeps every tier filled'}</span></span>
                  <span className="ks-right"><span className="ks-caption" style={{ color: 'var(--c-accent)', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Fill<Icon d={ICON.right} size={12} width={2.6} /></span></span>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </Device>
    );
  }
  /** Review buy under each option (C buys AAPL, A/B buy SHOP). */
  function TierReview({ mode }) {
    const [t, , p] = mode === 'C' ? TIER.aapl : TIER.shop;
    return (
      <Device noTabs label={`Tier league review buy, option ${mode}`}>
        <Back label="Edit" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Review buy</h2>
          <Card><Sum rows={[
            ['Buy', `1 ${t}`],
            ['Price', `${$(p)} · market`],
            ...(mode === 'A' ? [['Fills your', '$100–$200 slot']] : mode === 'B' ? [['Tier, by today’s price', '$100–$200']] : []),
          ]} /></Card>
          <span className="ks-btn">Buy {t}</span>
          <span className="ks-caption" style={{ textAlign: 'center' }}>{mode === 'C' ? 'Prices can move before the order fills.' : 'The tier is set by the price you buy at; it doesn’t change if the price moves later.'}</span>
        </div>
      </Device>
    );
  }
  /** The refusal when a stock doesn't fit (A and B). */
  function TierRefused({ mode }) {
    return (
      <Device tab="portfolio" label={`Tier league buy refused, option ${mode}`} overlay={
        <Sheet top={470}>
          <span className="ks-title">Pick a different stock</span>
          <TAlert>{mode === 'A'
            ? 'AAPL is $211.42. Your open slot takes stocks priced $100 to $200.'
            : 'With AAPL you’d have two stocks in $200–$400 and none in $100–$200. Every tier needs one stock.'}</TAlert>
          <span className="ks-btn">Back to the list</span>
        </Sheet>
      }>
        <Head name="Tier Cup" chip={null} />
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // YOUR CALL: leaving a league (2026-10-06), from LEAVE_LEAGUE_OPTIONS.md
  // on feat/leave-league. Every frame's copy is new. Scenarios:
  //   before the draft: Sofia F. leaves Serie A Traders (Roberto commish);
  //   mid-season: Gianluigi B. (Roberto's Week 6 opponent) leaves Stock
  //   Scudetto on Tuesday of Week 6;
  //   playoffs: Francesco T. left in Week 9 and still finished 4th (Season 1).
  // ═════════════════════════════════════════════════════════════════════
  const DangerBtn = ({ children, off }) => (
    <span className="ks-btn ks-btn--secondary" style={{ color: 'var(--c-danger)', opacity: off ? 0.45 : 1 }}>{children}</span>
  );
  const LeaveRow = ({ off, sub }) => (
    <Card><ul className="ks-rows">
      <li className="ks-row" style={{ gridTemplateColumns: '1fr', padding: '13px 0' }} aria-disabled={off || undefined}>
        <span><span className="ks-callout" style={{ fontWeight: 600, color: off ? 'var(--c-text-3)' : 'var(--c-danger)' }}>Leave league</span>{sub ? <><br /><span className="ks-caption">{sub}</span></> : null}</span>
      </li>
    </ul></Card>
  );
  const Bullets = ({ items }) => (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }} className="ks-callout">{items.map((t) => <li key={t}>{t}</li>)}</ul>
  );
  /** League settings (where Leave league lives, at the bottom like Sign out on Profile). */
  function LeagueSettingsLeave({ commish = true, name = K.LEAGUE.name, leave }) {
    return (
      <Device noTabs label={`League settings, ${name}`}>
        <Back label="League" />
        <div className="ks-pad ks-stack">
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>League settings</h2>
          <Card><ul className="ks-rows">
            {commish ? <Row k="Season settings" v="" /> : null}
            <Row k="Draft order" v="" />
            <Row k="Invite code" v={name === K.SERIE_A.name ? 'SERIEA7' : ''} />
            <Row k="Commissioner" v={commish ? 'You' : 'Roberto B.'} chevron={commish} />
          </ul></Card>
          {leave}
        </div>
      </Device>
    );
  }
  /** The leave sheet. mode: 'pre' (before the draft) | 'A' soft leave | 'B' forfeit. */
  function LeaveSheet({ mode = 'A' }) {
    const pre = mode === 'pre';
    const name = pre ? K.SERIE_A.name : K.LEAGUE.name;
    const items = pre
      ? ['Roberto B. chooses whether to go ahead with one fewer team or invite someone new.', `You can rejoin with the invite code until ${K.SERIE_A.revealAt}.`]
      : mode === 'A'
        ? ['Your team plays out the season on autopilot: it keeps its stocks, makes no trades and still plays its matchups.', 'You can still see the league, but you can’t rejoin this season.']
        : ['Your team forfeits every matchup left this season.', 'Your stocks are sold at the market price and go back to the pool.', 'You can’t rejoin this season.'];
    return (
      <Device tab="league" label={`Leave sheet, ${mode}`} overlay={
        <Sheet top={pre ? 470 : mode === 'A' ? 430 : 420}>
          <span className="ks-title">Leave {name}?</span>
          <Bullets items={items} />
          <DangerBtn>Leave league</DangerBtn>
          <span className="ks-btn">Stay</span>
        </Sheet>
      }>
        <Head name={name} chip={pre ? null : <Chip kind="live">Week 6</Chip>} />
      </Device>
    );
  }
  /** Commissioner leave sheet. q4: 'B' successor picker | 'C' auto-transfer notice. */
  function CommishLeave({ q4 = 'B' }) {
    // Q2 = C (Giorgio, 2026-10-06): teams are locked in once the draft starts,
    // so a commissioner can only leave BEFORE the draft. Humans only (no bots).
    const others = K.SERIE_A.order.filter((m) => !m.you && !m.bot);
    return (
      <Device tab="league" label={`Commissioner leave sheet, ${q4}`} overlay={
        <Sheet top={q4 === 'B' ? 150 : 400}>
          <span className="ks-title">Leave {K.SERIE_A.name}?</span>
          <Bullets items={['You come off the draft order and everyone after you moves up one.']} />
          {q4 === 'B' ? (
            <div>
              <div className="ks-tag" style={{ color: 'var(--c-text-2)' }}>Who takes over as commissioner?</div>
              <ul className="ks-rows" role="radiogroup">
                {others.map((m, i) => <Radio key={m.name} on={i === 0} title={m.name} line={i === 0 ? 'In the league longest' : 'Member'} />)}
              </ul>
            </div>
          ) : (
            <Alert>Marco R. becomes commissioner: they've been in the league longest. We'll let them know.</Alert>
          )}
          <DangerBtn>{q4 === 'B' ? 'Leave and hand over to Marco R.' : 'Leave league'}</DangerBtn>
          <span className="ks-btn">Stay</span>
        </Sheet>
      }>
        <Head name={K.SERIE_A.name} chip={null} />
      </Device>
    );
  }
  /** Q1: the commissioner's draft order after Sofia F. leaves. */
  function OrderAfterLeave({ q1 = 'A' }) {
    const order = K.SERIE_A.order.filter((m) => m.name !== 'Sofia F.');
    return (
      <Device noTabs label={`Draft order after a leave, ${q1}`}>
        <Back label="League settings" />
        <div className="ks-pad ks-stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="ks-head__title" style={{ fontSize: 28 }}>Draft order</h2>
            {q1 === 'A' ? <span className="ks-chip ks-chip--final">Final</span> : <span className="ks-chip">Not confirmed</span>}
          </div>
          {q1 === 'A'
            ? <p className="ks-callout ks-muted" style={{ margin: 0 }}>Sofia F. left the league. Everyone after them moved up one.</p>
            : <Alert>Sofia F. left the league. Check the order and confirm it again before the draft.</Alert>}
          <div className="ks-card" style={{ padding: '2px 8px' }}>
            <ol className="ks-rows">
              {order.map((m, i) => (
                <li key={m.name} className="ks-row" style={{ gridTemplateColumns: '22px 32px 1fr auto', padding: '9px 6px', background: m.you ? 'var(--c-you-tint)' : undefined }}>
                  <span className="ks-callout ks-num" style={{ fontWeight: 700 }}>{i + 1}</span>
                  <span className={m.you ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m.init}</span>
                  <span className="ks-callout" style={{ fontWeight: 700 }}>{m.name}{m.you ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>
                  <span>{m.bot ? <span className="ks-chip ks-chip--money">Bot</span> : q1 === 'B' ? <span className="ks-muted">≡</span> : null}</span>
                </li>
              ))}
            </ol>
          </div>
          {q1 === 'B' ? <span className="ks-btn">Confirm order</span> : null}
        </div>
      </Device>
    );
  }
  /** Q2: Roberto's Home matchup card against the departed Gianluigi B. */
  function DepartedMatchup({ q2 = 'A' }) {
    const L = K.MATCHUP.live, y = SD(L.you), o = SD(L.opp);
    return (
      <Device tab="home" label={`Home matchup vs a departed team, ${q2}`}>
        <Head avatar />
        <div className="ks-pad ks-stack">
          <Hero value={K.HOME.value} gain={K.HOME.gain} meta="2nd of 6 · 4–1 · Week 6 of 14" />
          <GameCard tag="This week" chip={<Chip kind="live">Week 6 · Live</Chip>}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-callout">
              <span style={{ color: 'var(--c-you-text)', fontWeight: 700 }}>You</span>
              <span style={{ textAlign: 'right' }}><span className="ks-muted">Gianluigi B. {q2 === 'A' ? '(left)' : '(forfeited)'}</span>{q2 === 'A' ? <><br /><span className="ks-caption">Auto-managed</span></> : null}</span>
            </div>
            {q2 === 'A' ? (
              <>
                <Scores left={y.primary} right={o.primary} size="lg" />
                <Tug you={y.value} opp={o.value} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ks-caption">
                  <span style={{ color: 'var(--c-text)' }}>You lead by <b className="ks-num">{margin(L.you, L.opp)}</b></span>
                  <span className="ks-muted">{L.left}</span>
                </div>
              </>
            ) : (
              <>
                <Scores left={y.primary} right="W" size="lg" rightTone="ks-zero" />
                <span className="ks-caption" style={{ color: 'var(--c-text)' }}>You win Week 6 by forfeit. Gianluigi B. left the league.</span>
              </>
            )}
          </GameCard>
        </div>
      </Device>
    );
  }
  /** Q2-A: standings for everyone else; the departed row stays, labelled. */
  function DepartedStandings() {
    return (
      <Device tab="league" label="Standings with a departed team">
        <Head chip={<Chip kind="live">Week 6 · Live</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-seg"><span className="on">Standings</span><span>Schedule</span><span>History</span></div>
          <Card pad="6px 14px">
            <ul className="ks-rows">
              {K.STANDINGS_BEFORE.map((r) => {
                const gone = r.id === 'gianluigi';
                return (
                  <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '20px 30px 1fr auto auto', padding: '9px 0', background: r.you ? 'var(--c-you-tint)' : undefined }}>
                    <span className="ks-t ks-num" style={{ textAlign: 'center' }}>{r.rank}</span>
                    <span className={r.you ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'} style={gone ? { opacity: 0.55 } : undefined}>{r.init}</span>
                    <span><span className="ks-callout" style={{ fontWeight: 700, color: gone ? 'var(--c-text-2)' : undefined }}>{r.name}{gone ? ' (left)' : ''}{r.you ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you)</span> : null}</span>{gone ? <><br /><span className="ks-caption">Auto-managed</span></> : null}</span>
                    <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
                    <span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 78, textAlign: 'right' }}>{$s(r.pf)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <span className="ks-caption ks-muted">Ranked by win percentage, then head-to-head, then season gain. This is also the playoff seeding.</span>
        </div>
      </Device>
    );
  }
  /** Q3: the bracket when the 4th seed's manager left. */
  function DepartedBracket({ q3 = 'A' }) {
    const M = ({ a, b, sub }) => (
      <div className="ks-raised" style={{ padding: '10px 12px', display: 'grid', gap: 6 }}>
        {[a, b].map((n) => (
          <div key={n} className="ks-callout"><b style={{ color: n.startsWith('1 Roberto') ? 'var(--c-you-text)' : n.includes('(left)') ? 'var(--c-text-2)' : undefined }}>{n}</b></div>
        ))}
        {sub ? <span className="ks-caption">{sub}</span> : null}
      </div>
    );
    const S = S1.rows.slice(0, 5);
    return (
      <Device game tab="league" label={`Playoffs with a departed seed, ${q3}`}>
        <Head chip={<Chip kind="live">Playoffs</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 12 }}>
          <div className="ks-seg ks-seg--game"><span>Standings</span><span className="on">Playoffs</span><span>History</span></div>
          {q3 === 'B' ? (
            <Card pad="6px 14px">
              <ul className="ks-rows">
                {S.map((r) => {
                  const gone = r.id === 'francesco';
                  const seed = gone ? null : r.rank > 4 ? 4 : r.rank;
                  return (
                    <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '40px 1fr auto', padding: '8px 0', opacity: gone ? 0.55 : 1 }}>
                      <span className="ks-caption ks-num" style={{ fontWeight: 700 }}>{seed ? `Seed ${seed}` : '–'}</span>
                      <span className="ks-callout" style={{ fontWeight: 700 }}>{r.name}{gone ? ' (left)' : ''}</span>
                      <span className="ks-callout ks-num ks-muted">{gone ? 'Not seeded' : `${r.w}–${r.l}`}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
          <div className="ks-tag">Semifinals · playoff week 1 · starts Mon 9:30 AM ET</div>
          {q3 === 'A'
            ? <M a="1 Roberto B." b="4 Francesco T. (left)" sub="Francesco T.'s team plays on autopilot." />
            : <M a="1 Roberto B." b="4 Gianluigi B." sub="Francesco T. left, so Gianluigi B. moves up to the 4th seed." />}
          <M a="2 Paolo M." b="3 Alessandro D." />
          <span className="ks-caption ks-muted">{q3 === 'A'
            ? 'The top 4 in the standings make the playoffs, including teams whose manager left.'
            : 'The top 4 active teams make the playoffs. Teams whose manager left aren’t seeded.'}</span>
        </div>
      </Device>
    );
  }
  /** Q5: what the leaver (Gianluigi B.) sees on the League tab afterwards. */
  function LeaverLeague({ q5 = 'A' }) {
    return (
      <Device tab="league" label={`League tab after leaving, ${q5}`}>
        <Head chip={<Chip kind="live">Week 6 · Live</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 12 }}>
          <div className="ks-raised" style={{ padding: '12px 14px', display: 'grid', gap: 6 }}>
            <span className="ks-callout" style={{ fontWeight: 700 }}>You left this league in Week 6</span>
            <span className="ks-caption">{q5 === 'A'
              ? 'Your team plays out the season on autopilot. You can look around, but you can’t trade or rejoin.'
              : 'Your team is on autopilot. Come back any time before the season ends and trading reopens.'}</span>
            {q5 === 'B' ? <span className="ks-btn">Reclaim my team</span> : null}
          </div>
          <div className="ks-seg"><span className="on">Standings</span><span>Schedule</span><span>History</span></div>
          <Card pad="6px 14px">
            <ul className="ks-rows">
              {K.STANDINGS_BEFORE.map((r) => {
                const me = r.id === 'gianluigi';
                return (
                  <li key={r.id} className="ks-row" style={{ gridTemplateColumns: '20px 1fr auto auto', padding: '9px 0', background: me ? 'var(--c-you-tint)' : undefined }}>
                    <span className="ks-t ks-num" style={{ textAlign: 'center' }}>{r.rank}</span>
                    <span className="ks-callout" style={{ fontWeight: 700 }}>{r.name}{me ? <span className="ks-muted" style={{ fontWeight: 500 }}> (you, left)</span> : null}</span>
                    <span className="ks-callout ks-num ks-muted">{r.w}–{r.l}</span>
                    <span className={`ks-callout ks-num ${tone(r.pf)}`} style={{ fontWeight: 700, minWidth: 78, textAlign: 'right' }}>{$s(r.pf)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </Device>
    );
  }
  /** Q5: the leaver's league sheet: the league leaves Home and sits under "You left". */
  function LeaverSheet() {
    return (
      <Device tab="home" label="League sheet after leaving" overlay={
        <Sheet top={300}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="ks-title">Your leagues</span><span className="ks-muted"><Icon d={ICON.close} size={22} /></span></div>
          <div>
            <div className="ks-tag" style={{ color: 'var(--c-text-2)' }}>Live this week</div>
            <ul className="ks-rows"><li className="ks-row" style={{ gridTemplateColumns: '1fr auto 20px', padding: '12px 0' }}>
              <span><span className="ks-t">Friday Night Stocks</span><br /><span className="ks-caption ks-num">6th of 8 · 0–1</span></span>
              <Chip kind="live">Week 2</Chip>
              <span style={{ color: 'var(--c-accent)' }}><Icon d={CHECK} size={18} width={2.6} /></span>
            </li></ul>
          </div>
          <div>
            <div className="ks-tag" style={{ color: 'var(--c-text-2)' }}>You left</div>
            <ul className="ks-rows"><li className="ks-row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 0' }}>
              <span><span className="ks-t">{K.LEAGUE.name}</span><br /><span className="ks-caption ks-num">Left in Week 6 · 5th of 6 · auto-managed</span></span>
              <span className="ks-muted"><Icon d={ICON.right} size={16} /></span>
            </li></ul>
          </div>
        </Sheet>
      }>
        <Head name="Friday Night Stocks" chip={null} />
      </Device>
    );
  }
  // Leave window (Giorgio, 2026-10-06): leaving is open until the draft
  // order is set (T−1h), locked from then until the season ends, then open
  // again (a post-season leave hides the league). A pre-draft leave makes the
  // commissioner RECONFIRM: move forward with one fewer team, or invite
  // someone new. The draft can't start until they choose. New copy.
  const LOCKED_LINE = 'Teams are locked in from an hour before the draft until the season ends.';
  const RECON = { left: 'Sofia F.', teams: K.SERIE_A.order.length - 1, orderAt: K.SERIE_A.revealAt };
  /** The commissioner's card. mode: 'choose' | 'inviting'. */
  const ReconfirmCard = ({ mode = 'choose' }) => (
    <div className="ks-card" role="alert" style={{ padding: '12px 14px', display: 'grid', gap: 8, background: 'var(--c-warn-tint)', borderColor: 'var(--c-warn-line)', boxShadow: 'none' }}>
      <span className="ks-tag" style={{ color: 'var(--c-warn-text)' }}>{mode === 'choose' ? 'Needs you' : 'Waiting for a new manager'}</span>
      <span className="ks-callout" style={{ fontWeight: 700, color: 'var(--c-text)' }}>{mode === 'choose' ? `${RECON.left} left the league` : `Invite someone to take ${RECON.left}'s place`}</span>
      <span className="ks-caption" style={{ color: 'var(--c-text)' }}>{mode === 'choose'
        ? `Move forward with ${RECON.teams} teams, or invite someone new to take their place. The draft can't start until you choose.`
        : 'Share the code. When someone joins, the draft is ready to go.'}</span>
      {mode === 'choose' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="ks-btn">Move forward with {RECON.teams}</span>
          <span className="ks-btn ks-btn--secondary">Invite someone new</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'var(--c-surface)' }}>
            <span><span className="ks-caption">Invite code</span><br /><b className="ks-num" style={{ letterSpacing: '0.12em' }}>SERIEA7</b></span>
            <span className="ks-callout" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Share</span>
          </div>
          <span className="ks-callout" style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Move forward with {RECON.teams} instead</span>
        </>
      )}
    </div>
  );
  /** Commissioner Home after a pre-draft leave. */
  function ReconfirmHome({ mode = 'choose' }) {
    return (
      <Device tab="home" label={`Home, commissioner reconfirms (${mode})`}>
        <Head name={K.SERIE_A.name} avatar />
        <div className="ks-pad ks-stack">
          <ReconfirmCard mode={mode} />
          <GameCard tag="Draft" chip={<span className="ks-chip">Pre-draft</span>}>
            <span className="ks-title">Sat, Oct 3 · 7:00 PM ET</span>
            <span className="ks-score ks-num" style={{ fontSize: 40 }}>2d 06h 40m</span>
            <span className="ks-callout ks-muted">60-second picks · 6 rounds</span>
            <span className="ks-callout" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="ks-dot" />Draft order set Sat 6:00 PM ET, once the teams are confirmed</span>
          </GameCard>
        </div>
      </Device>
    );
  }
  /** What blocks the start: the commissioner's Start the draft sheet. */
  function ReconfirmStartBlocked() {
    return (
      <Device tab="league" label="Start the draft, teams not confirmed" overlay={
        <Sheet top={320}>
          <span className="ks-title">Start the draft?</span>
          <Alert>{RECON.left} left. Choose how to go ahead first: move forward with {RECON.teams} teams, or invite someone new.</Alert>
          <span className="ks-callout"><b>Draft order:</b> set as soon as you confirm the teams.</span>
          <div style={{ display: 'grid', gap: 8 }}>
            <span className="ks-btn ks-btn--secondary">Move forward with {RECON.teams}</span>
            <span className="ks-btn ks-btn--secondary">Invite someone new</span>
          </div>
          <span className="ks-btn" style={{ opacity: 0.4 }} aria-disabled="true">Start draft</span>
        </Sheet>
      }>
        <Head name={K.SERIE_A.name} chip={<span className="ks-chip">Pre-draft</span>} />
      </Device>
    );
  }
  /** A member's Home while the commissioner hasn't chosen (Giulia V.'s phone). */
  function ReconfirmMember() {
    return (
      <Device tab="home" label="Home, member, waiting on the commissioner">
        <Head name={K.SERIE_A.name} chip={null} />
        <div className="ks-pad ks-stack">
          <GameCard tag="Draft" chip={<span className="ks-chip">Pre-draft</span>}>
            <span className="ks-title">Sat, Oct 3 · 7:00 PM ET</span>
            <span className="ks-score ks-num" style={{ fontSize: 40 }}>2d 06h 40m</span>
            <span className="ks-callout ks-muted">60-second picks · 6 rounds</span>
            <span className="ks-callout">{RECON.left} left. Waiting for Roberto B. to confirm the teams before the draft.</span>
            <span className="ks-btn ks-btn--ongame">Build your queue</span>
          </GameCard>
        </div>
      </Device>
    );
  }
  /** Before the lock: Leave league is open, and says until when. */
  function LeaveOpenRow() {
    return <LeagueSettingsLeave commish={false} name={K.SERIE_A.name} leave={<Card><ul className="ks-rows"><li className="ks-row" style={{ gridTemplateColumns: '1fr 16px', padding: '13px 0' }}><span><span className="ks-callout" style={{ fontWeight: 600, color: 'var(--c-danger)' }}>Leave league</span><br /><span className="ks-caption">You can leave until {RECON.orderAt}, when the draft order is set.</span></span><span className="ks-muted"><Icon d={ICON.right} size={16} /></span></li></ul></Card>} />;
  }
  /** After the season: Leave league hides the league for this player (Andrea P.'s phone). */
  function LeaveFinished() {
    return (
      <Device tab="league" label="Leave a finished league" overlay={
        <Sheet top={440}>
          <span className="ks-title">Leave {K.LEAGUE.name}?</span>
          <Bullets items={['It comes off your Home and Your leagues.', 'Season 1 stays in the league’s History, with your record in it.']} />
          <DangerBtn>Leave league</DangerBtn>
          <span className="ks-btn">Stay</span>
        </Sheet>
      }>
        <Head chip={<span className="ks-chip ks-chip--final">Final</span>} />
      </Device>
    );
  }
  /** Refusals: the cases where leaving (or coming back) is blocked. */
  function LeaveRefused({ kind }) {
    if (kind === 'drafting') return <LeagueSettingsLeave commish={false} name={K.SERIE_A.name} leave={<LeaveRow off sub={LOCKED_LINE} />} />;
    if (kind === 'season') return <LeagueSettingsLeave commish={false} leave={<LeaveRow off sub={LOCKED_LINE} />} />;
    if (kind === 'commish') return <LeagueSettingsLeave name={K.SERIE_A.name} leave={<LeaveRow off sub="Make someone else commissioner first." />} />;
    if (kind === 'sole') {
      return (
        <Device tab="league" label="Leave refused, only manager" overlay={
          <Sheet top={540}>
            <span className="ks-title">You can't leave yet</span>
            <Alert>You're the only manager in {K.SERIE_A.name}; everyone else is a bot. Delete the league instead.</Alert>
            <span className="ks-btn">OK</span>
          </Sheet>
        }>
          <Head name={K.SERIE_A.name} chip={null} />
        </Device>
      );
    }
    // rejoin (Q5-A): the join sheet refuses a manager who left this season.
    return (
      <Device tab="home" label="Join refused after leaving" overlay={
        <Sheet top={420}>
          <span className="ks-title">Join with code</span>
          <Field label="Invite code" value="SCUDETTO" />
          <Alert>You left {K.LEAGUE.name} this season, so you can't rejoin it. You can still view it from Your leagues.</Alert>
          <span className="ks-btn" style={{ opacity: 0.4 }}>Join</span>
        </Sheet>
      }>
        <Head name="Friday Night Stocks" chip={null} />
      </Device>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // JOIN A LEAGUE + NOT FOUND (2026-10-06): two 1.2.0 screens with no frame
  // (docs/design/1.2.0-screen-inventory.md). All copy new. The joiner is
  // Tommaso P., a new player with Roberto's code for Serie A Traders (6 of 8
  // joined). The preview shows ONLY what preview-league returns: name,
  // commissioner, member count, stakes, season length, draft date.
  // ═════════════════════════════════════════════════════════════════════
  const Spinner = () => <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 8, border: '2px solid currentColor', borderRightColor: 'transparent', display: 'inline-block' }} />;
  const JoinHead = () => (
    <>
      <Back label="Your leagues" />
      <div className="ks-pad ks-stack" style={{ gap: 6, paddingBottom: 0 }}>
        <h2 className="ks-head__title" style={{ fontSize: 28 }}>Join a league</h2>
      </div>
    </>
  );
  const PREVIEW = { name: K.SERIE_A.name, commish: 'Roberto B.', members: 6, max: 8, stakes: 'Equal stakes · $2,000 per slot', weeks: '10 weeks', draft: 'Sat, Oct 3 · 7:00 PM ET' };
  /** Code entry: 'typing' | 'checking' | 'bad' (no league has the code). */
  function JoinCode({ state = 'typing' }) {
    const value = state === 'typing' ? 'SERIEA' : state === 'bad' ? 'SERIAE7' : 'SERIEA7';
    return (
      <Device noTabs label={`Join a league, ${state}`}>
        <JoinHead />
        <div className="ks-pad ks-stack">
          <p className="ks-callout ks-muted" style={{ margin: 0 }}>Enter the invite code your commissioner sent you.</p>
          <Field label="Invite code" value={value} focused={state !== 'checking'}
            error={state === 'bad' ? 'No league has that code. Check it and try again.' : null} />
          {state === 'checking' ? (
            <span className="ks-btn" style={{ display: 'inline-flex', gap: 8, justifyContent: 'center', alignItems: 'center', opacity: 0.7 }}><Spinner />Finding league</span>
          ) : null}
        </div>
        {state === 'checking' ? null : (
          <div className="ks-kbd-dock">
            <span className="ks-btn" style={{ margin: '0 16px 8px' }}>Find league</span>
            <Keyboard />
          </div>
        )}
      </Device>
    );
  }
  /** The league preview. block: null (joinable) | 'full' | 'drafted' | 'member'. */
  function JoinPreview({ block = null }) {
    const P = PREVIEW;
    const members = block === 'full' ? P.max : P.members;
    const msg = {
      full: `${P.name} is full: ${P.max} of ${P.max} managers. Ask ${P.commish} if they can make room.`,
      drafted: `${P.name} has already drafted, so it can't take new managers this season.`,
      member: `You're already in ${P.name}.`,
    }[block];
    return (
      <Device noTabs label={`League preview${block ? `, ${block}` : ''}`}>
        <Back label="Invite code" />
        <div className="ks-pad ks-stack">
          <div style={{ display: 'grid', gap: 4 }}>
            <span className="ks-tag" style={{ color: 'var(--c-text-2)' }}>Invite code SERIEA7</span>
            <h2 className="ks-head__title" style={{ fontSize: 30 }}>{P.name}</h2>
            <span className="ks-callout ks-muted">Run by {P.commish}</span>
          </div>
          <Card><Sum rows={[
            ['Managers', `${members} of ${P.max}`],
            ['Draft', block === 'drafted' ? 'Done' : P.draft],
            ['Stakes', P.stakes],
            ['Season', P.weeks],
          ]} /></Card>
          {block ? <Alert>{msg}</Alert> : null}
          {block === 'member' ? <span className="ks-btn">Open the league</span>
            : block ? <span className="ks-btn ks-btn--secondary">Try another code</span>
            : <span className="ks-btn">Join {P.name}</span>}
          {block ? null : <span className="ks-caption" style={{ textAlign: 'center' }}>You can leave any time before the draft.</span>}
        </div>
      </Device>
    );
  }
  /** Joined. */
  function JoinDone() {
    return (
      <Device noTabs label="Joined a league">
        <div className="ks-pad ks-stack" style={{ paddingTop: 120, justifyItems: 'center', textAlign: 'center' }}>
          <span className="ks-pop" style={{ width: 88, height: 88, borderRadius: 44, display: 'grid', placeItems: 'center', background: 'var(--c-gain-tint)', color: 'var(--c-gain)', alignSelf: 'center' }}><Icon d={CHECK} size={44} width={2.6} /></span>
          <h2 className="ks-head__title" style={{ fontSize: 30 }}>You're in {PREVIEW.name}</h2>
          <p className="ks-callout ks-muted" style={{ margin: 0 }}>The draft is {PREVIEW.draft}. The draft order is set an hour before.</p>
          <span className="ks-btn" style={{ width: '100%', marginTop: 16 }}>Go to the league</span>
        </div>
      </Device>
    );
  }
  /** +not-found: every bad deep link lands here. A calm dead end, one way out. */
  function NotFound() {
    return (
      <Device noTabs label="Not found">
        <div className="ks-pad ks-stack" style={{ paddingTop: 180, justifyItems: 'center', textAlign: 'center', gap: 12 }}>
          <span style={{ width: 72, height: 72, borderRadius: 36, display: 'grid', placeItems: 'center', background: 'var(--c-sunken)', color: 'var(--c-text-2)', alignSelf: 'center' }}><Icon d={ICON.search} size={32} /></span>
          <h2 className="ks-head__title" style={{ fontSize: 28 }}>Nothing here</h2>
          <p className="ks-callout ks-muted" style={{ margin: 0, maxWidth: 280 }}>This link is old or incomplete. Everything in your leagues is still where you left it.</p>
          <span className="ks-btn" style={{ width: '100%', marginTop: 12 }}>Go to Home</span>
        </div>
      </Device>
    );
  }

  window.KSInventory = {
    SignIn, SignUp, SignUpPaused, Forgot, Onboarding, GetStarted, PickUsername, LeagueSheet, Profile, Appearance, ChangePassword, EmptyHome,
    HomePreDraft, HomeDrafting, HomePreSeason, HomeClosed, HomeUnpriced, HomeScoring, HomeComplete,
    AllMatchups, MatchupPreSeason, Playoffs6, ArrangeOrder, OrderPush, DraftLobby, StartDraftConfirm, CreateSeason, DraftAutoPick, DraftRecap, Playoffs,
    SellSheet, ReviewSell, Done, ReviewBuy, PickSource, MarketClosed, TradeHistory,
    OneShareSell, OneShareBuy,
    TierPortfolio, TierReview, TierRefused,
    LeagueSettingsLeave, LeaveSheet, CommishLeave, OrderAfterLeave, DepartedMatchup, DepartedStandings, DepartedBracket, LeaverLeague, LeaverSheet, LeaveRefused, LeaveRow, ReconfirmHome, ReconfirmStartBlocked, ReconfirmMember, LeaveOpenRow, LeaveFinished,
    JoinCode, JoinPreview, JoinDone, NotFound,
    DraftRefused, StartBlocked, DraftStalled, StallPush,
    RibHome, RibLeague, RibPush, RibMemberPrompt, RibHomeCounts, RibReconcile, RibMemberList, RibResolve, RibReview, RibHistory,
    WebHome, WebPortfolio, WebSettings,
  };
})();
