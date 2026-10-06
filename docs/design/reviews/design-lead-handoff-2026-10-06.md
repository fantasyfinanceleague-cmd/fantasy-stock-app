# Design Lead handoff (2026-10-06)

From the outgoing Design Lead session to the fresh one chartered on `docs/design/UX_RULES.md` (plan: `docs/plans/2026-10-06-ux-rulebook.md`, PR #137). Review logs and captures live outside the repo, in `~/fantasy-stock-design-review/<branch>/DESIGN-REVIEW.md`.

## 1. DESIGN-APPROVED

| Phase | Branch / where | Verdict |
|---|---|---|
| 3b-1 shell | merged #73 | DESIGN-APPROVED @ `c36e11a` (round 2, 2026-09-29) |
| 3b-2 Home | `ui/mobile-home` @ `5c003c2`, merged | DESIGN-APPROVED (re-gate 2026-10-05) with two follow-ups due **before the 1.2.0 cut**: **F1**, restore the tab labels at XXXL (a `maxFontSizeMultiplier` cap, not hiding them, which changed the approved 3b-1 shell); **F2**, Reduce Motion ON evidence for the new chart path (Season → 1W, drawn in the first frame). |

Nothing else carries a DESIGN-APPROVED verdict.

## 2. Where each gate stands

| Phase | Head | State |
|---|---|---|
| 3c game | `ui/mobile-game` @ `8ee0e28` | **No gate verdict yet.** Rulings in its log: D9 (one `components/game/MatchScoreboard`; post-1.2.0 promote to `sp/`) and medals (tokens, ranks 1–3, season complete only, 9 contrast pairs). Gate it in the new format (`docs/design/UI-UX-PROGRAM.md` + the rulebook). |
| 3c-2 setup / queue / auto-start client | `ui/mobile-league-setup` @ `656e192` | **No visual gate yet.** All of its copy has been ruled (relayed via the Orchestrator); `656e192` applies the three Home corrections. Next: capture review, Light + Dark, XXXL. |
| 3e money | `ui/mobile-money` @ `31edba6` | **No gate verdict.** Copy ruled: tier refusals (option A + category slots, "Flex"), the "X didn't load" titles, "Left in the slot". **Open:** confirm 3e's `trade_conflict` mapping against the pre-ruling ("Nothing was traded: your league changed while this trade was going through. Try again." only with a rollback guarantee, else the fallback). Captures are in the review folder, not reviewed. |
| 3f join + not found | merged #125 | Copy ruled; **merged without a recorded capture gate.** Do a post-merge check against the board's Join / Not found frames. |
| `sp/` primitives | #110, #111, #124 (merged) | I **ruled the specs** (§9B icon map; `alert` for load failures only; medallion 36 in a 72 disc; `remove` → Ionicons `remove`, the pair of `add`) but **ran no capture gate** on #110/#111. Spot-check them on device. |

## 3. "Your call" sections (board)

- **Tiers after a trade** (`#call-tier-trades`): decided, A.
- **Leaving a league** (`#call-leave`): all decided (leave window, Q2 = C locked in, Q1 reconfirm, Q4 = A transfer first). Edges 3–4 are **defaulted** to my recommendations: Run it back does not ask a post-season leaver, and there's no "unhide" in 1.2.0. Reopen only if Giorgio does.
- **Draft starts by itself** (`#call-auto-start`): decided (room-open gate at T−1h, postponed, no late start, 15-minute times ≥ 1 h, draft-time pushes to every member). The latest board commits are in **PR #135 (open)**.
- **Precondition, flagged:** every room-open / at-risk / postponed push rides the order-notify cron, still in `supabase/migrations/deferred/`. No copy may promise those pushes until it is live.

## 4. In flight and queued

- **3c-2:** the three Home corrections landed (`656e192`); verify them in its gate.
- **3e:** the `trade_conflict` confirmation (above).
- **Queued board frames** (none drawn yet): Create league steps 1 and 4, the slot editor, League settings, the draft-time sheet in the create flow, and the "{Name} is ready" done screen (rules for all of these are already given in copy rulings).

## 5. Conventions to keep

- **`docs/design/screens/data.js` is the one dataset.** Every number is derived from it, so frames reconcile by construction. Never type a figure into a frame; derive it, or label it "sample".
- **Board build:** edit `screens.jsx` / `inventory.jsx` (components, exported on `window.KSInventory`) and `inventory-board.jsx` / `board.jsx` (sections, TOC), then run `node build.mjs` in `docs/design/screens/`, which writes `key-screens.html`. Check Light **and** Dark, plus the console, in a browser before committing. JSX attribute strings can't hold straight double quotes: use curly quotes or `{`…`}`.
- **Copy:** Giorgio's words are verbatim. Every other string in a frame is new and flagged in its caption or the section notes. Workers take copy **from inside the frames**, so explanations belong in captions, never on the phone.
- **Writing rules I enforced:** whole sentences, no stitched fragments or em-dash labels; "X didn't load" for load failures; field errors inline, never alerts; confirm buttons name the action; no promise (a push, a reminder) the backend doesn't deliver yet; one word per concept ("draft time", "price range", "Flex"); they/them for anyone, in frames, captions and comments.
- **Mockups:** each frame is one viewer's phone (avatar, "(you)" and records follow that person); the sample people and times come from `data.js` (Serie A Traders: draft Sat, Oct 3 · 7:00 PM ET, room 6:00 PM ET).
- **Decisions** go to Giorgio as side-by-side "Your call" sections with a recommendation; mark them decided on the board as soon as he rules.
- **Git:** fresh branch off `origin/main` for each workstream (stack only on an unmerged board branch); `git branch --show-current` + `git status` before every commit; only board/docs files; the Orchestrator pushes; merging is Giorgio's.
