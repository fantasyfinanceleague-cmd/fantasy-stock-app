import { brand } from '../../brand';
import { color } from '../../design/tokens';

// Archivo (Game Day type, DESIGN_DIRECTION §9) for the landing ONLY. The
// foundation's design/fonts.css pulls the same family with a CSS @import,
// which blocks rendering of whatever stylesheet bundles it; the landing
// skips that file and loads the font asynchronously instead (Orchestrator
// decision C, phase 3a). Metric-tuned local fallbacks in landing.css keep
// the swap from shifting layout.
/** Production origin (Vercel). Social scrapers need an absolute og:image
 * URL; update this with the domain if it changes. */
export const SITE_ORIGIN = 'https://fantasy-stock-app.vercel.app';

/** The self-hosted display face (wdth 62 / wght 900 Latin subset, see
 * public/fonts/archivo/README.md). landing.css declares it as
 * 'Archivo Display'; the prerendered HTML preloads it (`preload` below). */
export const DISPLAY_FONT_URL = '/fonts/archivo/archivo-condensed-black-latin.woff2';
export const DISPLAY_FONT_FAMILY = 'Archivo Display';

export const ARCHIVO_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap';

/** Head tags scripts/prerender-landing.mjs writes into dist/index.html
 * (paused builds only). Title and description derive from `brand.name`,
 * so the product name stays one swappable token. */
export const landingHead = {
  /** Goes first in <head>, so the display face is requested alongside the
   * page CSS rather than after it. */
  preload: `<link rel="preload" href="${DISPLAY_FONT_URL}" as="font" type="font/woff2" crossorigin />`,
  title: `${brand.name}: fantasy leagues for the stock market`,
  description: `${brand.name} is a fantasy league for the stock market. Draft real stocks, face one friend each week, and win on dollar gain at Friday's close. Launching soon.`,
  tags: [
    '<link rel="preconnect" href="https://fonts.googleapis.com" />',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
    // Non-blocking stylesheet: fetched at high priority, applied on load.
    `<link rel="stylesheet" href="${ARCHIVO_STYLESHEET}" media="print" onload="this.media='all'" />`,
    `<noscript><link rel="stylesheet" href="${ARCHIVO_STYLESHEET}" /></noscript>`,
    `<meta name="theme-color" content="${color.bg.app}" />`,
    // Social preview: a static of the sample matchup's final state
    // (public/og-image.png, source in scripts/og/). Name-free artwork.
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${brand.name}: your portfolio vs. your friends, every week" />`,
    '<meta property="og:description" content="Draft real stocks, face one friend each week, and win on dollar gain at Friday’s close. Launching soon." />',
    `<meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Your portfolio vs. your friends. Every week. A sample final: You +$71.25, Priya +$64.10." />',
    '<meta name="twitter:card" content="summary_large_image" />',
  ],
};

/** Resolves when the display face is ready, or after `timeoutMs` —
 * whichever comes first. The hero sequence waits on this so its count-up
 * never swaps faces mid-count, but never waits longer than the timeout
 * (Design Lead: wait about 600 milliseconds, then run the sequence anyway). */
export function displayFontReady(timeoutMs: number): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const loaded = document.fonts.load(`900 56px "${DISPLAY_FONT_FAMILY}"`).then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs));
  return Promise.race([loaded, timeout]);
}

/** Client-side fallback for when the page wasn't prerendered (vite dev, or
 * the unpaused app's Home route rendering the landing): add the same
 * async stylesheet once. */
export function ensureArchivoStylesheet(): void {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector(`link[href="${ARCHIVO_STYLESHEET}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = ARCHIVO_STYLESHEET;
  document.head.appendChild(link);
}
