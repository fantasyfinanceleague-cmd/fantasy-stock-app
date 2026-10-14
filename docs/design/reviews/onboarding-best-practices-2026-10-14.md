# Onboarding best practices: four sources, and what applies to us

Reviewed by the Planner on 2026-10-14 at Giorgio's request, as input to the onboarding plan
(`docs/plans/2026-10-14-onboarding.md`). Four sections, one per source: what stood out, and
how it applies to this app. Where the sources disagree, the disagreement is named.

**Our situation, for reference.** First-time users mostly arrive from a friend's invite
(Giorgio, 2026-10-14). Today: three skippable cards on first launch → Get started (Create /
Join) → Create account (email + password only) → Pick a username → the league or an empty
Home. The invite is a plain text code. The iOS push prompt fires during sign-up. Theme is
System by default, changeable in Profile.

---

## 1. scandiweb, "User Onboarding Best Practices: 9 That Work in 2026"

*A vendor article (they sell UX/CRO services); its numbers are uncited. The practices are
sound and widely shared; treat the statistics as directional only.*

**What stood out**
- The job of onboarding is **first value in under a minute**; everything optional is
  deferred. Most churn is "never saw the value clearly", not "bad product".
- **Always let users skip.**
- Copy says **what the user will do**, not what the product offers.
- **Engineer the "aha" moment**: pick the one action that makes the value obvious and
  design the first session to reach it, rather than hoping users stumble onto it.
- **Onboard progressively**: teach the first action now, the rest in context later;
  front-loaded carousels are forgotten.
- **Reduce sign-up friction before polishing the flow**: social / single sign-on, only the
  essential fields, experience value before the account where possible, collect the rest
  later. "Removing one required field can do more than a redesign."
- **Show progress** on multi-step setup; **measure activation** (the first action that
  predicts retention) and iterate against it.

**How it applies to us**
- Our "aha" is not a card; it is **seeing your friend's league with your name in it**.
  For an invited friend that must happen within a minute of tapping the link: link →
  Apple/Google one-tap → pre-filled username → "You're in {league}". Nothing else between.
- "Skip" stays on any card we keep; and skipping must be remembered (today Skip doesn't set
  the seen flag, so the cards come back).
- Sign-in with Apple and Google (Giorgio, 2026-10-14) and the **pre-generated username** are
  exactly "remove a required field": the username screen becomes a confirm, not a form.
- Create league is a 4-step flow: keep its "Step N of 4" progress and its end state
  ("{name} is ready"), which already follows the checklist advice.
- Define the **activation metric** now so the build can measure it: for an invitee,
  "joined the league within 24 h of the link"; for a commissioner, "created a league and
  shared the code".

## 2. Nielsen Norman Group, "Mobile-App Onboarding"

*The research source of the four, and the most sceptical. Its headline is "avoid creating
app onboarding whenever possible."*

**What stood out**
- Separate onboarding costs attention and strains memory, and NN/g's own research found
  **deck-of-cards tutorials did not improve task performance**. Build on existing mental
  models instead.
- Onboarding is justified only when: (1) the app needs information to start; (2) the
  experience depends on user context; (3) a feature is genuinely unfamiliar. Otherwise
  put users in the interface and let **error messages be the teaching moments** (people
  read a few words when fixing a problem).
- **Don't promote features at first launch**; the App Store page already did that.
  Promote a feature **in context**, when it becomes useful.
- **Visual customization (theme) does not belong in onboarding**: people can't know what
  they'll prefer before using the app, and they stick with defaults anyway.
