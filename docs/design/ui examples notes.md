# Stockpile Login / Auth Screen – Design + Implementation Prompt

## Objective
Build a premium, modern login screen for the Stockpile app (fantasy stock league). The screen should feel sophisticated and fintech-grade while remaining minimal and calm. It should balance seriousness and polish with approachability.

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

