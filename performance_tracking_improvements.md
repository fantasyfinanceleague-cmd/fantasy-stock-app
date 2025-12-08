# Performance Tracking Improvements

This document outlines improvements needed for the Portfolio and Leaderboard pages.

---

## Issue 1: Leaderboard doesn't account for trades

### Problem

The Leaderboard (`src/pages/Leaderboard.jsx:103-107`) only queries the `drafts` table, but ignores the `trades` table. If a user buys or sells stocks after the draft, their leaderboard standing won't reflect those changes.

```javascript
// Current: only drafts
const { data: rows } = await supabase
  .from('drafts')
  .select('...')
  .eq('league_id', leagueId)
```

### Impact

- Users who made profitable trades after the draft won't see gains reflected
- Users who sold losing positions will still show those losses
- Rankings are inaccurate once trading begins

### Solution

Include trades in the leaderboard calculation, similar to how `PortfolioPage.jsx` calculates `actualHoldings`:
1. Load both `drafts` and `trades` for the league
2. For each user, calculate: drafts + buy trades - sell trades
3. Apply current prices to actual holdings

---

## Issue 2: Duplicate price fetching

### Problem

Both Portfolio and Leaderboard pages fetch prices independently via `fetchQuotesInBatch()`. If you navigate between pages, the same quotes are fetched multiple times.

### Impact

- Unnecessary API calls to Alpaca
- Slower page loads
- Could hit rate limits with many symbols

### Solution

Options:
1. **React Context for quotes** - Share price state across pages
2. **Local cache with TTL** - Cache prices in localStorage/sessionStorage with a 1-5 minute TTL
3. **React Query / SWR** - Use a data-fetching library with built-in caching

---

## Issue 3: No auto-refresh of prices

### Problem

Portfolio page requires manual "Refresh Prices" click. Prices can go stale during a session, especially during market hours.

### Impact

- Users see outdated P/L until they manually refresh
- Poor UX for active monitoring

### Solution

Add an optional auto-refresh interval:
```javascript
useEffect(() => {
  if (!autoRefresh || !actualHoldings.length) return;

  const interval = setInterval(() => {
    refreshPrices();
  }, 60000); // Refresh every 60 seconds

  return () => clearInterval(interval);
}, [autoRefresh, actualHoldings.length]);
```

Include a toggle for users to enable/disable auto-refresh.

---

## Issue 4: "Top Gaining Stocks This Week" label is misleading

### Problem

`Leaderboard.jsx:422` displays "Top Gaining Stocks This Week" but the calculation shows gain since entry price (which could be any timeframe - days, weeks, or months ago).

### Impact

- Misleading information to users
- No actual weekly performance tracking

### Solution

**Option A (Quick fix):** Rename label to "Top Gaining Stocks (Since Draft)"

**Option B (Full fix):** Implement actual time-based tracking:
1. Store daily price snapshots in a new `price_history` table
2. Calculate actual weekly/monthly performance
3. Show accurate time-based metrics

---

## Issue 5: No error handling for failed quote fetches

### Problem

If a quote fetch fails, the price falls back to entry price silently:
```javascript
const last = prices[sym] ?? null;
const pl = (last != null && Number.isFinite(entry)) ? (last - entry) * qty : null;
```

This makes P/L appear as `null` or `—` without explanation.

### Impact

- Users don't know if data is missing vs. fetch failed
- No way to retry failed fetches
- Confusing when some stocks show prices and others don't

### Solution

1. Track fetch status per symbol: `{ price: number | null, status: 'loading' | 'success' | 'error' }`
2. Show appropriate UI states:
   - Loading: spinner or "..."
   - Error: "Failed" with retry button
   - Success: actual price
3. Add a "Retry Failed" button to re-fetch only failed symbols

---

## Issue 6: Raw user IDs displayed on leaderboard

### Problem

User IDs like `bot-1`, `bot-2`, or full UUIDs are shown directly on the leaderboard instead of friendly names.

### Impact

- Poor readability
- Unprofessional appearance
- Hard to identify players

### Solution

1. Create or use a `user_profiles` table with display names
2. For bots, show formatted names like "Bot Player 1" or fun names
3. For real users, show their display name or email prefix
4. Fallback to truncated ID if no name available

Example mapping:
```javascript
function getDisplayName(userId) {
  if (userId.startsWith('bot-')) {
    const num = userId.replace('bot-', '');
    return `Bot Player ${num}`;
  }
  // Look up in profiles table or show truncated ID
  return profiles[userId]?.display_name || userId.substring(0, 8) + '...';
}
```

---

## Priority Order

| Priority | Issue | Reason |
|----------|-------|--------|
| 1 | Leaderboard doesn't account for trades | **Correctness** - Rankings are wrong |
| 2 | Auto-refresh prices | **UX** - Major usability improvement |
| 3 | Raw user IDs displayed | **UX** - Easy win, better appearance |
| 4 | Misleading "This Week" label | **Accuracy** - Quick label fix |
| 5 | Duplicate price fetching | **Performance** - Optimization |
| 6 | No error handling for quotes | **UX** - Better error states |

---

## Implementation Checklist

- [x] Issue 1: Update Leaderboard to include trades in calculations
- [x] Issue 2: Implement shared price cache/context
- [ ] Issue 3: Add auto-refresh toggle for prices
- [ ] Issue 4: Fix "This Week" label or implement weekly tracking
- [ ] Issue 5: Add quote fetch error handling and retry
- [ ] Issue 6: Display friendly names instead of user IDs