- Content customization (the data the app needs) is fine, if brief, justified ("why we
  ask"), skippable where possible, with a progress indicator.
- If you keep a deck: a **highly visible Skip, minimal cards, one concept per card**.
  Interactive walkthroughs only for genuinely novel interactions; never for standard ones.

**How it applies to us**
- Our three cards are a feature-promotion deck shown at launch: the thing NN/g says not
  to do. For an **invited friend they are pure delay** (the friend already said yes to the
  pitch); for a cold install they are the App Store pitch repeated. **Recommendation: no
  cards on the invited path; on the cold path, at most the three one-line cards with
  Skip, or none, with the pitch living on the App Store page and the landing.** This is a
  decision for Giorgio (the cards exist and his three titles are good copy; the question is
  where they live).
- What IS justified by NN/g's three tests: the account (we need it to join a league), the
  username (context), and **the one unfamiliar idea**, "fantasy football, but with stocks":
  dollars decide, Monday open to Friday close. That belongs **in context**: on the first
  pre-draft Home ("Your week runs Monday's open to Friday's close. Best dollar gain wins.")
  and in the first draft room, not on a launch card.
- **Theme stays out of onboarding** (System by default, Profile › Appearance). Matches what
  we have; the plan should say so explicitly so nobody adds a "pick your look" step.
- Our refusal copy (UX rule 8) is the NN/g "errors teach" principle; keep investing there
  (e.g. "Market's closed. Opens Mon 9:30 AM ET.") rather than in a tutorial.
- Their testing order is the plan's testing order: ship the invited path with no cards,
  watch where people stall, fix the UI first, add guidance only if it measurably helps.

## 3. Wingify (VWO), "Mobile App Onboarding Guide"

*A practitioner guide with many app examples; useful for patterns and metrics.*

**What stood out**
- Four types: **quickstart** (straight in, sign in later), **self-select** (preferences),
  **benefits** (a carousel of what you get), **interactive** (learn by doing).
- Define the **critical action** and measure Install → Sign-up, Install → first core
  action, and day-1/7/30 retention; find the drop-off, A/B test, repeat.
- Keep it to **3–7 steps**, split long setups into small screens with progress, **end
  with a success message**.
- Permissions and notifications are a product moment, not a formality: ask with the
  value stated (Instagram, Spotify ask after the user has a reason).
- Examples worth stealing: **Calm defers sign-up and keeps it dismissible**; **Duolingo
  gets you into a lesson before anything else**; **Coinbase shows a progressive timeline
  with step durations** to reduce anxiety around mandatory steps; **Craft uses social
  proof and lets you try two actions inside onboarding**.

**How it applies to us**
- Our two paths map to two types: the invited path is **quickstart** (into the league;
  the account is the only gate), the commissioner path is a short **self-select** (the
  4-step Create league IS the onboarding for a commissioner; it should feel like Coinbase's
  timeline: "Step 2 of 4 · about a minute").
- The **success message** rule we already have (UX rule 11, endings) applies to the two
  onboarding endings: "You're in {league}" (invitee) and "{name} is ready, share the code"
  (commissioner). Both exist; the plan keeps them as the designed endings.
- **Notifications**: ask **after** the user has a league, with one line of why ("We'll
  tell you when the draft room opens and when it's your turn"), not during sign-up as
  today. The Design Lead suggested the same; this is the plan's recommendation.
- **Social proof** for the cold path: "Marvin has invited you" is the strongest social
  proof there is; the invite web page should lead with the league name and who's in it
  (names only, as the preview rules allow: no names to non-members today, so "6 managers"
  or the commissioner's first name if Giorgio allows it).
- The metrics list goes into the plan's Done-means: Install → joined (invitee), Install →
  league created + code shared (commissioner), day-7 retention per path.

## 4. Apple Human Interface Guidelines, "Onboarding"

*The platform rule book; App Review and user expectations follow it.*

**What stood out**
- "Ideally, people can understand your app simply by experiencing it, but if onboarding is
  necessary, design a flow that's **fast, fun, and optional**." Onboarding happens **after
  launch is complete**, not as part of the launch screen.
- **Teach through interactivity**; prefer a collection of **context-specific tips** (TipKit)
  over one onboarding flow; show instructions **near the thing they refer to**.
- If a tutorial exists, make it **optional**; if skipped on first launch, **never show it
  again**, but keep it findable in help/settings.
- **Keep content about your app**, not about the device or the system.
- **Postpone non-essential setup; ship good defaults.** Integrate a permission request into
  onboarding only if the app can't function without it; otherwise **ask when the feature
  is first used**, and show why.
- Don't let downloads, splash screens or licensing text delay the start. Let people use
  the app before asking for ratings or purchases.

**How it applies to us**
- "Skipped once, never again" is a hard rule we currently break (Skip and deep-link
  arrivals don't set the seen flag). The plan fixes it and adds "find it later" (a small
  "How it works" row in Profile, which also solves where the three cards live if they
  leave the launch path).
- **Push permission**: we can function without it, so by the HIG the ask belongs at first
  use with a reason: after joining/creating a league, "Turn on notifications so you don't
  miss your draft turn." That is the second source to say so.
- **Good defaults**: System theme, a pre-generated username, Random draft order, 60 s pick
  clock: all already defaults, which is the HIG's "postpone customization" done right. The
  plan protects them (no new setup steps).
- **Tips near the thing**: the unfamiliar ideas (dollars decide; week window; waiver
  claims when they arrive) are taught as one-line in-place tips on the screen they
  concern, shown once, with TipKit-style dismissal. This replaces the cards' teaching job.
- The onboarding never asks about the device (no "enable Face ID / allow tracking"
  screens); we have none, keep it so.

---

## Where the four agree (adopt without debate)

1. **Fast, optional, skippable; a skip is remembered forever.**
2. **First value, not a feature tour.** Our first value = your friend's league with you in
   it (invitee), or your league ready to share (commissioner).
3. **Cut sign-up friction first**: Apple + Google one-tap, pre-generated username, only
   the essential fields.
4. **Ask for notifications in context, with a reason, after the user has a league.**
5. **No theme/appearance step in onboarding.** Defaults, changeable later.
6. **Teach the unfamiliar in place**, when it matters, one idea at a time.
7. **Measure activation per path** and iterate.

## Where they differ (Giorgio decides)

- **The three cards.** NN/g and Apple: don't show a deck at launch; the App Store page is
  the pitch. scandiweb/Wingify: a short benefits carousel is acceptable if skippable. Our
  cards are good copy and already built. Options for the plan's "Your call": (A) no cards
  at launch; the titles become the landing/App Store pitch and a "How it works" row in
  Profile; (B) cards only on the cold path (no invite), never on the invited path, Skip
  remembered; (C) cards for everyone before sign-up (today). Recommendation: **B**.
