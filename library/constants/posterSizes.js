/**
 * posterSizes.js — preset poster dimensions (US + ISO).
 *
 * Each preset gives:
 *   • inches      — natural unit for US sizes (and the unit jsPDF/svg2pdf accept)
 *   • mm          — natural unit for ISO sizes (also useful for print specs)
 *   • px300       — pre-computed pixel size at 300 DPI (for quick lookup)
 *   • category    — 'us' | 'iso'
 *   • orientation — natural orientation; the renderer can flip via PosterSpec
 *   • recommendedDpi — sane default DPI for the size
 *
 * Use `getPosterSize(id)` to fetch by id; iteration order follows POSTER_ORDER.
 *
 * @example
 *   const a3 = getPosterSize('a3');
 *   const spec = { widthIn: a3.inches.w, heightIn: a3.inches.h, dpi: 300, ... };
 */

const MM_PER_IN = 25.4;
const mmToIn = (mm) => mm / MM_PER_IN;
const inToMm = (i)  => i * MM_PER_IN;

function size(id, label, w, h, unit, category, orientation, recommendedDpi) {
  const inches = (unit === 'in')
    ? { w, h }
    : { w: round3(mmToIn(w)), h: round3(mmToIn(h)) };
  const mm = (unit === 'mm')
    ? { w, h }
    : { w: round1(inToMm(w)), h: round1(inToMm(h)) };
  const px300 = {
    w: Math.round(inches.w * 300),
    h: Math.round(inches.h * 300),
  };
  return { id, label, inches, mm, px300, category, orientation, recommendedDpi };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function round1(n) { return Math.round(n * 10)   / 10;   }

/**
 * @typedef {Object} PosterSize
 * @property {string} id
 * @property {string} label
 * @property {{ w: number, h: number }} inches
 * @property {{ w: number, h: number }} mm
 * @property {{ w: number, h: number }} px300
 * @property {'us'|'iso'} category
 * @property {'portrait'|'landscape'|'either'} orientation
 * @property {150|200|300} recommendedDpi
 */

/** @type {Record<string, PosterSize>} */
export const POSTER_SIZES = {
  // ─── US sizes ──────────────────────────────────────────────────────
  letter:  size('letter',  'Letter (8.5×11")',  8.5,  11,   'in', 'us', 'either',   300),
  tabloid: size('tabloid', 'Tabloid (11×17")',  11,   17,   'in', 'us', 'either',   300),
  '18x24': size('18x24',   '18 × 24"',          18,   24,   'in', 'us', 'portrait', 300),
  '24x36': size('24x36',   '24 × 36"',          24,   36,   'in', 'us', 'portrait', 300),
  '27x40': size('27x40',   '27 × 40"',          27,   40,   'in', 'us', 'portrait', 200),

  // ─── ISO sizes ─────────────────────────────────────────────────────
  a4: size('a4', 'A4 (210 × 297 mm)',          210,  297,  'mm', 'iso', 'either',   300),
  a3: size('a3', 'A3 (297 × 420 mm)',          297,  420,  'mm', 'iso', 'either',   300),
  a2: size('a2', 'A2 (420 × 594 mm)',          420,  594,  'mm', 'iso', 'portrait', 300),
  a1: size('a1', 'A1 (594 × 841 mm)',          594,  841,  'mm', 'iso', 'portrait', 200),
  a0: size('a0', 'A0 (841 × 1189 mm)',         841,  1189, 'mm', 'iso', 'portrait', 150),
};

/** Display order for UI dropdowns. */
export const POSTER_ORDER = [
  'letter', 'tabloid', '18x24', '24x36', '27x40',
  'a4', 'a3', 'a2', 'a1', 'a0',
];

/** Default for research-map posters. */
export const DEFAULT_POSTER_ID = '24x36';

/**
 * @param {string} id
 * @returns {PosterSize|null}
 */
export function getPosterSize(id) {
  return POSTER_SIZES[id] || null;
}

/**
 * @returns {PosterSize[]}
 */
export function listPosterSizes() {
  return POSTER_ORDER.map((id) => POSTER_SIZES[id]);
}

/**
 * @param {'us'|'iso'} category
 */
export function listByCategory(category) {
  return listPosterSizes().filter((s) => s.category === category);
}
