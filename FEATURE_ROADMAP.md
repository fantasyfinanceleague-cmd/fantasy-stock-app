# Fantasy Stock League - Feature Roadmap

This document outlines potential features and improvements for the Fantasy Stock League application, prioritized by impact and user value.

---

## High Priority - Core Functionality

### 1. Post-Draft Trading System
Right now users can only draft stocks. Add:
- Buy/sell interface after draft completes
- Trade validation (budget checks, owned stock checks)
- Trade history page
- Transaction log for the league

**Why:** This is essential for an ongoing fantasy stock league. Right now it's just a one-time draft.

**Impact:** 🔥🔥🔥 Critical for ongoing engagement

---

### 2. Real-time Portfolio Updates
- WebSocket integration for live price updates
- Auto-refresh portfolio values every X seconds
- Live standings updates during market hours
- Push notifications for major price movements

**Why:** Makes the app feel alive and engaging, especially during market hours.

**Impact:** 🔥🔥🔥 High engagement driver

---

### 3. League Chat/Activity Feed
- Simple chat for each league
- Activity feed showing trades, picks, major gains/losses
- Trash talk and social interaction

**Why:** Social features drive engagement and make it more fun.

**Impact:** 🔥🔥🔥 Community building

---

## Medium Priority - Enhanced Features

### 4. Advanced Analytics Dashboard
- Performance charts (line graphs over time)
- Sector allocation pie charts
- Risk metrics (volatility, beta)
- Compare your portfolio to S&P 500 or other benchmarks
- Best/worst picks analysis

**Why:** Users love seeing visual data and analytics.

**Impact:** 🔥🔥 User retention

**Technical Stack:**
- Chart.js or Recharts for visualizations
- Additional Alpaca API endpoints for historical data

---

### 5. Stock Research Tools
- Company profiles and news integration
- Historical price charts
- Analyst ratings
- Financials (P/E ratio, market cap, etc.)
- "Trending stocks" section

**Why:** Help users make informed decisions instead of just guessing.

**Impact:** 🔥🔥 User experience

**APIs to Consider:**
- Finnhub (news, company profiles)
- Alpha Vantage (financials)
- Alpaca (historical data)

---

### 6. Waiver Wire / Free Agent System
- Pool of available stocks not yet drafted
- Claim process with priority order
- Drop stocks and pick up new ones
- Weekly waiver processing

**Why:** Adds strategic depth and keeps leagues active after the draft.

**Impact:** 🔥🔥 Strategic gameplay

**Database Changes:**
- Add `waivers` table
- Add `available_stocks` table
- Add claim priority system

---

### 7. Mobile Optimization
- Responsive design improvements
- Mobile-first navigation
- Touch-optimized interfaces
- PWA support (add to home screen)

**Why:** Many users will access on mobile during market hours.

**Impact:** 🔥🔥 Accessibility

**Technical Tasks:**
- Add service worker
- Optimize CSS for mobile breakpoints
- Test on various devices
- Add manifest.json for PWA

---

## Lower Priority - Polish & Extras

### 8. Achievements & Gamification
- Badges for milestones (first trade, 10% gain, etc.)
- League trophies/awards
- Hall of fame for past seasons
- Weekly awards (best pick, biggest gain, etc.)

**Why:** Fun engagement mechanics that keep users coming back.

**Impact:** 🔥 Fun factor

**Examples:**
- "Diamond Hands" - Hold a stock through 20% volatility
- "Day Trader" - Make 10 trades in one day
- "Oracle" - Pick the week's top performer
- "Warren Buffett" - Achieve 50% portfolio gain

---

### 9. Enhanced League Management
- Commissioner tools (force trades, edit rosters)
- Custom scoring rules
- League history archive
- Season rollover functionality
- Public/private league settings

**Why:** Makes commissioners' lives easier and adds flexibility.

**Impact:** 🔥 Administrative ease

**Features:**
- Lock/unlock leagues
- Kick members
- Edit league settings mid-season
- Clone league for new season

---

### 10. Notifications System
- Email notifications for draft reminders
- Browser push notifications for trades
- Daily digest emails with portfolio summary
- Custom alert thresholds (notify if stock drops >5%)

**Why:** Keeps users engaged even when not actively using the app.

**Impact:** 🔥 Re-engagement

**Technical Stack:**
- Supabase Realtime for live updates
- SendGrid or Resend for emails
- Browser Notification API

---

### 11. Export & Reporting
- Export portfolio to CSV/PDF
- Season summary reports
- Tax reporting helpers (if using real money eventually)
- Share portfolio on social media

**Why:** Users like to share their wins and track their data.

**Impact:** 🔥 Shareability

**Features:**
- Generate PDF reports with jsPDF
- CSV download for Excel analysis
- Social media cards with og:image
- End-of-season recap emails

---

## Recommended Build Order

**Phase 1 - MVP Enhancements** (Next 2-4 weeks)
1. ✅ Post-Draft Trading System
2. ✅ Real-time Portfolio Updates
3. ✅ League Chat/Activity Feed

**Phase 2 - User Experience** (4-6 weeks)
4. Advanced Analytics Dashboard
5. Mobile Optimization
6. Stock Research Tools

**Phase 3 - Engagement** (6-8 weeks)
7. Waiver Wire System
8. Notifications System
9. Achievements & Gamification

**Phase 4 - Polish** (Ongoing)
10. Enhanced League Management
11. Export & Reporting

---

## Technical Debt to Address

- [ ] Add proper error boundaries
- [ ] Implement loading skeletons
- [ ] Add unit tests for utilities
- [ ] Add E2E tests for critical flows
- [ ] Optimize bundle size
- [ ] Add proper TypeScript types
- [ ] Implement proper caching strategy
- [ ] Add rate limiting for API calls

---

## Database Schema Additions Needed

### For Trading System
```sql
CREATE TABLE trades (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  user_id UUID REFERENCES auth.users(id),
  symbol TEXT NOT NULL,
  action TEXT CHECK (action IN ('buy', 'sell')),
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### For Chat System
```sql
CREATE TABLE league_messages (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  user_id UUID REFERENCES auth.users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### For Achievements
```sql
CREATE TABLE achievements (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT
);

CREATE TABLE user_achievements (
  user_id UUID REFERENCES auth.users(id),
  achievement_id UUID REFERENCES achievements(id),
  earned_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);
```

---

## Notes

- Keep security in mind for all trading operations
- Ensure proper RLS policies on all new tables
- Consider rate limiting for real-time features
- Monitor API usage costs (Alpaca, etc.)
- Test thoroughly with multiple concurrent users

---

*Last Updated: 2025-01-14*
