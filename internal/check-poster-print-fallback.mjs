#!/usr/bin/env node
// check-poster-print-fallback — the PRINT preview must survive a missing .webp.
//
// ★ THE ASYMMETRY THIS GUARDS. posters/*.webp is not shipped by default (42MB;
// bundling it pushed the tree to 80MB, git-packed to 57MiB, and the catalog
// rejected the push outright). The DOWNLOAD path has always handled that —
// PosterWall.vue fetches posters/<id>.html and rasterises it in the browser. The
// PRINT path did not: it handed an <img> a url it never checked, so on a default
// drop the SAME poster downloaded fine and printed as "Poster not available yet."
//
// Two paths, one missing file, different outcomes — and the difference was
// invisible to every existing gate, because check:poster-raster drives the
// RENDERER directly and never goes near the print button.
//
// ⚠ IT INTERCEPTS THE PRINTED HTML rather than reading the frame back.
// openPrintFrame calls window.print(), which BLOCKS in headless Chromium, and the
// frame self-removes on afterprint — reading it back measures a frame that has
// already gone. Same technique as check-deck-click.
//
// ⚠ IT FORCES THE MISS. The dev tree may or may not have the .webp; a gate whose
// result depends on that is measuring the fixture, not the product. So every
// request for posters/<id>.webp is failed at the network layer, which is exactly
// the default-drop condition, and the .html is left reachable.
//
// Usage: node internal/check-poster-print-fallback.mjs <wallUrl> [zoneId]
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

// SKIP, never fail, when the preconditions are absent. This gate needs a SERVED tree
// that carries posters/<id>.html (posterSources:true or bundlePosters:true). The
// default tree ships neither, and a clean checkout has no server at all — failing the
// build on that would only teach people to disable the gate. It says what is missing.
const WALL = process.argv[2] || process.env.POSTER_WALL_URL
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(WALL, ROOT, 'POSTER-PRINT-FALLBACK')
if (!WALL) {
  console.log('POSTER-PRINT-FALLBACK: SKIP — no wall url given.')
  console.log('  Pass one, or set POSTER_WALL_URL. Needs a tree built with posterSources:true')
  console.log('  and a server: `node library/scripts/posters/publish-html.mjs && bun run tree`.')
  process.exit(0)
}

// The poster SOURCE must be reachable before any of this means anything. Without it
// the fallback has nothing to rasterise and every assertion below would report a
// product bug that is really a missing fixture.
const probeId = process.argv[3] || 'laos'
// ⚠ '../../assets', NOT '../assets'. A leaf page lives at
// <tree>/<bundle>/<profile>/index.html and resolves assetsBase to '../../assets' —
// two levels up, to the TREE root. Measured 2026-09-24: this probe used one level,
// so it 404'd on a tree that DID carry the sources and this gate SKIPped with
// "posterSources:true was not set" when it had been. A precondition check that is
// wrong about the precondition silently turns the whole gate off.
const srcUrl = new URL(`../../assets/posters/${probeId}.html`, WALL).href
try {
  const r = await fetch(srcUrl)
  if (!r.ok) {
    console.log(`POSTER-PRINT-FALLBACK: SKIP — ${srcUrl} is ${r.status}.`)
    console.log('  The tree was not built with posterSources:true, so there is no poster source to rasterise.')
    process.exit(0)
  }
} catch {
  console.log(`POSTER-PRINT-FALLBACK: SKIP — cannot reach ${srcUrl} (no server?).`)
  process.exit(0)
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))

// THE DEFAULT-DROP CONDITION, forced: the print-resolution image is absent, its
// HTML source is not. Anything else would leave the gate at the mercy of whether
// this particular checkout happens to carry 42MB of posters.
let webpBlocked = 0
let htmlServed = 0
await page.route('**/posters/*.webp', (route) => { webpBlocked += 1; route.abort() })
await page.route('**/posters/*.html', (route) => { htmlServed += 1; route.continue() })

await page.goto(WALL, { waitUntil: 'load', timeout: 45000 })
await page.waitForTimeout(8000)

// Capture what reaches the print frame instead of letting it print-and-vanish.
// ⚠ ASSERT THE HUD, NOT doc.write. Three separate attempts to intercept the printed
// document all captured nothing while the feature DEMONSTRABLY worked (the HUD ran
// "generating the poster" and finished clean): openPrintFrame writes into the iframe's
// OWN realm, calls doc.open() AFTER append — which resets the document and discards a
// patched write — and the frame self-removes on afterprint. A capture that silently
// misses reports a product bug that is not there.
// The HUD is the better assertion anyway: it is what a USER sees, it survives a
// refactor of the print internals, and it distinguishes the three outcomes that
// matter — rasterised / shipped-image / failed — which is exactly what this gate is for.
await page.evaluate(() => {
  window.__HUD = []
  window.print = () => {}
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
    return out
  }
  window.__readHud = () => walk(document)
    .filter((e) => e.childElementCount === 0 && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE')
    .map((e) => (e.textContent || '').trim())
    .filter((t) => t && /generating|preparing|saving|not available|failed|blank|error/i.test(t))
  setInterval(() => { for (const t of window.__readHud()) if (!window.__HUD.includes(t)) window.__HUD.push(t) }, 120)
})

