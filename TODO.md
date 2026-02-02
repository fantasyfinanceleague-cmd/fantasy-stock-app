# Fantasy Stock App - Improvements Roadmap

## Mobile App Status (React Native/Expo)

### Fully Implemented ✅
- [x] Authentication (sign up/sign in with username, content moderation)
- [x] League management (create, view details, member list)
- [x] Join league by invite code
- [x] Share invite code from league cards
- [x] League settings for commissioners (edit name, draft date, budget, teams, stocks)
- [x] Push notifications for draft turns
- [x] Draft functionality (full snake draft with real-time updates)
- [x] Portfolio viewing (holdings, P/L, cost basis)
- [x] Matchups (head-to-head view, weekly gains, past results)
- [x] Leaderboard/Standings (rankings, W-L-T records)
- [x] Profile management (avatar selection, username editing)
- [x] League context (switch between leagues)
- [x] Stock price caching with rates limiting
- [x] Dark theme throughout
- [x] ESPN-style league switcher dropdown (all pages)
- [x] Swipeable league carousel (Home page)
- [x] Sticky headers on all main pages
- [x] Week navigation for viewing past matchups
- [x] Real-time subscriptions for standings/matchups

### Mobile App - Not Yet Implemented
- [x] Native trading ✅ (Jan 25, 2026 - TradeModal with search autocomplete Feb 1, 2026)
- [ ] Trade history (currently opens web app)
- [x] Join league by invite code ✅ (Jan 22, 2026)
- [x] Push notifications (draft turns) ✅ (Jan 22, 2026)
- [ ] Push notifications (matchup results, invites)
- [ ] Password reset flow
- [ ] Settings/preferences screen
- [ ] Help/documentation
- [x] Stock name display alongside symbols ✅ (Feb 1, 2026 - Portfolio and P/L Breakdown)
- [x] Search suggestions dropdown (like web has) instead of plain text input ✅ (Feb 1, 2026 - TradeModal)

### Known Issues / Bugs to Investigate
- [x] **Bot draft race condition** - FIXED (Jan 8, 2026)
  - **Problem:** Bot auto-pick logic triggered twice simultaneously, causing duplicate pick_numbers
  - **Root cause:** React state-based lock (`botPickInProgress`) was async, allowing race conditions
  - **Fix applied:**
    1. Added `botPickLockRef` (useRef) for immediate synchronous locking
    2. Added pre-insert check to verify pick_number doesn't already exist
    3. Added handling for unique constraint violation errors (code 23505)
    4. Database constraint `drafts_league_pick_unique UNIQUE (league_id, pick_number)` applied
  - **Verification:** Existing duplicate picks (11, 13) manually corrected. Full constraint active.

### Recently Completed (Feb 1, 2026)
- [x] **Company Names in Portfolio & P/L Breakdown**
  - Created `useStockNames.ts` hook for fetching/caching company names
  - Added `abbreviateName()` utility for long names (removes Inc., Corp., etc.)
  - Portfolio page shows company name below each holding
  - P/L Breakdown Modal shows company names for all positions

- [x] **P/L Breakdown Modal Improvements**
  - Fixed badge styling (Drafted/Bought badges no longer stretch full width)
  - Added proper `badgeRow` container with flex layout

- [x] **Historical Bars Edge Function**
  - New `historical-bars` Supabase function for fetching Alpaca daily bars
  - Supports multiple symbols and date range queries
  - Created `useHistoricalPL.ts` hook for P/L history calculations

- [x] **TradeModal Stock Search with Autocomplete (Mobile + Web)**
  - Search by ticker OR company name with relevance-based results
  - Real-time prices displayed in dropdown
  - Uses `symbols-search` edge function

- [x] **TradeModal UX Bug Fixes**
  - Fixed VirtualizedLists error (replaced FlatList with ScrollView + map)
  - Fixed permanent refresh spinner (reset loading state properly)
  - Fixed keyboard overlap (dismiss keyboard when results appear)

