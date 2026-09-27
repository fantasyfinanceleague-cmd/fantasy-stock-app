import { useEffect, useState } from 'react';
import { Surface } from '../../design/Surface';
import { Money } from '../../design/Money';
import { useLandingMotion, usePageVisible } from './hooks';
import { TICKER, type Team } from './sampleData';

function TickerItem({ a, b }: { a: Team; b: Team }) {
  const aLeads = a.gain > b.gain;
  const bLeads = b.gain > a.gain;
  return (
    <li className="lp-tk">
      <span className={aLeads ? 'lp-tk__name lp-tk__name--lead' : 'lp-tk__name'}>{a.name}</span>
      <Money value={a.gain} sign="always" size="callout" className="lp-tk__gain" />
      <span className="lp-tk__vs">vs</span>
      <span className={bLeads ? 'lp-tk__name lp-tk__name--lead' : 'lp-tk__name'}>{b.name}</span>
      <Money value={b.gain} sign="always" size="callout" className="lp-tk__gain" />
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

/** The scrolling strip of sample matchups under the hero band. A linear CSS
 * loop (landing.css) that pauses on hover, on keyboard focus inside it, on
 * the control, and whenever the tab is hidden. Reduced motion: paused from
 * the start and scrollable by hand; the control stays for everyone
 * (WCAG 2.2.2), so anyone can still start it. */
export function Ticker() {
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
          aria-label={userPaused ? 'Play the matchup ticker' : 'Pause the matchup ticker'}
          onClick={() => setUserPaused((p) => !p)}
        >
          {userPaused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <div className="lp-ticker__viewport" tabIndex={0} role="region" aria-label="Sample matchups from other leagues">
          <div className="lp-ticker__track" data-state={state}>
            <ul className="lp-ticker__list">
              {TICKER.map(([a, b]) => (
                <TickerItem key={a.name} a={a} b={b} />
              ))}
            </ul>
            {/* Second copy for the seamless loop; hidden from AT. */}
            <ul className="lp-ticker__list" aria-hidden="true">
              {TICKER.map(([a, b]) => (
                <TickerItem key={a.name} a={a} b={b} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Surface>
  );
}

export default Ticker;
