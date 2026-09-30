import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useSurfaceKind } from './Surface';
import { type as typeTokens } from './tokens';

// DESIGN_DIRECTION.md §2/§9: `variant` = every `type.*` token, one place
// that turns a token name into real CSS, so a screen worker reaches for
// <Text variant="…"> instead of a raw fontSize/fontFamily.

interface TypeToken {
  size: string;
  line: string;
  weight: string;
  stretch: string;
  tracking?: string;
  transform?: string;
}

const VARIANTS: Record<string, TypeToken> = {
  'score.xl': typeTokens.score.xl,
  'score.lg': typeTokens.score.lg,
  'score.md': typeTokens.score.md,
  tag: typeTokens.tag,
  display: typeTokens.display,
  title: typeTokens.title,
  headline: typeTokens.headline,
  body: typeTokens.body,
  callout: typeTokens.callout,
  caption: typeTokens.caption,
};

export type TextVariant = keyof typeof VARIANTS;
export type TextTone = 'primary' | 'secondary' | 'disabled';

const SCORE_VARIANTS = new Set<TextVariant>(['score.xl', 'score.lg', 'score.md']);

export interface TextProps {
  variant: TextVariant;
  /** Default 'primary'. Ignored (falls back to onGame.secondary — see
   * toneVar) for 'disabled' on a game surface: DESIGN_DIRECTION §9 has no
   * `text.onGame.disabled` leaf. */
  tone?: TextTone;
  /** Render element. Default 'span'; pass 'h1'/'p'/etc. for semantics. */
  as?: ElementType;
  /** Default: true for score.* variants (scores never wrap), else false. */
  nowrap?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function toneVar(tone: TextTone, onGame: boolean): string {
  if (onGame) {
    return tone === 'primary' ? 'var(--sp-color-text-on-game-primary)' : 'var(--sp-color-text-on-game-secondary)';
  }
  if (tone === 'primary') return 'var(--sp-color-text-primary)';
  if (tone === 'secondary') return 'var(--sp-color-text-secondary)';
  return 'var(--sp-color-text-disabled)';
}

export function Text({ variant, tone = 'primary', as, nowrap, className, style, children }: TextProps) {
  const surfaceKind = useSurfaceKind();
  const onGame = surfaceKind === 'game';
  const tokens = VARIANTS[variant];
  // Narrowed to the props we pass: an unparameterised ElementType also
  // spans every JSX intrinsic in the program — including three.js's, which
  // @react-three/fiber adds globally — and their intersection is `never`.
  const Component = (as ?? 'span') as ElementType<{ className?: string; style?: CSSProperties; children?: ReactNode }>;
  const shouldNowrap = nowrap ?? SCORE_VARIANTS.has(variant);

  const computedStyle: CSSProperties = {
    fontFamily: 'var(--sp-type-family)',
    fontSize: tokens.size,
    lineHeight: tokens.line,
    fontWeight: tokens.weight as CSSProperties['fontWeight'],
    fontStretch: tokens.stretch as CSSProperties['fontStretch'],
    color: toneVar(tone, onGame),
    margin: 0,
    ...(tokens.tracking ? { letterSpacing: tokens.tracking } : {}),
    ...(tokens.transform ? { textTransform: tokens.transform as CSSProperties['textTransform'] } : {}),
    ...(shouldNowrap ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
    ...style,
  };

  return (
    <Component
      className={['sp-text', `sp-text--${variant.replace('.', '-')}`, className].filter(Boolean).join(' ')}
      style={computedStyle}
    >
      {children}
    </Component>
  );
}

export default Text;
