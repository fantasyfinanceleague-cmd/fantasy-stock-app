import React from 'react';
import logo from '../assets/stockpile-logo.png';
import '../styles/stockpile-tokens.css';
import './LandingPage.css';

/**
 * Stockpile marketing landing page.
 *
 * Recreated from the Claude Design web UI kit (light theme, Manrope display,
 * #0891B2 cyan accent, brand green→teal→cyan gradient). The product is
 * PRE-LAUNCH: there is no signup / login / app download yet, so every CTA is a
 * confident "coming soon" state instead. The mocked product UI (portfolio card,
 * matchup, standings board) is kept as the visual centerpiece — illustrative
 * demo data, not real users.
 */

// ── Mock data (illustrative — a preview of the product, not real users) ──────
const TAPE = [
  { t: 'NVDA', p: '318.37', d: '+3.81%', tone: 'gn' },
  { t: 'AAPL', p: '211.42', d: '+1.24%', tone: 'gn' },
  { t: 'MSFT', p: '421.62', d: '+0.88%', tone: 'gn' },
  { t: 'TSLA', p: '248.36', d: '-0.52%', tone: 'ls' },
  { t: 'GOOGL', p: '179.01', d: '+0.41%', tone: 'gn' },
  { t: 'META', p: '498.50', d: '+1.92%', tone: 'gn' },
  { t: 'AMZN', p: '236.40', d: '-1.18%', tone: 'ls' },
  { t: 'AMD', p: '172.95', d: '-0.31%', tone: 'ls' },
  { t: 'AVGO', p: '1124.20', d: '+0.84%', tone: 'gn' },
  { t: 'COIN', p: '212.07', d: '+2.04%', tone: 'gn' },
  { t: 'PLTR', p: '34.18', d: '+5.12%', tone: 'gn' },
  { t: 'JPM', p: '215.45', d: '+0.22%', tone: 'gn' },
];

const STANDINGS = [
  { rank: 1, init: 'PM', av: 'linear-gradient(135deg,#16A34A,#0F7A33)', name: 'Paolo M.', rec: '5–0', pct: '+8.42%', tone: 'gain' },
  { rank: 2, init: 'RB', av: 'linear-gradient(135deg,#2BC592,#0AA0BD)', name: 'Roberto B.', you: true, rec: '4–1', pct: '+5.10%', tone: 'gain' },
  { rank: 3, init: 'AD', av: 'linear-gradient(135deg,#FB7185,#BE185D)', name: 'Alessandro D.', rec: '4–1', pct: '+4.88%', tone: 'gain' },
  { rank: 4, init: 'FT', av: 'linear-gradient(135deg,#A78BFA,#6D28D9)', name: 'Francesco T.', rec: '3–2', pct: '+2.31%', tone: 'gain' },
  { rank: 5, init: 'GB', av: 'linear-gradient(135deg,#FBBF24,#D97706)', name: 'Gianluigi B.', rec: '2–3', pct: '−1.04%', tone: 'loss' },
  { rank: 6, init: 'AP', av: 'linear-gradient(135deg,#94A3B8,#475569)', name: 'Andrea P.', rec: '1–4', pct: '−2.88%', tone: 'loss' },
];

const FAQ = [
  {
    q: 'When does Stockpile launch?',
    a: 'Stockpile is in development and launching soon. This page is a preview of what’s coming — there’s nothing to sign up for just yet.',
  },
  {
    q: 'How do I get access?',
    a: 'There’s no signup right now. When we launch, you’ll be able to create a league and invite friends right here. Check back soon.',
  },
  {
    q: 'Is this real investing?',
    a: 'No. Stockpile tracks the performance of real stocks, but it never buys, sells, or holds any securities. It’s a game built on market data, not a brokerage.',
  },
  {
    q: 'Does it cost anything?',
    a: 'No. Stockpile is free to play. There are no entry fees and no subscriptions.',
  },
  {
    q: 'Do I win money?',
    a: 'No. There are no cash prizes or payouts — just standings, trophies, and bragging rights.',
  },
];

// Mini weekly performance bars. Heights are explicit px against a 120px track
// (percentage heights collapse here — the flex parent has no definite height).
const BARS = [
  { h: 60, l: 'M' },
  { h: 94, l: 'T' },
  { h: 50, l: 'W' },
  { h: 106, l: 'T' },
  { h: 78, l: 'F' },
];

