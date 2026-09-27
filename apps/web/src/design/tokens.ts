// Stockpile design tokens — JS/TS mirror of ../styles/tokens.css.
// DESIGN_DIRECTION.md §9 (Game Day, approved). Names are identical dot paths
// on both platforms (see also apps/mobile/constants/tokens/*).
//
// Every leaf below is already a CSS-ready string (e.g. '56px', '#0D1B2E',
// 'cubic-bezier(...)') so the same value can be written straight into
// tokens.css and read straight into inline styles / motion configs without a
// unit-conversion step at either call site.
//
// motion.spring is JS-only (springs have no CSS representation) and is
// excluded from the CSS mirror — see `CSS_EXCLUDED_PREFIXES` below.
// `spring.lively` itself is NOT exported here at all: DESIGN_DIRECTION.md §4
// restricts it to game surfaces, so it lives in `./game/motion.ts`, the only
// module allowed to import it.

export const color = {
  bg: { app: '#F3F5F8' },
  surface: {
    money: { base: '#FFFFFF', sunken: '#EBEFF4' },
    game: { base: '#0D1B2E', raised: '#16263D', line: '#22334D' },
  },
  border: { default: '#DDE3EA', control: '#76828F' },
  text: {
    primary: '#0D1B2E',
    secondary: '#5B6678',
    disabled: '#A3ACBA',
    onGame: { primary: '#FFFFFF', secondary: '#8DA0BD' },
  },
  brand: '#2860F0',
  team: {
    you: { base: '#2860F0', onGame: '#6E9BFF' },
    // Fills/bars only — 2.9:1 on white fails as text; never used as text on
    // light. The same value works on both surfaces (6.1:1 on stadium), so
    // it has no separate `.onGame` leaf (unlike team.you / data.gain/loss).
    opponent: '#FF6A3D',
  },
  live: '#FFC53D',
  data: {
    gain: { base: '#12803F', onGame: '#4ADE8B' },
    loss: { base: '#C8303A', onGame: '#FF7A7A' },
    // Zero is never green: same values as text.secondary / text.onGame.secondary,
    // duplicated here (not a var() reference) so this file and tokens.css can
    // be diffed leaf by leaf without resolving CSS custom-property
    // indirection. DESIGN_DIRECTION §9 (amended fb0bc9d): the light-surface
    // grey reads ~3:1 on stadium navy — too low — so game gets its own leaf.
    zero: { base: '#5B6678', onGame: '#8DA0BD' },
  },
  status: { warning: '#B45309', danger: '#B42318' },
  action: {
    primary: {
      bg: '#0D1B2E',
      fg: '#FFFFFF',
      // DESIGN_DIRECTION §9 (amended fb0bc9d, "Raised by ui/foundation-web
      // [finding] the primary button invisible on stadium navy"): navy on
      // navy is invisible, so the primary INVERTS on a game surface — a
      // white "broadcast chip" (17:1), not a bordered navy-on-navy button.
      onGame: { bg: '#FFFFFF', fg: '#0D1B2E' },
    },
    secondary: {
      // DESIGN_DIRECTION §9 (amended 1c131fe): named explicitly for parity
      // with .onGame, even though the values already matched what
      // Button.css rendered directly (surface.money.base / border.control /
      // text.primary) before this token existed.
      bg: '#FFFFFF',
      border: '#76828F',
      fg: '#0D1B2E',
      onGame: { border: '#8DA0BD', fg: '#FFFFFF' },
    },
    ghost: {
      // Same note as secondary.bg above — matches text.primary, named for
      // parity with .onGame.
      fg: '#0D1B2E',
      onGame: { fg: '#FFFFFF' },
    },
  },
};

export const type = {
  family:
    "'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  // Landing headline only (DESIGN_DIRECTION §9 amendment cf3e9c7): the
  // score family's condensed black, fluid between 56px and 112px. Web-only
  // leaf — `clamp()` has no React Native equivalent.
  hero: {
    size: 'clamp(56px, 7.6vw, 112px)',
    line: '0.92',
    weight: '900',
    stretch: '62%',
    tracking: '-0.01em',
  },
  score: {
    xl: { size: '56px', line: '52px', weight: '900', stretch: '62%' },
    lg: { size: '40px', line: '38px', weight: '900', stretch: '62%' },
    md: { size: '28px', line: '28px', weight: '900', stretch: '62%' },
  },
  // The only uppercase in the app — game surfaces only (DESIGN_DIRECTION §9).
  tag: {
    size: '11px',
    line: '14px',
    weight: '800',
    stretch: '125%',
    tracking: '0.04em',
    transform: 'uppercase',
  },
  display: { size: '32px', line: '36px', weight: '800', stretch: '100%', tracking: '-0.5px' },
  title: { size: '22px', line: '28px', weight: '700', stretch: '100%' },
  headline: { size: '17px', line: '22px', weight: '600', stretch: '100%' },
  body: { size: '15px', line: '22px', weight: '400', stretch: '100%' },
  callout: { size: '13px', line: '18px', weight: '500', stretch: '100%' },
  caption: { size: '12px', line: '16px', weight: '500', stretch: '100%' },
};

export const space = {
  1: '2px',
  2: '4px',
  3: '8px',
  4: '12px',
  5: '16px',
  6: '20px',
  7: '24px',
  8: '32px',
  9: '40px',
  10: '48px',
  11: '64px',
};

export const radius = { sm: '6px', md: '10px', lg: '14px', xl: '20px', pill: '999px' };

export const elevation = {
  money: { card: '0 2px 8px rgba(13, 27, 46, 0.04)' },
  // Game surfaces are flat, with no shadow (DESIGN_DIRECTION §9).
  game: 'none',
  sheet: '0 8px 24px rgba(13, 27, 46, 0.12)',
};

export const motion = {
  duration: { instant: '90ms', quick: '160ms', base: '240ms', slow: '380ms', feature: '700ms' },
  ease: {
    settle: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  // spring.lively is intentionally NOT here — see the file header and
  // ./game/motion.ts. spring.snappy has no overshoot, so it's safe anywhere.
  spring: {
    snappy: { damping: 26, stiffness: 320, mass: 1 },
  },
};

export const tokens = { color, type, space, radius, elevation, motion };

/** Dot-path prefixes with no CSS custom-property mirror (JS-only values). */
export const CSS_EXCLUDED_PREFIXES = ['motion.spring'];

function kebabSegment(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** `['color','text','onGame','primary']` -> `--sp-color-text-on-game-primary` */
export function cssVarName(path: string[]): string {
  return `--sp-${path.map(kebabSegment).join('-')}`;
}

export interface TokenLeaf {
  path: string[];
  value: string;
}

/**
 * Flattens the token tree into `{ path, value }` leaves, skipping any
 * subtree whose dotted path starts with an entry in `CSS_EXCLUDED_PREFIXES`
 * (currently just `motion.spring`, which has no CSS representation). Used by
 * design/tokens.parity.test.ts to prove tokens.css carries every one of
 * these under the matching `--sp-*` name and value — the audit's core
 * finding was tokens existing and being bypassed, so this is the mechanism
 * that keeps the two sources from silently drifting.
 */
export function flattenTokens(
  obj: Record<string, unknown>,
  prefix: string[] = []
): TokenLeaf[] {
  const leaves: TokenLeaf[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];
    if (CSS_EXCLUDED_PREFIXES.includes(path.join('.'))) continue;
    if (typeof value === 'string') {
      leaves.push({ path, value });
    } else if (value && typeof value === 'object') {
      leaves.push(...flattenTokens(value as Record<string, unknown>, path));
    }
  }
  return leaves;
}
