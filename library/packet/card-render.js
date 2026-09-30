// card-render.js — THE prayer-card deck renderer, shared by every caller.
//
// ★ THE POINT OF THIS FILE: A DECK PRINTS AS CARDS, NOT AS PAPER.
// The previous deck set `@page{size:letter portrait}` and gave each card
// `height:100%`, so one card was stretched across a whole 8.5x11 sheet — 95
// mostly-empty letter pages, with no photo. The Driver: "the print dialog that
// opens up needs to show all the cards not in a paper format but a CARD format,
// the aspect ratio that is used in the card generator."
//
// So the page IS the card: @page takes the card's own dimensions, and every card
// fills exactly one page. Print two-sided on cardstock and cut, or print to PDF
// and send to a card printer.
//
// ⚠ @page size MUST be given in explicit units. MEASURED: `size: A6 portrait`
// SILENTLY falls back to letter in Chromium (612x792pt) with no error, while
// `size: 2.5in 3.5in` yields exactly 180x252pt. Named sizes beyond letter/A4 are
// not reliable — always use explicit inches, and always ASSERT the measured
// MediaBox rather than trusting the CSS.
//
// The card content follows doxa-life/promotional-material-generation, which is a
// data pipeline feeding an InDesign template: per language it emits Description,
// Religion, Area, Country, a QR code and a URL. Description and Area are NOT
// available from this API (measured: 0 of 2107 records carry either), so the card
// is built from what genuinely exists — portrait, name, country, population,
// language, religion (with its explanatory sentence) and the QR back to the live
// profile. An empty block reserved for data that never arrives is worse than a
// card designed around the data there is.
//
// I18N: every string comes from the caller's strings object, per-key fallback to
// English, same contract as the packet. The QR encodes the LOCALISED URL, so a
// Spanish card scans to the Spanish page.

import { qrSvg } from './qr.js';

// ── CARD STOCK ──────────────────────────────────────────────────────────────
// Poker-size trading card (2.5 x 3.5in) — the format commercial card printers,
// sleeves and boxes are built around, and the one people already associate with a
// deck you hold and deal out. Bleed is included in the page so a trimmed card
// keeps its full-bleed portrait.
// ★ LANDSCAPE IS NOT JUST TRANSPOSED DIMENSIONS. The portrait card stacks the
// photo ABOVE the text (portrait occupies the top 46%); at 3.5 x 2.5in that same
// band is a strip too short to carry a face or leave room for the rows beneath it.
// A landscape card puts the photo BESIDE the text instead — so `side: true` is a
// LAYOUT switch the CSS reads, not a cosmetic flag.
export const STOCK = {
  poker: { w: 2.5, h: 3.5, label: 'Card 2.5 × 3.5 in' },
  pokerLandscape: { w: 3.5, h: 2.5, label: 'Card 3.5 × 2.5 in (landscape)', side: true },
  postcard: { w: 4, h: 6, label: 'Postcard 4 × 6 in' },
  postcardLandscape: { w: 6, h: 4, label: 'Postcard 6 × 4 in (landscape)', side: true },
  a6: { w: 4.13, h: 5.83, label: 'A6 105 × 148 mm' },     // explicit in, NOT "A6"
};

const PX = 96;                        // CSS px per inch

