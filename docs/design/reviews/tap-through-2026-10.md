# Tap-through, 2026-10 (W8 part 2): every tappable on the device

Giorgio, 2026-10-12: "we can't have buttons that don't do anything, links that don't do anything." Part 1 proved it statically (`tappables.md`, the no-op handler test). This is the device pass: every row of the inventory that a fixture can reach was tapped in the iOS simulator, and what happened was written down.

- **Build:** `origin/main` 59e1222b with this branch's changes in the working tree. The fixes below were applied DURING the pass; a row that says BEFORE / AFTER was tapped both ways. The same commit carries the fixes and this file.
- **Device:** iPhone 17e simulator (iOS 27.0), Expo Go, Metro on a private port, a DEAD Supabase URL (nothing real was read or written). Dev fixtures only: `SHELL_FIXTURE` (leagues, no-leagues, no-username, signed-out, onboarding, drafting, leagues-member, leagues-renewal, leagues-failed-once), `INVITE_FIXTURE`, `JOIN_FIXTURE`, `CREATE_FIXTURE`, `PUSH_ASK`, `CONFIRMED`, `HOME_FIXTURE` with `GAME_SEAM`, `DRAFT_ROOM_FIXTURE`, `DRAFT_START_FIXTURE`, `RENEWAL_FIXTURE`, `LEAVE_LEAGUE`, `MONEY_FIXTURE` scenarios.
- **Method:** real taps (duration 0.1), a fresh screenshot after each (they lag a beat, so a "nothing happened" was always re-taken before it was called). Typed text only for the fixtures' own values; no real credential was typed anywhere.
- **Evidence:** stills stay out of the repo, in `~/fantasy-stock-design-review/chore-w8-tap-through/` (the log `results.tsv`, the drivers `fx.sh` / `shot.sh` / `x07.sh`, and the frames).

## Summary

