# Alpaca Keys Error 12/17

## Issue Summary
When trying to link Alpaca credentials on the Vercel deployment, the `save-broker-keys` Edge Function returns a non-2xx status code. The error message shown is "Edge Function returned a non-2xx status code".

## Current State

### What's Working
- Vercel deployment is live
- Page refresh no longer causes 404 (vercel.json SPA routing fixed)
- Scrolling ticker is working (using `ticker-quotes` function with server-side keys)
- CORS has been simplified to allow any `*.vercel.app` subdomain
- hCaptcha is working
- User can log in

### What's Not Working
- Linking Alpaca credentials fails during validation
- Portfolio page shows "Failed" for all stock prices (depends on user having linked credentials)
- "Test Connection" button fails

## Technical Details

### Vercel Preview URL
`https://fantasy-stock-eu6tkpcj3-gios-projects-d96ec2f3.vercel.app`

### Edge Functions Deployed
All 8 functions have been deployed with simplified CORS:
- `quote` - requires user auth + linked Alpaca credentials
- `place-order` - requires user auth + linked Alpaca credentials
- `save-broker-keys` - saves encrypted Alpaca credentials (FAILING)
- `get-broker-keys` - retrieves encrypted Alpaca credentials
- `ticker-quotes` - uses server-side keys (WORKING)
- `symbols-search` - uses server-side keys
- `symbol-name` - database lookup
- `refresh-symbols` - updates symbols database

### CORS Pattern (all functions)
```typescript
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Allow any vercel.app subdomain (production and previews)
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  // Allow localhost for development
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}
```

### Error Location
File: `supabase/functions/save-broker-keys/index.ts`

The function validates Alpaca credentials before saving by calling:
```
https://paper-api.alpaca.markets/v2/account
```

## Possible Causes

1. **`not_authenticated`** - JWT/session issue with Supabase auth
2. **`invalid_credentials`** - Alpaca API rejecting the keys
3. **`Server configuration error`** - Missing `BROKER_CRYPTO_KEY` secret in Supabase
4. **Other server error** - Function crashing before returning response

## Next Steps to Debug

1. **Check Network Tab Response**
   - Open browser DevTools (F12)
   - Go to Network tab
   - Click "Link Account" button
   - Find the `save-broker-keys` request
   - Click on it and look at the Response tab
   - The JSON response will show the specific error

2. **Verify Supabase Secrets**
   - Go to Supabase Dashboard → Project Settings → Edge Functions
   - Verify `BROKER_CRYPTO_KEY` is set
   - It should be a base64-encoded 32-byte key

3. **Check Alpaca Credentials**
   - Verify the API Key ID and Secret are from a PAPER trading account
   - Test them directly at https://app.alpaca.markets/paper/dashboard/overview
   - Make sure the account status is "ACTIVE"

4. **Check Supabase Function Logs**
   - Go to Supabase Dashboard → Edge Functions → save-broker-keys → Logs
   - Look for error messages when the function is invoked

5. **Test Locally**
   - Run `npm run dev` locally
   - Try linking credentials on localhost
   - This will help determine if it's a Vercel-specific issue

## Files Modified Today

- `vercel.json` - Added SPA routing configuration
- `supabase/functions/ticker-quotes/index.ts` - NEW: server-side keys for ticker
- `supabase/functions/*/index.ts` - All updated with simplified CORS
- `src/Ticker.jsx` - Updated to use `ticker-quotes` function

## Git Status
All changes committed. Ready to push when needed:
```bash
git push
```

## Related Files
- `Dec 17 Issues.md` - Original issue tracking (all items completed before this error)
