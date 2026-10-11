# 3c game screens: device captures (`fix/fixture-identity`)

iPhone 17e (8CDB3007…), Expo Go SDK 54, 2026-10-09. Light and Dark at the default text
size; XL = `accessibility-extra-large` (Light). All DEV fixtures, nothing from prod. Every
fixture now shares one "me" (`FIXTURE_USER_ID`, Roberto B.), so these screens run the
same "who am I" path as production (the auth user id).

Base env for every row: `EXPO_PUBLIC_SHELL_FIXTURE=leagues` and `EXPO_PUBLIC_GAME_SEAM=1`,
unless the row says otherwise.

## Matchup

| File | State | Env (on top of base) | Navigation |
|---|---|---|---|
| `matchup-live-{light,dark,xl}` | Week 6 live: chyron, scoreboard, tug, week race, both lineups | `HOME_FIXTURE=live_open` | Stock Scudetto → Matchup |
| `all-matchups-live-{light,dark,xl}` | The week's three games, live; your game's card tinted (S-10) | `HOME_FIXTURE=live_open` | Matchup → All matchups |
| `matchup-final-{light,dark}` | Week 6 final: winner banner, Final scoreboard, **final lineups** (F3) | `HOME_FIXTURE=scored` | Matchup |
| `matchup-final-reveal-frames-light` | The one-time reveal: the winner banner rises (fixed `f1b2bdb8`; it never animated before) | `SHELL_FIXTURE=drafting`, `HOME_FIXTURE=scored` | first open of Matchup; 60 fps frames from a simctl recording |
| `all-matchups-final-{light,dark}` | The three games, Final (F3) | `HOME_FIXTURE=scored` | Matchup → All matchups |

## League

| File | State | Env | Navigation |
|---|---|---|---|
| `league-standings-movement-{light,dark,xl}` | Standings with ▲/▼/– movement (F2); your row bold + tinted (S-10) | `HOME_FIXTURE=live_open` | Stock Scudetto → League → Standings |
| `league-schedule-{light,dark,xl}` | Schedule: W/L per week, Next; weeks 8–10 empty (fixture data defines weeks 1–7 only) | same | League → Schedule |
| `league-history-{light,dark,xl}` | History: Season 2 not finished; Season 1 standings, your row bold + tinted | same | League → History |
| `league-standings-final-medals-{light,dark,xl}` | A finished season's standings with medals | same | Summer Cup → League → Standings |
| `league-playoffs-top-{light,dark,xl}`, `league-playoffs-final-{light,dark}` | A finished 6-team bracket (F1): seeds 1–2 bye, Wild card, Semifinals, Final; winners bold, your line tinted | same | Summer Cup → League → Playoffs (scrolled for the Final) |

## Draft

| File | State | Env | Navigation |
|---|---|---|---|
| `draft-ending-{light,dark,xl}` | The draft's ending (DraftComplete): roster and Week 1 line | `SHELL_FIXTURE=drafting`, `DRAFT_ROOM_FIXTURE=complete` | League |
| `home-pre-draft-members-{light,dark}` | Pre-draft Members: you marked and first (S-3) | `HOME_FIXTURE=pre_draft` | Home |

**Draft recap: NOT BUILT.** The board's League › History "draft recap" is 1.3 (Design Lead
ruling). Nothing in 1.2.0 points at it: no "recap" string exists in `app/`, `components/`
or `lib/`. `draft-ending-*` is the draft's ending, not the recap.

## Run it back

All rows: `SHELL_FIXTURE=leagues-renewal`, `RUN_IT_BACK=1` (the kill switch is off by
default: F4a). `RENEWAL_FIXTURE` picks who you are.