// "This week's movers" — illustrative tickers for the live preview card.
const MOVERS = [
  { t: 'NVDA', co: 'NVIDIA', d: '+3.81%', tone: 'gain' },
  { t: 'PLTR', co: 'Palantir', d: '+5.12%', tone: 'gain' },
  { t: 'META', co: 'Meta', d: '+1.92%', tone: 'gain' },
  { t: 'TSLA', co: 'Tesla', d: '−0.52%', tone: 'loss' },
  { t: 'AMZN', co: 'Amazon', d: '−1.18%', tone: 'loss' },
];

// ── Small inline icons (Lucide-style, 2px stroke) ────────────────────────────
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const ArrowRight = ({ s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
);
const IconUsers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><circle cx="9" cy="7" r="4" /><path d="M3 21a6 6 0 0 1 12 0" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M22 21a6 6 0 0 0-3-5.18" /></svg>
);
const IconDraft = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" /><path d="m16 16 6-6" /><path d="m8 8 6-6" /><path d="m9 7 8 8" /><path d="m21 11-8-8" /></svg>
);
const IconTrophy = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M17 4h3v3a3 3 0 0 1-3 3" /><path d="M7 4H4v3a3 3 0 0 0 3 3" /></svg>
);
const IconActivity = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
);
const IconExpand = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M21 3l-7 7" /><path d="M3 3l7 7" /><path d="M16 21h5v-5" /><path d="M8 21H3v-5" /><path d="M21 21l-7-7" /><path d="M3 21l7-7" /></svg>
);

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="sp-landing">

      {/* TICKER TAPE */}
      <div className="ticker-bar" aria-hidden="true">
        <div className="ticker-track">
          {[...TAPE, ...TAPE].map((it, i) => (
            <span className="tk" key={i}>
              <span className="live-dot" />
              <b>{it.t}</b>
              <span className="px">${it.p}</span>
              <span className={it.tone}>{it.d}</span>
            </span>
          ))}
        </div>
      </div>

      {/* NAV */}
      <nav className="nav">
        <div className="nav-inner">
          <a href="#top" className="brand" aria-label="Stockpile">
            <img src={logo} alt="Stockpile" />
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#why">Why Stockpile</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="nav-cta">
            <span className="soon-pill"><span className="dot" /> Launching soon</span>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero" id="top">
        <div className="dot-grid" />
        <div className="hero-inner">
          <div className="eyebrow rise rise-1"><span className="dot" /> Launching soon</div>
          <h1 className="headline rise rise-2">Draft stocks.<br />Beat your friends.<br /><em>Win the league.</em></h1>
          <p className="lede rise rise-3">Stockpile is fantasy sports for the stock market. Build a portfolio, go head-to-head with friends, and prove who really knows the market.</p>
          <div className="hero-cta rise rise-4">
            <span className="btn btn-primary btn-lg btn-soon" role="status">Coming soon</span>
            <a className="btn btn-ghost btn-lg" href="#how">See how it works</a>
          </div>
          <div className="hero-meta rise rise-5">
            <span><b>Free to play</b></span>
            <span className="sep">·</span>
            <span><b>No real money</b></span>
            <span className="sep">·</span>
            <span><b>Real-time</b> market data</span>
          </div>
        </div>
      </section>

      {/* LIVE PREVIEW (mocked product UI — the centerpiece) */}
      <section className="live-preview-wrap">
        <div className="live-preview-label">
          <span className="txt">A look inside Stockpile</span>
          <span className="dash" />
        </div>
        <div className="live-preview-inner">

          {/* Main data card */}
          <div className="data-card rise">
            <div className="data-card-head">
              <div>
                <div className="lbl">Portfolio · Stock Scudetto</div>
                <h4>Week 6 · Live</h4>
              </div>
              <span className="live-pill"><span className="d" /> Live</span>
            </div>

            <div className="big-num">$12,430.55</div>
            <div className="delta-row">
              <span className="delta gain">▲ $284.10 · +2.34%</span>
              <span className="day">today</span>
            </div>

            <div className="sparkline-wrap">
              <svg viewBox="0 0 320 80" width="100%" height="80" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                <defs>
                  <linearGradient id="spGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#14B59A" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#14B59A" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline fill="url(#spGrad)" stroke="none" points="0,76 24,72 48,66 72,68 96,58 120,52 144,55 168,42 192,38 216,32 240,28 264,18 288,12 320,6 320,80 0,80" />
                <polyline fill="none" stroke="#14B59A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points="0,76 24,72 48,66 72,68 96,58 120,52 144,55 168,42 192,38 216,32 240,28 264,18 288,12 320,6" />
                <circle cx="320" cy="6" r="4" fill="#14B59A" stroke="#fff" strokeWidth="2" />
              </svg>
            </div>

            <div className="range-tabs">
              <button type="button">1D</button>
              <button type="button">1W</button>
              <button type="button" className="active">1M</button>
              <button type="button">3M</button>
              <button type="button">YTD</button>
              <button type="button">ALL</button>
            </div>

            <div className="holdings">
              <div className="holding"><span className="sd" style={{ background: '#14B59A' }} /><div><div className="ticker">NVDA</div><div className="co">NVIDIA · 12 sh</div></div><span className="num">$3,820.40</span><span className="delta gain">+3.81%</span></div>
              <div className="holding"><span className="sd" style={{ background: '#14B59A' }} /><div><div className="ticker">AAPL</div><div className="co">Apple · 10 sh</div></div><span className="num">$2,114.22</span><span className="delta gain">+1.24%</span></div>
              <div className="holding"><span className="sd" style={{ background: '#DC2626' }} /><div><div className="ticker">TSLA</div><div className="co">Tesla · 6 sh</div></div><span className="num">$1,490.18</span><span className="delta loss">−0.52%</span></div>
            </div>
          </div>

          {/* Side stack */}
          <div className="side-stack rise rise-1">
            <div className="side-card matchup-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="card-lbl">This week’s matchup</span>
                <span className="live-pill"><span className="d" /> Live</span>
              </div>
              <div className="matchup-row">
                <span className="avatar" style={{ background: 'linear-gradient(135deg,#2BC592,#0AA0BD)' }}>RB</span>
                <div className="player-block">
                  <div className="player-name">Roberto B.</div>
                  <div className="player-sub">you</div>
                </div>
                <span className="player-pct gain">+2.34%</span>
              </div>
              <div className="matchup-bar">
                <div className="gn-fill" style={{ width: '72%' }} />
                <div className="ls-fill" style={{ width: '28%' }} />
              </div>
              <div className="matchup-row right">
                <span className="player-pct loss">−0.91%</span>
                <div className="player-block">
                  <div className="player-name">Gianluigi B.</div>
                  <div className="player-sub">opponent</div>
                </div>
                <span className="avatar" style={{ background: 'linear-gradient(135deg,#FBBF24,#D97706)' }}>GB</span>
              </div>
              <div className="matchup-foot">
                <span>Win prob 72%</span>
                <span>3d 4h left</span>
              </div>
            </div>

            <div className="side-card movers-card">
              <div className="card-lbl">This week’s movers</div>
              <div className="movers-list">
                {MOVERS.map((m) => (
                  <div className="mover" key={m.t}>
                    <span className="sd" style={{ background: m.tone === 'gain' ? '#14B59A' : '#DC2626' }} />
                    <span className="ticker">{m.t}</span>
                    <span className="mover-co">{m.co}</span>
                    <span className={`delta ${m.tone}`}>{m.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section" id="how">
        <div className="section-head section-head--centered">
          <span className="kicker">/ 01 — How it works</span>
          <h2>Draft a team. Compete weekly.<br />Climb the <em>league.</em></h2>
          <p>Three steps. No fantasy points, no proxies — your score is your portfolio’s actual return, pulled from real market data every weekday.</p>
        </div>
        <div className="steps">
          <div className="step">
            <div className="step-icon"><IconUsers /></div>
            <div className="step-num">01</div>
            <h3><em>Draft</em> a team</h3>
            <p>Snake-draft real stocks with friends. Pick order reverses each round — build a portfolio you actually believe in.</p>
          </div>
          <div className="step">
            <div className="step-icon"><IconDraft /></div>
            <div className="step-num">02</div>
            <h3>Compete <em>weekly</em></h3>
            <p>Monday to Friday, your portfolio runs head-to-head against an opponent. Best return wins the matchup.</p>
          </div>
          <div className="step">
            <div className="step-icon"><IconTrophy /></div>
            <div className="step-num">03</div>
            <h3><em>Climb</em> the league</h3>
            <p>Stack up wins, rise through the standings, and make a playoff run for the season trophy.</p>
          </div>
        </div>
      </section>

      {/* LEAGUES IN ACTION (standings centerpiece) */}
      <section className="standings-section" id="leagues">
        <div className="standings-grid">
          <div className="standings-copy">
            <span className="kicker">/ 02 — Leagues in action</span>
            <h2>A scoreboard for your <em>portfolio.</em></h2>
            <p>Watch standings move with the market. Real prices, real volatility, real bragging rights — every minute the bell is open.</p>
            <ul className="feature-list">
              <li><span className="arr">→</span> Live prices stream from the open to the close</li>
              <li><span className="arr">→</span> Records, streaks, and W/L history per player</li>
              <li><span className="arr">→</span> Playoff seeding, weekly matchups, season trophy</li>
            </ul>
          </div>

          <div className="standings-board">
            <div className="board-head">
              <div>
                <div className="ttl">Stock Scudetto</div>
                <div className="meta">Standings · Week 6 of 14</div>
              </div>
              <span className="live-pill"><span className="d" /> Live</span>
            </div>
            {STANDINGS.map((r) => (
              <div className={`board-row${r.you ? ' you' : ''}`} key={r.rank}>
                <span className={`rank${r.rank <= 3 ? ` rank-${r.rank}` : ''}`}>{r.rank}</span>
                <div className="player">
                  <span className="avatar" style={{ background: r.av }}>{r.init}</span>
                  <span className="name">{r.name}{r.you && <span className="you-tag"> (you)</span>}</span>
                </div>
                <span className="rec">{r.rec}</span>
                <span className={`pct ${r.tone}`}>{r.pct}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY STOCKPILE (bento) */}
      <section className="section" id="why">
        <div className="section-head section-head--centered">
          <span className="kicker">/ 03 — Why Stockpile</span>
          <h2>The rigor of investing,<br />the rhythm of <em>fantasy.</em></h2>
        </div>
        <div className="bento">
          <div className="bento-cell tall">
            <div className="bento-icon"><IconActivity /></div>
            <h3>Real prices.<br /><em>Real consequences.</em></h3>
            <p>Every score is a portfolio return — pulled from live market data. No fantasy points, no proxies. If your picks go up, you win.</p>
            <div className="bar-chart">
              <div className="bars">
                {BARS.map((b, i) => (
                  <div className="bar-col" key={`${b.l}-${i}`}>
                    <div className="bar-track"><div className="bar" style={{ height: `${b.h}px` }} /></div>
                    <span className="bar-lbl">{b.l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="bento-cell">
            <div className="bento-icon"><IconExpand /></div>
            <h3>Investing, <em>gamified.</em></h3>
            <p>The discipline of managing a portfolio, with the snake drafts, matchups, and playoffs of a fantasy league layered on top.</p>
          </div>
          <div className="bento-cell">
            <div className="bento-icon"><IconTrophy /></div>
            <h3>Free to play. <em>No money.</em></h3>
            <p>Stockpile tracks performance only — it never holds securities, and there are no entry fees, prizes, or payouts. Just bragging rights.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section" id="faq">
        <div className="section-head section-head--centered">
          <span className="kicker">/ 04 — FAQ</span>
          <h2>Questions, <em>answered.</em></h2>
        </div>
        <div className="faq-list">
          {FAQ.map((item) => (
            <div className="faq-item" key={item.q}>
              <div className="faq-q">{item.q}</div>
              <div className="faq-a">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA STRIP (coming soon) */}
      <section className="cta-strip">
        <div className="cta-inner">
          <div>
            <h2>Launching <em>soon.</em></h2>
            <p>Stockpile is almost ready. The first opening bell is just around the corner.</p>
          </div>
          <span className="soon-pill" role="status"><span className="dot" /> Coming soon</span>
        </div>
        <div className="cta-grid" />
      </section>

      {/* FOOTER */}
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <img src={logo} alt="Stockpile" />
            <p>Fantasy sports for the stock market. Draft real stocks, compete weekly, climb your league.</p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <a href="#how">How it works</a>
            <a href="#why">Why Stockpile</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            {/* Placeholder links — no legal copy exists yet (do not invent). */}
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Contact</a>
          </div>
          <div className="footer-social" aria-label="Social links">
            <a href="#" aria-label="X (Twitter)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" /></svg>
            </a>
            <a href="#" aria-label="Instagram">
              <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><line x1="17.5" y1="6.5" x2="17.5" y2="6.5" /></svg>
            </a>
            <a href="#" aria-label="GitHub">
              <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 4 5 4 5 4c-.3 1.15-.3 2.35 0 3.5a5.4 5.4 0 0 0-1 3.5c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="footer-bottom-inner">
            <div className="footer-disclaimer">
              Stockpile is for entertainment purposes only. Not investment advice. Market data delayed.
            </div>
            <div className="footer-attribution">[MARKET DATA ATTRIBUTION PLACEHOLDER]</div>
            <div className="footer-copy">© {year} Stockpile · Simulated portfolios, real market data.</div>
          </div>
        </div>
      </footer>

    </div>
  );
}
