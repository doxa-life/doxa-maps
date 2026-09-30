/**
 * blessPoster.js — the large printed poster engine, first used for "Bless the nations in Jesus' name":
 * every people group (photo, name and a blessing verse) on ONE poster, sized for a print shop.
 *
 * THE DEFAULT IS 5 ft WIDE × 8 ft TALL, printed as THREE 5 × 3 ft sheets stacked top to bottom:
 *   · every sheet has a 6-inch BORDER on its top, left and right;
 *   · the top two sheets' BOTTOM edge is FLAT (trimmed at the shop) and is glued onto the 6-inch top
 *     border of the sheet below, which is a blank GLUE band (marked "glue here");
 *   · the bottom sheet also has a 6-inch bottom border, so the finished poster has a 6-inch border all
 *     the way round. 36 + 30 + 30 = 96 in = 8 ft tall, 60 in = 5 ft wide.
 * Content never straddles a glue line: rows are fitted to each sheet's band.
 *
 * Other presets reuse the same engine (a single sheet with a plain border). The card size and every
 * text size are COMPUTED from the preset and the number of groups, and planPoster() reports the verse
 * point size, so a preset can be judged by whether its verses are readable.
 *
 * Pure: plan maths + an HTML string for the shared in-place print frame (library printInPlace). No Vue.
 */
import { blessingFor, POSTER, THEMES } from './blessings.js'

// Sheet sizes in inches (w × h of ONE printed page), how many stack vertically, and the border.
export const PRESETS = {
  '5x8ft':   { label: '5 × 8 ft', sheetW: 60, sheetH: 36, sheets: 3, border: 6 },
  '3x5ft':   { label: '3 × 5 ft', sheetW: 36, sheetH: 60, sheets: 1, border: 2 },
  '3x3ft':   { label: '3 × 3 ft', sheetW: 36, sheetH: 36, sheets: 1, border: 2 },
  '24x36in': { label: '24 × 36 in', sheetW: 24, sheetH: 36, sheets: 1, border: 1 },
  '18x24in': { label: '18 × 24 in', sheetW: 18, sheetH: 24, sheets: 1, border: 0.75 },
}
export const DEFAULT_PRESET = '5x8ft'
export const MIN_READABLE_PT = 6   // verse size below which a preset is flagged "verses not readable"

const CARD_ASPECT = 0.8      // card width / height: a portrait card (name, photo, verse)
const PT = 1 / 72            // one point in inches

/**
 * The plan for n groups on a preset: per-sheet content bands, the card grid, and the text sizes.
 * Banner + subtitle sit at the top of sheet 1's band; the footer at the bottom of the last sheet's.
 */
export function planPoster(presetId, n) {
  const P = PRESETS[presetId] || PRESETS[DEFAULT_PRESET]
  const b = P.border
  const W = P.sheetW - 2 * b
  // Top of sheet 1: the title + DOXA line, then the prayer-themes table. Bottom of the last sheet: the
  // priestly blessing, the journey from Abraham to the church and the closing line. All scale with the width.
  const headH = W * 0.075, tableH = W * 0.17
  const bannerH = headH + tableH, footerH = W * 0.2
  // Each sheet's content band, in the sheet's own coordinates: y0..y1.
  const bands = []
  for (let s = 0; s < P.sheets; s++) {
    const last = s === P.sheets - 1
    let y0 = b                                   // sheet 1: outer border; the others: the glue band
    let y1 = P.sheetH - (last ? b : 0)           // flat bottom edge, except the last sheet's border
    const top = s === 0 ? bannerH : 0, bottom = last ? footerH : 0
    bands.push({ s, y0: y0 + top, y1: y1 - bottom, bannerY: s === 0 ? y0 : null, footerY: last ? y1 - footerH : null })
  }
  // The largest card (fewest columns) whose grid holds n when rows are fitted to each band.
  let best = null
  for (let cols = 4; cols <= 400 && !best; cols++) {
    const cw = W / cols, ch = cw / CARD_ASPECT
    const rowsPer = bands.map((bd) => Math.max(0, Math.floor((bd.y1 - bd.y0) / ch)))
    if (cols * rowsPer.reduce((a, r) => a + r, 0) >= n) best = { cols, cw, ch, rowsPer }
  }
  const { cols, cw, ch, rowsPer } = best
  // Place cards band by band, row by row.
  const cards = []
  let i = 0
  for (let s = 0; s < bands.length && i < n; s++) {
    for (let r = 0; r < rowsPer[s] && i < n; r++) {
      for (let c = 0; c < cols && i < n; c++, i++) cards.push({ i, s, x: b + c * cw, y: bands[s].y0 + r * ch, w: cw, h: ch })
    }
  }
  // Text sizes from the card: the verse gets ~4 lines of ~26 characters across the card width.
  const versePt = (cw / 12.5) / PT          // character width ≈ 0.5 em, ~24 chars per line
  return {
    preset: P, presetId: PRESETS[presetId] ? presetId : DEFAULT_PRESET, n, cols, rowsPer, cw, ch, bands, cards,
    bannerH, footerH, headH, tableH, contentW: W,
    posterW: P.sheetW, posterH: P.sheetH * P.sheets - (P.sheets - 1) * b,   // after gluing: 60 × 96 for 5x8ft
    text: { versePt: +versePt.toFixed(1), namePt: +(versePt * 1.25).toFixed(1), readable: versePt >= MIN_READABLE_PT },
  }
}

