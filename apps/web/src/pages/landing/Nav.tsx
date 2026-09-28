import { useEffect, useRef, useState } from 'react';
import { brand } from '../../brand';
import { BrandMark } from '../../design/BrandMark';
import { linkLabel, nav } from './copy';

/** The chapters the progress indicator tracks, in page order (the page's
 * own "/ 01"–"/ 04" numbering). */
const CHAPTERS = [
  { id: 'how', num: '01' },
  { id: 'leagues', num: '02' },
  { id: 'why', num: '03' },
  { id: 'faq', num: '04' },
] as const;

export function LaunchingSoon({ label, tone = 'onLight' }: { label: string; tone?: 'onLight' | 'onGame' }) {
  // A status, not a control: a span with no border, hover, pointer or press.
  return (
    <span className={`lp-status lp-status--${tone}`}>
      <span className="lp-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Sticky nav: brand, the page's three anchor links, the launching-soon
 * status, and a four-segment chapter progress bar that fills as you scroll
 * through /01–/04 (and marks the active link). The bar is decorative
 * (aria-hidden); the active link carries aria-current for AT. Progress is
 * written straight to the segments' transforms from one rAF-throttled
 * scroll listener, so scrolling never re-renders React. */
export function Nav() {
  const segRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = CHAPTERS.map((c) => document.getElementById(c.id));
    let raf = 0;
    let lastActive: string | null = null;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.4;
      let current: string | null = null;
      sections.forEach((el, i) => {
        const seg = segRefs.current[i];
        if (!el || !seg) return;
        const r = el.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (line - r.top) / Math.max(1, r.height)));
        seg.style.transform = `scaleX(${p.toFixed(4)})`;
        if (r.top <= line && r.bottom > line) current = CHAPTERS[i].id;
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
      <div className="lp-progress" aria-hidden="true">
        <div className="lp-wrap lp-progress__inner">
          {CHAPTERS.map((c, i) => (
            <span key={c.id} className={active === c.id ? 'lp-progress__seg lp-progress__seg--on' : 'lp-progress__seg'}>
              <span className="lp-progress__num">/{c.num}</span>
              <span className="lp-progress__track">
                <span
                  className="lp-progress__fill"
                  ref={(el) => {
                    segRefs.current[i] = el;
                  }}
                />
              </span>
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

export default Nav;
