# Fantasy Stock App - Session Recaps

---

# February 1, 2026 (Session 2)

## What We Accomplished

### 1. Company Names in Portfolio & P/L Breakdown
Added company name display throughout the app:
- **New `useStockNames.ts` hook** - Fetches and caches company names via `symbol-name` edge function
- **`abbreviateName()` utility** - Intelligently shortens long company names (removes Inc., Corp., etc.)
- **Portfolio page** - Shows company name below each holding's symbol
- **P/L Breakdown Modal** - Shows company name for current holdings and closed positions

### 2. P/L Breakdown Modal Improvements
- **Fixed badge styling** - Acquisition badges (Drafted/Bought) no longer stretch across the full width
- **Added `badgeRow` container** - Proper flexbox layout for badges with gap spacing
- **Company names displayed** - Each stock shows its full company name (abbreviated if needed)

### 3. Historical Bars Edge Function
Created `historical-bars` edge function for fetching historical stock data:
- Fetches daily OHLCV bars from Alpaca API for multiple symbols
- Supports date range queries (start/end dates)
- Returns data in format: `{ bars: { AAPL: [{t, o, h, l, c, v}, ...], ... } }`
- Deployed to Supabase

### 4. Historical P/L Hook (Created but Chart Removed)
- Created `useHistoricalPL.ts` hook to calculate portfolio P/L over time
- Tracks position history based on drafts and trades
- Calculates daily P/L by applying historical prices to positions
- **Note:** The P/L over time chart was attempted but removed after user testing

### 5. EAS Preview Build & OTA Updates
Set up standalone app builds that work without a local development server:
- **Preview build configured** - App runs standalone on device without `npx expo start`
- **EAS Update configured** - Push JS changes over-the-air without full rebuild
- **Supabase env vars added** - `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in eas.json
- **Fixed app crash** - Preview builds were crashing due to missing environment variables

**Build Profiles:**
| Profile | Purpose | Command |
|---------|---------|---------|
| `development` | Hot reload with dev server | `eas build --profile development` |
| `preview` | Standalone testing | `eas build --profile preview` |
| `production` | App Store release | `eas build --profile production` |

**OTA Update Workflow:**
```bash
# Push changes to preview build without rebuilding
eas update --branch preview -m "description of changes"
```

## Files Modified/Created

### Mobile App - New Files
| File | Purpose |
|------|---------|
| `apps/mobile/lib/useStockNames.ts` | Hook to fetch/cache company names with abbreviation utility |
| `apps/mobile/lib/useHistoricalPL.ts` | Hook to calculate historical P/L data |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/(tabs)/portfolio.tsx` | Added company names to holdings display |
| `apps/mobile/components/PLBreakdownModal.tsx` | Added company names, fixed badge styling |
| `apps/mobile/eas.json` | Added env vars for preview/production, configured update channels |
| `apps/mobile/app.json` | Configured EAS Update URL and runtime version |

### Supabase Functions - New
| File | Purpose |
|------|---------|
| `supabase/functions/historical-bars/index.ts` | Fetch historical daily bars from Alpaca |

## Technical Notes

### Company Name Abbreviation
```typescript
// Removes common suffixes to fit long names in UI
export function abbreviateName(name: string, maxLength: number = 28): string {
  const suffixes = [', Inc.', ' Corporation', ' Holdings', ' Technologies', ...];
  // Removes suffixes until name fits, then truncates with ellipsis if needed
}
```

### useStockNames Hook
```typescript
// Fetches names in parallel with client-side caching
const { names, loading, getName } = useStockNames(symbols);
// names: { AAPL: 'Apple Inc', MSFT: 'Microsoft Corporation', ... }
```

## Deployed
- ✅ `historical-bars` edge function
- ✅ iOS preview build (standalone, no dev server needed)
- ✅ EAS Update configured for OTA updates

---

# February 1, 2026

## What We Accomplished

### 1. TradeModal Stock Search with Autocomplete
Added user-friendly stock search to TradeModal (mobile and web):
- **Search by ticker OR company name** - no longer requires exact ticker entry
- **Autocomplete dropdown** with relevance-based results
- **Real-time prices** displayed alongside search results
- Uses existing `symbols-search` edge function with smart ordering:
  1. Exact symbol match (highest priority)
  2. Symbol starts-with
  3. Name starts-with
  4. Symbol/name contains (lowest priority)

### 2. TradeModal UX Bug Fixes
Fixed three issues reported during testing:

**VirtualizedLists Error:**
- **Problem:** FlatList nested inside ScrollView caused React Native warning
- **Fix:** Replaced FlatList with ScrollView + `.map()` with `nestedScrollEnabled`

**Permanent Refresh Spinner:**
- **Problem:** Loading spinner stayed visible after clearing search input
- **Fix:** Reset `searchLoading` when input is empty or matches selected symbol
- Added loading state reset when modal opens

**Keyboard Overlap:**
- **Problem:** Search results hidden behind keyboard
- **Fix:** Added `Keyboard.dismiss()` when search results appear

