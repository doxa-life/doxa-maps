// packet.mjs — the UPG-100 PRAYER PACKET generator.
//
// One printable packet per zone. Structure is the Driver's, from the ideation
// (_qa-cycle/01-ideation-research/prayer-points.md):
//
//   page 1      the MAP — a lightweight vertical one-pager, NOT the poster format
//   pages 2..n  the PEOPLE GROUPS — 20 per page, photo + name + brief detail
//   page n+1    the 12 PRAYER POINTS
//   page n+2    the PRAYER WHEEL — the rhythm these twelve points follow
//
// Printed front-and-back: Laos (95 groups) is 8 pages = 4 sheets.
//
// ── WHY A SEPARATE SCRIPT, not a FORMAT inside generate.mjs ──────────────────
// generate.mjs is a 2,600-line POSTER renderer. The packet is a different artefact
// with different pages; forking it would duplicate the design. Instead this reads
// the SAME zone resolution (clusters.json + the selector evaluator) so a packet can
// never disagree with its poster about which groups belong to a zone.
//
// ── EVERY STRING IS IN packet-strings.json ──────────────────────────────────
// Driver: "it all needs to be generative so that I can generate it in multiple
// languages." So no human-readable text is written in this file. LANG=xx picks a
// block; missing keys fall back to English individually, so a partial translation
// renders what it has rather than blanking the page.
//
// ── PHOTOS ──────────────────────────────────────────────────────────────────
// MEASURED: 1,072 of 2,107 groups have one (51%); they average ~244KB on Joshua
// Project's CDN, ~0.8s each. Fetched in parallel at packet time and inlined as
// data URIs so the finished HTML is ONE self-contained file that prints anywhere.
// Groups without a photo get a typographic card, never a broken image box.
//
// Usage:
//   node packet.mjs                      # every zone, English
//   ONLY=laos node packet.mjs            # one zone
//   LANG=es ONLY=laos node packet.mjs    # one zone, Spanish
//   NOPHOTOS=1 ONLY=laos node packet.mjs # skip the fetch (fast layout iteration)
//
// Output: out/packets/<zoneKey>[.<lang>].html

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../../..');

// ── THE SERIES ──────────────────────────────────────────────────────────────
// ★ WHY THIS EXISTS. The country posters shipped rendering the UPG-100 packet: its kicker, its
// "1 of {n} UPG-100 lists" line, its narrowing funnel. Not a mislabel — there was NO series
// parameter anywhere, so "the packet" and "the UPG-100 packet" were the same thing and nothing
// could disagree. Reported by the Driver, 2026-09-28.
// UNKNOWN OR ABSENT RESOLVES TO upg100, deliberately: every existing run must render byte-identical
// output with no env var set, or this refactor is a rewrite wearing a parameter's clothes.
const SERIES_ALL = JSON.parse(readFileSync(join(__dirname, 'series.json'), 'utf8'));
const SERIES_ID = process.env.SERIES || 'upg100';
if (!SERIES_ALL[SERIES_ID] || SERIES_ID.startsWith('_')) {
  const known = Object.keys(SERIES_ALL).filter((k) => !k.startsWith('_')).join(', ');
  console.error(`SERIES="${SERIES_ID}" is not in series.json. Known: ${known}`);
  process.exit(1);
}
const SERIES = SERIES_ALL[SERIES_ID];
// The data folder is a SERIES property, not a constant. It was hard-wired to my-upg-100-list,
// which is the other half of why a country run could only ever be a UPG-100 run.
const DATA = join(REPO, SERIES.dataDir);
const OUT = join(__dirname, 'out', 'packets');
mkdirSync(OUT, { recursive: true });

// ⚠ NOT process.env.LANG — that is the SHELL's POSIX locale ("en_US.UTF-8"), which
// is not a valid BCP-47 tag and throws in localeCompare/toLocaleString. Measured:
// it crashed the first run. PACKET_LANG is the only source.
const LANG = process.env.PACKET_LANG || 'en';
const ONLY = process.env.ONLY || '';
const NOPHOTOS = process.env.NOPHOTOS === '1';
const API = process.env.VITE_API_BASE_URL || process.env.MAP_APP_API_URL;
// FAIL CLOSED without an API — EXCEPT when records come from a committed fixture, which
// is the one case where no API is needed at all. Measured 2026-09-24: this guard runs
// BEFORE loadRecords() ever looks at PACKET_RECORDS, so `bun run packet:ci` exited 1 on a
// tree that had everything it needed. It only passed in hand-testing because I had been
// supplying a dummy host — the real invocation path is what exposed it.
// ⚠ AND THE SAME BUG HAD A SECOND ESCAPE HATCH, fixed 2026-09-27. The note above records this guard
// being taught about PACKET_RECORDS; OFFLINE was never added to it. loadRecords() reads
// `if (process.env.OFFLINE && existsSync(cache)) return ...` — a path that needs no API either — but
// this check ran first and exited 1, so OFFLINE=1 was documented at the top of this file and could
// never once have worked. That is worse than an undocumented feature: it sends a reader down a route
// the program refuses. Any env var that makes the API unnecessary must be named HERE, next to the
// guard, or it is decoration.
const CACHE_OK = process.env.OFFLINE && existsSync(join(__dirname, 'out', '_records.json'));
if (!API && !process.env.PACKET_RECORDS && !CACHE_OK) {
  console.error('[packet] No API base — set VITE_API_BASE_URL, or PACKET_RECORDS for a fixture build,');
  console.error('         or OFFLINE=1 to reuse out/_records.json if a previous run cached it.');
  if (process.env.OFFLINE) {
    console.error('         OFFLINE=1 was set but out/_records.json does not exist — nothing to reuse.');
  }
  console.error('         Failing closed.');
  process.exit(1);
}

