#!/usr/bin/env node
/**
 * check-frozen-labels — a label resolved ONCE that never re-resolves when the locale changes.
 *
 * THE DEFECT, and it is created BY FIXING ANOTHER ONE. `const TABS = [{ label: t('…') }]` at
 * module/setup scope evaluates once. ProfileLoader drives appI18n.global.locale at RUNTIME, so a
 * mid-session language switch leaves that label in the boot language while everything around it
 * changes. A computed re-reads on access; a const does not. This is a DIFFERENT defect from
 * hardcoded English with the SAME symptom: hardcoded English never consults the catalogue,
 * a frozen label consults it once and caches. check:hardcoded-english finds the first and cannot
 * see the second — and binding a literal to t() in the wrong scope converts one into the other.
 *
 * tStatic() freezes the same way for a different reason: it reads getRuntimeLocale() AT CALL TIME
 * (library/i18n/index.js), so RE-CALLING it picks up a change; storing its result once does not.
 *
 * ★ PARSED, NOT REGEXED. A regex cannot tell `const X = t('a')` from
 * `const X = computed(() => t('a'))` across a multi-line array. Templates go through
 * @vue/compiler-sfc, scripts through @babel/parser; the test is on the AST.
 *
 * ★ SCOPED BY PROFILE STAGE, NOT BUNDLE STAGE. bundle.stage reads 'production' if ANY profile is,
 * and FOUR bundles are mixed (cities-internet, gospel-resources, my-upg-100-list, regions-dashboard
 * — measured 2026-09-28). A .vue file IS a profile, so the file's own profile.stage is the honest
 * key. Scoping by bundle.stage would FAIL on experimental files in a production bundle.
 *   production profile or library/  -> FAIL (exit 1)
 *   experimental profile            -> REPORTED, never fails
 *
 * ⚠ CANNOT TELL WHETHER A FROZEN LABEL IS RENDERED. A frozen const in dead code is not a
 * user-visible defect; refs= is a reference count, a proxy, not proof it reaches a screen.
 *
 * Deliberately NOT flagged (all re-evaluate, or are pinned on purpose): t() inside a
 * function/arrow/method body, inside computed()/watch()/watchEffect(), in a template expression,
 * and tStatic(path, explicitLocale).
 *
 * NEGATIVE-TESTED: --self-test plants 4 bad shapes it must catch and 6 good ones it must not.
 * Exit 0 clean · 1 a production/library finding · 2 parse error.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
// ★ SHARED WITH check:hardcoded-english (regions-plugin). Two gates must agree about WHICH files are
// in scope even when they disagree about what they find in them; a second copy would drift on exactly
// the pair-form / transitive / cycle details below, and the drift would be silent.
import { effectiveStages, stageReason } from './lib/effective-stage.mjs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import * as babel from '@babel/parser'

const TRANSLATORS = new Set(['t', 'tStatic', '$t'])
// A call is "reactive" if any ANCESTOR is one of these: the value is recomputed later.
const REACTIVE_WRAPPERS = new Set(['computed', 'watch', 'watchEffect', 'watchPostEffect', 'defineExpose'])

function parseScript(code) {
  return babel.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'topLevelAwait', 'importMeta'],
    errorRecovery: true,
  })
}

/** Walk the AST, tracking whether we are inside a function body or a reactive wrapper. */
function findFrozen(ast, aliases) {
  const out = []
  const visit = (node, parents) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) visit(n, parents); return }
    if (!node.type) return

    if (node.type === 'CallExpression') {
      const callee = node.callee
      const name = callee?.type === 'Identifier' ? callee.name
        : callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier' ? callee.property.name
        : null
      if (name && (TRANSLATORS.has(name) || aliases.has(name))) {
        // tStatic(path, EXPLICIT_LOCALE) — the caller pinned it deliberately.
        const pinned = name === 'tStatic' && node.arguments.length > 1
        // ★ tStatic IS NEVER LIVE, WHEREVER IT SITS (exp, 2026-09-28). It resolves the locale via
        // getRuntimeLocale(), which reads a PLAIN window property — not a Vue ref — so a computed()
        // wrapping it has NO reactive dependency and never invalidates. computed(() => tStatic(x))
        // is strictly WORSE than the naked call: it looks like the fix, so nobody looks again.
        // Only a reactive translator (vue-i18n t / useOptionalT) counts as live inside a wrapper.
        // ⚠ BUT A PLAIN FUNCTION BODY STILL RE-RUNS. tStatic inside a function/arrow that a caller
        // INVOKES re-reads the global each call (useOptionalT:74 returns exactly such an arrow), so
        // only a REACTIVE WRAPPER is the lie: computed/watch cache the result and never invalidate.
        const inReactiveWrapper = parents.some((p) =>
          p.type === 'CallExpression' && p.callee?.type === 'Identifier' && REACTIVE_WRAPPERS.has(p.callee.name))
        const neverLive = name === 'tStatic' && !pinned && inReactiveWrapper
        // Inside any function body or reactive wrapper => re-evaluated later.
        const shielded = parents.some((p) =>
          p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' ||
          p.type === 'ArrowFunctionExpression' || p.type === 'ObjectMethod' ||
          p.type === 'ClassMethod' ||
          (p.type === 'CallExpression' && p.callee?.type === 'Identifier' && REACTIVE_WRAPPERS.has(p.callee.name)))
        if ((!shielded || neverLive) && !pinned) {
          // Name the binding it freezes into, when there is one.
          const decl = parents.find((p) => p.type === 'VariableDeclarator')
          out.push({
            line: node.loc?.start.line ?? 0,
            binding: decl?.id?.type === 'Identifier' ? decl.id.name : '(expression)',
            call: name,
          })
        }
      }
    }
    const next = [...parents, node]
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'leadingComments' || k === 'trailingComments') continue
      visit(node[k], next)
    }
  }
  visit(ast.program ?? ast, [])
  return out
}