- [x] **Cron Job Logging for process-week-results**
  - Added `updateJobStatus()` logging to `cron_job_status` table
  - Now tracks running/success/failed status like other cron functions
  - Deployed updated edge function

### Recently Completed (Jan 22, 2026)
- [x] **Join League by Invite Code (Mobile)**
  - Created `join-league.tsx` with two-step flow (code input → league preview)
  - Validates against both `leagues.invite_code` and `league_invites.code` tables
  - Shows league preview with name, type, members, budget, draft status
  - Error handling for invalid codes, full leagues, already a member
  - Wired "Join a League" button in create-league wizard

- [x] **Share Invite Code (Mobile)**
  - Added share button to league cards in LeagueCarousel
  - Shows invite code alert with Copy/Share options
  - Native share sheet integration

- [x] **League Settings for Commissioners (Mobile)**
  - Created `league-settings.tsx` with full editing capabilities
  - Editable: name, draft date, budget mode/amount, team count, stocks per team
  - Lock mechanism when draft is in progress or completed
  - Settings gear icon on league cards (commissioners only)
  - Read-only section showing league type, duration, invite code

- [x] **League Carousel Sync**
  - Swiping through leagues now updates portfolio/allocation/matchups
  - "Create or Join" prompt shown when on the last card
  - Expanded League interface with all database fields

- [x] **Push Notifications (Draft Turns)**
  - Installed `expo-notifications` and `expo-device`
  - Created notification service for token registration and sending
  - Database migration for `expo_push_token` on `user_profiles`
  - Auth integration (register on login, remove on logout)
  - Draft screen sends notification to next player after each pick
  - Deep linking to Draft screen when notification tapped

- [x] **EAS Development Build**
  - Configured EAS Build for real device testing
  - Set up iOS bundle identifier and APNs key
  - Enabled full native module support on physical device

### Recently Completed (Jan 17, 2026)
- [x] **Real-Time Standings & Matchup Updates (Web)**
  - Created `weekStatus.js` utility for week timing and holiday detection
  - Created `useRealtimeStandings.js` hook for Supabase subscriptions
  - Created `useActiveWeekPolling.js` hook for 5-minute price refresh
  - Created `WeekIndicator.jsx`, `WeekNavigator.jsx`, `StatusBadge.jsx` components
  - Enabled realtime on `league_standings` and `matchups` tables

- [x] **Mobile App Navigation Redesign (ESPN-Style)**
  - Created `LeagueSwitcher.tsx` - sticky header with league dropdown
  - Created `LeagueCarousel.tsx` - swipeable league cards on Home page
  - Created `WeekNavigator.tsx`, `WeekIndicator.tsx`, `StatusBadge.tsx` for mobile
  - Renamed "Dashboard" tab to "Home" with "Stockpile" branding
  - Hidden "Leagues" tab (merged into dropdown)
  - Made headers sticky on all pages (Portfolio, Matchup, Leaderboard, Draft)
  - Moved WeekNavigator below scoreboard on Matchup page

- [x] **Bot Feature Restriction**
  - Restricted bot draft feature to `fantasyfinanceleague@gmail.com` only

### Recently Completed (Jan 15, 2026)
- [x] **Automated Weekly Matchup Processing** - Full cron job setup
  - `snapshot-week-start`: Monday 9:35 AM ET (captures opening prices)
  - `snapshot-week-end`: Friday 4:05 PM ET (captures closing prices)
  - `process-weekly-matchups`: Friday 4:15 PM ET (calculates results)
  - Holiday detection via Alpaca Calendar API (skips Monday if holiday, runs Tuesday)
  - Retry mechanism: 3 retries, 5 minutes apart, then alert

