import { useEffect, useRef } from 'react';
import { brand } from '../../brand';
import { BrandMark } from '../../design/BrandMark';
import { MotionRoot } from '../../design/MotionRoot';
import { cta, footer, linkLabel } from './copy';
import { ensureArchivoStylesheet } from './head';
import { useEnhanced, useLandingMotion, usePointerGlow } from './hooks';
import { LaunchingSoon, Nav } from './Nav';
import { Tape } from './Tape';
import { Opening } from './Opening';
import { HowItWorks } from './HowItWorks';
import { Leagues } from './Leagues';
import { Why } from './Why';
import { Faq } from './Faq';
import { Layer, Reveal } from './scroll';
import { FullSlot } from './FullSlot';
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

/** Where the page should scroll to put `target` just under the sticky nav
 * (its scroll-margin-top). */
function anchorTop(target: Element): number {
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  return Math.max(0, Math.round(target.getBoundingClientRect().top + window.scrollY - margin));
}

function Cta() {
  const glowRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const enhanced = useEnhanced();
  usePointerGlow(glowRef, enhanced);
  return (
    <Layer tone="dark" last className="lp-cta" labelledBy="lp-cta-title">
      <div ref={glowRef} className="lp-cta__glow-area">
        <span className="lp-glow" aria-hidden="true" />
        {/* FULL: the market's particles assemble into the mark in its slot. */}
        <FullSlot name="cta" slot={markRef} />
        <div className="lp-wrap lp-cta__inner">
          <div>
            <h2 className="lp-cta__title" id="lp-cta-title">
              {cta.title.text}
              <em>{cta.title.em}</em>
            </h2>
            <p className="lp-cta__body">{cta.body(brand.name)}</p>
            <div className="lp-cta__status">
              <LaunchingSoon label={cta.status} tone="onGame" />
            </div>
          </div>
          {/* The mark, big: the page's sign-off in every tier (decorative —
              the nav and footer carry the named mark). */}
          <div ref={markRef} className="lp-cta__mark" aria-hidden="true">
            <Reveal className="lp-cta__mark-dom">
              <BrandMark size={24} tone="onGame" accent="var(--sp-color-team-you-on-game)" />
            </Reveal>
          </div>
        </div>
      </div>
    </Layer>
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

  // In-page anchors (nav, "See how it works", footer, skip link): smooth
  // scroll in JS — instant under reduced motion — then move focus to the
  // target so keyboard and screen-reader users land there too. Plain
  // anchors without JS, as before.
  const { hydrated, reduced } = useLandingMotion();
  useEffect(() => {
    if (!hydrated) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const id = link?.getAttribute('href')?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target || !link?.closest('.lp')) return;
      e.preventDefault();
      window.scrollTo({ top: anchorTop(target), behavior: reduced ? 'auto' : 'smooth' });
      window.history.pushState(null, '', `#${id}`);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [hydrated, reduced]);

  // A deep link (/#leagues, /#faq…) jumps using the prerendered, static
  // layout; the pinned chapters that switch in after hydration (over a few
  // commits, as media queries resolve) change the page height above the
  // target and push it out of place. So after the switch, keep the target
  // aligned whenever the page resizes, until layout settles (1.5s) or the
  // reader scrolls. (Found in iOS Safari, round 3.)
  const enhanced = useEnhanced();
  useEffect(() => {
    if (!enhanced || typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    let done = false;
    const align = () => {
      if (!done) window.scrollTo(0, anchorTop(target));
    };
    const ro = new ResizeObserver(align);
    let timer = 0;
    const stop = () => {
      done = true;
      ro.disconnect();
      window.clearTimeout(timer);
      for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(ev, stop);
    };
    timer = window.setTimeout(stop, 1500);
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const)
      window.addEventListener(ev, stop, { passive: true });
    ro.observe(document.body);
    align();
    return stop;
  }, [enhanced]);

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
