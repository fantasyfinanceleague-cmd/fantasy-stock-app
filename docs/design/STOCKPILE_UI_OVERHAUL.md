# Stockpile — UI Overhaul Specification

> **What this document is:** A comprehensive, screen-by-screen design specification for overhauling the Stockpile mobile app UI. This is intended to be used as a prompt/reference for Claude Code to execute against the existing codebase.

> **What Stockpile is:** A React Native (Expo) fantasy sports–style investing app. Users draft real stocks into a portfolio "team," compete head-to-head in weekly matchups within leagues, and climb leaderboards based on portfolio performance. Think ESPN Fantasy Football meets Robinhood.

---

## Tech Stack

- **React Native** via Expo SDK — cross-platform iOS/Android
- **Expo Router** — file-based navigation (tabs, stacks, modals)
- **TypeScript** — full type safety
- **Supabase** — auth, PostgreSQL, real-time
- **expo-linear-gradient** — gradient backgrounds and card effects
- **EAS Build + EAS Update** — build pipeline and OTA deployment
- Monorepo structure under `apps/mobile/`

---

## Design Philosophy

This project has **two types of work** — it's important to understand the distinction:

1. **Home screen: architectural rebuild.** The Home screen is being fundamentally reimagined from a single-league dashboard into a cross-league personal overview. This is NOT a reskin — it changes what data is shown, how leagues are selected, and introduces a new global league context that affects every other tab. This is the biggest piece of work in the project and should be built first after the foundation.

2. **All other screens (Login, Draft, Portfolio, Matchup, League, Profile): visual reskin.** These screens keep their existing functionality and data — we are changing how they look (light theme, new typography, refined color, better spacing) and adding a league selector dropdown to their headers, but the core behavior stays the same.

Do not underestimate the difference. The Home screen rebuild touches app state architecture, data aggregation, and cross-tab navigation. The other six screens are primarily CSS/styling changes with a new component slotted into the header.

### The Biggest Change: Light Theme

The current app uses a dark theme. We are **switching to a light theme as the default.** This is a deliberate, strategic decision for the following reasons:

1. **Whitespace works harder on light.** Our #1 priority is reducing density and adding breathing room. On dark backgrounds, empty space reads as "unfinished" or void. On light backgrounds, it reads as intentional, clean, and premium. Every luxury fintech app leverages this.

2. **Three of our four reference apps are light-first.** Robinhood, Coinbase, and Public all default to light. Only Sleeper is dark. If we want users to perceive Stockpile as a legitimate fintech app, light is the faster path.

3. **Text hierarchy becomes natural.** Dark themes compress the contrast range (white → gray → darker gray on black). Light themes give us rich black headlines, medium gray labels, and soft light-gray tertiary text — the steps are more readable and more natural.

4. **It signals "real financial product."** Dark-themed finance apps tend to read as crypto or trading-for-gamers. Light themes read as institutional and trustworthy.

We can add a dark mode toggle later as a user preference — but v1 of the redesign ships light.

### Reference Apps (in priority order)

1. **Robinhood** — The primary reference for financial data screens (portfolio, holdings, P/L) AND for overall visual tone. This is what we want Stockpile to feel like when someone opens it. Study: the single dominant dollar figure, the clean stock list rows, the generous whitespace on a white background, and the disciplined green/red color system.

2. **Coinbase** — Reference for information architecture and the Home dashboard pattern. Study: how they summarize a portfolio at a glance on a light canvas, use subtle card shadows for depth, and keep screens uncluttered.

3. **Public** — Reference for the social/competitive layer and editorial quality. Study: how they present community elements on a light theme tastefully, their typography-driven design, and clean data visualization.

4. **Sleeper** — Reference for competitive/social screens (league standings, matchups, draft). Even though Sleeper is dark, the *patterns* are what matter: how they handle standings rows, matchup versus cards, and draft pick lists. Translate those patterns to our light theme.

### The Guiding Principle

Every design decision should pass this test: *"Would a user showing this app to a friend say 'this looks legit' or 'this looks like a side project'?"* We are targeting the former.

### Design Priorities (in this order)

1. **Strip down density / add whitespace** — The single most impactful change. Every screen should feel like it has room to breathe.
2. **Simplify complex cards** — Especially the Home league card. Fewer buttons, fewer borders, fewer competing elements.
3. **Refine color usage** — Cyan becomes surgical. Green/red only for P/L. No decorative color.
4. **Remove inline Buy/Sell from holdings** — Clean stock rows, tap-to-act.
5. **Add portfolio performance chart** — The credibility-builder.

---

## Global Design System

### 1. Color Palette

The current dark theme is being replaced with a clean, professional light theme. The brand accent color remains **cyan** but is refined and used surgically.

```
// theme/colors.ts

const colors = {
  // Backgrounds — layered depth system (3 levels, light)
  bgBase:        '#FFFFFF',    // primary screen background — pure white
  bgSurface:     '#F8FAFC',    // cards, grouped sections, list backgrounds (Slate-50)
  bgElevated:    '#F1F5F9',    // nested elements, stat rows, input fields (Slate-100)
  bgScreen:      '#FFFFFF',    // synonym for bgBase, used for clarity in screen-level bg

  // Brand Cyan — used surgically, NOT decoratively
  cyan:          '#0891B2',    // refined for light theme — deeper teal-cyan (Cyan-600)
                               // The current bright #00E5FF is too loud on white.
                               // #0891B2 reads as professional and intentional on light backgrounds.
  cyanLight:     '#ECFEFF',    // very faint cyan tint for selected states (Cyan-50)
  cyanMuted:     'rgba(8,145,178,0.08)',  // subtle highlight backgrounds

  // Semantic Colors — adjusted for light theme legibility
  positive:      '#059669',    // gains, wins, positive P/L (Emerald-600 — darker than dark-theme green for contrast on white)
  positiveMuted: '#ECFDF5',    // chip/badge backgrounds for gains (Emerald-50)
  negative:      '#DC2626',    // losses, sells, negative P/L (Red-600)
  negativeMuted: '#FEF2F2',    // chip/badge backgrounds for losses (Red-50)
  warning:       '#D97706',    // ties, pending states, gold rankings (Amber-600)
  warningMuted:  '#FFFBEB',    // chip/badge backgrounds for warnings (Amber-50)

  // Text Hierarchy — this is where light theme shines
  textPrimary:   '#0F172A',    // headings, hero numbers, stock tickers (Slate-900) — rich black
  textSecondary: '#64748B',    // labels, descriptions, metadata (Slate-500)
  textTertiary:  '#94A3B8',    // timestamps, IDs, inactive elements (Slate-400)
  textInverse:   '#FFFFFF',    // text on cyan/dark backgrounds (button labels)

  // Borders & Dividers — light theme uses visible but gentle borders
  border:        '#E2E8F0',    // card borders, list separators (Slate-200)
  borderLight:   '#F1F5F9',    // very subtle dividers within cards (Slate-100)

  // Shadows — on light theme, shadows replace the dark-theme "bg color elevation" trick
  // Use these as style objects, not color values:
  // shadowSm:   { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }
  // shadowMd:   { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 }

  // Tab Bar
  tabInactive:   '#94A3B8',    // Slate-400
  tabActive:     '#0891B2',    // Cyan-600 (matches brand cyan)
  tabBarBg:      '#FFFFFF',    // white tab bar with top border
};
```

