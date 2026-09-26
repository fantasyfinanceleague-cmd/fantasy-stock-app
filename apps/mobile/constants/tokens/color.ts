// Stockpile — "Game Day" colour tokens (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9. Names and values here
// are copied verbatim from that spec — do not hand-tune a value here without
// updating the spec first, and keep the same dot-path names as the web
// tokens (apps/web/src/styles/tokens.css uses the kebab-case mirror).
//
// Two tokens in §9 read as both a leaf value AND the parent of an `.onGame`
// variant (`color.team.you`, `color.data.gain`, `color.data.loss`), which a
// TS object can't express. Resolved with the Design Lead (2026-09-26):
// nest under `.base` / `.onGame`, mirroring `surface.money.base`. Web mirrors
// this as `--sp-color-data-gain-base` / `--sp-color-data-gain-on-game`.
// `color.team.opponent` has no `.onGame` variant in the spec (fills/bars
// only, on either surface) so it stays a plain leaf.
//
// Rule (§9, non-negotiable): team colours mark PEOPLE, data colours mark
// MONEY — they never swap roles. `color.team.opponent` fails contrast as
// text on white (2.9:1) and must only be used for fills/bars, never text.

export const color = {
  bg: {
    app: '#F3F5F8',
  },
  surface: {
    money: {
      base: '#FFFFFF',
      sunken: '#EBEFF4',
    },
    game: {
      base: '#0D1B2E',
      raised: '#16263D',
      line: '#22334D',
    },
  },
  border: {
    default: '#DDE3EA',
    control: '#76828F',
  },
  text: {
    primary: '#0D1B2E',
    secondary: '#5B6678',
    disabled: '#A3ACBA',
    onGame: {
      primary: '#FFFFFF',
      secondary: '#8DA0BD',
    },
  },
  brand: '#2860F0',
  team: {
    you: {
      base: '#2860F0',
      onGame: '#6E9BFF',
    },
    // Fills/bars only — fails contrast (2.9:1) as text on white.
    opponent: '#FF6A3D',
  },
  // Live indicator, game surfaces only (11:1 on stadium).
  live: '#FFC53D',
  data: {
    gain: {
      base: '#12803F',
      onGame: '#4ADE8B',
    },
    loss: {
      base: '#C8303A',
      onGame: '#FF7A7A',
    },
    // Zero is never green/red — it's neutral, same as secondary text.
    zero: '#5B6678',
  },
  status: {
    warning: '#B45309',
    danger: '#B42318',
  },
  action: {
    primary: {
      // Stadium navy — neutral, deliberately not a team colour.
      bg: '#0D1B2E',
      fg: '#FFFFFF',
    },
  },
} as const;

export type Color = typeof color;
