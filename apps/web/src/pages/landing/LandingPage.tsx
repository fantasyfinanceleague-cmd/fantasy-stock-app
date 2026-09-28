import { useEffect, useRef } from 'react';
import { brand } from '../../brand';
import { BrandMark } from '../../design/BrandMark';
import { MotionRoot } from '../../design/MotionRoot';
import { cta, footer, linkLabel } from './copy';
import { ensureArchivoStylesheet } from './head';
import { useEnhanced, usePointerGlow } from './hooks';
import { LaunchingSoon, Nav } from './Nav';
import { Tape } from './Tape';
import { Opening } from './Opening';
import { HowItWorks } from './HowItWorks';
import { Leagues } from './Leagues';
import { Why } from './Why';
import { Faq } from './Faq';
import { DarkPanel } from './scroll';
// Tokens and primitives by module path — NOT the design/index barrel,
// which also pulls design/fonts.css (a render-blocking @import). The font
// comes from head.ts instead (Orchestrator decision C, phase 3a).
import '../../styles/tokens.css';
import './landing.css';

/**
 * The public landing page (Phase 3a, Game Day — DESIGN_DIRECTION §6,
 * docs/design/prompts/phase3a-landing.md; round 3: the live page's copy
 * verbatim, on a scroll-driven stage — see copy.ts for the only wording
 * changes).
 *
 * Pre-launch: "Launching soon" / "Coming soon" are statuses, never
 * something that looks clickable; there's no signup, login or email
 * capture, and no link that goes nowhere. Name-agnostic: the product name
 * only ever comes from `brand.name`. Structurally isolated from the app:
 * nothing here imports the legacy app CSS, the app providers or Supabase
 * (App.jsx lazy-loads all of those, only when unpaused).
 *
 * Prerendered at build time (scripts/prerender-landing.mjs) and hydrated,
 * so every section's server render equals its first client render — the
 * static version; the pinned, live versions switch in one commit later
 * (hooks.ts useEnhanced), and only with full motion.
 */

function Cta() {
  const glowRef = useRef<HTMLDivElement>(null);
  const enhanced = useEnhanced();
  usePointerGlow(glowRef, enhanced);
  return (
    <DarkPanel className="lp-cta" labelledBy="lp-cta-title">
      <div ref={glowRef} className="lp-cta__glow-area">
        <span className="lp-glow" aria-hidden="true" />
        <div className="lp-wrap lp-cta__inner">
          <div>
            <h2 className="lp-cta__title" id="lp-cta-title">
              {cta.title.text}
              <em>{cta.title.em}</em>
            </h2>
            <p className="lp-cta__body">{cta.body(brand.name)}</p>
          </div>
          <LaunchingSoon label={cta.status} tone="onGame" />
        </div>
      </div>
    </DarkPanel>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer__top">
          <div className="lp-footer__brand">
            <div className="lp-brand lp-brand--static">
              <BrandMark size={22} className="lp-brand__mark" />
              <span className="lp-brand__name">{brand.name}</span>
            </div>
            <p className="lp-footer__tagline">{footer.tagline}</p>
          </div>
          <nav className="lp-footer__col" aria-labelledby="lp-footer-product">
            <h3 className="lp-footer__h" id="lp-footer-product">
              {footer.productHeading}
            </h3>
            {footer.productLinks.map((l) => (
              <a key={l.href} href={l.href}>
                {linkLabel(l.label, brand.name)}
              </a>
            ))}
          </nav>
          {/* The live page's "Company" column (Privacy Policy, Terms of
              Service, Contact) and its X / Instagram / GitHub links all
              pointed at "#". Hidden until those pages and accounts exist —
              pre-launch rule: no dead links. */}
        </div>
        <div className="lp-footer__bottom">
          <p className="lp-footer__disclaimer">{footer.disclaimer(brand.name)}</p>
          {/* TODO(Giorgio): the live page showed a visible
              "[MARKET DATA ATTRIBUTION PLACEHOLDER]" here. Not rendered;
              restore with the real data-provider attribution once chosen. */}
          <p className="lp-footer__copy">
            <span suppressHydrationWarning>{footer.copy(brand.name, new Date().getFullYear())}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  useEffect(() => {
    ensureArchivoStylesheet();
  }, []);

  // MotionRoot (MotionConfig reducedMotion="user") makes motion's own
  // components — layout re-sorts, chyrons, the tug bars — honour the OS
  // reduced-motion setting too; useMotion() reads it directly.
  return (
    <MotionRoot>
      <div className="lp">
        <a className="lp-skip" href="#main">
          Skip to content
        </a>
        <Tape />
        <Nav />
        <main id="main" tabIndex={-1}>
          <Opening />
          <HowItWorks />
          <Leagues />
          <Why />
          <Faq />
          <Cta />
        </main>
        <Footer />
      </div>
    </MotionRoot>
  );
}
