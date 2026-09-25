# Stockpile Mobile App — Architecture Guide

Overview of the mobile app for developers and AI assistants. Mobile is Stockpile's
primary product surface. For project-wide status see [`docs/STATUS.md`](../../docs/STATUS.md);
for backend flows, open the generated map at `docs/architecture/architecture.html`.

> **Pending branch:** `ui/design-system-pass-v2` (unmerged) adds `components/ui/`
> primitives (`Button`, `Card`, `Screen`, `SectionLabel`, `Banner`) and converts most
> screens to them. Once it merges, update the *Styling* section below.

---

## Tech stack

| Technology | Purpose |
|---|---|
| React Native 0.81 / React 19 | Cross-platform UI |
| Expo SDK 54 + Expo Router | Tooling, file-based navigation |
| TypeScript 5.9 | Types |
| Supabase JS | Auth (AsyncStorage session), Postgres via RLS, Realtime, Edge Functions |
| EAS Build + EAS Update | Builds and OTA updates (`eas.json`: `development`, `preview`, `production` channels) |
| ESLint (flat config) | `npm run lint` — see the lint conventions in the root `CLAUDE.md` |

---

## Project structure

```
apps/mobile/
├── app/                         # Expo Router routes
│   ├── _layout.tsx              # Root: auth gate, LeagueProvider, notification deep links
│   ├── login.tsx                # Sign in / sign up (shared password policy)
│   ├── forgot-password.tsx      # Request reset email
│   ├── reset-password.tsx       # Deep-link target for the reset email
│   ├── (tabs)/
│   │   ├── _layout.tsx          # Tab bar (redirects to /login when signed out)
│   │   ├── index.tsx            # Home — cross-league overview + performance chart
│   │   ├── draft.tsx            # Snake draft
│   │   ├── portfolio.tsx        # Holdings, P/L, buy/sell (TradeModal)
│   │   ├── matchup.tsx          # Weekly head-to-head
│   │   ├── league.tsx           # Standings, schedule, history, join-by-code entry
│   │   ├── profile.tsx          # Avatar, username, password, sign out
│   │   └── leagues.tsx          # League browser (hidden from tab bar: href: null)
│   ├── create-league.tsx        # Multi-step wizard incl. stake mode + slot builder
│   ├── join-league.tsx          # Preview + join by invite code
│   ├── league-settings.tsx      # Commissioner settings, start new season
│   ├── player-portfolio.tsx     # Another member's holdings
│   ├── trade-history.tsx        # User's trades
│   └── modal.tsx                # Expo template modal
├── components/                  # TradeModal, SlotBuilder, LeagueSwitcher, WeekNavigator,
│                                # PerformanceChart, PortfolioChart, PLBreakdownModal,
│                                # StatusBadge, Skeleton, … (__tests__/ is the Expo
│                                # template placeholder; no test runner is configured)
├── lib/                         # Context, hooks, data helpers (see below)
├── constants/
│   ├── theme/                   # Design tokens: colors, typography, spacing, shadows
│   ├── Colors.ts                # Back-compat alias layer over theme/colors (light theme)
│   └── passwordRules.ts         # MANUAL mirror of packages/shared PASSWORD_REQUIREMENTS
│                                # (Metro can't resolve the workspace package) — keep in sync
├── app.json / eas.json
└── eslint.config.mjs
```

`components/LeagueCarousel.tsx` is **not mounted anywhere** (orphaned by the Home
rebuild). It is left in place because the unmerged design-system branch still edits
it; delete it after that branch lands.

---

## Navigation

- **Auth gate:** `app/_layout.tsx` renders only the auth stack (`login`,
  `forgot-password`, `reset-password`) when signed out; `(tabs)/_layout.tsx` also
  redirects to `/login`.
- **Tabs (visible):** Home, Draft, Portfolio, Matchup, League, Profile.
  `leagues.tsx` is routable but hidden (`href: null`).
- **Modals / full-screen stacks:** `create-league`, `join-league`, `league-settings`,
  `player-portfolio`, `trade-history`.
- **Deep links:** scheme `fantasystockapp://`; notification taps route by
  `data.screen` to Draft, Matchup, or (default) League; password-reset links land on
  `reset-password`.

> **Reachability rule** (from `CLAUDE.md`): before adding or citing a button, confirm
> its host screen is mounted *and* reachable in the state that matters — not just that
> the file exists.

---

## State and data

### `LeagueContext` (`lib/LeagueContext.tsx`)
Global league state: loads the user's memberships (`league_members` → `leagues`),
tracks `activeLeagueId`, exposes `activeLeague`, `leagues`, and a refresh. Every tab's
`LeagueSwitcher` reads and writes it.

### Hooks and helpers (`lib/`)