**CRITICAL — Cyan on light theme:**
The current bright `#00E5FF` (electric cyan) will look garish on a white background. It MUST be darkened to `#0891B2` (Tailwind Cyan-600) or similar. This gives us a professional teal-cyan that reads as intentional and premium on white, not neon.

**Cyan usage rules (same discipline, new shade):**
- **DO** use cyan for: the active tab bar icon/label, primary CTA buttons, and the "you" indicator in standings (left accent bar)
- **DO NOT** use cyan for: card borders, section headers, every button, secondary buttons, link text in general
- Positive/negative values should use `positive`/`negative` colors, NEVER cyan

**Key differences from dark theme approach:**
- On dark, cards were differentiated by *background color* (slightly lighter rectangle on dark bg). On light, cards are differentiated by *subtle shadow + white card on gray-white bg*, or by a very light `bgSurface` background.
- On dark, borders were being removed. On light, **subtle borders are fine and often necessary** — `#E2E8F0` (Slate-200) borders on white cards are clean and professional. The problem was never borders themselves — it was neon cyan borders.
- The heavy teal gradients on cards (current portfolio value card) must go entirely. On a light theme, gradients are rarely needed. Use flat white or `bgSurface` cards.

### 2. Typography

Install `Inter` via `expo-google-fonts` (`@expo-google-fonts/inter`). It is the industry standard for fintech and data-heavy UIs. On a light background, Inter's weight range reads beautifully.

```
// theme/typography.ts

const typography = {
  // Display — hero numbers (portfolio value, big P/L)
  display: {
    fontFamily: 'Inter_700Bold',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: colors.textPrimary,  // Rich black on white — maximum impact
  },

  // H1 — screen titles
  h1: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },

  // H2 — section headers ("Current Holdings", "Standings")
  h2: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
  },

  // H3 — card titles, stock tickers
  h3: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },

  // Body — descriptions, company names
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },

  // Caption — labels ("Portfolio Value", "Budget Left"), secondary info
  caption: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    color: colors.textSecondary,
  },

  // Micro — badges, timestamps, tertiary data
  micro: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
    color: colors.textTertiary,
  },

  // Mono — dollar values, percentages (for tabular alignment)
  mono: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
};
```

**Typography rules:**
- **NEVER use ALL CAPS** for section headers. The current "ACCOUNT INFORMATION", "ALLOCATION", "TEAMS", "TOTAL PICKS" style looks dated. Use Title Case with `h2` style instead.
- Stock ticker symbols (AAL, BA, INTC) should use `h3` in `textPrimary` — they are primary identifiers and read beautifully in rich black on white.
- All dollar amounts and percentages should use `fontVariant: ['tabular-nums']` so numbers align in columns.
- P/L percentage badges should have a fixed minimum width so layout doesn't jiggle.
- On light theme, the contrast range is naturally wider. Use this advantage: `textPrimary` (near-black) for important things, `textSecondary` (medium gray) for labels, `textTertiary` (light gray) for stuff you barely need to see. The three levels should feel obviously distinct.

### 3. Spacing System

Use an 8px base grid. This doesn't change between light and dark:

```
// theme/spacing.ts

const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
};

// Screen padding (horizontal): 20px (xl) — slightly more generous than before
// Card internal padding: 16px (lg)
// Space between cards: 12px (md)
// Space between sections: 32px (3xl) — MORE than before; light themes need more breathing room
```

**CRITICAL spacing change for light theme:** Section spacing increases from 24px to 32px. Light themes expose density more than dark ones — what felt "tight but fine" on dark will feel cramped on white. Be generous. When in doubt, add more space.

### 4. Card System

On a light theme, cards work differently than on dark. Instead of "lighter rectangle on dark background," we use **white cards with subtle shadows on a near-white background**, or **bordered cards**.

```tsx
// components/ui/Card.tsx

// Base card (most common — used for league cards, portfolio sections, etc.):
//   - backgroundColor: '#FFFFFF' (pure white)
//   - borderRadius: 16
//   - padding: spacing.lg (16)
//   - border: 1px solid colors.border (#E2E8F0)
//   - Shadow (iOS): { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }
//   - Shadow (Android): elevation: 2
//   - This gives a clean, floating card look — like Robinhood/Coinbase

// Grouped card (for settings lists, account info — iOS grouped table style):
//   - backgroundColor: '#FFFFFF'
//   - borderRadius: 12
//   - border: 1px solid colors.border
//   - NO shadow (flat, inset feel)
//   - Internal rows separated by borderLight dividers

// Elevated card (for nested elements — stat rows inside cards, input fields):
//   - backgroundColor: colors.bgSurface (#F8FAFC) or colors.bgElevated (#F1F5F9)
//   - borderRadius: 12
//   - padding: spacing.md (12)
//   - NO border, NO shadow — differentiated by background tint only

// Active/selected card (e.g., "your" league card in carousel):
//   - Same as base but with borderLeft: 3px solid colors.cyan
//   - Background: colors.cyanLight (#ECFEFF) — very faint cyan tint
//   - NO thick colored border wrapping the entire card
```

**Card rules:**
- **Remove ALL cyan borders.** Replace with `colors.border` (Slate-200) borders where needed, or shadows. This is still the #1 rule.
- On light theme, a 1px border in `#E2E8F0` is clean and professional. Don't be afraid of borders — the problem was always the *color* (neon cyan), not the concept of borders.
- Cards should feel like they gently lift off the page. Subtle shadow + white bg achieves this.
- Rounded corners: 16px for top-level cards, 12px for nested elements/grouped lists, 8px for chips/badges.
- **No gradients on cards.** The current teal gradient portfolio card must become a flat white or `bgSurface` card. On light theme, gradients on cards look out of place.

### 5. Buttons

