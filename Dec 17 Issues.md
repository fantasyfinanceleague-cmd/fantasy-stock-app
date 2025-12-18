# Dec 17 Issues - Per-User Alpaca Implementation

## High Priority

### 1. Validate Alpaca credentials when saving
- [x] Test credentials against Alpaca API before saving
- [x] Show "Verifying credentials..." loading state
- [x] Return clear error if credentials are invalid
- [x] Only save and show success if validation passes

### 2. `symbols-search` uses hardcoded keys
- [x] Decide: should search work for unauthenticated users?
- [x] **Decision: Keep server-side keys for search**
  - Search is read-only (no trades executed)
  - Users need to search before they can link their account
  - It's a shared, non-sensitive operation (just price lookups)
  - Per-user auth would break search for anyone who hasn't linked yet

### 3. Better error messages for invalid/expired credentials
- [x] Detect 401/403 responses from Alpaca
- [x] Show "Your Alpaca credentials are invalid or expired" message
- [x] Provide clear message to update in Profile settings
- [x] Distinguish from other errors (insufficient funds, no credentials, etc.)

## Medium Priority

### 4. Bot handling during draft
- [x] Bots can't have Alpaca credentials
- [x] **Already implemented**: Bots skip Alpaca orders
  - Bot picks don't include `alpaca_order_id` - they just save to database
  - Quote fetches during bot picks use the logged-in human's credentials (commissioner)
  - This works because we require all humans to link Alpaca before draft starts

### 5. No credential verification button
- [x] Add "Test Connection" button in Profile
- [x] Shows connection status (success or error message)
- [x] Tests by fetching a quote using user's credentials

### 6. Quote caching
- [x] Add 30-second in-memory cache for quotes
- [x] Reduces Alpaca API calls significantly
- [x] Cache cleaned up automatically when size exceeds 100 entries

## Low Priority

### 7. CORS restrictions
- [x] Restrict CORS to production domain
- [x] Now only allows:
  - `https://fantasy-stock-app.vercel.app`
  - `http://localhost:5173`
  - `http://localhost:3000`

### 8. Error message sanitization
- [x] Don't return raw error messages from edge functions
- [x] All `String(e)` and `error.message` replaced with generic user-friendly messages
- [x] Internal errors logged to console but not exposed to users
