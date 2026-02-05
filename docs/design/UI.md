# Stockpile – Login Screen UI Design Notes

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