```
// Button hierarchy:

// Primary (1 per screen max):
//   - Solid cyan background (colors.cyan: #0891B2)
//   - White text (textInverse)
//   - borderRadius: 12
//   - height: 48
//   - Full width or prominent placement
//   - Used for: "Buy Stock" on Portfolio, "Sign In" on Login

// Secondary:
//   - backgroundColor: '#FFFFFF'
//   - Border: 1px solid colors.border (#E2E8F0)
//   - Text: colors.textSecondary
//   - borderRadius: 12
//   - height: 48
//   - Used for: "Trade History", "League" quick-links

// Positive Action (Buy):
//   - Background: colors.positiveMuted (#ECFDF5)
//   - Text: colors.positive (#059669)
//   - NOT a full solid green block

// Negative Action (Sell):
//   - Background: colors.negativeMuted (#FEF2F2)
//   - Text: colors.negative (#DC2626)
//   - NOT a full solid red block

// Ghost:
//   - No background, no border
//   - Text: colors.cyan or colors.textSecondary
//   - Used for: tertiary actions, "Tap for details", "Forgot password?"
```

### 6. Tab Bar

- Background: `#FFFFFF` (white) with a top border (`colors.border`)
- Inactive icons: `tabInactive` (Slate-400)
- Active icon + label: `tabActive` (Cyan-600) — one of the correct uses of cyan
- Add a subtle active indicator: a small 4px dot or 20px underline beneath the active icon, in cyan
- Icon style: outlined icons from a consistent set (`@expo/vector-icons` Ionicons). Make sure they all have the same visual weight.
- Consider dropping Draft to 5 tabs (optional — Draft is rarely used outside draft day)

### 7. Empty States

On light theme, empty states feel even more exposed because the white background amplifies the emptiness. This makes proper empty state design even more important:

```
// Empty State Pattern:
//
// 1. A styled icon in a soft circular background
//    - Icon: 24px, colors.textTertiary
//    - Circle: 56px, colors.bgElevated (#F1F5F9)
//
// 2. Title in h2 style, textPrimary
//
// 3. Description in body style, textSecondary, max 2 lines, centered
//
// 4. Optional CTA button or ghost link
//
// Vertically centered with slight upward bias (40% from top, not 50%)
```

### 8. Animations & Transitions

Same as before — these don't change with the theme switch:

- **Cards:** Slight scale press feedback (scale to 0.98 on press)
- **Numbers:** Animate portfolio value changes (count up/down)
- **Standings rows:** Stagger animation on list load (each row fades in 50ms after previous)
- **Tab bar:** Smooth color transition on active tab change

### 9. Status Bar

**IMPORTANT:** Since we're switching to a light theme, the status bar style must change:
- Set `StatusBar` to `barStyle="dark-content"` (dark text on light background)
- On the Login screen, if you keep a dark/branded header area, use `barStyle="light-content"` for that screen only
- In Expo: `<StatusBar style="dark" />` in the root layout

---

## Screen-by-Screen Specifications

> **Two types of work below.** The Home screen (Screen 2) is an **architectural rebuild** — new data, new state management, new role in the app. It is NOT a reskin. Every other screen (1, 3–7) is a **visual reskin** — same functionality, new look. The Home screen section is significantly longer and more detailed because it requires building new components, new data queries, and a global league selection system that touches every other tab. Read it carefully.

### Screen 1: Login / Sign Up

**Current state:** Dark background, centered logo, tagline, a bordered card with email/password fields, cyan-to-green gradient Sign In button, "Create an account" link.

**Changes:**

The Login screen is the ONE screen where we may keep a darker or branded background to create a "moment" before entering the light app. Two options:

**Option A (recommended): Light login.** Full white background, consistent with the rest of the app. Clean, confident, Robinhood-style.

**Option B: Branded login.** Keep a dark navy (`#0F172A`) background for just the login screen as a brand moment, with the light app revealed after sign-in. This creates a nice contrast/reveal. If choosing this option, adjust text colors to white and input fields to dark-elevated.

