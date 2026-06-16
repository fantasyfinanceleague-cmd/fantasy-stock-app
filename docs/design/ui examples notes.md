# Stockpile – Design + Implementation Prompt

## Objective
Build premium, modern screens for the Stockpile app (fantasy stock league). Each screen should feel sophisticated and fintech-grade while remaining minimal and calm. It should balance seriousness and polish with approachability.

The design should not feel like a generic auth page, a crypto app, or a playful game UI.

---

## Visual Direction (Balanced Influence Model)

Use the following references as **style influences**, not direct copies.

### Primary Anchor: Slick (modern dark UI)
Use Slick as the **overall visual anchor**:
- Dark, modern aesthetic with layered surfaces
- Confident typography and clear hierarchy
- Soft, rounded cards and inputs
- Subtle depth through shadows and surface contrast
- Clean, focused layouts with no visual clutter

Slick defines the *tone and confidence* of the screen.

---

### Supporting Influence: Mercury (restraint and clarity)
Use Mercury to enforce **discipline and calm**:
- Minimalism and whitespace
- Soft borders and neutral surfaces
- Clear text hierarchy
- No unnecessary decoration or visual noise
- Calm, trustworthy fintech feel

Mercury should keep the UI from feeling flashy or overdesigned.

---

### Supporting Influence: Conceptzilla / SteadyCash (depth and emphasis)
Use Conceptzilla only for:
- Dark gradient backgrounds (subtle, not loud)
- Strong but restrained primary CTA styling
- Sense of depth through layered panels
- High contrast between background and foreground

Avoid bold reds or heavy branding elements. Use only one accent color.

---

### Supporting Influence: FinBuddy (layout structure only)
Use FinBuddy purely for:
- Card-based layout ideas
- Vertical stacking of content
- Clean grouping of UI elements

Do NOT adopt:
- Light color palettes
- Illustrations or human imagery
- Marketing-heavy visuals

---

## Layout Requirements

### Overall structure (mobile-first)
- Full-screen dark gradient background
- Vertically centered content stack:
  1. Stockpile logo + wordmark
  2. Short tagline (muted)
  3. Auth card containing form elements
  4. Secondary links (Forgot password, Sign up)

---

## Branding
- Use the Stockpile logo:
  - Ascending rounded bars icon
  - White “Stockpile” wordmark
- Logo should be centered above the auth card
- No additional icons or illustrations at the top

---

## Auth Card Design
- Slightly lighter than the page background
- Rounded corners (16–20px)
- Subtle border or shadow for separation
- Calm, glassy or soft material feel (very subtle)

---

## Typography
- Headline: large and confident (e.g. “Welcome back”)
- Subtitle: smaller, muted (value-oriented, one line)
- Body text: neutral gray, highly readable
- Avoid heavy font weights everywhere except headline and CTA

---

## Form Elements
### Inputs
- Tall, rounded inputs
- Dark surface with subtle border
- Smooth focus state using accent glow (not harsh borders)
- Optional left icons (email, lock) only if subtle

### Primary Button
- Full-width
- Single accent color (blue or green)
- Slightly rounded
- Clear hover and pressed states

### Secondary Elements
- “Forgot password?” aligned under password input
- “New here? Create an account →” under the primary button

---

## Optional Onboarding Cue (Inspired by Mercury)
Optionally include a very subtle onboarding hint below the card:
- Small checklist or step labels (low contrast)
  - Join or Create League
  - Draft Your Team
  - Track Performance
- This should not dominate the UI and can be omitted if cluttered

---

## Interaction + Motion
- Smooth fade-in of the card on load
- Subtle hover/focus transitions
- No flashy animations or bouncing effects

---

## Accessibility
- High contrast between text and background
- Large tap targets
- Readable placeholder text
- Keyboard focus states clearly visible

---

## Implementation Notes
- Build using React (or React Native) with clean, reusable components
- Use CSS variables or theme tokens for colors and spacing
- Structure components so they can be reused for Sign Up and Forgot Password screens
- Do not use stock photos or illustrations
- Use only gradients, shapes, and the Stockpile logo

---

## Output Requested
Implement the login screen UI according to the above design direction, prioritizing:
- Clean structure
- Fintech-level polish
- Balanced influence across references
- Readable, maintainable code

---

## IMPORTANT: iOS Keyboard Constraints

### Do NOT use `setState` in `onFocus` / `onBlur` handlers on TextInput

During the login screen implementation, a `FocusableInput` component was created that tracked focus state via `useState` to show a cyan glow effect (border color change, shadow, icon color change) when inputs were focused. This caused a critical bug on iOS where the keyboard would appear for a split second then immediately dismiss, making the login screen unusable.

**Why it happens:** On iOS, when a TextInput receives focus, the native keyboard presentation animation begins. If `setState` is called during `onFocus`, React re-renders the component tree around the TextInput mid-animation. This interrupts iOS's native first-responder chain, causing the keyboard to be dismissed.

### What works
- Static input styling (icons, borders, backgrounds) — no state changes on focus
- `LinearGradient` backgrounds and overlays (use `pointerEvents="none"` on decorative layers)
- `overflow: 'hidden'` on card containers
- `useSafeAreaInsets()` for safe area padding
- Complex view hierarchies with gradients, images, and nested Views

