# Fix: Home Screen Performance Chart

Reference the chart spec in `STOCKPILE_UI_OVERHAUL.md` under "Section 2b: Portfolio Performance Chart" for full details. There are two critical bugs and one quality issue to fix.

---

## Bug 1: P/L values don't update when switching time periods

**Current behavior:** When the user taps 1W, 1M, Season, or All, the chart re-renders but the dollar change (+$304.36) and percent change (+33.14%) stay the same regardless of which period is selected.

**Expected behavior:** The total portfolio value ($1,222.77) should NEVER change — it's always the current value. But the P/L line below it MUST update to reflect the selected time window:

- **All:** P/L = current value minus value at account creation
- **Season:** P/L = current value minus value at season start
- **1M:** P/L = current value minus value 30 days ago
- **1W:** P/L = current value minus value 7 days ago

```typescript
function onPeriodChange(period) {
  const currentValue = totalPortfolioValue; // stays fixed
  const startValue = getValueAtStartOfPeriod(period); // look up historical value
  const dollarChange = currentValue - startValue;
  const percentChange = ((currentValue - startValue) / startValue) * 100;
  // Update dollarChange and percentChange displays
  // Update line color: positive = cyan (#0891B2), negative = red (#DC2626)
}
```

This is how Coinbase works — the total stays constant, only the change values and chart data update per period.

---

## Bug 2: Y-axis scales from zero — chart looks flat

**Current behavior:** The chart Y-axis starts at $0 and goes to the max portfolio value (~$1,230). This means the actual price movement ($1,205 to $1,230, a $25 range) is compressed into the top 2% of the chart. The bottom 98% is empty white space. The line looks completely flat even though the portfolio is moving.

**Expected behavior:** The Y-axis should auto-scale to the actual data range, NOT start from zero. If values range from $1,205 to $1,230, the Y-axis should span roughly $1,202 to $1,233 (data range + 10% padding). This makes the $25 movement fill the entire chart height, so every fluctuation is visible.

```typescript
// ❌ WRONG (current):
const yMin = 0;
const yMax = Math.max(...values);

// ✅ CORRECT:
const dataMin = Math.min(...values);
const dataMax = Math.max(...values);
const range = dataMax - dataMin;
const padding = range * 0.1;
const yMin = dataMin - padding;
const yMax = dataMax + padding;

// Edge case — if perfectly flat:
if (range === 0) {
  yMin = values[0] * 0.999;
  yMax = values[0] * 1.001;
}
```

This is why Coinbase can show a 0.24% change as visible hills and valleys — their Y-axis auto-scales to the data range. Our chart should do the same.

---

## Quality issue: Chart height is too tall

The chart container is taking up nearly half the screen, pushing "Your Leagues" and "This Week" below the fold. Reduce the chart height to ~120px max. The chart is supplementary — leagues and matchups are the actionable content and should be visible without scrolling.

---

## How to verify the fixes

1. **P/L test:** Switch between 1W, 1M, Season, All. The dollar and percent values below $1,222.77 should change each time. If they stay the same, it's still broken.
2. **Y-axis test:** Look at the chart when on 1W. Even if the portfolio only moved 0.5% that week, you should see clear ups and downs filling the full chart height — not a flat line at the top. If there's empty space below the line, the Y-axis is still scaling from zero.
3. **Height test:** On the Home screen, "Your Leagues" should be visible without scrolling when the chart is showing.
