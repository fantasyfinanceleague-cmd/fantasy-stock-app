/**
 * cleanCompanyName: turns a vendor/feed company name into the name a person
 * reads ("Apple Inc. - Common Stock" → "Apple"). Pure and tested
 * (tests-deno/money-format.test.ts). Strips, in order:
 *   1. a feed share-class tail after " - " ("- Class A", "- Common Stock", …)
 *   2. a bare trailing " Class X" ("Visa Inc. Class A" → "Visa Inc.")
 *   3. trailing legal suffixes (Inc, Corp, Corporation, Co, Ltd, plc, LLC,
 *      N.V., S.A.) and the joiners left behind ("JPMorgan Chase & Co." →
 *      "JPMorgan Chase"). "Group" and "Holdings" are part of a name, so they
 *      are kept.
 */
const SHARE_CLASS_TAIL = /\s+-\s+.*$/i;
const BARE_CLASS = /\s+class\s+[a-z]$/i;
const LEGAL_SUFFIX = /[\s,&]+(inc\.?|corp\.?|corporation|co\.?|company|ltd\.?|plc|llc|n\.v\.|s\.a\.)$/i;

export function cleanCompanyName(raw: string | null | undefined): string {
  if (!raw) return '';
  let name = raw.trim();
  name = name.replace(SHARE_CLASS_TAIL, '').trim();
  name = name.replace(BARE_CLASS, '').trim();
  // Loop: "Foo, Inc., Co." style stacks, and the joiner left by "& Co.".
  for (;;) {
    const next = name.replace(LEGAL_SUFFIX, '').replace(/[\s,&]+$/, '');
    if (next === name) break;
    name = next;
  }
  return name;
}
