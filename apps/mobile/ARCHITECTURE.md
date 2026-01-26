# Stockpile Mobile App - Architecture Guide

This document provides a comprehensive overview of the mobile app architecture for developers and AI assistants working on the codebase.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Navigation & Routing](#navigation--routing)
4. [State Management](#state-management)
5. [Screens](#screens)
6. [Components](#components)
7. [Data Layer & Hooks](#data-layer--hooks)
8. [Styling & Theme](#styling--theme)
9. [Authentication](#authentication)
10. [Real-Time Features](#real-time-features)
11. [Push Notifications](#push-notifications)
12. [Key Patterns](#key-patterns)
13. [Database Schema Reference](#database-schema-reference)

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| React Native | Cross-platform mobile framework |
| Expo | Development platform & build tools |
| Expo Router | File-based navigation |
| Supabase | Auth, Database, Real-time, Edge Functions |
| TypeScript | Type safety |
| AsyncStorage | Session persistence |

---

## Project Structure

```
apps/mobile/
├── app/                          # Expo Router pages (file-based routing)
│   ├── _layout.tsx              # Root layout with LeagueProvider and DarkTheme
│   ├── login.tsx                # Authentication screen
│   ├── (tabs)/                  # Tabbed navigation group
│   │   ├── _layout.tsx          # Tab bar configuration
│   │   ├── index.tsx            # Home - league carousel, past matchups
│   │   ├── portfolio.tsx        # Holdings, P&L, trading
│   │   ├── matchup.tsx          # Weekly matchup comparison
│   │   ├── draft.tsx            # Snake draft interface
│   │   ├── league.tsx           # Standings, schedule, history
│   │   ├── leagues.tsx          # League browser (hidden from tabs)
│   │   └── profile.tsx          # User settings, Alpaca credentials
│   ├── create-league.tsx        # Multi-step league creation wizard
│   ├── join-league.tsx          # Join league by invite code
│   ├── league-settings.tsx      # Commissioner settings
│   ├── player-portfolio.tsx     # View another player's portfolio
│   └── modal.tsx                # Generic modal template
│
├── components/                   # Reusable UI components
│   ├── LeagueSwitcher.tsx       # League dropdown header
│   ├── LeagueCarousel.tsx       # Swipeable league cards
│   ├── WeekNavigator.tsx        # Week navigation arrows
│   ├── WeekIndicator.tsx        # Week number + status
│   ├── StatusBadge.tsx          # Final/Live/Holiday badges
│   ├── PortfolioChart.tsx       # Chart visualization
│   ├── Skeleton.tsx             # Loading placeholders
│   └── ...
│
├── lib/                          # Business logic and hooks
│   ├── LeagueContext.tsx        # Global league state management
│   ├── useAuth.ts               # Auth state and sign in/out
│   ├── useLeagues.ts            # Fetch user's leagues
│   ├── usePortfolio.ts          # Holdings and P&L calculations
│   ├── useStockPrices.ts        # Price fetching with caching
│   ├── supabase.ts              # Supabase client initialization
│   ├── notifications.ts         # Push notification service
│   ├── weekStatus.ts            # Week/season status logic
│   └── contentModeration.ts     # Username/league name validation
│
├── constants/
│   └── Colors.ts                # Theme colors (dark mode)
│
├── app.json                     # Expo configuration
├── eas.json                     # EAS Build configuration
└── package.json
```

---

## Navigation & Routing

### Expo Router (File-Based)

Routes are defined by file structure in `app/` directory.

### Root Layout (`app/_layout.tsx`)

Wraps the entire app with:
- `LeagueProvider` - global league state
- `DarkTheme` - dark mode styling
- Notification listeners for push notifications

```typescript
// Stack routes defined in root layout
<Stack>
  <Stack.Screen name="(tabs)" />           // Main tab interface
  <Stack.Screen name="login" />            // Auth modal
  <Stack.Screen name="create-league" />    // Full-screen modal
  <Stack.Screen name="join-league" />      // Full-screen modal
  <Stack.Screen name="league-settings" />  // Modal
  <Stack.Screen name="player-portfolio" /> // Modal
</Stack>
```

### Tab Navigation (`app/(tabs)/_layout.tsx`)

6 tabs configured (1 hidden):

| Tab | File | Icon | Description |
|-----|------|------|-------------|
| Home | `index.tsx` | `home` | Dashboard with league carousel |
| Draft | `draft.tsx` | `gavel` | Snake draft interface |
| Portfolio | `portfolio.tsx` | `pie-chart` | Holdings & P&L |
| Matchup | `matchup.tsx` | `git-compare` | Weekly head-to-head |
| League | `league.tsx` | `trophy` | Standings & history |
| Profile | `profile.tsx` | `user` | Settings |
| *(hidden)* Leagues | `leagues.tsx` | - | League browser |

### Navigation Patterns

```typescript
// Navigate to tab
router.push('/(tabs)/matchup')

// Navigate with params
router.push({ pathname: '/(tabs)/matchup', params: { matchupId, visibleWeek } })

// Open modal
router.push('/create-league')

// Deep link from notification
router.push('/(tabs)/draft')
```

---

## State Management

### LeagueContext (`lib/LeagueContext.tsx`)

Central state for league selection across the app.

```typescript
interface LeagueContextType {
  leagues: League[]              // All leagues user belongs to
  activeLeagueId: string | null  // Currently selected league ID
  activeLeague: League | null    // Computed from activeLeagueId
  loading: boolean
  setActiveLeagueId: (id: string | null) => void
  refresh: () => Promise<void>
}
```

**Usage:**
```typescript
const { activeLeague, setActiveLeagueId, refresh } = useLeagueContext()
```

**Data Flow:**
1. On mount, fetches user's league memberships from `league_members`
2. Loads full league details from `leagues` table
3. Auto-selects first league if none active
4. Refreshes on auth state changes

### League Interface

```typescript
interface League {
  id: string
  name: string
  invite_code: string
  commissioner_id: string
  draft_status: 'not_started' | 'in_progress' | 'completed'
  draft_date: string | null
  budget_mode: 'budget' | 'no-budget'
  budget_amount: number | null
  league_type: 'duration' | 'matchup'
  current_week: number
  num_weeks?: number
  num_rounds: number
  num_participants: number
  salary_cap_limit: number | null
  duration_days: number
  playoff_teams: number
  current_season_id: string | null
  season_status: 'active' | 'completed'
}

interface LeagueSeason {
  id: string
  league_id: string
  season_number: number
  champion_user_id: string | null
  runner_up_user_id: string | null
  started_at: string
  completed_at: string | null
  final_standings: FinalStanding[] | null
}
```

---

## Screens

### Home (`app/(tabs)/index.tsx`)

**Purpose:** Dashboard and league overview

**Features:**
- League carousel (swipeable cards)
- Portfolio summary for active league
- Past 5 matchup results
- "Create or Join" prompt on last card

**Data Fetched:**
- Matchups for current user
- League seasons for champion info
- User profiles for display names

### Portfolio (`app/(tabs)/portfolio.tsx`)

**Purpose:** View holdings and performance

**Features:**
- LeagueSwitcher header
- Portfolio metrics (total value, budget remaining)
- P&L summary with gain/loss
- Holdings list with:
  - Symbol, quantity, cost basis, current price
  - Per-holding gain/loss (color coded)
  - Buy/Sell buttons (opens web app)

**Data Flow:**
```
drafts + trades → usePortfolio → holdings → + prices → P&L display
```

### Matchup (`app/(tabs)/matchup.tsx`)

**Purpose:** Weekly head-to-head comparison

**Features:**
- Week navigator (browse past weeks)
- Team comparison scoreboard
- Holdings comparison by symbol
- Status badge (Live/Final)
- Accepts `matchupId` param to show specific matchup

**Params:**
```typescript
// View specific matchup
router.push({ pathname: '/(tabs)/matchup', params: { matchupId: '...', visibleWeek: 3 } })
```

### Draft (`app/(tabs)/draft.tsx`)

**Purpose:** Snake draft interface

**Features:**
- Stock symbol search
- Current turn indicator
- Round/pick display
- Pick history by round
- Budget tracking
- Real-time updates via subscription

**Snake Draft Logic:**
- Odd rounds: forward order (1→N)
- Even rounds: reverse order (N→1)
- Total picks: `numTeams × numRounds`

### League (`app/(tabs)/league.tsx`)

**Purpose:** Standings, schedule, and history

**Sections (collapsible):**
1. **Standings** - Current rankings with W-L-T, KPI cards
2. **Schedule** - Player picker, view any user's matchup schedule
3. **History** - ESPN-style past seasons with your finish

**Real-Time:**
- Subscribes to `league_standings` changes
- Animated rank changes

### Profile (`app/(tabs)/profile.tsx`)

**Purpose:** User settings

**Features:**
- Avatar emoji picker (32 options)
- Username editing
- Password change
- Alpaca broker credentials
- Sign out

---

## Components

### LeagueSwitcher (`components/LeagueSwitcher.tsx`)

Dropdown header for quick league switching.

```typescript
<LeagueSwitcher />
```

**Used in:** Portfolio, Matchup, Draft, League screens

**Features:**
- Shows league name + icon emoji
- Dropdown modal with all leagues
- Active league highlighted
- Sticky positioning

### LeagueCarousel (`components/LeagueCarousel.tsx`)

Swipeable league cards for Home screen.

```typescript
<LeagueCarousel onCreatePress={() => router.push('/create-league')} />
```

**Features:**
- League icon, name, season info
- Current record display
- Champion/runner-up badges
- Share button, settings button (commissioner)
- "Create or Join" card at end
- Page indicators

### WeekNavigator (`components/WeekNavigator.tsx`)

Navigate between matchup weeks.

```typescript
<WeekNavigator
  currentWeek={3}
  totalWeeks={12}
  visibleWeek={visibleWeek}
  onWeekChange={setVisibleWeek}
/>
```

### StatusBadge (`components/StatusBadge.tsx`)

Visual status indicators.

```typescript
<StatusBadge type="live" />   // Red, animated pulse
<StatusBadge type="final" />  // Green
<StatusBadge type="holiday" /> // Amber
<StatusBadge type="champion" /> // Gold
```

### Skeleton (`components/Skeleton.tsx`)

Loading placeholders with shimmer animation.

```typescript
<Skeleton width={100} height={20} />
<SkeletonCard />
<SkeletonHolding />
```

---

## Data Layer & Hooks

### useAuth (`lib/useAuth.ts`)

```typescript
const { session, user, loading, signOut } = useAuth()
```

**Responsibilities:**
- Initialize session from AsyncStorage
- Listen to auth state changes
- Register/remove push tokens
- Handle sign out cleanup

### usePortfolio (`lib/usePortfolio.ts`)

```typescript
const { holdings, portfolioSummary, loading, refresh } = usePortfolio(leagueId)
```

**Returns:**
```typescript
interface Holding {
  symbol: string
  quantity: number
  avgEntryPrice: number
  totalCost: number
  currentPrice: number | null
  currentValue: number | null
  gainLoss: number | null
  gainLossPercent: number | null
}

interface PortfolioSummary {
  totalCost: number
  totalValue: number
  totalGainLoss: number
  totalGainLossPercent: number
  holdingsCount: number
}
```

**Logic:**
- Fetches draft picks and trades
- Aggregates by symbol
- Calculates cost basis (handles partial sells)
- Merges with live prices

### useStockPrices (`lib/useStockPrices.ts`)

```typescript
const { prices, loading, getPrice, refresh } = useStockPrices(symbols)
```

**Features:**
- 2-minute client-side cache
- Rate limiting (100ms between requests)
- Max 3 concurrent requests
- Calls `ticker-quotes` edge function

**Returns:**
```typescript
interface StockPrice {
  symbol: string
  price: number
  prevClose: number | null
  changePercent: number | null
  fetchedAt: number
}
```

### weekStatus (`lib/weekStatus.ts`)

Week and market status calculations.

```typescript
const status = getWeekStatus(leagueStartDate, currentWeek)
// Returns: 'active' | 'final' | 'pending_results' | 'season_complete'
```

**Features:**
- US market holiday detection
- Week timing calculations
- Countdown to next week

---

## Styling & Theme

### Colors (`constants/Colors.ts`)

Dark theme palette:

```typescript
const Colors = {
  // Backgrounds
  background: '#0f172a',      // Main page
  headerBg: '#111827',        // Headers, tab bar
  cardBg: '#1e293b',          // Cards
  inputBg: '#1e293b',         // Form inputs

  // Text
  textPrimary: '#ffffff',
  textSecondary: '#e5e7eb',
  textMuted: '#9ca3af',

  // Accents
  primary: '#3b82f6',         // Blue
  primaryBg: 'rgba(59, 130, 246, 0.15)',
  success: '#16a34a',         // Green (gains)
  error: '#ef4444',           // Red (losses)
  warning: '#f59e0b',         // Amber

  // Special
  gold: '#fbbf24',            // Champion
  goldBg: 'rgba(251, 191, 36, 0.15)',
  silver: '#C0C0C0',          // Runner-up
  silverBg: 'rgba(192, 192, 192, 0.15)',

  // Borders
  border: '#374151',
  borderLight: '#4b5563',
}
```

### Styling Patterns

```typescript
// Component-scoped styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
  },
})

// Dynamic inline styles
<Text style={{ color: gainLoss >= 0 ? Colors.success : Colors.error }}>
  {gainLoss}
</Text>
```

### Typography

- System fonts + SpaceMono for code
- Sizes: 11 (labels), 12-14 (body), 16-18 (headings), 28+ (titles)
- Weights: 400, 500, 600, 700

---

## Authentication

### Login Flow (`app/login.tsx`)

1. User enters email/password (or creates account)
2. Supabase auth creates session
3. Session stored in AsyncStorage
4. Push token registered
5. Navigate to Home

### Session Persistence

```typescript
// Supabase client config (lib/supabase.ts)
const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    storageKey: 'fantasy-finance-auth',
  }
})
```

### Signup Validation

- Username: 3-20 chars, alphanumeric + underscore
- Password: 6+ characters
- Content moderation on username
- Creates `user_profiles` record

---

## Real-Time Features

### Supabase Subscriptions

```typescript
// Subscribe to standings changes
const channel = supabase
  .channel('standings-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'league_standings', filter: `league_id=eq.${leagueId}` },
    (payload) => {
      // Handle update
    }
  )
  .subscribe()

// Cleanup
return () => supabase.removeChannel(channel)
```

**Tables with real-time enabled:**
- `league_standings` - rank changes
- `matchups` - score updates
- `drafts` - draft picks

---

## Push Notifications

### Setup (`lib/notifications.ts`)

```typescript
// Register on login
await setupPushNotifications(userId)

// Remove on logout
await removePushToken(userId)
```

### Notification Types

| Event | Destination | Message |
|-------|-------------|---------|
| Draft turn | `/(tabs)/draft` | "It's your turn to pick!" |
| Matchup result | `/(tabs)/matchup` | "Week X results are in" |

### Configuration

- Uses Expo Push Notifications
- EAS Project ID: `762da87e-578d-4041-ae85-37d8aa312187`
- Tokens stored in `user_profiles.expo_push_token`

---

## Key Patterns

### 1. Context + Hooks Pattern
```typescript
// Provider wraps app
<LeagueProvider>
  <App />
</LeagueProvider>

// Components consume via hook
const { activeLeague } = useLeagueContext()
```

### 2. Computed Data Pattern
Holdings are computed, not stored:
```typescript
drafts + trades → aggregation → holdings → + prices → P&L
```

### 3. Intelligent Caching
```typescript
// Check cache before fetching
if (cache[symbol] && Date.now() - cache[symbol].fetchedAt < TTL) {
  return cache[symbol]
}
```

### 4. Safe Area Handling
```typescript
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const insets = useSafeAreaInsets()
<View style={{ paddingTop: insets.top }}>
```

### 5. Pull-to-Refresh
```typescript
<ScrollView
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
  }
>
```

---

## Database Schema Reference

### Core Tables

| Table | Purpose |
|-------|---------|
| `leagues` | League configuration |
| `league_members` | User memberships |
| `league_standings` | Win/loss records |
| `league_seasons` | Multi-season tracking |
| `matchups` | Weekly matchup results |
| `drafts` | Draft picks |
| `trades` | Buy/sell transactions |
| `user_profiles` | User data, push tokens |
| `week_snapshots` | Monday/Friday price snapshots |

### Key Relationships

```
user_profiles
  └── league_members (user_id)
        └── leagues (league_id)
              ├── league_standings
              ├── league_seasons
              ├── matchups
              └── drafts
                    └── trades
```

### Edge Functions

| Function | Purpose |
|----------|---------|
| `ticker-quotes` | Fetch stock prices |
| `snapshot-week-start` | Monday price snapshot |
| `snapshot-week-end` | Friday price snapshot |
| `process-week-results` | Calculate matchup winners |

---

## Development Commands

```bash
# Start development server
cd apps/mobile
npx expo start

# Run on iOS simulator
npx expo run:ios

# Run on Android emulator
npx expo run:android

# Build development client
eas build --profile development --platform ios

# Build production
eas build --profile production --platform all
```

---

*Last updated: January 25, 2026*