### 3. Cron Job Logging for process-week-results
Investigated why week 5 snapshots weren't created properly:
- **Root cause:** `process-week-results` had no logging to `cron_job_status` table
- **Fix:** Added `updateJobStatus()` function and calls to track job runs
- Now logs `running`, `success`, or `failed` status with error messages
- Matches logging pattern used by `snapshot-week-start` and `snapshot-week-end`

### 4. Cron Job Timing Verification
Confirmed cron job configuration is correct:
| Job | Schedule (UTC) | ET Time | Day |
|-----|----------------|---------|-----|
| `snapshot-week-end` | 21:05 | 4:05 PM | Friday |
| `process-weekly-matchups` | 21:15 | 4:15 PM | Friday |
| `snapshot-week-start` | 14:35 | 9:35 AM | Mon/Tue |

- Tuesday backup for `snapshot-week-start` only triggers if Monday is a market holiday
- Function checks for existing snapshots and skips if already created

## Files Modified

### Mobile App
| File | Changes |
|------|---------|
| `apps/mobile/components/TradeModal.tsx` | Added search with autocomplete, fixed VirtualizedLists, fixed spinner, keyboard dismiss |

### Web App
| File | Changes |
|------|---------|
| `apps/web/src/components/TradeModal.jsx` | Added search with autocomplete dropdown |

### Supabase Functions
| File | Changes |
|------|---------|
| `supabase/functions/process-week-results/index.ts` | Added `updateJobStatus()` logging to `cron_job_status` table |

## Deployed
- ✅ `process-week-results` edge function (with cron job logging)

## Technical Notes

### Search Implementation
```typescript
// Debounced search with 300ms delay
useEffect(() => {
  const timer = setTimeout(async () => {
    if (!searchInput || searchInput.length < 1) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    // Call symbols-search edge function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/symbols-search`, {
      method: 'POST',
      body: JSON.stringify({ q: searchInput, limit: 10, includePrices: true })
    });
    // Display results in dropdown
  }, 300);
  return () => clearTimeout(timer);
}, [searchInput]);
```

### Cron Job Status Logging
```typescript
async function updateJobStatus(
  supabase: any,
  jobName: string,
  status: 'running' | 'success' | 'failed',
  attemptNumber: number,
  errorMessage?: string
) {
  await supabase
    .from('cron_job_status')
    .upsert({
      job_name: jobName,
      run_date: today,
      status,
      attempt_number: attemptNumber,
      error_message: errorMessage || null,
    }, { onConflict: 'job_name,run_date' });
}
```

## Next Steps
- [ ] Monitor `cron_job_status` after Friday Feb 6 for `process-week-results` entry
- [ ] Verify week 6 snapshots are created properly on Monday Feb 9

---

# January 25, 2026 (Session 2)

## What We Accomplished

### 1. Native Trading in Mobile App
Implemented in-app trading instead of opening web app:
- **New TradeModal component** (`apps/mobile/components/TradeModal.tsx`)
  - Buy/Sell toggle with color-coded buttons
  - Symbol input with live quote lookup and company name
  - Quantity stepper (+/- buttons)
  - Real-time price display and total cost/proceeds
  - Budget validation for salary cap leagues
  - Market hours detection (9:30 AM - 4:00 PM ET only)
  - Alpaca account linking check
- **Portfolio page integration** - Buy/Sell buttons on holdings now open native modal

### 2. Market Hours Detection
Created market hours utility for both mobile and web:
- **New file**: `apps/mobile/lib/marketHours.ts`
- **Updated**: `apps/web/src/utils/marketHours.js`
- Features:
  - Detects market open/closed/pre-market/after-hours
  - Handles weekends and market holidays (2025-2026)
  - Uses `Intl.DateTimeFormat.formatToParts()` for reliable cross-platform timezone conversion
  - Trading only allowed during market hours

### 3. Alpaca Price Sync - Exact Parity
Ensured our system matches Alpaca exactly with no discrepancies:

**Trade Fill Prices:**
- `place-order` now polls Alpaca for actual `filled_avg_price` after order execution
- TradeModal stores Alpaca's fill price, not quote estimate
- Links every trade to `alpaca_order_id` for verification

**Week Snapshot Prices:**
- `snapshot-week-start` now uses Alpaca bars API for official **open price** (`o` field)
- `snapshot-week-end` now uses Alpaca bars API for official **close price** (`c` field)
- Falls back to quotes only if bars unavailable

**Daily Sync Cron Job:**
- **New function**: `sync-alpaca-orders` edge function
- Runs daily at 4:30 PM ET (Mon-Fri) after market close
- Fetches all users' Alpaca order history
- Compares to our trades table and corrects any discrepancies
- Modes: `verify` (single order), `sync` (user), `sync-all` (cron)

### 4. FIFO Lot Tracking
Clarified lot tracking approach:
- Alpaca uses FIFO (First-In-First-Out) for lot selection
- Our system uses FIFO based on `created_at` timestamps
- No user choice = no ambiguity between our system and Alpaca
- Users see identical prices/gains in both systems

### 5. Improved Mid-Week Trade Scoring
Updated `process-week-results` scoring logic:
- Week-start holdings sold: `(sale_price - Monday_open) × qty`
- Week-start holdings kept: `(Friday_close - Monday_open) × qty`
- Mid-week buys held: `(Friday_close - purchase_price) × qty`
- Mid-week buys then sold: `(sale_price - purchase_price) × qty`
- FIFO matching for partial sells

### 6. Mobile App Architecture Documentation
Created comprehensive architecture doc:
- **New file**: `apps/mobile/ARCHITECTURE.md`
- Documents navigation, state management, components, hooks, styling, auth, real-time features

### 7. UI Fix
- Fixed portfolio page spacing - added `marginTop: 16` to metrics row for proper gap after header

## Files Modified/Created

### Mobile App - New Files
| File | Purpose |
|------|---------|
| `apps/mobile/components/TradeModal.tsx` | Native trading modal with market hours check |
| `apps/mobile/lib/marketHours.ts` | Market hours detection utility |
| `apps/mobile/ARCHITECTURE.md` | Architecture documentation |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/(tabs)/portfolio.tsx` | Integrated TradeModal, fixed spacing |