| File | State | `RENEWAL_FIXTURE` / `HOME_FIXTURE` | Navigation |
|---|---|---|---|
| `rib-home-card-commissioner-{light,dark}` | Champion card + "Run it back?" card (commissioner) | `commissioner` / `complete` | Home (Stock Scudetto) |
| `rib-roster-commissioner-{light,dark}` | Season 2 roster: counts, Nudge/Remove, draft locked until replies | `commissioner` / `complete` | Summer Cup (Season 2, pre-draft) → League |
| `rib-home-counts-commissioner-{light,dark}` | Home counts card while replies come in | `commissioner` / `pre_draft` | Home (Season 2) |
| `rib-review-commissioner-{light,dark}` | Review: set Season 2 (everyone has answered) | `commissioner-ready` / `pre_draft` | Season 2 → League |
| `rib-home-ask-member-{light,dark}` | The member's "Are you in?" on Home | `pending` / `complete` | Home, the finished Summer Cup |
| `rib-roster-member-{light,dark}` | The member's view of the roster | `in` / `pre_draft` | Season 2 → League |

## Not captured as stills

- **S-6 loading skeletons** (Matchup, All matchups) are transient under fixtures; covered
  by source guards (`matchup-loading.test.ts`).
- **S-4 league switch**: Matchup remounts per league; covered by a source guard
  (`matchup-league-key.test.ts`) and seen in the reveal recordings across switches.
- **S-5 season chart**: fixed in code (draw-in keyed on the window, not the values).

## For the Design Lead

- **The hero score is `score.lg` (40 pt), not `score.xl`.** At 56 pt two typical scores
  don't fit a 390 pt phone, so they shrank to different sizes.
- **The finished bracket doesn't mark the champion.**
- **The member's roster view shows the commissioner's draft card** ("You can set the draft
  once everyone has replied").
- **The league sheet lists Season 2 as plain "Summer Cup · Pre-draft"**, with no season label.
- **RenewalReview's "Teams" sub-line indents under the value column.**

## Game-screens gate fixes (GS-1 to GS-4), 2026-10-10

iPhone 17e, Expo Go SDK 54. Base env as above (`SHELL_FIXTURE=leagues`, `GAME_SEAM=1`) plus
`HOME_FIXTURE=scored`. XL = `accessibility-extra-large` (Light). The lost and tied Finals use
the capture-only knob `EXPO_PUBLIC_SCORED_OUTCOME=lost|tied` (DEV only; it swaps or equalises
week 6's posted gains under `scored`, and your and Gianluigi's records count that result).

| File | Shows | Navigation |
|---|---|---|
| `gs-matchup-final-won-{light,dark,xl}` | GS-1 "Roberto B. won by $390.67"; GS-2 the band in your colour, "W · 5–1" (it wraps at XL) | Matchup |
| `gs-matchup-final-lost-{light,dark}` | GS-2 the neutral sunken band, "L · 4–2"; "Gianluigi B. won by $390.67". No lineups: the swapped capture gains don't reconcile with the per-stock rows, so the screen correctly hides them | Matchup, `SCORED_OUTCOME=lost` |
| `gs-matchup-final-tied-light` | GS-2 neutral band "Tied in Week 6 · T · 4–1–1"; GS-1 "Tied" under the scores | Matchup, `SCORED_OUTCOME=tied` |
| `gs-all-matchups-final-{light,dark}` | GS-1 every Final card says "won by" (incl. "Luca V. won by $0.06") | Matchup → All matchups |
| `gs-league-final-standings-{light,dark}` | GS-4 "Final standings · After the playoffs": you (champion) gold, Paolo (1st seed, lost the Final) silver "Runner-up", Luca (the better-seeded semifinal loser) bronze; the footnote; no move column | Summer Cup → League → Standings |
| `gs-league-final-standings-xl` | GS-3 all four League segments fit at XL; GS-4 stacked at XL | same, XL |
| `gs-league-playoffs-{light,dark}` | The Playoffs tab keeps the seeding (Paolo 1). The duplicate Wild card heading is GS-6 (P2, not in this pass) | League → Playoffs |
| `gs-league-history-{light,dark}` | GS-8 Season 1 by its playoffs (fixture `get_season_matchups`): you gold, Alessandro (3rd seed, lost the Final) silver, Paolo bronze; the rest in frozen order | League → History |

Not captured: the season-complete card (its headline place now comes from the same order;
covered by `final-standings.test.ts` `seasonCompletePlace`).