For either option:
- **Logo:** Stockpile logo with breathing room above. On light bg, the bar-chart icon should use `colors.cyan` and the wordmark should use `textPrimary`.
- **Tagline:** "Draft stocks. Build a portfolio. Beat your friends." in `body` / `textSecondary`.
- **Form card:** On light bg, use `bgSurface` or white with `border` and subtle shadow. On dark bg (option B), use a slightly lighter card (`#1E293B`). Internal padding: 24px.
- **Input fields:**
  - Background: `colors.bgElevated` (#F1F5F9) on light, `#1A2035` on dark
  - Border: `colors.border`, `cyan` border on focus
  - Border radius: 12px, height: 52px
  - Leading icons: `textTertiary`, 20px
- **Sign In button:** Solid cyan (`colors.cyan`), white text. Full width. Height 52px. Border radius 12px. **No gradient** — solid is more premium.
- **"Forgot password?"** — right-aligned, `caption`, `textTertiary`.
- **"New here? Create an account"** — below card, "New here?" in `textSecondary`, "Create an account" in `cyan`.

---

> ### 🔧 ARCHITECTURAL REBUILD — READ CAREFULLY

### Screen 2: Home (Personal Overview)

**This is a fundamental rethink.** The Home screen is no longer scoped to a single league. It is the only screen in the app that shows a cross-league personal overview. All other tabs (Portfolio, Draft, Matchup, League) remain league-scoped with their own league selector.

**Current state:** Light bg (already migrated), greeting, league card carousel with cyan border and 4 buttons, portfolio value for selected league, allocation donut chart, Recent Results for selected league.

**New role:** Home answers two questions at a glance: "How am I doing overall?" and "What's happening across my leagues right now?" It is a personal dashboard, not a league dashboard. Three sections, zero scroll needed to see everything.

**Layout order (top to bottom):**
1. Header (greeting + logo)
2. Total Portfolio Value (hero number — aggregated across all leagues)
3. Portfolio Performance Chart (time-series line chart with period selectors)
4. Your Leagues (compact list with per-league record, rank, P/L)
5. This Week's Matchups (all active matchups across all leagues)

**Screen background:** `colors.bgBase` (#FFFFFF) or `colors.bgSurface` (#F8FAFC).

---

**Section 1: Header**
- "Good evening" in `caption` / `textSecondary` + username in `h1` / `textPrimary`.
- Top-right: Small Stockpile bar-chart icon (24px). Use the icon-only logo mark.
- This is your Home, not any league's Home. The greeting anchors it as personal.

---

**Section 2: Total Portfolio Value (Hero)**
This is the headline number. It aggregates portfolio value across ALL of the user's leagues.

```
// Layout:
//
//   Total Portfolio Value          ← caption / textSecondary
//   $567.88                        ← display (34px) / textPrimary — the hero
//   +$344.53  +154.01%             ← positive color + positiveMuted chip
//   across 2 leagues               ← caption / textTertiary
```

- "Total Portfolio Value" label in `caption` / `textSecondary`
- The aggregate dollar amount in `display` (34px, `textPrimary`). This is the single most prominent element on the entire screen.
- Aggregate P/L: total dollar change in `positive` or `negative` color, total percentage in a muted chip
- "across N leagues" in `caption` / `textTertiary` — contextualizes the number
- **No card, no border.** Sits directly on the screen background. On white, a big black number needs nothing around it.

**Backend note:** This requires summing portfolio values and P/L across all of the user's active leagues. If a user has leagues in different seasons or states, only include leagues with active portfolios.

---

**Section 2b: Portfolio Performance Chart**
A time-series line chart showing aggregate portfolio value over time, placed directly below the hero number. This is the Coinbase/Robinhood signature element.

```
// Layout and behavior:
//
//   Total Portfolio Value                    ← NEVER changes. Always current value.
//   $1,222.77                               ← NEVER changes. Always current value.
//   +$304.36  +33.14%                       ← DOES change based on selected time period
//   across 2 leagues
//
//   ┌──────────────────────────────────────────┐
//   │        ╱╲    ╱─╲   ╱──╲   ╱╲  ╱───╲╱─── │
//   │  ╱─╲╱╱  ╲╱╱    ╲─╱    ╲╱╱  ╲╱           │
//   │╱╱                                        │  ← line fills the FULL vertical space
//   └──────────────────────────────────────────┘
//     1W       1M       Season       All
//
// When user switches from "All" to "1W":
//   - $1,222.77 stays the same (always current total)
//   - P/L updates to show change over last 7 days only:
//     e.g., "+$18.42  +1.53%" (what you gained THIS WEEK)
//   - Chart re-renders to show only the last 7 days of data
//   - Line color updates based on THIS PERIOD's direction
//     (you could be up overall but down this week)
```

**P/L update behavior — THIS IS CRITICAL:**
The total portfolio value ($1,222.77) is ALWAYS the current real-time value. It never changes when you switch time periods. What DOES change is the P/L line below it:
- **All:** shows total gain/loss since account creation (+$304.36 / +33.14%)
- **Season:** shows gain/loss since the current season started
- **1M:** shows gain/loss over the last 30 days
- **1W:** shows gain/loss over the last 7 days

This is exactly how Coinbase works. The P/L is relative to the start of the selected time window. The formula is: `current value - value at start of selected period`. The percentage is: `(current - start) / start * 100`.

**Implementation pseudocode for P/L updates — follow this exactly:**
```typescript
// When the user selects a time period:
function onPeriodChange(period: '1W' | '1M' | 'Season' | 'All') {
  const currentValue = totalPortfolioValue; // e.g., $1,222.77 — NEVER changes
  
  // Get the portfolio value at the START of the selected period
  const startValue = getValueAtStartOfPeriod(period);
  // e.g., if period is '1W' and portfolio was $1,204.35 seven days ago:
  //   startValue = 1204.35
  
  // Calculate P/L for THIS period
  const dollarChange = currentValue - startValue;  // $18.42
  const percentChange = ((currentValue - startValue) / startValue) * 100;  // +1.53%
  
  // Update the UI:
  // - totalValue display: DO NOT TOUCH. stays at $1,222.77
  // - dollarChange display: update to "+$18.42"
  // - percentChange display: update to "+1.53%"
  // - line color: dollarChange >= 0 ? colors.cyan : colors.negative
  
  // Filter chart data to only include points within this period
  const chartData = allDataPoints.filter(point => point.date >= periodStartDate);
  
  // Re-render chart with new data
  renderChart(chartData);
}
```

**Implementation pseudocode for Y-axis scaling — THIS IS WHY THE CHART LOOKS FLAT:**
```typescript
// ❌ WRONG — what's happening now (scaling from 0):
const yMin = 0;
const yMax = Math.max(...dataPoints.map(d => d.value)); // e.g., 1230
// Result: line compressed into top ~2% of chart, 98% empty white space

// ✅ CORRECT — auto-scale to data range:
const values = dataPoints.map(d => d.value);
const dataMin = Math.min(...values);  // e.g., 1205
const dataMax = Math.max(...values);  // e.g., 1230
const range = dataMax - dataMin;      // e.g., 25
const padding = range * 0.1;          // 10% padding = 2.50

const yMin = dataMin - padding;       // 1202.50
const yMax = dataMax + padding;       // 1232.50

// Now a $25 movement fills the full chart height
// A value of 1205 maps to near the bottom, 1230 maps to near the top
// Even tiny movements become visible — exactly like Coinbase

// Edge case: if range is 0 (perfectly flat), add fixed padding:
if (range === 0) {
  const flat = values[0];
  yMin = flat * 0.999;
  yMax = flat * 1.001;
}

// Map each data point to pixel coordinates:
function valueToY(value: number, chartHeight: number): number {
  return chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;
}
```

The Y-axis scaling is the single most important chart fix. Without it, a portfolio that moves from $1,205 to $1,230 (a real $25 movement) renders as a barely visible line at the top of the chart because the Y-axis spans from $0 to $1,230. With auto-scaling, that same $25 movement fills the entire chart height and you can see every fluctuation — exactly like Coinbase shows a 0.24% change as visible hills and valleys, not a flat line.

**Chart rendering — QUALITY REQUIREMENTS:**

The current chart has significant issues visible in the screenshot. Fix all of the following:

1. **Y-axis auto-scaling:** The chart MUST scale its Y-axis to the actual data range, NOT from zero. If portfolio values range from $1,180 to $1,230, the chart's Y-axis should span roughly $1,170 to $1,240 — so the line fills the full vertical space. The current chart appears to scale from $0, which compresses the line into a thin band at the top with a massive empty area below. This is the #1 rendering problem. Coinbase's chart always fills the vertical space because it auto-scales to the data range with a small padding above and below.

2. **Data density:** The line needs enough data points to look smooth, not jagged. For a 1W view, aim for at least 1 point per hour (~168 points). For 1M, at least 1 per day (~30 points). For Season/All, 1 per day. If you don't have this granularity, interpolate or use a smooth curve algorithm (e.g., monotone cubic interpolation / `curveMonotoneX` in d3) to smooth the line between available points. A line with only 5-10 points looks like a connect-the-dots exercise, not a chart.

3. **Chart height:** Reduce to ~120px maximum. The current chart is consuming nearly half the screen and pushing leagues and matchups below the fold. The chart is supplementary — it adds credibility, but the league rows and matchup cards are the actionable content. The chart should NOT push them out of view.

4. **Line quality:** 2px stroke width, with anti-aliasing. The line should look smooth and precise, not pixelated or jagged. If using `react-native-svg`, use `<Path>` with a smooth curve algorithm, NOT straight `<Line>` segments between points.

5. **No fill/gradient beneath the line.** Just the line itself on a white background. Clean and minimal.

6. **Full width bleed:** The chart extends to both edges of the screen — no horizontal padding. This is the Coinbase/Robinhood pattern. It's one of the few elements that breaks out of the standard 20px screen padding.

7. **Vertical padding within the chart:** Add ~10% padding above the highest data point and below the lowest. This prevents the line from touching the very top or bottom edge of the chart container.

**Line color:**
- `colors.cyan` (#0891B2) when the P/L for the selected period is positive
- `colors.negative` (#DC2626) when the P/L for the selected period is negative
- The color should change when switching time periods if the direction changes (e.g., up overall but down this week → line flips from cyan to red when switching to 1W)

**Time period selectors:**
- Horizontal row of pills below the chart: `1W · 1M · Season · All`
- Active pill: `bgElevated` background (#F1F5F9) + `textPrimary` text, borderRadius: 16
- Inactive pills: no background, `textTertiary` text
- Centered, `caption` weight
- Tapping a period: re-renders chart data, updates P/L values, potentially changes line color
- Default selected period: `All`
- Animate the transition between periods — a smooth crossfade or redraw, not an instant snap

**Touch interaction (stretch goal for polish phase):**
When the user drags a finger across the chart, the hero P/L line (NOT the total value) dynamically updates to show the value at that point in time relative to the start of the selected period. A thin vertical hairline follows the finger position. Lifting the finger snaps back to the current P/L. This is the signature Robinhood interaction.

**Data notes:**
- This chart shows the AGGREGATE portfolio value across all leagues over time
- **Data storage:** This requires historical snapshots. If not currently stored, add a daily cron/edge function that records each user's total portfolio value (summed across leagues). For intraday granularity on the 1W view, consider hourly snapshots or derive from stock price history × holdings.
- The chart should work with a single league (just shows that league's curve) and multiple leagues (summed values)
- Library recommendation: `victory-native` or `react-native-svg` with d3-shape for curve interpolation. Avoid heavy charting libraries — we need a single smooth line, not a full charting framework.
- If data is sparse (new user, few days of history), use fewer time period options. Don't show "1M" if the user has only been active for 3 days — either hide that pill or show it grayed out.

---

**Section 3: Your Leagues (compact list)**
Each league the user is in gets a compact row — NOT the current tall carousel card. Think of this like Coinbase showing your different wallets, or Sleeper's league list.

```
// Section label: "Your Leagues" in caption / textSecondary
//
// Each league row (inside a white grouped card with border):
//
//   ┌──────────────────────────────────────────────┐
//   │ 🤑  Test                    2nd    3-2-1     │
//   │     Season 1 · Week 8     ────    $283.66    │
//   ├──────────────────────────────────────────────┤
//   │ 🏈  League 2                1st    5-0-0     │
//   │     Season 1 · Week 5     ────    $284.22    │
//   └──────────────────────────────────────────────┘
//
// Breakdown per row:
//   Left:
//     - League emoji (20px) + League name in h3 / textPrimary
//     - "Season 1 · Week 8" in micro / textTertiary (below name)
//   Right (two columns):
//     - Rank: small pill/chip "2nd" in bgElevated bg, textPrimary text
//     - Record: "3-2-1" in mono / textPrimary (W-L-T, always in this order)
//     - Portfolio value for THIS league: "$283.66" in caption / textSecondary
//
// Row height target: ~56-60px
// Rows separated by borderLight dividers inside the grouped card
```

**CRITICAL: Per-league records, not aggregated.** The user specifically needs to see that they're 5-0 in one league and 0-5 in another. An aggregated 5-5 hides the story. Each row shows that league's record independently.

- Tapping a league row does two things:
  1. Sets that league as the active league context for Portfolio, Matchup, League, and Draft tabs
  2. Navigates to the League tab (or optionally to a league detail view)
- If the user has only 1 league, still show it as a row in this section (it just won't be a list). The layout should work for 1 league and 10 leagues.
- Consider adding a small chevron (›) on the right edge to indicate tappability
- If a league has a notable status (draft pending, season ended), show a small status chip: "Draft Today" in `warningMuted` / `warning`, or "Season Over" in `bgElevated` / `textTertiary`

---

**Section 4: This Week's Matchups**
Shows ALL active matchups across all leagues. This is the engagement hook — the thing that makes someone open the app to check if they're winning.

```
// Section label: "This Week" in caption / textSecondary
//
// Summary line (optional, above the cards):
//   "Winning 1 · Losing 1" in caption — green "Winning 1", red "Losing 1"
//   Only show this if the user has 2+ active matchups. Skip for 1 matchup.
//
// Each matchup (compact card, white with border, 12px radius):
//
//   ┌──────────────────────────────────────────────┐
//   │ 🤑 Test · Week 8                             │
//   │                                              │
//   │  stockpile       VS          Bot 1           │
//   │  $283.66                     $291.02         │
//   │  +$171.98                    +$180.34        │
//   └──────────────────────────────────────────────┘
//
// Top line: League emoji + league name + "Week N" — all in micro / textTertiary
//   This identifies WHICH league the matchup belongs to
//
// Body: Two-column layout
//   Left column (You):
//     - Username in h3 / textPrimary
//     - Portfolio value in mono — in positive color if you're winning, textPrimary if losing
//     - P/L in caption / positive or negative
//   Center:
//     - "VS" in micro / textTertiary
//   Right column (Opponent):
//     - Same layout, mirrored
//     - Portfolio value in positive color if THEY'RE winning
//
// Winning indicator:
//   The side with the higher portfolio value gets its dollar amount in positive color.
//   The other side stays in textPrimary (not red — don't punish the user, just highlight the winner).
//   Optionally: a very faint positiveMuted tint on the winning half of the card.
```

- Each matchup is its own card (not rows in a grouped list) because they need space for the two-column layout
- If a user has 3+ matchups, this section scrolls vertically (not horizontally — horizontal carousels are hard to discover)
- Cards are separated by 8px gaps
- Tapping a matchup card navigates to the Matchup tab with that league selected
- **When there are no active matchups:** Show a single-line message: "No matchups this week" in `caption` / `textTertiary`, inline (no card, no empty state illustration). Home should never waste vertical space on elaborate empty states — the Matchup tab handles that.

---

**What's NOT on Home anymore:**
- ~~League card carousel~~ → Replaced by compact league rows
- ~~Allocation chart~~ → Moved to Portfolio tab
- ~~League-scoped portfolio value~~ → Replaced by aggregate total; per-league values visible in league rows
- ~~4 action buttons (Portfolio, League, Share, Settings)~~ → Removed entirely; the tab bar handles navigation
- ~~League carousel pagination dots~~ → No carousel anymore
- ~~Recent Results / Activity feed~~ → Dropped. The league rows already show your record (the summary of all past results), and per-league results are accessible in the League tab. A cross-league activity feed would mostly repeat information already visible in the other sections.

---

**League Selection Architecture:**
Home is now cross-league, but the other tabs (Portfolio, Draft, Matchup, League) are still league-scoped. This means we need a league selection mechanism in those tabs:

1. **Tapping a league row on Home** sets a global "active league" in app state and navigates to the relevant tab. This is the primary way users select a league.

2. **Each league-scoped tab** has a dropdown selector in its header (the current emoji + name + chevron pattern). This lets users switch leagues without going back to Home.

3. **State management:** Store the active league ID in a global context/store (React Context, Zustand, or similar). When it changes, all league-scoped tabs re-render with the new league's data.

```
// League selector component (used in Portfolio, Draft, Matchup, League tab headers):
//
//   ┌─────────────────────────┐
//   │  🤑 Test          ▼    │
//   └─────────────────────────┘
//
// - Displayed as a pill/chip in the tab header, centered
// - Emoji + league name in h3 / textPrimary + chevron-down in textTertiary
// - Tapping opens a bottom sheet or dropdown with all leagues listed
// - Selecting a league updates the global active league context
// - Background: bgSurface, borderRadius: 20, padding: 6px 14px
```

This dual-path approach (Home tap + dropdown in tabs) means users are never trapped — they can always switch context from wherever they are.

---

---

> ### 🎨 VISUAL RESKINS — Screens below keep existing functionality, new look

### Screen 3: Draft (Results)

**Current state:** Dark bg, trophy emoji, stats in ALL CAPS, cyan-bordered team picks card, round badges.

**Changes:**

- **Screen background:** white
- **League selector:** Add the `<LeagueSelector>` dropdown at the top (centered pill). Switches which league's draft results are shown.
- **Trophy:** Replace emoji with a styled icon in a soft circle (56px, `warningMuted` bg, amber icon). Centered.
- "Draft Complete!" in `h1` / `textPrimary`. Subtitle "Your team is locked in for Season 1" in `body` / `textSecondary`.
- **Stats row:** White card with border. Three stats with vertical dividers: "4 Teams · 16 Picks · 4 Rounds" — numbers in `h2`, labels in `micro`. No ALL CAPS.
- **Your Team:**
  - "Your Team" as section label in `caption` / `textSecondary`, total "$111.67" right-aligned in `mono` / `textSecondary`
  - Picks in a white grouped card with `border`:
    - Each row: small round-number circle (24px, `bgElevated`, `textTertiary`) → ticker in `h3` → company name in `caption` → price right-aligned in `mono`
    - Rows separated by `borderLight` dividers
    - **No cyan border, no cyan pill badges**
- **Round tabs:** Horizontal pills. Active = `bgElevated` bg with `textPrimary` text. Inactive = transparent with `textTertiary`. Not cyan.

---

### Screen 4: Portfolio

**Current state:** Dark bg, three stat boxes, P/L card, two equal buttons, holdings with inline Buy/Sell on every row.

This screen gets the most dramatic transformation because it benefits the most from the light theme. A portfolio screen with a big black number on white is *immediately* Robinhood.

**Changes:**

**League selector:** Add the `<LeagueSelector>` dropdown at the top of the screen (centered pill: emoji + name + chevron). This is how the user switches which league's portfolio they're viewing. Reads from the global active league context.

**Hero area:**
- Remove the three stat boxes entirely. Replace with:
  - "$284.22" in `display` (34px, `textPrimary`). Just the number, sitting on white. Massive visual impact.
  - "+$172.55 (+154.52%)" directly beneath — dollar change in `positive`, percentage in a `positiveMuted` chip
  - "4 stocks · Budget: —" in `caption` / `textTertiary` beneath that
  - 32px of breathing room before the next element

- **Portfolio chart:** Same `<PerformanceChart>` component as Home (Section 2b), but scoped to the **active league only** — not aggregated. Shows this league's portfolio value over time. Same visual treatment: auto-scaled Y-axis, smooth curve interpolation, full-width bleed, no axes, ~120px height. Same time selectors: `1W · 1M · Season · All`. Same P/L update behavior: the portfolio value stays fixed as the current value, but the P/L line updates to reflect the selected time window. Same line color logic (cyan if up for the period, red if down). Reuse the same chart component — only the data source differs (one league vs. all leagues).

**Action buttons:**
- "Buy Stock" = primary CTA (solid cyan, white text, full width). ONE button.
- "View trade history →" = ghost text link in `caption` / `cyan` beneath it. NOT a full button.

**Holdings list (priority #4 change):**
- "Holdings" section label in `caption` / `textSecondary`
- Each holding is a **simple row on white**, not a card:
  - Left: ticker icon (38px rounded square, `bgElevated`, first letter of ticker in `textSecondary`) → Ticker in `h3` / `textPrimary` → Company name in `caption` / `textTertiary`
  - Right: Price in `mono` / `textPrimary` → P/L percentage below in `positive` or `negative` color (text only, or small chip)
  - **NO Buy/Sell buttons.** Tapping the row opens a bottom sheet or detail screen with actions. This is how Robinhood, Coinbase, and Public all handle it.
- Rows separated by `borderLight` dividers
- On white, these clean rows will look incredibly professional

**Allocation Section (moved here from Home):**
The allocation chart previously lived on the Home screen. It belongs here on Portfolio where the user is actively looking at their holdings in detail.

- "Allocation" section label in `caption` / `textSecondary`, placed below the holdings list with 32px spacing above
- Horizontal stacked bar chart: thin (6px height), rounded segments, with a coordinated color palette for each stock. Each segment separated by a 2px gap for clarity.
- Below the bar: a compact legend — each stock with a colored dot + ticker + percentage, laid out in a flex-wrap row
- On white, the bar colors will pop naturally without needing a card container
- This is the same donut chart data currently on Home, just presented as a horizontal bar and relocated to the right screen

---

### Screen 5: Matchup

**Current state:** Dark bg, bordered week selector, emoji empty state on black void.

**Changes:**

- **Screen background:** white
- **League selector:** Add the `<LeagueSelector>` dropdown at the top of the screen (centered pill). This lets the user switch which league's matchup they're viewing.
- **Week selector:** Below the league selector. No container card. Just: ‹ arrow + "Week 8" in `h2` + "Current" chip (`cyanLight` bg, `cyan` text) + "of 6" in `textTertiary` + › arrow. Clean row.

**Empty state:**
- Icon: Calendar or versus icon in a 56px circle (`bgElevated` bg, `textTertiary` icon)
- "No Matchup This Week" in `h2` / `textPrimary`
- "You don't have a matchup scheduled for Week 8." in `body` / `textSecondary`, centered
- "View league schedule →" in `caption` / `cyan`
- On white, the empty state will feel intentionally sparse rather than broken (which was the problem on dark)

**Active matchup state (when one exists):**
- Sleeper-style versus layout, adapted for light theme:
  - Two columns: You (left) vs. Opponent (right)
  - Each side: Avatar, username, portfolio value, P/L
  - "VS" divider in center (use `textTertiary` or a small icon)
  - Below: side-by-side holdings comparison
  - Winner's side gets a faint `positiveMuted` background tint, loser gets faint `negativeMuted`

---

### Screen 6: League

**Current state:** Dark bg, emoji stat boxes, cyan-bordered standings rows, glowing green border on "your" row.

**Changes:**

- **Screen background:** white
- **League header:** Use the `<LeagueSelector>` dropdown component (pill-shaped: emoji + name + chevron-down, centered). Tapping opens a bottom sheet or dropdown with all the user's leagues. "Season 1 · Week 8" below in `caption` / `textSecondary`. This selector writes to the global active league context, so switching here also updates Portfolio, Matchup, and Draft.

**Stats row:**
- White card with `border`. Three stats with vertical dividers.
- "Bot 1" (Leader) · "8" (Week) · "4" (Players) — values in `h3`, labels in `micro` / `textTertiary`
- **No emojis** (trophy, calendar, people). Typography does the work.

**Standings (translate Sleeper's pattern to light theme):**
- "Standings" section label in `caption` / `textSecondary`
- Each row: white card with `border`, 8px gap between rows, 14px border-radius
  - **Rank badge:** 26px circle. 1st = `warningMuted` bg + `warning` text (gold). 2nd = `bgElevated` + `#64748B` (silver). 3rd = `bgElevated` + `#B45309` (bronze). 4th+ = `bgElevated` + `textTertiary`.
  - Avatar (36px) → Username in `h3` → "(You)" in `textTertiary`
  - Record in `mono` → Win rate in `caption` / `textTertiary` beneath
  - Total gain right-aligned, color-coded
  - **Your row:** `cyanLight` (#ECFEFF) background tint + 3px left border in `cyan`. Subtle but clear. NOT a thick neon border.
- Tapping a row navigates to that player's portfolio

**Recent Results (moved here from Home):**
Recent Results previously lived on the Home screen but was removed since Home is now a cross-league overview. The League tab is the natural home for per-league results — it's where you're already looking at league-specific data.

- "Recent Results" section label in `caption` / `textSecondary`, "See all" in `caption` / `cyan` on right
- Compact rows in a white grouped card with `border`:
  - Left: color-coded dot (6px, positive/negative/warning) + "Week 7" in `body` / `textPrimary`
  - Inline: "LOSS" in `caption` / color-coded (positive/negative/warning)
  - Right: P/L dollar amount in `mono`, color-coded
  - Row height: ~44px, separated by `borderLight` dividers
- Show the 5 most recent weeks
- This uses the `<ResultRow>` component

---

### Screen 7: Profile

**Current state:** Dark bg, cyan avatar circle, ALL CAPS "ACCOUNT INFORMATION", bordered card with raw UUID.

**Changes:**

- **Screen background:** white
- **Avatar:** Keep circular avatar, but use `bgElevated` (#F1F5F9) as the circle background, or white with `border`. Remove the cyan circle. Let the avatar image speak for itself.
- Username in `h1` / `textPrimary` directly beneath. Email in `caption` / `textTertiary`.

**Stats row:** White card with `border`. "2 Leagues · 2 Active · 0 Pending" with vertical dividers. Active in `positive` color.

**Account section:**
- "Account" as section label in `caption` / `textSecondary`
- iOS Settings-style grouped list: white card with `border`, rows separated by `borderLight` dividers
  - Label left (`textSecondary`), value right (`textPrimary`)
  - Remove User ID row (or truncate + copy button behind "Advanced")
  - Keep: Email, Member since, Last sign in

**Settings section:**
- Same grouped list style: Notifications, Help & Support, Privacy Policy
- Chevron (`textTertiary`) on each row indicating tappability

**Sign Out:** Centered text, `negative` color, below settings section. Clear and deliberate.

**Version:** "v1.2.0" in `micro` / `textTertiary`, centered at bottom.

---

## Component Library Checklist

Create or refactor these shared components to enforce consistency:

1. **`<Card variant="base|grouped|elevated">`** — base = white card with shadow/border, grouped = bordered list container, elevated = tinted bg for nested elements
2. **`<StatRow stats={[{value, label, color?}]}>`** — 3-column stat display with vertical dividers
3. **`<Button variant="primary|secondary|positive|negative|ghost">`** — enforces button hierarchy
4. **`<StockRow ticker={} name={} price={} change={} />`** — clean row for holdings, draft picks, matchup comparisons
5. **`<StandingsRow rank={} user={} record={} gain={} isCurrentUser={} />`** — standings entry
6. **`<Badge value={} variant="positive|negative|warning|neutral" />`** — P/L chips, rank badges
7. **`<EmptyState icon={} title={} description={} cta={} />`** — consistent empty states
8. **`<WeekSelector week={} total={} current={} />`** — week navigation
9. **`<SectionLabel title={} />`** — lightweight section labels ("Holdings", "Standings", "Your Leagues")
10. **`<Avatar source={} size="sm|md|lg" />`** — consistent avatar rendering
11. **`<LeagueRow emoji={} name={} season={} rank={} record={} pnl={} />`** — compact league row for Home screen
12. **`<MatchupCard league={} week={} user={} opponent={} />`** — two-column matchup preview card for Home screen
13. **`<LeagueSelector activeLeague={} leagues={} onChange={} />`** — dropdown pill for league-scoped tab headers
14. **`<PerformanceChart data={} period={} onPeriodChange={} color={} />`** — reusable time-series line chart. Used on Home (aggregate) AND Portfolio (per-league). Critical: Y-axis auto-scales to data range (never from zero), line uses smooth curve interpolation, and period changes update P/L values above the chart while the total value stays fixed. See Home Section 2b for full spec.
15. **`<ResultRow week={} result="win|loss|tie" pnl={} vsPnl={} />`** — compact Recent Results row (used within league-scoped views)

---

## Implementation Priority

Execute in this order:

### Phase 1: Foundation
1. Set up `theme/colors.ts` with the light palette above
2. Set up `theme/typography.ts` with Inter + the type scale
3. Set up `theme/spacing.ts`
4. Install Inter font via `@expo-google-fonts/inter`
5. Update `StatusBar` to `dark-content` across the app
6. Create `Card`, `Button`, `Badge` base components
7. Update Tab Bar to light theme (white bg, border-top, cyan active)
8. **Search the codebase for all hardcoded dark colors** (#0a, #0b, #0f, #11, #1a, etc.) and replace with theme tokens. This is critical — missed hardcoded dark colors will create visual bugs.

### Phase 2: Architecture (new — do before screen redesigns)
9. **Create the global active league context/store.** This is the foundation for the new Home architecture. Use React Context, Zustand, or similar. Store the active league ID. All league-scoped tabs read from this.
10. **Create the `<LeagueSelector>` dropdown component.** This pill-shaped dropdown goes in the header of Portfolio, Draft, Matchup, and League tabs. It reads from and writes to the active league context.
11. **Create the aggregate data queries.** Home now needs: total portfolio value across leagues, all active matchups, and historical portfolio value time-series for the performance chart. Build these Supabase queries or derive them client-side from existing data. The time-series data is the most involved — it requires daily snapshots of aggregate portfolio value. If this data isn't currently being stored, add a daily cron/edge function that records each user's total portfolio value.

### Phase 3: High-Impact Screens
12. Redesign **Home** as the personal cross-league overview (this is the biggest change — league rows, matchup cards, activity feed, aggregate portfolio value)
13. Redesign **Portfolio** (hero number + chart + clean stock rows + allocation chart moved from Home)
14. Redesign **League** (light standings rows + rank badges + league selector in header)

### Phase 4: Remaining Screens
15. Redesign **Login** (light or branded dark — pick one approach)
16. Redesign **Draft** results (+ add league selector in header)
17. Redesign **Matchup** (empty state + active state + league selector in header)
18. Redesign **Profile** (iOS Settings-style lists)

### Phase 5: Polish
19. Build the `<PerformanceChart>` component and integrate on both Home (aggregate) and Portfolio (per-league). This is one reusable component — build it once, pass different data.
20. Add micro-animations
21. Audit every screen for missed dark-theme remnants
22. Test on both iOS and Android — light themes can expose rendering differences (especially shadows, which work differently on Android via `elevation`)
23. Test Home screen with 1 league, 2 leagues, and 5+ leagues to ensure the layout scales

---

## What NOT to Change

- **Navigation structure:** Keep the 6-tab layout with Expo Router. The tabs themselves don't change — but Home's content is fundamentally reimagined as a cross-league overview, and Portfolio/Draft/Matchup/League tabs gain a league selector dropdown in their headers.
- **Functionality:** Every feature continues to work. We are reskinning and reorganizing, not removing features.
- **Backend/data layer:** Minimize changes to Supabase queries and data models. The aggregate data for Home (total portfolio value, cross-league activity) should ideally be derived client-side from existing per-league data. Only add new queries if client-side aggregation is impractical.
- **App name and logo:** "Stockpile" and bar-chart logo stay. Adjust logo colors for light bg (cyan icon, dark text). Use the light-theme PNG logo variants.

---

## Migration Checklist: Dark → Light

This is a non-trivial migration. Here are the most common gotchas:

1. **Find all hardcoded dark colors.** Search for: `#0a`, `#0b`, `#0f`, `#10`, `#11`, `#1a`, `#1e`, `#00e5ff`, `#00d4ff`, `rgba(0`, `rgba(255, 255, 255`. Replace all with theme tokens.
2. **StatusBar.** Must switch from `light-content` to `dark-content`.
3. **Splash screen.** If the current splash is dark, update it to match the new light theme.
4. **System navigation bar (Android).** Set to light mode.
5. **Keyboard appearance.** On iOS, switch from `keyboardAppearance="dark"` to `keyboardAppearance="light"` on TextInputs.
6. **ScrollView/FlatList backgrounds.** These often have hardcoded dark backgrounds that create flashes of dark when scrolling.
7. **Modal/bottom sheet overlays.** Update backdrop colors.
8. **expo-linear-gradient usage.** Find all gradient definitions and update or remove them. The heavy teal gradients must go.
9. **Alert/ActionSheet styling.** These may inherit system or hardcoded dark colors.
10. **SafeAreaView backgrounds.** Update to white.

---

## Quick Reference: Current Problems → Solutions

| Problem | Where | Solution |
|---------|-------|----------|
| Dark theme feels like a side project | Global | Switch to light theme — white bg, rich black text, professional feel |
| Cyan borders on everything | Global | Remove all cyan borders; use Slate-200 borders or shadows |
| Everything is the same visual weight | Global | Strict typography hierarchy; rich black vs medium gray vs light gray |
| ALL CAPS section headers | League, Profile, Home | Title Case with `h2` semibold |
| Emoji as icons | Draft, Matchup, League | Styled vector icons in soft circles |
| Inline Buy/Sell on every holding | Portfolio | Remove; tap row → bottom sheet with actions |
| Glowing cyan border on "your" row | League standings | `cyanLight` bg tint + 3px left cyan border |
| No breathing room / too dense | Global | 32px section spacing, 20px screen padding, generous gaps |
| No data visualization | Portfolio, Home | Portfolio performance line chart on white |
| Heavy teal gradient cards | Home, Portfolio | Flat white cards or no card at all (number on white) |
| Neon cyan (#00E5FF) too loud | Global | Darken to #0891B2 (Cyan-600) for light theme |
| Generic empty states | Matchup | Styled icon circle + title + description + CTA |
| Stats in separate bordered boxes | Home, League, Draft, Profile | Single card with vertical dividers |
| Raw UUID on profile | Profile | Hide or truncate with copy button |
| Too many buttons competing | Portfolio, Home card | 1 primary CTA + ghost links for everything else |
| League card has too much in it | Home | Replaced with compact league rows in a grouped list |
| No competitive urgency on Home | Home | "This Week" matchup cards showing all active matchups across leagues |
| Allocation chart clutters Home | Home → Portfolio | Moved allocation to Portfolio tab |
| Recent Results rows too tall | Home | Dropped from Home entirely; per-league results live in the League tab. Record visible in league rows. |
| Home duplicates other tabs | Home | Reimagined as personal cross-league overview — unique role in the app |
| No league selector in other tabs | Portfolio, Matchup, League, Draft | Added dropdown pill selector in each tab header |
| No aggregate portfolio view | Home | Total portfolio value across all leagues as the hero number |
| Can't see all leagues at once | Home | Compact league list with per-league rank, record, and P/L |