### Web App - Modified Files
| File | Changes |
|------|---------|
| `apps/web/src/components/TradeModal.jsx` | Use Alpaca fill price, market hours check |
| `apps/web/src/utils/marketHours.js` | Added `getMarketStatusMessage()`, 2026 holidays |

### Supabase Functions - New
| File | Purpose |
|------|---------|
| `supabase/functions/sync-alpaca-orders/index.ts` | Daily sync with Alpaca order history |

### Supabase Functions - Modified
| File | Changes |
|------|---------|
| `supabase/functions/place-order/index.ts` | Poll for `filled_avg_price`, return fill data |
| `supabase/functions/snapshot-week-start/index.ts` | Use bars API for official open price |
| `supabase/functions/snapshot-week-end/index.ts` | Use bars API for official close price |
| `supabase/functions/process-week-results/index.ts` | FIFO scoring for mid-week trades |

### Database Migrations
| File | Purpose |
|------|---------|
| `supabase/migrations/20260125200000_add_sync_alpaca_cron.sql` | Daily sync cron job at 4:30 PM ET |

## Technical Notes

### Price Sync Flow
```
User Places Trade
       ↓
place-order → Submit to Alpaca → Poll for fill → Return filled_avg_price
       ↓
TradeModal → Insert trade with Alpaca's actual price
       ↓
Daily Cron (4:30 PM ET) → sync-alpaca-orders → Verify/correct all trades
```

### Data Sources Match Alpaca
| Our Data | Alpaca Source |
|----------|---------------|
| `trades.price` | `order.filled_avg_price` |
| `trades.quantity` | `order.filled_qty` |
| `week_snapshots.week_start_price` | Daily bar `open` price |
| `week_snapshots.week_end_price` | Daily bar `close` price |

### Market Hours Check
```typescript
// Trading only allowed during market hours
if (!isMarketOpen()) {
  // Show "Market Closed" message
  // Display next open time
  // Disable trade form
}
```

## Deployed
- ✅ `place-order` edge function
- ✅ `sync-alpaca-orders` edge function
- ✅ `snapshot-week-start` edge function
- ✅ `snapshot-week-end` edge function
- ✅ `process-week-results` edge function
- ✅ Daily sync cron job migration

---

# January 25, 2026

## What We Accomplished

### 1. Multi-Season League Support (Database)
Implemented full multi-season tracking for leagues:
- **New `league_seasons` table** - tracks season number, champion, runner-up, final standings snapshot
- **New columns on `leagues`** - `current_season_id`, `season_status` (active/completed)
- **Database functions**:
  - `complete_league_season()` - records champion/runner-up, snapshots standings
  - `start_new_league_season()` - resets standings, creates new season record
- **Backfill migration** - creates Season 1 for existing leagues with completed drafts

### 2. Auto-Complete Season Logic
Added automatic season completion to `process-week-results` edge function:
- **Playoff leagues**: Detects when finals matchup completes, records winner as champion
- **Non-playoff leagues**: Completes season when `current_week > num_weeks`, top 2 from standings
- Calls `complete_league_season()` database function with champion/runner-up IDs

### 3. Start New Season Button
Added commissioner ability to start new seasons in `league-settings.tsx`:
- **Only visible when `season_status = 'completed'`**
- Gold-styled card with trophy icon explaining what happens
- Confirmation dialog before proceeding
- Calls `start_new_league_season()` database function

### 4. League Page Redesign (Renamed from Standings)
Major restructure of the league page with three collapsible sections:
- **Standings Section** - existing standings with KPI cards
- **Schedule Section** - view any player's matchup schedule
  - Player picker chips to switch between users
  - Shows W/L/T results, gains, "Current" badge for active week
  - Clicking a matchup navigates to that specific matchup (not just your own)
- **History Section** (ESPN-style) - completed seasons with your stats

