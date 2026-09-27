import { useEffect } from 'react';
import { brand } from '../../brand';
import { BrandMark } from '../../design/BrandMark';
import { MotionRoot } from '../../design/MotionRoot';
import { Surface } from '../../design/Surface';
import { Hero } from './Hero';
import { WeekSection } from './WeekSection';
import { Standings } from './Standings';
import { MoneySide } from './MoneySide';
import { Faq } from './Faq';
import { ensureArchivoStylesheet } from './head';
// Tokens and primitives by module path — NOT the design/index barrel,
// which also pulls design/fonts.css (a render-blocking @import). The font
// comes from head.ts instead (Orchestrator decision C, phase 3a).
import '../../styles/tokens.css';
import './landing.css';

/**
 * The public landing page (Phase 3a, Game Day — DESIGN_DIRECTION §6,
 * docs/design/prompts/phase3a-landing.md).
 *
 * Pre-launch: "Launching soon" is a status, never something that looks
 * clickable; there's no signup, login or email capture, and no link that
 * goes nowhere. Name-agnostic: the product name only ever comes from
 * `brand.name`. Structurally isolated from the app: nothing here imports
 * the legacy app CSS, the app providers or Supabase (App.jsx lazy-loads
 * all of those, only when unpaused) — design/build-isolation.test.ts.
 *
 * Prerendered at build time (scripts/prerender-landing.mjs) and hydrated,
 * so every section's server render must equal its first client render;
 * see hooks.ts.
 */

function LaunchingSoon({ tone = 'onLight' }: { tone?: 'onLight' | 'onGame' }) {
  return (
    <span className={`lp-status lp-status--${tone}`}>
      <span className="lp-status__dot" aria-hidden="true" />
      Launching soon
    </span>
  );
}

function Nav() {
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav__inner">
        <a className="lp-brand" href="#top">
          <BrandMark size={24} className="lp-brand__mark" />
          <span className="lp-brand__name">{brand.name}</span>
        </a>
        <nav aria-label="Sections" className="lp-nav__links">
          <a href="#how">How a week works</a>
          <a href="#leagues">Leagues</a>
          <a href="#faq">FAQ</a>
        </nav>
        <LaunchingSoon />
      </div>
    </header>
  );
}

function LaunchBand() {
  return (
    <section className="lp-launch" aria-labelledby="lp-launch-title">
      <Surface kind="game" className="lp-launch__band">
        <div className="lp-wrap lp-launch__inner">
        <h2 className="lp-launch__title" id="lp-launch-title">
          Launching soon
        </h2>
        <p className="lp-launch__promise">
          Start a league, draft your stocks, and settle it every Friday at the closing bell.
        </p>
        </div>
      </Surface>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer__inner">
        <div className="lp-brand lp-brand--static">
          <BrandMark size={20} className="lp-brand__mark" />
          <span className="lp-brand__name">{brand.name}</span>
        </div>
        <p className="lp-footer__disclaimer">
          {brand.name} is for entertainment only. It isn’t investment advice. Market data is delayed.
        </p>
        <p className="lp-footer__copy">
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> {brand.name}
        </p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  useEffect(() => {
    ensureArchivoStylesheet();
  }, []);

  // MotionRoot (MotionConfig reducedMotion="user") makes motion's own
  // components — the TugBar, layout re-sorts, chyrons — honour the OS
  // reduced-motion setting too; useMotion() reads it directly.
  return (
    <MotionRoot>
      <div className="lp">
        <a className="lp-skip" href="#main">
          Skip to content
        </a>
        <Nav />
        <main id="main" tabIndex={-1}>
          <Hero />
          <WeekSection />
          <Standings />
          <MoneySide />
          <Faq />
          <LaunchBand />
        </main>
        <Footer />
      </div>
    </MotionRoot>
  );
}
