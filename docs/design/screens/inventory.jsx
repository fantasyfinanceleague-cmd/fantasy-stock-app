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
          {rules.map(([ok, t]) => <span key={t} className={ok ? 'ks-gain' : 'ks-muted'}>{ok ? '✓' : '○'} {t}</span>)}
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
          <Field label="Password" value="hunter2hunter" secure focused />
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
          <Field label="Password" value="Scudetto26" secure rules={[[true, '8+ characters'], [true, 'A letter'], [true, 'A number']]} />
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
          <Field label="Password" value="Scudett" secure focused rules={[[true, '8+ characters'], [true, 'A letter'], [false, 'A number']]} />
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
                <p className="ks-callout ks-muted" style={{ margin: '4px 0 0' }}>Enter your email and we'll send you a link to reset it.</p>
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
            <ul className="ks-rows"><Lg n="Serie A Traders" meta="6 of 8 joined" chip="Draft Sat 7:00 PM" /></ul>
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
          <Field label="New password" value="Scudetto26" secure rules={[[true, '8+ characters'], [true, 'A letter'], [true, 'A number']]} />
          <Field label="Confirm new password" value="Scudetto2" secure focused error="Passwords don't match." />
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
  const Hero = ({ value, gain, gainLabel = 'since the draft', meta }) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ks-caption">Your team</span><span className="ks-caption ks-num">{meta}</span></div>
      <div className="ks-score ks-num" style={{ fontSize: 48, lineHeight: '50px', fontStretch: '75%' }}>{$(value)}</div>
      <div className="ks-callout ks-num" style={{ fontWeight: 700 }}><span className={tone(gain)}>{$s(gain)}</span> <span className="ks-muted" style={{ fontWeight: 500 }}>{gainLabel}</span></div>
    </div>
  );

  function HomePreDraft() {
    const members = ['RB', 'MR', 'LC', 'SF', 'GV', 'TP'];
    return (
      <Device tab="home" label="Home, pre-draft">
        <Head name="Serie A Traders" avatar />
        <div className="ks-pad ks-stack">
          <GameCard tag="Draft" chip={<span className="ks-chip">Pre-draft</span>}>
            <span className="ks-title">Sat, Oct 3 · 7:00 PM</span>
            <span className="ks-score ks-num" style={{ fontSize: 40 }}>3d 04h 12m</span>
            <span className="ks-callout ks-muted">60-second picks · 6 rounds · order set when the draft starts</span>
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

  function HomeScoring() {
    return (
      <Device tab="home" label="Home, week final, scoring">
        <Head avatar />
        <div className="ks-pad ks-stack">
          <Hero value={12000 + K.HOME.throughW5 + K.MATCHUP.final.you.gain} gain={K.HOME.throughW5 + K.MATCHUP.final.you.gain} meta="Week 6 of 14" />
          <GameCard tag="Week 6" chip={<span className="ks-chip ks-chip--final">Final</span>}>
            <div className="ks-skel" style={{ height: 40 }} />
            <div className="ks-skel" style={{ height: 12 }} />
            <span className="ks-callout" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="ks-dot ks-dot--pulse" />Scoring… Results post a few minutes after Friday's close.</span>
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
            <span className="ks-callout">You won {K.LEAGUE.name} · 11–3 · playoffs 2–0</span>
          </div>
          <Card pad="14px">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 12 }} className="ks-num">
              <span><span className="ks-caption">Season gain</span><br /><b className="ks-gain">+$1,962.40</b></span>
              <span><span className="ks-caption">Best week</span><br /><b>Week 11 · +$412.08</b></span>
              <span><span className="ks-caption">Best pick</span><br /><b>NVDA · +31.4%</b></span>
              <span><span className="ks-caption">Final value</span><br /><b>$13,962.40</b></span>
            </div>
          </Card>
          <span className="ks-btn">See the final standings</span>
          <span className="ks-btn ks-btn--secondary">Start next season</span>
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

  function DraftLobby() {
    const queue = ['NVDA', 'MSFT', 'AAPL', 'CRM', 'COST'];
    return (
      <Device game tab="league" label="Draft lobby">
        <Head name="Serie A Traders" chip={<span className="ks-chip">Pre-draft</span>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-raised" style={{ padding: 16, display: 'grid', gap: 4, textAlign: 'center' }}>
            <span className="ks-tag">Draft starts in</span>
            <span className="ks-score ks-num" style={{ fontSize: 56, lineHeight: '56px' }}>04:59</span>
            <span className="ks-caption ks-muted">Sat 7:00 PM · 60-second picks · order set at the start</span>
          </div>
          <div>
            <div className="ks-section-h"><h3>In the room</h3><span className="ks-caption ks-muted ks-num">5 of 6</span></div>
            <div style={{ display: 'flex', gap: 6 }}>{['RB', 'MR', 'LC', 'SF', 'GV'].map((m, i) => <span key={m} className={i === 0 ? 'ks-avatar ks-avatar--sm' : 'ks-avatar ks-avatar--sm ks-avatar--neutral'}>{m}</span>)}<span className="ks-avatar ks-avatar--sm" style={{ background: 'transparent', border: '1.5px dashed var(--c-line)' }} /></div>
          </div>
          <div>
            <div className="ks-section-h"><h3>Your queue</h3><span className="ks-caption ks-muted">If your clock runs out, we pick from here first</span></div>
            <ul className="ks-rows">{queue.map((t, i) => <li key={t} className="ks-row" style={{ gridTemplateColumns: '20px 36px 1fr 20px', padding: '8px 0' }}><span className="ks-caption ks-muted ks-num">{i + 1}</span><Logo t={t} game /><span className="ks-t ks-callout">{t}</span><span className="ks-muted">≡</span></li>)}</ul>
          </div>
        </div>
      </Device>
    );
  }

  /** Paolo M. timed out twice in a row (picks 12 and 13, back to back at
   * the snake turn): 12 came from his queue, 13 from the best available.
   * New copy throughout. */
  function DraftAutoPick() {
    const { SnakeBoard } = window.KSKit;
    const log = [
      { n: 13, who: 'Paolo M.', t: 'BRK.B', how: 'Auto-picked · best available' },
      { n: 12, who: 'Paolo M.', t: 'LLY', how: 'Auto-picked · from his queue' },
      { n: 11, who: 'Roberto B.', t: 'AAPL', how: 'Picked', you: true },
    ];
    return (
      <Device game tab="league" label="Draft room, after two auto-picks">
        <Head chip={<Chip kind="live">Drafting</Chip>} />
        <div className="ks-pad ks-stack" style={{ gap: 14 }}>
          <div className="ks-chyron ks-chyron--in" style={{ display: 'grid', gap: 2 }}>
            <b>Paolo M. ran out of time</b>
            <span className="ks-caption">Auto-picked LLY from his queue, then BRK.B (best available).</span>
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
              <li className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}><Logo t="SHOP" /><span><span className="ks-t">Bought SHOP</span><br /><span className="ks-caption ks-num">Thu 1:41 PM · {K.SALE.buy.qty.toFixed(4)} sh at {$(K.SALE.buy.price)}</span></span><span className="ks-num"><b>{$(K.SALE.proceeds)}</b></span></li>
              <li className="ks-row" style={{ gridTemplateColumns: '36px 1fr auto' }}><Logo t="TSLA" /><span><span className="ks-t">Sold TSLA</span><br /><span className="ks-caption ks-num">Thu 1:38 PM · {TS().qty.toFixed(4)} sh at {$(248.36)}</span></span><span className="ks-right ks-num"><b>{$(K.SALE.proceeds)}</b><br /><span className={`ks-caption ${tone(K.SALE.realized)}`} style={{ fontWeight: 700 }}>{$s(K.SALE.realized)}</span></span></li>
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
            <div className="ks-card" style={{ padding: 14 }}><div className="ks-section-h"><h3>Season</h3><span className="ks-caption">Gain since the draft</span></div><GainChart series={H.series} weeks={H.weekStarts} w={440} h={170} label="Gain since the draft" /></div>
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

  window.KSInventory = {
    SignIn, SignUp, SignUpPaused, Forgot, Onboarding, GetStarted, PickUsername, LeagueSheet, Profile, Appearance, ChangePassword, EmptyHome,
    HomePreDraft, HomeDrafting, HomePreSeason, HomeClosed, HomeScoring, HomeComplete,
    AllMatchups, MatchupPreSeason, DraftLobby, DraftAutoPick, DraftRecap, Playoffs,
    SellSheet, ReviewSell, Done, ReviewBuy, PickSource, MarketClosed, TradeHistory,
    WebHome, WebPortfolio, WebSettings,
  };
})();