### 5. ESPN-Style History Section
Redesigned to match ESPN Fantasy Football:
- **Most recent season first** with collapsible section
- **Your stats prominently displayed**: Place (1st/2nd/3rd), Record (W-L-T), Win% (0.XX format)
- **Badge on the right**: 🏆 for champion, 🥈 for runner-up, #N for others
- **Winner row below**: Shows champion (or runner-up if you won) with their record
- **Date range** in top-right corner (e.g., "Nov 2025 - Dec 2025")
- **"See All" link** only appears if multiple past seasons exist

### 6. Championship Display in LeagueCarousel
Updated home screen league cards for completed seasons:
- **Champion**: Gold border, 🏆 trophy badge
- **Runner-up**: Silver border, 🥈 medal badge
- **Other participants**: Muted styling with final rank

### 7. Bug Fixes & Improvements
- **Fixed matchup navigation** - clicking another user's matchup in schedule now shows that matchup
- **Fixed "Now" badge overlap** - removed badge, current week shows "Current" text instead
- **Fixed fractional wins/losses** - ties now only increment ties column, not 0.5 wins/losses
- **Fixed league dropdown border gap** - removed bottom border from last item
- **Updated route references** - changed all `/leaderboard` to `/league`

### 8. Colors Update
Added new colors to `constants/Colors.ts`:
- `silver: '#C0C0C0'`
- `silverBg: 'rgba(192, 192, 192, 0.15)'`
- `goldBg: 'rgba(251, 191, 36, 0.15)'`

## Files Modified/Created

### Database Migrations
| File | Purpose |
|------|---------|
| `supabase/migrations/20260125000000_add_league_seasons.sql` | **NEW** - Multi-season support, functions |
| `supabase/migrations/20260125100000_add_test_completed_season.sql` | **NEW** - Test data for History UI |
| `supabase/migrations/20260125100001_add_more_test_seasons.sql` | **NEW** - Additional test seasons |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/(tabs)/league.tsx` | **RENAMED** from leaderboard.tsx - Complete redesign with 3 sections |
| `apps/mobile/app/(tabs)/_layout.tsx` | Renamed tab to "League" with trophy icon |
| `apps/mobile/app/(tabs)/matchup.tsx` | Accept matchupId/team params to show specific matchups |
| `apps/mobile/app/(tabs)/leagues.tsx` | Updated route from leaderboard to league |
| `apps/mobile/app/_layout.tsx` | Updated notification navigation to league |
| `apps/mobile/app/league-settings.tsx` | Added "Start New Season" section for commissioners |
| `apps/mobile/lib/LeagueContext.tsx` | Added season fields, LeagueSeason interface |
| `apps/mobile/constants/Colors.ts` | Added silver, silverBg, goldBg colors |
| `apps/mobile/components/LeagueCarousel.tsx` | Championship badges for completed seasons |
| `apps/mobile/components/LeagueSwitcher.tsx` | Fixed dropdown border gap |

### Supabase Functions
| File | Changes |
|------|---------|
| `supabase/functions/process-week-results/index.ts` | Added auto-complete logic, fixed tie scoring |

## Technical Notes

### Multi-Season Architecture
```typescript
// League can have multiple seasons
interface LeagueSeason {
  id: string;
  league_id: string;
  season_number: number;
  champion_user_id: string | null;
  runner_up_user_id: string | null;
  started_at: string;
  completed_at: string | null;
  final_standings: FinalStanding[] | null;  // JSON snapshot
}

// League tracks current season
interface League {
  // ... existing fields
  current_season_id: string | null;
  season_status: 'active' | 'completed';
}
```

### Season Completion Flow
1. `process-week-results` detects season end (playoffs finished OR regular season complete)
2. Calls `complete_league_season(league_id, champion_id, runner_up_id)`
3. Database function snapshots standings to `final_standings` JSONB
4. Sets `season_status = 'completed'`

### New Season Flow
1. Commissioner sees "Start New Season" button when `season_status = 'completed'`
2. Confirmation dialog explains what happens
3. Calls `start_new_league_season(league_id)`
4. Database function: creates new season record, resets standings, deletes old matchups

## Next Steps

### Pending
- [ ] Generate new matchup schedule when starting new season
- [ ] Test season completion with real playoff matchups
- [ ] Add season selector to view historical matchups/standings

---

# January 22, 2026

## What We Accomplished

### 1. Join League by Invite Code (Mobile)
Implemented the ability for users to join leagues using an invite code:
- **New join-league screen** with two-step flow (code input → league preview)
- **Code validation** against both `leagues.invite_code` and `league_invites.code` tables
- **League preview** showing name, type, members, budget, draft date, and status
- **Error handling** for invalid codes, full leagues, already a member, expired invites
- **Seamless integration** with existing create-league wizard

### 2. Share Invite Code Feature
Added the ability to share league invite codes from the Home screen:
- **Share button** on each league card in the carousel
- **Alert dialog** showing the invite code with Copy/OK options
- **Native share sheet** integration for sending via text, email, etc.

### 3. League Settings for Commissioners (Mobile)
Full settings screen for commissioners to manage their leagues:
- **Edit league name** with content moderation
- **Draft date** with TBD option or date/time picker
- **Budget mode** (Salary Cap / No Limit) with amount input
- **Number of teams** (4-16) with stepper controls
- **Stocks per team** (1-12) with stepper controls
- **Read-only info** section showing type, duration, invite code
- **Lock mechanism** - all settings disabled once draft starts
- **Settings button** (gear icon) on league cards for commissioners only

### 4. League Carousel Sync with Home Screen
Fixed the Home screen to update dynamically when swiping through leagues:
- **Portfolio value** now updates per league
- **Allocation chart** refreshes for each league
- **Past matchup results** load for the visible league
- **Create/Join prompt** shown when on the last card

### 5. League Interface Expansion
Extended the `League` TypeScript interface with all fields:
- `commissioner_id`, `num_participants`, `num_rounds`
- `salary_cap_limit`, `duration_days`, `num_weeks`, `playoff_teams`

## Files Modified/Created

### Mobile App - New Files
| File | Purpose |
|------|---------|
| `apps/mobile/app/join-league.tsx` | Join league screen with code input and league preview |
| `apps/mobile/app/league-settings.tsx` | Commissioner settings screen for editing league |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/_layout.tsx` | Added `join-league` and `league-settings` routes |
| `apps/mobile/app/create-league.tsx` | Wired "Join a League" button to navigate to join-league screen |
| `apps/mobile/components/LeagueCarousel.tsx` | Added share button, settings button (commissioners), swipe-to-sync active league |
| `apps/mobile/lib/LeagueContext.tsx` | Expanded League interface with all fields |
| `apps/mobile/app/(tabs)/index.tsx` | Added "Create or Join" prompt when on last carousel card |

