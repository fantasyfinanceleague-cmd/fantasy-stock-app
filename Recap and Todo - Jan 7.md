# Fantasy Stock App - Recap and Todo
**Date:** January 7, 2026

---

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
