# Fantasy Finance – Draft Improvements

This document describes three issues and the required code changes.  
Implement all changes within the existing React + Supabase draft flow.

---

## Issue 1: Auto-refresh draft state when picks are made

### Problem

- When another user makes a pick, my page does **not** automatically update.
- I must manually refresh for:
  - The **current drafted stocks** list to update.
  - The **turn logic** to advance and show that it is now my turn.
  - The **"Your turn in X picks"** guide to update.

### Requirements

- As soon as a new pick is made (by any user or bot):
  - The draft state on all connected clients must update automatically.
  - The “Is it my turn?” logic must re-run.
  - The “Your turn in” helper must update based on the new pick order.
- No manual page refresh should be needed.

### Implementation Steps

1. **Subscribe to draft changes**
   - In the main draft page component (where picks and turn logic live), add a real-time listener on the `drafts` table.
   - Use Supabase Realtime (or the existing backend event system) to subscribe to `INSERT` (and optionally `UPDATE`) events on the `drafts` table.
   - On relevant events:
     - Refetch or update the local draft picks state.
     - Recompute the current pick number, round, and whose turn it is.

2. **Centralize turn calculation**
   - Create or reuse a helper function, e.g. `getCurrentTurn(drafts, userList)`:
     - Inputs: ordered list of all picks, ordered list of drafting users, and draft settings (rounds, snake vs linear, etc.).
     - Output: object that includes:
       - `currentPickerUserId`
       - `nextPickIndex`
       - `picksRemainingBeforeCurrentUser`
   - Call this helper:
     - After the initial load of the page.
     - Inside the realtime listener whenever a pick is added.

3. **Update UI based on new turn state**
   - If `currentPickerUserId === currentUserId`:
     - Show the “It’s your turn” state and enable the “Draft to My Team” button.
   - Otherwise:
     - Show “Not your turn” and disable the draft button.
   - For the “Your turn in” component:
     - Use `picksRemainingBeforeCurrentUser` to display:
       - “Your turn next”
       - “Your turn in N picks”
       - “Waiting for other picks” when `N` is large.

4. **Ensure no double-fetch conflicts**
   - If you already have a `useEffect` that loads draft data on mount:
     - Keep it for initial load.
     - Make sure the realtime listener only updates state when there is a new event, not on every render.
   - Clean up the realtime subscription on component unmount.

---

## Issue 2: Ensure bots stay within budget in budget mode

### Problem

- In **budget mode**, human users are blocked from drafting stocks that exceed their remaining budget.
- Bots, however, can still make picks that push their team **over budget**.

### Requirements

- Bots must follow the **same budget rules** as human users when `budgetMode === 'budget'`.
- A bot:
  - Cannot select a stock whose price is greater than its remaining budget.
  - Must skip or choose another stock if it cannot afford the current one.
- In `no-budget` mode, bots can behave as they do now.

### Implementation Steps

1. **Expose budget info to bot logic**
   - Wherever the bot picks are generated, ensure you have:
     - The bot’s `totalBudget` (from draft settings or `draft_settings` table).
     - The bot’s `remainingBudget`, calculated as:
       - `remainingBudget = totalBudget - sum(price of all stocks drafted by this bot so far)`.

2. **Add budget check before bot picks**
   - Before a bot finalizes a pick:
     - Get the candidate stock’s price.
     - If `budgetMode === 'budget'` and `stockPrice > remainingBudget`:
       - Do **not** create the pick.
       - Instead, either:
         - Choose another stock that fits within the budget, or
         - Skip the pick / mark bot as out of budget for remaining picks (depending on desired game behavior).
   - If `budgetMode === 'no-budget'`, skip this check.

3. **Use the same price source and calculation**
   - Ensure bots use the **same price field** and conversion rules as human picks (e.g. latest quote from Finnhub, same currency and decimals).
   - If you already have a helper that validates human picks vs budget, reuse it for:
     - `validateBotPick(botId, stock, budgetMode)`.

4. **Guard against edge cases**
   - If no affordable stocks remain:
     - Do not insert a pick.
     - Optionally log or mark the bot as “cannot draft more due to budget”.

---

## Issue 3: Fix stock search dropdown (names and pricing missing)

### Problem

- The stock search dropdown currently shows **only the ticker symbol**.
- It does not show the **company name** or **price**.
- Users must click “Get Quote” before they see useful information.

### Requirements

- The dropdown options should display:
  - At minimum: `TICKER – Company Name`
  - Ideally: `TICKER – Company Name (Price)`
- The underlying option object should include:
  - `symbol`
  - `name`
  - `price`
- Clicking an option should populate the selected stock details without needing an extra “Get Quote” step (if price is already available from the search result).

### Implementation Steps

1. **Update the search result shape**
   - In the function that fetches search results (e.g. from Finnhub or your quotes API):
     - Ensure each result includes:
       - `symbol`
       - `description` or `name`
       - `currentPrice` (if returned by the API; otherwise plan a follow-up quote call).

2. **Map results to richer dropdown options**
   - In the component that renders the dropdown:
     - Use a formatted label such as:
       - `label = "${symbol} – ${name} (${priceFormatted})"` when price is available.
       - Fallback to `symbol – name` if price is not yet known.

3. **Wire the selected option to the quote state**
   - On dropdown selection, store the selected `stock` object in state:
     - `setSelectedStock(option.stock)`.

4. **Adjust “Get Quote” behavior**
   - If the search API already provides a reliable `price`:
     - Optionally skip the “Get Quote” network call.
   - Otherwise, pre-fill symbol and name and fetch only price.

5. **Verify UX**
   - Ensure dropdown shows ticker + name (+ price).
   - Ensure selection fills stock info before drafting.