### What breaks keyboard on iOS
- Any `useState` / `setState` call inside `onFocus` or `onBlur` on a TextInput
- This includes wrapper components that manage their own focus state internally
- The re-render during focus transition is the problem, not the state value itself

### If focus effects are needed in the future
- Use React Native `Animated` API with `useNativeDriver: true` to animate border/shadow changes without triggering React re-renders
- Or use `onFocus`/`onBlur` to drive native animations via refs, not state
- Always test on a real iOS device — this issue does not reproduce in simulators the same way

---

## Home Screen Redesign – ofspace Influence Addition

### New Reference: ofspace (layout and structure)
After the initial glassmorphic implementation of the Home screen, the ofspace fintech dashboard reference was introduced. ofspace is a **light-themed** fintech app, but we adopted its **layout patterns only** within our dark theme.

### What We Took From ofspace
- **Personalized greeting header**: "Good morning/afternoon/evening" + user's name, with logo on the opposite side
- **Icon circles on cards**: Small colored circle backgrounds behind icons (e.g., wallet icon on portfolio card, trending icons on results)
- **Activity-list style rows**: Past results rendered as an activity feed with icon, title, subtitle, and right-aligned value — not as table rows
- **Varied card backgrounds**: Different accent tints per card type (cyan tint for portfolio, no tint for sections)
- **"See all" links**: Section headers with subtle navigation links
- **Generous whitespace**: More spacing between sections and within cards

### What We Did NOT Take From ofspace
- Light color palette (we stayed dark)
- Pill toggle buttons (not applicable to our data)
- Illustrations or avatars
- Rounded colored card backgrounds (adapted to glassmorphic dark cards instead)

### How It Combines With Existing Influences
- **Slick** still defines the overall dark tone, typography confidence, and surface layering
- **Mercury** still enforces restraint — no decorative noise, calm spacing
- **Conceptzilla** still provides depth through gradients (background, card overlays)
- **FinBuddy** card-based layout now supplemented by ofspace's activity-list and icon-circle patterns
- **ofspace** adds the personalized, dashboard-like feel with greeting headers and structured data presentation

### Applied To
- Home screen (`app/(tabs)/index.tsx`) — full redesign with lifted gradient cards
- LeagueCarousel — glassmorphic treatment (lifted gradients not yet applied)
- PortfolioChart — glassmorphic container
- Skeleton — glassmorphic loading states

---

## Lifted Gradient Cards — Slick Influence Addition

### Problem with Initial Implementation
The first ofspace-inspired pass used subtle glassmorphic tints on cards. While structurally correct, the result looked "too bland and lame" — cards didn't pop and everything blended together without contrast.

### New Reference: Slick (lifted gradient cards)
Slick's dark UI shows cards that feel **elevated and distinct**:
- Rich gradient backgrounds (not flat or semi-transparent)
- Each card type has its own color identity
- Cards appear to float above the background with depth
- Colored shadows matching the card gradient

### What We Added From Slick
- **Bold gradient fills**: Cards use 3-stop LinearGradients (dark → darker → darkest of a hue)
- **Colored shadows**: Each card's shadow color matches its gradient hue for a glowing effect
- **Color differentiation**: Portfolio = teal, Activity = purple, Status = amber — immediately distinguishable
- **Elevated appearance**: Shadow offset of 8px with large blur radius (20-24px)

### Card Color System
| Card Type | Primary Hue | Gradient | Shadow |
|-----------|-------------|----------|--------|
| Portfolio Value | Teal/Cyan | `#0D4F5F` → `#0B2E35` | `#22D3EE` |
| Recent Results | Purple/Violet | `#2D1F4E` → `#171025` | `#8B5CF6` |
| Draft Pending | Amber/Gold | `#4A3F1A` → `#262010` | `#fbbf24` |
| Draft In Progress | Teal/Cyan | `#0D4F5F` → `#0B2E35` | `#22D3EE` |

### Implementation Pattern
```jsx
// Outer wrapper provides shadow
<View style={{
  shadowColor: '#22D3EE',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.15,
  shadowRadius: 24,
  elevation: 12,
}}>
  {/* LinearGradient IS the card */}
  <LinearGradient
    colors={['#0D4F5F', '#0A3D47', '#0B2E35']}
    style={{
      borderRadius: 20,
      padding: 24,
      borderWidth: 1,
      borderColor: 'rgba(34, 211, 238, 0.2)',
    }}
  >
    {/* Card content */}
  </LinearGradient>
</View>
```

---

## Implementation Pattern for Remaining Pages
When redesigning additional pages, follow this combined influence model:
1. `LinearGradient` background matching login/home (`['#0A0A0F', '#0D1117', '#0A0F1A', '#080B12']`)
2. **Lifted gradient cards** — outer shadow wrapper + LinearGradient as card body
3. **Distinct card colors** — each card type should have its own hue identity
4. Personalized/contextual headers where appropriate
5. Icon circles for visual anchors on key data points
6. Activity-list style for any list data (not plain rows)
7. Cyan primary accent, green for positive/CTA, consistent with `Colors.ts`
8. Generous spacing (24px horizontal margins, 20px+ vertical gaps between sections)
9. Colored shadows matching card gradient for elevated appearance

