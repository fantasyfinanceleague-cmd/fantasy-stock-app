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

/** `brand.mark` per DESIGN_DIRECTION.md §9 — the swappable name/wordmark
 * (src/brand.ts) combined with the name-agnostic mark component. */
export const brand = { ...brandBase, mark: BrandMark };
