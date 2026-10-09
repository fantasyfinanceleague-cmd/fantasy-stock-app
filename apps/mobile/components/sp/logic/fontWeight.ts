// Stockpile — font weight → Archivo face (sp Text). Each normal-width Archivo weight is
// loaded as its own font (app/_layout.tsx: Archivo-Regular … Archivo-ExtraBold), and on
// iOS `fontWeight` is ignored once `fontFamily` names a single-weight face: a caller's
// `fontWeight: '700'` on a callout (Archivo-Medium) rendered Medium. Found in the S-10
// capture (2026-10-08: "your name bold" wasn't). The sp Text resolves a requested weight
// to the matching face instead. Pure, for tests-deno.

const NORMAL_WIDTH: Record<string, number> = {
  'Archivo-Regular': 400,
  'Archivo-Medium': 500,
  'Archivo-SemiBold': 600,
  'Archivo-Bold': 700,
  'Archivo-ExtraBold': 800,
};

function faceFor(weight: number): string {
  if (weight >= 800) return 'Archivo-ExtraBold';
  if (weight >= 700) return 'Archivo-Bold';
  if (weight >= 600) return 'Archivo-SemiBold';
  if (weight >= 500) return 'Archivo-Medium';
  return 'Archivo-Regular';
}

function weightOf(w: unknown): number | null {
  if (w === 'bold') return 700;
  if (w === 'normal') return 400;
  const n = typeof w === 'number' ? w : typeof w === 'string' ? Number(w) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The face for `family` at the requested `fontWeight`. Only normal-width Archivo faces
 * are remapped (the condensed score and expanded tag faces have one weight each); with no
 * weight, or another family, the family is returned unchanged. */
export function resolveFontFamily(family: string, fontWeight: unknown): string {
  if (!(family in NORMAL_WIDTH)) return family;
  const w = weightOf(fontWeight);
  return w === null ? family : faceFor(w);
}