## Technical Notes

### Join League Flow
1. User taps "Create or Join" card → opens create-league wizard
2. User taps "Join a League" → dismisses and opens join-league screen
3. User enters 6-character code → taps "Look Up"
4. Preview screen shows league details → user taps "Join League"
5. User is added as member → redirected to home with league active

### League Settings Lock
```typescript
// Settings locked once draft is in progress or completed
const isLocked = league?.draft_status === 'in_progress' ||
                 league?.draft_status === 'completed';
```

### Carousel Sync
```typescript
const handleScroll = (event) => {
  const index = Math.round(contentOffsetX / (CARD_WIDTH + CARD_MARGIN * 2));
  if (index < leagues.length) {
    setActiveLeagueId(leagues[index].id);  // Sync portfolio/matchups
  } else {
    setActiveLeagueId(null);  // Show "Create or Join" prompt
  }
};
```

### 6. Push Notifications Setup
Implemented push notifications for draft turn alerts:
- **expo-notifications** and **expo-device** packages installed
- **Database migration** adding `expo_push_token` and `notifications_enabled` to `user_profiles`
- **Notification service** (`lib/notifications.ts`) for registering tokens and sending notifications
- **Auth integration** - registers push token on login, removes on logout
- **Draft turn notifications** - notifies next player when it's their turn
- **Deep linking** - tapping notification navigates to Draft screen

### 7. Development Build Setup
Set up EAS Build for real device testing:
- Configured `eas.json` with development profile
- Added iOS bundle identifier (`com.stockpile.fantasystock`)
- Registered device via EAS device registration
- Created development build with full native module support
- Enabled Developer Mode on iPhone for testing

## Files Modified/Created

### Mobile App - New Files
| File | Purpose |
|------|---------|
| `apps/mobile/app/join-league.tsx` | Join league screen with code input and league preview |
| `apps/mobile/app/league-settings.tsx` | Commissioner settings screen for editing league |
| `apps/mobile/lib/notifications.ts` | Push notification service |
| `apps/mobile/eas.json` | EAS Build configuration |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/_layout.tsx` | Added routes, notification listeners for deep linking |
| `apps/mobile/app/create-league.tsx` | Wired "Join a League" button |
| `apps/mobile/components/LeagueCarousel.tsx` | Share button, settings button, swipe-to-sync |
| `apps/mobile/lib/LeagueContext.tsx` | Expanded League interface with all fields |
| `apps/mobile/lib/useAuth.ts` | Push token registration on login/logout |
| `apps/mobile/app/(tabs)/index.tsx` | "Create or Join" prompt on last carousel card |
| `apps/mobile/app/(tabs)/draft.tsx` | Send notification to next player after pick |
| `apps/mobile/app.json` | Added bundle ID, expo-notifications plugin |

### Database
| File | Purpose |
|------|---------|
| `supabase/migrations/20260122000000_add_push_tokens.sql` | Push token storage and notification log |

## Next Steps

### Pending
- [ ] Native trading (currently opens web app)
- [ ] Trade history (currently opens web app)
- [ ] Matchup result notifications
- [ ] League invite notifications

---

# January 18, 2026

## What We Accomplished

### 1. Sleeper-Style League Creation Wizard (Mobile)
Redesigned the league creation flow to match the Sleeper app's UX:
- **Multi-step wizard** with one setting per screen (8 total steps)
- **Welcome screen** with hero graphic and call-to-action
- **Card-based selections** for league type (matchup/duration)
- **Grid layout** for numeric options (league size: 4-20 players)
- **Stepper controls** for budget and draft rounds
- **TBD option** for draft date (nullable in database)

### 2. Safe Area Handling Fix
- Replaced `SafeAreaView` with manual padding using `useSafeAreaInsets()` hook
- Fixed header being hidden behind iPhone notch on fullScreenModal presentation
- Ensured back button and content are properly positioned

### 3. Header Centering
- Fixed off-center title by making back button and spacer equal width (44px each)
- Proper flexbox layout with `flex: 1` title area

### 4. Color Scheme Update
- Changed wizard accent colors from Sleeper's cyan (`#00CED1`) to app's blue (`#3b82f6`)
- Uses existing `Colors.primary`, `Colors.primaryBg`, `Colors.primaryLight` constants

