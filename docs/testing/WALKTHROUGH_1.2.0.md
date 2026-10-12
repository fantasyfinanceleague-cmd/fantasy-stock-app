# 1.2.0 walkthrough on your phone

One pass through the release build with your real account, before the cut. Each item says where
to go, what you need for it, and what right looks like. Tick it when it does that.

**Before you start**

- Use the release build and your own account. The test switches used in development aren't in a
  release build, so every step here uses real leagues.
- Some steps need the market open (Monday to Friday, 9:30 AM to 4:00 PM ET). They say so.
- **[2+ accounts]** marks a step that needs other people (or other test accounts) in the league.
- A trade here is a real trade in that league. Use a test league for the selling steps.

## Home

- [ ] **1. Your name stands out.** Home, a league in season, the standings. Right: your row has a
  light-blue background and your name is bold; everyone else's name is regular weight; nowhere
  says "(you)".
- [ ] **2. Other players have names again.** Home, League standings, Matchup, and a finished
  draft's results. Right: every other manager shows their name (1.1.0 showed "Unknown").
- [ ] **3. The season chart stays put.** Home, during market hours; leave it open for a few
  minutes. Right: the line updates where it is. It never disappears and redraws from nothing.

## Portfolio and trading (market open)

- [ ] **4. Selling something you own.** Portfolio, tap a holding. Right: the sheet opens on Sell,
  already selected, with "Sell all … sh ≈ $…".
- [ ] **5. The same from search.** Portfolio › Buy a stock, search a stock you own. Right: the row
  says "You own this" in your colour; tap it and the sheet opens on Sell, the same as from
  Portfolio.
- [ ] **6. No Sell on what you don't own.** Buy a stock, search a stock nobody owns, then one
  another manager owns. Right: neither sheet has a Buy / Sell switch, only the buy button. The
  one another manager owns says "Owned by {name}" and won't let you buy.
- [ ] **7. A sale, start to finish.** Test league: Sell › Review sell › Sell. Right: the review
  shows the whole position and the price; after Sell you see "Sold {stock}"; back on Portfolio
  that slot shows its cash, ready to invest.
- [ ] **8. Holdings re-order smoothly.** Portfolio during market hours, or right after a trade,
  when two holdings swap places by value. Right: the rows slide to their new places; they don't
  jump.

## Draft room [2+ accounts: a league needs 4 real managers to draft]

- [ ] **9. Your turn is unmissable.** In the draft room when your pick comes up. Right: the phone
  buzzes, a short chime plays, the clock card flashes gold twice and then stays highlighted with
  "You're on the clock" as the biggest text on the screen.
- [ ] **10. Silent mode and music.** Silent mode on for one of your turns; music playing for
  another. Right: in silent mode it buzzes but makes no sound; with music, the chime plays over it
  and the music keeps going.
- [ ] **11. Ten seconds left.** Let your clock run down. Right: one more buzz at 10 seconds and
  the clock turns red.
- [ ] **12. Your turn while you're elsewhere.** Sit on the Home tab when your pick comes up.
  Right: a banner tells you it's your turn (with your phone's usual notification sound). Open
  the draft room and the clock is already highlighted, "You're on the clock".

## Matchup

- [ ] **13. Switching leagues.** Matchup during a live week, then switch leagues with the pill at
  the top. Right: the scores belong to the new league straight away. They never count up from the
  old league's number. Both scores are the same size.
- [ ] **14. A week you won.** Matchup after Friday's close, or a finished week you won. Right: a
  blue band "{You} wins Week N" with "W · {record}" on the right; under the score, "{You} won by
  $…". Every card in All matchups says "won by" (none says "leads by").
- [ ] **15. A week you lost.** A finished week you lost. Right: a grey band "{Opponent} wins Week
  N" with "L · {record}"; "won by" names them; both line-ups show under the score. If a week ever
  ends in a tie: "Tied in Week N", "T · {record}", and "Tied".
- [ ] **16. A slow connection.** Turn Wi-Fi and mobile data off, open Matchup, then All matchups.
  Right: grey placeholder shapes while it waits (never a blank screen); All matchups says it
  didn't load, with Try again. Turn data back on and Try again works.

## League (one of the finished test leagues)

- [ ] **17. Final standings.** League › Standings on a finished season. Right: "Final standings ·
  After the playoffs"; the champion first with gold and "Champion", the runner-up second with
  silver and "Runner-up", then bronze; no up/down arrows.
- [ ] **18. The bracket.** League › Playoffs. Right: each game's winner is in bold; your own line
  has the light-blue background (bold only where you won).
- [ ] **19. History.** League › History, the same season. Right: the same order, medals,
  "Champion" and "Runner-up", and "After the playoffs".
- [ ] **20. Large text.** iPhone Settings › Accessibility › Display & Text Size › Larger Text: turn
  on Larger Accessibility Sizes and drag to the largest. Right: the League tabs (Standings ·
  Schedule · Playoffs · History) and the Matchup tabs read in full, with nothing cut off with
  "…".

## Join a league [another account, or a friend's code for a league you're not in]

- [ ] **21. A preview names nobody.** Join with a code for a league you're not in. Right: the
  preview shows the league's name, managers, draft time, stakes and season, and no "Run by …". If
  the league is full: "… Ask your commissioner if they can make room."

## Run it back: only if the switch is ON [2+ accounts, a finished league]

- [ ] **22. The ask.** As commissioner, start Run it back on a finished league. Right: each
  member gets "{your name} is running it back. Are you in?" on that league's Home and League tab.
- [ ] **23. In, and changing your mind.** As a member, tap I'm in. Right: you land on "You're
  running back · Change" with the list of answers and no draft card. Change lets you switch; once
  the draft is set, Change is gone.
- [ ] **24. Out, and coming back.** As a member, tap I'm out. Right: the finished league's Home
  keeps the card with "You're out" and I'm out ticked; tapping I'm in brings you back in.
- [ ] **25. The draft waits for everyone.** As commissioner, while someone hasn't answered: Home
  shows the counts ("Waiting on {name}") and no Set draft time, but Members and the invite code
  are still there. Once the last person answers, Set draft time appears.
