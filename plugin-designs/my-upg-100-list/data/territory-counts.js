// territory-counts.js — slice 09b "shift-select → copy" tool · §1(b)
//
// name→UUPG-count resolver for EVERY clickable tapestry territory.
//
// WHY a separate helper (not just admin-counts.json):
//   A clicked tapestry feature carries DIFFERENT identity props depending on its
//   resolution level (see data/zone-geometry.js stamp()):
//     • ADM1 (the 34 India states + 12 China provinces) carry  props.shapeName
//       (e.g. "Uttar Pradesh", "Yunnan Province"). Their UUPG count is the
//       per-admin number in data/admin-counts.json (IND/CHN).
//     • ADM0 (the regional/frontier COUNTRIES like Nepal) carry ONLY props.iso3
//       (e.g. "NPL") — the world-adm0.geojson features have NO shapeName. Their
//       UUPG count is the # of records with that country_code, derived from
//       data/admin-membership.json (NPL 34, PAK 24, AFG 21, BTN 13, …).
//   So a single name→count map keyed by shapeName is NOT enough; an ADM0 click
//   gives an iso3, not a name. resolveTerritory() below handles BOTH shapes and
//   returns a stable { key, name, count, kind } the HUD + clipboard build from.
//
// Counts are BAKED at build-source time from admin-counts.json + admin-membership
// .json (the authoritative on-disk data — this tool NEVER edits the partition).
// The ISO3→display-name table is a FALLBACK; at runtime the profile passes the
// live records' country_code_label (the exact label the legend shows, e.g.
// "Malaysia") so the clipboard name matches what the operator sees. Pure data +
// pure functions; no Mapbox / DOM — unit-testable in plain Node.

// ── (1) ADM1 territory counts (India states + China provinces) ───────────────
// Verbatim from data/admin-counts.json (IND 34 + CHN 12 = 46), keyed by the
// EXACT shapeName the gb-IND-ADM1 / gb-CHN-ADM1 features carry.
export const ADM1_COUNTS = {
  // IND (34)
  'Andaman and Nicobar Islands': 9,
  'Andhra Pradesh': 81,
  'Arunāchal Pradesh': 7,
  'Assam': 15,
  'Bihār': 18,
  'Chandīgarh': 1,
  'Chhattīsgarh': 24,
  'Delhi': 1,
  'Dādra and Nagar Haveli and Damān and Diu': 1,
  'Goa': 5,
  'Gujarāt': 90,
  'Haryāna': 4,
  'Himāchal Pradesh': 20,
  'Jammu and Kashmīr': 33,
  'Jhārkhand': 9,
  'Karnātaka': 81,
  'Kerala': 72,
  'Ladākh': 6,
  'Lakshadweep': 1,
  'Madhya Pradesh': 33,
  'Mahārāshtra': 54,
  'Manipur': 5,
  'Meghālaya': 2,
  'Odisha': 64,
  'Puducherry': 5,
  'Punjab': 4,
  'Rājasthān': 48,
  'Sikkim': 1,
  'Tamil Nādu': 64,
  'Telangāna': 26,
  'Tripura': 11,
  'Uttar Pradesh': 23,
  'Uttarākhand': 7,
  'West Bengal': 30,
  // CHN (12)
  'Gansu Province': 3,
  'Guangxi Zhuang Autonomous Region': 6,
  'Guizhou Province': 34,
  'Hainan Province': 3,
  'Heilongjiang Province': 2,
  'Hunan Province': 5,
  'Inner Mongolia Autonomous Region': 3,
  'Qinghai Province': 3,
  'Sichuan Province': 12,
  'Tibet Autonomous Region': 13,
  'Xinjiang Uyghur Autonomous Region': 7,
  'Yunnan Province': 61,
};

