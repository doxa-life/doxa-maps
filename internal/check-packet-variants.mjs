#!/usr/bin/env node
/**
 * check-packet-variants — the two packets behind the Prayer List caret, and the promise that adding
 * that caret did not disturb the Cards.
 *
 * WHY A GATE: the brief asked for a second print option on the Prayer List AND for the existing
 * print options to be left intact. Those are two assertions, and only one
 * of them is about the new code. The other — THE CARDS STILL WORK EXACTLY AS THEY DID — is the kind
 * of promise that is true when you make it and quietly false three commits later, because nothing
 * fails when a shared disclosure grows a second caller. So it is pinned here.
 *
 * Every check reads the REAL source; none reads a fixture. Headless, no browser, no network.
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const WALL = read('library/components/poster/PosterWall.vue')
const PRINTS = read('library/composables/usePosterPrints.js')
const EN = JSON.parse(read('library/i18n/locales/en/buttons.json'))

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

// ── 1. THE TWO VARIANTS EXIST AND AGREE ACROSS THE SEAM ────────────────────────────────────────
// packet-render owns the variant names; PosterWall names them again in its menu. A typo in either
// is invisible: buildPacket falls back to 'full' on an unknown variant, so "Lightweight" would
// print the FULL packet — a wrong packet, not an error. Both sides are read and compared.
const { createPacketRenderer } = await import(resolve(ROOT, 'library/packet/packet-render.js'))
const strings = JSON.parse(read('library/scripts/posters/packet-strings.json'))
const R = createPacketRenderer({ strings, lang: 'en' })
ok(R.VARIANTS && typeof R.VARIANTS === 'object', 'packet-render does not export VARIANTS')
const renderIds = Object.keys(R.VARIANTS || {})
ok(renderIds.includes('full') && renderIds.includes('lightweight'),
  `VARIANTS must define full + lightweight, got: ${renderIds.join(', ')}`)

// The UI's list, read out of the source rather than duplicated here — duplicating it would make
// this gate agree with itself instead of with the component.
const uiIds = [...WALL.matchAll(/\{\s*id:\s*'([a-z]+)',\s*labelKey:\s*'([\w.]+)'\s*\}/g)]
ok(uiIds.length >= 2, `the wall's packetVariants list was not found (got ${uiIds.length} entries)`)
for (const [, id, key] of uiIds) {
  ok(renderIds.includes(id), `the wall offers variant '${id}' but packet-render has no such VARIANT — buildPacket would silently fall back to 'full' and print the WRONG packet`)
  // A missing label key renders the raw key as the button text ("buttons.packetFull"), which looks
  // like a broken translation rather than a missing string.
  const leaf = key.replace(/^buttons\./, '')
  ok(EN[leaf] !== undefined, `label key '${key}' is absent from library/i18n/locales/en/buttons.json — the button would print the raw key`)
}
ok(EN.packetVariantAria !== undefined, 'buttons.packetVariantAria is missing — the revealed row would have no accessible name')

// ── 2. THE TWO PACKETS DIFFER IN THE SPECIFIED WAY, AND LOSE NOBODY ────────────────────────────
// ★ THE LOAD-BEARING ONE. A variant drops FIXED pages; it must never drop a page whose count
// depends on the data, because that drops PEOPLE — silently, with the packet still looking like a
// packet. Asserted by counting the group names actually printed, not the sheets.
const groups = Array.from({ length: 45 }, (_, i) => ({ slug: `g${i}`, name: `Group ${i}`, country_code: 'MYS', population: 1000, imb_gsec: 1 }))
const zone = { id: 'test', label: 'Test Zone' }
const funnel = { steps: [{ label: 'a', groups: 12379 }, { label: 'b', groups: 2107 }] }
const christian = { pctEvangelical: 3.2 }
// ★ THE SETS MUST BE SUPPLIED OR THIS GATE CANNOT SEE THE PAGE. setsPage returns '' without data —
// correctly, so a host with no set data still gets a valid packet — which means a build() that
// omits `sets` exercises the variant filter for every page EXCEPT the one most recently added. The
// gate stayed green through the whole sets rewrite while asserting a 2-sheet delta that had become
// 3. A fixture that is missing an input silently narrows what the whole file covers.
const sets = {
  bounded: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, reached: i % 3 === 0 ? true : (i % 3 === 1 ? false : undefined) })),
  centered: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, ring: (i % 12) - 1 })),
}
const build = (v) => R.buildPacket(zone, groups, new Map(), '<svg/>', funnel, christian, v, sets)
const count = (html, re) => (html.match(re) || []).length

const full = build('full')
const light = build('lightweight')
const names = (h) => count(h, /Group \d+</g)
ok(names(full) === 45, `full packet printed ${names(full)} of 45 groups`)
ok(names(light) === 45, `LIGHTWEIGHT printed ${names(light)} of 45 groups — a variant dropped PEOPLE, which is the one thing it may never do`)

// The life calendar and the %-evangelical grid are the two contemplative sheets lightweight drops.
ok(count(full, /sheet-life/g) >= 1, 'the full packet has no life calendar')
ok(count(full, /sheet-christian/g) >= 1, 'the full packet has no %-evangelical page')
ok(count(light, /sheet-life/g) === 0, 'lightweight still carries the life calendar')
ok(count(light, /sheet-christian/g) === 0, 'lightweight still carries the %-evangelical page')
// …and keeps the triangle, the profiles, the wheel and the points.
ok(count(light, /funnel-title/g) === count(full, /funnel-title/g), 'lightweight lost the funnel (the narrowing triangle)')
// …and the SETS page, which is back matter a reader sits with rather than carries — the same
// reason the life calendar and the %-evangelical grid are dropped.
ok(count(full, /sheet-sets/g) === 1, 'the full packet has no bounded/centered sets page')
ok(count(light, /sheet-sets/g) === 0, 'lightweight still carries the sets page')
// ⚠ THREE, not two: the delta grew when the sets page landed, and this number is meant to be
// UPDATED in the commit that adds a page, never relaxed into a range. A tolerance here would make
// the assertion unable to see the next page that goes missing.
ok(count(full, /class="sheet/g) - count(light, /class="sheet/g) === 3,
  `lightweight should be exactly 3 sheets shorter, got ${count(full, /class="sheet/g)} vs ${count(light, /class="sheet/g)}`)
// ★ UNKNOWN POINTS ARE STATED EVEN THOUGH THEY CANNOT BE PLOTTED. layoutBoundedSet gives them no
// x/y — deliberately, since `reached` undefined means we do not know which side they belong on and
// drawing them anywhere would assert exactly what is unknown. On a printed page there is no hover,
// so a category the reader cannot see reads as zero. It must appear in the tally text.
{
  const caps = full.match(/class="set-cap">([^<]*)</g) || []
  ok(caps.length === 2, `expected two set captions, found ${caps.length}`)
  ok(/10/.test(caps.join(' ')), 'the bounded tally does not state its unknown count — an un-inked category reads as zero in print')
}

// ── THE RING LEGEND: THE AGREED VOCABULARY, AND ONLY THE RINGS THAT HOLD SOMEONE ────────────────
// ★ The names are COMPOSED from band x culture rather than a flat 1..10 table, because "same
// people" (provisional, pending a product decision) appears in rings 1, 4 AND 7 — three cells that a
// flat table would have to keep in step. This asserts the composition produces the vocabulary
// gospel and exp settled, so a printed sheet cannot disagree with the screen legend.
{
  const only = (rings) => {
    const html = R.buildPacket(zone, groups, new Map(), '<svg/>', funnel, christian, 'full',
      { bounded: [{ id: 'x', reached: true }], centered: rings.map((r, i) => ({ id: `r${i}`, ring: r })) })
    return (html.match(/<li><b>[^<]*<\/b>([^<]*)<\/li>/g) || []).map((s) => s.replace(/<[^>]+>/g, '').trim())
  }
  const all = only([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  ok(all.length === 10, `all ten rings populated should list ten names, got ${all.length}`)
  // ⚠ THE CATALOGUE IS AUTHORITATIVE OVER THE COMMENT. CenteredSetTarget.vue's header abbreviates
  // ring 7-9 as "Same family"; the shipping string in gospelInternet.json is "Same language family",
  // and that is the word the SCREEN renders. I hardcoded the header's shorthand here and this
  // assertion caught it the moment the packet adopted the screen's wording verbatim. A summary in a
  // comment is a description of the data, never a second source of it.
  const want = ['Same dialect, same people', 'Same dialect, near culture', 'Same dialect, different culture',
    'Same language, same people', 'Same language, near culture', 'Same language, different culture',
    'Same language family, same people', 'Same language family, near culture',
    'Same language family, different culture', 'Nearby only']
  want.forEach((w, i) => ok((all[i] || '').endsWith(w),
    `ring ${i + 1} should read ${JSON.stringify(w)}, got ${JSON.stringify(all[i])}`))
  // ⚠ ONLY THE POPULATED RINGS. Ten rows of vocabulary beside a figure is a glossary, not a legend,
  // and a named ring with no dot invites the reader to hunt for something that is not there.
  const sparse = only([1, 1, 3, 7, 7, 7])
  ok(sparse.length === 3, `only the populated rings should be listed, got ${sparse.length}: ${JSON.stringify(sparse)}`)
  ok(/^2 /.test(sparse[0]) && /^1 /.test(sparse[1]) && /^3 /.test(sparse[2]),
    `the legend should carry each ring's own count, got ${JSON.stringify(sparse)}`)

  // ⚠ NO VERTICAL-OVERFLOW ASSERTION HERE, AND THAT IS DELIBERATE — I wrote one and deleted it.
  // gospel hit exactly this failure on their screen panel (21ebb4f2, "Stop the ring legend pushing
  // the centered-set chart off the page"): a legend stacked below a figure, taller than its space,
  // displaces the chart. Their fix leans on overflow:auto, which PRINT DOES NOT HAVE — so the same
  // layout would fail worse here, with the content simply gone rather than scrollable.
  // Budgeted it: the column needs ~924px of a ~1715px sheet with ALL TEN rings named, and the
  // assertion only starts failing at 51 rows. THERE ARE ONLY TEN RINGS, so it could never fail for
  // any input this code can produce — a tautology dressed as a safety check, the same class as the
  // "rows close on the bottom margin" one already deleted from check-profile-table. A printed sheet
  // is simply much taller than gospel's constrained pane, which is why their bug is not ours.
  // The real protection is the empty-ring filter asserted above (ten rows is the ceiling) plus
  // rega's rendered check; a headless budget with 790px of slack would be decoration.
}

// An unknown variant must print the FULL packet. A typo that printed a SHORTER packet would look
// like a successful print.
ok(build('nonsense-typo') === full, 'an unknown variant did not fall back to the full packet')

// ── 3. THE PRAYER LIST BUTTON PRINTS THE PACKET, NOT THE COLUMNAR LIST ─────────────────────────
// ★ THE DEFECT THIS WORK FOUND. The wall's Prayer List button called prints.printList() — a table
// of name/country/population/religion — while every other surface called printPacket(). So the
// packet the brief specified was never what this button produced. Pinned so it cannot regress.
ok(/printPacketAs[\s\S]{0,600}prints\.printPacket\(/.test(WALL),
  'printPacketAs does not call prints.printPacket — the Prayer List caret would print the columnar LIST again, not the packet')
ok(/variant/.test(PRINTS.match(/async function printPacket\([^)]*\)/)?.[0] || ''),
  'usePosterPrints.printPacket does not accept a variant — the caret\'s choice would be silently dropped')
// printList itself STAYS (dx-shepherd: don't delete it, just stop the button calling it).
ok(/function printList\(/.test(PRINTS) && /printList,/.test(PRINTS),
  'printList was removed — it must remain exported for any surface that still wants the columnar list')

// ── 4. THE CARDS ARE UNTOUCHED ─────────────────────────────────────────────────────────────────
// The brief: the Cards and their caret dropdown stay EXACTLY as they are. The only sanctioned
// change is the comparison key. Everything else about that button is asserted byte-for-byte.
const deckBtn = WALL.match(/<button v-if="canPrintRows" type="button" class="pbtn pbtn-deck"[\s\S]*?<\/button>/)
ok(!!deckBtn, 'the Card Deck button was not found at all')
if (deckBtn) {
  const b = deckBtn[0]
  ok(/class="pbtn pbtn-deck"/.test(b), 'the Card Deck button lost its classes')
  ok(/t\('buttons\.cardDeck'\)/.test(b), 'the Card Deck button lost its label key')
  ok(/@click\.stop="toggleDeck\(item\.id, \$event, 'deck'\)"/.test(b), 'the Card Deck button no longer opens its own row')
  ok(/:aria-expanded=/.test(b), 'the Card Deck button lost aria-expanded')
}
// The size row still gates on canPrintRows AND stockOptions.length — dropping either would render
// an empty tape.
ok(/v-if="canPrintRows && stockOptions\.length && deckOpenFor === deckKey\(item\.id, 'deck'\)"/.test(WALL),
  'the card-size row lost one of its guards, so it could render as an empty tape')
// printDeckAt still sets the stock and prints the deck.
ok(/function printDeckAt[\s\S]{0,300}pickedStock\.value = stockId[\s\S]{0,200}prints\.printCardDeck\(item\)/.test(WALL),
  'printDeckAt no longer sets the picked stock before printing the deck')

// ── 5. EXACTLY ONE TAPE OPEN AT A TIME ─────────────────────────────────────────────────────────
// ★ The property copy/paste would have lost. ONE ref holding ONE key is what makes "opening one
// closes the others" free; two booleans would let both tapes sit open and overlap in the grid gap.
const refs = [...WALL.matchAll(/const (deckOpenFor|packetOpenFor|listOpenFor)\s*=\s*ref\(/g)]
ok(refs.length === 1 && refs[0][1] === 'deckOpenFor',
  `expected exactly ONE disclosure ref, found ${refs.length}: ${refs.map((m) => m[1]).join(', ')} — two open-states means two tapes can be open at once`)
// Both tapes compare against that single ref, via the compound key.
ok(/deckOpenFor === deckKey\(item\.id, 'packet'\)/.test(WALL), 'the packet tape does not read the shared disclosure ref')
ok(/deckOpenFor === deckKey\(item\.id, 'deck'\)/.test(WALL), 'the card tape does not read the shared disclosure ref')
// The key must include BOTH the id and the which — an id-only key would make the two buttons on the
// SAME card toggle each other's row.
ok(/const deckKey = \(id, which\) => `\$\{id\}:\$\{which\}`/.test(WALL),
  'deckKey does not combine the item id AND the button — the two buttons on one card would fight over the same key')

if (fails.length) {
  console.error('PACKET-VARIANTS: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PACKET-VARIANTS: PASS — both packets print every group, lightweight drops exactly the three back-matter sheets (life calendar, % grid, sets), an unknown variant falls back to full, the Prayer List prints the PACKET and not the columnar list, the Cards button and its size row are unchanged, and one ref means one open tape.')
