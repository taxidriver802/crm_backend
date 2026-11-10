/**
 * A company's initials, for the tile shown when it has no logo and keeps the
 * default mark. Same rules as crm_frontend/src/lib/monogram.js; crm_qa's
 * brand check runs both over one table and fails when they disagree.
 *
 *   - Skip a leading "The" (when a word follows it).
 *   - Skip trailing legal suffixes: LLC, L.L.C., Inc, Incorporated, Co,
 *     Company, Corp, Ltd, PLC (when a word remains in front of them).
 *   - One word left: its first letter. Two or more: the first letters of
 *     the first two words.
 */

const LEGAL_SUFFIXES = new Set([
  'llc',
  'inc',
  'incorporated',
  'co',
  'company',
  'corp',
  'ltd',
  'plc',
]);

function bare(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function firstLetter(word: string) {
  const match = word.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase() : '';
}

export function companyMonogram(name: string | null | undefined): string {
  let words = String(name || '')
    .split(/[\s,]+/)
    .filter((word) => bare(word).length > 0);

  if (words.length > 1 && bare(words[0]) === 'the') {
    words = words.slice(1);
  }
  while (words.length > 1 && LEGAL_SUFFIXES.has(bare(words[words.length - 1]))) {
    words = words.slice(0, -1);
  }

  if (words.length === 0) return '';
  if (words.length === 1) return firstLetter(words[0]);
  return `${firstLetter(words[0])}${firstLetter(words[1])}`;
}