/** `const t2 = t` / `const { t } = useI18n()` — alias discovery, so a rename cannot hide a call. */
function findAliases(code) {
  const set = new Set()
  for (const m of code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(t|tStatic|useOptionalT\([^)]*\))\s*[;\n]/g)) set.add(m[1])
  for (const m of code.matchAll(/const\s*\{\s*([^}]*)\}\s*=\s*useI18n\(\)/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.split(':').map((s) => s.trim())
      if (orig === 't') set.add(alias || 't')
    }
  }
  return set
}

export function scanSource(code) {
  const aliases = findAliases(code)
  let ast
  try { ast = parseScript(code) } catch { return [] }
  return findFrozen(ast, aliases)
}

export function scanVue(src) {
  const { descriptor } = parseSfc(src)
  const block = descriptor.scriptSetup || descriptor.script
  if (!block) return []
  const offset = src.slice(0, block.loc.start.offset).split('\n').length - 1
  return scanSource(block.content).map((f) => ({ ...f, line: f.line + offset }))
}

// ── SELF-TEST ───────────────────────────────────────────────────────────────
const CASES = [
  ['BAD  const array of t() labels',      () => scanSource("const { t } = useI18n()\nconst TABS = [{ label: t('a.b') }]").length, 1],
  ['BAD  t() straight into a const',      () => scanSource("const { t } = useI18n()\nconst title = t('a.b')").length, 1],
  ['BAD  tStatic() into a const',         () => scanSource("const title = tStatic('a.b')").length, 1],
  ['BAD  through an ALIAS of t',          () => scanSource("const { t } = useI18n()\nconst t2 = t\nconst x = t2('a.b')").length, 1],
  ['GOOD computed(() => t())',            () => scanSource("const { t } = useI18n()\nconst TABS = computed(() => [{ label: t('a.b') }])").length, 0],
  ['GOOD inside a function body',         () => scanSource("const { t } = useI18n()\nfunction f() { return t('a.b') }").length, 0],
  ['GOOD inside an arrow',                () => scanSource("const { t } = useI18n()\nconst f = () => t('a.b')").length, 0],
  ['GOOD tStatic with explicit locale',   () => scanSource("const x = tStatic('a.b', 'en')").length, 0],
  ['GOOD watch(() => t())',               () => scanSource("const { t } = useI18n()\nwatch(src, () => t('a.b'))").length, 0],
  // ★ exp's false negative: a computed cannot make tStatic live.
  ['BAD  computed(() => tStatic()) is STILL frozen', () => scanSource("const X = computed(() => tStatic('a.b'))").length, 1],
  // A function BODY re-reads the global on every call (useOptionalT:74 returns such an arrow),
  // so it is NOT frozen. Only a reactive wrapper caches it. I had this case backwards at first.
  ['GOOD tStatic in a function body re-runs',        () => scanSource("function f(){ return tStatic('a.b') }").length, 0],
  ['GOOD computed(() => t()) IS live',               () => scanSource("const { t } = useI18n()\nconst X = computed(() => t('a.b'))").length, 0],
  ['GOOD computed(() => tStatic(x, loc)) is pinned', () => scanSource("const X = computed(() => tStatic('a.b', 'en'))").length, 0],
  ['GOOD no translator at all',           () => scanSource("const TABS = [{ label: 'Region' }]").length, 0],
]

