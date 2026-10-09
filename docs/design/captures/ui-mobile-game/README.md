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
