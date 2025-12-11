# Remaining Improvements

This document tracks potential improvements and enhancements for the Fantasy Finance app.

**Status:** 3 of 7 issues completed

---

## Issue 1: Ticker Percent Change Accuracy

### Problem

The ticker now shows real percent change from Alpaca instead of fake random values, but some stocks may still show inaccurate or 0% change.

### Context

- Updated `supabase/functions/quote/index.ts` to fetch previous day's bar and calculate percent change
- The Alpaca IEX feed (free tier) has limited data for some symbols
- Bars endpoint may return data nested under symbol key: `{ bars: { AAPL: [...] } }`

### Current Behavior

- Shows `0.00%` when previous close data is unavailable
- Some percent changes may not match what's shown on financial sites

### Potential Solutions

1. Use a different data source for percent change (e.g., Finnhub, Yahoo Finance)
2. Cache previous close prices in database for more reliable calculations
3. Show "N/A" instead of "0.00%" when data is unavailable

### Files

- `supabase/functions/quote/index.ts`
- `src/Ticker.jsx`

---

## Issue 2: Verify Draft Realtime Updates

### Problem

Need to verify that draft auto-refresh (Issue 1 from `fantasy_finance_improvements_1205.md`) is working correctly in production.

### Context

- Supabase Realtime subscription was added to DraftPage
- The `drafts` table was added to the realtime publication
- When another user makes a pick, the page should update automatically without manual refresh

### Testing Needed

1. Open draft page in two different browsers/accounts
2. Make a pick in one browser
3. Verify the other browser updates automatically:
   - Current drafted stocks list updates
   - Turn logic advances correctly
   - "Your turn in X picks" updates

### Files

- `src/pages/DraftPage.jsx`
- `supabase/migrations/20251205100000_enable_drafts_realtime.sql`

---

## Issue 3: Add Price to Stock Search Dropdown ✅ COMPLETED

### Problem

The stock search dropdown shows ticker and company name, but not the current price. Users must click "Get Quote" to see pricing.

### Solution Implemented

Updated `symbols-search` edge function to fetch prices from Alpaca's multi-symbol trades endpoint and include them in search results:
- Uses Alpaca's `/v2/stocks/trades/latest?symbols=SYM1,SYM2` endpoint for efficient batch fetching
- Prices are optional enhancement - search still works if price fetch fails
- Added `includePrices` parameter (defaults to true) for flexibility

Updated `DraftControls.jsx` dropdown to display prices:
- Shows price in green on the right side: `AAPL — Apple Inc $195.50`
- Gracefully handles missing prices (shows nothing if unavailable)

Updated CSS for proper alignment:
- Added flexbox to `.dropdown-item` for price alignment

### Files Modified

- `supabase/functions/symbols-search/index.ts` - Added Alpaca price fetching
- `src/components/DraftControls.jsx` - Display price in dropdown
- `src/layout.css` - Added flex display to dropdown-item

---

## Issue 4: Dashboard Enhancements

### Problem

The Dashboard page may need improvements for better user experience.

### Potential Enhancements

1. **Quick Stats** - Show portfolio value, today's gain/loss at a glance
2. **Recent Activity** - Show recent trades, draft picks
3. **League Overview** - Summary of all leagues user is in
4. **Market Status** - Show if market is open/closed
5. **Watchlist** - Let users track stocks they're interested in

### Files

- `src/pages/Dashboard.jsx`

---

## Issue 5: Mobile/Responsive Design

### Problem

UI may not be fully optimized for mobile devices.

### Areas to Check

1. **Navigation** - Sidebar may not collapse properly on mobile
2. **Tables** - Portfolio and Leaderboard tables may overflow
3. **Forms** - Input fields and buttons may be too small
4. **Draft Page** - Complex layout may not adapt well
5. **Ticker** - May be too small or overflow on mobile

### Potential Solutions

1. Add responsive breakpoints in `layout.css`
2. Use hamburger menu for mobile navigation
3. Make tables horizontally scrollable
4. Stack form fields vertically on small screens

### Files

- `src/layout.css`
- `src/Layout.jsx`
- Various page components

---

## Issue 6: Global Error Boundary ✅ COMPLETED

### Problem

If a component crashes (JavaScript error), the entire app may break with a white screen.

### Solution Implemented

- Created `src/components/ErrorBoundary.jsx` - class component that catches errors
- Wrapped the entire app in `src/main.jsx`
- Shows friendly error page with:
  - Warning icon and "Something went wrong" message
  - Error details in a code block (for debugging)
  - "Refresh Page" button
  - "Go to Dashboard" button
- Errors are logged to console for debugging

### Files Modified

- `src/components/ErrorBoundary.jsx` (new)
- `src/main.jsx` (wrapped App with ErrorBoundary)

---

## Issue 7: Consistent Loading States ✅ COMPLETED

### Problem

Loading states were inconsistent across pages - some showed "Loading...", others showed nothing.

### Solution Implemented

Created reusable loading components in `src/components/LoadingSpinner.jsx`:
- `LoadingSpinner` - Basic spinner (small/medium/large sizes)
- `PageLoader` - Full-page loading with spinner and message
- `CardLoader` - Card-level loading state
- `InlineLoader` - For buttons, table cells, etc.

Added CSS animation in `src/layout.css`:
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

Updated pages to use `PageLoader`:
- Dashboard
- Portfolio
- Leaderboard
- Draft
- Trade History

### Files Modified

- `src/components/LoadingSpinner.jsx` (new)
- `src/layout.css` (added spin animation)
- `src/pages/Dashboard.jsx`
- `src/pages/PortfolioPage.jsx`
- `src/pages/Leaderboard.jsx`
- `src/pages/DraftPage.jsx`
- `src/pages/TradeHistory.jsx`

---

## Remaining Issues Summary

| Issue | Description | Status | Effort |
|-------|-------------|--------|--------|
| 1 | Ticker percent change accuracy | Open | Small |
| 2 | Verify draft realtime updates | Open | Testing |
| 3 | Add price to stock search dropdown | **Done** | - |
| 4 | Dashboard enhancements | Open | Large |
| 5 | Mobile/responsive improvements | Open | Medium |
| 6 | Global error boundary | **Done** | - |
| 7 | Consistent loading states | **Done** | - |

---

## Implementation Checklist

- [ ] Issue 1: Investigate ticker percent change accuracy
- [ ] Issue 2: Test draft realtime updates in production
- [x] Issue 3: Add price to stock search dropdown
- [ ] Issue 4: Dashboard enhancements
- [ ] Issue 5: Mobile/responsive improvements
- [x] Issue 6: Add global error boundary
- [x] Issue 7: Consistent loading states
