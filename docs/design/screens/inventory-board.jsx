// Board part 2: every screen, grouped by the phase that builds it.

(function () {
  const { useState, useLayoutEffect, useRef } = React;
  const I = window.KSInventory;

  /** Scales a fixed-size frame (phone 402×874, web 1280×800) to its column. */
  function Fit({ w = 402, h = 874, radius = 56, caption, note, children }) {
    const ref = useRef(null);
    const [k, setK] = useState(0.7);
    useLayoutEffect(() => {
      const el = ref.current;
      const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / w)));
      ro.observe(el);
      return () => ro.disconnect();
    }, [w]);
    return (
      <figure className="b-fig b-fig--inv" style={w > 402 ? { maxWidth: 'none' } : undefined}>
        <div className="b-fit" ref={ref} style={{ height: h * k, maxWidth: w > 402 ? 'none' : 402 }}>
          <div className="b-fit__in" style={{ transform: `scale(${k})`, width: w, borderRadius: radius, boxShadow: w > 402 ? '0 30px 60px -30px rgba(13,27,46,.35)' : undefined }}>{children}</div>
        </div>
        {caption ? <figcaption><b>{caption}</b>{note ? <span>{note}</span> : null}</figcaption> : null}
      </figure>
    );
  }

  function Group({ id, code, name, job, children, notes }) {
    return (
      <section className="b-sec b-inv" id={id} aria-labelledby={`${id}-h`}>
        <header className="b-sec__head">
          <span className="b-sec__n b-sec__n--code">{code}</span>
          <div>
            <h2 id={`${id}-h`}>{name}</h2>
            <p className="b-job">{job}</p>
          </div>
        </header>
        {notes ? <ul className="b-inv__notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
        <div className="b-inv__grid">{children}</div>
      </section>
    );
  }

  function Inventory() {
    const [card, setCard] = useState(0);
    return (
      <>
        <header className="b-part" id="inventory">
          <span className="b-part__eyebrow">Part 2</span>
          <h2>Every screen</h2>
          <p>The rest of the app, built from the same pieces, the same league and the same rules as the five key screens. Grouped by the build phase that owns it. Existing app wording is kept word for word (only the casing is made consistent); lines marked <i>new copy</i> are proposals for you to edit.</p>
        </header>

        <Group id="shell" code="3b-1" name="Sign in and first run" job="From the App Store to your first league, and the account basics."
          notes={[
            'One input style everywhere: label above, 50pt field, brand-blue focus ring, the error in words under the field (it appears instantly). The password checklist shows the server\'s real five rules, with the app\'s existing labels, checking off live as you type.',
            'Usernames: the rules are 3–20 characters, letters, numbers and underscores (the server\'s own rule). "Taken" is case-insensitive, and a name that fails the content check shows exactly "Username is not allowed". Suggestions keep the case you typed ("Roberto" → "Roberto26").',
            'Sign up keeps its button above the keyboard, so it is never covered.',
            <>Onboarding is three cards on the game surface, skippable, shown once. The copy is the approved generic scoring line. <button type="button" className="b-play b-play--sm" onClick={() => setCard((c) => (c + 1) % 3)}>Next card</button></>,
            'Pick a username appears before the tabs whenever an account has none. It cannot be skipped, but sign-out is always there. Taken names get three available suggestions.',
            'The league pill opens the league sheet: every league grouped by phase, Create and Join always at the bottom. Choosing a league switches the whole app to it.',
          ]}>
          <Fit caption="Sign in"><I.SignIn /></Fit>
          <Fit caption="Create account" note="Keyboard up; the button stays visible"><I.SignUp /></Fit>
          <Fit caption="Create account · sign-ups paused" note="Your final text, verbatim; product name via brand.name"><I.SignUpPaused /></Fit>
          <Fit caption="Forgot password"><I.Forgot /></Fit>
          <Fit caption="Check your email" note="New copy: the explanation line"><I.Forgot sent /></Fit>
          <Fit caption={`Onboarding · card ${card + 1} of 3`} note="Slide + fade (slow); dots stretch (quick)"><I.Onboarding card={card} /></Fit>
          <Fit caption="Get started" note="New copy: the two descriptions"><I.GetStarted /></Fit>
          <Fit caption="Pick a username" note="Taken, with suggestions"><I.PickUsername /></Fit>
          <Fit caption="League sheet" note="Opened from the pill on any tab"><I.LeagueSheet /></Fit>
          <Fit caption="Profile" note="From the avatar on Home"><I.Profile /></Fit>
          <Fit caption="Appearance" note="Profile › Appearance · System / Light / Dark"><I.Appearance /></Fit>
          <Fit caption="Change password" note="Its own screen"><I.ChangePassword /></Fit>
          <Fit caption="Home with no leagues"><I.EmptyHome /></Fit>
        </Group>

        <Group id="phases" code="3b-2" name="Home through the season" job="The same Home, one league, in every phase of that league's life."
          notes={[
            'Every phase has one treatment: a phase chip and a hero card that says what happens next and when. No screen guesses the phase on its own.',
            'Before the season there is no leader and no gain: zero is grey, never green.',
            'Nights and weekends freeze the scoreboard at the last close and say when it resumes.',
            'After Friday\'s close the card shows "Scoring…" until the results post; nothing is presented as final before it is.',
            'A symbol with no live price counts at cost and is named in a caption ("1 holding counted at cost (no live price yet)"), on the hero and on whichever side of the scoreboard it affects. A partial total never passes as a complete one.',
          ]}>
          <Fit caption="Before the draft" note="Serie A Traders"><I.HomePreDraft /></Fit>
          <Fit caption="Before the draft · waiting for managers" note="3 of 4 joined, so the order isn't set yet (new copy)"><I.HomePreDraft waiting /></Fit>
          <Fit caption="Draft in progress"><I.HomeDrafting /></Fit>
          <Fit caption="Before the season"><I.HomePreSeason /></Fit>
          <Fit caption="Market closed" note="Thursday night"><I.HomeClosed /></Fit>
          <Fit caption="A holding without a live price" note='Counted at cost (zero gain, never $0 of value), and the screen says so in the approved caption. "{name}: " is new copy. Appears instantly.'><I.HomeUnpriced /></Fit>
          <Fit caption="Week final, scoring" note="Friday after 4 PM"><I.HomeScoring /></Fit>
          <Fit caption="Season complete" note="New copy throughout. Every tile comes from the season result (ask #11): season gain, best week, regular-season rank and record, playoff result"><I.HomeComplete /></Fit>
        </Group>

        <Group id="game" code="3c" name="Matchups, draft and playoffs" job="The game surfaces around the key Matchup, Standings and Draft room screens."
          notes={[
            'All matchups this week: every game in the league, yours marked, same scoreboard grammar at a smaller size.',
            'The draft lobby opens before the draft: countdown, who is in the room, and your queue. If your clock runs out, the server auto-picks from your queue, then the best available (the largest market cap that fits the league\'s rules; it never breaks them).',
            'An auto-pick is never hidden: a banner names who ran out of time and what was picked, the board cell gets an Auto badge, and the pick log says "Auto-picked · from their queue" or "Auto-picked · best available" (new copy). The rule is fixed, not a league setting: queue first, then best available, never random, never a skip.',
            'The draft recap lives under League › History after the draft: your picks ranked by how they have done since.',
            'Draft order is a league setting with two modes, and BOTH become final 1 hour before the draft: Random is drawn then; Manual can be arranged any time until then (if the commissioner never saves, the random starting order is used, never commissioner-first). The mode can be switched until then too. Anyone who joins after that picks last. (New copy.)',
            'The order is set at the LATER of 1 hour before the draft and the league reaching 4 managers (the minimum to draft). Until then Home and the lobby show "Draft order · waiting" with a 3-of-4 progress bar; Start draft stays disabled below 4 managers and offers the invite code. While a Manual order is unsaved, anyone who joins lands in a random slot (so the start stays fair); once it\'s saved or final, joiners go last. (New copy.)',
            'When the order is set, everyone gets a push ("Serie A Traders: The draft order is set. You pick 4th. The draft starts at 7:00 PM ET." / "The commissioner set the draft order…") and an in-app card, "Draft order set · 6:00 PM ET · You pick 4th, then 13th, 20th…", in the lobby and on the pre-draft Home. (New copy.)',
            'Leaving is fine: "If you step away, we\'ll auto-pick from your queue when your time runs out. You can come back any time." There is no "don\'t leave" warning anywhere.',
            'Uneven byes get a short heads-up, never an explanation of how byes work, and never a block: on the weeks control in Create league / League settings (based on the expected size, and it says so), and on the commissioner\'s Start draft confirm (the count is final there). It only appears for an odd number of managers when the weeks don\'t divide evenly; with an even count there are no byes. Backend: byes per manager = floor or ceil(weeks / managers) when managers is odd.',
            <>A bye is no result: in the Season strip on Home it shows as a neutral <span className="ks-chip ks-chip--money" style={{ textTransform: 'none', letterSpacing: 0, fontStretch: '100%' }}>Bye</span> chip, never W or L, and it doesn't count toward win percentage. (Stock Scudetto has 6 managers, so it has no byes.)</>,
            <>Playoffs are auto-configured from the number of teams the commissioner picks (any number from 2 up to the managers): weeks = ceil(log2 teams), first-round byes = the next power of two minus teams, given to the top seeds, fixed bracket with no re-seeding. For example, {window.KS.playoffLine(4)}; {window.KS.playoffLine(6)}; {window.KS.playoffLine(10)}; and 2 teams play just the final. Before the draft the cap is the expected size. Start draft re-checks it against who's actually in: if there are more playoff teams than managers, the draft can't start until the commissioner lowers them, right on the confirm sheet. (New copy.)</>,
            <>Round names (your call, decided): counting back from the final, <b>Final</b>, <b>Semifinals</b>, <b>Quarterfinals</b>, <b>Round of 16</b>; any first round with byes is called <b>Wild card</b>. Leagues have at most 16 managers, so: 2 teams "Final"; 3 "Wild card · Final"; 4 "Semifinals · Final"; 5–7 "Wild card · Semifinals · Final"; 8 "Quarterfinals · Semifinals · Final"; 9–15 "Wild card · Quarterfinals · Semifinals · Final"; 16 "Round of 16 · Quarterfinals · Semifinals · Final".</>,
            'Seeds follow the standings: win percentage (byes excluded), then head-to-head, then season gain. In the 4-team bracket 1 plays 4 and 2 plays 3; a tied game goes to the higher seed. The explanatory line under the bracket is new copy.',
          ]}>
          <Fit caption="All matchups"><I.AllMatchups /></Fit>
          <Fit caption="Matchup before the season"><I.MatchupPreSeason /></Fit>
          <Fit caption="Draft lobby · order revealed" note="After 6:00 PM ET: the full order, your slot, and the snake picks that follow (new copy)"><I.DraftLobby /></Fit>
          <Fit caption="Draft lobby · still waiting" note="Past 6:00 PM ET but only 3 of 4 managers: set as soon as one more joins (new copy)"><I.DraftLobby waiting /></Fit>
          <Fit caption="Start the draft · not enough managers" note="Needs 4; invite one more (new copy)"><I.StartDraftConfirm managers={3} /></Fit>
          <Fit caption="Arrange order (commissioner, Manual)" note="Drag to reorder; starts from a random order, never commissioner-first; set by 1 hour before the draft (new copy)"><I.ArrangeOrder /></Fit>
          <Fit caption="Draft order · final" note="After 6:00 PM ET: read-only; late joiners pick last (new copy)"><I.ArrangeOrder locked /></Fit>
          <Fit caption="Push · draft order set (random)" note="At 6:00 PM ET in either mode, plus an in-app card (new copy)"><I.OrderPush /></Fit>
          <Fit caption="Push · draft order set (manual)"><I.OrderPush mode="manual" /></Fit>
          <Fit caption="Start the draft (commissioner)" note="Office League: 7 managers, 10 weeks, so the uneven-bye heads-up shows (new copy)"><I.StartDraftConfirm /></Fit>
          <Fit caption="Start the draft · too many playoff teams" note="7 playoff teams, 6 managers: fix it right here; Start stays disabled until it fits (new copy)"><I.StartDraftConfirm managers={6} playoff={7} /></Fit>
          <Fit caption="Create league · Season" note="Uneven-bye heads-up on the weeks control, based on the expected size (new copy)"><I.CreateSeason /></Fit>
          <Fit caption="Draft room · auto-picks" note="New copy: the banner, the Auto badge and the pick-log lines"><I.DraftAutoPick /></Fit>
          <Fit caption="Draft recap"><I.DraftRecap /></Fit>
          <Fit caption="Playoff bracket · 4 teams" note="Two playoff weeks after the regular season"><I.Playoffs /></Fit>
          <Fit caption="Playoff bracket · 6 teams" note="3 weeks; seeds 1–2 get first-round byes (new copy; round names decided)"><I.Playoffs6 /></Fit>
        </Group>

        <section className="b-sec" id="call-run-it-back" aria-labelledby="call-run-it-back-h">
          <header className="b-sec__head">
            <span className="b-sec__n">?</span>
            <div>
              <h2 id="call-run-it-back-h">Your call: Run it back</h2>
              <p className="b-job">Season 1 of Stock Scudetto is over (Roberto B. won, 11–3). The commissioner renews the league so the same group plays Season 2. Who's in is decided; three choices remain. All copy here is new. Anything tagged <b>Needs backend</b> depends on the renewal plan being scoped now: today's "start new season" deletes the matchups, keeps the old teams and skips the draft, so it can't be used as it is.</p>
            </div>
          </header>
          <div className="b-ask" style={{ marginTop: 0, marginBottom: 28, maxWidth: '84ch' }}>
            <h3>Your call · decided and open</h3>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              <li><b>Who's in: DECIDED (opt-in).</b> Only the commissioner can run it back. Every Season 1 player then gets "I'm in / I'm out" (a push, plus a card on Home and the League tab), the commissioner is told about each reply and sees In / Out / No reply yet, and the draft can't be set until nobody is left without a reply. New people can join with the invite code; the team count follows who's in, up to 16. <b>To confirm:</b> how the commissioner clears someone who never replies (frame 4 below).</li>
              <li><b>Teams: a new draft.</b> Draft night is the best moment in the game, and last season's luck doesn't carry over. Keepers can come later.</li>
              <li><b>Settings: everything carries over</b>, and the commissioner can change any of it on one review screen before the draft.</li>
              <li><b>History: Season 1 stays.</b> A champion banner on the League tab until Season 2's draft, and League › History keeps every season's standings, matchups and draft.</li>
            </ol>
          </div>

          <h3 className="b-sub">Starting it (commissioner only)</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Home · season complete (commissioner)" note='"Start next season" becomes a "Run it back?" card. Members see the champion card without it.'><I.RibHome /></Fit>
            <Fit caption="League tab · season over (commissioner)" note="The champion banner, the commissioner's action, and Season 1's final standings."><I.RibLeague /></Fit>
            <Fit caption="Push · every Season 1 player" note="Sent the moment the commissioner runs it back; opens the I'm in / I'm out card."><I.RibPush mode="ask" /></Fit>
          </div>

          <h3 className="b-sub">(a) Who's in · decided: opt-in, the commissioner reconciles</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="1 · Member: Home (and the League tab)" note="The same card sits on the League tab. An answer can change until the draft is set."><I.RibMemberPrompt /></Fit>
            <Fit caption="2 · Commissioner: a push for each reply" note="Every answer notifies the commissioner, with the running count."><I.RibPush mode="reply" /></Fit>
            <Fit caption="3 · Commissioner: Home while replies come in" note="Counts and who's still to reply; opens the reconcile view."><I.RibHomeCounts /></Fit>
            <Fit caption="4 · Commissioner: League tab, reconcile" note="In / New / Out / No reply yet, by name. The draft rows stay disabled, with the reason, until nobody is left without a reply. Needs backend: replies, and joins during renewal."><I.RibReconcile /></Fit>
            <Fit caption="5 · PROPOSAL, to confirm: clearing a non-reply" note='"Nudge again" re-sends the push; "Mark as out" closes it and tells that player. Our proposal; Giorgio to confirm.'><I.RibResolve /></Fit>
            <Fit caption="6 · After everyone has replied: the review" note="Teams = who's in + new joins (here 4 + 1 = 5, up to 16), with the uneven-bye heads-up. Needs backend: today join refuses league_full."><I.RibReview /></Fit>
          </div>

          <h3 className="b-sub">(b) How teams start</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="A · new draft (lean)" note="Fresh and fair; the draft order is new (Random or Manual, set an hour before). Uses the existing draft."><I.RibTeams mode="draft" /></Fit>
            <Fit caption="B · keep teams" note="No draft night, and last season's best team starts ahead on picks. Needs backend: restart every slot at $2,000 at Week 1's open."><I.RibTeams mode="keep" /></Fit>
            <Fit caption="C · keepers (keep up to 2)" note="Continuity plus a draft, the fantasy-football favourite. Needs backend: keeper picks and a shorter draft. A good later upgrade."><I.RibTeams mode="keepers" /></Fit>
          </div>

          <h3 className="b-sub">(c) Settings: see frame 6 above (every Season 1 setting carried over, editable until the draft) · (d) History</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="League tab · Season 2, before the draft" note="The Season 1 champion banner stays until Season 2's draft; History is one tap away."><I.RibHistory /></Fit>
            <Fit caption="League › History" note="Every season, its champion and final standings; matchups and the draft recap too. Needs backend: keep them instead of deleting."><I.RibHistory view="list" /></Fit>
          </div>
        </section>

        <Group id="money" code="3e" name="Trading" job="Sell, keep the cash in the slot, and buy again with exactly what the sale brought in."
          notes={[
            'Sell is all or nothing: a slot holds one stock, so the sheet confirms "Sell all X sh ≈ $Y" (no partial amounts). The money stays in the slot.',
            'Buy invests the whole slot: its full sale proceeds, never a partial amount and never a fresh $2,000.',
            'When more than one sale has cash waiting, the buy asks which sale pays; one buy never mixes two slots.',
            'If the chosen sale\'s cash was already spent (proceeds_unavailable): "That sale\'s cash isn\'t available anymore. Pick another." and back to the picker (new copy).',
            'If there is no cash in any slot at all (no_proceeds, only a pre-fix ledger anomaly reaches it): a terminal message with no picker, "There\'s no cash in your slots to invest." (new copy).',
            'A draft slot that was skipped counts as a source worth the full $2,000.00.',
            'Review screens show the numbers that matter: shares, price, what you get, and how the slot compares with its $2,000.00 start.',
            'After a sale you can invest right away or later; the slot shows as Cash on Portfolio until you do.',
            'Buy review names the slot paying for it and what is left in it.',
            'With the market closed, trading is shown but disabled, with the time it opens.',
            'Screens that show prices carry a quiet credit, "Market data provided by Alpaca" (caption, secondary text). Wording to confirm against the provider\'s terms.',
            'Trade history includes the draft picks, so every dollar in the portfolio has a line.',
            'Budget-cap and price-tier leagues (your call: A, decided): trading works as the server does, one share per buy and the whole position per sell. A sale\'s cash goes back into the budget, and every review shows "1 share" and the budget left (or, in a tier league, the open slot\'s price tier). Making them spend a whole sale like per-slot leagues is a possible later change; it needs backend work.',
          ]}>
          <Fit caption="Sell TSLA" note="Sell pre-selected · whole position"><I.SellSheet /></Fit>
          <Fit caption="Review sell"><I.ReviewSell /></Fit>
          <Fit caption="Sold" note="Invest now or later"><I.Done kind="sold" /></Fit>
          <Fit caption="Which sale pays?" note="When two sales have cash (V sale hypothetical)"><I.PickSource /></Fit>
          <Fit caption="Review buy" note="Paid from the TSLA slot"><I.ReviewBuy /></Fit>
          <Fit caption="Bought"><I.Done kind="bought" /></Fit>
          <Fit caption="Market closed"><I.MarketClosed /></Fit>
          <Fit caption="Budget league · review sell" note="Budget-cap and price-tier leagues trade one share at a time; the sale's cash goes back into the budget (your call: A, decided; new copy)"><I.OneShareSell /></Fit>
          <Fit caption="Budget league · review buy" note="One share; the budget left is always shown. Tier leagues show the open slot's price tier instead (new copy)"><I.OneShareBuy /></Fit>
          <Fit caption="Trade history" note="Includes the draft"><I.TradeHistory /></Fit>
        </Group>


        <Group id="web" code="3d" name="Web app" job="The same four destinations in a left rail, the same content in two columns, and the stock sheet as a side panel."
          notes={[
            'The rail replaces the tab bar at 768px and wider; below that the web app uses the phone layout.',
            'The league pill and every component are the same as on the phone; nothing is web-only except hover states.',
          ]}>
          <div className="b-inv__wide">
            <Fit w={1280} h={800} radius={12} caption="Home · 1280"><I.WebHome /></Fit>
            <Fit w={1280} h={800} radius={12} caption="Portfolio with the stock panel · 1280"><I.WebPortfolio /></Fit>
            <Fit w={1280} h={800} radius={12} caption="Settings › Appearance · 1280"><I.WebSettings /></Fit>
          </div>
        </Group>
      </>
    );
  }

  window.KSInventoryBoard = Inventory;
})();
