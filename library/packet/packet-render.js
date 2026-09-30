// packet-render.js — THE prayer packet renderer, shared by both callers.
//
// ★ ONE RENDERER, TWO CALLERS. The packet is produced in two places:
//   - library/scripts/posters/packet.mjs   (build time, Node, writes files)
//   - the UPG-100 legend's Export > Prayer packet action (click time, browser)
// Both import THIS module, so a change to a page lands in both. The backlog card
// asked for exactly this: "reuse the existing print actions rather than growing a
// fourth implementation."
//
// It is pure: no fs, no process, no DOM. Everything it needs is passed in —
// strings, language, the zone, its groups, photos, and the map SVG. That is what
// lets the same code run under Node and in a browser tab.
//
// PAGE ORDER IS THE PRODUCT SPEC — change it only when the spec does, and update THIS comment in
// the same commit (it has gone stale twice; buildPacket's own comment is the authoritative copy):
//   1        the map one-pager
//   2        the inverted triangle (funnel)
//   3        the life calendar   4  the %-evangelical grid     (full detail only)
//   5..n     the people groups, 20 per page, with photos
//   then     the bounded/centered sets (full only), the prayer WHEEL, the 12 prayer POINTS
//
// I18N: every human-readable string comes from packet-strings.json. A new language
// is a NEW BLOCK there, never a code change, and fallback is PER KEY so a
// half-finished translation renders its finished keys instead of blanking.

// Right-to-left locales. Kept as data rather than a per-language flag in the
// catalog: script direction is a property of the LANGUAGE, not of a translation,
// so a new Arabic-script locale is one entry here and not a schema change.
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

// Scripts with no coverage in the packet's Georgia/Palatino/serif stack, mapped to
// the vendored face that does cover them. MEASURED by rendering each script at 48px
// and reading the PIXELS: Latin, Cyrillic, Arabic and CJK all shape correctly with
// system fonts; DEVANAGARI renders as tofu boxes.
// ⚠ A width heuristic got this exactly backwards — it reported Arabic and Chinese
// broken and Hindi fine, because Devanagari tofu boxes happen to match real glyph
// advance. Never infer glyph coverage from measurements; look at the pixels.
const SCRIPT_FONT = {
  hi: { family: 'Noto Serif Devanagari', dir: 'noto-serif-devanagari',
        file: 'noto-serif-devanagari-400-devanagari.woff2' },
  mr: { family: 'Noto Serif Devanagari', dir: 'noto-serif-devanagari',
        file: 'noto-serif-devanagari-400-devanagari.woff2' },   // Marathi, same script
  ne: { family: 'Noto Serif Devanagari', dir: 'noto-serif-devanagari',
        file: 'noto-serif-devanagari-400-devanagari.woff2' },   // Nepali, same script
};

import { scatterCells } from '../components/charts/packetCharts.js'
// The set LAYOUTS (gospel's figures, promoted to library/ by regions). Imported rather than injected
// because — unlike describeGroup's country resolver — these have ZERO imports of their own and run
// under plain node, so they cannot break `node internal/check-*.mjs`. Verified by importing and
// CALLING them, not by reading them. They return data; the SVG is ours.
import { layoutBoundedSet, boundedSetTally } from '../components/charts/boundedSet.js'
import { layoutCenteredSet, ringTally, RING_MAX } from '../components/charts/centeredSet.js'

