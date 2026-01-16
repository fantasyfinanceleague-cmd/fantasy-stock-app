# Fantasy Stock App - Session Recaps

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