// ── STRINGS: pick the language, fall back per-key to English ────────────────
const BASE_STRINGS = JSON.parse(readFileSync(join(__dirname, 'packet-strings.json'), 'utf8'));
// ★ SERIES OVERRIDES ARE APPLIED ONCE, HERE, OVER EVERY LOCALE BLOCK — not at each call site.
// The renderer gets `strings` as a whole and does its own per-key locale fallback, so an override
// applied only to this file's t() would render in the pages THIS file writes and not in the pages
// the RENDERER writes. One series, two different kickers, and nothing would fail.
// Overrides are ENGLISH-ONLY until the Driver signs the wording off (series.json
// _draft_awaiting_driver), so they are applied to every locale ON PURPOSE: an English country
// kicker is visibly awaiting translation, whereas inheriting the translated UPG-100 kicker would
// silently print the WRONG SERIES in fluent Russian. Loud beats wrong.
const SERIES_STRINGS = SERIES.strings || {};
const STRINGS = Object.fromEntries(
  Object.entries(BASE_STRINGS).map(([loc, block]) => [
    loc,
    loc.startsWith('_') || typeof block !== 'object' || block === null
      ? block
      : { ...block, ...SERIES_STRINGS },
  ]),
);
const EN = STRINGS.en;
const L = STRINGS[LANG] || {};
// Per-KEY fallback (not whole-block): a half-finished translation should render
// its finished keys, not fall back wholesale to English.
const t = (k) => (L[k] !== undefined ? L[k] : EN[k]);
const tr = (k) => ((L.rhythms || {})[k] !== undefined ? L.rhythms[k] : EN.rhythms[k]);
// NO `POINTS` HERE. The renderer owns point resolution (packet-render.js), and it must
// merge per-point/per-field — a partial `points` array is truncating, not falling back.
// A second copy of that logic in this file was DEAD (assigned, never read) and would have
// re-introduced the bug the moment someone wired it up.
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

// ── THE RENDERER IS SHARED ──────────────────────────────────────────────────
// The pages themselves live in library/packet/packet-render.js so that the browser
// (the UPG-100 legend's "Prayer packet" export) and this build-time script render
// the SAME packet from the SAME code. Changing a page here changes it in both.
const { createPacketRenderer } = await import(
  join(__dirname, '..', '..', 'packet', 'packet-render.js'));
// describeGroup generates the profile table's description column. It is imported directly (it is
// pure and has no imports of its own); its COUNTRY RESOLVER is not, and cannot be — see the
// `describe` seam below.
const { describeGroup } = await import(
  join(__dirname, '..', '..', 'packets', 'describeGroup.js'));
// The sets supplier for the FULL packet's bounded/centered back page. Pure decode+join; the
// TABLE is read from the served asset pool below, same as the browser fetches it, so the two
// paths chart the same rows.
const { buildPacketSets } = await import(
  join(__dirname, '..', '..', 'packet', 'packetSets.js'));
// SCRIPT FONT, inlined. Some languages need a face the system stack does not
// carry — Hindi renders as tofu boxes in Georgia/Palatino/serif. The packet is a
// standalone file meant to print offline, so the font is base64'd INTO it rather
// than linked, exactly as the photos are. Absent, the renderer omits the rule and
// falls back to serif rather than failing.
const SCRIPT_FONT_FILE = {
  hi: 'noto-serif-devanagari/noto-serif-devanagari-400-devanagari.woff2',
  mr: 'noto-serif-devanagari/noto-serif-devanagari-400-devanagari.woff2',
  ne: 'noto-serif-devanagari/noto-serif-devanagari-400-devanagari.woff2',
};
let fontData = null;
const fontRel = SCRIPT_FONT_FILE[LANG];
if (fontRel) {
  const fp = join(__dirname, '..', '..', '..', 'data', 'fonts', fontRel);   // fonts are sources in data/ (BUILD-OUTPUT-IS-ONE-FOLDER)
  if (existsSync(fp)) {
    fontData = readFileSync(fp).toString('base64');
  } else {
    // Loud, not silent: a missing font here means the packet prints as empty
    // rectangles, which looks like a content bug rather than a missing asset.
    console.warn(`[packet] ⚠ ${LANG} needs ${fontRel} and it is MISSING — `
      + 'the packet will render as tofu boxes. Vendor the font first.');
  }
}
// ★ THE DESCRIBER, INJECTED — and deliberately WITHOUT a country resolver, which is not an omission.
// library/utils/countryName.js cannot be imported here at all: it imports JSON without an import
// attribute, so `node` refuses it outright (measured — "needs an import attribute"). That is the very
// constraint that made this seam an injection rather than an import.
// It is not needed. describeGroup falls back from a resolver to `country_code_label`, and the cached
// records carry that on 2107 of 2107 — verified, not assumed — so the offline sentence localizes the
// country exactly as the browser's does. A record somehow lacking the label degrades to its alpha-3
// code, which is describeGroup's own documented ladder, not a new failure mode.
const describe = (g) => describeGroup(g, LANG, { strings: STRINGS });
const R = createPacketRenderer({ strings: STRINGS, lang: LANG, fontData, describe });
const { mapPage, listPages, pointsPage, wheelPage, css, mapCss, PER_PAGE, W, H } = R;

