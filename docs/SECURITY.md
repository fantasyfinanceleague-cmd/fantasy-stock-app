# Security Documentation

## Authentication Security

### Password Storage
- **Hashing Algorithm:** bcrypt (industry standard)
- **Storage Location:** Supabase PostgreSQL database
- **Access:** Passwords are never stored in plain text or accessible
- **Strength Requirements:** Minimum 6 characters (Supabase default)

### Session Management
- **Storage:** Browser localStorage
- **Token Type:** JWT (JSON Web Tokens)
- **Access Token Expiry:** 1 hour
- **Refresh Token:** Used to obtain new access tokens
- **Security:** Tokens are cryptographically signed

### Data Transmission
- **Protocol:** HTTPS (encrypted in transit)
- **API Endpoint:** `https://haiaaifjcclsvmkfqgmd.supabase.co`

---

## Current Security Features

✅ **Implemented:**
- Password hashing with bcrypt
- JWT-based authentication
- HTTPS encryption
- Row Level Security (RLS) on database
- Protected routes requiring authentication
- Secure session management
- Auto-logout on session expiry
- **✨ Email verification enabled** (prevents fake accounts)
- **✨ Enhanced password requirements** (stronger passwords)
- **✨ hCaptcha protection** (prevents bots and automated attacks)

⚠️ **Remaining Considerations:**
- localStorage is vulnerable to XSS attacks (could migrate to httpOnly cookies)
- Anon key is exposed in client (by design, but requires proper RLS)
- No MFA/2FA (optional enhancement)
- No custom rate limiting beyond Supabase defaults

---

## Recommended Security Improvements

### High Priority

#### 1. ✅ Fix .env.local Format (COMPLETED)
~~**Current Issue:** Extra quotes in VITE_SUPABASE_URL~~
**Status:** Fixed - environment variables now properly formatted

#### 2. ✅ Enable Email Verification (COMPLETED)
~~In Supabase Dashboard:~~
1. ~~Go to Authentication → Settings~~
2. ~~Enable "Confirm email"~~
3. ~~Customize email templates~~

**Status:** Enabled - Users must verify email before accessing the app

#### 3. ✅ Strengthen Password Requirements (COMPLETED)
~~In Supabase Dashboard → Authentication → Settings:~~
~~- Minimum length: 8 characters~~
~~- Require uppercase, lowercase, number, special character~~

**Status:** Enhanced password requirements now enforced

#### 4. ✅ Enable hCaptcha (COMPLETED)
~~In Supabase Dashboard → Authentication → Settings:~~
~~- Enable hCaptcha protection~~

**Status:** hCaptcha enabled - Protects against bots, credential stuffing, and automated attacks

#### 5. Add Environment Variables to .gitignore
Ensure `.env.local` is in `.gitignore`:
```bash
.env
.env.*
!.env.example
```

### Medium Priority

#### 6. Implement Rate Limiting
Add to Edge Functions to prevent brute force:
```javascript
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
```

#### 7. Add Security Headers
In your hosting platform, add:
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

#### 8. Implement Content Security Policy (CSP)
Add to HTML or hosting config:
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline'">
```

### Low Priority

#### 9. Add Multi-Factor Authentication (MFA)
```javascript
// Enroll in TOTP MFA
const { data, error } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
});
```

#### 10. Switch to httpOnly Cookies
More secure than localStorage:
```javascript
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customCookieStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
```

#### 11. Add Audit Logging
Track authentication events:
- Login attempts (success/failure)
- Password changes
- Account creation
- Suspicious activity

---

## API Key Security

### Exposed Keys (By Design)
These keys are **meant** to be public:
- `VITE_SUPABASE_ANON_KEY` - Public anon key
- Database security comes from Row Level Security (RLS) policies

### Protected Keys (Server-Side Only)
These should **NEVER** be in client code:
- `ALPACA_API_KEY` - Stored in `supabase/.secrets`
- `ALPACA_API_SECRET` - Stored in `supabase/.secrets`
- Supabase Service Role Key (if you have one)

### Verification
Current `.gitignore` properly excludes:
```
.env
.env.local
supabase/.secrets
```

---

## Row Level Security (RLS)

### Current RLS Policies Needed

Ensure these are set in Supabase:

#### `leagues` table
```sql
-- Users can only read leagues they're members of
CREATE POLICY "Users can view their leagues"
  ON leagues FOR SELECT
  USING (
    id IN (
      SELECT league_id FROM league_members
      WHERE user_id = auth.uid()
    )
  );
```

#### `drafts` table
```sql
-- Users can only insert their own drafts
CREATE POLICY "Users can create their own drafts"
  ON drafts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can view drafts in their leagues
CREATE POLICY "Users can view league drafts"
  ON drafts FOR SELECT
  USING (
    league_id IN (
      SELECT league_id FROM league_members
      WHERE user_id = auth.uid()
    )
  );
```

#### `league_members` table
```sql
-- Users can view members of their leagues
CREATE POLICY "Users can view league members"
  ON league_members FOR SELECT
  USING (
    league_id IN (
      SELECT league_id FROM league_members
      WHERE user_id = auth.uid()
    )
  );
```

---

## Compliance & Best Practices

### OWASP Top 10 Coverage

1. ✅ **Broken Access Control** - RLS policies enforced
2. ✅ **Cryptographic Failures** - HTTPS, bcrypt hashing
3. ⚠️ **Injection** - Use parameterized queries (Supabase does this)
4. ✅ **Insecure Design** - JWT tokens, secure auth flow
5. ⚠️ **Security Misconfiguration** - Review Supabase settings
6. ✅ **Vulnerable Components** - Keep dependencies updated
7. ⚠️ **Authentication Failures** - Add rate limiting, MFA
8. ⚠️ **Software/Data Integrity** - Add CSP headers
9. ✅ **Security Logging** - Supabase logs auth events
10. ⚠️ **SSRF** - Validate all external API calls

### GDPR Considerations

If you have EU users:
- ✅ Password data is hashed (compliant)
- ⚠️ Add privacy policy
- ⚠️ Add terms of service
- ⚠️ Add "Delete Account" functionality
- ⚠️ Add "Export My Data" functionality

---

## Security Checklist

### Before Launch

- [x] Enable email verification ✅
- [x] Strengthen password requirements ✅
- [x] Enable hCaptcha protection ✅
- [x] Fix .env.local format ✅
- [ ] Review all RLS policies
- [ ] Add rate limiting
- [ ] Add security headers
- [ ] Implement CSP
- [ ] Add privacy policy
- [ ] Add terms of service
- [ ] Test authentication flows
- [ ] Test authorization (can users access each other's data?)
- [ ] Scan for XSS vulnerabilities
- [ ] Scan dependencies for vulnerabilities

### Monthly Maintenance

- [ ] Review Supabase auth logs
- [ ] Update dependencies
- [ ] Check for security advisories
- [ ] Review failed login attempts
- [ ] Rotate API keys if needed

---

## Incident Response Plan

### If Credentials Are Compromised

1. **Immediately:**
   - Rotate affected API keys
   - Force logout all users: `supabase.auth.signOut({ scope: 'global' })`
   - Review access logs

2. **Within 24 hours:**
   - Notify affected users
   - Reset passwords for compromised accounts
   - Review and strengthen security

3. **Within 1 week:**
   - Implement additional security measures
   - Document incident and lessons learned
   - Update security policies

---

## Resources

- [Supabase Security Docs](https://supabase.com/docs/guides/auth)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [bcrypt Info](https://en.wikipedia.org/wiki/Bcrypt)

---

*Last Updated: 2025-01-14*
