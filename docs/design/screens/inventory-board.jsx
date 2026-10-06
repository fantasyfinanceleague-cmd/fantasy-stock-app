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
            'Season complete: the commissioner also gets the "Run it back?" card, and every Season 1 player later gets the "Are you in?" card (see Run it back).',
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
            'A draft pick can never be unused (Giorgio): the server refuses a pick that would leave any slot unfillable or your budget short for your remaining picks, blocks the start until every slot is fillable, and pauses the draft (clock stopped, nobody skipped) in the should-never-happen case that no stock fits. Refusals appear instantly, keep the clock running, and never sound like blame. (New copy.)',
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
          <Fit caption="Pick refused · a slot left unfillable" note="would_strand_slot. New copy. Generic when the server doesn't name who/which: 'Taking {stock} would leave another manager with no stock for one of their slots.'"><I.DraftRefused kind="strand" /></Fit>
          <Fit caption="Pick refused · budget for later picks" note="budget_reserve. New copy. Generic: '{stock} would leave too little budget for your remaining picks.'"><I.DraftRefused kind="budget" /></Fit>
          <Fit caption="Start the draft · setup can't fill every slot" note="slots_infeasible + budget_infeasible (each shows only when it applies). New copy. Generic lines only: the setup check returns a reason code, no counts (security review)."><I.StartBlocked /></Fit>
          <Fit caption="Start the draft · check unavailable" note="feasibility_unavailable: Start stays disabled until the check runs. New copy."><I.StartBlocked unavailable /></Fit>
          <Fit caption="Draft paused (should never happen)" note="Stalled turn, as members see it. New copy."><I.DraftStalled /></Fit>
          <Fit caption="Draft paused · commissioner" note="Same state for the commissioner, plus the push below. New copy."><I.DraftStalled commish /></Fit>
          <Fit caption="Push · draft paused (commissioner)" note="New copy."><I.StallPush /></Fit>
          <Fit caption="Draft recap"><I.DraftRecap /></Fit>
          <Fit caption="Playoff bracket · 4 teams" note="Two playoff weeks after the regular season"><I.Playoffs /></Fit>
          <Fit caption="Playoff bracket · 6 teams" note="3 weeks; seeds 1–2 get first-round byes (new copy; round names decided)"><I.Playoffs6 /></Fit>
        </Group>

        <section className="b-sec" id="run-it-back" aria-labelledby="run-it-back-h">
          <header className="b-sec__head">
            <span className="b-sec__n b-sec__n--code">3c</span>
            <div>
              <h2 id="run-it-back-h">Run it back</h2>
              <p className="b-job">Season 1 is over; the commissioner renews the league so the group plays Season 2. Decided by Giorgio (2026-10-04); all copy here is approved. Built in 3c (League tab + the Home cards) on the backend in feat/run-it-back.</p>
            </div>
          </header>
          <ul className="b-inv__notes">
            <li><b>Only the commissioner</b> runs it back: the "Run it back?" card on the season-complete Home and the League tab action. Season 2 is a new league linked to Season 1, which stays frozen and complete.</li>
            <li><b>Opt-in.</b> Every Season 1 player gets "Roberto B. is running it back. Are you in for Season 2?" (push + a card on Home and the League tab). Answers can flip in ↔ out until the draft is set.</li>
            <li><b>The commissioner hears every reply</b> and reconciles on "Who's running back": Season 1 order, "Running back" (name bold), "Out" (muted), "No reply yet" with <b>Nudge again</b> (once a day) or <b>Remove</b>; new joiners last ("New", "Joining").</li>
            <li><b>A player who is in</b> goes straight to the same list, read-only, with "You're running back · Change". Players who are out or haven't answered don't see it.</li>
            <li><b>The draft can't be set</b> while anyone is "No reply yet": the draft rows stay disabled with the reason inline (the server enforces it too).</li>
            <li><b>New players</b> join with the invite code, not capped by Season 1's size (up to 16 until the draft), and see Season 1's history.</li>
            <li><b>Teams start with a new draft</b>; every setting carries over and the commissioner can edit it on the review. Keepers / keep teams were not chosen.</li>
            <li><b>History:</b> a Season 1 champion banner on the League tab until Season 2's draft; League › History lists every season with its final standings, matchups and draft.</li>
          </ul>

          <h3 className="b-sub">Starting it (commissioner only)</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Home · season complete (commissioner)" note='"Start next season" becomes a "Run it back?" card. Members see the champion card without it.'><I.RibHome /></Fit>
            <Fit caption="League tab · season over (commissioner)" note="The champion banner, the commissioner's action, and Season 1's final standings."><I.RibLeague /></Fit>
            <Fit caption="Push · every Season 1 player" note="Sent the moment the commissioner runs it back; opens the I'm in / I'm out card."><I.RibPush mode="ask" /></Fit>
          </div>

          <h3 className="b-sub">Who's in: opt-in, the commissioner reconciles</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="1 · Member: Home (and the League tab)" note="The same card sits on the League tab. I'm in opens the full list (4b). An answer can change until the draft is set."><I.RibMemberPrompt /></Fit>
            <Fit caption="2 · Commissioner: a push for each reply" note="Every answer notifies the commissioner, with the running count."><I.RibPush mode="reply" /></Fit>
            <Fit caption="3 · Commissioner: Home while replies come in" note="Counts and who's still to reply; opens the reconcile view."><I.RibHomeCounts /></Fit>
            <Fit caption="4 · Commissioner: League tab, reconcile" note={`Standings-style, in Season 1 order: "Running back" (Giorgio's copy) with the name in bold; "Out" muted; "No reply yet" with "Nudge again · Remove" (Giorgio's words) on the row; new joiners last with a New marker and "Joining". Draft rows stay disabled until nobody is left without a reply. Needs backend: replies, and joins during renewal.`}><I.RibReconcile /></Fit>
            <Fit caption="4b · A member who said I'm in" note="Answering I'm in opens this: the same list with every answer and no actions, plus 'Change'. Players who are out or haven't answered don't see it."><I.RibMemberList /></Fit>
            <Fit caption="5 · Clearing a non-reply" note='"Nudge again" re-sends the ask (once a day); "Remove" takes them out of Season 2 and tells them.'><I.RibResolve /></Fit>
            <Fit caption="6 · After everyone has replied: the review" note="Every Season 1 setting carried over and editable; teams = who's in + new joins (here 4 + 1 = 5, up to 16), with the uneven-bye heads-up. Schedule the draft = start_renewed_season."><I.RibReview /></Fit>
          </div>

          <h3 className="b-sub">History</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="League tab · Season 2, before the draft" note="The Season 1 champion banner stays until Season 2's draft; History is one tap away."><I.RibHistory /></Fit>
            <Fit caption="League › History" note="Every season, its champion and final standings; matchups and the draft recap too. New players see it as well."><I.RibHistory view="list" /></Fit>
          </div>
        </section>

        <section className="b-sec" id="call-leave" aria-labelledby="call-leave-h">
          <header className="b-sec__head">
            <span className="b-sec__n b-sec__n--code">3c</span>
            <div>
              <h2 id="call-leave-h">Your call: leaving a league</h2>
              <p className="b-job">Five decisions, from LEAVE_LEAGUE_OPTIONS.md (feat/leave-league). ★ marks the worker's recommendation; the Design Lead's view is in the box at the end. All copy inside these frames is new. Samples: before the draft, Sofia F. leaves Serie A Traders; mid-season, Gianluigi B. (Roberto's Week 6 opponent) leaves Stock Scudetto on Tuesday; in the playoffs, Francesco T. left in Week 9 and still finished 4th.</p>
            </div>
          </header>
          <ul className="b-inv__notes">
            <li><b>Today a leave is an unguarded delete</b> that anyone can do at any time, the commissioner included. After the draft it leaves a "zombie" team that still scores but can't trade, and it stalls the playoffs (<code>bracket_non_member</code>). Every option below replaces it.</li>
            <li><b>The key fact for Q2:</b> bots already are buy-and-hold teams. So "auto-managed" and "frozen portfolio" are the same mechanics; the scoring path is the one bots use today.</li>
            <li><b>Mid-draft leaving is blocked in every option</b> (the database already refuses it).</li>
            <li><b>Where it lives:</b> "Leave league" sits at the bottom of League settings, in red, the way "Sign out" sits at the bottom of Profile. It opens a sheet that is the confirmation; there's no second alert.</li>
          </ul>

          <h3 className="b-sub">Q1 · Leaving before the draft</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Leave sheet · member, before the draft" note="Same sheet for A and B."><I.LeaveSheet mode="pre" /></Fit>
            <Fit caption="★ A · Remove the membership" note="The commissioner's draft order closes the gap and stays final."><I.OrderAfterLeave q1="A" /></Fit>
            <Fit caption="B · Remove + reopen the order" note="A manual order that was final reopens; the commissioner must confirm it again."><I.OrderAfterLeave q1="B" /></Fit>
          </div>

          <h3 className="b-sub">Q2 · Leaving after the draft</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="★ A · Soft leave: the sheet" note="The team keeps its stocks and plays out the season, buy-and-hold."><I.LeaveSheet mode="A" /></Fit>
            <Fit caption="★ A · The opponent's Home" note='"Gianluigi B. (left) · Auto-managed" with a real live score: Roberto still has to beat a portfolio.'><I.DepartedMatchup q2="A" /></Fit>
            <Fit caption="★ A · Standings for everyone else" note="The row stays in place, labelled, muted. Scoring is unchanged."><I.DepartedStandings /></Fit>
            <Fit caption="B · Forfeit: the sheet" note="Stocks are sold back to the pool; every remaining matchup is a loss."><I.LeaveSheet mode="B" /></Fit>
            <Fit caption="B · Forfeit: the opponent's Home" note="A free W. Whoever faces the leaver late in the season gets free wins."><I.DepartedMatchup q2="B" /></Fit>
            <Fit caption="C · No mid-season leave" note="Leave league stays disabled, with the reason, until the season ends."><I.LeaveRefused kind="season" /></Fit>
          </div>

          <h3 className="b-sub">Q3 · Playoffs with a departed team</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="★ A · Departed teams stay eligible" note="Seeding unchanged; the 4th seed plays on autopilot and could win the title."><I.DepartedBracket q3="A" /></Fit>
            <Fit caption="B · Skip departed teams in seeding" note="Seeds shift: 5th moves up to the 4th seed. Fewer than 2 active teams: no playoffs."><I.DepartedBracket q3="B" /></Fit>
          </div>

          <h3 className="b-sub">Q4 · The commissioner leaving</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="A · Block until transferred" note="Leave is disabled; first make someone else commissioner from the Commissioner row, then leave as a member."><I.LeaveRefused kind="commish" /></Fit>
            <Fit caption="★ B · Pick a successor in the leave sheet" note="Human members only, one atomic step. Shown after picking: nothing is preselected, and the button names the successor once one is picked."><I.CommishLeave q4="B" /></Fit>
            <Fit caption="C · Auto-transfer" note="The longest-standing manager becomes commissioner and gets a push."><I.CommishLeave q4="C" /></Fit>
          </div>

          <h3 className="b-sub">Q5 · What the leaver sees, and rejoining</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="★ A · League tab after leaving" note="Read-only: history stays visible, no trading, no rejoin this season."><I.LeaverLeague q5="A" /></Fit>
            <Fit caption="B · Reclaim my team" note="Until the season ends, the leaver can undo; trading reopens."><I.LeaverLeague q5="B" /></Fit>
            <Fit caption="A and B · Home skips the league" note="On Gianluigi B.'s phone (their other league is sample data). The league leaves the single-league Home and sits under a new 'You left' group in Your leagues."><I.LeaverSheet /></Fit>
          </div>

          <h3 className="b-sub">Refusals</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Mid-draft (every option)" note="The reason sits on the disabled row, as with the draft rows in Run it back."><I.LeaveRefused kind="drafting" /></Fit>
            <Fit caption="Only manager left (Q4)" note="Everyone else is a bot. Before the draft: delete the league instead. After the draft: refused too (recommended for launch)."><I.LeaveRefused kind="sole" /></Fit>
            <Fit caption="Rejoin after leaving (Q5-A)" note="The invite code refuses a manager who left this season."><I.LeaveRefused kind="rejoin" /></Fit>
          </div>

          <div className="b-ask">
            <h3>Your call · Design Lead agrees with the ★ package (Q1-A, Q2-A, Q3-A, Q4-B, Q5-A)</h3>
            <ul>
              <li><b>Q2-A is the anchor.</b> The leaver's opponents still play a real portfolio, nobody gets free wins, and nobody is trapped in a league. It also needs no change to scoring, snapshots or the playoffs: the departed team scores exactly the way a bot does today. B puts a new branch into the scoring pipeline that was just hardened (S1–S9). C turns "you can't leave" into a support ticket.</li>
              <li><b>Q3-A follows from Q2-A.</b> An autopilot team had to earn its seed, and a departed seed still makes the bracket start. The cost is honest and rare: a departed team could win the title, and its champion line would read "Francesco T. (left)". B shifts seeds and byes late, and it rewrites the playoff guard.</li>
              <li><b>Q4-B, with one design condition:</b> no successor is preselected. Leaving is destructive, and a default choice would let one tap hand the league to someone nobody chose. The button stays disabled until a pick, then reads "Leave and hand over to Paolo M.". The successor gets a push. A (transfer first, then leave) is the fallback if the picker slips; a standalone "Make commissioner" is useful anyway.</li>
              <li><b>Q1-A:</b> closing the gap is what everyone expects, and the commissioner sees why the order changed. Keep the existing refusal at draft start when playoff teams outnumber managers; don't silently clamp it.</li>
              <li><b>Q5-A:</b> one state ("left") is simpler to explain than "left, then back". The league stays readable, so history isn't lost.</li>
              <li><b>Still open (not on the worker's list):</b> should the opponent get a push when their manager leaves ("Gianluigi B. left Stock Scudetto. Their team plays on, auto-managed.")? Recommend yes, to everyone in the league, once.</li>
              <li><b>Backend:</b> the "(left)" label needs a departed flag from <code>get_league_display_names</code>. Home has to skip departed leagues (<code>get_home_summary</code>). "Delete the league instead" points at a delete that is still client-side (<code>[I3]</code>).</li>
            </ul>
          </div>
        </section>

        <section className="b-sec" id="call-tier-trades" aria-labelledby="call-tier-trades-h">
          <header className="b-sec__head">
            <span className="b-sec__n b-sec__n--code">3e</span>
            <div>
              <h2 id="call-tier-trades-h">Your call: which tier a traded stock fills</h2>
              <p className="b-job">Price-tier leagues (one share per tier). Today tiers are only counted from the draft, so after a sale a manager can buy a second stock into a tier that is already filled; only the roster cap stops them. Pick how a trade buy fits the tiers. Sample: "Tier Cup", six one-share tiers. Roberto sold DIS ($102.90), his $100–$200 stock. All copy in these frames is new.</p>
            </div>
          </header>
          <ul className="b-inv__notes">
            <li><b>Already decided (A, 2026-09-30):</b> one share per buy and the whole position per sell. The review says "1 share" and the slot's tier. This choice only decides <i>which</i> tier a buy may fill.</li>
            <li><b>A · Replace in the same tier.</b> Selling frees that stock's tier slot. A buy must fit a free tier slot; the review says "Fills your $100–$200 slot". If no free tier fits, the buy is refused with the reason.</li>
            <li><b>B · Any open tier, re-fit by price.</b> A holding's tier comes from its entry price, first fit across every holding. A buy is legal if all holdings plus the new one still fit the tier layout.</li>
            <li><b>C · Tiers are a draft rule only.</b> Trades ignore tiers; only the roster cap and the budget apply. The review shows no tier.</li>
            <li><b>Budget rows are unchanged:</b> the decided one-share review keeps "Budget now" and "Budget left after"; these frames leave them out to show only the tier line.</li>
            <li><b>Either way, a tier is set by the entry price</b> (draft price or buy price) and never moves if the stock's price drifts out of its bracket later.</li>
          </ul>

          <h3 className="b-sub">A · Replace in the same tier</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Portfolio · the open slot" note="Each row names its slot; the freed slot is a row with Fill, which opens the stock list."><I.TierPortfolio mode="A" /></Fit>
            <Fit caption="Review buy · SHOP $104.20" note='"Fills your $100–$200 slot", next to the already-decided "1 share" rule.'><I.TierReview mode="A" /></Fit>
            <Fit caption="Refused · AAPL $211.42" note="Shown before the review, from the stock sheet's Buy. The reason names the price and the open slot's range."><I.TierRefused mode="A" /></Fit>
          </div>

          <h3 className="b-sub">B · Any open tier, re-fit by price</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Portfolio · tiers by entry price" note="Rows show the tier their entry price falls in. The gap is described by the whole layout, not one slot."><I.TierPortfolio mode="B" /></Fit>
            <Fit caption="Review buy · SHOP $104.20" note="The tier is computed from today's price, so the review can only say where it lands."><I.TierReview mode="B" /></Fit>
            <Fit caption="Refused · AAPL $211.42" note="The reason has to explain the whole layout, not one slot."><I.TierRefused mode="B" /></Fit>
          </div>

          <h3 className="b-sub">C · Tiers are a draft rule only</h3>
          <div className="b-concepts b-concepts--three">
            <Fit caption="Portfolio · after selling DIS, buying AAPL" note="Two stocks between $200 and $400, none between $100 and $200. No tier labels after the draft."><I.TierPortfolio mode="C" /></Fit>
            <Fit caption="Review buy · AAPL $211.42" note="No tier line: only the roster cap and the budget can refuse."><I.TierReview mode="C" /></Fit>
          </div>

          <div className="b-ask">
            <h3>Your call · recommend A</h3>
            <ul>
              <li><b>A keeps the league's shape.</b> The tier layout the commissioner chose stays true all season: every roster always holds one cheap stock, one mid-priced stock and one expensive stock. A trade is a swap inside a tier ("sell my $100–$200 stock, buy a better $100–$200 stock"), which is easy to explain on one line and easy to refuse with a reason.</li>
              <li><b>B plays the same as A</b> while tiers don't overlap (the layout above): each one-share tier holds exactly one stock, so "re-fit everything" always lands back on "fill the open tier". It only differs with overlapping brackets, and there its refusals have to explain the whole roster ("two stocks in $200–$400 and none in $100–$200"). It costs more to explain for the same play.</li>
              <li><b>C changes what tiers mean.</b> They become a draft-room constraint that dissolves on the first trade: by mid-season a tier league can be five $800+ stocks, the same game as a plain budget league. If that is the intent, a tier league doesn't need its own format.</li>
              <li><b>Backend (A or B):</b> trade buys need a slot. Tiers today count only <code>drafts.slot_id</code>; a buy in record-trade would carry the freed <code>slot_id</code> (A) or re-check every holding's entry price (B), and refuse with <code>tier_full</code> / <code>tier_mismatch</code>. C needs no backend change.</li>
            </ul>
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