export function createCardRenderer({ strings, lang = 'en', stock = 'poker',
  siteBase = 'https://pray.doxa.life' } = {}) {
  const EN = strings.en;
  const L = strings[lang] || {};
  const t = (k) => (L[k] !== undefined ? L[k] : EN[k]);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // ⚠ PREFER THE LABEL, AND KNOW WHERE IT LIVES.
  // The API sends { value, label } dicts, but records reach this renderer AFTER
  // normalizeRecords(), which flattens each field to its `.value` and parks the
  // human-readable text under `<field>_label`. Reading the field alone therefore
  // yields "LAO", "thm", "EAN" — codes, on a card a person is meant to pray from.
  // Measured: the first deck shipped exactly that, and a gate counting "4 rows
  // rendered" passed it, because the rows were present, just unreadable.
  // Handles all three shapes: an un-normalized dict, a normalized value+label
  // pair, and a plain string.
  const label = (g, key) => {
    const lab = g[`${key}_label`];
    if (lab) return String(lab);
    const v = g[key];
    if (v && typeof v === 'object') return String(v.label ?? v.value ?? '');
    return v == null ? '' : String(v);
  };
  const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString(lang) : '—');

  const S = STOCK[stock] || STOCK.poker;
  const W = Math.round(S.w * PX);      // card box in CSS px
  const H = Math.round(S.h * PX);
  // Photo BESIDE the text rather than above it. Driven by the stock, not by
  // comparing W to H: a square stock would be ambiguous, and the choice is a
  // deliberate property of the format rather than an inference from its numbers.
  const SIDE = S.side === true;

  // The live profile URL for this group, in this language. English has no prefix
  // (the generator's own rule); every other language does.
  const profileUrl = (slug) => (lang === 'en'
    ? `${siteBase}/${slug}`
    : `${siteBase}/${lang}/${slug}`);

  function css() {
    return `
  /* THE PAGE IS THE CARD. Explicit inches — a named size silently falls back to
     letter in Chromium, which is exactly the bug this renderer exists to fix. */
  @page{size:${S.w}in ${S.h}in;margin:0}
  html,body{margin:0;padding:0;background:#6f6f6f;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .card{position:relative;width:${W}px;height:${H}px;overflow:hidden;
    background:#f7f4ec;color:#1b1a17;
    font-family:Georgia,'Palatino Linotype',serif;
    page-break-after:always;break-after:page}
  .card:last-child{page-break-after:auto;break-after:auto}

  /* THE PHOTO. Portrait: full-bleed across the TOP, the largest thing on the card
     by design — a face is what makes this a prayer card rather than a data tile.
     Landscape: full-bleed down the LEFT instead, because a 46% band on a 2.5in-tall
     card is a strip too short to carry a face AND leave room for the rows. */
  .ph,.ph-none{position:absolute;left:0;top:0;display:block;
    width:${SIDE ? Math.round(W * 0.42) : W}px;
    height:${SIDE ? H : Math.round(H * 0.46)}px}
  .ph{object-fit:cover;background:#ddd6c6}
  .ph-none{background:linear-gradient(160deg,#e6dfcd,#cfc6ad);display:flex;
    align-items:center;justify-content:center;text-align:center;padding:6px;
    font:italic 11px Georgia,serif;color:#8c8170}

  /* A soft scrim under the name so it stays legible over any photo. */
  .scrim{position:absolute;left:0;
    width:${SIDE ? Math.round(W * 0.42) : W}px;
    top:${SIDE ? Math.round(H * 0.58) : Math.round(H * 0.30)}px;
    height:${SIDE ? Math.round(H * 0.42) : Math.round(H * 0.16)}px;
    background:linear-gradient(to bottom,rgba(24,22,18,0),rgba(24,22,18,.72))}
  .nm{position:absolute;
    left:${SIDE ? 10 : 14}px;
    ${SIDE ? `width:${Math.round(W * 0.42) - 20}px;` : `right:14px;`}
    top:${SIDE ? Math.round(H * 0.74) : Math.round(H * 0.355)}px;
    font:700 ${SIDE ? 15 : 19}px Georgia,serif;color:#fff;line-height:1.05;
    text-shadow:0 1px 3px rgba(0,0,0,.5)}
  .nm.long{font-size:${SIDE ? 12 : 15}px}

  .body{position:absolute;right:14px;overflow:hidden;
    left:${SIDE ? Math.round(W * 0.42) + 12 : 14}px;
    top:${SIDE ? 12 : Math.round(H * 0.48)}px;
    bottom:${SIDE ? Math.round(H * 0.30) : Math.round(H * 0.20)}px}
  .row{display:flex;gap:6px;font:400 9.5px Georgia,serif;line-height:1.5;margin-bottom:1px}
  .k{color:#8c8170;min-width:52px;flex:0 0 auto}
  .v{color:#3b3a34;font-weight:600}
  .rel{margin-top:5px;font:italic 8.5px Georgia,serif;color:#6d665a;line-height:1.35}

  /* FOOTER: the QR is the card's whole reason to survive the day it is handed
     over — it carries the reader to the live profile in their own language. */
  .ft{position:absolute;right:14px;bottom:10px;
    left:${SIDE ? Math.round(W * 0.42) + 12 : 14}px;
    display:flex;align-items:flex-end;gap:8px}
  .qr{flex:0 0 auto;line-height:0}
  .ftx{flex:1 1 auto;min-width:0}
  .cta{font:600 8px Georgia,serif;color:#7a3b2e;letter-spacing:.04em;
    text-transform:uppercase}
  .url{font:400 7px Georgia,serif;color:#a89f8c;word-break:break-all;margin-top:1px}
  .brand{position:absolute;right:14px;bottom:10px;
    font:400 7px Georgia,serif;color:#b9ae99;text-align:right}`;
  }

  // One card = one page.
  function card(g) {
    const name = String(g.name || g.slug || '');
    const photo = g.image_url
      ? `<img class="ph" src="${esc(g.image_url)}" alt="">`
      : `<div class="ph-none">${esc(t('no_photo'))}</div>`;
    // The religion's explanatory sentence, when the caller kept it. normalizeRecords()
    // keeps only { value, label } and DROPS `description`, so this is present only
    // when a caller passes records straight from the API. Absent is normal, not a bug —
    // the card simply gives that space back to the rows.
    const relDesc = (g.religion && typeof g.religion === 'object' && g.religion.description)
      || g.religion_description || '';
    const relHtml = relDesc
      ? `<div class="rel">${esc(String(relDesc).slice(0, 170))}</div>` : '';
    const url = profileUrl(g.slug);
    const rows = [
      [t('card_country'), label(g, 'country_code')],
      [t('card_population'), `${num(g.population)} ${t('people_suffix')}`],
      [t('card_language'), label(g, 'primary_language')],
      [t('card_religion'), label(g, 'religion')],
    ].filter(([, v]) => v && String(v).trim() && String(v) !== '—')
      .map(([k, v]) => `<div class="row"><div class="k">${esc(k)}</div>`
        + `<div class="v">${esc(v)}</div></div>`).join('');

    return `<div class="card">${photo}<div class="scrim"></div>`
      + `<div class="nm${name.length > 16 ? ' long' : ''}">${esc(name)}</div>`
      + `<div class="body">${rows}${relHtml}</div>`
      + `<div class="ft"><div class="qr">${qrSvg(url, { size: 54, margin: 1 })}</div>`
      + `<div class="ftx"><div class="cta">${esc(t('card_cta'))}</div>`
      + `<div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div></div></div>`
      + `</div>`;
  }

  function buildDeck(zone, groups) {
    const cards = groups.map(card).join('');
    return `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<title>${esc(zone.label || zone.id)} — ${esc(t('deck_title'))}</title>
<style>${css()}</style></head><body>${cards}</body></html>`;
  }

  return { buildDeck, card, css, profileUrl, W, H, stock: S };
}
