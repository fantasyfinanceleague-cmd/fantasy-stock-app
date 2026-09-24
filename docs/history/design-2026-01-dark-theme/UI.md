# Stockpile – UI Design Notes

## Goal
Upgrade the login screen from a generic auth page to a modern, fintech-style entry point that feels trustworthy, premium, and fun. The screen should signal that Stockpile is not a demo app, but a real product with personality.

---

## Core Design Principles
- Minimal but confident
- Dark, modern fintech aesthetic
- Clear hierarchy and containment
- Subtle depth and motion (not flashy)
- Mobile-first

---

## 1. Branding and Logo

### Why
Right now the page relies entirely on text. A logo immediately adds legitimacy and identity.

### Direction
Use a simple, scalable logo that works well at small sizes.

**Logo ideas**
- Monogram: `SP` or `S•P`
- Abstract finance symbols:
  - Stacked bars (portfolio)
  - Upward wedge or chevron (growth)
  - Draft pick indicator (triangle)

**Placement**
Centered above the title.

**Suggested hierarchy**

---

## 2. Background Styling

### Current issue
Flat dark background feels empty and unfinished.

### Improvement
Use a subtle gradient with depth.

**Example**
- Top: #0B1220
- Bottom: #0E1A2F
- Optional soft radial glow behind the form

This creates a premium fintech feel without being distracting.

---

## 3. Form Container (Card)

### Why
Inputs floating directly on the background feel unanchored and less trustworthy.

### Solution
Wrap inputs and button in a card.

**Card style**
- Background slightly lighter than page
- Border: 1px, low contrast
- Border radius: 16–20px
- Soft vertical shadow

This visually frames the action and increases perceived security.

---

## 4. Input Fields

### Improvements
- Increase input height slightly
- Add leading icons (email, lock)
- Softer placeholder text
- Strong but smooth focus state

**Example**
- ✉️ Email address
- 🔒 Password

Avoid default iOS or browser styles where possible.

---

## 5. Call-to-Action Button

### Goal
Make the primary action feel deliberate and safe.

**Enhancements**
- Slight vertical gradient
- Clear pressed/active state
- Rounded corners
- Optional microcopy below button

**Microcopy ideas**
- Secure. Free. No real money required.
- Draft. Track. Compete.

---

## 6. Copy Refinements

Small wording changes can dramatically improve polish.

**Title options**
- Welcome back
- Sign in to your league
- Your draft awaits

**Sign-up prompt**
Replace:

---

## 7. Optional Enhancements

These are nice-to-have, not required.

- Slow animated background gradient
- Fade-in animation for the card on load
- Very subtle ambient motion (low opacity)

Avoid flashy animations or gimmicks.

---

## 8. Visual Inspiration References

These references are for **style and mood only**, not direct copying.

Search terms used:
- modern fintech login screen dark mode
- mobile fintech app login ui dark
- trading app login screen dark
- fantasy sports app login ui dark

Common patterns:
- Dark gradients, not flat colors
- Strong brand presence at top
- Card-based forms
- Confident primary CTAs

---

## Summary
The login screen should:
- Immediately communicate brand and trust
- Feel modern and fintech-forward
- Stay minimal and mobile-friendly
- Make signing in feel intentional, not boilerplate

---

## iOS Keyboard Bug – Lessons Learned

### The Problem
After implementing the premium login screen, tapping on TextInput fields caused the iOS keyboard to briefly appear then immediately dismiss. Users had to spam-tap inputs to get the keyboard to stay open.

### Root Cause
The `FocusableInput` component called `setState` inside an `onFocus` handler to toggle a cyan glow effect on the input border/icon. On iOS, calling `setState` during the keyboard presentation animation triggers a React re-render of the component wrapping the TextInput. This interrupts iOS's native first-responder transition, causing the keyboard to dismiss.

### What Did NOT Cause It
Through systematic testing we ruled out:
- `LinearGradient` background/glow layers (work fine with `pointerEvents="none"`)
- `overflow: 'hidden'` on the card container
- `useSafeAreaInsets()` hook
- The `Image` component (logo)
- Navigation architecture (`_layout.tsx` conditional rendering)

### The Fix
Removed all `onFocus`/`onBlur` state tracking from input components. Inputs use static styling with icons — no dynamic focus glow. The visual design is fully preserved minus the cyan border glow on focus.