// Click the REAL print control, found by its accessible name through every shadow root.
const clicked = await page.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) {
      out.push(el)
      if (el.shadowRoot) walk(el.shadowRoot, out)
    }
    return out
  }
  const all = walk(document)
  const btn = all.find((el) => {
    if (!(el instanceof HTMLElement)) return false
    if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`
    // ⚠ THE CONTROL IS NOT LABELLED "print". It reads "UPG prayer poster" — the
    // product names the ARTEFACT, not the action. A /print/i matcher finds nothing
    // and this gate then reports "nothing reached the print frame", which reads as a
    // product bug and is purely the selector. Measured 2026-09-24: the .webp and
    // .html request counters even LOOKED corroborating, because the wall loads both
    // on its own. Match the poster control, and exclude its siblings by name.
    return /poster/i.test(label) && !/list|deck|packet|show on map/i.test(label)
  })
  if (!btn) {
    return { ok: false, labels: all.filter((e) => e.tagName === 'BUTTON')
      .map((e) => (e.getAttribute('title') || e.textContent || '').trim().slice(0, 30)).filter(Boolean).slice(0, 14) }
  }
  btn.click()
  return { ok: true }
})

let hud = []
let settled = false
if (clicked.ok) {
  // Rasterising a 3000px poster takes real time; poll for the terminal state rather
  // than guessing one timeout.
  for (let i = 0; i < 45 && !settled; i++) {
    await page.waitForTimeout(1000)
    hud = await page.evaluate(() => window.__HUD || [])
    // Terminal states: an explicit failure, or "generating" seen AND no longer showing.
    const live = await page.evaluate(() => window.__readHud())
    const failing = hud.some((t) => /not available|failed|blank|error/i.test(t))
    const generated = hud.some((t) => /generating/i.test(t))
    if (failing) { settled = true; break }
    if (generated && !live.some((t) => /generating|preparing|saving/i.test(t))) { settled = true }
  }
}
await browser.close()

const fails = []
if (!clicked.ok) {
  fails.push(`no poster print control found in any shadow root (buttons seen: ${(clicked.labels || []).join(' | ')})`)
}
if (clicked.ok && !hud.length) {
  fails.push('the poster control was clicked but the export HUD never reported anything — '
    + 'the click did not reach printPoster at all')
}
// THE LOAD-BEARING ASSERTIONS.
if (hud.some((t) => /Poster not available yet/i.test(t))) {
  fails.push('the print preview opened on "Poster not available yet" — the old behaviour: '
    + 'the .webp 404ed and the rasterise fallback did not run')
}
if (hud.some((t) => /not available|failed|blank|error/i.test(t))) {
  fails.push(`the print path ended in an error state: ${JSON.stringify(hud.filter((t) => /not available|failed|blank|error/i.test(t)))}`)
}
// With EVERY .webp aborted, a clean run is only possible via the rasteriser — so the
// "generating the poster" phase MUST have been entered. Its absence means the preview
// came from somewhere this gate did not intend, and proves nothing about the fallback.
if (clicked.ok && !hud.some((t) => /generating/i.test(t))) {
  fails.push(`the fallback never entered its "generating the poster" phase (HUD: ${JSON.stringify(hud)}) — `
    + 'with every .webp aborted there is no other way to a working preview, so this did not exercise the fallback')
}
if (clicked.ok && !settled) {
  fails.push('the print path never reached a terminal state within 45s')
}
if (webpBlocked === 0) {
  fails.push('no posters/*.webp request was made at all — the print path never probed the '
    + 'image, so this gate did not exercise the fallback it exists to test')
}
if (htmlServed === 0) {
  fails.push('no posters/*.html was fetched — the rasterise fallback never ran')
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log('POSTER-PRINT-FALLBACK')
console.log(`  wall            : ${WALL}`)
console.log(`  .webp requests  : ${webpBlocked} (all aborted — the default-drop condition)`)
console.log(`  .html requests  : ${htmlServed}`)
console.log(`  print button    : ${clicked.ok ? 'found and clicked' : 'NOT FOUND'}`)
console.log(`  HUD             : ${hud.length ? JSON.stringify(hud) : '(nothing)'}`)

if (fails.length) {
  console.error(`\nPOSTER-PRINT-FALLBACK: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nPOSTER-PRINT-FALLBACK: PASS — with every .webp missing, the print preview still '
  + 'opens on a real rasterised poster instead of "Poster not available yet".')