// ── DATA ────────────────────────────────────────────────────────────────────
const clusters = JSON.parse(readFileSync(join(DATA, 'clusters.json'), 'utf8'));

// ── THE CHRISTIAN-SHARE PAGE (packet page 3) ────────────────────────────────
// READ, NEVER COMPUTED HERE. data/people-groups/christian-share.json is generated from the IMB CSV
// joined to DOXA's snapshot on ROP3+country — the same join the Vision Card uses — and it carries its
// own _method and provenance. Re-deriving the percentage in this file would give one fact two sources
// that drift apart, which is the mistake the funnel page already documents for its four steps.
// A missing file yields null and buildPacket omits page 3 rather than printing a number it could not read.
let CHRISTIAN = null;
try {
  CHRISTIAN = JSON.parse(readFileSync(join(__dirname, '../../../data/people-groups/christian-share.json'), 'utf8'));
} catch (_) { /* page 3 is omitted, not faked */ }

// ── THE PAGE-2 FUNNEL ───────────────────────────────────────────────────────
// The same context the browser path builds in upg-100-list.vue's packetFunnel(), so the Node
// generator and the in-page print cannot disagree about page 2 any more than they can about the
// pages around it.
//
// ★ READ, NEVER COUNTED. The four steps come verbatim from vision-funnel.json, generated by
// build-vision-funnel.mjs from the IMB CSV and the live network list, and already driving the
// Vision Card. K IS measured here — from the catalogue that defines
// them, at build time, so no figure on the page is a typed constant.
// A missing file yields null, and buildPacket omits page 2 rather than printing numbers it could
// not read.
// ⚠ A FUNCTION, NOT A CONSTANT, because it depends on PACKET_LIST — which is resolved further down,
// after the records load. It mirrors upg-100-list.vue's packetFunnel() exactly: the DEFAULT list is the
// only one the zone catalogue describes, so it is the only one that may claim "1 of K lists" and an
// claim; a non-default list states its OWN total and goes quiet on the rest.
function buildFunnel(membership) {
  // ★ THE FUNNEL IS A UPG-100 ARGUMENT, so a series that is not that list does not get the page.
  // It narrows every people group on earth down to THIS list (Project 2000/7000/4700/700) and ends
  // "1 of {n} UPG-100 lists" — true of a UPG-100 zone, and simply not a description of a country.
  // Returning null here rather than filtering later reuses the path already built for a MISSING
  // vision-funnel.json: buildPacket omits the page. One way for the page to be absent, not two.
  if (!SERIES.funnel) return null;
  try {
    const raw = JSON.parse(readFileSync(join(DATA, '../../../data/people-groups/vision-funnel.json'), 'utf8'));
    if (!raw || !Array.isArray(raw.steps) || !raw.steps.length) return null;
    if (membership) {
      return { ...raw, listTotal: membership.total, listId: LIST, listLabel: membership.label };
    }
    // ⚠ NO `unassigned` — see upg-100-list.vue's packetFunnel() for the full measurement. Short
    // version: it printed "21 of the 2,107 are not yet in any list", derived from summing DECLARED
    // count fields, and neither that figure nor the 418 I got by resolving the selectors survives
    // scrutiny — the records cache lacks wagf_region/wagf_block, so 13 of the 27 selectors cannot
    // resolve, and clusters.json's two DEAF lists are a second, overlapping partition that
    // allLists() excludes. "In no list" has no single answer until someone says which partition is
    // meant. Both paths must agree, so this one stops claiming it too.
    // ⚠ COUNT THROUGH leafZones, NOT THE THREE CLUSTER KEYS. Spreading lists/asia_lists/
    // uncovered_lists gives 27 and silently omits `deaf`, whose two deaf_lists entries
    // buildLegendNodes collapses into ONE unified leaf — legend-tree.js:106 states the arithmetic
    // ("13 + 12 + 2 + 1 deaf = 28"). The packet's triangle tip prints this number as "1 of N", so a
    // 27 there is a visible wrong fact on the page. Same omission as allZones() had before 3ef164c0;
    // this was the last copy of it.
    const listCount = allZones().length;
    const listTotal = Number(raw.steps[raw.steps.length - 1].groups) || 0;
    return { ...raw, listCount, listTotal };
  } catch (_) { return null; }
}
const { evaluate } = await import(join(DATA, 'selector-evaluator.js'));
const { normalizeRecords, extractRecords } = await import(join(DATA, 'normalize.js'));
// The zone enumeration itself, so this generator, the poster generator and upg-100-list.vue cannot
// disagree about which zones exist (see allZones below).
const { buildLegendNodes, leafZones } = await import(join(DATA, 'legend-tree.js'));

