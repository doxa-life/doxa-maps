#!/usr/bin/env node
/**
 * set-app-start-page — the MOBILE APP opens the UPG-100 list, not the plugin studio.
 *
 * THE DEFECT, reported by repo: the Capacitor app launches public/index.html, which mounts
 * <plugin-studio>. A recipient opening the phone app meets the DEV STUDIO rather than the map the
 * README promises. RULED (Kingdom-agent, card DECISION-MOBILE-EXAMPLE-IS-UPG100-NOT-SIMPLE-
 * RESEARCH): the ONE mobile-app showcase is the UPG-100 list.
 *
 * ⚠ THE CARD'S OWN BLUF SAYS "Simple Research" AND IS STALE. It predates that ruling, which is
 * recorded as DONE in the same backlog and says Simple Research "was never mobile-friendly".
 * Building to the card's wording would ship the app the ruling rejected.
 *
 * ★ WHY THIS RUNS AFTER `cap sync` AND WRITES ONLY INTO THE ANDROID ASSETS.
 * public/index.html has THREE consumers (capacitor.config.json documents them): Railway/CDN,
 * Capacitor, and local staging. The studio is CORRECT for the CDN root and for `bun run serve` —
 * only the phone build wants a different landing page. Rewriting the shared root would fix the app
 * by breaking the other two. `cap sync` copies webDir into
 * deployment/capacitor/android/app/src/main/assets/public/, so overwriting the COPY changes what
 * the app opens and leaves the served tree untouched.
 *
 * ★ WHY IT COPIES THE BUILT LEAF RATHER THAN HAND-WRITING A HOST PAGE.
 * The leaf carries an SRI integrity hash for its bundle. A hand-written page needs its own correct
 * hash, and a stale one makes the browser REFUSE the script with no console error at all: the
 * element never upgrades and the app shows a blank screen. Copying the artifact the build already
 * verified means there is no second copy of that hash to drift. Only the relative depth changes.
 *
 * Usage: node internal/set-app-start-page.mjs [--check]
 *   --check  assert the app root is already the UPG-100 page; do not write. Exit 1 if not.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

// The assets tree `cap sync` writes. NOT public/ — see the header.
const APP_PUBLIC = join(ROOT, 'deployment/capacitor/android/app/src/main/assets/public')
const APP_ROOT = join(APP_PUBLIC, 'index.html')
// The showcase leaf, inside the served tree.
const TREE = TREE_NAME
const LEAF_REL = `my-upg-100-list/upg-100-mfe/index.html`   // the app's web root IS the tree (webDir public/<tree>)
const LEAF = join(APP_PUBLIC, LEAF_REL)

// A marker so --check can tell the app page apart from the studio page without parsing HTML.
const MARKER = `<!-- ${TREE_NAME}: mobile app start page (UPG-100 list) -->`

if (!existsSync(APP_PUBLIC)) {
  console.log('APP-START-PAGE: SKIP — no synced assets tree.')
  console.log('  Run `bun run cap:sync` first; this rewrites what that step copied.')
  process.exit(0)
}
if (!existsSync(LEAF)) {
  console.error(`APP-START-PAGE: FAIL — the showcase leaf is missing from the synced tree:`)
  console.error(`  ${LEAF_REL}`)
  console.error('  The app would launch a 404. Build the tree and re-run cap:sync.')
  process.exit(1)
}

if (CHECK) {
  const cur = existsSync(APP_ROOT) ? readFileSync(APP_ROOT, 'utf8') : ''
  if (cur.includes(MARKER)) {
    console.log('APP-START-PAGE: PASS — the app opens the UPG-100 list.')
    process.exit(0)
  }
  console.error('APP-START-PAGE: FAIL — the app root is NOT the UPG-100 page.')
  console.error(cur.includes('<plugin-studio')
    ? '  It mounts <plugin-studio>: a recipient opening the app meets the dev studio.'
    : '  No UPG-100 marker found.')
  console.error('  Fix: node internal/set-app-start-page.mjs (after cap:sync).')
  process.exit(1)
}

// ── REWRITE THE LEAF FOR ONE LEVEL UP ────────────────────────────────────────
// The leaf lives at <tree>/my-upg-100-list/upg-100-mfe/index.html and reaches its bundle with
// `../my-upg-100-list.js`. At the app root that same relative path resolves ABOVE the web root.
// Every leaf-relative reference gains the leaf's own directory prefix; absolute and protocol URLs
// (the Mapbox CDN tags) are left alone.
const LEAF_DIR = `my-upg-100-list/upg-100-mfe/`
const html = readFileSync(LEAF, 'utf8')
const rebased = html.replace(
  /\b(src|href)=(["'])(?!https?:|data:|#|\/)([^"']+)\2/g,
  (_m, attr, q, url) => {
    // Resolve the leaf-relative url against the leaf's directory, from the web root.
    const abs = new URL(url, `http://x/${LEAF_DIR}`).pathname.replace(/^\//, '')
    return `${attr}=${q}${abs}${q}`
  },
)
if (rebased === html) {
  console.error('APP-START-PAGE: FAIL — rewrote nothing, so the paths were not what this expects.')
  console.error('  Refusing to install a page whose bundle path would 404 at the app root.')
  process.exit(1)
}

// Prove the rewrite points at files that EXIST, rather than trusting the regex. A start page
// whose bundle 404s is a blank white screen with no error, which is the failure mode this whole
// script exists to prevent.
const referenced = [...rebased.matchAll(/\b(?:src|href)=["']([^"':]+)["']/g)].map((m) => m[1])
const missing = referenced.filter((r) => !r.startsWith('data:') && !existsSync(join(APP_PUBLIC, r)))
if (missing.length) {
  console.error('APP-START-PAGE: FAIL — the rewritten page references files that are not there:')
  for (const m of missing) console.error(`  ${m}`)
  process.exit(1)
}

// Keep the studio page reachable rather than deleting it: a developer with the apk still wants it.
const STUDIO_KEEP = join(APP_PUBLIC, 'studio.html')
if (existsSync(APP_ROOT) && !existsSync(STUDIO_KEEP)) copyFileSync(APP_ROOT, STUDIO_KEEP)

writeFileSync(APP_ROOT, rebased.replace(/<head>/i, `<head>\n  ${MARKER}`))
console.log('APP-START-PAGE: the app now opens the UPG-100 list.')
console.log(`  from   ${LEAF_REL}`)
console.log(`  wrote  assets/public/index.html  (${referenced.length} reference(s) rebased, all present)`)
console.log('  the studio page is kept at assets/public/studio.html')
