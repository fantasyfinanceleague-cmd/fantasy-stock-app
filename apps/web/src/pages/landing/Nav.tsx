import { useEffect, useState } from 'react';
import { brand } from '../../brand';
import { BrandMark } from '../../design/BrandMark';
import { linkLabel, nav } from './copy';

/** The chapters the nav tracks for its active link, in page order. */
const CHAPTERS = ['how', 'leagues', 'why', 'faq'] as const;

export function LaunchingSoon({ label, tone = 'onLight' }: { label: string; tone?: 'onLight' | 'onGame' }) {
  // A status, not a control: a span with no border, hover, pointer or press.
  return (
    <span className={`lp-status lp-status--${tone}`}>
      <span className="lp-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Sticky nav: brand, the page's three anchor links (the active one marked
 * with aria-current) and the launching-soon status. (The round-3 chapter
 * progress bar is gone — Giorgio, round 4.) One rAF-throttled scroll
 * listener; React only re-renders when the active chapter changes. */
export function Nav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = CHAPTERS.map((id) => document.getElementById(id));
    let raf = 0;
    let lastActive: string | null = null;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.4;
      let current: string | null = null;
      sections.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) current = CHAPTERS[i];
      });
      if (current !== lastActive) {
        lastActive = current;
        setActive(current);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const isActive = (href: string) => active === href.slice(1);

  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav__inner">
        <a className="lp-brand" href="#top">
          <BrandMark size={24} className="lp-brand__mark" />
          <span className="lp-brand__name">{brand.name}</span>
        </a>
        <nav aria-label="Sections" className="lp-nav__links">
          {nav.links.map((l) => (
            <a key={l.href} href={l.href} aria-current={isActive(l.href) ? 'location' : undefined}>
              {linkLabel(l.label, brand.name)}
            </a>
          ))}
        </nav>
        <LaunchingSoon label={nav.status} />
      </div>
    </header>
  );
}

export default Nav;
