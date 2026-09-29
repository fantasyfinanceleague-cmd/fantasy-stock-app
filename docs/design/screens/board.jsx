// The review board around the key screens: one section per screen, each
// with the live component, what it shows, its motion moments (playable),
// and the questions only Giorgio can answer. Then the ledger, computed
// from data.js, proving the numbers tie out.

(function () {
  const { useState, useEffect, useLayoutEffect, useRef } = React;
  const K = window.KS;
  const S = window.KSScreens;
  const $ = (v, o) => K.formatMoney(v, o);
  const $s = (v) => K.formatMoney(v, { sign: 'always' });
  const pct = (v) => K.formatPct(v, { sign: 'always' });

  /** Scales a 402×874 device to its column (never above 1:1). */
  function Fit({ children, caption }) {
    const ref = useRef(null);
    const [k, setK] = useState(1);
    useLayoutEffect(() => {
      const el = ref.current;
      const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / 402)));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    return (
      <figure className="b-fig">
        <div className="b-fit" ref={ref} style={{ height: 874 * k }}>
          <div className="b-fit__in" style={{ transform: `scale(${k})` }}>{children}</div>
        </div>
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  }

  function Play({ label, onPlay, playing }) {
    return (
      <button type="button" className="b-play" onClick={onPlay} aria-pressed={playing}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor" /></svg>
        {label}
      </button>
    );
  }

  function Section({ id, n, name, job, phones, notes }) {
    return (
      <section className="b-sec" id={id} aria-labelledby={`${id}-h`}>
        <header className="b-sec__head">
          <span className="b-sec__n">{n}</span>
          <div>
            <h2 id={`${id}-h`}>{name}</h2>
            <p className="b-job">{job}</p>
          </div>
        </header>
        <div className={phones.length > 1 ? 'b-sec__grid b-sec__grid--two' : 'b-sec__grid'}>
          <div className="b-phones">{phones}</div>
          <div className="b-notes">{notes}</div>
        </div>
      </section>
    );
  }

  function Notes({ shows, motion, reduced, ask }) {
    return (
      <>
        <h3>On screen</h3>
        <ul>{shows.map((s, i) => <li key={i}>{s}</li>)}</ul>
        <h3>Motion</h3>
        <ul className="b-motion">{motion}</ul>
        <p className="b-reduced"><b>Reduce Motion:</b> {reduced}</p>
        {ask ? (
          <div className="b-ask">
            <h3>Your call</h3>
            <ul>{ask.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        ) : null}
      </>
    );
  }

  // One replayable moment: toggles a boolean for `ms`, then settles.
  function useMoment(initial) {
    const [v, setV] = useState(initial);
    const [n, setN] = useState(0);
    return [v, n, (next) => { setV(next); setN((x) => x + 1); }];
  }

  function Board() {
    const [homeRun, homeN, setHome] = useMoment(false);
    const [final, finalN, setFinal] = useMoment(false);
    const [after, afterN, setAfter] = useMoment(true);
    const [landed, landedN, setLanded] = useMoment(false);
    const [sheet, sheetN, setSheet] = useMoment(false);
    const L = K.MATCHUP.live, F = K.MATCHUP.final;

    return (
      <main className="b-page">
        <header className="b-hero">
          <div className="b-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1" fill="#5B6678" /><rect x="9.75" y="9" width="4.5" height="12" rx="1" fill="#5B6678" /><rect x="16.5" y="4" width="4.5" height="17" rx="1" fill="#2860F0" /></svg>
            <span>Stockpile</span>
            <span className="b-brand__meta">Key screens · v1 · 29 Sep 2026</span>
          </div>
          <h1>The app, as it will ship.</h1>
          <p className="b-lead">
            Five key screens, built as real components on the Game Day tokens. They are the
            source of truth for the mobile app and for the landing page's phone, so the landing
            can only show what the app will actually look like. Every screen tells one story:
            the same league, the same week, and numbers that add up.
          </p>
          <dl className="b-canon">
            <div><dt>League</dt><dd>{K.LEAGUE.name} · 6 managers</dd></div>
            <div><dt>Moment</dt><dd>Week 6 of 14 · Thu 1:37 PM ET</dd></div>
            <div><dt>You</dt><dd>Roberto B. vs Gianluigi B.</dd></div>
            <div><dt>Stakes</dt><dd>$2,000 per slot · 6 slots</dd></div>
          </dl>
          <nav className="b-toc" aria-label="Screens">
            {[['home', 'Home'], ['matchup', 'Matchup'], ['league', 'League'], ['draft', 'Draft room'], ['portfolio', 'Portfolio'], ['ledger', 'Ledger']].map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
          </nav>
        </header>

        <Section
          id="home" n="1" name="Home" job="Where am I across all my leagues, and how is this week going?"
          phones={<Fit key={homeN}><S.HomeScreen run={homeRun} /></Fit>}
          notes={<Notes
            shows={[
              <>Total value across live leagues ({$(K.HOME.totalValue)}) with the past month's gain ({$s(K.HOME.windowGain)}).</>,
              <>The chart plots <b>cumulative gain</b> against a zero baseline, not value. Joining Friday Night Stocks is a small marker on the axis, never a jump in the line.</>,
              <>"This week": one live scoreboard card per league, each with the tug bar and the lead in dollars.</>,
              <>Your leagues grouped by phase, with rank and record. The avatar opens Profile.</>,
            ]}
            motion={<>
              <li><Play label="Open Home" playing={homeRun} onPlay={() => setHome(true)} /> The gain line draws on (feature, 700ms); the week cards rise in (slow, 380ms).</li>
              <li>Live cards tick: digits roll only where they changed (base, 240ms); the tug bar eases to its new split.</li>
            </>}
            reduced="the line and cards appear in place; digits swap without rolling."
            ask={['Total value across every live league, or only the active one?', 'One "This week" card per live league, stacked: fine at 2 leagues. At 4+, swipeable instead?']}
          />}
        />

        <Section
          id="matchup" n="2" name="Matchup" job="Am I winning this week, by how much, and why?"
          phones={<>
            <Fit caption={final ? 'Final (played from Live)' : 'Live · Thu 1:37 PM ET'}><S.MatchupScreen final={final} /></Fit>
            <Fit caption="Final · Fri close"><S.MatchupScreen final /></Fit>
          </>}
          notes={<Notes
            shows={[
              <>A broadcast scoreboard: both managers, both scores in the condensed 62% cut, and the tug bar. Live: {$s(L.you.gain)} vs {$s(L.opp.gain)}.</>,
              <>The lead is in dollars ({$(L.you.gain - L.opp.gain)}); the percent tiebreak sits beside it, small ({pct(L.you.pct)} vs {pct(L.opp.pct)}).</>,
              <>A chyron names what just moved the game. The race chart replaces the Mon–Fri bars and is the same chart as the landing's /03.</>,
              <>Both lineups, each stock's dollar contribution this week. They add up to the score exactly.</>,
              <>Final: the winner banner, the new record, and next week's opponent.</>,
            ]}
            motion={<>
              <li><Play label={final ? 'Back to Live' : 'Final whistle'} playing={final} onPlay={() => setFinal(!final)} /> Scores roll to the close, the chip flips Live → Final, the tug settles, and the winner banner rises (slow, 380ms).</li>
              <li>Lead change (live): the chyron slides in (base), the tug crosses centre with the lively spring, one light haptic.</li>
            </>}
            reduced="scores swap, the tug jumps to its split, the banner and chyron fade in place."
            ask={['Lineups show each stock\'s dollar contribution this week. Would you rather see percent per stock?']}
          />}
        />

        <Section
          id="league" n="3" name="League standings" job="Where do I stand, and what changed this week?"
          phones={<Fit><S.LeagueScreen after={after} /></Fit>}
          notes={<Notes
            shows={[
              <>Ranked the way the app ranks: win percentage, then wins, then <b>season gain in dollars</b>. Paolo M. and Roberto B. are both 5–1; Roberto's {$s(K.STANDINGS_FINAL[0].pf)} beats Paolo's {$s(K.STANDINGS_FINAL[1].pf)}.</>,
              <>▲/▼ show the move since last week. You are highlighted wherever you land.</>,
              <>Week 6 results underneath: every matchup, both scores.</>,
            ]}
            motion={<>
              <li><Play label="Replay Friday's re-sort" playing={false} onPlay={() => { setAfter(false); setTimeout(() => setAfter(true), 700); }} /> Rows slide to their new ranks (FLIP, slow 380ms, settle), then the ▲/▼ badges pop.</li>
            </>}
            reduced="rows jump to their new order; the badges appear without scaling."
            ask={['Column name: "Season gain" (plain) or "Points for" (fantasy)?']}
          />}
        />

        <Section
          id="draft" n="4" name="Draft room" job="Whose pick is it, what's left, and how does the snake run?"
          phones={<Fit caption={landed ? 'After the pick' : 'On the clock · Round 2, pick 11'}><S.DraftScreen landed={landed} /></Fit>}
          notes={<Notes
            shows={[
              <>The on-the-clock ring counts down; the card says what the snake means for you right now ("Then Paolo M. picks twice").</>,
              <>The snake board: a track runs through every pick in order, with chevrons in the gaps and a half-loop at every row end, so the reversal reads without the labels. Your picks are outlined in team blue.</>,
              <>Search with your queue; Draft is one tap. Your roster fills slot by slot at $2,000 each.</>,
            ]}
            motion={<>
              <li><Play label={landed ? 'Reset' : 'Make the pick'} playing={landed} onPlay={() => setLanded(!landed)} /> AAPL lands in pick 11, the blue track extends to 12, the ring hands over to Paolo M., and the roster slot fills.</li>
              <li>The clock ring pulses its outline at 1.2s; the last 10 seconds turn the ring to loss red.</li>
            </>}
            reduced="the ticker appears in place; the track extends without drawing; no pulse."
            ask={['Pick clock: 60 seconds assumed. Is that the league default?']}
          />}
        />

        <Section
          id="portfolio" n="5" name="Portfolio and stock sheet" job="What do I own, how is it doing, and how do I act on one stock?"
          phones={<>
            <Fit caption={sheet ? 'NVDA tapped' : 'Portfolio · live'}><S.PortfolioScreen sheet={sheet} /></Fit>
            <Fit caption="Stock sheet · Sell pre-selected"><S.PortfolioScreen sheet /></Fit>
          </>}
          notes={<Notes
            shows={[
              <>Value {$(K.PORTFOLIO_LIVE.value)}; gain since the draft {$s(K.PORTFOLIO_LIVE.gain)} against a $12,000.00 basis; today {$s(K.PORTFOLIO_LIVE.today)}.</>,
              <>Six holdings, each with value and today's move. Trade history includes the draft picks.</>,
              <>Any ticker row opens the stock sheet: price and today's chart against the previous close, your position, who in the league owns it, and <b>Sell pre-selected</b> because you hold it.</>,
            ]}
            motion={<>
              <li><Play label={sheet ? 'Close sheet' : 'Tap NVDA'} playing={sheet} onPlay={() => setSheet(!sheet)} /> The sheet springs up (spring.snappy, no overshoot) while the scrim fades in (base).</li>
            </>}
            reduced="the sheet fades in place."
            ask={['Can managers buy and sell mid-season in a $2,000-per-slot league, or only swap? The sheet follows the IA (Buy / Sell) until you decide.']}
          />}
        />

        <Ledger />
      </main>
    );
  }

  function Ledger() {
    const L = K.MATCHUP.live, F = K.MATCHUP.final, P = K.PORTFOLIO_LIVE, H = K.HOME;
    const fns = K.OTHER_LEAGUES[0];
    const rowsSum = (rows) => rows.map((r) => $s(r.weekGain)).join(' ');
    const wins = K.STANDINGS_FINAL.reduce((a, r) => a + r.w, 0);
    const losses = K.STANDINGS_FINAL.reduce((a, r) => a + r.l, 0);
    const lines = [
      ['Matchup, live', `Roberto B.: ${rowsSum(L.you.rows)} = ${$s(L.you.gain)}`, `Gianluigi B.: ${rowsSum(L.opp.rows)} = ${$s(L.opp.gain)}`, `Lead ${$(L.you.gain - L.opp.gain)}`],
      ['Matchup, final', `Roberto B. = ${$s(F.you.gain)} (${pct(F.you.pct)} of ${$(F.you.startValue)})`, `Gianluigi B. = ${$s(F.opp.gain)} (${pct(F.opp.pct)} of ${$(F.opp.startValue)})`, `Margin ${$(F.you.gain - F.opp.gain)}`],
      ['Portfolio', `Σ 6 holdings = ${$(P.value)}`, `Basis 6 × $2,000.00 = ${$(P.cost)}`, `Gain ${$s(P.gain)} (${pct(P.gainPct)})`],
      ['Home', `${$(P.value)} + ${$(fns.value)} = ${$(H.totalValue)}`, `All-time gain ${$s(H.allTimeGain)}`, `Past month = last point − first = ${$s(H.windowGain)}`],
      ['Standings', `After Week 6: ${wins} wins = ${losses} losses`, 'Ranked: win %, then wins, then season gain', `Roberto B. ${$s(K.STANDINGS_FINAL[0].pf)} > Paolo M. ${$s(K.STANDINGS_FINAL[1].pf)}`],
      ['Draft', 'Seat on the clock at pick n: odd rounds 1→6, even rounds 6→1', 'Roberto B. (seat 2): picks 2, 11, 14, 23, 26, 35', 'Gianluigi B. (seat 5): picks 5, 8, 17, 20, 29, 32'],
    ];
    return (
      <section className="b-sec b-ledger" id="ledger" aria-labelledby="ledger-h">
        <header className="b-sec__head">
          <span className="b-sec__n">$</span>
          <div>
            <h2 id="ledger-h">The ledger</h2>
            <p className="b-job">Computed live from the same data the screens use, so it cannot drift from them.</p>
          </div>
        </header>
        <div className="b-table-wrap">
          <table className="b-table">
            <tbody>
              {lines.map(([k, ...v]) => (
                <tr key={k}><th scope="row">{k}</th>{v.map((x, i) => <td key={i}>{x}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Changes from the landing's current sample data</h3>
        <ol className="b-changes">
          <li>Records: the landing's 5–0, 4–1, 4–1, 3–2, 2–3, 1–4 add up to 19 wins against 11 losses, which no league can produce. Now 5–0, 4–1, 3–2, 2–3, 1–4, 0–5 after Week 5.</li>
          <li>Standings rank by record, then season gain in dollars (as the app does), not by season percent.</li>
          <li>Pick 12 was TSLA for Paolo M., but TSLA is in Roberto B.'s lineup. Paolo M. now takes LLY; Roberto B. took TSLA in round 4.</li>
          <li>The hero phone's matchup (+$322.45 vs −$71.20, "3d 4h left") contradicted the week's daily closes. The live moment is now Thu 1:37 PM: {$s(L.you.gain)} vs {$s(L.opp.gain)}.</li>
          <li>Thursday's close for Gianluigi B. is +$71.35 (was −$12.55), so the live game is close enough for the tug bar to move. Friday is derived from the holdings: {$s(F.you.gain)} vs {$s(F.opp.gain)} (was +$351.80 vs −$40.25).</li>
          <li>Lineups are six stocks (the landing showed four); the portfolio is {$(P.value)} across six holdings.</li>
        </ol>
      </section>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<Board />);
})();
