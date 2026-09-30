#!/usr/bin/env node
// check-poster-degrades-honestly — with NO poster and NO source, say so. Do not
// open a print dialog on nothing.
//
// ★ THE UNCOVERED HALF. check:poster-print-fallback proves the GOOD path: when the
// .webp is missing but posters/<id>.html ships, the browser rasterises it. On a
// tree with neither — which is the DEFAULT drop, since posterSources and
// bundlePosters both default false — that gate SKIPs. So the behaviour a reader is
// most likely to meet was the one behaviour nothing asserted.
//
// The failure this guards against is not a 404. It is a print dialog that OPENS on
// a poster that does not exist: a blank sheet, or worse a low-resolution preview
// thumbnail printed as though it were the 3ft poster. Both look like the feature
// working. An honest refusal — "poster not found (404)" with a Close button — is
// the correct product behaviour and the one BUILD-POSTERS-GENERATE-ON-DEMAND-DROP-52MB
// claims in prose. This turns that claim into an assertion.
//
// ⚠ IT MUST BE RUN AGAINST THE TREE ROOT, NOT public/. A leaf resolves assetsBase
// to '../../assets', which from <tree>/<bundle>/<profile>/ is <tree>/assets. Serving
// public/ instead puts public/assets on that path — a directory that still holds
// 378 posters in a dev checkout — and the poster then loads with a 200, so this gate
// would silently test the opposite of what it claims. Measured 2026-09-24: the same
// click returned 200 under `--directory public` and 404 under
// `--directory public/doxa-maps`. Serve the TREE.
//
// Usage: node internal/check-poster-degrades-honestly.mjs <wallUrl> [zoneId]
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const WALL = process.argv[2] || process.env.POSTER_WALL_URL
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(WALL, ROOT, 'POSTER-DEGRADES-HONESTLY')
if (!WALL) {
  console.log('POSTER-DEGRADES: SKIP — no wall url given.')
  console.log('  Serve the TREE ROOT (public/<name>), not public/, or assetsBase resolves')
  console.log('  outside the tree and the poster loads when it should 404.')
  process.exit(0)
}

// The precondition is the INVERSE of the other gate's: there must be NO poster and
// NO source. If either is reachable this is the wrong tree to be testing.
const probeId = process.argv[3] || 'laos'
const srcUrl = new URL(`../../assets/posters/${probeId}.html`, WALL).href
const imgUrl = new URL(`../../assets/posters/${probeId}.webp`, WALL).href
let reachable = []
for (const [name, u] of [['html', srcUrl], ['webp', imgUrl]]) {
  try { const r = await fetch(u); if (r.ok) reachable.push(name) } catch { /* unreachable is the point */ }
}
if (reachable.length) {
  console.log(`POSTER-DEGRADES: SKIP — this tree DOES serve the poster ${reachable.join(' and ')}.`)
  console.log('  That is the check:poster-print-fallback case. This gate asserts the tree with NEITHER.')
  process.exit(0)
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
let downloads = 0
page.on('download', () => { downloads += 1 })
const posterHits = []
page.on('response', (r) => { if (/\/posters\//.test(r.url())) posterHits.push(`${r.url().split('/').pop()}=${r.status()}`) })

await page.goto(WALL, { waitUntil: 'load', timeout: 45000 })
await page.waitForTimeout(8000)

// Count print frames at creation: openPrintFrame's frame self-removes on afterprint,
// so polling for iframes finds none and would read as a pass for the wrong reason.
let printFrames = 0
await page.exposeFunction('__notePrintFrame', () => { printFrames += 1 })
await page.evaluate(() => {
  const realAppend = Node.prototype.appendChild
  Node.prototype.appendChild = function (n) {
    const r = realAppend.call(this, n)
    try {
      if (n && n.tagName === 'IFRAME') {
        window.__notePrintFrame()
        try { n.contentWindow.print = () => {} } catch { /* cross-realm */ }
      }
    } catch { /* never break the page to observe it */ }
    return r
  }
  window.print = () => {}
})

const clicked = await page.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
    return out
  }
  const all = walk(document)
  // Skip cards that declare themselves unsupported — they short-circuit before any
  // fetch, so they would prove nothing about the missing-poster path.
  for (const card of all.filter((e) => (e.className || '').toString().split(' ').includes('card'))) {
    if (card.querySelector('.ph.is-soon')) continue
    const btn = [...card.querySelectorAll('button')]
      .find((e) => /poster/i.test(e.textContent || '') && !/show on map/i.test(e.textContent || ''))
    if (btn) { btn.click(); return (btn.textContent || '').trim() }
  }
  return null
})

let modal = []
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000)
  modal = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
      return out
    }
    return walk(document)
      .filter((e) => /modal-(kind|title|msg|err|soon)/.test((e.className || '').toString()))
      .map((e) => (e.textContent || '').trim()).filter(Boolean)
  })
  if (modal.some((t) => /not found|unavailable|failed|error/i.test(t))) break
}
await browser.close()

const said = modal.join(' | ')
const fails = []
if (!clicked) fails.push('no poster print control found on any supported card')
// THE LOAD-BEARING ASSERTIONS.
if (printFrames > 0) {
  fails.push(`${printFrames} print frame(s) opened with NO poster and NO source — a print dialog on `
    + 'nothing is a blank sheet, or a preview thumbnail printed as a 3ft poster. Both look like it worked.')
}
if (downloads > 0) fails.push(`${downloads} download(s) started with no poster to deliver`)
if (clicked && !/not found|unavailable|failed|error/i.test(said)) {
  fails.push(`the reader was told nothing: modal read ${JSON.stringify(said) || '(empty)'} — `
    + 'a silent no-op is indistinguishable from a slow one')
}
// Both paths must have been TRIED, or this ran a shorter route than the product does.
if (clicked && !posterHits.some((h) => h.endsWith('=404') && h.includes('.webp'))) {
  fails.push(`the .webp was never requested (poster responses: ${JSON.stringify(posterHits)})`)
}
if (clicked && !posterHits.some((h) => h.includes('.html'))) {
  fails.push(`the .html fallback was never attempted (poster responses: ${JSON.stringify(posterHits)}) — `
    + 'the wall gave up before trying to rasterise')
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log('POSTER-DEGRADES')
console.log(`  wall          : ${WALL}`)
console.log(`  clicked       : ${clicked || '(nothing)'}`)
console.log(`  poster fetches: ${JSON.stringify(posterHits)}`)
console.log(`  print frames  : ${printFrames}   downloads: ${downloads}`)
console.log(`  told the user : ${JSON.stringify(said) || '(nothing)'}`)

if (fails.length) {
  console.error(`\nPOSTER-DEGRADES: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPOSTER-DEGRADES: PASS — with neither poster nor source, both are tried, nothing '
  + 'prints, and the reader is told why.')
