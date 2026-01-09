# Fantasy Stock App - Improvements Roadmap

## Mobile App Status (React Native/Expo)

### Fully Implemented ✅
- [x] Authentication (sign up/sign in with username, content moderation)
- [x] League management (create, view details, member list)
- [x] Draft functionality (full snake draft with real-time updates)
- [x] Portfolio viewing (holdings, P/L, cost basis)
- [x] Matchups (head-to-head view, weekly gains, past results)
- [x] Leaderboard/Standings (rankings, W-L-T records)
- [x] Profile management (avatar selection, username editing)
- [x] League context (switch between leagues)
- [x] Stock price caching with rate limiting
- [x] Dark theme throughout

### Mobile App - Not Yet Implemented
- [ ] Native trading (currently opens web app)
- [ ] Trade history (currently opens web app)
- [ ] Join league by invite code
- [ ] Push notifications
- [ ] Password reset flow
- [ ] Settings/preferences screen
- [ ] Help/documentation
- [ ] Stock name display alongside symbols in draft boards
- [ ] Search suggestions dropdown (like web has) instead of plain text input

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

**Web App Priorities:**
1. **Landing Page Screenshots** - Only remaining item. Add app previews to complete the marketing page.
2. **Mobile Responsiveness** - Web app still needs work for mobile browsers (native app covers mobile users for now).

**Cross-Platform Priorities:**
1. **Email Notifications** - Critical for draft turns and matchup results.
2. **Password Reset Flow** - Users will forget passwords.

**Note:** The native mobile app now covers most core functionality, reducing urgency on web mobile responsiveness.