async function loadRecords() {
  // ★ A COMMITTED FIXTURE, so CI can build a packet at all. out/ is gitignored — both the
  // records cache AND every generated packet — so on a clean checkout check:packets-all
  // finds nothing and SKIPs. MEASURED 2026-09-24: CI runs the sweep on EVERY build via
  // gates:post and it has SKIPped every single time, which means every packet assertion in
  // this tree (the 12 points, the wheel labels, page 1's geography, the print layer, the
  // build stamp) has never once been evaluated there. A SKIP that is always taken is
  // indistinguishable from an unwired gate, and the wave-membership census cannot see the
  // difference because membership measures INVOCATION, not EVALUATION.
  // PACKET_RECORDS points at a small committed subset instead of the live API or the
  // gitignored cache. It is deliberately NOT the default: real packets must use real data.
  const fixture = process.env.PACKET_RECORDS;
  if (fixture) {
    if (!existsSync(fixture)) throw new Error(`PACKET_RECORDS set but missing: ${fixture}`);
    return JSON.parse(readFileSync(fixture, 'utf8'));
  }
  const cache = join(__dirname, 'out', '_records.json');
  if (process.env.OFFLINE && existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  // ★ THE FIELD LIST IS PART OF THE SELECTOR CONTRACT — every field a selector READS must be asked
  // for here, or its zone silently resolves to nothing and gets skipped as "no groups resolved".
  //
  // ⚠ SIX OF TWENTY-EIGHT ZONES WERE UNREACHABLE FOR THIS ONE REASON, measured 2026-09-27 while
  // raising check:packets-all's coverage. This list named country_code and no other selector field,
  // while selector-evaluator reads three more:
  //     rop1          affinity_bloc  -> deaf                    (rop1Code, :51)
  //     wagf_block    wagf_block     -> west/east/central-africa (:102)
  //     wagf_region   wagf_region    -> europe, and the union    (:113, :136)
  // so those six zones evaluated to an EMPTY set for every record. The tell was unmistakable once
  // looked at: the records cache held 123 groups with "Deaf" in the name and evaluate() still returned
  // 0 slugs. It reads as missing DATA and is missing FIELDS.
  // ★ DERIVED, NOT TYPED: the presentation fields are listed, the selector fields come from the
  // evaluator's own requirements, so adding a selector type that reads a new field is a change in ONE
  // place. A hand-maintained superset drifts the moment someone adds a selector — which is exactly
  // what happened here.
  // ★ primary_language + imb_gsec FEED THE GENERATED PROFILE DESCRIPTION — the widest column of the
  // profile table. Without them describeGroup drops BOTH the language clause and the reachedness
  // sentence, so every offline row reads "The X live in Malaysia." and nothing more. MEASURED on the
  // cached records before adding them: 0 of 2107 carried either field, while country_code_label was
  // present on all 2107 — so the offline packet would have printed a one-clause description while
  // the BROWSER packet printed two full sentences from the same data. Same defect class as the
  // comment above: it reads as missing DATA and is missing FIELDS.
  const PRESENTATION_FIELDS = ['slug', 'name', 'country_code', 'population', 'religion',
    'image_url', 'has_photo', 'picture_credit', 'latitude', 'longitude',
    'primary_language', 'imb_gsec'];
  const SELECTOR_FIELDS = ['country_code', 'wagf_block', 'wagf_region', 'rop1'];
  const fields = [...new Set([...PRESENTATION_FIELDS, ...SELECTOR_FIELDS])].join(',');
  const r = await fetch(`${API}/api/people-groups/list?fields=${fields}&lang=${LANG}`,
    { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`PG API ${r.status}`);
  const recs = normalizeRecords(extractRecords(await r.json()));
  try { writeFileSync(cache, JSON.stringify(recs)); } catch { /* best effort */ }
  return recs;
}

// ★ ENUMERATE FROM THE LEGEND TREE, NOT FROM clusters.json'S KEYS — the same seam the POSTER
// generator and upg-100-list.vue use, so all three agree on what "a zone" is.
//
// THE DEFECT THIS FIXES, measured 2026-09-27 while making check:packets-all cover every zone:
// this function looped THREE cluster keys — lists (13) + asia_lists (12) + uncovered_lists (2) = 27
// — and clusters.json has a FOURTH that carries zones: deaf_lists (2). legend-tree.js:106 states the
// real arithmetic, "13 + 12 + 2 + 1 deaf = 28", because buildLegendNodes COLLAPSES the two deaf_lists
// into ONE unified leaf (affinity bloc A017, R1.1). So `deaf` is a poster zone and a legend row that
// no packet could ever be generated for: ONLY=deaf exited 1 with "no zone matches".
//
// ⚠ IT PRESENTED AS A COVERAGE GAP AND WAS A REACHABILITY BUG. check:packets-all printed
// "zones covered : 2 of 28", which reads as "26 nobody got round to" — but one of the 26 was
// unreachable by construction, and generating all of them would have silently produced 27, still
// printed against a denominator of 28. The numerator counted packet zones and the denominator counted
// POSTER files (out/posters/*.html), so the two sides were never the same population. A gap you can
// close by working harder and a gap you cannot close at all look identical in that line.
//
// leafZones() carries id/zoneKey/label/count but NOT selector (leaves do not), so the selector is
// re-attached by id exactly as generate.mjs:2801-2808 does it, deaf included.
function allZones() {
  // ★ COUNTRY MODE HAS ITS OWN ZONE SOURCE, and leaving it out broke the packet half of
  // SERIES=country for every country. Measured by exp-shepherd on main, 2026-09-28:
  // `SERIES=country ONLY=country-yem node generate.mjs` made a poster, and the matching
  // packet.mjs run died with "no zone matches ONLY=country-yem" — because zones came from
  // clusters.json (the UPG-100 zoning), where a country id never appears.
  // ⚠ MY OWN TEST MISSED IT BECAUSE IT WAS NOT END TO END. I only ever ran the country packet
  // against a UPG-100 zone id (ONLY=west-africa), which exercised the WORDING and never the zone
  // source. The same "one concept, two switches" defect I had just removed from generate.mjs
  // survived here, in the other file.
  // Built to MATCH generate.mjs's country branch exactly (same ids, labels and selector shape), so
  // a poster and its packet cannot describe different zones.
  if (SERIES.countryMode) {
    const cpath = [
      join(__dirname, '..', '..', 'data', 'country-posters.json'),
      join(REPO, 'plugin-designs', 'country-posters', 'data', 'countries.json'),
    ].find((p) => existsSync(p));
    if (!cpath) {
      console.error('[packet] COUNTRY MODE needs the country list, and neither location has it:');
      console.error('  library/data/country-posters.json   (written by: node emit-countries.mjs)');
      process.exit(1);
    }
    const cdata = JSON.parse(readFileSync(cpath, 'utf8'));
    const want = process.env.SHEET || '3x3';
    return (cdata.countries || [])
      .filter((c) => c.sheet === want)
      .map((c) => ({
        id: c.id,
        zoneKey: c.id,
        label: c.label,
        count: c.count,
        adm0: [c.iso3],
        // PLURAL type + `values`. The evaluator's SINGULAR form is
        // { type:'country_code', value:'SDN' }; passing `values` to the singular type matches
        // nothing and yields a silently empty packet. Same note as generate.mjs:2841.
        selector: { type: 'country_codes', values: [c.iso3] },
      }));
  }
  const tops = buildLegendNodes(clusters, { records: null });
  const byId = {};
  for (const k of ['lists', 'asia_lists', 'uncovered_lists']) {
    for (const z of clusters[k] || []) byId[z.id] = z.selector;
  }
  // The unified deaf leaf's selector. DUPLICATED from legend-tree.js:99's DEAF_SELECTOR, which is
  // function-scoped rather than exported, and from generate.mjs:2805 which hardcodes the same literal.
  // Kept as a literal here rather than exporting a third consumer's dependency mid-hold; if a fourth
  // caller ever needs it, export it once from legend-tree.js and delete all three copies.
  byId.deaf = { type: 'affinity_bloc', rop1: 'A017' };
  return leafZones(tops).map((z) => ({ ...z, zoneKey: z.zoneKey || z.id, selector: byId[z.id] }));
}

// ── PHOTOS: parallel fetch, inlined as data URIs ────────────────────────────
// Bounded concurrency: 16 was measured at 20 photos in 5.9s. Unbounded would open
// ~118 sockets against someone else's CDN, which is rude and slower in practice.
async function fetchPhotos(groups, limit = 16) {
  if (NOPHOTOS) return new Map();
  const out = new Map();
  // ★ PHOTOS_EVERY=N — keep only every Nth photo, so a MIXED packet can be rendered on purpose.
  // Every packet ever produced has been all-photo (laos: 95 photos, 0 typographic) or
  // all-typographic (every fixture: 0 photos, N typographic). The MIXED case — some groups with a
  // photo, some without — has NEVER been rendered, and it is the realistic one: this loop already
  // degrades per-photo on a failed fetch (the `continue` below), so any zone where a few images
  // 404 produces exactly that layout in front of a reader.
  // It is also an I18N SURFACE nobody has seen: the fallback card renders t('no_photo'), which is
  // translated in all 11 catalogs (sin fotografía disponible / 沒有照片 / لا توجد صورة متاحة).
  // Deterministic by INDEX rather than random, so the same command always yields the same packet —
  // a fixture that differs run to run cannot be a gate.
  const every = Number(process.env.PHOTOS_EVERY || 0);
  let i = 0;
  const worker = async () => {
    while (i < groups.length) {
      const idx = i
      const g = groups[i++];
      if (!g.image_url) continue;
      // Skip every photo whose index is not a multiple of N — see PHOTOS_EVERY above.
      if (every > 1 && idx % every !== 0) continue;
      try {
        const r = await fetch(g.image_url, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = r.headers.get('content-type') || 'image/jpeg';
        out.set(g.slug, `data:${mime};base64,${buf.toString('base64')}`);
      } catch { /* a missing photo degrades to the typographic card */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, groups.length) }, worker));
  return out;
}

// ── PAGE SHELL ──────────────────────────────────────────────────────────────
// Photo fetching is the only part that differs between the two callers (Node
// inlines base64 so the file is self-contained and printable offline; the browser
// hands the renderer plain URLs the page already has). Everything downstream is
// the shared renderer, so the two packets cannot drift.
// ★ THE NEAR-NEIGHBOURS TABLE, read once for every zone's sets page. From the SERVED asset pool
// (public/dx-maps/assets/tables/), not a plugin folder — the same copy the browser fetches, so the
// offline packet and a printed-from-the-app packet chart identical rows. A missing table yields
// null and buildPacketSets -> setsPage omit the page rather than failing the run: one way for the
// page to be absent, not two (the FUNNEL/CHRISTIAN pattern above, applied unchanged).
let NEAR_TABLE = null;
try {
  NEAR_TABLE = JSON.parse(readFileSync(
    join(__dirname, '..', '..', '..', 'public', 'dx-maps', 'assets', 'tables', 'near-neighbors.json'), 'utf8'));
} catch (e) {
  console.warn(`⚠ near-neighbors.json unreadable (${e?.message || e}) — every packet will omit the bounded/centered sets page.`);
}

async function buildPacket(zone, groups, mapSvg) {
  const photos = await fetchPhotos(groups);
  const sets = NEAR_TABLE ? buildPacketSets(groups, NEAR_TABLE) : null;
  const html = R.buildPacket(zone, groups, photos, mapSvg, FUNNEL, CHRISTIAN, 'full', sets);
  const withPhoto = groups.filter((g) => photos.has(g.slug)).length;
  // ★ COUNT THE SHEETS IN THE EMITTED HTML, do not re-derive them from a formula. The old line
  // computed `1 + ceil(n/PER_PAGE) + 2` while its own comment claimed the number was "asked of the
  // renderer, not recomputed here" — it WAS recomputed, and adding the funnel page silently made it
  // wrong by one, which is precisely the drift the comment warned about. Counting the artifact
  // cannot disagree with the artifact.
  const pageCount = (html.match(/class="sheet /g) || []).length;
  return { html, pageCount, withPhoto };
}

// ── MAIN ────────────────────────────────────────────────────────────────────
const allRecords = await loadRecords();

// ★ PACKET_LIST MAKES THE NON-DEFAULT-LIST PATH REACHABLE FROM THIS GENERATOR, and it needed to be.
// The BROWSER path honours the universal `list` prop — upg-100-list.vue calls applyPeopleGroupList()
// at every fetch site — but this generator had no list support at all, so the SIX-ROW funnel (a list's
// own total inserted before the reader's row) could not be rendered by the only pipeline rega can
// drive. Its only evidence was a harness I wrote about it, which is the state I have been objecting to
// elsewhere: a code path whose sole witness is its author's own test.
//
// ⚠ IT READS THE MEMBERSHIP FILE FROM DISK rather than through loadListMembership(), which fetches
// from the asset pool over HTTP — there is no server here. Same file, same `slugs`, same counts.doxa.
// ⚠ AND IT FAILS CLOSED. An unknown or unreadable list exits non-zero instead of quietly producing a
// packet of every group: peopleGroupList.js makes the same choice for the same reason ("a map that
// silently showed all 2,107 while an embed asked for Project 700 would be showing the wrong list with
// no sign of it"). A packet is worse — it is printed and handed to someone.
const LIST = process.env.PACKET_LIST || '';
let LIST_MEMBERSHIP = null;
if (LIST) {
  const mf = join(__dirname, `../../../data/people-groups/lists/${LIST}.json`);
  if (!existsSync(mf)) {
    console.error(`[packet] PACKET_LIST=${LIST}: no membership file at ${mf}`);
    console.error('         Run library/scripts/people-groups/build-lists.mjs, or use the default list.');
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  LIST_MEMBERSHIP = { slugs: new Set(m.slugs || []), total: Number(m?.counts?.doxa) || (m.slugs || []).length, label: m.label || LIST };
  if (!LIST_MEMBERSHIP.slugs.size) {
    console.error(`[packet] PACKET_LIST=${LIST}: membership file lists no slugs. Failing closed.`);
    process.exit(1);
  }
}
const records = LIST_MEMBERSHIP
  ? allRecords.filter((r) => LIST_MEMBERSHIP.slugs.has(r.slug))
  : allRecords;
if (LIST_MEMBERSHIP) {
  console.log(`[packet] list=${LIST} — ${records.length} of ${allRecords.length} record(s) `
    + `belong to it (list total ${LIST_MEMBERSHIP.total})`);
}
const FUNNEL = buildFunnel(LIST_MEMBERSHIP);
const bySlug = new Map(records.map((r) => [r.slug, r]));
const zones = allZones().filter((z) => !ONLY || z.id === ONLY);
if (!zones.length) { console.error(`[packet] no zone matches ONLY=${ONLY}`); process.exit(1); }

let made = 0;
const mapless = [];       // zones whose page 1 rendered without its map
for (const z of zones) {
  let slugs = [];
  try {
    // evaluate() returns a SET, not an array — spread it rather than assuming.
    slugs = z.selector?.type === 'pg_slugs'
      ? (z.selector.values || [])
      : (z.selector ? [...evaluate(z.selector, records)] : []);
  } catch (e) { console.warn(`[packet] selector failed for ${z.id}: ${e.message}`); continue; }
  const groups = slugs.map((s) => bySlug.get(s)).filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), LANG));
  if (!groups.length) { console.warn(`[packet] ${z.id}: no groups resolved — skipped`); continue; }

  // The map one-pager reuses the poster's SVG when it has been generated; without
  // it the packet still builds (cover page without the map) rather than failing.
  const posterPath = join(__dirname, 'out', 'posters', `${z.id}.html`);
  let mapSvg = '';
  let mapMiss = null;                       // why page 1 has no map, if it has none
  if (!existsSync(posterPath)) {
    mapMiss = 'no out/posters/' + z.id + '.html';
  }
  if (existsSync(posterPath)) {
    const poster = readFileSync(posterPath, 'utf8');
    const m = poster.match(/<svg[\s\S]*?<\/svg>/);
    // ⚠ The map SVG carries almost NO presentation attributes — generate.mjs styles
    // it entirely from the poster document's <style> block (.ctry, .lbl, .lead, the
    // :root palette...). Lifting the <svg> alone leaves those rules behind, and SVG
    // `fill` then falls back to its initial value, which is BLACK. Measured: 349
    // <text>, 203 <path class="ctry"> and 95 <circle> painted solid black, with no
    // error and no broken image — the map was a black rectangle.
    // So carry the poster's stylesheet across too, MINUS its document-level rules
    // (html/body/.stage/@media print) which would fight the packet's own shell.
    // Taking the stylesheet rather than duplicating hex codes means a palette or
    // map-style change in generate.mjs follows the packet automatically.
    // ★ THE POSTER'S OWN SERIES, READ OUT OF THE ARTWORK, AND IT MUST AGREE WITH OURS.
    // ⚠ THE BUG THIS EXISTS FOR IS SILENT AND I WALKED INTO IT. The three below-map blocks are
    // DRAWN INTO THIS SVG by generate.mjs, so they reach the packet through the IMAGE — no string
    // file mentions them and no grep of packet-strings.json can see them. Build a country packet
    // against a poster left over from a UPG-100 run and page 1 prints "Thirty disciples" with no
    // error, the right file size, and a generator reporting success. It looks exactly like the
    // SERIES parameter does not work.
    // Documentation cannot hold this: "regenerate the poster first" is a fact about the build
    // living in a human's head, and the same bet already failed for "regenerating the tree alone
    // ships a stale .js" — written down, and it still happened. So the build ASSERTS it.
    // The marker is the NETWORKS text itself, which is the one thing that survives every stage of
    // the pipeline into the artefact. Suggested by regions-plugin, 2026-09-28.
    const posterSeries = Object.entries(SERIES_ALL)
      .filter(([id]) => !id.startsWith('_'))
      .find(([, def]) => (def.networks || []).some(([head]) => m && m[0].includes(head)));
    if (m && posterSeries && posterSeries[0] !== SERIES_ID) {
      console.error(`\nSERIES MISMATCH — refusing to build a packet around the wrong poster.`);
      console.error(`  packet series : ${SERIES_ID}`);
      console.error(`  poster series : ${posterSeries[0]}  (out/posters/${z.id}.html)`);
      console.error(`  The poster's below-map text is drawn INTO its SVG, and this packet lifts that`);
      console.error(`  SVG whole, so the packet would print ${posterSeries[0]} wording on page 1.`);
      console.error(`  Regenerate the poster first:`);
      console.error(`    SERIES=${SERIES_ID} ONLY=${z.id} node generate.mjs`);
      process.exit(1);
    }
    if (m) mapSvg = `<style>${mapCss(poster)}</style>
      <div style="position:absolute;left:0;top:250px;width:${W}px;
      transform:scale(0.62);transform-origin:top center">${m[0]}</div>`;
    // The poster EXISTS but carries no <svg> — a truncated or failed generate run. Same
    // outcome as a missing file (page 1 is blank) and it was equally silent, so it is
    // reported the same way rather than left as the one unexplained branch.
    else mapMiss = `out/posters/${z.id}.html has no <svg>`;
  }

  const { html, pageCount, withPhoto } = await buildPacket(z, groups, mapSvg);
  // ⚠ THE LIST IS PART OF THE FILENAME, and leaving it out was a real hazard I created while arguing
  // against exactly this. PACKET_LIST fails closed because "a packet that showed the wrong list is
  // printed and handed to someone" — and then wrote the frontier packet over the default-list packet of
  // the same zone and language. rega measured it (2026-09-26): after a list run, out/packets/ held
  // frontier packets under the DEFAULT names beside an `ar` file that was still the default list, and
  // nothing in the filename could tell them apart. Guarding the input while leaving the output
  // ambiguous protects against asking for the wrong list, not against being unable to tell what you got.
  const listSuffix = LIST ? `.${LIST}` : '';
  const name = LANG === 'en' ? `${z.id}${listSuffix}.html` : `${z.id}${listSuffix}.${LANG}.html`;
  // ★ STAMP HOW THIS PACKET WAS BUILT, INTO THE PACKET. out/packets/ is gitignored, so the
  // sweep gate (check:packets-all) grades whatever .html files happen to be sitting there —
  // an ACCIDENTAL set, not a current one. MEASURED 2026-09-24: doxa-maps-plugin-studio, which
  // shares main with this worktree, had two packets from a NOPHOTOS=1 probe days old and the
  // sweep was RED there, on artifacts nobody intended to ship. A fast layout-iteration build
  // and a shippable one were byte-indistinguishable: the packet carried lang and dir and
  // nothing else about its own provenance.
  // The GENERATOR stamps this rather than the renderer, because packet-render.js is shared
  // with the browser export path and must not know about CLI flags.
  // ⚠ NOT A TIMESTAMP. An mtime rule would fail a correct tree — measured in this very
  // session, packet-strings.json was 303s newer than the packets while being byte-identical
  // to HEAD, because a probe restored it from backup. Record the INTENT, which is a fact
  // about the build, not the clock.
  // `fixture` is a build fact like the others: a fixture packet is built from a committed
  // records subset with image_url stripped, so it legitimately has no photos and its
  // records are not today's live data. Without this the gate reports "every source record
  // carries an image_url, so this is a skipped or failed photo fetch" — a true sentence
  // about real records and a false one about this packet.
  // `mixedphotos` is the same kind of fact: PHOTOS_EVERY=N deliberately keeps only every Nth
  // photo, so SOME cards are typographic on purpose. Without the stamp the gate cannot tell a
  // deliberately mixed packet from a partly-failed photo fetch — and those deserve opposite
  // verdicts.
  const provenance = [process.env.PACKET_RECORDS ? 'fixture' : null,
    NOPHOTOS ? 'nophotos' : null,
    Number(process.env.PHOTOS_EVERY || 0) > 1 ? 'mixedphotos' : null,
    mapMiss ? 'nomap' : null]
    .filter(Boolean).join(' ') || 'full';
  // ★ AND THE LIST IS STAMPED INTO THE DOCUMENT TOO, not only into the filename. A filename can be
  // renamed, copied or emailed; the packet itself should be able to say which list it holds. Same
  // reasoning as data-packet-build: out/packets/ is gitignored, so a gate grades whatever files happen
  // to be sitting there, and a packet that cannot describe its own provenance makes an accidental set
  // indistinguishable from a current one.
  const listAttr = LIST ? ` data-packet-list="${LIST}"` : '';
  const stamped = html.replace('<html ', `<html data-packet-build="${provenance}"${listAttr} `);
  writeFileSync(join(OUT, name), stamped);
  made++;
  if (mapMiss) mapless.push(z.id);
  // ⚠ DO NOT PRINT A BARE ✓ FOR A PACKET MISSING ITS FIRST PAGE. The map one-pager is the
  // first line of the packet spec, and the fallback above is deliberate — but it was also
  // SILENT: this printed "✓ laos  95 groups  8 pages" for a packet whose page 1 is empty,
  // with the page count still 8 because the blank sheet is still a sheet. Measured
  // 2026-09-24 in doxa-maps-plugin-studio, which has 0 generated posters: every packet
  // produced there was degraded this way and the only clue was the packet itself.
  // The empty-groups branch a few lines above already warns and skips; this branch has the
  // same shape and had no warning, which is the whole defect.
  console.log(`  ${mapMiss ? '⚠' : '✓'} ${z.id.padEnd(34)} ${String(groups.length).padStart(4)} groups  `
    + `${pageCount} pages  ${withPhoto} photos  ${(html.length / 1024 / 1024).toFixed(1)} MB`
    + (mapMiss ? `   NO MAP on page 1 (${mapMiss})` : ''));
}
console.log(`\n${made} packet(s) → ${OUT}${ONLY ? ` (ONLY=${ONLY})` : ''}${LANG !== 'en' ? ` [${LANG}]` : ''}`);
// Repeat it at the END too. A per-line ⚠ scrolls off in a 27-zone run; the summary is the
// part an operator actually reads, and this is the one fault that cannot be seen by
// counting pages.
if (mapless.length) {
  console.warn(`\n⚠ ${mapless.length} of ${made} packet(s) have NO MAP on page 1: ${mapless.join(', ')}`);
  console.warn('  The map one-pager is lifted from out/posters/<zone>.html, which `bun run posters`');
  console.warn('  generates. Without it the packet still builds — page 1 is simply blank.');
  console.warn('  Fix: bun run posters   (then re-run this script)');
}