// ── (2) ADM0 per-country counts (iso3 → # records in admin-membership.json) ──
// Covers ALL 161 ADM0 countries rendered in world-adm0.geojson; every one has a
// non-zero count (verified). The clicked ADM0 feature gives iso3 → this gives
// its running-total contribution.
export const COUNTRY_COUNTS = {
  ABW: 1, AFG: 21, AGO: 10, ALB: 1, AND: 1, ARE: 2, ARM: 1, ASM: 1, ATG: 1,
  AZE: 3, BEN: 9, BFA: 8, BGD: 3, BGR: 1, BHR: 2, BHS: 1, BIH: 1, BLM: 1,
  BLR: 1, BMU: 1, BOL: 1, BRA: 103, BRB: 1, BRN: 5, BTN: 13, CAF: 1, CHN: 154,
  CIV: 2, CMR: 8, COD: 9, COG: 2, COK: 1, COL: 27, COM: 3, CUB: 1, CUW: 1,
  CYM: 1, CYP: 1, CZE: 1, DJI: 1, DMA: 1, DZA: 17, ECU: 1, EGY: 3, ERI: 8,
  ESP: 1, ETH: 29, FIN: 1, FJI: 1, FRO: 1, FSM: 1, GAB: 2, GEO: 1, GGY: 1,
  GHA: 1, GIN: 13, GLP: 1, GMB: 3, GNB: 3, GNQ: 1, GRC: 1, GRD: 1, GUF: 2,
  GUM: 1, GUY: 1, IDN: 36, IRN: 20, IRQ: 8, ISL: 1, ISR: 4, JAM: 1, JOR: 3,
  JPN: 6, KAZ: 1, KEN: 5, KGZ: 2, KHM: 1, KIR: 1, KWT: 1, LAO: 95, LBN: 4,
  LBR: 2, LBY: 15, LCA: 1, LIE: 1, LKA: 1, LUX: 1, MAR: 4, MDV: 1, MHL: 1,
  MLI: 13, MLT: 1, MMR: 7, MNE: 1, MNG: 1, MNP: 1, MOZ: 4, MRT: 3, MSR: 1,
  MUS: 1, MWI: 1, MYS: 12, MYT: 1, NAM: 6, NCL: 1, NER: 2, NGA: 38, NIU: 1,
  NPL: 34, NZL: 1, OMN: 7, PAK: 24, PAN: 1, PER: 10, PHL: 1, PLW: 1, PNG: 1,
  PRK: 1, PRY: 1, PSE: 4, PYF: 1, QAT: 3, RUS: 21, SAU: 3, SDN: 105, SEN: 1,
  SHN: 1, SLB: 1, SLE: 2, SMR: 1, SOM: 9, SSD: 22, STP: 1, SUR: 2, SWE: 2,
  SWZ: 1, SYR: 5, TCA: 1, TCD: 53, TGO: 6, THA: 8, TJK: 3, TON: 1, TUN: 2,
  TUR: 3, TZA: 16, UGA: 6, USA: 3, UZB: 1, VCT: 1, VEN: 6, VGB: 1, VIR: 1,
  VNM: 16, VUT: 1, WLF: 1, WSM: 1, YEM: 9, ZAF: 2, ZMB: 6, ZWE: 3,
};