- [x] **New Scoring System Redesign**
  - Changed from Tuesday-Friday to Monday-Friday weeks
  - Both start AND end prices stored in `week_snapshots` table
  - Mid-week trade tracking:
    - Stocks held all week: `quantity × (friday_close - monday_open)`
    - Stocks sold mid-week: `quantity × (sale_price - monday_open)`
    - Stocks bought mid-week: `quantity × (friday_close - purchase_price)`
  - Empty portfolio = automatic loss
  - Tiebreaker: percentage gain first, then true tie (0.5 wins each)
  - Support for half-wins in standings (NUMERIC columns)

- [x] **Edge Function Fixes**
  - Fixed duplicate `weekNumber` variable declaration bug in `process-week-results`
  - Added `week_end_price` column to `week_snapshots` table
  - Added `is_tie` column to `matchups` table
  - Created `cron_job_status` table for retry tracking
  - New `trigger_week_end_snapshot()` helper function

- [x] **Vault Integration**
  - Service role key stored securely in Supabase Vault
  - Cron jobs authenticate via vault secret

### Recently Completed (Jan 8-9, 2026)
- [x] **Modern UI Redesign** - Sleeper/Robinhood-inspired dark theme
  - Glassmorphism cards with gradient backgrounds and subtle borders
  - Redesigned search input with icon and avatar-based dropdown suggestions
  - Unified quote card design (removed grey/black split)
  - Your Stocks and Draft History boards side-by-side below search
  - Stock names displayed with truncation (SYMBOL - Company Name...)
  - Round selector dropdown with auto-switch to current round
  - Updated Leagues page with modern styling
  - Mobile app draft completed screen improvements

- [x] **Search Improvements**
  - Relevance-based ordering: exact symbol > starts-with > name starts > contains
  - Fixed dropdown selection bug (was using typed text instead of selected symbol)
  - Deployed updated symbols-search edge function

- [x] **Bot Auto-Pick Improvements**
  - Expanded stock pool from ~48 to ~130 stocks across price tiers
  - Bots now have more options to avoid skipping picks

- [x] **Bug Fixes**
  - Fixed 406 error by using `.maybeSingle()` for duplicate pick check
  - Fixed CORS issues for localhost development
  - Better error messages for quote failures (credentials, not found, etc.)
  - Deployed all edge functions with proper CORS headers

---

## High Priority (Should Have)

### 0. Real-Time Standings Auto-Refresh ✅ COMPLETED (Jan 17)
- [x] Add Supabase real-time subscription to `league_standings` table (web)
- [x] Add Supabase real-time subscription to `league_standings` table (mobile)
- [x] Auto-refresh when `current_week` advances in `leagues` table
- [x] Week navigation for viewing past matchups
- [ ] Show "Last updated" timestamp on standings (optional, low priority)
- [ ] Optional: Add 30-60 second polling fallback for connection issues

### 1. Landing/Marketing Page
- [x] Create public-facing homepage explaining what the app is
- [x] Features section highlighting key functionality
- [x] "How it works" section with steps
- [ ] Screenshots/preview of the app
- [x] Call-to-action to sign up
- [x] Currently new visitors just see login screen

### 2. Email Notifications
- [ ] Draft starting soon reminders
- [ ] "It's your turn to pick" during live draft
- [ ] Weekly matchup results summary
- [ ] Trade day reminders (Mondays for matchup leagues)
- [ ] Invite received notifications
- [ ] Season/playoff start notifications

### 3. Mobile Responsiveness
- [ ] Audit all pages on mobile devices
- [ ] Draft page optimization (critical - hard to draft on phone)
- [ ] Dashboard layout for small screens
- [ ] Leaderboard table scrolling/layout
- [ ] Touch-friendly buttons and inputs

### 4. Error Handling & Edge Cases
- [x] Stock API down - show cached data or graceful message
- [x] Better error messages throughout (user-friendly, not technical)
- [x] Network failure handling
- [x] Session expiry handling
- [x] Rate limiting feedback

---