// `describe` is INJECTED at the same seam as `strings`, and deliberately not imported. This module
// has (almost) no imports on purpose: the SAME file runs under Node for the offline generator and
// under Vite for the browser print frame. describeGroup itself is portable, but its country resolver
// (library/utils/countryName.js) is reachable only through the Vite `@map/` alias and imports JSON
// without an import attribute — fine inside a bundle, fatal to `node internal/check-*.mjs`. So the
// CALLER composes the describer and passes it in:
//     describe: (g) => describeGroup(g, lang, { strings, countryName })
// A missing `describe` degrades to the metadata line rather than throwing. The packet must not fail
// to print because one column has no describer.
export function createPacketRenderer({ strings, lang = 'en', fontData = null, describe = null }) {
  const EN = strings.en;
  const L = strings[lang] || {};
  const t = (k) => (L[k] !== undefined ? L[k] : EN[k]);
  const tr = (k) => ((L.rhythms || {})[k] !== undefined ? L.rhythms[k] : EN.rhythms[k]);
  // ⚠ PER-POINT, PER-FIELD — never `L.points || EN.points`. That expression reads as a
  // whole-block fallback and behaves as one only when the key is ABSENT; when a translator
  // has done SOME of the 12 it is TRUNCATING, because a 3-element array is truthy. Measured
  // 2026-09-24 with a partial block: the packet rendered a page headed "12 Prayer Points"
  // containing THREE — points 4..12 silently gone, including the Mark 5 passage point 4
  // prints in full. Nothing was blank and no error was raised, so it looked translated.
  // A half-finished translation is the NORMAL state of a language in progress, and
  // "a new language is a NEW BLOCK, never a code change" only holds if a partial block
  // degrades per key. English fixes the LENGTH (12) and supplies every missing field.
  const LP = Array.isArray(L.points) ? L.points : [];
  const POINTS = EN.points.map((en, i) => {
    const loc = LP[i];
    if (!loc || typeof loc !== 'object') return en;
    // Field-level merge: a point translated for `text` but not `sub` keeps the English
    // `sub` rather than losing it. refs/n/print_passage stay authoritative from English —
    // they are structure and scripture addresses, not prose.
    return { ...en, ...Object.fromEntries(Object.entries(loc).filter(([, v]) => v !== undefined && v !== '')) };
  });
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  const flat = (v) => (v && typeof v === 'object' ? (v.label ?? v.value ?? '') : (v ?? ''));

  // ── SHEET GEOMETRY — the letter-portrait sheet, same as the poster format ───
  const W = 1500, H = 1941;         // CSS px; 8.5x11 at width 1500
  const PAGE_W_IN = 8.5;
  const SCALE = (PAGE_W_IN * 96 / W).toFixed(6);   // print scale: one sheet = one page
  const M = 60, HEAD = 90;                          // margins + running header
  // ★ THE PROFILE TABLE (Driver brief A1 item 1): ~20 per page, picture | generated localized
  // description | three prayer checkboxes. This replaces the 2-column card grid with 20 FULL-WIDTH
  // ROWS. PER_PAGE stays 20, so this is a change of LAYOUT SHAPE, NOT OF PAGINATION — which is what
  // lets check-packet-render's dropped-groups assertion (sheets === 1 + … + ceil(cards/PER_PAGE) + 2)
  // keep passing unrelaxed. That assertion exists to catch SILENTLY DROPPED PEOPLE GROUPS and its own
  // comment refuses a ±1 tolerance, so a rewrite that needed it loosened would be the wrong rewrite.
  const ROWS = 20, PER_PAGE = ROWS;
  const COLS = 1;
  // ★ THE THREE PRAYER COLUMNS, the Driver's own three questions (2026-09-27), in his order:
  //   1 have I blessed them
  //   2 God, what do you want me to KNOW about them
  //   3 God, what do you want me to DO to help them
  // A tick box per group per question, printed on the card so the packet is a WORKING sheet rather
  // than a reference: the reader marks it as they pray. Deliberately three and not more — the brief
  // is one hour with God, and a fourth column turns a prayer aid into a form.
  const PRAY_COLS = ['pray_blessed', 'pray_know', 'pray_do'];
  const GUT = 14;
  const CW = (W - 2 * M - GUT * (COLS - 1)) / COLS;   // 1380px — the full row width
  const CH = (H - 2 * M - HEAD - GUT * (ROWS - 1)) / ROWS;  // 73.25px — the row height
  // ⚠ ZERO SLACK IS THE FINDING, NOT THE REASSURANCE. 20 rows of 73.25 + 19 gutters fill the page to
  // exactly the 60px bottom margin. A description wrapping to THREE lines needs ~74px and overflows
  // the row by ~1px, which on a printed sheet is a silently clipped descender or a pushed row. The
  // answer is not a taller row — 20 rows must fit one page — it is the fit ladder below.
  const PHOTO = Math.min(CH - 8, 64);                 // the picture column: square, row-height-capped
  // The three checkbox cells. Each holds a box plus its short label; sized so all three fit beside
  // the description without the labels wrapping in the longest locale we ship.
  const PRAY_CELL = 84;
  const PRAY_W = PRAY_CELL * PRAY_COLS.length;        // 252px
  // What is left is the description — the widest column on the page, and the point of the table.
  // For comparison an ENTIRE card in the old 2x10 grid was 683px wide; the description alone is 50%
  // wider than that, because a generated sentence needs the width a name and two metadata lines did not.
  const DESC_W = CW - PHOTO - PRAY_W - GUT * 2;       // ~1024px

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // ⚠ `lang` (the factory parameter), never a module-level LANG — and never
  // process.env.LANG, which is the SHELL's POSIX locale ("en_US.UTF-8"): not a valid
  // BCP-47 tag, and it throws inside toLocaleString.
  const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString(lang) : '—');

  const sheet = (inner, cls = '') =>
    `<div class="sheet ${cls}">${inner}</div>`;

  // The script font for THIS language, if it needs one. `fontData` is a base64
  // woff2 the caller supplies: the packet must stay a SELF-CONTAINED file that
  // prints offline (the Node generator writes standalone HTML with no server, and
  // photos are already inlined for the same reason), so a URL would break exactly
  // where the packet is most used. Absent fontData, the rule is simply omitted and
  // the stack falls back to serif — a legible wrong font beats a broken document.
  const SF = SCRIPT_FONT[lang] || null;
  const fontFace = (SF && fontData)
    ? `@font-face{font-family:'${SF.family}';font-style:normal;font-weight:400;`
      + `font-display:swap;src:url(data:font/woff2;base64,${fontData}) format('woff2')}`
    : '';
  // Prepend the script face to EVERY element's stack in one rule rather than
  // editing 22 hardcoded Georgia declarations. The browser falls through per
  // CHARACTER, so Latin text in a Hindi packet still renders in Georgia.
  const scriptStack = SF
    ? `.sheet,.sheet *{font-family:'${SF.family}',Georgia,'Palatino Linotype',serif !important}`
    : '';

  function css() {
    return `
    ${fontFace}
    ${scriptStack}
    @page{size:letter portrait;margin:0}
    html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sheet{position:relative;width:${W}px;height:${H}px;background:#f7f4ec;overflow:hidden;
           page-break-after:always;break-after:page}
    .sheet:last-child{page-break-after:auto;break-after:auto}
    .hd{position:absolute;left:${M}px;top:46px;font:700 30px Georgia,'Palatino Linotype',serif;color:#1b1a17}

    /* ── LIFE CALENDAR (pages 2 and 3) ─────────────────────────────────────
       5,200 cells must fit one sheet and still read as countable boxes. 52 columns
       is fixed by the DATA (weeks in a year), so the cell size is derived from the
       printable width rather than chosen: (1500 - 2*60) / 52 = 26.5px per column,
       leaving a 21px box with a 2px gap. Measured, not eyeballed — a hardcoded box
       size that happened to fit at one margin would break the moment M changed. */
    .pg-head{margin:0 0 10px}
    .pg-kicker{font:700 15px Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:#8a8577}
    .pg-h1{margin:2px 0 0;font:700 40px Georgia,serif;color:#1b1a17}
    .pg-lede{margin:0 0 22px;max-width:1180px;font:400 19px/1.5 Georgia,serif;color:#413d35}
    /* ⚠ THE CELLS ARE RECTANGLES, NOT SQUARES, and that is forced by the sheet rather than chosen.
       52 columns is fixed by the data (weeks in a year) and 100 rows by the product's "100 year life" framing,
       so both dimensions are given and only the SHAPE is free. Squares would need
       (1380/52)=26.5px per side x 100 rows = 2,654px of grid in 1,521px of printable height — it
       overflows the page by 1.7x. Caught by computing the height before rendering rather than by
       looking at an overflowing PDF. 13px rows put 100 rows in 1,300px with room for the legend. */
    .lc-grid{display:grid;grid-template-columns:repeat(52,1fr);grid-auto-rows:13px;gap:2px;width:100%}
    .lc-c{display:block;width:100%;height:100%;border:1px solid #d8d3c4;border-radius:1px;background:#fff}
    .lc-on{background:#b9b2a0;border-color:#b9b2a0}
    /* The shaded share on the %-evangelical grid is the REACHED share, so it takes the accent colour and the
       unshaded majority stays quiet — the visual weight belongs to what is still waiting. */
    .lc-reached{background:#2f6d4f;border-color:#2f6d4f}
    .lc-legend{display:flex;gap:34px;margin:20px 0 0;font:400 17px Georgia,serif;color:#413d35}
    .lc-legend i{display:inline-block;width:15px;height:15px;vertical-align:-2px;margin-inline-end:8px}
    .lc-foot{margin:14px 0 0;font:400 14px Georgia,serif;color:#6f6a5c}

    /* ── THE BOUNDED + CENTERED SETS (back matter) ──────────────────────────
       Two figures side by side. The SVGs carry no width/height — they scale to their
       column through the viewBox, which is what keeps gospel's boundary gap intact:
       the gap lives in the LAYOUT's coordinates and scaling the viewBox cannot
       compress it, whereas nudging r or spread would. */
    .set-row{display:flex;gap:60px;align-items:flex-start;margin-top:26px}
    .set-col{width:var(--set-col,600px);flex:0 0 auto;text-align:center}
    .set-h{margin:0 0 10px;font:700 22px Georgia,serif;color:#1b1a17}
    .set-svg{width:100%;height:auto;overflow:visible}
    .set-ring{fill:none;stroke:#3b463d;stroke-width:2}
    .set-ring-faint{fill:none;stroke:#d8d3c4;stroke-width:1}
    .set-in{fill:#2f6d4f}
    .set-out{fill:#b9b2a0}
    /* ⚠ UNKNOWN IS INKED, NOT OMITTED — regions' rule, and it is right for print: a printed page
       has no hover, so a category the reader cannot SEE is one they will read as zero. Hollow so it
       is visibly neither inside nor outside rather than a third opinion. */
    .set-unk{fill:#fff;stroke:#b9b2a0;stroke-width:1.5}
    .set-centre{fill:#2f6d4f}
    .set-cap{margin:10px 0 0;font:400 15px Georgia,serif;color:#413d35}
    /* The ring legend: only the rings this zone actually fills, in ring order. Left-aligned inside
       the centred column because a ragged-right list of names reads far better than centred prose. */
    .set-rings{margin:10px 0 0;padding:0;list-style:none;text-align:start;
               font:400 13px Georgia,serif;color:#6f6a5c;line-height:1.5}
    .set-rings b{color:#1b1a17;font-weight:700}

    /* ── THE THREE PRAYER COLUMNS, now a HORIZONTAL strip at the end of each row ──────────
       They were a vertical stack in the old 683x160 card. In a ${CW}x${CH.toFixed(0)} ROW there is no
       vertical room for three stacked labels, so the three cells sit side by side, each
       ${PRAY_CELL}px wide, with the box above its label. inset-inline-end (not right) so the strip
       still mirrors under dir=rtl with the rest of the row. */
    .pray-cols{position:absolute;inset-inline-end:0;top:50%;transform:translateY(-50%);
               display:flex;flex-direction:row;gap:0}
    .pray-col{width:${PRAY_CELL}px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;
              gap:3px;font:400 10px Georgia,serif;color:#6f6a5c;text-align:center;line-height:1.15}
    .pray-box{display:inline-block;width:17px;height:17px;border:1.5px solid #b0a993;border-radius:3px;background:#fff;flex:0 0 auto}
    .pray-col em{font-style:normal}
    .hd-r{position:absolute;right:${M}px;top:54px;font:400 19px Georgia,serif;color:#8c8170}
    /* ⚠ box-sizing:border-box IS LOAD-BEARING HERE, NOT HOUSEKEEPING. Without it the row's height
       is the CONTENT box and the padding + border are added OUTSIDE it, so the row renders taller
       than the geometry that positions it — rega measured 81px against a 73.25px model, and because
       the row's top still advances by CH the rows then overlap their successors by the difference. The stack
       still fitted the sheet (it ended 8px INTO the 60px bottom margin rather than on it), which is
       exactly why this was invisible without a measurement: nothing clipped and nothing overflowed
       the page. With border-box the declared height IS the rendered height. */
    .card{position:absolute;box-sizing:border-box;display:flex;gap:${GUT}px;align-items:center;
          border-bottom:1px solid #e2ddd0;padding-bottom:6px;overflow:hidden}
    .card img,.card .nophoto{width:${PHOTO.toFixed(0)}px;height:${PHOTO.toFixed(0)}px;flex:0 0 auto;border-radius:3px}
    .card img{object-fit:cover}
    .card .nophoto{border:1px solid #d6d0c0;background:#f2efe6;display:flex;align-items:center;
                   justify-content:center;font:italic 9px Georgia,serif;color:#a89f8c;text-align:center;padding:3px}
    /* The description cell. A FIXED width rather than flex:1, because the fit ladder's character
       budget is computed against exactly this number — if the cell could stretch, the budget would
       be describing a width the cell no longer has. */
    .d-cell{width:${DESC_W.toFixed(0)}px;flex:0 0 auto;min-width:0;overflow:hidden}
    .nm{font:700 15px Georgia,serif;color:#1b1a17;line-height:1.15}
    .d-tx{font-family:Georgia,serif;color:#413d35;line-height:1.25;margin-top:2px}
    .d-fb{font:400 13px Georgia,serif;color:#6d766e;margin-top:2px}
    .mt{font:400 17px Georgia,serif;color:#6d766e}
    /* FINE PRINT — product decision: attribution minimal, fine print small. */
    .fine{position:absolute;left:0;right:0;bottom:22px;text-align:center;
          font:400 13px Georgia,serif;color:#a89f8c}
    /* PRINT. The sheet is authored at ${W}px wide while @page is physical, so without
       a rescale the browser maps ${W}px -> 15.6in and TILES one sheet over many pages.

       ⚠ Use zoom, NOT transform:scale(). They look identical on screen and behave
       completely differently under pagination:
         transform  is paint-time  — the element still RESERVES its full ${H}px layout
                    box, so the paginator walks ${H}px of content and breaks it across
                    two sheets, inking only the top of the first. Measured: 8 sheets
                    came out as 16 PDF pages. Negative margins do NOT fix this — they
                    collapse the outer space, not the fragmentation box.
         zoom       is layout-time — the box itself becomes ${(PAGE_W_IN*96).toFixed(0)}px
                    wide, so pagination sees the scaled size. Measured: 1 page/sheet.
       Verified by _probe-pagecount.mjs (transform 2, transform+margins 2, zoom 1). */
    @media print{
      html,body{width:${(PAGE_W_IN * 96).toFixed(0)}px;margin:0;padding:0}
      .sheet{width:${W}px;height:${H}px;zoom:${SCALE};
             page-break-after:always;break-after:page}
      .sheet:last-child{page-break-after:auto;break-after:auto}
    }`;
  }

  // Lift the poster's stylesheet so the inlined map keeps its palette and map rules,
  // dropping only the rules that would fight the packet's own page shell.
  //
  // Comments are stripped FIRST and deliberately: generate.mjs's CSS comments are long
  // prose that contains braces and selector-like text, so any brace-counting or
  // selector regex run over the raw source mis-parses them as rules. Strip, then split.
  function mapCss(posterHtml) {
    const block = posterHtml.match(/<style>([\s\S]*?)<\/style>/);
    if (!block) return '';
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');

    // Drop @media (the poster's own print-scaling rules, which do not apply here).
    // Depth-aware because @media bodies nest a further level of braces.
    let out = '', depth = 0, i = 0;
    while (i < css.length) {
      if (css.startsWith('@media', i)) {
        let d = 0, started = false;
        while (i < css.length) {
          if (css[i] === '{') { d++; started = true; }
          else if (css[i] === '}') { d--; if (started && d === 0) { i++; break; } }
          i++;
        }
        continue;
      }
      out += css[i++];
    }

    // Drop document-level rules: these style the POSTER page, not the map, and would
    // override the packet's background, box-sizing and stage geometry.
    const DOC = /(^|,)\s*(html|body|\*|\.stage)\s*$/;
    return out.split('}')
      .map((r) => {
        const at = r.indexOf('{');
        if (at < 0) return '';
        const sel = r.slice(0, at).trim();
        if (!sel) return '';
        // :root must be KEPT — it carries the palette the map's var()s resolve against.
        if (sel !== ':root' && sel.split(',').some((s) => DOC.test(s.trim()) || /^(html|body|\*|\.stage)$/.test(s.trim()))) return '';
        return `${sel}{${r.slice(at + 1).trim()}}`;
      })
      .filter(Boolean).join('\n');
  }

  // ── PAGE 1: the map one-pager ───────────────────────────────────────────────
  // Lightweight by design — the Driver asked for "a lightweight one pager that shows
  // the geography with all the pins", explicitly NOT the poster. The poster remains
  // its own artefact (generate.mjs); this is the packet's cover.
  function mapPage(zone, groups, mapSvg) {
    const count = groups.length;
    return sheet(`
      <div style="position:absolute;left:${M}px;top:${M}px;right:${M}px;text-align:center">
        <div style="font:600 21px Georgia,serif;letter-spacing:3px;color:#8c8170">${esc(t('map_page_kicker'))}</div>
        <div style="font:700 56px Georgia,serif;color:#1b1a17;margin-top:8px">${esc(zone.label || zone.id)}</div>
        <div style="font:italic 24px Georgia,serif;color:#6d766e;margin-top:10px">
          ${esc(fill(t('map_page_sub'), { count: num(count) }))}</div>
      </div>
      ${mapSvg}
      <div class="fine">${esc(t('privacy_note'))}</div>`);
  }

  // ── PAGE 2: the funnel — how this list was narrowed out of every people group ─
  //
  // WHY THIS PAGE EXISTS. Driver 2026-09-26, via the shepherd: the packets go to ALL partners for
  // the largest prayer campaign, and a partner holding one list needs to see where their list sits
  // in the whole. The narrowing IS the argument: 12,379 people groups on earth, 7,341 of them
  // unreached, 4,754 frontier, 2,107 on this network's list, and N of those in the reader's hand.
  //
  // ★ IT RENDERS NUMBERS IT DID NOT COMPUTE, ON PURPOSE. Every count is READ from the caller's
  // `funnel` object, which comes from data/people-groups/vision-funnel.json — the file
  // library/scripts/people-groups/build-vision-funnel.mjs generates from the IMB CSV and the live
  // DOXA list, and which ALREADY feeds the Vision Card. Recomputing them here would create a second
  // source of truth for the same fact, and the two would drift into "two honest surfaces that
  // disagree" — each internally consistent, together telling a reader the project cannot count.
  // If a number is wrong, it is wrong in the generator, and it is wrong in the Vision Card too.
  //
  // ⚠ NO STEP IS HARDCODED AND NEITHER IS THE NUMBER OF STEPS. `funnel.steps` is walked as given,
  // so when the `list` prop lands (exp-shepherd, Tier A: profile-config.list / ?list= /
  // window.MAP_LIST, default 'doxa') and the 7k / 4.7k / 700 lists plug in, their own step chains
  // render with no change here. A step whose id has no string falls back to the id itself rather
  // than rendering blank.
  //
  // ⚠ K AND N ARE READ AT RENDER TIME, NEVER TYPED. Measured 2026-09-26: the brief said "~30 lists
  // of 50-100" and the catalogue says K=27 with counts from 8 to 118 — west-africa 118,
  // asia-india-rajasthan 116, uncovered-scatter 8. Only about half sit inside 50-100, so this page
  // never claims that band; it states the share the data can defend. Shepherd approved exactly this
  // (ENDTOKEN-DXS-UPG-KDECIDE), K=27 including the two residual buckets until the Driver rules.
  //
  // ⚠ "NUMERALS UNTOUCHED" IS ABOUT DIGITS, NOT GROUPING, and those are two properties. I verified the
  // digits and assumed the rest. rega measured the rendered hi sheet and found Indian grouping —
  // "8,28,85,63,969 लोग" (lakh/crore, 2-2-3) rather than Western 3-3-3. That is CORRECT hi-IN
  // formatting, so changing it would be worse than leaving it, and the real risk was never the
  // grouping itself but INCONSISTENCY: the same number printed two ways in one document.
  // Measured 2026-09-26, and it is consistent: num() is the ONLY formatter in this renderer, so the
  // funnel's populations and the people-group cards' populations group identically. Confirmed against
  // the rendered hi packet — card populations 1,70,000 / 3,37,000 / 8,10,000 are Indian-grouped like
  // the funnel's. (Only values at or above 100,000 can distinguish the two systems at all; my first
  // check classified "1,400" and read a mismatch that did not exist.)
  //
  // ⚠ NUMERALS STAY WESTERN. num() is toLocaleString(lang), and for the bare `ar`/`hi` tags CLDR's
  // default numbering system is `latn` — verified: 12,379 and 2,107 in both. Arabic-Indic digits
  // need an explicit -u-nu-arab, which nothing here asks for. The brief requires numerals untouched,
  // and reusing num() is also what keeps the funnel's digits identical to every other packet page.
  function funnelPage(zone, groups, funnel) {
    if (!funnel || !Array.isArray(funnel.steps) || !funnel.steps.length) return '';
    const steps = funnel.steps;
    const top = steps[0] && steps[0].groups;
    // The widest bar is the first step; every bar is drawn proportional to it, with a floor so the
    // smallest step is still a visible bar rather than a hairline.
    const BAR_W = W - 2 * M - 300;
    const width = (n) => Math.max(26, Math.round(BAR_W * (Number(n) / Number(top || 1))));

    // THIS list, the step the reader is holding. `groups.length` is the packet's own row count, so
    // the page cannot disagree with the pages that follow it.
    const mine = groups.length;
    // ⚠ THE DENOMINATOR MUST BE THE LIST THE PACKET IS ACTUALLY DRAWN FROM, and it is an EXPLICIT
    // input for that reason. An earlier version fell back to the last funnel step
    // (`funnel.listTotal ?? steps[last].groups`), which is 2,107 — DOXA's list. That is right today
    // because every map shows DOXA, and it becomes WRONG the moment the universal `list` prop lands
    // (exp-shepherd, library/lists/peopleGroupList.js): under ?list=frontier a Tier A map shows the
    // DOXA groups that are ALSO frontier, which SPEC-PEOPLE-GROUP-LIST-PROP.md measures at 1,753. The
    // page would have printed "N of the 2,107" with total confidence while the map showed a different
    // set — a faithful proxy that silently changes meaning when a new path appears, which is the same
    // family as inferring "did it work" from a field that only answers "did it isolate".
    //
    // So a caller that knows the active list says so. A caller that does not gets NO SHARE LINE rather
    // than a plausible wrong one: `mine` is always trustworthy (it is this packet's own row count) but
    // a percentage needs both terms, and half a fraction is not a fact.
    const total = Number(funnel.listTotal) || 0;
    const pct = total ? (100 * mine / total) : 0;
    // ⚠ A SHARE MUST NEVER ROUND TO ZERO — zero reads as "this packet covers none of them", which is
    // false for every list. Measured against the real catalogue (counts 1..118 of 2,107): one decimal
    // gave the single-group fixture "0.0%" when the true value is 0.0475%. So: integer at or above
    // 10%, one decimal from 1%, two below that, then strip trailing zeros so 0.9967 prints "1" rather
    // than "1.00". Verified across 1, 2, 8, 20, 21, 43, 95, 118 and 300 groups.
    const pctStr = pct >= 10
      ? String(Math.round(pct))
      : pct.toFixed(pct >= 1 ? 1 : 2).replace(/\.?0+$/, '');

    // ⚠ THE SHARE HAS TWO CLAUSES AND THEY ARE PROVABLE SEPARATELY. "1 of K lists" needs the zone
    // catalogue, which only describes the DEFAULT list; "{pct}% of the {total}" needs only this
    // packet's own row count and the active list's total, both of which are always known. A first
    // version suppressed the whole line whenever listCount was absent, which threw away a true
    // statement to avoid an unprovable one — the same over-correction as defaulting the unassigned
    // count to 0, in the opposite direction.
    const share = !total ? '' : `<div class="funnel-share" style="font:700 26px Georgia,serif;color:#7a3b2e;margin-top:10px">
           ${esc(funnel.listCount
             ? fill(t('funnel_share'), { k: num(funnel.listCount), pct: pctStr, total: num(total) })
             : fill(t('funnel_share_pct'), { pct: pctStr, total: num(total) }))}</div>`;
    // ⚠ THE FOOTNOTE IS TWO INDEPENDENT FACTS AND ONLY ONE IS ALWAYS KNOWABLE. Provenance ("counts
    // from X, captured Y") holds for every list; coverage ("N of the M are not yet in any list") is a
    // fact about the UPG-100 zone catalogue, which partitions DOXA and nothing else. The first version
    // filled it with `funnel.unassigned ?? 0`, so a non-default list would have printed
    // "0 of the 1,745 are not yet in any list" — a confident falsehood, and the zero makes it read as
    // a completeness claim rather than a missing measurement.
    // So an unknown coverage drops to the provenance-only string rather than defaulting the number.
    // ⚠ NOT BY SPLITTING THE TRANSLATED SENTENCE on punctuation: hi ends with "।" and zh with "。",
    // and parsing translated prose for structure is the same trap as reading a localized page header
    // positionally (see check-packet-render's "PARSE THE NUMBERS, NEVER THE WORD ORDER").
    const imbSrc = funnel.sources && funnel.sources.imb;
    const foot = !imbSrc ? '' : esc(
      Number.isFinite(Number(funnel.unassigned))
        ? fill(t('funnel_foot'), {
            imb_pub: imbSrc.publisher || '',
            imb_date: imbSrc.captured || '',
            unassigned: num(funnel.unassigned),
            total: num(total),
          })
        : fill(t('funnel_foot_source'), {
            imb_pub: imbSrc.publisher || '',
            imb_date: imbSrc.captured || '',
          }),
    );

    // ★ THE READER'S OWN STEP IS THE LAST ROW OF THE FUNNEL, NOT A FOOTER. rega measured the first
    // version in print (2026-09-26): the four global steps ended at y≈330 of 1056 while "43 · are in
    // THIS packet" sat alone at y≈965, leaving the middle ~60% of the sheet empty and making the
    // reader's own step read as a detached footnote. Worse, it had NO BAR, so the funnel never
    // visibly narrowed to "yours" — a funnel whose final term is not drawn as part of the funnel
    // fails at the one thing it is for.
    // So the five steps are ONE list, the reader's included, and the row rhythm is derived from the
    // space actually available rather than a fixed 22px gap: measured, four rows filled 451 of the
    // 1605px between the intro and the footer, i.e. 28% of the page.
    const ROWS_TOP = M + 110;
    const FOOT_RESERVE = 210;              // share line + source footnote
    // ★ A NON-DEFAULT LIST GETS ITS OWN STEP, so the narrowing does not jump from one list's total to
    // another list's packet. The four IMB steps stay true under every list — they are global counts,
    // unaffected by which list the reader holds — but the LAST one is DOXA's 2,107, and going straight
    // from it to "71 in THIS packet" implies DOXA is the parent set of the reader's rows. It is not:
    // under ?list=frontier-500k the parent is that list's own DOXA-side total. packetFunnel supplies
    // it as listTotal + listLabel when the active list is not the default; when it IS the default,
    // listTotal equals the DOXA step and inserting it would repeat the row.
    // ⚠ AND IT IS OMITTED WHEN IT WOULD REPEAT A NUMBER ALREADY ON THE PAGE — either the DOXA step
    // above it (the default list, where listTotal IS that step) or the reader's row below it. Measured:
    // under ?list=frontier-500k the whole list is 71 DOXA groups and a Laos packet drawn from it holds
    // all 71, so the page rendered "71 -> 71", two identical bars reading as a funnel that narrows to
    // nothing. A step that repeats its neighbour is not a step.
    const lastImb = (steps[steps.length - 1] || {}).groups;
    // ⚠ THE LIST'S LABEL IS TRANSLATED HERE, NOT TAKEN FROM THE DATA. rega measured the rendered hi
    // packet (2026-09-26): "Project 4700: frontier people groups" sat among Devanagari labels in a
    // Latin serif face, because it comes verbatim from library/lists/lists.json, which carries ONE
    // label per list and has no locale dimension at all. The same would happen in all ten non-English
    // locales, and the gate passed because it counts rows, not the row's language.
    //   packet-strings.json is the packet's OWN catalogue and the place this belongs — a new language
    // is a new block there, never a code change — so funnel_list_<id> supplies it and falls back to
    // the data's English label for any list this catalogue has not met. The numeric designation stays
    // ("Project 4700" / "4700 计划"): it names the campaign, while "frontier people groups" is prose.
    // That is the same line check-i18n-never-translated draws around "UUPGs".
    const listLabel = funnel.listId
      ? (t(`funnel_list_${funnel.listId}`) ?? funnel.listLabel)
      : funnel.listLabel;
    const ownStep = (listLabel && total && total !== lastImb && total !== mine)
      ? [{ groups: total, population: null, label: listLabel, tint: true }]
      : [];
    const allRows = [
      ...steps.map((s, i) => ({
        groups: s.groups,
        population: s.population,
        label: t(`funnel_${s.id}`) !== undefined ? t(`funnel_${s.id}`) : s.id,
        // The network's own list is the hinge between "the world" and "yours" — tint it, and tint
        // the reader's row below it the same, so the last two read as one thought. With a
        // non-default list the hinge moves down to that list's own row instead.
        tint: i === steps.length - 1 && !ownStep.length,
      })),
      ...ownStep,
      { groups: mine, population: null, label: t('funnel_this'), tint: true, mine: true },
    ];
    // ⚠ THE GAP IS DERIVED FROM THE MEASURED ROW HEIGHTS, NOT FROM A GUESS AT THEM. A first version
    // subtracted a magic 118 as "about one row" and left 418px of dead space at the foot — the same
    // emptiness rega reported, just redistributed. Summing the real heights closes it.
    //
    // ⚠ AND IT DELIBERATELY KEEPS SLACK, because two runtime facts are unknowable here: whether a
    // step carries a population line, and how many LINES its translated label wraps to. Arabic and
    // Hindi labels are longer than the English ("مجموعات حدودية — 0.1% أو أقل، ولا يكاد أحد يذهب
    // إليها" against "are frontier"), so a label that wraps on two rows must not push the footnote
    // off the sheet. LINE_SLACK is that room: one extra wrapped line per row. Tight-packing this
    // page would trade rega's "60% empty" for an overflow in exactly the locales I cannot eyeball.
    const LINE_SLACK = 30;
    const rowHeight = (r) => (r.mine ? 46 : 40) + 3 + (r.mine ? 22 : 20)
      + (Number.isFinite(Number(r.population)) ? 19 : 0) + 8 + 16 + LINE_SLACK;
    const rowsHeight = allRows.reduce((sum, r) => sum + rowHeight(r), 0);
    const GAP = Math.max(18, Math.floor((H - ROWS_TOP - FOOT_RESERVE - rowsHeight) / (allRows.length - 1)));

    const rows = allRows.map((r) => {
      // ⚠ `Number.isFinite(Number(x))` IS THE WRONG TEST and it printed "0 people" on the reader's row
      // of every packet (rega, rendered layer, 2026-09-26). Number(null) is 0 — only Number(undefined)
      // is NaN — so the deliberate `population: null` marker on the reader's row passed the guard and
      // rendered as the number zero. I asked "is this a finite number?" when the question was "did
      // anyone give me a population?". Presence and value are different properties; this is the same
      // confusion as inferring "did it work" from a field that answers "did it isolate".
      // AND ZERO IS ALSO SUPPRESSED: a people group with no people is not a fact, so a genuine 0 is
      // missing data wearing a number's clothes.
      const popN = (r.population === null || r.population === undefined || r.population === '')
        ? null : Number(r.population);
      const pop = (popN !== null && Number.isFinite(popN) && popN > 0)
        ? `<div style="font:400 17px Georgia,serif;color:#a89f8c;margin-top:2px">${num(popN)} ${esc(t('funnel_people'))}</div>`
        : '';
      // ⚠ THE LAST ROW DOES NOT KEEP THE FULL GAP. Measured in print (rega): the share line sat a full
      // 218px below the reader's row but only 42px above the footnote, so it read as part of the
      // FOOTNOTE rather than as the conclusion of the "43" row. The gap belongs BETWEEN rows; the share
      // is that last row's conclusion and should sit close under it. Proximity is the only thing
      // grouping them, so an even gap everywhere groups the share with the wrong element.
      // ★ CENTRED, so the bars form an UPSIDE-DOWN TRIANGLE narrowing to a point — the Driver's
      // "upside down triangle ... the bottom of the triangle shows the tip". margin-inline:auto on
      // the bar and text-align:center on the row is the whole geometry: each bar is already drawn
      // proportional to the first step, so centring them IS the triangle. No new maths, and the
      // careful population/grouping logic below is untouched.
      return `<div style="margin-bottom:${r.mine ? 14 : GAP}px;text-align:center"${r.mine ? ' class="funnel-mine-row"' : ''}>
        <div${r.mine ? ' class="funnel-mine"' : ''} style="font:700 ${r.mine ? 46 : 40}px Georgia,serif;color:${r.tint ? '#7a3b2e' : '#1b1a17'};line-height:1">${num(r.groups)}</div>
        <div style="font:400 ${r.mine ? 22 : 20}px Georgia,serif;color:#3b3226;margin-top:3px">${esc(r.label)}</div>
        ${pop}
        <div style="height:16px;width:${width(r.groups)}px;background:${r.tint ? '#7a3b2e' : '#cdbf9e'};margin-top:8px;border-radius:2px;margin-inline:auto"></div>
      </div>`;
    }).join('');

    // ── THE EQUATION SIDEBAR ────────────────────────────────────────────────
    // Driver, 2026-09-27: "a map equation with a side bar for the equations". Every number on this
    // page is DERIVED, and the derivation is the argument — a reader who cannot see how 12,379
    // becomes 2,107 has to take the funnel on faith. So each step states the filter that produced it,
    // read from vision-funnel.json's own step ids rather than written out here, and the provenance
    // line names the file and capture date.
    // ⚠ NOT A RESTATEMENT OF THE BARS. The bars show HOW MANY; the sidebar shows WHY THAT MANY. A
    // sidebar repeating the counts would add width and no information.
    const SIDEBAR_W = 300;
    const eqRows = allRows.filter((r) => !r.mine).map((r, idx, arr) => {
      const prev = idx > 0 ? arr[idx - 1] : null;
      const delta = prev ? Number(prev.groups) - Number(r.groups) : null;
      return `<div style="margin-bottom:16px">
        <div style="font:700 16px Georgia,serif;color:#3b3226">${num(r.groups)}</div>
        <div style="font:400 12px/1.45 Georgia,serif;color:#6f6a5c">${esc(r.equation || r.label)}</div>
        ${delta !== null ? `<div style="font:400 11px Georgia,serif;color:#a89f8c;margin-top:2px">\u2212 ${num(delta)}</div>` : ''}
      </div>`;
    }).join('');
    const sidebar = `<div class="funnel-eq" style="position:absolute;top:${ROWS_TOP}px;inset-inline-end:${M}px;width:${SIDEBAR_W}px">
      <div style="font:700 13px Georgia,serif;letter-spacing:.1em;text-transform:uppercase;color:#8a8577;margin-bottom:12px">${esc(t('funnel_eq_title'))}</div>
      ${eqRows}</div>`;

    // ★ THE TIP OF THE TRIANGLE: this packet is one of N. The Driver's "the tip ... the smaller UPG
    // 100 list is a subset, 1 of 30 or n exact UPG 100 lists". N is READ from the catalogue
    // (funnel.listCount), never typed — it is 28 today and was 27 before the deaf zone became
    // reachable, so a literal would already be wrong.
    const tip = !funnel.listCount ? '' : `<div class="funnel-tip" style="text-align:center;margin-top:18px">
      <div style="font:700 15px Georgia,serif;letter-spacing:.08em;text-transform:uppercase;color:#7a3b2e">${esc(fill(t('funnel_tip'), { n: num(funnel.listCount) }))}</div>
    </div>`;

    return sheet(`
      <div style="position:absolute;left:${M}px;top:44px;right:${M}px">
        <div class="funnel-title" style="font:700 40px Georgia,serif;color:#1b1a17">${esc(t('funnel_title'))}</div>
        <div style="font:italic 18px Georgia,serif;color:#6d766e;margin-top:6px">${esc(t('funnel_intro'))}</div>
      </div>
      <div style="position:absolute;left:${M}px;top:${ROWS_TOP}px;right:${SIDEBAR_W + M + 24}px">${rows}${share}${tip}</div>
      ${sidebar}
      <div class="fine">${foot}</div>`);
  }

  // ── LIFE CALENDAR: 100 years x 52 weeks = 5200 boxes ────────────────────────
  //
  // Driver, 2026-09-27: page 2 is "a life calendar of the years of a human life in weeks", and page 3
  // is "the same life cal used for percentage of Christian on average for dx people groups". ONE grid,
  // TWO readings — which is the whole point. A percentage drawn as a bar is an abstraction a reader
  // has to translate; drawn on the grid they have just understood as their OWN LIFE, it is the same
  // 5200 boxes they were looking at a page earlier.
  //
  // ★ 5,200 IS NOT ROUNDED OR CHOSEN FOR LAYOUT: 100 years x 52 weeks, the Driver's own numbers
  // ("a 100 year life in weeks"). Everything else here is derived from it, so the two pages cannot
  // drift apart into two grids that merely look alike.
  function lifeGrid({ shaded = 0, shadeClass = 'lc-on', seed = '' } = {}) {
    const YEARS = 100, WEEKS = 52, TOTAL = YEARS * WEEKS;
    const n = Math.max(0, Math.min(TOTAL, Math.round(Number(shaded) || 0)));

    // ⚠ SCATTERED, NOT STACKED — and the comment that used to sit here said the opposite. It read:
    // "Row-major, so the shaded run reads as a contiguous block from the top — a scattered shading of the
    // same COUNT would be honest arithmetic and an unreadable picture." That was reasoning about a picture
    // I had never looked at, and it was exactly backwards.
    // ★ WHAT THE RENDER ACTUALLY SHOWED (rega's contact sheet, 2026-09-28): 32 contiguous cells fill most
    // of row 1 of 52, so the page reads as ONE SOLID GREEN BAR across the header — the ordinary chart the
    // whole life-grid idea exists to avoid. The Driver's intent is "32 boxes lost in 5,200"; rarity is the
    // message, and a bar cannot say it. Scattering makes the eye hunt for them, which IS the point.
    // ⚠ AND NO GATE COULD SEE IT. check-packet-render asserts the shaded COUNT is strictly between 0 and
    // 5,200 — true of a scatter and equally true of a bar. A count cannot distinguish a distribution.
    //
    // DETERMINISTIC, NEVER Math.random(): the same packet must print identically every time, or two copies
    // of one zone disagree and neither is reproducible. A 32-bit FNV-1a hash of the seed (the zone id) feeds
    // a mulberry32 PRNG, so the pattern is stable per zone and DIFFERENT between zones — which also avoids
    // every packet in a print run carrying the same constellation.
    // ★ ONE IMPLEMENTATION, shared with the library chart components. The algorithm and both
    // comments above were written here first; scatterCells() in components/charts/packetCharts.js
    // now holds them, so the printed packet and the reusable chart cannot drift apart — and the
    // distribution is finally under a gate (check:packet-charts asserts the SPREAD, which the
    // count-based check here structurally cannot see).
    const picked = scatterCells(TOTAL, n, seed);

    const cells = [];
    for (let i = 0; i < TOTAL; i++) {
      cells.push(`<i class="lc-c${picked.has(i) ? ' ' + shadeClass : ''}"></i>`);
    }
    return { TOTAL, YEARS, WEEKS, shadedCount: n, html: `<div class="lc-grid">${cells.join('')}</div>` };
  }

  // Page 2 — a human life, unshaded except for the weeks already lived if the caller supplies an age.
  // No age is supplied today: the packet is printed for a reader we do not know, so shading their life
  // would be a guess presented as a fact. The empty grid is the honest version and still lands the
  // point — 5,200 boxes is a whole life on one page.
  function lifePage(zone) {
    const g = lifeGrid();
    return sheet(`
      <div class="pg-head"><div class="pg-kicker">${esc(t('life_kicker'))}</div>
        <h1 class="pg-h1">${esc(t('life_title'))}</h1></div>
      <p class="pg-lede">${esc(t('life_lede'))}</p>
      ${g.html}
      <p class="lc-foot">${esc(t('life_foot'))}</p>
    `, 'sheet-life');
  }

  // Page 3 — the SAME grid, shaded by the share of the DX population that is evangelical.
  //
  // ⚠ THE NUMBER IS POPULATION-WEIGHTED, NOT A GROUP COUNT, because the Driver asked for
  // "% of Christian population vs lost". Those differ sharply: 69.1% of the 2,091 matched DX GROUPS
  // have no known evangelicals, but weighted by POPULATION the evangelical share is 0.61% of
  // 209,079,159 people — 32 boxes of 5,200. A group-count version would have shown a different,
  // milder picture of the same data.
  // ⚠ AND THE BAND MIDPOINT IS AN ASSUMPTION, NAMED ON THE PAGE. peoplegroups.org publishes
  // EvangelicalLevel as a BAND ("Less than 2%", "No Known Evangelicals", …), never a number, so a
  // percentage requires choosing a value inside each band. The builder uses the band's midpoint and
  // 0 for "No Known Evangelicals"; the footnote says so, because a computed figure whose method is
  // invisible reads as a measurement.
  function christianPage(zone, christian) {
    if (!christian || !Number.isFinite(Number(christian.pctEvangelical))) return '';
    const pct = Number(christian.pctEvangelical);
    const g = lifeGrid({ shaded: (pct / 100) * 5200, shadeClass: 'lc-reached', seed: zone.id || zone.zoneKey || 'upg-100' });
    const lostPct = 100 - pct;
    // ⚠ TWO DECIMALS ON BOTH SIDES, not rounded above 10. The reached share is 0.61% and rounding the
      // other side to "99%" loses the asymmetry that is the whole point: 99.39 and 0.61 sum to 100, while
      // 99 and 0.61 do not, and a reader checking the arithmetic finds the page wrong.
      const fmtPct = (x) => x.toFixed(2).replace(/\.?0+$/, '');
    return sheet(`
      <div class="pg-head"><div class="pg-kicker">${esc(t('christian_kicker'))}</div>
        <h1 class="pg-h1">${esc(t('christian_title'))}</h1></div>
      <p class="pg-lede">${esc(t('christian_lede'))}</p>
      ${g.html}
      <div class="lc-legend">
        <span><i class="lc-c lc-reached"></i> ${esc(t('christian_reached'))} — ${esc(fmtPct(pct))}% · ${num(g.shadedCount)} ${esc(t('life_weeks'))}</span>
        <span><i class="lc-c"></i> ${esc(t('christian_lost'))} — ${esc(fmtPct(lostPct))}% · ${num(g.TOTAL - g.shadedCount)} ${esc(t('life_weeks'))}</span>
      </div>
      <p class="lc-foot">${esc(t('christian_foot'))}${christian.population ? ` · ${num(christian.population)} ${esc(t('christian_people'))}` : ''}</p>
    `, 'sheet-christian');
  }

  // ── THE DESCRIPTION CELL: FIT BEFORE CLAMP ───────────────────────────────────────────────────
  // ★ DETERMINISTIC BY CHARACTER COUNT, NEVER A DOM MEASURE. This module runs under Node for the
  // offline generator, where there is no layout engine to ask "how tall did that wrap?". So the
  // budgets below come from an average character advance deliberately set WIDER than Georgia's true
  // ~0.50em — 0.52 — so a locale that runs wider than English is absorbed by the estimate rather
  // than by an overflow onto a second page. Measuring in a browser would make the browser path and
  // the Node path disagree, which is worse than a slightly conservative estimate in both.
  //
  // WHY FIT BEFORE CLAMP (dx-shepherd's ruling, and it is the right one): on paper a cut prayer
  // description loses meaning and a reader cannot scroll to recover it. So shrink the type first —
  // 17px, then 15px, then 14px — and truncate only as the last resort.
  const DESC_SIZES = [17, 15, 14];
  const AVG_ADVANCE = 0.52;
  const DESC_LINES = 2;                               // the 2-line budget the 73px row allows
  const budgetFor = (px) => Math.floor(DESC_W / (px * AVG_ADVANCE)) * DESC_LINES;

  // Word-aware truncation. An earlier version sliced mid-word ("…Die Abai Sungai le…"), which reads
  // as a RENDERING FAULT rather than an editorial cut — especially inside a people-group's name, where
  // a reader cannot tell a truncation from a misspelling of a name they have never seen.
  function cutAtWord(s, max) {
    if (s.length <= max) return s;
    const hard = s.slice(0, max - 1);
    const sp = hard.lastIndexOf(' ');
    // Unless the FIRST word alone exceeds the budget, back up to the last space.
    const body = sp > 0 ? hard.slice(0, sp) : hard;
    return body.replace(/[\s,;:.!?—–-]+$/, '') + '…';
  }

  // Returns { text, px, truncated }. Steps down the ladder, then clamps at the smallest size.
  function fitDescription(text) {
    const s = String(text || '');
    for (const px of DESC_SIZES) {
      if (s.length <= budgetFor(px)) return { text: s, px, truncated: false };
    }
    const px = DESC_SIZES[DESC_SIZES.length - 1];
    return { text: cutAtWord(s, budgetFor(px)), px, truncated: true };
  }

  // ★ THREE STATES, AND THE MIDDLE ONE IS WHY THIS IS A FUNCTION. `describe` is INJECTED (see
  // createPacketRenderer) rather than imported, because describeGroup's country resolver reaches a
  // Vite-only alias and imports JSON without an attribute — importing it here would make every
  // `node internal/check-*.mjs` unrunnable. So it may be ABSENT, and it may also RETURN EMPTY for a
  // group whose fields cannot form a sentence. Both degrade to the metadata line.
  // Per dx-shepherd's ruling the metadata line is a FALLBACK ONLY: the normal render has no metadata
  // line, because describeGroup already puts the country and language INTO the sentence and printing
  // them again would say the country twice.
  function descCell(g) {
    const sentence = describe ? String(describe(g) || '') : '';
    if (!sentence) {
      // The fallback: religion + population + country, the same three facts the old card carried.
      return `<div class="d-fb">${esc(flat(g.religion))} · ${num(g.population)} ${esc(t('people_suffix'))} · ${esc(flat(g.country_code))}</div>`;
    }
    const f = fitDescription(sentence);
    return `<div class="d-tx" style="font-size:${f.px}px">${esc(f.text)}</div>`;
  }

  function listPages(zone, groups, photos) {
    const pages = [];
    for (let start = 0; start < groups.length; start += PER_PAGE) {
      const slice = groups.slice(start, start + PER_PAGE);
      // ★ ONE FULL-WIDTH ROW PER GROUP. The column index is gone: `top` advances by the row, and the
      // three cells sit inside it. Absolute positioning is kept rather than switching to flow layout
      // because the print frame must not reflow — a row that moves between the browser preview and
      // the printed sheet is how a 20-row page becomes a 21-row page.
      const cards = slice.map((g, k) => {
        const i = start + k;
        const top = M + HEAD + k * (CH + GUT);
        const src = photos.get(g.slug);
        const img = src
          ? `<img src="${src}" alt="">`
          : `<div class="nophoto">${esc(t('no_photo'))}</div>`;
        return `<div class="card" style="left:${M}px;top:${top.toFixed(0)}px;
          width:${CW.toFixed(0)}px;height:${CH.toFixed(0)}px">${img}
          <div class="d-cell">
            <div class="nm">${i + 1}. ${esc(g.name)}</div>
            ${descCell(g)}
          </div>
          <div class="pray-cols">${PRAY_COLS.map((key) => `<span class="pray-col"
            ><i class="pray-box"></i><em>${esc(t(key))}</em></span>`).join('')}</div>
          </div>`;
      }).join('');
      pages.push(sheet(`
        <div class="hd">${esc(zone.label || zone.id)}</div>
        <div class="hd-r">${esc(fill(t('list_header'),
          { from: num(start + 1), to: num(Math.min(start + PER_PAGE, groups.length)), count: num(groups.length) }))}</div>
        ${cards}`));
    }
    return pages;
  }

  // ── PAGE n+1: the 12 prayer points ──────────────────────────────────────────
  function pointsPage() {
    const rows = POINTS.map((p) => {
      // ⚠ ISOLATE EACH REFERENCE FOR BIDI. Scripture references stay in English
      // (a reader looks them up in their own Bible), so on an RTL page they are
      // LTR runs inside an RTL paragraph. Without isolation the Unicode bidi
      // algorithm reorders a run that STARTS WITH A DIGIT: measured on the Arabic
      // page, "1 Peter 5:6–11" rendered as "Peter 5:6-11 1". dir="ltr" on each
      // reference pins its internal order without affecting the line's direction.
      const refs = (p.refs || [])
        .map((r) => `<span dir="ltr" style="unicode-bidi:isolate">${esc(r)}</span>`)
        .join(' · ');
      const sub = p.sub ? ` <span style="font:italic 17px Georgia,serif;color:#8c8170">— ${esc(p.sub)}</span>` : '';
      const passage = p.print_passage
        // Point 4 prints Mark 5:1-20 IN FULL. Driver: "it actually lists out the full
        // scripture, because prayer point number four is actually read the word."
        // class="p4-passage" is a TEST HOOK, not styling — the block is styled inline.
        // Without it the only way to assert the passage rendered was to search for the
        // English word "Gadarenes", which would go red the moment this key is translated.
        ? `<div class="p4-passage" style="font:400 14px Georgia,serif;color:#4a4a45;line-height:1.5;margin-top:5px;
               padding-left:10px;border-left:2px solid #d9d3c4">${esc(t('point4_passage'))}
             <div class="p4-credit" style="font:italic 12px Georgia,serif;color:#a89f8c;margin-top:3px">
               ${esc(t('point4_passage_credit'))}</div></div>`
        : '';
      return `<div style="margin-bottom:${p.print_passage ? 10 : 13}px">
        <div style="font:700 19px Georgia,serif;color:#1b1a17">
          ${p.n}. ${esc(tr(p.rhythm))}${sub}</div>
        <div style="font:400 17px Georgia,serif;color:#3b3226;line-height:1.35;margin-top:2px">${esc(p.text)}</div>
        <div style="font:600 14px Georgia,serif;color:#7a3b2e;margin-top:2px">${refs}</div>
        ${passage}
      </div>`;
    }).join('');
    return sheet(`
      <div style="position:absolute;left:${M}px;top:44px;right:${M}px">
        <div class="points-title" style="font:700 40px Georgia,serif;color:#1b1a17">${esc(t('points_title'))}</div>
        <div style="font:italic 18px Georgia,serif;color:#6d766e;margin-top:6px">${esc(t('points_intro'))}</div>
      </div>
      <div style="position:absolute;left:${M}px;top:${M + 96}px;right:${M}px;bottom:52px">${rows}</div>
      <div class="fine">${esc(t('points_attrib'))}</div>`);
  }

  // ── PAGE n+1: the BOUNDED and CENTERED sets ─────────────────────────────────
  // Brief A1 BACK MATTER: after the profiles, before the wheel. FULL DETAIL ONLY — the lightweight
  // packet is map · triangle · profiles · wheel · points, and these two figures are the part a
  // reader sits with rather than carries.
  //
  // The LAYOUTS come from regions' library/components/charts modules, imported directly rather than
  // injected: unlike describeGroup's country resolver they have ZERO imports and run under plain
  // node (verified by importing and calling them, not by reading them), and packet-render already
  // imports scatterCells from that same directory. They return DATA — points with x/y in unitless
  // SVG user coordinates centred on (cx,cy) — so the markup below is ours.
  //
  // ⚠ GOSPEL'S NON-NEGOTIABLE, carried through regions: the bounded set keeps a deliberate gap
  // either side of the boundary (inside within 0.92r, outside beyond 1.12r) because a dot sitting ON
  // the line is the one thing a bounded set cannot express, and PRINT HAS NO HOVER to disambiguate
  // it. If the figure does not fit, SHRINK THE WHOLE FIGURE — never compress the gap. Measured on
  // the real module with 40 groups: inside max 85.3 of 92 allowed, outside min 119.8 of 112
  // required. The scale below is applied to the viewBox, so it cannot touch the gap.
  // ★ THE AGREED RING VOCABULARY, COMPOSED — not a flat 1..10 table. Settled between gospel and exp
  // and derived from exp's ringFor(), so the numbering cannot drift from the code that produces it;
  // the screen legend renders the same words, so a printed sheet cannot disagree with the screen.
  //   1 same dialect, same people     6 same language, different culture
  //   2 same dialect, near culture    7 same family, same people
  //   3 same dialect, different culture  8 same family, near culture
  //   4 same language, same people    9 same family, different culture
  //   5 same language, near culture  10 nearby only
  // ⚠ COMPOSED FROM band x culture BECAUSE ONE CELL IS PROVISIONAL. "same people" vs the brief's
  // "same culture" in column 1 is PROVISIONAL, pending a product decision, and it appears in rings 1, 4 AND 7 —
  // so a flat ten-string table would need THREE edits kept in step, which is exactly how two of them
  // end up saying different things. Composed, it is ONE string (ring_culture_same) and the ring
  // numbering, the columns and the colours are untouched either way.
  const BANDS = ['dialect', 'dialect', 'dialect', 'language', 'language', 'language', 'family', 'family', 'family'];
  const CULTURES = ['same', 'near', 'different', 'same', 'near', 'different', 'same', 'near', 'different'];
  function ringName(n) {
    if (n === RING_MAX) return t('ring_band_geography');          // 10 stands alone
    const i = n - 1;
    if (i < 0 || i >= BANDS.length) return '';
    return fill(t('ring_join'), { band: t(`ring_band_${BANDS[i]}`), culture: t(`ring_culture_${CULTURES[i]}`) });
  }

  // ONLY THE RINGS THAT HOLD SOMEONE. Ten rows of vocabulary beside a figure is a glossary, not a
  // legend, and nine of the ten are routinely empty for one zone. Printing a named ring with no
  // group on it also invites the reader to look for a dot that is not there. `ringTally` gives the
  // per-ring counts, so the legend states what this zone actually contains, in ring order.
  function ringLegend(tally) {
    const counts = tally && tally.counts;
    if (!counts || typeof counts.get !== 'function') return '';
    const rows = [];
    for (let n = 1; n <= RING_MAX; n++) {
      const c = Number(counts.get(n) || 0);
      if (!c) continue;
      const name = ringName(n);
      if (!name) continue;
      rows.push(`<li><b>${num(c)}</b> ${esc(name)}</li>`);
    }
    return rows.length ? `<ul class="set-rings">${rows.join('')}</ul>` : '';
  }

  function setsPage(zone, sets) {
    // '' WITHOUT DATA, exactly like funnelPage and christianPage — a page that cannot state true
    // figures must not appear at all. This is what keeps FULL valid before a host supplies sets.
    if (!sets || (!Array.isArray(sets.bounded) && !Array.isArray(sets.centered))) return '';
    const bounded = Array.isArray(sets.bounded) ? sets.bounded : [];
    const centered = Array.isArray(sets.centered) ? sets.centered : [];
    if (!bounded.length && !centered.length) return '';

    const usableW = W - 2 * M, colW = (usableW - 60) / 2;
    const parts = [];

    if (bounded.length) {
      const L = layoutBoundedSet(bounded, { r: 100, spread: 220 });
      const T = boundedSetTally(L);
      // The viewBox is sized from the layout's own extent so the figure scales to the column
      // without any coordinate being touched — the gap survives by construction.
      // ⚠ UNKNOWN POINTS CARRY NO x/y, AND THAT IS THE MODULE BEING CORRECT. `reached` undefined
      // means we do not know which side of the boundary a people belongs on, so there is no honest
      // place to draw it — plotting it anywhere would assert the very thing that is unknown. My
      // first version mapped over L.unknown with the same dot() helper and crashed on
      // `p.x.toFixed`, which is a better outcome than silently drawing them at (0,0) inside the
      // circle. They are STATED in the tally instead (regions: an un-inked category on a printed
      // page, where there is no hover, reads as zero).
      const plotted = [...L.inside, ...L.outside];
      const ext = Math.max(...plotted.map((p) => Math.hypot(p.x - L.cx, p.y - L.cy)), L.r * 1.2) * 1.08;
      const dot = (p, cls) => `<circle class="${cls}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/>`;
      parts.push(`<div class="set-col">
        <h2 class="set-h">${esc(t('sets_bounded_title'))}</h2>
        <svg class="set-svg" viewBox="${(L.cx - ext).toFixed(1)} ${(L.cy - ext).toFixed(1)} ${(ext * 2).toFixed(1)} ${(ext * 2).toFixed(1)}">
          <circle class="set-ring" cx="${L.cx}" cy="${L.cy}" r="${L.r}"/>
          ${L.inside.map((p) => dot(p, 'set-in')).join('')}
          ${L.outside.map((p) => dot(p, 'set-out')).join('')}
        </svg>
        <p class="set-cap">${esc(fill(t('sets_bounded_tally'),
          { inside: num(T.inside), outside: num(T.outside), unknown: num(T.unknown) }))}</p>
      </div>`);
    }

    if (centered.length) {
      const L = layoutCenteredSet(centered, {});
      const T = ringTally(L);
      const ext = (L.innerR + RING_MAX * L.ringGap) * 1.12;
      parts.push(`<div class="set-col">
        <h2 class="set-h">${esc(t('sets_centered_title'))}</h2>
        <svg class="set-svg" viewBox="${(L.cx - ext).toFixed(1)} ${(L.cy - ext).toFixed(1)} ${(ext * 2).toFixed(1)} ${(ext * 2).toFixed(1)}">
          ${(L.radii || []).map((r) => `<circle class="set-ring-faint" cx="${L.cx}" cy="${L.cy}" r="${r.r}"/>`).join('')}
          ${L.placed.map((p) => `<circle class="set-in" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/>`).join('')}
          <circle class="set-centre" cx="${L.cx}" cy="${L.cy}" r="${(L.innerR * 0.6).toFixed(1)}"/>
        </svg>
        <p class="set-cap">${esc(fill(t('sets_centered_tally'),
          { placed: num(T.placed), centre: num(T.centre), unplaced: num(T.unplaced) }))}</p>
        ${ringLegend(T)}
      </div>`);
    }

    return sheet(`
      <div class="pg-head"><div class="pg-kicker">${esc(t('sets_kicker'))}</div>
        <h1 class="pg-h1">${esc(t('sets_title'))}</h1></div>
      <p class="pg-lede">${esc(t('sets_lede'))}</p>
      <div class="set-row" style="--set-col:${colW.toFixed(0)}px">${parts.join('')}</div>
    `, 'sheet-sets');
  }

  // ── PAGE n+2: the prayer wheel ──────────────────────────────────────────────
  // REDRAWN as SVG rather than embedding the source PDF page: a raster embed cannot
  // be translated, and this packet must generate in any language. Twelve equal
  // segments, the rhythm name set along each, 5 minutes each = one hour.
  function wheelPage() {
    const cx = W / 2, cy = 1090, R = 470;
    const order = ['praise', 'wait', 'confess', 'read', 'ask', 'intercede',
      'pray_word', 'thank', 'sing', 'meditate', 'listen', 'praise_end'];
    // Hues sweep the wheel so neighbouring rhythms stay distinguishable in print.
    const seg = order.map((key, i) => {
      const a0 = (i * 30 - 90) * Math.PI / 180, a1 = ((i + 1) * 30 - 90) * Math.PI / 180;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const hue = Math.round(i * 30);
      const mid = (a0 + a1) / 2;
      const tx = cx + R * 0.62 * Math.cos(mid), ty = cy + R * 0.62 * Math.sin(mid);
      let deg = mid * 180 / Math.PI;
      if (deg > 90 || deg < -90) deg += 180;            // keep every label upright
      return `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z"
                fill="hsl(${hue} 70% 72%)" stroke="#fff" stroke-width="3"/>
              <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${deg.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})"
                text-anchor="middle" dominant-baseline="middle"
                font-family="Georgia,serif" font-weight="700" font-size="21" fill="#2b2a26">${esc(tr(key))}</text>`;
    }).join('');
    const pips = order.map((_, i) => {
      const a = ((i + 0.5) * 30 - 90) * Math.PI / 180;
      const x = cx + (R + 46) * Math.cos(a), y = cy + (R + 46) * Math.sin(a);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="21" fill="#26251f"/>
              <text x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                font-family="Georgia,serif" font-weight="700" font-size="20" fill="#fff">5</text>`;
    }).join('');
    return sheet(`
      <div style="position:absolute;left:${M}px;top:48px;right:${M}px;text-align:center">
        <div class="wheel-title" style="font:700 42px Georgia,serif;color:#1b1a17">${esc(t('wheel_title'))}</div>
        <div style="font:italic 19px Georgia,serif;color:#6d766e;margin-top:10px;
                    max-width:1000px;margin-left:auto;margin-right:auto">${esc(t('wheel_intro'))}</div>
      </div>
      <svg width="${W}" height="${H}" style="position:absolute;left:0;top:0" xmlns="http://www.w3.org/2000/svg">
        ${seg}${pips}
        <text x="${cx}" y="${cy + R + 130}" text-anchor="middle"
          font-family="Georgia,serif" font-size="20" fill="#8c8170">5 ${esc(t('wheel_minutes'))} × 12</text>
      </svg>
      <div class="fine">${esc(t('wheel_attrib'))}</div>`);
  }

  // ── BUILD ONE PACKET ────────────────────────────────────────────────────────
  // Assemble the whole document. photos is a Map(slug -> dataURL-or-URL); mapSvg is
  // the poster's <svg> plus the stylesheet its var()s resolve against (see mapCss).
  // `funnel` is OPTIONAL and the page is omitted when it is absent, so every existing caller keeps
  // working unchanged and a host with no funnel data still gets a complete, correct packet. A page
  // that cannot state true numbers must not appear at all — better a 4-section packet than one
  // asserting figures it could not read.
  // ★ TWO PACKETS, ONE RENDERER — the Driver's §A, 2026-09-28: the Prayer List print gains a caret
  // with "Full detail" and "Lightweight". They are NOT two code paths. Every page below already
  // exists and is already exported; a variant is a FILTER over the page array, so the two packets
  // cannot drift apart in layout, i18n, RTL or print scale — there is only ever one implementation
  // of each page.
  //
  // LIGHTWEIGHT drops the two pages that are CONTEMPLATIVE rather than informational — the life
  // calendar and the evangelical-share grid. That is the whole difference, and it is deliberate:
  // those two are a full sheet each and exist to make the reader FEEL a number, which is exactly
  // what you cut when you want a packet to carry rather than to sit with.
  //
  // ⚠ 'lightweight' NEVER drops listPages. Losing a list page loses PEOPLE, silently — the failure
  // check-packet-render's sheet assertion exists to catch. A variant may drop a FIXED page; it may
  // never drop a page whose count depends on the data.
  const VARIANTS = {
    full: null,                                    // null = every page (today's packet, unchanged)
    // page KEYS to omit. 'sets' joins them: the bounded/centered figures are BACK MATTER a reader
    // sits with, which is the same reason the life calendar and the %-evangelical grid are dropped.
    lightweight: new Set(['life', 'christian', 'sets']),
  };

  // `sets` is the EIGHTH parameter and the last positional one this signature should ever grow — it
  // is already at the edge of readable. A ninth belongs in an options object; flagged here so the
  // next person adding a page makes that change rather than extending the line again.
  function buildPacket(zone, groups, photos, mapSvg, funnel = null, christian = null, variant = 'full', sets = null) {
    // ★ PAGE ORDER IS THE PRODUCT SPEC (A1, superseding the 2026-09-27 order this comment used to
    // record — the reorder is the spec's own deliberate change, confirmed via the shepherd, and the
    // stale "do not reorder" note updates in the SAME commit that reorders, as the plan card required):
    //   1 map            — where this zone is
    //   2 funnel         — the inverted triangle: 12,379 narrowing to THIS list, the argument first
    //   3 life calendar  — 100 years x 52 weeks, a whole human life on one page
    //   4 the SAME grid  — shaded by the evangelical share of these groups' POPULATION
    //   5..n people groups with photos and the three prayer columns
    //   then the bounded/centered sets (full only), the prayer WHEEL, and the 12 prayer POINTS —
    //   wheel before points, so the packet closes on what to pray rather than how long.
    // Pages 3 and 4 stay adjacent: the reader learns to read 5,200 boxes as their own life, then
    // sees the same 5,200 boxes answer "how many of these people know Christ".
    // ⚠ KEYED, NOT INDEXED. The omit-set names pages; it never carries positions. An index-based
    // filter reads identically today and silently drops the WRONG page the first time this order
    // changes — and the order above is the Driver's, so it is expected to change again.
    // An unknown variant falls back to the full packet: a typo must not silently print a shorter
    // packet, because a packet missing two pages still looks like a packet.
    const omit = VARIANTS[variant] || VARIANTS.full;
    const keep = (key) => !(omit && omit.has(key));
    const pages = [
      keep('map') && mapPage(zone, groups, mapSvg),
      keep('funnel') && funnelPage(zone, groups, funnel),
      keep('life') && lifePage(zone),
      keep('christian') && christianPage(zone, christian),
      // NOT behind keep() — see the VARIANTS comment: dropping list pages drops people.
      ...listPages(zone, groups, photos),
      // BACK MATTER: after the profiles (brief A1). Full-detail only.
      keep('sets') && setsPage(zone, sets),
      keep('wheel') && wheelPage(),
      keep('points') && pointsPage(),
    ].filter(Boolean);
    // ⚠ dir MUST be set for right-to-left languages or the packet renders Arabic
    // left-aligned — readable glyphs in the wrong place, which looks like a
    // styling quirk rather than the bug it is. Verified in a browser: with
    // dir="rtl" the text right-aligns, shapes correctly, and a Latin scripture
    // reference stays LTR inside the RTL line (correct bidi) with no extra work.
    return `<!DOCTYPE html><html lang="${esc(lang)}" dir="${RTL.has(lang) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(zone.label || zone.id)}</title><style>${css()}</style></head>
<body>${pages.join('\n')}</body></html>`;
  }

  // VARIANTS is exported so the UI enumerates the packets it can print instead of hardcoding two
  // strings in a menu — add a third variant here and the caret gains an entry with no UI change.
  return { buildPacket, mapPage, lifePage, christianPage, funnelPage, listPages, pointsPage, wheelPage, css, mapCss, PER_PAGE, W, H, VARIANTS };
}