// The closing line under the footer (agent-written); translated via texts.labels.closing when available.
const CLOSING_EN = 'Jesus Christ is the cornerstone, and we are living stones. These people groups are the reward of his suffering. Take up our priestly calling: bless them in his name, and join the global family in prayer.'
// The journey's station names (agent-written); translated via texts.labels.journey_<id> when available.
const JOURNEY_EN = { called: 'Called', promised: 'Promised', redeemed: 'Redeemed', cornerstone: 'The cornerstone', children: 'Children of Abraham', priesthood: 'A royal priesthood', sent: 'Sent to the lost' }
const THEME_EN = { treasure: 'Treasure', mountain: 'Mountain', sea: 'Sea' }
// Three simple line icons for the prayer themes (stroke = currentColor).
const ICONS = {
  treasure: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M8 30h48v24H8z"/><path d="M8 30c0-11 9-17 24-17s24 6 24 17"/><path d="M8 38h48"/><rect x="27.5" y="34" width="9" height="10" rx="1.5"/><path d="M20 16v14M44 16v14"/></svg>',
  mountain: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3 54 24 18l11 18 7-10 19 28z"/><path d="M18 28l6 5 5-5"/></svg>',
  sea: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 24c5-5 10-5 15 0s10 5 15 0 10-5 15 0 10 5 11 2"/><path d="M4 36c5-5 10-5 15 0s10 5 15 0 10-5 15 0 10 5 11 2"/><path d="M4 48c5-5 10-5 15 0s10 5 15 0 10-5 15 0 10 5 11 2"/></svg>',
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * The print document: one page per sheet. groups: [{ name, imageUrl }]. texts: { banner, subtitle,
 * subBanner: {text, ref}, footer: {text, ref}, glueHere } (the wall passes translated UI strings).
 */
export function buildBlessPosterHtml(groups, presetId = DEFAULT_PRESET, texts = {}) {
  const plan = planPoster(presetId, groups.length)
  const P = plan.preset, b = P.border
  const banner = texts.banner || POSTER.banner
  const subtitle = texts.subtitle || ''
  const L = texts.labels || {}
  const lab = (k, en) => L[k] || en
  const dir = texts.dir === 'rtl' ? 'rtl' : 'ltr'
  const upright = /^(zh|ja|ko)/.test(String(texts.lang || ''))   // CJK sidebar labels stand upright
  const glueHere = texts.glueHere || 'glue here'
  const f = (v) => v.toFixed(3) + 'in'
  const vPt = plan.text.versePt, nPt = plan.text.namePt
  const card = (c) => {
    const g = groups[c.i], v = blessingFor(c.i)
    const img = g.imageUrl ? `<img src="${esc(g.imageUrl)}" alt="">` : '<div class="noimg"></div>'
    // Below MIN_READABLE_PT the verse would print as grey noise: that size shows name + photo only.
    const verse = plan.text.readable ? `<div class="vs" dir="auto">${esc(v.text)}</div><div class="rf" dir="auto">${esc(v.ref)}</div>` : ''
    return `<div class="card" style="left:${f(c.x)};top:${f(c.y)};width:${f(c.w)};height:${f(c.h)}">`
      + `<div class="nm" dir="auto">${esc(g.name || '')}</div>${img}${verse}</div>`
  }
  const pages = plan.bands.map((bd) => {
    const s = bd.s, last = s === plan.bands.length - 1
    const glue = s > 0 ? `<div class="glue" style="top:0;height:${f(b)}">${esc(glueHere)} ▲ ${s} / ${P.sheets}</div>` : ''
    // THE STORY, top to bottom: in Jesus' name → three prayer themes (OT + NT) → every people group →
    // the priestly blessing → the calling to bless, Abraham to the church with Christ at its centre →
    // the closing line, at the foundation. Each station's text takes dir="auto": the grid runs right to left
    // in an RTL locale, while an English verse inside it keeps its punctuation at the end. The same holds for
    // every scripture, name and reference on the sheet (cards, chart, blessing, closing).
    const cell = (v) => `<p class="tv" dir="auto">${esc(v.text)}</p><p class="tr" dir="auto">${esc(v.ref)}</p>`
    const table = `<div class="themes" dir="${dir}">`
      + `<div class="rl rl-h"><span>${esc(lab('themesLabel', 'Prayer themes'))}</span></div>`
      + THEMES.map((t) => `<div class="th"><div class="ic">${ICONS[t.id]}</div><div class="tn">${esc(lab('theme_' + t.id, THEME_EN[t.id]))}</div></div>`).join('')
      + `<div class="rl"><span>${esc(lab('oldTestament', 'Old Testament'))}</span></div>`
      + THEMES.map((t) => `<div class="td">${cell(t.ot)}</div>`).join('')
      + `<div class="rl"><span>${esc(lab('newTestament', 'New Testament'))}</span></div>`
      + THEMES.map((t) => `<div class="td">${cell(t.nt)}</div>`).join('')
      + '</div>'
    const head = bd.bannerY != null
      ? `<header class="ban" dir="${dir}" style="top:${f(bd.bannerY)};height:${f(plan.bannerH)}">`
        + `<div class="hd" style="height:${f(plan.headH)}"><h1>${esc(banner)}</h1>`
        + (subtitle ? `<p class="subt">${esc(subtitle)}</p>` : '') + `</div>`
        + `<div style="height:${f(plan.tableH)}">${table}</div></header>` : ''
    const foot = bd.footerY != null
      ? `<footer class="ftr" dir="${dir}" style="top:${f(bd.footerY)};height:${f(plan.footerH)}">`
        + `<div class="bless">${POSTER.blessing.lines.map((l) => `<p dir="auto">${esc(l)}</p>`).join('')}<p class="br" dir="auto">${esc(POSTER.blessing.ref)}</p></div>`
        + `<div class="jny">${POSTER.journey.map((v) => `<div class="st${v.centre ? ' ctr' : ''}"><p class="sn" dir="auto">${esc(lab('journey_' + v.id, JOURNEY_EN[v.id]))}</p><p class="sv" dir="auto">${esc(v.text)}</p><p class="sr" dir="auto">${esc(v.ref)}</p></div>`).join('')}</div>`
        + `<p class="close" dir="auto">${esc(lab('closing', CLOSING_EN))}</p>`
        + `</footer>` : ''
    const trim = !last && P.sheets > 1 ? '<div class="trim"></div>' : ''
    return `<section class="sheet">${glue}${head}${plan.cards.filter((c) => c.s === s).map(card).join('')}${foot}${trim}`
      + `<div class="tag">${s + 1} / ${P.sheets}</div></section>`
  })
  const W = plan.contentW
  const css = `@page{size:${P.sheetW}in ${P.sheetH}in;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;color:#1c1c1c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:${P.sheetW}in;height:${P.sheetH}in;overflow:hidden;page-break-after:always;break-after:page}
.ban{position:absolute;left:${f(b)};width:${f(W)};text-align:center}
.hd{display:flex;flex-direction:column;justify-content:center;align-items:center}
.hd h1{margin:0;font-size:${f(plan.headH * 0.44)};line-height:1.05;font-weight:700}
.hd .subt{margin:${f(plan.headH * 0.06)} auto 0;max-width:78%;font:${f(plan.headH * 0.085)}/1.35 -apple-system,'Segoe UI',Arial,sans-serif;color:#333}
.themes{display:grid;grid-template-columns:${f(W * 0.06)} repeat(3,1fr);grid-template-rows:34% 33% 33%;height:100%;border:.03in solid #1c1c1c;border-radius:${f(W * 0.006)};overflow:hidden}
.themes > div{border:.015in solid #cfcfcf;padding:${f(W * 0.006)} ${f(W * 0.008)};overflow:hidden}
.rl{display:flex;align-items:center;justify-content:center;background:#1c1c1c;color:#fff}
.rl span{writing-mode:vertical-rl;${upright ? 'text-orientation:upright;' : 'transform:rotate(180deg);'}font:700 ${f(W * 0.0105)} -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.th{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${f(W * 0.004)};background:#faf8f2}
.th .ic{width:${f(W * 0.05)};height:${f(W * 0.05)};color:#6b4f1d}.th .ic svg{width:100%;height:100%}
.th .tn{font:700 ${f(W * 0.014)} Georgia,serif;letter-spacing:.04em;text-transform:uppercase}
.td{display:flex;flex-direction:column;justify-content:center;text-align:center}
.td .tv{margin:0;font-size:${f(W * 0.0078)};line-height:1.3;font-style:italic}
.td .tr{margin:${f(W * 0.002)} 0 0;font-size:${f(W * 0.0062)};color:#666}
.ftr{position:absolute;left:${f(b)};width:${f(W)};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-top:.03in solid #1c1c1c}
.bless p{margin:0;font-size:${f(W * 0.0145)};line-height:1.25;font-weight:600}
.bless .br{font-size:${f(W * 0.0075)};font-weight:400;color:#666;margin-top:${f(W * 0.002)}}
.jny{display:grid;grid-template-columns:repeat(7,1fr);gap:${f(W * 0.006)};margin-top:${f(W * 0.01)};width:100%;align-items:stretch}
.st{display:flex;flex-direction:column;justify-content:center;padding:${f(W * 0.003)} ${f(W * 0.004)};border-top:.02in solid #c9b58a}
.st .sn{margin:0 0 ${f(W * 0.002)};font:700 ${f(W * 0.0062)} Georgia,serif;letter-spacing:.05em;text-transform:uppercase;color:#6b4f1d}
.st .sv{margin:0;font-size:${f(W * 0.0056)};font-style:italic;line-height:1.3}
.st .sr{margin:${f(W * 0.002)} 0 0;font-size:${f(W * 0.0048)};color:#666}
.st.ctr{background:#faf8f2;border:.03in solid #1c1c1c}.st.ctr .sv{font-size:${f(W * 0.0064)};font-weight:600}.st.ctr .sn{color:#1c1c1c}
.close{margin:${f(W * 0.008)} auto 0;max-width:80%;font:700 ${f(W * 0.0085)}/1.35 -apple-system,'Segoe UI',Arial,sans-serif}
.card{position:absolute;padding:${f(plan.cw * 0.035)};display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}
.card .nm{font:700 ${nPt}pt/1.1 -apple-system,'Segoe UI',Arial,sans-serif;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
.card img,.card .noimg{width:100%;height:${plan.text.readable ? 52 : 78}%;object-fit:cover;margin:${f(plan.cw * 0.02)} 0;background:#eee;flex:none}
.card .vs{font-size:${vPt}pt;line-height:1.15;font-style:italic}
.card .rf{font-size:${(vPt * 0.8).toFixed(1)}pt;color:#777;margin-top:1pt}
.glue{position:absolute;left:0;width:100%;border-bottom:.02in dashed #b00;display:flex;align-items:center;justify-content:center;font:700 ${f(Math.min(0.5, b * 0.08))} sans-serif;color:#b00;background:rgba(176,0,0,.035);letter-spacing:.05em;text-transform:uppercase}
.trim{position:absolute;left:0;bottom:0;width:100%;border-bottom:.02in solid #999}
.tag{position:absolute;right:${f(Math.max(0.15, b * 0.1))};top:${f(Math.max(0.1, b * 0.08))};font:600 ${f(Math.max(0.12, b * 0.035))} sans-serif;color:#aaa}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(banner)}</title><style>${css}</style></head><body>${pages.join('')}</body></html>`
}
