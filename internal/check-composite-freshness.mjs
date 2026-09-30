#!/usr/bin/env node
/**
 * check-composite-freshness.mjs — catch a COMPOSITE that shipped a STALE copy of a child.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, 2026-09-21)
 * A fix landed in `people-groups-grid`; that ONE bundle was rebuilt, verified locally AND
 * live in a fresh context, and published. All true — and insufficient. `big-picture` (cap-4,
 * tab-1 of the cap-5 SPA) and `dashboard-plus-grid` NEST that grid and COMPILE IT IN, so both
 * kept shipping the PRE-FIX code. The surface that was proved is not the surface anyone opens.
 * ★ A COMPOSITE IS A COPY TAKEN AT ITS OWN BUILD TIME, NOT A POINTER TO ITS CHILD.
 *
 * ★ WHY IT NOW REBUILDS AND COMPARES BYTES, NOT MTIMES (2026-09-25). The first version compared
 *   the newest child SOURCE mtime with the parent BUNDLE mtime. File times are not build facts:
 *   a git merge or checkout rewrites sources with checkout-time mtimes, so rega's publish of
 *   beb13da3 stopped on "doxa-maps-spa / plugin-studio / stack-demo STALE vs gospel-resources /
 *   research-dashboard" although a rebuild reproduced the committed bytes exactly — and two of
 *   those parents mount their children BY TAG at runtime, so they compile none of the child in
 *   and CANNOT be stale with respect to it. It was also gameable the other way: checking out the
 *   parents makes their mtimes new and the gate passes on stale code.
 *   The question is "does the committed bundle equal what its source builds TODAY?", so that is
 *   what is asked: each composite is rebuilt into a temp dir (vite.config.js DOXA_OUT_ROOT — never
 *   public/) and its sha256 compared with the committed bundle. Builds are deterministic (two runs
 *   → identical bytes, verified), so a difference is real: the committed parent predates a source
 *   change it compiles in — its own, or a child's. A child it only mounts by tag cannot move it.
 *
 * HOW IT WORKS
 *   1. every plugin-designs/<b>/<b>.meta.json with `composes: [...]` is a composite parent (entries
 *      are still resolved and an unresolvable one is REPORTED — an unresolved edge is an unchecked
 *      edge);
 *   2. BUNDLE=<parent> DOXA_OUT_ROOT=<tmp> vite build, then sha256(tmp) vs sha256(public/…/<b>.js);
 *   3. differ ⇒ STALE (FAIL); no committed bundle ⇒ reported, not built ⇒ FAIL.
 * Usage: node internal/check-composite-freshness.mjs [--only a,b]      (~5-15 s per composite)
 *
 * NEGATIVE-TESTED 2026-09-25: an edit to people-groups-grid.vue with no rebuild fails the
 * composites that compile it in; `touch` on every child source (no content change) still PASSES on
 * a fresh tree — the mtime false alarm is gone.
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { isWebBuilt } from './plugin-targets.mjs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGNS = join(ROOT, 'plugin-designs')
const TREE = join(ROOT, 'public', TREE_NAME)
const argv = process.argv.slice(2)
const oi = argv.indexOf('--only')
const ONLY = oi >= 0 && argv[oi + 1] ? new Set(argv[oi + 1].split(',')) : null
// NOT ONLY COMPOSITES (rega, 2026-09-25): a library change merged into main reached prayer-walk-planner,
// which composes nothing, so this gate could not see it was stale. --all checks EVERY bundle; --bundles a,b
// checks those (the landing precondition passes the ones a landing can have changed).
const ALL = argv.includes('--all')
const bi = argv.indexOf('--bundles')
const EXTRA = bi >= 0 && argv[bi + 1] ? new Set(argv[bi + 1].split(',').filter(Boolean)) : new Set()

if (!existsSync(join(TREE, 'manifest.json'))) {
  console.log(`COMPOSITE-FRESHNESS: SKIP — no built tree (public/${TREE_NAME}/manifest.json).`)
  process.exit(0)
}
const manifest = JSON.parse(readFileSync(join(TREE, 'manifest.json'), 'utf8'))
// tag -> owning bundle, so a composes entry naming an ELEMENT still resolves.
const byTag = new Map()
for (const b of manifest.bundles || []) for (const t of b.elements || []) byTag.set(t, b.bundle)
// A plugin that is not built into the web tree (plugin-targets.mjs: targets without "web") has no committed
// bundle by design, so it is not held to one.
const bundles = new Set(readdirSync(DESIGNS).filter((d) => existsSync(join(DESIGNS, d, 'index.js')) && isWebBuilt(join(DESIGNS, d))))
// A bare PROFILE name of the same bundle (gospel-resources composes "resources-map", "data-tables" —
// its own sibling profiles) resolves to that bundle, as the studio resolves it.
const profilesOf = new Map((manifest.bundles || []).map((b) => [b.bundle, new Set((b.profiles || []).map((p) => p.profile))]))
const resolveEntry = (e, parent) => { const s = String(e); const head = s.split('/')[0]
  if (bundles.has(head)) return head
  if (parent && profilesOf.get(parent) && profilesOf.get(parent).has(s)) return parent
  return byTag.get(s) || null }

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const tmp = mkdtempSync(join(tmpdir(), 'composite-freshness-'))
const failures = [], unresolved = [], fresh = []
let composites = 0
try {
  for (const bundle of [...bundles].sort()) {
    if (ONLY && !ONLY.has(bundle)) continue
    let composes = null
    for (const f of readdirSync(join(DESIGNS, bundle)).filter((f) => f.endsWith('.meta.json'))) {
      try { const c = JSON.parse(readFileSync(join(DESIGNS, bundle, f), 'utf8')).composes; if (Array.isArray(c) && c.length) composes = (composes || []).concat(c) } catch { /* not JSON: not a declaration */ }
    }
    if (!composes && !ALL && !EXTRA.has(bundle)) continue
    for (const e of composes || []) if (!resolveEntry(e, bundle)) unresolved.push(`${bundle} composes "${e}" — resolves to no bundle`)
    composites++
    const committed = join(TREE, bundle, `${bundle}.js`)
    if (!existsSync(committed)) { failures.push(`${bundle}: no committed bundle at public/${TREE_NAME}/${bundle}/${bundle}.js`); continue }
    const out = join(tmp, bundle)
    const r = spawnSync('bun', ['x', 'vite', 'build'], { cwd: ROOT, env: { ...process.env, BUNDLE: bundle, DOXA_OUT_ROOT: out }, encoding: 'utf8' })
    const built = join(out, bundle, `${bundle}.js`)
    if (r.status !== 0 || !existsSync(built)) {
      failures.push(`${bundle}: the rebuild FAILED (exit ${r.status}) — ${String(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' / ').slice(0, 200)}`)
      continue
    }
    if (sha(built) !== sha(committed)) {
      failures.push(`${bundle} is STALE — the committed bundle is not what its source builds today (committed ${sha(committed).slice(0, 12)}, rebuilt ${sha(built).slice(0, 12)}). Rebuild it: BUNDLE=${bundle} bun x vite build, then bun run fix:sri.`)
    } else fresh.push(bundle)
  }
} finally { rmSync(tmp, { recursive: true, force: true }) }

console.log(`COMPOSITE-FRESHNESS: ${composites} bundle(s) rebuilt into a temp dir and compared byte for byte with the committed bundle.`)
if (fresh.length) console.log(`  ✓ ${fresh.join(', ')}`)
for (const u of unresolved) console.log(`  ! UNRESOLVED ${u}`)
if (failures.length) {
  console.log(`\nCOMPOSITE-FRESHNESS: FAIL — ${failures.length} composite(s):`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('COMPOSITE-FRESHNESS: PASS — every committed composite is exactly what its source builds today.')
