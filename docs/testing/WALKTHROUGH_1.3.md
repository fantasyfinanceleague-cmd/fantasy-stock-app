# 1.3 walkthrough on your phone

One pass through the 1.3 build with your real account, before it goes to anyone else. Each item says
where to go, what to do, and what right looks like. Tick the box when it does that. If it doesn't,
write down what you saw (the last section says what to note) and move on.

It is grouped so you can do it in one sitting: reading aloud first, then the biggest text size, then
the things that save to the server, then two things to keep an eye on, and **sign-in and invite
links last**, because those need the launch-prep steps in the Supabase and Apple dashboards done first.

**Before you start**

- Use the 1.3 build on your own phone (TestFlight, or the dev build) with your own account. The test
  switches used in development aren't in it, so every step uses real leagues.
- You'll need **a test league** you can mess with (the selling and saving steps change it), and a
  few steps need **a second account or a friend** in the league. **[2+ accounts]** marks those.
- Some steps need the market open (Monday to Friday, 9:30 AM to 4:00 PM ET). They say so.
- **⚙** marks a step that needs the launch-prep dashboard work done first (the list is above the
  last section). Don't start those until it is.
- **Turning VoiceOver on and off:** Settings › Accessibility › VoiceOver. Easiest: set
  Settings › Accessibility › Accessibility Shortcut to VoiceOver, then triple-click the side
  button to turn it on or off. With it on, swipe right or left to move to the next or previous
  thing, and double-tap to press it.
- **The biggest text size:** Settings › Accessibility › Display & Text Size › Larger Text. Turn on
  **Larger Accessibility Sizes**, then drag the slider all the way right. Put it back when you finish
  that section.

## 1. VoiceOver (turn it on)

- [ ] **1. Home's standings card.** Home, a league in season with other managers. Start at the top
  of the standings card and swipe right one thing at a time. Right: the card's header reads first.
  Then each manager's row reads what's on it (their place, name, record and so on), then the word
  **"button"**, then **"View {name}'s team"**. Your own row ends with **"View your portfolio"**.
  Double-tap a row: it opens that manager's team (yours opens your portfolio).
- [ ] **2. The Matchup scoreboard.** Matchup, a week with a live or finished matchup. Swipe onto the
  scoreboard. Right: each half (you, then your opponent) reads its name and total, then
  **"button"**, then **"View {name}'s team"** (yours: **"View your portfolio"**). Double-tap opens
  it.
- [ ] **3. An amount on the Join preview.** The league pill at the top › **Join with code**, and
  type the code of a league you're not in **[2+ accounts: a code from another account]**. On the
  preview, swipe to one dollar amount (the stakes). Right: it reads like ordinary money, as one
  amount. It does not spell out the digits one by one or stutter.
- [ ] **4. An amount in Trade history.** Portfolio › **Trade history**. Swipe to one row's amount.
  Right: it reads as ordinary money, the same as the Join preview.

Turn VoiceOver off before the next section.

## 2. The biggest text size

Set it now (see above): Larger Accessibility Sizes on, slider all the way right. In this section,
"pinned" means the main button stays at the bottom of the sheet while the rest scrolls, and "the
fade" is a soft fade over the last line just above that button, showing only while there is more to
scroll to. At the very end of the scroll the fade is gone. **Nothing should ever be cut off with
"…"**, and no word or amount should break in the middle.

