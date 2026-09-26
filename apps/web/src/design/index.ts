// Design-system barrel (Phase 2 foundation, ui/foundation-web). Import from
// here, not from individual token/CSS files — this is the ONE place that
// pulls in tokens.css and the Archivo font, so importing anything from
// `src/design` is what "opts in" to the design system. main.jsx / App.jsx /
// the landing page import neither this file nor its CSS, so none of it
// reaches the production landing bundle (verified in
// design/build-isolation.test.ts and the before/after dist diff in the
// worker's DONE report).
import '../styles/tokens.css';
import './fonts.css';

import { brand as brandBase } from '../brand';
import { BrandMark } from './BrandMark';

export * from './tokens';
export { BrandMark } from './BrandMark';
export type { BrandMarkProps } from './BrandMark';

export { useMotion } from './useMotion';
export type { UseMotionResult } from './useMotion';

export { Surface, useSurfaceKind } from './Surface';
export type { SurfaceProps, SurfaceKind, SurfaceLevel } from './Surface';

export { Text } from './Text';
export type { TextProps, TextVariant, TextTone } from './Text';

export { Money } from './Money';
export type { MoneyProps } from './Money';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Chip } from './Chip';
export type { ChipProps, ChipTone } from './Chip';

export { PhaseChip, PHASE_LABEL } from './PhaseChip';
export type { PhaseChipProps, Phase } from './PhaseChip';

export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedControlOption } from './SegmentedControl';

export { Sheet } from './Sheet';
export type { SheetProps } from './Sheet';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { formatMoney, roundToCents } from './lib/money';
export type { MoneyOptions } from './lib/money';
export { digitDiff } from './lib/digitDiff';
export { tugRatio } from './lib/tugRatio';

/** `brand.mark` per DESIGN_DIRECTION.md §9 — the swappable name/wordmark
 * (src/brand.ts) combined with the name-agnostic mark component. */
export const brand = { ...brandBase, mark: BrandMark };
