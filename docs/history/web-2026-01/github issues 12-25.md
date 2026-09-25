# GitHub Issues 12/25

UI improvement issues to create on GitHub.

---

## Issue 1: Mobile responsive layout
**Label:** `ui`

Improve the app's responsiveness on mobile devices.

### Changes needed
- Stack cards vertically under 768px
- Increase touch targets to 44px minimum
- Consider bottom navigation bar for mobile
- Simplify ticker on small screens (fewer stocks or expandable)
- Make table rows tappable

---

## Issue 2: Add empty states for new users
**Label:** `ui`

New users see empty cards with no guidance. Add helpful empty states.

### Changes needed
- Design empty state for portfolio (illustration + CTA)
- Design empty state for leagues list
- Add "getting started" checklist or progress indicator
- Show clear next steps when no data exists

---

## Issue 3: Add skeleton loading states
**Label:** `ui`

Replace spinners with skeleton placeholders that match content shape.

### Changes needed
- Skeleton loaders for portfolio cards
- Skeleton loaders for league lists
- Skeleton loaders for leaderboard tables
- Pulsing gray rectangles that match final layout

---

## Issue 4: New user onboarding flow
**Label:** `enhancement`

Guide new users through setup after signup.

### Changes needed
- Welcome modal with multi-step flow
- Step 1: Welcome message
- Step 2: Link Alpaca account (with skip option)
- Step 3: Join or create a league
- Step 4: Ready confirmation
- Contextual tooltips for first-time actions

---

## Issue 5: Add icons to navigation
**Label:** `ui`

Improve navigation scanability with icons.

### Changes needed
- Add icons alongside nav text (Dashboard, Leagues, Draft, Portfolio, etc.)
- Clearer active state (highlight or underline)
- Consider quick-action "+" button for common actions

---

## Issue 6: Improve dashboard information hierarchy
**Label:** `ui`

Make the most important information stand out.

### Changes needed
- Larger portfolio value (32-40px font)
- More prominent CTA buttons (Trade Stocks, Join Draft)
- Consider mini sparkline chart for portfolio trend
- Consistent card heights for visual rhythm

---

## Issue 7: Enhanced visual feedback for actions
**Label:** `ui`

Improve feedback when users take actions.

### Changes needed
- Button loading spinner inside button (not separate)
- Disable buttons during action to prevent double-clicks
- Brief highlight animation when stock prices update
- "YOUR TURN" indicator with animation in draft
