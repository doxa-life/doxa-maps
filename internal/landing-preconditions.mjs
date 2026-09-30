#!/usr/bin/env node
/**
 * landing-preconditions — what must be true of a commit BEFORE it reaches main. Run by `main-capture scan`
 * (via .main-capture/prepush) inside the lock, on the exact commit about to be pushed; any failure REFUSES
 * the landing. A check beside the push can be skipped; a precondition of the push cannot.
 *
 * WHY (2026-09-25): check:composite-freshness found SEVEN composites stale on main — their committed
 * bundles were not what their source builds. Cause: a fleet rebuild (d49b6c80) ran in a worktree that had
 * not merged the dx-maps rename, so it wrote the OLD folder (public/doxa-maps/) and left public/dx-maps/
 * stale; later landings resolved artifact conflicts by taking one side and rebuilding only a subset.
 * Every one of those landings passed its own checks. Nothing refused them.
 *
 * PRECONDITIONS, in order (cheap first):
 *   0. NO MERGE MARKERS  no file in the COMMIT (public/ included) holds a conflict marker. d6bf410a put them
 *              into 10 built files under public/ and every other precondition passed; a built bundle with
 *              markers throws on load while its SRI still matches. --markers-self-test proves the scan refuses.
 *   1. CLEAN   the working tree equals HEAD for everything the checks read — otherwise they would judge
 *              files that are not in the commit.
 *   2. ONE FOLDER  public/ holds exactly the configured tree (vite.doxa-maps-build-config.json "name") and
 *              README.md. A build made under a different tree name writes a different folder: refused.
 *   3. SRI     every leaf's baked integrity matches the bundle it loads (check:sri).
 *   3b. MOUNTS  every capability-4/5 composite mounts headless in en and ar (check:composites-mount).
 *   4. FRESH   every composite rebuilds to exactly its committed bytes (check:composite-freshness).
 *
 * USAGE  node internal/landing-preconditions.mjs          exit 0 = may land · 1 = refused
 *        node internal/landing-preconditions.mjs --markers-self-test   proves step 0 refuses a conflict
 *        DOXA_SKIP_FRESHNESS=1 skips (4) — for a DRY check only; main-capture scan never sets it.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { bundleGraph, areasForBundle } from './i18n-areas.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const refuse = (why, detail = '') => {
  console.error(`LANDING-PRECONDITIONS: REFUSED — ${why}`)
  if (detail) console.error(detail.split('\n').map((l) => '  ' + l).join('\n'))
  process.exit(1)
}
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: process.env })

// 0. NO MERGE MARKERS — scanned in the COMMIT's tree (git grep), so public/ and every file is covered,
// whatever the working tree holds. Markers are built from char codes so this file never contains one.
const OPEN = String.fromCharCode(60).repeat(7), MID = String.fromCharCode(61).repeat(7), CLOSE = String.fromCharCode(62).repeat(7)
function markerFiles(ref) {
  const g = run('git', ['grep', '-I', '-l', '-E', '-e', `^(${OPEN}( |$)|${MID}$|${CLOSE}( |$))`, ref, '--'])
  if (g.status > 1) refuse('could not scan the commit for merge markers', g.stderr.trim())
  return g.stdout.split('\n').filter(Boolean).map((l) => l.replace(new RegExp('^' + ref + ':'), ''))
}
if (process.argv.includes('--markers-self-test')) {
  // A throwaway commit object (no branch, no working-tree change) holding one built file with a textbook
  // conflict; the scan must name it.
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: ROOT, encoding: 'utf8', input: `a\n${OPEN} HEAD\nmine\n${MID}\ntheirs\n${CLOSE} other\n` }).stdout.trim()
  const tree = spawnSync('git', ['mktree'], { cwd: ROOT, encoding: 'utf8', input: `100644 blob ${blob}\tpoison.js\n` }).stdout.trim()
  const pub = spawnSync('git', ['mktree'], { cwd: ROOT, encoding: 'utf8', input: `040000 tree ${tree}\tpublic\n` }).stdout.trim()
  const commit = spawnSync('git', ['commit-tree', pub, '-m', 'marker self-test'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const hits = markerFiles(commit)
  if (hits.includes('public/poison.js')) { console.log('LANDING-PRECONDITIONS: markers self-test PASS — a conflict in a public/ file is refused.'); process.exit(0) }
  console.error('LANDING-PRECONDITIONS: markers self-test FAIL — a textbook conflict under public/ was not found.'); process.exit(1)
}
const markers = markerFiles('HEAD')
if (markers.length) refuse(`${markers.length} file(s) in this commit hold merge-conflict markers`,
  markers.slice(0, 10).join('\n') + '\nFor a BUILT file: take either side, REBUILD it, commit the rebuild. Never `git add -A public` mid-merge.')
console.log('LANDING-PRECONDITIONS: 0 markers — no file in the commit holds a merge-conflict marker')

// 1. CLEAN
const dirty = run('git', ['status', '--porcelain', '--', 'public', 'plugin-designs', 'library', 'internal', 'vite.config.js', 'vite.doxa-maps-build-config.json', 'package.json'])
if (dirty.status !== 0) refuse('could not read git status')
if (dirty.stdout.trim()) refuse('the working tree differs from the commit being landed — the checks would judge files that are not in it', dirty.stdout.trim().split('\n').slice(0, 8).join('\n'))
console.log('LANDING-PRECONDITIONS: 1 clean — the working tree is the commit being landed')

// 2. ONE FOLDER, and it is the configured one
// What LANDS is the commit, so read public/ from HEAD, not from the disk: a gitignored, untracked leftover
// (a pre-rename public/assets/ in an older worktree) refused a clean README-only landing (repo, 2026-09-25).
const tree = run('git', ['ls-tree', '--name-only', 'HEAD', 'public/'])
if (tree.status !== 0) refuse('could not read public/ from HEAD')
const entries = tree.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^public\//, '')).sort()
const want = ['README.md', TREE_NAME].sort()
if (JSON.stringify(entries) !== JSON.stringify(want)) {
  const extra = entries.filter((e) => !want.includes(e)), missing = want.filter((e) => !entries.includes(e))
  refuse(`public/ must hold exactly ${want.join(' + ')} (the tree name comes from vite.doxa-maps-build-config.json)`,
    [extra.length ? `extra: ${extra.join(', ')} — e.g. a build made under an OLD tree name writes its old folder` : '', missing.length ? `missing: ${missing.join(', ')}` : ''].filter(Boolean).join('\n'))
}
console.log(`LANDING-PRECONDITIONS: 2 one folder — public/ = README.md + ${TREE_NAME}/`)

// 3. SRI
const sri = run(process.execPath, ['internal/sri-consistency-check.mjs'])
if (sri.status !== 0) refuse('check:sri failed', (sri.stdout + sri.stderr).trim().split('\n').slice(-6).join('\n'))
console.log('LANDING-PRECONDITIONS: 3 sri — every leaf loads the bundle its integrity names')

// 3b. MOUNTS — every capability-4/5 composite mounts headless in en and ar without a setup/watcher/mount
// error (check:composites-mount, ~20 s). 08f89f55 left Big Picture and Simple Research BLANK while every
// other check passed; a landing that blanks a composite is now refused.
const mounts = run(process.execPath, ['internal/check-composites-mount.mjs'])
if (mounts.status !== 0) refuse('a composite no longer mounts (check:composites-mount)', (mounts.stdout + mounts.stderr).trim().split('\n').filter((l) => /FAIL|✗|Error/.test(l)).slice(0, 8).join('\n'))
console.log('LANDING-PRECONDITIONS: 3b mounts — every composite mounts in en and ar')

// 4. FRESH
if (process.env.DOXA_SKIP_FRESHNESS === '1') {
  console.log('LANDING-PRECONDITIONS: 4 fresh — SKIPPED (DOXA_SKIP_FRESHNESS=1; dry check only, never set by main-capture scan)')
} else {
  // SCOPE: what can this landing have made stale? A change to shared code (library/, the build config, the
  // dependencies) reaches ANY bundle — measured 2026-09-25: one Arabic catalogue edit in library/i18n left 12
  // of 25 bundles stale, most of them not composites, and a composite-only check saw none of it. Otherwise:
  // every composite, plus each bundle whose own folder the landing touched.
  const base = run('git', ['merge-base', 'HEAD', `origin/${process.env.MAIN_CAPTURE_BRANCH || 'main'}`]).stdout.trim()
  const changed = base ? run('git', ['diff', '--name-only', base, 'HEAD']).stdout.split('\n').filter(Boolean) : []
  // ★ A library/ change no longer means EVERY bundle. It means every bundle whose SOURCE GRAPH contains a
  // changed file, or that reads a changed i18n area: measured, a one-file library fix reached 1 of 24
  // bundles, and rebuilding all 24 cost ~10 min per landing round. Only the build itself (config,
  // dependencies, the tree generator) can reach every bundle, so only that still means --all.
  const pkgDepsChanged = () => {
    if (!changed.includes('package.json') || !base) return false
    const deps = (ref) => { try { const j = JSON.parse(run('git', ['show', `${ref}:package.json`]).stdout); return JSON.stringify([j.dependencies, j.devDependencies]) } catch { return '' } }
    return deps(base) !== deps('HEAD')
  }
  const everything = !base || pkgDepsChanged() || changed.some((f) => /^(vite\.config\.js$|bun\.lockb?$|vite\.doxa-maps-build-config\.json$)/.test(f))
  const libChanged = changed.filter((f) => f.startsWith('library/'))
  const shared = everything || libChanged.length > 0
  const own = new Set(changed.map((f) => (f.match(/^plugin-designs\/([^/]+)\//) || [])[1]).filter(Boolean))
  if (!everything && libChanged.length) {
    const libSet = new Set(libChanged)
    const areas = new Set(libChanged.map((f) => (f.match(/^library\/i18n\/locales\/[^/]+\/([^/]+)\.json$/) || [])[1]).filter(Boolean))
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public', TREE_NAME, 'manifest.json'), 'utf8'))
    for (const { bundle } of manifest.bundles) {
      if (!existsSync(resolve(ROOT, 'plugin-designs', bundle, 'index.js'))) continue
      const graph = bundleGraph(ROOT, bundle).map((f) => f.slice(ROOT.length + 1))
      if (graph.some((f) => libSet.has(f)) || (areas.size && areasForBundle(ROOT, bundle).areas.some((a) => areas.has(a)))) own.add(bundle)
    }
  }
  const scope = everything ? ['--all'] : (own.size ? ['--bundles', [...own].sort().join(',')] : [])
  console.log(`LANDING-PRECONDITIONS: 4 fresh — scope: ${everything ? 'EVERY bundle (the build itself changed' + (base ? '' : '; no merge-base') + ')' : (shared ? 'the bundles this library change reaches' : 'composites') + (own.size ? ': ' + [...own].sort().join(', ') : '')}`)
  // ★ ONE PASS PER TREE, NOT ONE PER SCAN. This check rebuilds every bundle in its scope (~10 min for
  // --all), and it used to run INSIDE the merge-queue lock, so a build-owner landing held main for 30+ min
  // while every other landing queued (2026-09-25). The verdict is a function of the committed tree and the
  // scope, so a PASS is recorded against both; the landing script runs this precondition BEFORE taking the
  // lock, and the scan inside the lock finds the record and does not rebuild again. A different tree or a
  // wider scope has no record and is checked in full. The record lives in the repo's own git dir.
  const treeId = run('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim()
  const stampDir = resolve(ROOT, run('git', ['rev-parse', '--git-common-dir']).stdout.trim(), 'doxa-fresh')
  // The scope can be a long bundle list now, and a filename has a length limit: hash it.
  const scopeKey = scope.length ? createHash('sha1').update(scope.join(' ')).digest('hex').slice(0, 16) : 'composites'
  const stamp = resolve(stampDir, `${treeId}.${scopeKey}`)
  if (treeId && existsSync(stamp)) {
    console.log(`LANDING-PRECONDITIONS: 4 fresh — this exact tree (${treeId.slice(0, 10)}) already passed at this scope, ${readFileSync(stamp, 'utf8').trim()}`)
    console.log('LANDING-PRECONDITIONS: PASS — this commit may land.')
    process.exit(0)
  }
  const fresh = run(process.execPath, ['internal/check-composite-freshness.mjs', ...scope])
  if (fresh.status !== 0) refuse(
    'a committed composite is not what its source builds (stale consumers).\n' +
    'README rule 5: ONE agent owns the full build. If your change touches library/ or anything compiled into\n' +
    'other plugins, do not rebuild everyone yourself: commit it on your branch and hand the landing to studio\n' +
    '(msg-agent studio "please land <branch>@<sha>: library change, consumers need rebuilding"). If only YOUR\n' +
    'own plugin is stale, rebuild just it: BUNDLE=<name> bun x vite build && bun run tree && bun run fix:sri.',
    (fresh.stdout + fresh.stderr).trim().split('\n').filter((l) => /✗|STALE|FAIL/.test(l)).slice(0, 8).join('\n'))
  console.log('LANDING-PRECONDITIONS: 4 fresh — every composite rebuilds to its committed bytes')
  if (treeId) { mkdirSync(stampDir, { recursive: true }); writeFileSync(stamp, `${new Date().toISOString()} (commit ${run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()})\n`) }
}
console.log('LANDING-PRECONDITIONS: PASS — this commit may land.')