**188 result rows** (one per control or per state of a control; the inventory's 219 rows share components, so a row here often covers several inventory rows).

| Result | Rows |
|---|---|
| PASS | 157 |
| PASS (fix or finding) | 5 |
| TAPPED, EFFECT UNVERIFIABLE | 6 |
| UNREACHABLE | 15 |
| FINDING | 1 |
| n/a | 4 |

Where the fixture could not show a state change, the row says "UNVERIFIABLE" or "UNREACHABLE" rather than PASS. **Every control that could be judged on the device either acted, was explained on screen (disabled with its reason), or was fixed below. The rows marked UNVERIFIABLE could not be judged either way from a fixture: they are not claimed as working, and they are listed for a real-device pass.**

### Findings

| # | Finding | Status |
|---|---|---|
| F1 | The draft queue's search showed its spinner and never resolved (observed 45 s). `QueueEditor` passed `ownedSymbols={new Set()}`, a fresh Set per render, to `useSymbolSearch`, which takes it as an effect dependency: every parent re-render cancelled the pending 300 ms debounce. | **Fixed** (`QueueEditor`: one module-level Set). Test `search-stable-deps.test.ts` + mutation. After the fix: results and "No matching stocks found" resolve. |
| F2 | Check availability said "Stock data is still loading" when the symbols read FAILED. `fetchEnrichmentProgress` / `countSlotMatches` discarded the result's `error` (supabase-js resolves it, it does not throw), so the component's "couldn't check" catch was dead. A failed per-slot count read as zero matches. | **Fixed** (`lib/readResult.ts`, `countOrThrow` / `rowsOrThrow`). Test `read-result.test.ts` + 2 mutations. After the fix: "Could not check availability — try again." |
| F3 | Profile's back link is labelled "‹ Home" but calls `router.back()`: from the League tab it returned to League. The label and destination disagree whenever Profile is opened from a non-Home tab. | **Listed, needs a copy / design call** (a dynamic label, or "Back"). |
| F4 | Renewal review: "Schedule the draft" is disabled with NO line saying why while no future draft time is chosen. The Draft row reads "Not set" while the picker chips show a date and time (the current time), which reads as set. It enables once a future date is picked. | **Listed, needs a copy / design call.** |
| F5 | The `player-portfolio` route and `PlayerPortfolioScreen` are declared (layout, resume table) but **nothing navigates to them**. A screen nobody can reach. | **Listed, needs a product call** (delete, or wire the entry point). |
| F6 | "See the bracket" (an eliminated player's Home card) opened League on whichever segment it was left on (Standings), with no bracket in view. | **Fixed** (`BRACKET_HREF`, `?segment=playoffs`). Test in `home-calm.test.ts` + mutation. |
| F7 | The money-search fixture's Try again was a silent no-op (the `NOOP` waived in part 1). Dev fixture only. | **Fixed** (a dev log line, as the invite fixture's retry is); the waiver is removed. Part 1's static check covers it. |
| O1 | Observed once, NOT reproduced: on the sim's very first launch, after Next, Next, Get started, the three controls on Get started did nothing on three taps. Three further cold launches (the Next route, the Skip route, a direct route) all worked. Likely a first-launch artifact; recorded in case it recurs on a real device. | **Watch.** |

Also **verified on the device**, not just argued in part 1: Join is disabled with its reason for a member who left (`join_disabled`), and the part-1 waiver for it stands.

### Needs a real-server tap (Giorgio's phone)

Controls whose job is a server write the fixture's static seam cannot show. They were tapped and their handlers run, but the EFFECT is unverified. A real-device pass should confirm each changes the real state:

- **Home (pre_draft, at_risk)**: Move forward with 7
- **Home (pre_draft, at_risk)**: Invite someone new
- **Home (pre_draft, at_risk)**: Playoff teams stepper -
- **League (pre-draft)**: Save queue
- **Leave sheet**: Leave league (confirm)
- **Draft room**: Draft (pick)
- **Renewal roster sheet**: Nudge again
- **Renewal review**: Schedule the draft (date set)
- **Draft time sheet (Home)**: Set draft time / x
- **Stock sheet (S001, unpriced)**: Review sell (disabled) + Try again link

### Unreachable in any fixture

- **Slot builder (category sheet)**: a category row (categories load from the server)
- **Change password**: Update password (valid) (real session)
- **Login**: Resend (the unconfirmed-email resend) (needs a real account state)
- **League settings (commissioner)**: Transfer commissioner row + sheet rows (ChoiceRow, Transfer, close) (no fixture)
- **Draft room (complete)**: Retry finish (needs a failing finalize)
- **Stock sheet (buy, free stock)**: Review buy, the buy review panel (no free stock in the fixture)
- **Review panel**: Next-step button (onNextStep) (needs the `ok` scenario with a free slot)
- **Stock sheet / Trade review**: Sale picker (rows, Use, close) (no fixture)
- **reset-password (dead link)**: Back to sign in / Cancel / form Cancel (for the form variant (real recovery session)
- **Player portfolio route**: any control (no entry point)
- **League (load failed)**: LeagueStates Try again (no fixture)
- **Matchup (load failed)**: LoadFailure retries (x4) (no fixture)
- **Renewal (load failed)**: Try again (no fixture)
- **Home (season 2 renewed)**: See league (RenewalCountsCard) (state not reachable)
- **Create account (after a real sign-up)**: Check-your-email card: Back / Resend (real sign-up)

## The table

Screen | tappable | where (from the inventory) | expected | what happened | result. Source columns name the file; line numbers are in `tappables.md`.

| Screen | Tappable | Source | Expected | What happened | Result |
|---|---|---|---|---|---|
| Onboarding (cards) | Next (card 1 to 2, 2 to 3) | components/shell/onboarding/OnboardingPager.tsx Button onPress=onNext | next card | next card | PASS |
| Onboarding (card 3) | Get started | OnboardingPager Button onPress=onNext, onFinish=toGetStarted | Get started screen | Get started screen | PASS |
| Onboarding | Skip | OnboardingPager Pressable onPress=onSkip | Get started screen | Get started screen | PASS |
| Get started | Create a league | components/shell/GetStarted.tsx Choice onPress=onCreate | Create account (pending route /create-league) | Create account; after sign-in resumed into Create league | PASS |
| Get started | Join with a code | GetStarted Choice onPress=onJoin | Create account (pending route /join-league) | not yet tapped | PENDING |
| Get started | Sign in | GetStarted Pressable onPress=onSignIn | Login | not yet tapped | PENDING |
| Create account | Continue with Apple | components/shell/SocialSignIn.tsx Button onPress=run('apple') | fixture answers with the signups-paused refusal | refusal panel shown, buttons replaced by Sign in instead | PASS (fixture; the real Apple flow is UNREACHABLE) |
| Create account | Sign in instead | app/create-account.tsx Button onPress router.replace('/login') | Login | Login | PASS |
| Create account | Create account (empty form) | app/create-account.tsx Button onPress=handleCreate | inline reason | "Please enter email and password", fields outlined red | PASS |
| Create account | Sign in (link) | app/create-account.tsx Pressable onPress router.replace('/login') | Login | Login | PASS |
| Login | Forgot password? | app/login.tsx Pressable onPress router.push('/forgot-password') | Forgot password | Forgot password | PASS |
| Login | Create an account (link) | app/login.tsx Pressable onPress router.push('/create-account') | Create account | Create account | PASS |
| Login | Sign in (empty form) | app/login.tsx Button onPress=handleSignIn | inline reason | "Please enter email and password" | PASS |
| Login | Continue with Google | components/shell/SocialSignIn.tsx Button onPress=run('google') | fixture refusal line | refusal line shown | PASS (fixture; the real Google flow is UNREACHABLE) |
| Login | Sign in (filled form) | app/login.tsx Button onPress=handleSignIn | signs in (fixture), resumes the pending route | signed in and resumed into Create league | PASS |
| Forgot password | Send reset link (empty) | app/forgot-password.tsx Button onPress=handleResetPassword | inline reason | "Please enter your email address" | PASS |
| Forgot password | Send reset link (typed email) | handleResetPassword | sent state (fixture fakes the send) | "Check your email" card | PASS (fixture) |
| Forgot password (sent) | Didn't receive it? Send again | app/forgot-password.tsx EmptyState onSecondaryAction (setSent(false); handleResetPassword()) | re-sends | fixture: 900 ms loading, then sent again, no visible change; production would show the resend-cooldown line | PASS (see note: no acknowledgement in the fixture) |
| Forgot password (sent) | Back to sign in (button) | EmptyState onAction=backToSignIn router.replace('/login') | Login | Login | PASS |
| Create league 1 | Next (empty name) | app/create-league.tsx Button onPress=goNext | inline reason | "Enter a league name." | PASS |
| Create league 1 | League type rows (Matchup / Duration) | ChoiceRow onPress patch({type}) | check moves | check moved to Duration | PASS |
| Create league 1 | Next (named) | goNext | step 2 | step 2 Season | PASS |
| Create league 2 | Managers stepper + | components/game/Stepper.tsx Pressable onPress up | next even size | 8 to 10 (sizes are even, 4 to 16) | PASS |
| Create league 2 | Duration rows (6 Months) | ChoiceRow onPress patch({durationDays}) | check moves | check moved | PASS |
| Create league 2 | Next | goNext | step 3 | step 3 Draft | PASS |
| Create league 3 | Pick clock 45s | SegmentedControl onChange patch({pickSeconds}) | 45 selected, header reads 45 seconds | yes | PASS |
| Create league 3 | Draft order Manual | SegmentedControl onChange patch({draftOrder}) | Manual selected, caption changes | yes | PASS |
| Create league 3 | Rounds stepper + | Stepper | 6 to 7 | 7 | PASS |
| Create league 3 | Draft time row | SettingRow onPress setShowDatePicker(true) | date sheet | date sheet (Draft time) opened | PASS |
| Draft time sheet | Set draft time | components/game/DraftDateSheet.tsx Button onPress run({type:'confirm'}) | sheet closes, row shows the time | "Fri, Oct 16 · 3:15 PM ET" | PASS |
| Draft time sheet | Set later | DraftDateSheet Pressable onPress run({type:'set_later'}) | row back to TBD | TBD | PASS |
| Draft time sheet | x (close) | DraftDateSheet Pressable onPress run({type:'dismiss'}) | closes, no change | closed, TBD unchanged | PASS |
| Create league 3 | Next | goNext | step 4 | step 4 Stakes | PASS |
| Create league 4 | Stake rows (Budget cap, Price tiers, Equal stakes) | ChoiceRow onPress patch({stakeMode}) | check moves, matching controls appear | budget field and chips; slot builder; stake per slot | PASS |
| Create league 4 | Budget chip $5,000 | Chip onPress patch({budgetCap}) | field reads 5000 | 5000 | PASS |
| Create league 4 | Allow non-draftable switch | SwitchRow onValueChange | toggles | toggled | PASS |
| Slot builder | Add slot | components/SlotBuilder.tsx Button onPress=addSlot | slot 1 appears | slot 1 appeared | PASS |
| Slot builder | Category row | SettingRow onPress setCategoryPickerFor(i) | category sheet | sheet opened (only Any (flex) listed: categories come from the server) | PASS |
| Slot builder (category sheet) | Any (flex) | ChoiceRow onPress pick('') | picks and closes | closed, Any (flex) | PASS |
| Slot builder (category sheet) | a category row | ChoiceRow onPress pick(c.id) | picks and closes | no category rows without the server | UNREACHABLE (categories load from the server) |
| Slot builder | Check availability | Button onPress=checkFeasibility | result or note | BEFORE: the note "Stock data is still loading…" when the symbols read FAILED (finding F2). AFTER the fix: "Could not check availability — try again." | PASS after fix F2 |
| Slot builder | Remove slot x | Pressable onPress removeSlot(i) | slot removed | slot removed, reason line returns | PASS |
| Create league 4 | Create league (price tiers, no slot) | app/create-league.tsx Button onPress=goNext disabled=blocked | disabled with the reason beside it | greyed, red line "Price tiers need at least one slot with a price range." | PASS (disabled with its reason) |
| Create league 4 | Create league (valid, dead backend) | goNext | creates (needs the server) | alert "The league wasn't created. Check your connection, then try again." | PASS (failure is visible; the success path is covered with CREATE_FIXTURE) |
| Create league 3 | Back | components/game/SetupScaffold.tsx Pressable onPress=back.onPress | previous step | step 3 | PASS |
| Create league 1 | Cancel | app/create-league.tsx SetupScaffold back.onPress | leaves the wizard | back to Home | PASS |
| Create league 4/3/2 | Back (x3) | SetupScaffold back.onPress | previous step each time | step 3, 2, 1 | PASS |
| Home (live_open) | Range pill 1W | components/home/HomeSeason.tsx RangePills onChange=setWindow | chart window changes | 1W chart (Sep 21 to Sep 24) | PASS |
| Home (live_open) | Range pill 1M | RangePills onChange | chart window changes | 1M chart | PASS |
| Home (live_open) | Range pill Season | RangePills onChange | chart window changes | Season chart | PASS |
| Home (live_open) | This week card | components/home/ThisWeekCard.tsx PressableScale onPress router.push(THIS_WEEK_HREF) | Matchup tab | Matchup | PASS |
| Home (live_open) | Standings card | components/home/StandingsCard.tsx PressableScale onPress router.push(STANDINGS_HREF) | League on Standings | League, Standings segment | PASS |
| Matchup | All matchups / My matchup segments | app/(tabs)/matchup.tsx SegmentedControl onChange | switches list | both directions switch | PASS |
| Matchup | Roster row (NVDA) | components/sp/gn/RosterRow.tsx PressableScale onPress=half.onPress | player card | player card sheet | PASS |
| Player card | Sell | components/sp/gn/PlayerCard.tsx PressableScale onPress=action.onPress | sell flow | trade sheet on the Sell tab | PASS |
| Trade sheet | Range pills (3M) | components/money/StockChart.tsx RangePills onChange=setRange | chart range changes | 3M | PASS |
| Trade sheet | Buy / Sell segments | components/money/StockSheetBody.tsx SegmentedControl onChange=setChoice | switches | Buy: Review buy disabled with "You already hold this stock."; Sell restored | PASS (disabled with its reason) |
| Trade sheet | Review sell | StockSheetBody Button onPress openReview | review panel | "Review sell" panel | PASS |
| Review panel | Sell NVDA | components/money/TradeReviewPanel.tsx Button onPress=onSubmit | submits (seam answers locally) | "Sold NVDA" confirmation | PASS (seam; a real trade is UNREACHABLE) |
| Review panel | Done | TradeReviewPanel Button onPress=onDone | closes the sheet | sheet closed, Matchup | PASS |
| Tab bar | League / Portfolio / Home | components/shell/ShellTabBar.tsx TabItem onPress | tab opens | each opened | PASS |
| League | Segments Schedule / History | app/(tabs)/league.tsx SegmentTabs onChange=setSegment | segment switches | both switched | PASS |
| League pill | League pill | components/shell/LeaguePill.tsx PressableScale onPress=openLeagueSheet | league sheet | "Your leagues" sheet | PASS |
| League sheet | League row (Friday Night Stocks) | components/shell/LeagueSheetRow.tsx PressableScale onPress=onPick | switches the active league, sheet closes | pill reads Friday Night Stocks | PASS |
| League sheet | Join with code | components/shell/LeagueSheet.tsx Button onPress=onJoin | Join a league | Join a league | PASS |
| League sheet | Create league | LeagueSheet Button onPress=onCreate | Create league step 1 | step 1 | PASS |
| Join a league | Find league (empty code) | app/join-league.tsx Button onPress=find disabled=!trimmed | disabled, the intro line says what is needed | greyed, intro line above "Enter the invite code your commissioner sent you." | PASS (disabled with its reason) |
| Join a league | Find league (typed code, dead backend) | find | preview or an error | "Couldn't reach the league. Check your connection, then try again." | PASS |
| Join a league | Your leagues (back) | components/shell/AuthScaffold.tsx Pressable onPress=back.onPress | previous screen | League tab | PASS |
| Header | Avatar | components/shell/ShellHeader.tsx Pressable onPress router.push('/profile') | Profile | Profile | PASS |
| Profile | Username row | components/shell/ProfileView.tsx Row onPress=onUsername | username editor | Pick a username (edit) | PASS |
| Username editor | Cancel | app/username.tsx UsernamePickerExit onPress=back | Profile | Profile | PASS |
| Profile | Change password row | ProfileView Row onPress=onChangePassword | Set a new password | Set a new password | PASS |
| Change password | Update password (empty) | components/shell/NewPasswordForm.tsx Button onPress=handleUpdate disabled | disabled with the rules above it | greyed, checklist of rules directly above | PASS (disabled with its reason) |
| Change password | Update password (valid) | NewPasswordForm handleUpdate | updates the password | needs a real session | UNREACHABLE (real session) |
| Profile | Appearance row | ProfileView Row onPress=onAppearance | Appearance | Appearance | PASS |
| Appearance | Dark / Light / System | components/shell/AppearancePicker.tsx ThemeOption onPress=changeAppearance | theme changes | Dark, Light and System each applied | PASS |
| Profile | How it works row | ProfileView Row onPress=onHowItWorks | sheet | How it works sheet | PASS |
| How it works sheet | x | components/shell/HowItWorksSheet.tsx Pressable onPress=onClose | closes | closed | PASS |
| Profile | Back (labelled Home) | app/profile.tsx back.onPress router.back() | Home (by its label) | returned to League, where I came from: finding F3 | PASS with finding F3 |
| Portfolio | Range pill 1W | components/money/PortfolioScreen.tsx RangePills onChange=setRange | chart range changes | 1W | PASS |
| Portfolio | Buy a stock row | PortfolioScreen Pressable onPress router.push('/stock-search') | Buy a stock | search screen | PASS |
| Buy a stock | Search row (NVDA) | components/money/StockSearchScreen.tsx SearchRow onPress=handleSelect | stock sheet | stock sheet | PASS |
| Stock sheet | x | StockSheetBody Pressable onPress=onClose | closes | closed | PASS |
| Buy a stock | Portfolio (back) | StockSearchScreen Pressable onPress router.back() | Portfolio | Portfolio | PASS |
| Portfolio | Holding row (NVDA) | PortfolioScreen HoldingRow onPress=openRow | stock sheet | stock sheet with Sell | PASS |
| Portfolio | Trade history row | PortfolioScreen Pressable onPress router.push('/trade-history') | Trade history | Trade history | PASS |
| Trade history | Filter segments (Sells) | components/money/TradeHistoryScreen.tsx SegmentedControl onChange=choose | filters | "No trades yet..." for Sells | PASS |
| Trade history | Portfolio (back) | TradeHistoryScreen Pressable onPress router.back() | Portfolio | Portfolio | PASS |
| Home (no-leagues) | Join with a code | components/shell/NoLeagueState.tsx PhasePlaceholder onSecondaryAction router.push('/join-league') | Join a league | Join a league | PASS |
| No-league state (Matchup, League, Portfolio, Home) | State shown on all four tabs | components/shell/NoLeagueState.tsx | "No leagues yet" with both buttons on every tab | all four tabs show it (part 1's blank Matchup is resolved) | PASS |
| Matchup (no-leagues) | Create a league | NoLeagueState PhasePlaceholder onAction router.push('/create-league') | Create league step 1 | step 1 | PASS |
| Tab bar (no-leagues) | Matchup tab | ShellTabBar TabItem onPress | tab opens | opened | PASS |
| Profile | Sign out | ProfileView Row onPress=onSignOut | signs out to Login | Login | PASS |
| Invite arrival (found) | Use email | components/shell/InviteArrival.tsx Button onPress router.push('/create-account') | Create account | Create account | PASS |
| Invite arrival (full) | Sign in | InviteArrival Pressable onPress router.push('/login') | Login | Login | PASS |
| Invite arrival (unavailable) | Try again | InviteArrival Pressable onPress=invite.retryPreview | re-asks for the preview | handler runs (dev log "invite fixture: retryPreview()"), fixture shows no visible change | PASS (handler); the visible re-ask is UNREACHABLE (needs the server) |
| Invite arrival (unavailable) | Continue with Google | components/shell/SocialSignIn.tsx | fixture refusal line | refusal line shown | PASS (fixture) |
| Username gate | Change | components/shell/UsernamePicker.tsx Button onPress=startEditing | field takes focus with the rules | editing mode with Continue | PASS |
| Username gate | Continue (edited) | UsernamePicker Button onPress=onContinue | saves and enters the app | Home | PASS |
| Username gate (taken name) | Continue (taken) | UsernamePicker Button disabled=!view.canContinue | disabled with the reason beside it | greyed, "This username is already taken." | PASS (disabled with its reason) |
| Username gate (taken name) | Suggestion chip roberto_1 | UsernamePicker Chip onPress=onChange | field fills and checks | field "roberto_1" with a check | PASS |
| Username gate | Sign out | app/pick-username.tsx UsernamePickerExit onPress=signOut | Login | Login | PASS |
| Create league (done screen) | Share | app/create-league.tsx Button onPress=share() | iOS share sheet with the code | share sheet "Join my league with code SERIEA7" | PASS |
| Create league (done screen) | Go to the league (push ask due) | create-league Button onPress pushAskRouteFor(...) | push pre-prompt | push pre-prompt | PASS |
| Push pre-prompt | Not now | components/shell/PushPrePrompt.tsx Pressable onPress=onNotNow | league, never asked again | League | PASS |
| Push pre-prompt | Continue | PushPrePrompt Button onPress=onContinue | asks iOS and moves on | League (no iOS prompt: a simulator has no push token, as the capture knob notes) | PASS |
| Login (confirm-failed line) | x on the line | components/shell/ConfirmedEmailNotice.tsx Pressable onPress setConfirmFailedNotice(false) | line dismissed | dismissed | PASS |
| Login | Resend (the unconfirmed-email resend) | app/login.tsx Pressable onPress=handleResend | re-sends the confirmation | only appears after the server answers "email not confirmed" | UNREACHABLE (needs a real account state) |
| Username gate (email confirmed) | Keep | UsernamePicker Button onPress=onContinue | saves and enters the app | Home | PASS |
| Home (pre_draft, at_risk) | First-time tip x | components/shell/FirstTimeTip.tsx Pressable onPress=dismissTip | tip closes | closed, card below moves up | PASS |
| Home (pre_draft, at_risk) | Move forward with 7 | components/game/DraftBlockersCard.tsx Button onPress=onReconfirm('move_forward') | calls the server, re-reads | tapped; the seam re-reads its fixed state, so no visible change is possible | TAPPED, EFFECT UNVERIFIABLE in a fixture (needs a real-server tap) |
| Home (pre_draft, at_risk) | Invite someone new | DraftBlockersCard Button onPress=onReconfirm('invite') | calls the server, re-reads | same as above | TAPPED, EFFECT UNVERIFIABLE in a fixture |
| Home (pre_draft, at_risk) | Playoff teams stepper - | DraftBlockersCard via useDraftAutoStart.setPlayoffTeams | saves the new count | stays at 8 (the seam's league row is static) | TAPPED, EFFECT UNVERIFIABLE in a fixture |
| Home (pre_draft) | Build your queue | components/home/PreDraftCard.tsx Button onPress router.push('/(tabs)/league') | League tab | League tab at the queue | PASS |
| League (pre-draft) | Queue up / down / remove | components/game/QueueEditor.tsx Pressable onPress setQueue | reorders / removes | up, down and remove all acted; Save queue appeared with "Not saved yet." | PASS |
| League (pre-draft) | Save queue | QueueEditor Button onPress=save | saves to the server | dispatched to the seam; the fixture re-reads its fixed queue | TAPPED, EFFECT UNVERIFIABLE in a fixture |
| League (pre-draft) | Queue search field | components/SymbolSearchField.tsx + lib/useSymbolSearch.ts | results appear | BEFORE: spinner for 45 s and never resolved (finding F1). AFTER the fix: "No matching stocks found" / the fixture's results | PASS after fix F1 |
| League (pre-draft) | Search result row (AMD) | QueueEditor SymbolSearchField onSelect | added to the queue, field clears | "4 OF 50", AMD added | PASS |
| League (pre-draft) | League settings row | app/(tabs)/league.tsx SettingRow onPress router.push('/league-settings') | League settings | League settings | PASS |
| League settings | Pick clock 30s | app/league-settings.tsx SegmentedControl onChange=setPickSeconds | selects 30 | 30 seconds | PASS |
| League settings | Draft time row | league-settings SettingRow onPress setShowDatePicker(true) | date sheet | Draft time sheet (same sheet as the wizard) | PASS |
| League settings | Save changes | league-settings Button onPress=handleSave | saves, confirms | alert "Success / League settings updated", OK returns to League | PASS |
| League settings (member) | Share (invite) | app/league-settings.tsx Button onPress Share.share(...) | share sheet | "Join my league with code SCUD26" | PASS |
| League settings (member) | Leave league row | league-settings LeaveLeagueRow onPress setLeaveOpen(true) | confirm sheet | "Leave Serie A Traders?" sheet | PASS |
| Leave sheet | Stay | components/game/LeaveLeagueSheets.tsx Button onPress=onStay | closes, nothing changes | closed | PASS |
| Leave sheet | Leave league (confirm) | LeaveLeagueSheets Button onPress=onLeave | leaves (seam answers "left") | returned Home; the seam's league list is static so the league remains | PASS (navigation); the list change is UNVERIFIABLE in a fixture |
| League settings (commissioner, locked) | Leave league row (locked) | components/game/LeaveLeagueSheets.tsx Pressable onPress={view.enabled ? onPress : undefined} disabled=!view.enabled | inert, with its reason | greyed, "Teams are locked in from an hour before the draft until the season ends."; tapping does nothing | PASS (disabled with its reason) |
| League settings (commissioner) | Transfer commissioner row + sheet rows (ChoiceRow, Transfer, close) | league-settings SettingRow onPress setTransferOpen(true); LeaveLeagueSheets ChoiceRow/Button | transfer sheet | the row only appears for a commissioner whose league has an OPEN leave window; no fixture combines the two | UNREACHABLE (no fixture) |
| League settings | Cancel | app/league-settings.tsx | back to League | League | PASS |
| Home (member, pre-draft) | Invite Share (Members card) | components/home/PreDraftCard.tsx Button onPress=onShare | share sheet | share sheet | PASS |
| Home (drafting) | Go to the draft room | components/home/DraftingCard.tsx Button onPress router.push('/(tabs)/league') | League with the room | draft room | PASS |
| Draft room | Search field + result row (ABNB) | components/game/DraftRoom.tsx SymbolSearchField onSelect | result selected, Draft appears | "ABNB" selected, Draft button | PASS |
| Draft room | Draft (pick) | DraftRoom Button onPress=draft disabled=pending | pick recorded | selection cleared; the room's roster can't change in a fixture | PASS (dispatched); the pick landing is UNVERIFIABLE in a fixture |
| Draft room (failed) | Try again | DraftRoom Button onPress=room.refresh | re-reads the room | two "[game:draft-room] failed fixture" log lines (initial read + the retry); the fixture re-fails by design | PASS (handler); no visible change by design |
| Draft room (complete) | See your Week 1 matchup | components/game/DraftComplete.tsx Button onPress=onSeeMatchup | Matchup tab | Matchup tab ("Not started yet": the fixture's league is still drafting) | PASS |
| Draft room (complete) | Retry finish | DraftComplete Button onPress=onRetryFinish | only shown when finalizing failed | only appears after a finalize failure | UNREACHABLE (needs a failing finalize) |
| Matchup (drafting) | League pill in the page body | components/shell/LeaguePill.tsx | league sheet | league sheet | PASS |
| League sheet | x / backdrop | components/shell/LeagueSheet.tsx Pressable onPress=onClose (x2) | closes | both closed it | PASS |
| Home (season complete) | See the final standings | components/home/SeasonCompleteCard.tsx ListRow onPress router.push('/(tabs)/league') | League (Final standings) | Final standings | PASS |
| League (season complete) | Playoffs segment | app/(tabs)/league.tsx SegmentTabs onChange | bracket | bracket by round | PASS |
| Home (renewal, commissioner) | Run it back | components/home/RunItBackCard.tsx Button onPress=runItBack | renewal roster (League) | renewal roster | PASS |
| Renewal roster | Nudge again / Remove (name row) | components/game/RenewalRoster.tsx Pressable onPress=runSheet(p) | sheet with Nudge again / Remove | sheet "Andrea P. hasn't replied" | PASS |
| Renewal roster sheet | Nudge again | RenewalRoster sheet action | nudges, sheet closes | closed; the fixture row can't change | TAPPED, EFFECT UNVERIFIABLE in a fixture |
| Home (renewal, member pending) | I'm in | components/game/RenewalAsk.tsx Button onPress=answer(response) | records the answer | "You're running back" with Change | PASS |
| Renewal roster | Change link | components/game/RenewalRoster.tsx Pressable onPress=setChanging(true) | change sheet | sheet "Paolo M. is running it back. Are you in?" | PASS |
| Renewal change sheet | x | components/game/RenewalChangeSheet.tsx Pressable onPress=onClose | closes | closed | PASS |
| Renewal change sheet | I'm out | RenewalAsk Button onPress=answer | records the answer | "YOU'RE OUT" with the check on I'm out | PASS |
| Renewal review (commissioner) | Draft row | components/game/RenewalReview.tsx Row onPress=setEditingDate | date picker | inline date and time chips | PASS |
| Renewal review | Date chip + calendar day (Oct 20) | RenewalReview DateTimePicker onChange | sets the draft time | "Draft: Tue, Oct 20" | PASS |
| Renewal review | Draft order Manual / Pick clock 90s | RenewalReview SegmentedControl onChange | selects | selected | PASS |
| Renewal review | Season stepper (down) | RenewalReview Stepper Pressable onPress | 14 to 13 weeks | 13 weeks | PASS |
| Renewal review | Playoffs stepper (+/-) | RenewalReview Stepper Pressable | changes the count | same component as the Season stepper (tapped there) | PASS (same component) |
| Renewal review | Schedule the draft (no date) | RenewalReview Button onPress=schedule disabled=!enabled | disabled with a reason | greyed with no line saying why (finding F4); enables once a future date is picked | FINDING F4 (disabled without a visible reason) |
| Renewal review | Schedule the draft (date set) | RenewalReview Button onPress=schedule | schedules | dispatched; the form returned to its initial state (the fixture's league does not advance) | TAPPED, EFFECT UNVERIFIABLE in a fixture |
| Join a league (preview) | Join {league} | app/join-league.tsx Button onPress=primary.onPress (join) | Joined screen | "You're in Serie A Traders" | PASS |
| You're in | Go to the league | app/join-league.tsx Button onPress=onContinue | league Home | Home | PASS |
| Join (preview, full) | Try another code | join-league Button onPress=primary.onPress (backToCode) | code entry | code entry | PASS |
| Join (preview, left the league) | Join (disabled) | join-league Button disabled={view.action==='join_disabled'} | disabled with the reason | greyed, the warn panel above: "You left Serie A Traders this season, so you can't rejoin it…" | PASS (disabled with its reason; verified on the device, part 1 only argued it) |
| Join (preview, member) | Open the league | join-league Button onPress=primary.onPress (open) | opens the league | Home | PASS |
| Home (leagues-failed-once) | Try again (Home) | components/shell/PhasePlaceholder.tsx EmptyState onAction=onAction (refresh) | re-reads leagues, Home loads | Home loaded | PASS |
| League (leagues-failed-once) | Try again (League) | app/(tabs)/league.tsx PhasePlaceholder onAction=refresh | re-reads, League loads | League loaded | PASS |
| Home (pre_draft, postponed) | Pick a new draft time (blocked) | components/game/DraftBlockersCard.tsx Button onPress=onPickNewTime disabled=blocked\|\|busy | disabled with the reason | greyed with "Fix these first. The new time needs at least an hour's notice." beneath | PASS (disabled with its reason) |
| Home (pre_draft, no date) | Set draft time | components/home/PreDraftCard.tsx Button onPress=setPicking(true) | draft-time sheet | Draft time sheet (no Set later; same sheet) | PASS |
| Draft time sheet (Home) | Set draft time / x | components/game/DraftDateSheet.tsx | saves / closes | closed; the save goes to the seam | PASS (x); the save UNVERIFIABLE in a fixture |
| Buy a stock (search_fail) | Try again | components/money/StockSearchScreen.tsx LoadFailure onRetry=retry (lib/money/useMoneyStockSearch.ts) | re-runs the search | BEFORE: a silent no-op (the NOOP I waived in part 1). AFTER: logs "[dev] money search fixture: retry()" | PASS after the small fix (dev fixture only) |
| Buy a stock | Search result then stock sheet (stress) | StockSearchScreen SearchRow onPress=handleSelect | stock sheet over the previous screen (the search closes by design) | sheet over Home | PASS |
| Stock sheet (S002, owned by another) | Review buy (disabled) | components/money/StockSheetBody.tsx Button disabled=!(canReview&&gate.open) | disabled with the reason | greyed, "Manager Number 02 owns S002. A stock has one owner per league." above it | PASS (disabled with its reason) |
| Stock sheet (S001, unpriced) | Review sell (disabled) + Try again link | StockSheetBody Button disabled; Pressable onPress=data.refresh | disabled with the reason; retry re-reads | greyed, "We can't price this stock right now. Try again shortly." beside it; the retry re-reads the fixture, which stays unpriced | PASS (reason shown); retry EFFECT UNVERIFIABLE in a fixture |
| Stock sheet (buy, free stock) | Review buy, the buy review panel | StockSheetBody / TradeReviewPanel | review of a buy | every stock in the stress fixture is owned by someone | UNREACHABLE (no free stock in the fixture) |
| Review panel (stress S049) | Edit | components/money/TradeReviewPanel.tsx Pressable onPress=onBack | back to the sheet | the sheet | PASS |
| Review panel (conflict) | Sell S049 then Try again | TradeReviewPanel Button onPress=onSubmit, onRetry | "Nothing was traded..." then Try again re-reviews | conflict notice with a Try again button; Try again returned to Review sell | PASS |
| Review panel | Next-step button (onNextStep) | TradeReviewPanel Button onPress={() => onNextStep(nextStep)} | only shown after a successful sell that frees a slot | not shown in the conflict scenario | UNREACHABLE (needs the `ok` scenario with a free slot) |
| Stock sheet / Trade review | Sale picker (rows, Use, close) | components/money/SalePicker.tsx | choose which lot to sell | only shown for a stock with several buy lots; no fixture has one | UNREACHABLE (no fixture) |
| Home (eliminated) | See the bracket | app/(tabs)/index.tsx PhaseMessageCard onAction | League on the bracket | BEFORE: League on Standings (finding F6). AFTER the fix: the bracket | PASS after fix F6 |
| Unknown route | Go to Home | app/+not-found.tsx Button onPress=goHome | Home | Home | PASS |
| reset-password (dead link) | Request a new link | app/reset-password.tsx EmptyState onAction router.replace('/forgot-password') | Forgot password | Forgot password | PASS |
| Forgot password | Back to sign in (top) | components/shell/AuthScaffold.tsx Pressable onPress=back.onPress | Login | Login | PASS |
| reset-password (dead link) | Back to sign in / Cancel / form Cancel | app/reset-password.tsx handleCancel; NewPasswordForm onCancel | Home or Login | same wiring as Back to sign in (router.replace); the form variant needs a recovery session | UNREACHABLE for the form variant (real recovery session) |
| Home (calm states) | Bye / missed-playoffs cards | components/home/PhaseMessageCard.tsx | no action | no tappable (only the eliminated variant has a button) | n/a |
| Player portfolio route | any control | app/player-portfolio.tsx + components/money/PlayerPortfolioScreen.tsx | opens from somewhere | NOTHING navigates to this route (finding F5) | UNREACHABLE (no entry point) |
| League (load failed) | LeagueStates Try again | components/league/LeagueStates.tsx Button onPress=onRetry | re-reads league data | needs a failed league-data read; no fixture fails only that read | UNREACHABLE (no fixture) |
| Matchup (load failed) | LoadFailure retries (x4) | app/(tabs)/matchup.tsx LoadFailure onRetry | re-reads | needs a failed matchup/roster read; no fixture | UNREACHABLE (no fixture) |
| Renewal (load failed) | Try again | components/game/LeagueRenewal.tsx Button onPress=setRetry | re-reads the roster | needs a failed renewal read | UNREACHABLE (no fixture) |
| Home (season 2 renewed) | See league (RenewalCountsCard) | components/home/RenewalCountsCard.tsx Button onPress router.push('/(tabs)/league') | League | card only shows for a renewed Season 2 whose Home is the counts state; the seam league list is static after Run it back | UNREACHABLE (state not reachable) |
| Create account (after a real sign-up) | Check-your-email card: Back / Resend | components/shell/ConfirmEmailSent.tsx | back / resend the confirmation | only shown after a real sign-up succeeds (the fixture answers with the signups-paused refusal) | UNREACHABLE (real sign-up) |
| Draft room | Draft board tiles | components/sp/gn/DraftTile.tsx | none (not tappable) | tiles are views, not controls | n/a |
| Shared primitives (sp/Button, Chip, EmptyState, ListRow, SegmentedControl, RangePills, SegmentTabs, ManagerRow, RosterRow, PlayerCard) | their own onPress | components/sp/* | call the caller's handler | each exercised through its call sites above | PASS (via call sites) |
