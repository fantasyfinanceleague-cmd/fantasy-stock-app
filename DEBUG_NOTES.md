# Debug Session Notes - League Visibility Issue

## ✅ RESOLVED
The issue was that `useLeagues.js` was running with `USER_ID = 'test-user'` before auth loaded, then the final render showed the test-user leagues instead of the real user's leagues.

**Fix:** Added early return in `refresh()` when `!authUser?.id` to skip the test-user fallback.

---

## Original Issue
Leagues page only shows the old league with `commissioner_id = 'test-user'`, but not the new league created with the actual auth user UUID.

## What We Know
1. **Database has the data**: SQL query in Supabase shows 2 members in the new league with correct `league_id`
2. **RLS is not blocking**: The `dev_all` policy on `league_members` is permissive (`USING (true)`)
3. **App queries by USER_ID**: The `useLeagues.js` hook fetches leagues where:
   - `commissioner_id = USER_ID` (leagues you manage)
   - `user_id = USER_ID` in `league_members` (leagues you're a member of)

## Suspected Root Cause
Mismatch between:
- The `USER_ID` the app is using (`authUser?.id`)
- The `commissioner_id` stored in the `leagues` table for the new league

## Next Steps to Debug

### Step 1: Check the console logs
On the Leagues page, open browser DevTools → Console and look for:
```
🔍 Refreshing leagues for USER_ID: xxx
📊 Leagues I manage: [...]
👥 My memberships: [...]
✅ Final merged leagues: [...]
```

### Step 2: Compare USER_ID with database
Run in Supabase SQL Editor:
```sql
-- See all leagues and their commissioners
SELECT id, name, commissioner_id FROM leagues;

-- See your auth user ID
SELECT id, email FROM auth.users;
```

Compare the `commissioner_id` for your new league with:
1. The USER_ID logged in the browser console
2. Your actual `id` from `auth.users`

### Step 3: If there's a mismatch
Update the league's commissioner_id to match your actual auth UUID:
```sql
UPDATE leagues
SET commissioner_id = 'your-actual-auth-uuid-here'
WHERE id = 'your-new-league-uuid';
```

Also ensure you're in league_members:
```sql
INSERT INTO league_members (league_id, user_id, role)
VALUES ('your-new-league-uuid', 'your-actual-auth-uuid', 'commissioner')
ON CONFLICT (league_id, user_id) DO NOTHING;
```

## Features Added This Session

### 1. Profile Page (`/profile`)
- Shows account info (email, user ID, created date, last sign in)
- Password change form
- Sign out button
- Click user badge in header to access

### 2. Auto-Draft for Bots
- Bots automatically pick random stocks when it's their turn
- Checks `auth.users` to determine human vs bot (via `get_real_user_ids` function)
- 800ms delay between bot picks for visibility
- Toggle to enable/disable auto-draft
- Bot stock pool: 40 popular stocks (AAPL, MSFT, GOOGL, etc.)

### 3. Draft Setup Modal
- Shows when starting draft without enough members
- Options:
  - Wait for more players
  - Fill remaining spots with bots (auto-creates `bot-1`, `bot-2`, etc.)
  - Change minimum participant requirement

## Files Modified
- `src/pages/Profile.jsx` (new)
- `src/pages/DraftPage.jsx` (auto-draft, setup modal)
- `src/components/DraftSetupModal.jsx` (new)
- `src/Header.jsx` (clickable user badge)
- `src/App.jsx` (profile route)
- `src/layout.css` (user badge styles)
- `supabase/migrations/20250122000000_check_real_users.sql` (new - bot detection function)

## Migration to Run (if not done)
```sql
create or replace function get_real_user_ids(user_ids text[])
returns text[]
language sql
security definer
as $$
  select array_agg(id::text)
  from auth.users
  where id::text = any(user_ids);
$$;

grant execute on function get_real_user_ids(text[]) to authenticated;
grant execute on function get_real_user_ids(text[]) to anon;
```