| File | Responsibility |
|---|---|
| `useAuth.ts` | Session state, sign in/out |
| `useLeagues.ts` | User's leagues (used by the hidden browser) |
| `useHomeData.ts` | Cross-league Home aggregation: profiles, picks + trades, seasons, standings, matchups |
| `usePortfolio.ts` | Holdings computed from `drafts` + `trades` (never stored) |
| `useStockPrices.ts` | Batched prices via `ticker-quotes`, cached |
| `useHistoricalPL.ts` | Period P/L series via `historical-bars` |
| `useStockNames.ts` | Company names via `symbol-name`, abbreviated for display |
| `categoryData.ts` | Stake modes, categories, slot load/save/validation, enrichment progress (mirror of `apps/web/src/utils/categoryData.js`) |
| `weekStatus.ts`, `marketHours.ts` | Week/season phase and US market-hours logic |
| `notifications.ts` | Push registration and draft-turn notification |
| `contentModeration.ts` | Username / league-name validation |
| `supabase.ts` | Client on the **publishable** key (`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) |

### Where writes go

The app does **not** insert picks or trades directly — those RLS policies were dropped
in Phase 3. All game-state writes that need validation go through edge functions:

| Action | Path |
|---|---|
| Draft pick | `validate-and-record-pick` (turn, uniqueness, draftable universe, slot category/price, stake budget; on the final pick **finalizes the league** — status, season schedule, standings, dates, season 1 — via the `finalize_league_draft` RPC) |
| Buy / sell | `record-trade` via `TradeModal` |
| Join league | `preview-league` → `join-league` |
| Prices / search / names / history | `quote`, `ticker-quotes`, `symbols-search`, `symbol-name`, `historical-bars` |
| Start new season | `start_new_league_season` RPC (commissioner-gated server-side) |

Direct table writes that remain: league create/update and slot definitions
(`leagues`, `league_draft_slots`), profile fields (`user_profiles`), and push-token
registration.

> **Season schedule is server-side** (branch `feat/server-schedule-generation`; live
> only once its migration is applied and `validate-and-record-pick` deployed — check
> `docs/STATUS.md` §4). The final pick writes `matchups`, initial `league_standings`,
> league start/end dates, `num_weeks` and season 1 atomically. Mobile writes none of
> these and must not start to: the client INSERT policies are scheduled for removal
> (F10).
>
> **Known gaps:**
> - **Heal hook.** If finalization fails, the draft stays `in_progress` with every
>   pick made. No one has a turn then, so `draft.tsx` shows no control that retries.
>   Follow-up: when `draft_status === 'in_progress'` and every pick is made, call
>   `validate-and-record-pick` with `{ league_id, action: 'finalize' }`.
> - **Season 2+.** `start_new_league_season` deletes the matchups, and nothing
>   regenerates them (`docs/STATUS.md` §4).

### Realtime
- `draft.tsx` subscribes to `drafts:<leagueId>` for live picks.
- `league.tsx` subscribes to `standings-<leagueId>` for rank changes.

---

## Screens (current behaviour)

- **Home** — cross-league overview built from `useHomeData`, portfolio performance
  chart with period-relative P/L (`PerformanceChart` + `useHistoricalPL`).
- **Draft** — snake order (commissioner first, then sorted — matches the server),
  category badges, league slot panel, stake-mode budget display; blocks drafting when
  a league has no `stake_mode`.
- **Portfolio** — holdings, cost basis, P/L; buy/sell in-app through `TradeModal`
  (symbol search autocomplete; server-validated).
- **Matchup** — weekly head-to-head with week navigation and live/final status.
- **League** — standings (realtime), schedule by player, season history, join-by-code
  entry point.
- **Profile** — avatar emoji, username, password change, sign out. (A re-auth gate on
  password change — finding F13 — is on the unmerged PR #9 branch.)
- **Create league / settings** — stake mode picker (fixed notional / price tiers /
  budget cap), `SlotBuilder` with feasibility warnings, draftable-universe override
  (`allow_undraftable`).

---

## Push notifications

- Expo push; EAS project ID `762da87e-578d-4041-ae85-37d8aa312187`.
- Tokens are stored in `user_profiles.expo_push_token`, and the draft-turn notification
  is sent **client-side** to the next picker's token. This is security finding **F8**
  (tokens readable by any authenticated user); the fix moves tokens to an owner-only
  `push_tokens` table and sending to the `send-notification` edge function (PR #9 +
  `docs/migrations/STAGED_L2_push_token_capability.sql`).

---

## Styling

- Light theme. Tokens live in `constants/theme/`; `constants/Colors.ts` maps legacy
  `Colors.xxx` keys onto them.
- Conventions enforced in review (see the design-system branch): no raw hex outside
  `constants/theme/colors.ts`; `fontFamily` (Inter weights) rather than `fontWeight`;
  `fontVariant: ['tabular-nums']` for money.
- RN `StyleSheet.create` stays at the bottom of each file with the file-top
  `no-use-before-define` disable comment — see `CLAUDE.md` → ESLint.

---

## Development commands

Run everything from `apps/mobile/` — running Expo/EAS from the repo root offers to
create a duplicate project.

```bash
npx expo start                                   # dev server (Expo Go / dev client)
npm run lint                                     # ESLint
npx tsc --noEmit                                 # type check
eas build --profile development --platform ios   # dev client
eas build --profile production --platform all    # store build
eas update --channel production                  # OTA update
```

---

*Last updated: 2026-09-24*