// ── (3) ISO3 → display-name FALLBACK ─────────────────────────────────────────
// Used only when the profile does NOT pass a live country_code_label for an
// iso3 (it normally does — see buildCountryNameMap below). Short common names.
export const ISO3_NAME = {
  ABW: 'Aruba', IND: 'India', AFG: 'Afghanistan', AGO: 'Angola', ALB: 'Albania',
  AND: 'Andorra', ARE: 'United Arab Emirates', ARM: 'Armenia',
  ASM: 'American Samoa', ATG: 'Antigua and Barbuda', AZE: 'Azerbaijan',
  BEN: 'Benin', BFA: 'Burkina Faso', BGD: 'Bangladesh', BGR: 'Bulgaria',
  BHR: 'Bahrain', BHS: 'Bahamas', BIH: 'Bosnia and Herzegovina',
  BLM: 'Saint Barthélemy', BLR: 'Belarus', BMU: 'Bermuda', BOL: 'Bolivia',
  BRA: 'Brazil', BRB: 'Barbados', BRN: 'Brunei', BTN: 'Bhutan',
  CAF: 'Central African Republic', CHN: 'China', CIV: "Côte d'Ivoire",
  CMR: 'Cameroon', COD: 'DR Congo', COG: 'Congo', COK: 'Cook Islands',
  COL: 'Colombia', COM: 'Comoros', CUB: 'Cuba', CUW: 'Curaçao',
  CYM: 'Cayman Islands', CYP: 'Cyprus', CZE: 'Czechia', DJI: 'Djibouti',
  DMA: 'Dominica', DZA: 'Algeria', ECU: 'Ecuador', EGY: 'Egypt',
  ERI: 'Eritrea', ESP: 'Spain', ETH: 'Ethiopia', FIN: 'Finland', FJI: 'Fiji',
  FRO: 'Faroe Islands', FSM: 'Micronesia', GAB: 'Gabon', GEO: 'Georgia',
  GGY: 'Guernsey', GHA: 'Ghana', GIN: 'Guinea', GLP: 'Guadeloupe',
  GMB: 'Gambia', GNB: 'Guinea-Bissau', GNQ: 'Equatorial Guinea', GRC: 'Greece',
  GRD: 'Grenada', GUF: 'French Guiana', GUM: 'Guam', GUY: 'Guyana',
  IDN: 'Indonesia', IRN: 'Iran', IRQ: 'Iraq', ISL: 'Iceland', ISR: 'Israel',
  JAM: 'Jamaica', JOR: 'Jordan', JPN: 'Japan', KAZ: 'Kazakhstan', KEN: 'Kenya',
  KGZ: 'Kyrgyzstan', KHM: 'Cambodia', KIR: 'Kiribati', KWT: 'Kuwait',
  LAO: 'Laos', LBN: 'Lebanon', LBR: 'Liberia', LBY: 'Libya', LCA: 'Saint Lucia',
  LIE: 'Liechtenstein', LKA: 'Sri Lanka', LUX: 'Luxembourg', MAR: 'Morocco',
  MDV: 'Maldives', MHL: 'Marshall Islands', MLI: 'Mali', MLT: 'Malta',
  MMR: 'Myanmar', MNE: 'Montenegro', MNG: 'Mongolia',
  MNP: 'Northern Mariana Islands', MOZ: 'Mozambique', MRT: 'Mauritania',
  MSR: 'Montserrat', MUS: 'Mauritius', MWI: 'Malawi', MYS: 'Malaysia',
  MYT: 'Mayotte', NAM: 'Namibia', NCL: 'New Caledonia', NER: 'Niger',
  NGA: 'Nigeria', NIU: 'Niue', NPL: 'Nepal', NZL: 'New Zealand', OMN: 'Oman',
  PAK: 'Pakistan', PAN: 'Panama', PER: 'Peru', PHL: 'Philippines',
  PLW: 'Palau', PNG: 'Papua New Guinea', PRK: 'North Korea', PRY: 'Paraguay',
  PSE: 'Palestine', PYF: 'French Polynesia', QAT: 'Qatar', RUS: 'Russia',
  SAU: 'Saudi Arabia', SDN: 'Sudan', SEN: 'Senegal', SHN: 'Saint Helena',
  SLB: 'Solomon Islands', SLE: 'Sierra Leone', SMR: 'San Marino',
  SOM: 'Somalia', SSD: 'South Sudan', STP: 'São Tomé and Príncipe',
  SUR: 'Suriname', SWE: 'Sweden', SWZ: 'Eswatini', SYR: 'Syria',
  TCA: 'Turks and Caicos Islands', TCD: 'Chad', TGO: 'Togo', THA: 'Thailand',
  TJK: 'Tajikistan', TON: 'Tonga', TUN: 'Tunisia', TUR: 'Turkey',
  TZA: 'Tanzania', UGA: 'Uganda', USA: 'United States', UZB: 'Uzbekistan',
  VCT: 'Saint Vincent and the Grenadines', VEN: 'Venezuela',
  VGB: 'British Virgin Islands', VIR: 'U.S. Virgin Islands', VNM: 'Vietnam',
  VUT: 'Vanuatu', WLF: 'Wallis and Futuna', WSM: 'Samoa', YEM: 'Yemen',
  ZAF: 'South Africa', ZMB: 'Zambia', ZWE: 'Zimbabwe',
};