### 5. TBD Draft Date Support
- Added `draftDateTBD` boolean state with radio button selection
- Draft date can now be `null` in database for "TBD" leagues
- Updated both mobile and web draft pages to show appropriate messaging:
  - "Draft date not set yet" notice
  - Commissioner prompt to set date before starting draft

## Files Modified/Created

### Mobile App - New Files
| File | Purpose |
|------|---------|
| `apps/mobile/app/create-league.tsx` | Multi-step league creation wizard with Sleeper-inspired UI |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/_layout.tsx` | Added `create-league` route with `fullScreenModal` presentation |
| `apps/mobile/components/LeagueCarousel.tsx` | Updated "Create or Join" card to navigate to wizard |
| `apps/mobile/app/(tabs)/draft.tsx` | Added TBD date handling with appropriate messaging |

### Web App - Modified Files
| File | Changes |
|------|---------|
| `apps/web/src/pages/DraftPage.jsx` | Added TBD draft date warning and commissioner prompt |

## Technical Notes

### useSafeAreaInsets() Pattern
```typescript
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const insets = useSafeAreaInsets();

return (
  <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    {/* content */}
  </View>
);
```
This approach works better than `SafeAreaView` with `edges` prop for `fullScreenModal` presentations.

### Wizard State Interface
```typescript
interface WizardState {
  name: string;
  leagueType: 'matchup' | 'duration' | null;
  teamCount: number;
  startingBudget: number;
  durationDays: number;
  matchupWeeks: number;
  draftRounds: number;
  playoffTeams: number;
  draftDate: Date | null;
  draftDateTBD: boolean;
}
```

## Next Steps

### Pending
- [ ] Add Join League flow (join by invite code)
- [ ] League settings screen for commissioners

---

# January 17, 2026

## What We Accomplished

### 1. Real-Time Standings & Matchup Updates (Web)
- Created week status utility (`apps/web/src/utils/weekStatus.js`)
- Created real-time subscription hook (`apps/web/src/hooks/useRealtimeStandings.js`)
- Created active week polling hook (`apps/web/src/hooks/useActiveWeekPolling.js`)
- Created `WeekIndicator.jsx`, `WeekNavigator.jsx`, `StatusBadge.jsx` components
- Database migration to enable realtime on `league_standings` and `matchups` tables

### 2. Mobile App Navigation Redesign (ESPN-Style)
- **LeagueSwitcher Component** (`apps/mobile/components/LeagueSwitcher.tsx`)
  - Sticky header bar with league icon + name + dropdown caret
  - Modal dropdown showing all user's leagues
  - Active league highlighted with checkmark
  - Used on Portfolio, Matchup, Leaderboard, and Draft pages

- **LeagueCarousel Component** (`apps/mobile/components/LeagueCarousel.tsx`)
  - Horizontal swipeable league cards on Home page
  - Shows league icon (🤑 matchup, 📈 duration), name, and record
  - Active league highlighted with green border
  - "Create or Join" card at the end
  - Page indicators at bottom

- **Navigation Changes**
  - Renamed "Dashboard" tab to "Home"
  - Added "Stockpile" app name header on Home page
  - Hidden "Leagues" tab (functionality merged into dropdown)
  - Made all headers sticky (stay fixed while scrolling)
  - Moved WeekNavigator below scoreboard on Matchup page

### 3. Bot Feature Restriction
- Restricted bot draft feature to `fantasyfinanceleague@gmail.com` only
- Added email check in `DraftSetupModal.jsx`

### 4. Week 3 Testing Setup
- Advanced test league (id: 23d19e02-5a1b-4837-9bb9-fbfb341dd15d) to week 3
- Prepared for manual snapshot testing (Friday-only week for testing)

## Files Modified/Created

### Mobile App - New Files
| File | Purpose |
|------|---------|
| `apps/mobile/components/LeagueSwitcher.tsx` | League dropdown header component |
| `apps/mobile/components/LeagueCarousel.tsx` | Swipeable league cards for Home page |
| `apps/mobile/components/WeekNavigator.tsx` | Week navigation arrows |
| `apps/mobile/components/WeekIndicator.tsx` | Week number + status display |
| `apps/mobile/components/StatusBadge.tsx` | Final/Live/Holiday badges |

### Mobile App - Modified Files
| File | Changes |
|------|---------|
| `apps/mobile/app/(tabs)/matchup.tsx` | Added LeagueSwitcher, moved WeekNavigator below scoreboard |
| `apps/mobile/app/(tabs)/leaderboard.tsx` | Added LeagueSwitcher with sticky header |
| `apps/mobile/app/(tabs)/portfolio.tsx` | Added LeagueSwitcher with sticky header |
| `apps/mobile/app/(tabs)/draft.tsx` | Added LeagueSwitcher to all return states |
| `apps/mobile/app/(tabs)/index.tsx` | Replaced with LeagueCarousel, added "Stockpile" header |
| `apps/mobile/app/(tabs)/_layout.tsx` | Renamed Dashboard→Home, hidden Leagues tab |

### Web App - New Files
| File | Purpose |
|------|---------|
| `apps/web/src/utils/weekStatus.js` | Week timing, status, holiday detection |
| `apps/web/src/hooks/useRealtimeStandings.js` | Real-time subscription hook |
| `apps/web/src/hooks/useActiveWeekPolling.js` | 5-minute price refresh during active weeks |
| `apps/web/src/components/WeekIndicator.jsx` | Week number + status display |
| `apps/web/src/components/WeekNavigator.jsx` | Arrow navigation for matchups |
| `apps/web/src/components/StatusBadge.jsx` | Status badges (Final, Live, etc.) |

### Web App - Modified Files
| File | Changes |
|------|---------|
| `apps/web/src/components/DraftSetupModal.jsx` | Restricted bot feature to specific email |
| `apps/web/src/pages/DraftPage.jsx` | Pass userEmail prop to DraftSetupModal |

### Database
| File | Purpose |
|------|---------|
| `supabase/migrations/20260116100000_enable_standings_realtime.sql` | Enable realtime on standings/matchups tables |

## Next Steps

### Immediate (Week 3 Testing)
- [ ] Run `SELECT trigger_week_snapshot();` when market opens
- [ ] Run `SELECT process_weekly_matchups(23d19e02-5a1b-4837-9bb9-fbfb341dd15d, 3);` after 4 PM ET

### Later
- [ ] Test real-time subscription updates work on web
- [ ] Test mobile week navigation with historical weeks
- [ ] Add champion banner for completed seasons

---

# January 15, 2026

## What We Accomplished

### 1. Automated Weekly Matchup Processing
- Set up complete cron job system for automatic matchup scoring
- Three scheduled functions:
  - `snapshot-week-start`: Monday 9:35 AM ET (+ Tuesday backup)
  - `snapshot-week-end`: Friday 4:05 PM ET
  - `process-weekly-matchups`: Friday 4:15 PM ET
- Holiday detection via Alpaca Calendar API
- Retry mechanism: 3 attempts, 5 minutes apart

### 2. Scoring System Redesign
- Changed from Tuesday-Friday to **Monday-Friday** weeks
- Both start AND end prices now stored in `week_snapshots` table
- New `week_end_price` column added
- Mid-week trade tracking:
  - Stocks held all week: `quantity × (friday_close - monday_open)`
  - Stocks sold mid-week: `quantity × (sale_price - monday_open)`
  - Stocks bought mid-week: `quantity × (friday_close - purchase_price)`
- Empty portfolio = automatic loss
- Tiebreaker: percentage gain first, then true tie (0.5 wins each)

### 3. Database Schema Updates
- Added `week_end_price` column to `week_snapshots`
- Added `is_tie` column to `matchups`
- Changed standings columns to `NUMERIC(5,1)` for half-wins
- Created `cron_job_status` table for retry tracking
- New helper functions: `trigger_week_end_snapshot()`, `schedule_snapshot_retry()`

### 4. Edge Function Fixes
- Fixed duplicate `weekNumber` variable declaration bug
- Updated `process-week-results` with new scoring logic
- Created new `snapshot-week-end` function
- Added holiday detection and retry logic to `snapshot-week-start`

### 5. Vault Integration
- Service role key stored securely in Supabase Vault
- Cron jobs authenticate via vault secret

## Files Modified/Created

| File | Changes |
|------|---------|
| `supabase/migrations/20260116000000_matchup_scoring_redesign.sql` | **NEW** - Schema + cron updates |
| `supabase/functions/snapshot-week-start/index.ts` | Holiday detection, retry logic |
| `supabase/functions/snapshot-week-end/index.ts` | **NEW** - Friday close snapshot |
| `supabase/functions/process-week-results/index.ts` | New dollar-gain scoring |

## Next Steps

### Immediate
- [ ] **Real-Time Standings Auto-Refresh** - Add Supabase subscriptions to `league_standings`
  - Web: `apps/web/src/pages/Leaderboard.jsx`
  - Mobile: `apps/mobile/app/(tabs)/leaderboard.tsx`

### Later
- [ ] Email notifications for matchup results
- [ ] Push notifications

---

# January 7, 2026

## What We Accomplished

### 1. Create League Functionality (App)
- Added create league modal to `app/(tabs)/leagues.tsx`
- Synced all form fields with website:
  - League name with content moderation
  - League type (Duration/Matchup)
  - Number of teams (min 4, max 20, default 12)
  - Draft rounds
  - Number of weeks (for matchup leagues)
  - Starting budget
  - Draft date/time picker (required)
  - Duration options (7, 30, 90, 180, 365 days)
  - Playoff teams selector (for matchup leagues)
- Auto-generates invite codes for sharing

### 2. League Detail View (App)
- Added league detail modal when tapping a league
- Shows league status badges (Draft Pending, Active, Completed)
- Quick stats grid (Members, Type, Budget, Draft Date)
- Action buttons:
  - View Dashboard
  - Leaderboard
  - Share Invite Code
- League info card with all settings
- Members list with usernames from `user_profiles` table

### 3. Account Creation Sync (App ↔ Website)
- Added username field during signup
- Username validation:
  - 3-20 characters
  - Alphanumeric + underscores only
  - Unique (database constraint)
- Profile creation in `user_profiles` table on signup
- User-friendly error messages for common auth errors

### 4. Content Moderation
- Created `lib/contentModeration.ts`
- `validateLeagueName()` - checks league names for inappropriate content
- `validateUsername()` - checks usernames for inappropriate content
- Blocks profanity, slurs, hate speech, and common evasion patterns

### 5. Draft Functionality (App)
- Created complete draft screen at `app/(tabs)/draft.tsx`
- Features:
  - League selector dropdown
  - Draft status display (waiting, in progress, completed)
  - Current turn indicator
  - Stock search with real-time results
  - Pick submission with budget tracking
  - Snake draft logic (odd rounds forward, even rounds reverse)
  - Draft order display
  - Real-time updates via Supabase subscriptions
- Added Draft tab to navigation with gavel icon

### 6. Bug Fixes
- Fixed `duration_days` NULL constraint violation (set default to 30)
- Fixed `duration_days` check constraint (only allows 7, 30, 90, 180, 365)
- Fixed DateTimePicker dark mode visibility (added `themeVariant="dark"`)
- Fixed members showing "Unknown" (changed to `user_profiles.username`)
- Changed "Avg Entry" to "Cost" on portfolio pages (app + website)

### 7. Alpaca API Research
- Documented differences between Trading API and Broker API
- **Trading API**: User connects their own Alpaca account
- **Broker API**: You create/manage accounts for users (requires broker-dealer partnership)
- Recommendation: Keep Trading API for now, supports both paper and live trading

---

## Git Commits (This Session)
```
5baaca5 Add draft functionality, league details, and sync signup with website
96332ff Make draft date required and fix duration_days constraint
bf2e741 Sync create league form with website and update portfolio labels
ef25e17 Add weekly matchup system and past results
87bbead Initial commit
```

---

## Files Modified/Created

### App (React Native)
| File | Changes |
|------|---------|
| `app/(tabs)/leagues.tsx` | Create league modal, league detail modal, member fetching |
| `app/(tabs)/draft.tsx` | **NEW** - Complete draft screen |
| `app/(tabs)/_layout.tsx` | Added Draft tab to navigation |
| `app/(tabs)/portfolio.tsx` | Changed "Avg Entry" to "Cost" |
| `app/login.tsx` | Username field, validation, profile creation |
| `lib/contentModeration.ts` | **NEW** - Content moderation utilities |

### Website (React)
| File | Changes |
|------|---------|
| `src/pages/Leagues.jsx` | Draft date required, duration_days fix |
| `src/pages/PortfolioPage.jsx` | Changed "Avg Entry" to "Cost" |

---

## Next Steps / Todo

### High Priority
- [ ] **Test draft flow end-to-end** - Verify draft works with multiple users
- [ ] **Add draft notifications** - Alert users when it's their turn
- [ ] **Implement commissioner draft controls** - Start/pause/reset draft
- [ ] **Add trade functionality** - Allow users to trade stocks between picks

### Medium Priority
- [ ] **Real money trading option** - Allow users to connect their own Alpaca account (live trading)
- [ ] **Matchup screen** - Display head-to-head weekly matchups
- [ ] **Push notifications** - Notify users of draft turns, matchup results, etc.
- [ ] **Improve stock search** - Add filters, sorting, and stock details

### Low Priority / Future
- [ ] **Broker API migration** - If you want to manage user accounts directly
- [ ] **Social features** - Chat within leagues, trash talk
- [ ] **Historical performance** - Track user performance across seasons
- [ ] **Achievements/badges** - Gamification elements

---

## Technical Notes

### Alpaca API Strategy
- **Current**: Trading API with paper trading (sandbox)
- **For real money**: Trading API still works - user provides their own API keys
- **Future option**: Broker API only if you want to create/manage brokerage accounts for users (requires compliance, KYC, etc.)

### Database Tables Used
- `leagues` - League configuration and settings
- `league_members` - User membership in leagues
- `user_profiles` - Username and profile data
- `draft_picks` - Completed draft selections
- `portfolios` - User stock holdings

### Real-time Subscriptions
The draft screen uses Supabase real-time subscriptions to:
- Update when new picks are made
- Show current turn changes
- Reflect draft completion status