if (process.argv.includes('--self-test')) {
  let ok = 0
  for (const [name, run, want] of CASES) {
    let got
    try { got = run() } catch (e) { got = `ERR ${e.message}` }
    const pass = got === want
    console.log(`  ${pass ? '✓' : '✗'} ${name}  -> ${got} (want ${want})`)
    if (pass) ok++
  }
  console.log(ok === CASES.length
    ? `FREEZE-CENSUS SELF-TEST: PASS — ${ok}/${CASES.length}, every rule proven able to fail`
    : `FREEZE-CENSUS SELF-TEST: FAIL — ${ok}/${CASES.length}`)
  process.exit(ok === CASES.length ? 0 : 1)
}

// ── RUN ─────────────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TREE = join(ROOT, `public/${TREE_NAME}`)

// profile.stage per FILE. A .vue under plugin-designs/<bundle>/<profile>.vue IS that profile.
// Anything under library/ is shared by every bundle, so it is held to the production bar.
function stageIndex() {
  const mf = join(TREE, 'manifest.json')
  if (!existsSync(mf)) return null
  const m = JSON.parse(readFileSync(mf, 'utf8'))
  const byFile = new Map()
  for (const b of m.bundles || []) for (const p of b.profiles || []) {
    byFile.set(join('plugin-designs', b.bundle, p.profile + '.vue'), p.stage || b.stage || 'experimental')
  }
  // The manifest itself and the bundle-level effective stage travel with it: the file-level answer
  // needs both, and re-reading the manifest twice would let the two drift apart.
  return { byFile, manifest: m, effStages: effectiveStages(m) }
}

const walk = (dir, acc = []) => {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'public') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(vue|js|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

const idx = stageIndex()
if (!idx) {
  console.log(`FROZEN-LABELS: SKIP — no built tree at public/${TREE_NAME}. Run a build first.`)
  console.log('  Reported as a SKIP, not a pass: a gate that reports success when it never ran is worse than no gate.')
  process.exit(0)
}
const { byFile: stages, manifest, effStages } = idx

const files = ['library', 'plugin-designs'].flatMap((r) => walk(join(ROOT, r)))
const failures = [], reported = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  let hits
  try { hits = f.endsWith('.vue') ? scanVue(src) : scanSource(src) }
  catch (e) { console.error(`FROZEN-LABELS: parse error in ${relative(ROOT, f)} — ${e.message}`); process.exit(2) }
  if (!hits.length) continue
  const rel = relative(ROOT, f)
  // ★ TWO QUESTIONS, BOTH ASKED. A .vue file IS a profile, so its own profile.stage is the precise
  // answer for the FILE — bundle.stage reads 'production' if ANY profile is, and four bundles are
  // mixed (cities-internet, gospel-resources, my-upg-100-list, regions-dashboard), so scoping by
  // bundle alone would FAIL on experimental files inside a production bundle. But profile stage alone
  // UNDER-reports: three experimental bundles are COMPOSED BY production ones (research-dashboard by
  // dashboard-plus-grid, doxa-research-map by research-map-plus-grid, people-groups-grid by both), so
  // a reader sees them on a production page while the file says experimental. Take the stricter of the
  // two: FAIL if the file's own profile is production OR its bundle is production by effective stage.
  const bundleOf = rel.startsWith('plugin-designs/') ? rel.split('/')[1] : null
  const byProfile = rel.startsWith('library/') ? 'production' : (stages.get(rel) || 'experimental')
  const byBundle = bundleOf ? (effStages.get(bundleOf) || 'experimental') : 'production'
  const stage = (byProfile === 'production' || byBundle === 'production') ? 'production' : 'experimental'
  // A widened scope must be able to EXPLAIN itself, or it reads as a bug to whoever it newly fails.
  const why = (stage === 'production' && byProfile !== 'production' && bundleOf)
    ? '  [in scope: ' + stageReason(manifest, bundleOf) + ']'
    : ''
  for (const h of hits) {
    const refs = h.binding === '(expression)' ? -1 : (src.match(new RegExp(`\\b${h.binding}\\b`, 'g')) || []).length - 1
    const row = `${rel}:${h.line}  ${h.binding} (${h.call}) refs=${refs < 0 ? '?' : refs}${why}`
    ;(stage === 'production' ? failures : reported).push(row)
  }
}

for (const r of reported) console.log(`  · ${r}   [experimental — reported, not failing]`)
for (const r of failures) console.log(`  ✗ ${r}   [PRODUCTION]`)
if (failures.length) {
  console.log(`FROZEN-LABELS: FAIL — ${failures.length} label(s) in a PRODUCTION profile or library/ resolve once and never re-resolve on a locale change. Wrap in computed().`)
  process.exit(1)
}
console.log(`FROZEN-LABELS: PASS — 0 in production/library${reported.length ? `, ${reported.length} reported in experimental` : ''}.`)
process.exit(0)