/**
 * buildCountryNameMap(records) -> { iso3: label }
 * Derive iso3→display-name from the LIVE records (country_code + the decoded
 * country_code_label that normalize.js stamps). This is the label the legend +
 * detail panel show, so the clipboard name matches exactly what the operator sees.
 * Falls back to ISO3_NAME for any iso3 the records don't cover.
 */
export function buildCountryNameMap(records) {
  const out = { ...ISO3_NAME };
  for (const r of records || []) {
    const iso = r && r.country_code;
    const label = r && r.country_code_label;
    if (iso && label) out[iso] = label;
  }
  return out;
}

/**
 * resolveTerritory(props, opts) -> { key, name, count, kind } | null
 *
 * Given a clicked tapestry feature's `properties`, return a stable identity for
 * batch-selection. Resolution order mirrors zone-geometry.js stamp():
 *   1. ADM1: props.shapeName present → name = shapeName, count = ADM1_COUNTS.
 *   2. ADM0: props.iso3 present      → name = nameMap[iso3] (live label, else
 *      ISO3_NAME fallback, else the raw iso3), count = COUNTRY_COUNTS[iso3].
 *
 * `key` is the de-dup / toggle identity ('adm1:<shapeName>' or 'adm0:<iso3>') so
 * a country and a same-named admin never collide, and re-clicking toggles cleanly.
 * Returns null if the feature carries neither shapeName nor iso3 (not a clickable
 * territory). `count` is null when no entry exists — the caller warns + treats 0.
 *
 * @param {object} props  clicked feature.properties
 * @param {object} [opts] { nameMap }  iso3→label from buildCountryNameMap(records)
 */
export function resolveTerritory(props, opts = {}) {
  if (!props || typeof props !== 'object') return null;
  const nameMap = opts.nameMap || ISO3_NAME;

  // (1) ADM1 — India state / China province
  if (props.shapeName) {
    const name = String(props.shapeName);
    const count = Object.prototype.hasOwnProperty.call(ADM1_COUNTS, name)
      ? ADM1_COUNTS[name] : null;
    return { key: 'adm1:' + name, name, count, kind: 'adm1' };
  }

  // (2) ADM0 — country (only iso3 on the feature)
  if (props.iso3) {
    const iso = String(props.iso3);
    const name = nameMap[iso] || ISO3_NAME[iso] || iso;
    const count = Object.prototype.hasOwnProperty.call(COUNTRY_COUNTS, iso)
      ? COUNTRY_COUNTS[iso] : null;
    return { key: 'adm0:' + iso, name, count, kind: 'adm0' };
  }

  return null;
}

/**
 * formatClipboard(selection, opts) -> string
 * selection = ordered array of { name, count } (insertion order = selection order).
 * Produces the D-1 paste-ready payload:
 *   line 1: "Name1, Name2, … — {total} UUPG"            (no color picked)
 *   line 1: "Name1, Name2, … — {total} UUPG · #16a34a"  (R1.1 (h): color picked —
 *            the exact trailing token toolB parses to regroup+recolor in one go)
 *   line 2: "Name1 c1, Name2 c2, …"   (per-territory breakdown, D-1 2nd line)
 * A null count is treated as 0 in the total and shown as 0 in the breakdown.
 * opts.color must be a '#rrggbb' string (the profile validates before passing).
 */
export function formatClipboard(selection, opts = {}) {
  const sel = Array.isArray(selection) ? selection : [];
  const names = sel.map((s) => s.name);
  const total = sel.reduce((a, s) => a + (Number(s.count) || 0), 0);
  const color = opts && typeof opts.color === 'string' && opts.color ? opts.color : '';
  const line1 = names.join(', ') + ' — ' + total + ' UUPG' + (color ? ' · ' + color : '');
  const line2 = sel.map((s) => s.name + ' ' + (Number(s.count) || 0)).join(', ');
  return line1 + '\n' + line2;
}

export default { ADM1_COUNTS, COUNTRY_COUNTS, ISO3_NAME, resolveTerritory, formatClipboard, buildCountryNameMap };