## Medium Priority (Nice to Have)

### 5. League Activity Feed
- [ ] Show recent draft picks
- [ ] Show trades made
- [ ] Show weekly results
- [ ] Timestamps and user avatars
- [ ] Could be on Dashboard or League Detail page

### 6. Trade Confirmations/History
- [ ] Trade history page showing all trades
- [ ] Confirmation modal before executing trade
- [ ] Trade receipt/summary after completion
- [ ] Option to filter by league

### 7. Password Reset Flow
- [ ] "Forgot password" link on login
- [ ] Email with reset link
- [ ] Reset password page
- [ ] Confirmation of successful reset

### 8. Help/FAQ Page
- [ ] How scoring works
- [ ] How matchups are determined
- [ ] How playoffs work
- [ ] How the draft works
- [ ] How trades work (trade windows, etc.)
- [ ] Budget/salary cap explanation
- [ ] Contact/support info

---

## Lower Priority (Future Enhancements)

### 9. Social Features
- [ ] League chat/messaging
- [ ] Share standings to Twitter/social media
- [ ] Invite via social platforms
- [ ] Public league profiles

### 10. Push Notifications
- [ ] Browser push notifications
- [ ] Mobile push (if PWA)
- [ ] Notification preferences/settings

### 11. Historical Data
- [ ] Past season archives
- [ ] All-time records
- [ ] Head-to-head history between users
- [ ] Personal stats dashboard

### 12. UI/UX Polish
- [ ] Dark/light mode toggle
- [ ] Theme customization
- [ ] Animations and transitions
- [ ] Skeleton loaders everywhere
- [ ] Confetti/celebration for wins

### 13. Advanced Features
- [ ] Mock drafts
- [ ] Draft rankings/cheat sheets
- [ ] Stock watchlist
- [ ] Price alerts
- [ ] League templates

---

## Recommended Starting Point

**Immediate Next Step:**
1. **Monitor Cron Jobs** - Verify `process-week-results` logs to `cron_job_status` after Friday Feb 6
2. **Champion Banner** - Add trophy/celebration for completed seasons

**Web App Priorities:**
1. **Landing Page Screenshots** - Only remaining item. Add app previews to complete the marketing page.
2. **Mobile Responsiveness** - Web app still needs work for mobile browsers (native app covers mobile users for now).

**Cross-Platform Priorities:**
1. **Email Notifications** - Critical for draft turns and matchup results.
2. **Password Reset Flow** - Users will forget passwords.

**Recently Completed (Feb 1):**
- ✅ Company names in Portfolio and P/L Breakdown (useStockNames hook, abbreviateName utility)
- ✅ P/L Breakdown Modal badge styling fix
- ✅ Historical bars edge function for Alpaca daily data
- ✅ TradeModal stock search with autocomplete (mobile + web)
- ✅ TradeModal UX bug fixes (VirtualizedLists, spinner, keyboard)
- ✅ Cron job logging for process-week-results

**Recently Completed (Jan 22):**
- ✅ Join league by invite code (mobile)
- ✅ Share invite code from league cards (mobile)
- ✅ League settings for commissioners (mobile)
- ✅ League carousel sync with Home screen data
- ✅ Push notifications for draft turns
- ✅ EAS development build setup

**Recently Completed (Jan 17):**
- ✅ Real-Time Standings Auto-Refresh (web + mobile)
- ✅ Mobile navigation redesign (ESPN-style league switcher)
- ✅ Week navigation for viewing past matchups
- ✅ Swipeable league carousel on Home page

**Backend (Completed Jan 15):**
- ✅ Automated weekly matchup processing with cron jobs
- ✅ Monday-Friday week with holiday detection
- ✅ Dollar gain scoring with mid-week trade tracking
- ✅ Retry mechanism for failed snapshots

**Note:** The native mobile app now covers most core functionality, reducing urgency on web mobile responsiveness.
