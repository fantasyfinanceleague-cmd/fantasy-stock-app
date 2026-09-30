import { useEffect, useState } from 'react';
import { Surface } from '../../design/Surface';
import { useLandingMotion, usePageVisible } from './hooks';
import { TAPE } from './sampleData';

function TapeItem({ item }: { item: (typeof TAPE)[number] }) {
  return (
    <li className="lp-tk">
      <span className="lp-tk__dot" aria-hidden="true" />
      <span className="lp-tk__sym">{item.t}</span>
      <span className="lp-tk__px">${item.p}</span>
      <span className={item.up ? 'lp-tk__d lp-tk__d--up' : 'lp-tk__d lp-tk__d--down'}>{item.d}</span>
    </li>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.2-4.8a.6.6 0 0 0 0-1l-7.2-4.8A.6.6 0 0 0 5 3.2Z" fill="currentColor" />
    </svg>
  );
}

/** The price tape across the top of the page (the live page's ticker tape,
 * same symbols and prices). A linear CSS loop that pauses on hover, on
 * keyboard focus inside it, on the control, and whenever the tab is hidden.
 * Reduced motion: paused from the start and scrollable by hand; the
 * control stays for everyone (WCAG 2.2.2). */
export function Tape() {
  const { hydrated, reduced } = useLandingMotion();
  const pageVisible = usePageVisible();
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    if (hydrated && reduced) setUserPaused(true);
  }, [hydrated, reduced]);

  // 'auto' until hydrated: CSS alone decides (running, or paused under
  // prefers-reduced-motion) — see .lp-ticker__track in landing.css.
  const state = !hydrated ? 'auto' : userPaused || !pageVisible ? 'paused' : 'playing';

  return (
    <Surface kind="game" className="lp-ticker">
      <div className="lp-ticker__inner">
        <button
          type="button"
          className="lp-ticker__toggle lp-press"
          aria-label={userPaused ? 'Play the price ticker' : 'Pause the price ticker'}
          onClick={() => setUserPaused((p) => !p)}
        >
          {userPaused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <div className="lp-ticker__viewport" tabIndex={0} role="region" aria-label="Sample stock prices">
          <div className="lp-ticker__track" data-state={state}>
            <ul className="lp-ticker__list">
              {TAPE.map((item) => (
                <TapeItem key={item.t} item={item} />
              ))}
            </ul>
            {/* Second copy for the seamless loop; hidden from AT. */}
            <ul className="lp-ticker__list" aria-hidden="true">
              {TAPE.map((item) => (
                <TapeItem key={item.t} item={item} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Surface>
  );
}

export default Tape;