- [ ] **5. The trade review, and the sell sheet** *(market open)*. Portfolio › Buy a stock › a stock
  you're allowed to buy (nobody owns it, and you have a free slot or the cash) › **Review buy**. Right: the review's labels ("Buy", "Price", "Paid from", "Left in
  the slot") are whole words; every amount is whole on its own line; the big button ("Buy …") is on
  screen. Then Portfolio › tap a stock you own. Right: the sheet opens on **Sell**; its top part
  scrolls under the **Review sell** button, which stays put with the fade above it; scroll to the
  end and the fade goes. Tap **Review sell**: the review opens with its button reachable. Back out
  without trading.
- [ ] **6. The sale picker.** You need a league where each slot has a fixed amount, and you've sold
  **two or more** stocks (a test league: sell two). Portfolio › Buy a stock › a stock › **Review
  buy**. Right: **"Which sale pays for this?"** lists your sales; the **"Use …"** button is pinned
  at the bottom and reachable; if the list is long it scrolls under the button with the fade.
  Pick one and the review opens. Back out.
- [ ] **7. The Renewal change sheet.** You need a finished league that was run back (Run it back)
  where you answered **I'm in**, and the draft isn't set yet **[2+ accounts]**. Home or League: the
  **"You're running back"** banner with **Change**. Tap Change. Right: the sheet shows the
  question; the **I'm out / I'm in** buttons and the line under them stay pinned at the bottom and
  reachable. Tap the answer you already have: the sheet closes and nothing changes.
- [ ] **8. The Transfer commissioner sheet.** You need to be the commissioner of a league that
  hasn't passed an hour before its draft (or whose season is over). League settings › the
  **Commissioner** row (it says "You"). Right: **"Make someone else commissioner"** opens; the
  list of managers scrolls if it's long; **Hand over** and **Cancel** are pinned and reachable; no
  one is picked until you pick; once you do, the button names them. Tap **Cancel** (don't hand
  over, unless it's a test league and you mean to).
- [ ] **9. Pre-draft Home with Share showing.** A league that hasn't drafted, with a draft time
  set that's **more than an hour away** (Share hides from the hour before). Home. Scroll to the
  **Members** card. Right: **"Members"** has **"6 of 8 joined"** (your numbers) under it, whole,
  not running off the edge; the dashed **"+2"** circle shows its whole text; the invite code row
  has the code **and a Share button** beside or under it, nothing cut off. Tap **Share**: the
  share sheet opens with "Join my league with code …" and a link.
- [ ] **10. Back to normal.** Put the text size back where you like it. Right: Home and Portfolio
  look as they did before.

## 3. Things that save to the server

The simulator can't show these actually saving. Each says what to tap and what should change.
Use a test league. A few need a second account to be the manager who does something.

- [ ] **11. Move forward.** **[2+ accounts]** In a league that hasn't drafted, with a draft time
  set, have another manager open League settings › **Leave league** (allowed until an hour before
  the draft) and leave. On your phone, as commissioner, Home (or the League tab) shows a card that names who left,
  with **"Move forward with {number}"** and **"Invite someone new"**. Tap **Move forward**. Right:
  it saves ("Your choice wasn't saved" must not appear); the "{name} left the league" notice goes
  away; force-quit and reopen: it stays gone, and the league goes on with the smaller number of
  managers.
- [ ] **12. Invite someone new.** **[2+ accounts]** The same, with one more manager leaving, but tap
  **Invite someone new**. Right: it saves; the notice stays, because the league is waiting for a
  newcomer; have someone join with the league's invite code (League settings shows the
  code, with a Share button), and the notice goes away by itself.
- [ ] **13. The playoff-teams stepper.** A league set to more playoff teams than it has managers
  (for example, 8 playoff teams and a manager just left, leaving 7). The same card shows a line
  like **"8 playoff teams, but 7 teams are in"** and a **Playoff teams** stepper with **"Up to 7,
  one per team."** Tap the **minus**. Right: the number goes down by one and the line clears once
  it fits; League settings › Playoff teams shows the new number, also after you force-quit and
  reopen. (After the draft has started it should refuse: "The draft has started, so the season
  setup can't change now. Nothing was saved.")
- [ ] **14. Save queue.** League tab, before the draft › **Build your queue**. Add two or three
  stocks and move one with the arrows. Right: **Save queue** appears with **"Not saved yet."** under
  it. Tap **Save queue**. The line and the button go away; force-quit and reopen: your queue is
  just as you left it.
- [ ] **15. The nudge.** **[2+ accounts]** You're commissioner of a league that was run back, and
  someone hasn't answered. League tab › the list of who's running back › the link on that person's
  row (VoiceOver calls it "no reply yet. Nudge or remove"). A sheet opens titled **"{name} hasn't
  replied"** with when they were asked, and the buttons **Nudge again**, **Remove {name}** and
  **Cancel**. Tap **Nudge again**. Right: the sheet closes; their phone gets a notification. Open
  the same sheet again straight away: the Nudge button is gone, and its message says when you can
  nudge again (once a day), and it shows when you nudged.
- [ ] **16. Schedule the draft.** **[2+ accounts]** Commissioner of a run-back league where
  **everyone has answered**: the review screen. Right: the Draft row says **"Pick a draft time"**
  and **Schedule the draft** is greyed with **"Pick a future draft time."** under it. Pick a time
  in the future: the button turns on. Tap **Schedule the draft**. Right: it saves; Home now shows
  the draft countdown; everyone who's in gets a notification; the review doesn't come back.

## 4. Keep an eye out the whole way

These each showed up once in the simulator. If either happens on your phone it's a serious bug, so
write it down right away: a **screenshot**, **what time it was**, **what you had just tapped**, and
whether it fixed itself.

- [ ] **17. "Get started" dead on the very first launch.** A fresh install (delete the app and
  install it again, or the first launch after installing). On the Get started screen, tap
  **Create a league** or **Join with a code** straight away. Right: it responds to the first tap.
  If nothing happens: note it, then say whether force-quitting and reopening fixed it.
- [ ] **18. The Portfolio tab drawing blank.** Open the Portfolio tab several times during the pass:
  right after opening the app, and after switching leagues. Right: the content shows within a
  couple of seconds. If it stays blank for about ten seconds: note it, and say whether it was a
  fresh open or a league switch, and Wi-Fi or mobile data.

## 5. Sign-in and invite links (last)

These need the launch-prep work done first, in this order (`docs/STATUS.md` §4, "Launch prep"):
the Supabase Auth settings (the web addresses the email links may return to, **Confirm email**
turned on, the **Apple** and **Google** sign-in providers, and the **custom email sender**, since
the built-in one is rate-limited for the whole project); Apple's web sign-in set up; the
**web app live**, with the App Store or TestFlight address in it; and the **1.3 build** installed.
Details of the link setup are in `docs/security/universal-links.md`. **Don't start this section
until all of that is done.** All of these are marked **⚙**.

For the email steps use an address you can open on this phone, and another one for the laptop
step. For the invite steps you need **[2+ accounts]**.

- [ ] **19. ⚙ A real email sign-up.** Sign out (Profile › Sign out), then **Create account** with
  a real address and a password. Right: **"Check your email"** says it sent a link to your address
  to finish creating your account, with **"Didn't receive it? Send again"**. Tap **Send again**: a
  second email arrives. Open an email and tap the link. Right: the app opens (or a web page with an
  **Open the app** button, which opens it); above **"Pick a username"** a small **EMAIL CONFIRMED**
  tag shows; the username box is already filled with a playful made-up one, a word and an animal and
  some digits (like "HelpfulHornet151"), **never your name**; **"You can change it later in
  Profile."** is under it. Keep it and you're in.
- [ ] **20. ⚙ Signing back in.** Sign out, then sign in with that email and password. Right: you
  go straight in, with no username screen again.
- [ ] **21. ⚙ A real password reset.** Sign-in screen › **Forgot password** › your email. Open the
  email and tap the link. Right: the app opens on a **new password** screen (briefly "Checking your
  reset link…"). Set one. Right: **"Password updated"**, **"You're signed in with your new
  password"**, **Continue** takes you in. Sign out and sign in with the new password: it works.
- [ ] **22. ⚙ Android back on the reset screen.** **[Android phone]** Ask for another reset link,
  open it, and on the new-password screen press the **Android back button** (or **Cancel**). Right:
  you leave the screen and end up on **sign-in, signed out**. You can't get into the app from there
  without setting a new password. (On an iPhone the same check is the **Cancel** button.)
- [ ] **23. ⚙ Sign in with Apple.** **[iPhone]** Sign out, then **Continue with Apple** with an
  Apple ID that has no account yet (hiding your email is fine). Right: you go straight to the
  username screen, pre-filled with a playful made-up one that is **not your name**; no email
  confirmation; keep it and you're in.
- [ ] **24. ⚙ Sign in with Google.** Sign out, then **Continue with Google** with a Google account
  that has no account yet. Right: the same: the username screen with a made-up username, not your
  name, and then in.
- [ ] **25. ⚙ An invite link from Messages (zero taps after you sign in).** **[2+ accounts]** On the
  other account, a league that hasn't drafted: **Share**, and send it to this phone in Messages. It
  reads "Join my league with code …" with a link. Sign this phone out (or use a phone with a new
  account), then tap the **link** in Messages. Right: the link opens **the app** (not Safari) on
  **"{name} invited you to {league}"**, with Continue with Apple, Continue with Google, and Use
  email, and nothing else about the league. Sign in. Right: you land inside the league
  (**"You're in {league}"**), with no extra tap to join.
- [ ] **26. ⚙ The same link while you're signed in.** **[2+ accounts]** Have another invite link
  sent to you in Messages for a league you're **not** in, and tap it while signed in. Right: the app
  opens and takes you into that league, with no extra tap and without typing the code.
- [ ] **27. ⚙ The old-style link waits for a tap.** While signed in, type
  **fantasystockapp://join/CODE** (a real code from a league you're not in) into Notes and tap it.
  Right: the app opens on a **"Join {league}"** preview and it **does not join until you tap
  Join**.
- [ ] **28. ⚙ The confirmation email opened on a laptop.** Sign up with a new address on the phone,
  but open the email on a **laptop** and click the link there. Right: nothing breaks: the web page
  doesn't sign the phone in (a confirmation only completes in the app that asked for it); go back
  to the phone and **sign in with that email and password**, and you're in.

## 6. Deleting an account and taking over a team

The server side is live (2026-10-22); the screens arrive with the account-deletion app PR. **Use
throwaway test accounts only: a deletion cannot be undone.** You'll need a test league with
**[2+ accounts]**, and for item 29 a test Apple ID that has signed in to the app.

- [ ] **29. Delete an account that signed in with Apple.** **[iPhone]** On a test account: Profile ›
  **Delete account** (the last row). Right: **"Delete your account?"** lists each league and what
  happens to it; **Continue with Apple** asks you to confirm; then **"Confirmed with Apple"**. Tap
  **Delete my account**, then **Delete** in **"Are you sure?"**. Right: you're signed out and sign-in
  shows **"Your account is deleted."** Then on the phone: Settings › your name › Sign in with Apple:
  the app is **gone** from the list (allow a minute).
- [ ] **30. Delete an account that uses a password.** Same path on an email test account. Type a
  wrong password first. Right: **"That password isn't right. Try again."** under the field, the field
  clears. Then the right password: deleted as in 29.
- [ ] **31. What the league sees.** **[2+ accounts]** On another account in that league: Standings,
  Matchup and the team view show **"Former manager"** with the plain person avatar, never the old
  name. If the deleted account was the commissioner, someone else is commissioner now.
- [ ] **32. Find a new manager, for real.** **[2+ accounts]** As the commissioner: League settings ›
  Members › the **Former manager** row › **Find a new manager**, then **Share** and send it to the
  other phone in Messages with a **real tap** on the share sheet. Right: the message carries a link.
  On the other phone tap it. Right: the app opens on **"Take over Former manager's team in
  {league}?"**; **Take the team** puts that account in the league with that team. Open the same link
  again from a third account. Right: **"Someone already took this team."**
- [ ] **33. A takeover link typed by hand waits for a tap.** **[2+ accounts]** While signed in, type
  **fantasystockapp://take/CODE** (the code from a fresh **Find a new manager** link) into Notes and
  tap it. Right: the app opens on **"Take over a team"** with **Find league** and **Not now**, and
  **nothing about the league shows until you tap Find league**. Tap it: the takeover question
  appears. Tap **Not now** instead and nothing happens.

## If something isn't right

Write down: what you tapped (and on which screen), what you expected, what you saw, the time, and
a **screenshot or a screen recording** (swipe down from the top right, tap record). Mention which
item number it was. A step that works only on the second try counts as not working.