### Rules Going Forward
1. **Never call `setState` inside `onFocus` or `onBlur` on iOS** — this triggers a re-render during the keyboard animation and will dismiss the keyboard
2. If focus-based visual effects are needed, use `Animated` with `useNativeDriver: true` driven by the TextInput's native focus event, which avoids React re-renders
3. Always test TextInput keyboard behavior on a real iOS device after adding wrapper components or focus handlers
4. Keep input components simple — a `View` + `Ionicons` + `TextInput` with static styles works reliably

---

## Home Screen Redesign

### Goal
Apply the premium fintech aesthetic established on the login screen to the Home screen, while adopting layout patterns from the ofspace reference (a fintech dashboard with personalized greeting, icon circles, activity-list rows, and varied card styling).

### Design Direction
**Dark theme + lifted gradient cards.** Combine ofspace's layout patterns with Slick's elevated card aesthetic. Each card type has a distinct color identity with bold gradients and colored shadows that make them float above the background.

### Key Principles (Slick + ofspace hybrid)
1. **Lifted cards** — Cards use rich gradient backgrounds (not flat colors) with colored shadows for depth
2. **Color differentiation** — Each card type has a distinct hue (teal for portfolio, purple for activity, amber for pending)
3. **Colored shadows** — Shadow color matches the card's gradient for a glowing, elevated effect
4. **Bold contrasts** — Cards should pop, not blend into the background

### What Changed

#### Colors.ts (Global Palette Update)
The entire color system was shifted darker to match the login screen:
- `background`: `#0A0A0F` (deep black, was slate blue)
- `headerBg`: `#0D1117` (matches login gradient mid-tone)
- `cardBg`: `#111827` (darker, richer cards)
- `primary`: `#22D3EE` (cyan, matches login/logo accent — was blue)
- `border`: changed from opaque slate to `rgba(255,255,255,0.08)` (subtle white)
- Added `glassBg`: `rgba(17,24,39,0.7)` for semi-transparent cards
- Added `glassBorder`: `rgba(255,255,255,0.06)` for glassmorphic borders
- Added `accent`: `#10B981` (green, for gradient CTAs)
- Tab active color shifted to cyan

#### Home Screen Layout
- **Header**: Personalized greeting ("Good morning/afternoon/evening" + username from `user_profiles`) with Stockpile logo on the right
- **Background**: Multi-stop `LinearGradient` matching login (`['#0A0A0F', '#0D1117', '#0A0F1A', '#080B12']`)
- **Spacing**: Generous padding and margins throughout

#### Lifted Gradient Cards
Each card wraps in an outer View with colored shadow, containing a LinearGradient as the card background:

| Card Type | Gradient Colors | Shadow Color | Border |
|-----------|-----------------|--------------|--------|
| Portfolio | `#0D4F5F` → `#0A3D47` → `#0B2E35` (teal) | `#22D3EE` | `rgba(34, 211, 238, 0.2)` |
| Recent Results | `#2D1F4E` → `#1E1535` → `#171025` (purple) | `#8B5CF6` | `rgba(139, 92, 246, 0.2)` |
| Draft Pending | `#4A3F1A` → `#352D14` → `#262010` (amber) | `#fbbf24` | `rgba(251, 191, 36, 0.2)` |
| Draft In Progress | `#0D4F5F` → `#0A3D47` → `#0B2E35` (teal) | `#22D3EE` | `rgba(34, 211, 238, 0.2)` |
| Prompt Card | `#1A2B3C` → `#141F2B` → `#0E161F` (slate) | `#22D3EE` | `rgba(34, 211, 238, 0.15)` |

Shadow settings: `shadowOffset: { width: 0, height: 8 }`, `shadowOpacity: 0.12-0.15`, `shadowRadius: 20-24`

#### Activity List Style
- Past results rendered as activity feed rows with icon circles
- Icon colors: green for wins (`#4ade80`), red for losses (`#f87171`), amber for ties (`#fbbf24`)
- Icon backgrounds: `rgba(color, 0.25)` for more vibrancy

#### Supporting Components
- **LeagueCarousel**: Glassmorphic card treatment with gradient overlays, darkened stats rows
- **PortfolioChart**: Glassmorphic container, uppercase label-style title
- **Skeleton**: Updated to match glassmorphic card style

### Pages Still To Do
- Portfolio tab
- Matchup tab
- League tab
- Leagues list tab
- Profile tab
- Draft screen
- All modal/detail screens
