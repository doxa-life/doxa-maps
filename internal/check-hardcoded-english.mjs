#!/usr/bin/env node
/**
 * check-hardcoded-english — user-visible English that never reaches a translator. Headless.
 *
 * ONE GATE INSTEAD OF FOUR PRIVATE SCANNERS. sr, upg100, gospel and regions each wrote one of these
 * on 2026-09-28 and each found real defects; four copies means four sets of blind spots and four
 * allow-lists drifting apart. This is the merge, and every rule below earns its place from a defect
 * one of those scanners actually caught.
 *
 * ★ PARSED, NEVER REGEXED. A regex for string literals matches from the CLOSING quote of one to the
 * OPENING quote of the next, so a file with adjacent imports yields phantom "strings" — the first
 * version of regions' scanner reported 137 of them. Templates go through @vue/compiler-sfc and
 * scripts through @babel/parser.
 *
 * ★ ALIASES ARE DISCOVERED, NOT LISTED. `const t2 = t` defeats a callee-name check, and that cost a
 * false positive. The alias set is read out of each file (`const X = t`), so a rename cannot make
 * translated text look hardcoded.
 *
 * ★ te()-GUARDED FALLBACKS ARE NOT LEAKS. `te(key) ? t(key) : 'Some English'` is the documented way
 * to fall back when a key is absent; the English is reachable only when no translation exists. A
 * literal inside a conditional whose test calls te() is therefore allowed (sr's pattern).
 *
 * ⚠ SECOND BLIND SPOT, AND IT BIT ON THE FIRST DAY. A guarded fallback is judged by its SHAPE, not
 * by whether the lookup it guards actually works. `msg !== 'messages.engineMissing' ? msg : 'English'`
 * is treated as a fallback — but if the key is looked up with the wrong prefix, the lookup ALWAYS
 * misses and the English arm becomes the NORMAL path, in every locale, while this gate stays quiet.
 * That is exactly what exp-shepherd found in cities-internet after I triaged the same line as "not a
 * leak". A hardcoded-English scan cannot see a misconfigured lookup; check:i18n-keys-exist and a
 * locale render are what catch that. Treat a guarded fallback as "not a leak HERE", never as "this
 * string is not reaching users".
 *
 * ⚠ KNOWN BLIND SPOT, STATED SO NOBODY READS A GREEN RUN AS MORE THAN IT IS: THIS CANNOT SEE
 * SINGLE-WORD STRINGS. A bare 'Other' used as a fallback label is user-visible English and this gate
 * will not report it — regions found eight of them by grep, not with this tool. Single words carry
 * too many non-prose meanings (ids, class fragments, enum values) to flag without drowning the
 * signal. If that trade is ever revisited, the missing piece is context (what the value is ASSIGNED
 * to), not a longer word list.
 *
 * Exit 0 clean, 1 with findings, 2 on a parse error. `--self-test` runs the planted cases only.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { parse } from '@vue/compiler-sfc'
import * as babel from '@babel/parser'
import { productionForGating, stageReason } from './lib/effective-stage.mjs'

// ── what counts as user-visible ─────────────────────────────────────────────────────────────────
const VISIBLE_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label'])
const isProse = (s) => /[A-Za-z]/.test(s) && /[A-Za-z]{2,}/.test(s.trim())

// ── the allow-list: SHAPES first, names only where a shape cannot express it ─────────────────────
// Each entry records the class and why it is not a leak. A shape is preferred over a literal so the
// list does not need editing every time a new font or status code appears.
const ALLOW = [
  { why: 'CSS: declarations, selectors, at-rules — read by the DOM, not by a person',
    test: (s) => /[{}]/.test(s) || /[a-z-]+\s*:\s*[^;]+;/.test(s) || /^\s*@(media|supports|keyframes|font-face)/.test(s) || /^\s*[.#][a-zA-Z]/.test(s) || /^\s*\[[a-z-]+[~|^$*]?=/.test(s) },
  { why: 'HTML fragments: these plugins build popup markup in template literals, so a quasi is often '
       + 'a tag, or the seam between two attributes ("\" alt=\"" / "\" loading=\"lazy\">")',
    test: (s) => /<\/?[a-zA-Z][^>]*>?/.test(s)
      || /\b(class|href|src|alt|loading|width|height|style|id|target|rel)\s*=/.test(s)
      || /^["'>\s]*$/.test(s) || /^<\/|^["']?\s*>/.test(s) },
  { why: 'URLs and url fragments, absolute OR relative (gospel: a relative URL was reported as prose)',
    test: (s) => /^(https?:|\/\/|\/|\?|&|#)/.test(s)
      || /^\.{0,2}\/[^\s]*$/.test(s)
      || (/^[^\s]+\.(json|js|css|svg|png|jpe?g|webp|geojson|csv|html?)$/i.test(s)) },
  { why: 'CSS class/id SUFFIXES built by interpolation (gospel: `${x}-fill`, `${x}-line` read as prose)',
    test: (s) => /^[-_][a-z0-9][a-z0-9-]*$/.test(s) },
  { why: 'custom-element tag names: lowercase and hyphenated, a tag is not a sentence',
    test: (s) => /^<?\/?[a-z][a-z0-9]*(-[a-z0-9]+)+>?$/.test(s) },
  { why: 'BCP-47 locale extensions and language tags (e.g. the latin-digits override)',
    test: (s) => /^-?[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s) || /-u-[a-z]{2}-/.test(s) },
  { why: 'developer error text: a bracketed module prefix or an HTTP status, for the console',
    test: (s) => /^\[[a-z0-9-]+\]/i.test(s) || /^HTTP\b/.test(s) },
  { why: 'DOM id / class / data-key fragments: hyphenated or BEM identifiers, alone or as a class LIST',
    // Every token must carry a separator. That is what tells `rd-card is-open` from `the map`:
    // prose words do not contain hyphens, and this codebase's classes always do. A class list with
    // no hyphen anywhere (`card open`) is deliberately NOT allowed — flagging is the safe direction.
    // A trailing separator is allowed because that is the shape of an id PREFIX built by
    // interpolation — `id="country-${code}"` leaves the quasi "country-".
    test: (s) => s.split(/\s+/).every((tok) => /^[a-z][a-z0-9]*(?:[-_]{1,2}[a-z0-9]*)+$/.test(tok)) },
  { why: 'font family names: typeface identifiers, never translated',
    test: (s) => /^(Bebas Neue|Poppins|Oswald|Figtree|Segoe UI|Helvetica Neue|Times New Roman)$/.test(s) },
  { why: 'engine/provider tokens and well-known proper nouns that are not prose',
    test: (s) => /^(mapbox|maplibre|mercator|globe|Mapbox|MapLibre)$/.test(s) },
]
const allowedBy = (s) => ALLOW.find((a) => a.test(s))

// ── localisation calls: base names plus aliases discovered per file ──────────────────────────────
function localizedNames(code) {
  const names = new Set(['t', 'tf', '$t'])
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(t|tf)\b\s*(?![(.])/g)) names.add(m[1])
  return names
}
// ★ A DOM QUERY ARGUMENT IS A SELECTOR, NOT PROSE — and a selector made of custom-element tags
// reads as English only because the tag names are English words. gospel found
// `querySelector("gospel-resources-dashboard, gospel-resources-map")` reported as user-visible text:
// the single-tag rule matched neither, because it is a comma-separated LIST. Exempting by CALL SITE
// is the right shape (as with developer strings) — the site is the fact, and no content rule can
// reliably tell a tag list from a sentence.
const DOM_QUERY = new Set([
  'querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById',
  'getElementsByClassName', 'getElementsByTagName', 'getElementsByName',
])
function isDomQuerySite(parent) {
  return !!parent && parent.type === 'CallExpression'
    && parent.callee?.type === 'MemberExpression'
    && DOM_QUERY.has(parent.callee.property?.name || '')
}

// A literal that is an argument to one of these never reaches a reader, whatever it says.
function isDeveloperSite(parent) {
  if (!parent) return false
  if (parent.type === 'CallExpression' && parent.callee?.object?.name === 'console') return true
  if (parent.type === 'NewExpression' && /^[A-Z]\w*Error$|^Error$/.test(parent.callee?.name || '')) return true
  if (parent.type === 'CallExpression' && /^[A-Z]\w*Error$|^Error$/.test(parent.callee?.name || '')) return true
  return false
}
const calleeName = (node) => node?.callee?.type === 'Identifier' ? node.callee.name
  : node?.callee?.type === 'MemberExpression' ? (node.callee.property?.name || '') : ''

// ── CROSS-AREA KEYS THROUGH A NAMESPACED TRANSLATOR ─────────────────────────────────────────────
// ★ A REAL BUG, FOUND TWICE IN ONE DAY (pplr a56d06c8, cities-internet 7b3fb78d5), that no gate saw.
// `const t = useOptionalT('connectivity')` then `t('messages.engineMissing')` — qualify() makes that
// `connectivity.messages.engineMissing`, which cannot exist, so the English fallback is the NORMAL
// path in every locale. check:i18n-keys-exist passes it because the key AS WRITTEN does exist; the
// key as QUALIFIED is what misses. The user-visible outcome is identical to a hardcoded string,
// which is why it belongs in this gate: a reader sees English where their language was promised.
// Detected by SHAPE — qualified key absent AND unqualified key present — so it cannot fire on an
// ordinary missing key, which is check:i18n-keys-exist's job, not this one.
const qualifyKey = (ns, key) => (ns && !key.startsWith(`${ns}.`) ? `${ns}.${key}` : key)

let CATALOGUE = null
function catalogue(root = '.') {
  if (CATALOGUE) return CATALOGUE
  CATALOGUE = {}
  const dir = join(root, 'library/i18n/locales/en')
  if (!existsSync(dir)) return CATALOGUE
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try { CATALOGUE[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { /* skip */ }
  }
  return CATALOGUE
}
// `a.b.c` resolves as area `a` then path b.c inside it — the shape library/i18n/index.js builds.
function resolveKey(key, root = '.') {
  const cat = catalogue(root)
  const [area, ...rest] = String(key).split('.')
  let node = cat[area]
  if (node === undefined) return undefined
  for (const seg of rest) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[seg]
    if (node === undefined) return undefined
  }
  return node
}

// ★ WRAPPER FACTORIES CARRY THE NAMESPACE ONE INDIRECTION AWAY, and missing that is why the first
// version of this check caught cities-internet but NOT pplr — the bug it was written for. pplr does
// `const t = usePplrT()` with NO argument, and usePplrT() is `return useOptionalT('pplr')`. A check
// that only reads a literal argument sees no namespace and stays silent on the exact defect twice
// over. So wrappers are resolved from source first.
let WRAPPERS = null
function wrapperNamespaces(root = '.') {
  if (WRAPPERS) return WRAPPERS
  WRAPPERS = {}
  const roots = [join(root, 'library/composables'), join(root, 'plugin-designs')]
  const visit = (d, depth = 0) => {
    if (depth > 4 || !existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|dist/.test(e.name)) visit(f, depth + 1); continue }
      if (!e.name.endsWith('.js')) continue
      let src = ''
      try { src = readFileSync(f, 'utf8') } catch { continue }
      for (const m of src.matchAll(/export\s+function\s+(use[A-Za-z]*T)\s*\([^)]*\)\s*\{[^}]*useOptionalT\s*\(\s*['"]([^'"]+)['"]/g)) {
        WRAPPERS[m[1]] = m[2]
      }
    }
  }
  roots.forEach((r) => visit(r))
  return WRAPPERS
}

// `const t = useOptionalT('connectivity')` → { t: 'connectivity' }
// `const t = usePplrT()`                   → { t: 'pplr' }, via the wrapper map above
function namespacedTranslators(code, root = '.') {
  const map = {}
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*use[A-Za-z]*T\s*\(\s*['"]([^'"]+)['"]/g)) map[m[1]] = m[2]
  const wrappers = wrapperNamespaces(root)
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(use[A-Za-z]*T)\s*\(\s*\)/g)) {
    if (wrappers[m[2]]) map[m[1]] = wrappers[m[2]]
  }
  return map
}

export function crossAreaKeys(code, file, root = '.') {
  const out = []
  const ns = namespacedTranslators(code, root)
  if (!Object.keys(ns).length) return out
  let ast
  try { ast = babel.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true }) } catch { return out }
  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return
    const name = node.callee?.type === 'Identifier' ? node.callee.name : ''
    if (!ns[name]) return
    const arg = node.arguments?.[0]
    if (arg?.type !== 'StringLiteral' || !arg.value.includes('.')) return
    const qualified = qualifyKey(ns[name], arg.value)
    if (resolveKey(qualified, root) !== undefined) return          // resolves: fine
    if (resolveKey(arg.value, root) === undefined) return          // plain missing key: keys-exist's job
    out.push({ file, kind: 'cross-area-key', text: `${name}('${arg.value}') → ${qualified} (never resolves; '${arg.value}' does)` })
  })
  return out
}

// ── LITERAL STRINGS PASSED AS PROPS ─────────────────────────────────────────────────────────────
// ★ THE THIRD FALSE-NEGATIVE CLASS, and the gate is structurally unable to confirm it (gospel).
// poster-wall.vue passes `unit="UPG" item-noun="list"` to <PosterWall>, and PosterWall.vue renders
// `{{ itemNoun }}` and `{{ unit }}` as visible text. Neither file shows a leak to a template scan:
// in the plugin it is an attribute VALUE, in the library it is an interpolation of a VARIABLE. The
// English and the render live in different files, so no single-file rule can join them.
// Reported as SUSPECT, never counted as a leak, because whether the child renders the prop is not
// knowable from here — the child may use it as a key, an id, or an event name. A suspect is a
// question for a human, and calling it a defect would make the count untrustworthy in the other
// direction.
const PROP_HINT = /noun|label|title|unit|text|heading|intro|placeholder|caption/i
// Component tags only: PascalCase, or hyphenated custom elements. A plain <div> takes attributes,
// not props, and its visible ones are already covered by VISIBLE_ATTRS.
const isComponentTag = (tag) => /^[A-Z]/.test(tag) || /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)

function literalProps(node, file, out) {
  if (node.type !== 1 || !isComponentTag(node.tag || '')) return
  for (const p of node.props || []) {
    if (p.type !== 6 || !p.value?.content) continue          // static attribute only
    if (!PROP_HINT.test(p.name)) continue
    const text = String(p.value.content).trim()
    if (!text.length || !isProse(text) || allowedBy(text)) continue
    out.push({ file, kind: `suspect-prop:${p.name}`, text: `<${node.tag} ${p.name}="${text}">`, suspect: true })
  }
}

// ── the walk ────────────────────────────────────────────────────────────────────────────────────
function walkAst(node, visit, parent = null, stack = []) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent, stack)
  const next = [...stack, node]
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue
    const v = node[k]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walkAst(c, visit, node, next) }
    else if (v && typeof v.type === 'string') walkAst(v, visit, node, next)
  }
}
// A literal is a GUARDED FALLBACK — reachable only when a translation is absent — in two shapes:
//   · te(key) ? t(key) : 'English'        the documented existence check (sr)
//   · t.search || 'Search…'               a PROXY t whose member read misses (people-groups-grid)
// Both mean "the catalogue had nothing", so the English is the designed last resort rather than a
// string that skipped translation. Ancestors are walked, not just the immediate parent, because the
// fallback is often nested (`a ?? (te(k) ? t(k) : 'X')`).
function guardedFallback(stack, names) {
  return stack.some((n) => {
    if (n.type !== 'ConditionalExpression' && n.type !== 'LogicalExpression') return false
    let found = false
    walkAst(n.test || n.left, (x) => {
      if (x.type === 'CallExpression' && /^te$/.test(calleeName(x))) found = true
      // a member read on a localisation object or alias: t.search, i18n.t.search
      if (x.type === 'MemberExpression' && x.object?.type === 'Identifier' && names.has(x.object.name)) found = true
      // THE "DID t() RETURN THE KEY?" IDIOM. vue-i18n returns the key itself when it is missing, so
      // `msg !== 'messages.engineMissing' ? msg : 'English'` is a miss check and its English arm is a
      // fallback. Matched on the KEY SHAPE (dotted, no spaces) rather than on any string comparison,
      // so an ordinary `x !== 'yes'` is not mistaken for one. (cities-internet, triaged 2026-09-28.)
      if (x.type === 'BinaryExpression' && /^[!=]==?$/.test(x.operator)) {
        for (const side of [x.left, x.right]) {
          if (side?.type === 'StringLiteral' && /^[a-z][\w-]*(\.[\w-]+)+$/.test(side.value)) found = true
        }
      }
    })
    return found
  })
}

function scanScript(code, file, out) {
  const names = localizedNames(code)
  const ast = babel.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true })
  walkAst(ast, (node, parent, stack) => {
    const isStr = node.type === 'StringLiteral'
    const isTpl = node.type === 'TemplateLiteral'
    if (!isStr && !isTpl) return
    if (parent && parent.type === 'CallExpression' && names.has(calleeName(parent))) return   // t('…')
    // ★ DEVELOPER STRINGS ARE EXEMPT BY CALL SITE, NOT BY CONTENT (upg100). `throw new Error('…')`
    // and console.* never reach a reader, and judging them by their text means inventing a rule for
    // every sentence a developer might write. The SITE is the fact; the wording is not.
    if (isDeveloperSite(parent) || isDomQuerySite(parent)) return
    if (parent && /Import|Export/.test(parent.type)) return
    if (parent && parent.type === 'TaggedTemplateExpression') return
    if (guardedFallback(stack, names)) return

    if (isStr) {
      const text = node.value.trim()
      if (!text.length || !isProse(text)) return   // gospel: empty matches were being reported
      if (!/\s/.test(text)) return                 // ⚠ the single-word blind spot, documented above
      if (allowedBy(text)) return
      out.push({ file, kind: 'script-string', text })
      return
    }
    // ★ ONE TEMPLATE LITERAL IS ONE FINDING (upg100). Reporting each quasi separately turned a single
    // string into 'polys ·', 'zones ·', 'px;' — three hits for one defect, which inflates every count
    // and makes a triage list read as worse than the code is. Each quasi is still JUDGED on its own,
    // so an allow-listed fragment cannot drag a whole literal in; only the REPORT is joined.
    const quasis = node.quasis.map((q) => String(q.value.cooked ?? q.value.raw ?? ''))
    const leaks = quasis.some((raw) => {
      const text = raw.trim()
      return text.length && isProse(text) && !allowedBy(text)
    })
    if (!leaks) return
    const whole = quasis.map((q) => q.trim()).filter(Boolean).join(' {…} ').trim()
    out.push({ file, kind: 'template-literal', text: whole })
  })
}

// ★ BOUND ATTRIBUTES HIDE LEAKS FROM A TEMPLATE WALKER. `:title="`Sort by ${col}`"` is a DIRECTIVE
// whose value is an EXPRESSION, not a static attribute, so a scan that reads only static attrs sees
// nothing — a blind spot every one of the four private scanners shared (sr, 2026-09-28; real case
// DashboardDataTable.vue:884). The expression is parsed with the same rules as a script block, so a
// literal inside t()/tf(), or behind a te() guard, still passes.
function scanBoundExpr(expr, file, attrName, out) {
  const code = String(expr || '').trim()
  if (!code) return
  const found = []
  try { scanScript(`(${code})`, file, found) } catch { return }   // not parseable as an expression: skip
  for (const f of found) out.push({ file, kind: `bind:${attrName}`, text: f.text })
}

// ★ dir="ltr" MARKS TEXT THAT IS MEANT TO STAY ENGLISH. gospel's plugins use it as the island
// marker for content the Driver ruled stays English (a BLUF, a source citation), so flagging it as a
// leak would ask someone to "fix" a deliberate decision. Such findings are marked deliberate, listed
// SEPARATELY, and excluded from the count a gate would fail on — visible, but not a defect.
// Inherited down the subtree: a dir="ltr" wrapper covers everything inside it.
// ★ ONLY A STATIC dir="ltr" MARKS AN ISLAND, and getting this wrong blinded a whole plugin.
// The first version also accepted a BOUND :dir whose expression merely CONTAINED 'ltr' — which
// matches `:dir="isRTL ? 'rtl' : 'ltr'"`, the correct locale-aware direction switch that every
// RTL-ready component puts on its ROOT. The effect was that such a component's entire template was
// treated as deliberate English and every leak in it silenced. regions-dashboard read 0 for exactly
// that reason: not clean, BLIND. A dynamic direction switch is the OPPOSITE of "this stays English"
// — it is the component promising to follow the reader's locale.
const hasLtr = (node) => (node.props || []).some((p) =>
  p.type === 6 && p.name === 'dir' && p.value?.content === 'ltr')

function walkTemplate(node, file, out, ltr = false) {
  if (!node) return
  // ★ NAME THE ISLAND THAT SUPPRESSED A STRING, not just the fact of suppression. The deliberate
  // bucket is the one place where over-claiming costs nothing and shows nothing: a 74-line island
  // hiding 27 strings and a one-line <bdi> read identically in a flat count. gospel found exactly
  // that on their own card — an island they believed was a caveat turned out to cover the honesty
  // prose as well. An island is an object with a size, so the report gives it one.
  const own = node.type === 1 && hasLtr(node)
  const inLtr = ltr || own
  const island = own
    ? { file, line: node.loc?.start?.line ?? 0, endLine: node.loc?.end?.line ?? 0, tag: node.tag || 'element' }
    : (ltr && typeof ltr === 'object' ? ltr : null)
  if (node.type === 2) {
    const raw = String(node.content || '').trim()
    if (raw.length && isProse(raw) && !allowedBy(raw)) out.push({ file, kind: 'template-text', text: raw, deliberate: !!inLtr, island })
  }
  if (node.type === 1) literalProps(node, file, out)
  if (node.type === 1) for (const p of node.props || []) {
    if (p.type === 6 && VISIBLE_ATTRS.has(p.name)) {
      const v = p.value && p.value.content
      if (v && isProse(v) && !allowedBy(v)) out.push({ file, kind: `attr:${p.name}`, text: v, deliberate: !!inLtr, island })
    }
    // (interpolations are handled below, on the node itself)
    // type 7 = DIRECTIVE. v-bind carries the attribute name in `arg`.
    if (p.type === 7 && p.name === 'bind' && p.exp?.content) {
      const attrName = p.arg?.content || 'bind'
      // :style and :class carry CSS and identifiers, never prose. Skipping them by ATTRIBUTE is
      // better than allow-listing their contents: `background-image: url(` has no semicolon and so
      // slipped the CSS shape test, and widening that test to catch it would start swallowing real
      // sentences that happen to contain a colon.
      if (attrName !== 'style' && attrName !== 'class') {
        const before = out.length
        scanBoundExpr(p.exp.content, file, attrName, out)
        for (let i = before; i < out.length; i++) { out[i].deliberate = !!inLtr; out[i].island = island }
      }
    }
  }
  // type 5 = INTERPOLATION. `{{ cond ? 'Yes' : 'No' }}` is the same defect as a bound attribute —
  // a literal the reader sees, assembled in an expression the template walker would otherwise skip.
  // `{{ t('Foo') }}` stays quiet because the expression is parsed with the same translator rules.
  if (node.type === 5 && node.content?.content) {
    const before = out.length
    scanBoundExpr(node.content.content, file, 'interpolation', out)
    for (let i = before; i < out.length; i++) { out[i].deliberate = !!inLtr; out[i].island = island }
  }
  for (const c of node.children || []) walkTemplate(c, file, out, island || inLtr)
}

export function scanSfc(src, file) {
  const out = []
  const { descriptor, errors } = parse(src, { filename: file })
  if (errors && errors.length) throw new Error(`${file}: ${errors[0].message}`)
  if (descriptor.template && descriptor.template.ast) walkTemplate(descriptor.template.ast, file, out)
  const code = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n')
  if (code) { scanScript(code, file, out); out.push(...crossAreaKeys(code, file)) }
  return out
}

// ── production plugins: the scope this gate defends ─────────────────────────────────────────────
// Read from the built manifest so the list cannot drift from what actually ships.
// ★ EFFECTIVE stage, not declared stage. A production leaf composes other bundles at runtime, so a
// reader on a production page sees code from bundles that declare themselves experimental — and
// scoping by the declared stage held that code to the experimental bar. The rule and the graph live
// in lib/effective-stage.mjs, shared with check:frozen-labels so the two gates cannot disagree about
// what "production" means.
function productionPluginDirs(root = '.') {
  const mf = join(root, 'public/dx-maps/manifest.json')
  if (!existsSync(mf)) return []
  const m = JSON.parse(readFileSync(mf, 'utf8'))
  MANIFEST = m
  return productionForGating(m).map((n) => join(root, 'plugin-designs', n)).filter((d) => existsSync(d))
}
let MANIFEST = null
const sfcsIn = (dir) => {
  const out = []
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) { if (!/node_modules|dist|snapshots|fixtures/.test(e.name)) walk(p) }
    else if (e.name.endsWith('.vue')) out.push(p)
  } }
  walk(dir); return out
}

// ── self-test: the gate must be shown able to SEE, and able to stay quiet ────────────────────────
const PLANTED_BAD = `<template>
  <div :dir="isRTL ? 'rtl' : 'ltr'">
    <h2>Prayer Coverage</h2>
    <button title="Reset the map">x</button>
    <th :title="\`Sort this table by \${col}\`">h</th>
    <button :title="'Reset the view'">r</button>
    <span>{{ ok ? 'Everything loaded' : 'Nothing loaded' }}</span>
    <PosterWall unit="UPG" item-noun="list" event-name="doxa:show-on-map" />
    <p dir="ltr">Counted BY LANGUAGE, so groups collapse.</p>
    <div dir="ltr"><em>Source: eBible, checked 2026-09</em></div>
    <p><bdi dir="ltr">Of {{ tally.langs }} sign languages on this map, covering {{ tally.people }} people,
      {{ tally.both }} have both a film and a text Scripture.</bdi></p>
  </div>
</template>
<script setup>
import { a } from './a.js'
import { b } from '../b/c.js'
const msg = 'No results were found'
const split = \`\${a} polys · \${b} zones · \`
const ctx = \`\${n} countries\`
</script>`
const PLANTED_GOOD = `<template>
  <div class="rd-card is-open">
    <h2>{{ t('Prayer Coverage') }}</h2>
    <th :title="t('Sort this table')" :class="\`rd-card \${x}\`" :id="\`country-\${code}\`">h</th>
    <span>{{ t('Prayer Coverage') }}</span>
    <span>{{ n }} {{ t('Countries') }}</span>
  </div>
</template>
<script setup>
import { alpha } from './alpha.js'
import { beta } from '../beta/gamma.js'
const t2 = t
const viaAlias = t2('All Regions')
const guarded = te(key) ? t(key) : 'Regions List'
const cls = 'rd-card is-open'
const url = 'https://example.test/a/b'
const lang = \`\${l}-u-nu-latn\`
const err = \`HTTP \${res.status}\`
const lone = 'Other'
const proxyMiss = t.search || 'Search names, country, religion…'
const keyMiss = msg !== 'messages.engineMissing' ? msg : 'The map engine did not load.'
const devThrow = () => { throw new Error('table not found for this request') }
const devWarn = () => console.warn('boundaries failed to load for this map')
const host = document.querySelector('gospel-resources-dashboard, gospel-resources-map')
const one = el.closest('regions-dashboard, doxa-simple-map')
</script>`

const XAREA_BAD = `const t = useOptionalT('regions')
const msg = t('messages.engineMissing')`
// The wrapper shape: no literal namespace at the call site, so it is only detectable by resolving
// usePplrT() back to useOptionalT('pplr'). This is the shape pplr actually had.
const XAREA_WRAPPED = `const t = usePplrT()
const msg = t('messages.mapUnavailable')`
const XAREA_GOOD = `const t = useOptionalT('messages')
const msg = t('engineMissing')
const t2 = useOptionalT('regions')
const ok2 = t2('Countries')`

// ★ EFFECTIVE STAGE: a production leaf pulls experimental bundles into the production bar.
const STAGE_FIXTURE = {
  bundles: [
    { bundle: 'leaf-prod', stage: 'production', composes: ['mid-exp', 'pair/with-profile'] },
    { bundle: 'mid-exp', stage: 'experimental', composes: ['deep-exp'] },
    { bundle: 'deep-exp', stage: 'experimental' },
    { bundle: 'pair', stage: 'experimental' },
    { bundle: 'lonely-exp', stage: 'experimental' },
    // ★ CYCLES ARE REAL IN THIS MANIFEST, not hypothetical: six edges are self-composition via the
    // bundle/profile form (country-posters, my-upg-100-list, regions-dashboard all compose
    // themselves), and upg100 measured that a naive recursive walk hangs on it TODAY. The header
    // claimed termination in prose and never tested it, which is the same gap as an untested
    // fallback — so a self-cycle and a mutual cycle are both in the fixture. If the closure ever
    // regresses to recursion this test does not fail, it HANGS, which is its own loud signal.
    { bundle: 'selfie', stage: 'production', composes: ['selfie/one', 'selfie/two', 'ring-a'] },
    { bundle: 'ring-a', stage: 'experimental', composes: ['ring-b'] },
    { bundle: 'ring-b', stage: 'experimental', composes: ['ring-a'] },
  ],
}

function selfTest() {
  let fails = 0
  const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }
  // ★ THE FIXTURES MUST PARSE, ASSERTED FIRST. sr's first planted sample was malformed Vue, so the
  // scan found nothing in it and LOOKED blind — a broken fixture and a broken scanner produce the
  // same silence. parse() surfaces template errors that scanSfc would otherwise throw on.
  for (const [name, src] of [['planted-bad', PLANTED_BAD], ['planted-good', PLANTED_GOOD]]) {
    const { errors } = parse(src, { filename: `${name}.vue` })
    ok(!errors || errors.length === 0, `FIXTURE ${name}.vue is valid Vue${errors && errors.length ? ': ' + errors[0].message : ''}`)
  }
  const bad = scanSfc(PLANTED_BAD, 'planted-bad.vue')
  const good = scanSfc(PLANTED_GOOD, 'planted-good.vue')
  ok(bad.some((f) => f.kind === 'template-text' && f.text === 'Prayer Coverage'), 'SEES a hardcoded heading in the TEMPLATE')
  ok(bad.some((f) => f.kind === 'attr:title'), 'SEES a hardcoded title= attribute')
  ok(bad.some((f) => f.kind === 'script-string' && f.text === 'No results were found'), 'SEES a hardcoded sentence in a SCRIPT BLOCK')
  ok(bad.some((f) => f.kind === 'template-literal' && f.text === 'countries'), 'SEES English inside a TEMPLATE LITERAL (the class that held a real defect)')
  ok(bad.some((f) => f.kind === 'bind:title' && /Sort this table by/.test(f.text)), 'SEES a TEMPLATE LITERAL inside a bound attribute (sr: every scanner missed this)')
  ok(bad.some((f) => f.kind === 'bind:title' && f.text === 'Reset the view'), "SEES a quoted '…' literal inside a bound attribute (both quote styles)")
  ok(bad.some((f) => f.kind === 'bind:interpolation' && /Everything loaded|Nothing loaded/.test(f.text)), 'SEES a literal inside an INTERPOLATION expression')
  const splits = bad.filter((f) => /polys|zones/.test(f.text))
  ok(splits.length === 1, `a split template literal is ONE finding, not one per fragment (got ${splits.length})`)
  ok(splits.length === 1 && /polys.*\{…\}.*zones/.test(splits[0].text), 'and it is reported as the WHOLE string with its holes marked')
  // ★ literal props handed to a component that may render them (gospel's poster-wall case)
  const sus = bad.filter((f) => f.suspect)
  ok(sus.some((f) => f.kind === 'suspect-prop:unit' && /UPG/.test(f.text)), 'SEES a literal prop whose name suggests it is rendered (unit=)')
  ok(sus.some((f) => f.kind === 'suspect-prop:item-noun'), 'and one named item-noun')
  ok(!sus.some((f) => /event-name/.test(f.kind)), 'QUIET on a prop whose name does not suggest rendering (event-name=)')
  ok(!bad.filter((f) => !f.deliberate && !f.suspect).some((f) => /UPG|item-noun/.test(f.text)),
    'a SUSPECT is reported separately and is NOT counted as a leak — the child may never render it')
  const ltr = bad.filter((f) => f.deliberate && !f.suspect)
  ok(ltr.some((f) => /Counted BY LANGUAGE/.test(f.text)), 'marks text inside dir="ltr" as DELIBERATE, not a leak')
  ok(ltr.some((f) => /Source: eBible/.test(f.text)), 'and INHERITS the marker down the subtree')
  // ★ a suppressed string must name the island that suppressed it, so an over-broad island is
  // visible as an object with a size rather than as part of a flat total.
  ok(ltr.every((f) => f.island && typeof f.island.line === 'number'),
    'every suppressed string carries the ISLAND that suppressed it (file, line, tag)')
  ok(new Set(ltr.map((f) => f.island && f.island.line)).size >= 2,
    'and distinct islands are distinguished, not merged into one bucket')
  // ★ gospel's real case: an island SPLIT BY INTERPOLATIONS. Each run between two {{ }} is its own
  // text node, so a check that only marked a whole-text island reported the pieces as separate
  // leaks — and they nearly got translated. <bdi dir="ltr"> is the element they actually use.
  const splitIsland = bad.filter((f) => /sign languages on this map|both a film/.test(f.text))
  ok(splitIsland.length > 0, 'sees the pieces of an interpolation-split island at all')
  ok(splitIsland.every((f) => f.deliberate),
    `every piece of an interpolation-split dir="ltr" island is DELIBERATE (got ${splitIsland.filter((f) => !f.deliberate).length} not marked)`)
  ok(bad.filter((f) => !f.deliberate).some((f) => f.text === 'Prayer Coverage'), 'while a leak OUTSIDE the island is still counted')
  // ★ THE FIXTURE ROOT CARRIES :dir="isRTL ? 'rtl' : 'ltr'" — the correct locale-aware switch every
  // RTL-ready component puts on its root. An earlier version matched any bound :dir containing the
  // text 'ltr' and so treated the WHOLE component as deliberate English, silencing every leak in it.
  // regions-dashboard read 0 for that reason: not clean, blind. Every assertion above now runs inside
  // such a component, so the blindness cannot come back without the whole self-test failing.
  ok(bad.filter((f) => !f.deliberate).length >= 4,
    `a DYNAMIC :dir switch is not an English island — leaks inside it are still counted (got ${bad.filter((f) => !f.deliberate).length})`)
  ok(!good.some((f) => f.text === 'All Regions'), 'QUIET on a call through an ALIAS of t()')
  ok(!good.some((f) => f.text === 'Regions List'), 'QUIET on a te()-guarded fallback')
  ok(!good.some((f) => String(f.kind).startsWith('bind:')), 'QUIET on a bound attribute that IS a translator call')
  ok(!good.some((f) => /Search names/.test(f.text)), 'QUIET on a proxy-t member miss (t.search || …) — a fallback, not a leak')
  ok(!good.some((f) => f.kind === 'bind:interpolation'), 'QUIET on interpolations that are translator calls or bare values')
  ok(!good.some((f) => /map engine did not load/.test(f.text)), 'QUIET on the "did t() return the key?" miss idiom (msg !== \'a.dotted.key\')')
  ok(!good.some((f) => /table not found/.test(f.text)), 'QUIET on a throw new Error(…) argument — exempt by CALL SITE')
  ok(!good.some((f) => /boundaries failed/.test(f.text)), 'QUIET on a console.warn(…) argument')
  ok(!good.some((f) => /gospel-resources-dashboard|regions-dashboard, doxa/.test(f.text)),
    'QUIET on a DOM query selector, including a comma-separated list of custom-element tags')
  ok(!good.some((f) => /rd-card|example\.test|nu-latn|HTTP/.test(f.text)), 'QUIET on css, urls, locale extensions and developer error text')
  ok(good.length === 0, `QUIET overall on a correct file (got ${good.length}${good.length ? ': ' + JSON.stringify(good[0]) : ''})`)
  // The blind spot is PINNED, not merely mentioned: if single-word detection is ever added, this
  // fails and whoever adds it must update the header rather than leave it claiming a gap that closed.
  ok(!good.some((f) => f.text === 'Other'), 'DOCUMENTED BLIND SPOT: a single-word leak is NOT reported (see header)')
  // ★ CROSS-AREA KEYS: a real bug found twice in one day, and the shape both instances had.
  const xb = crossAreaKeys(XAREA_BAD, 'planted-xarea.vue')
  const xg = crossAreaKeys(XAREA_GOOD, 'planted-xarea-ok.vue')
  ok(xb.length === 1 && /never resolves/.test(xb[0].text),
    'SEES a cross-area key through a namespaced t() (qualified misses, unqualified exists)')
  ok(xg.length === 0, `QUIET when the key resolves under its own namespace (got ${xg.length})`)
  const xw = crossAreaKeys(XAREA_WRAPPED, 'planted-xarea-wrapped.vue')
  ok(xw.length === 1 && /pplr\.messages\.mapUnavailable/.test(xw[0].text),
    'SEES it through a WRAPPER factory with no literal namespace (usePplrT() → useOptionalT(\'pplr\'))')
  const eff = productionForGating(STAGE_FIXTURE)
  ok(eff.includes('mid-exp'), 'an experimental bundle COMPOSED by a production leaf is production-for-gating')
  ok(eff.includes('deep-exp'), 'and TRANSITIVELY — composition nests, so one pass is not enough')
  ok(eff.includes('pair'), "a composes entry of the form 'bundle/profile' resolves to its BUNDLE")
  ok(!eff.includes('lonely-exp'), 'CONTROL: an experimental bundle nobody composes stays out of scope')
  ok(stageReason(STAGE_FIXTURE, 'mid-exp').startsWith('composed by'), 'and the report can say WHY it is in scope')
  ok(eff.includes('selfie'), 'a SELF-COMPOSING bundle resolves rather than looping (6 such edges exist in the real manifest)')
  ok(eff.includes('ring-a') && eff.includes('ring-b'), 'and a MUTUAL cycle terminates, marking both members')
  console.log(fails ? `\nSELF-TEST: ${fails} FAIL(s)` : '\nSELF-TEST: the gate can see planted leaks and stays quiet on correct code')
  return fails
}

// Short HEAD sha plus a dirty marker, or 'unknown' outside a checkout.
function treeStamp() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return dirty ? `${sha}+dirty(${dirty.split('\n').length} file(s))` : sha
  } catch { return 'unknown (not a git checkout)' }
}

// ── CANARY MODE: turn "plugin X = 0" from a claim into a proven 0 ───────────────────────────────
// ★ WHY THIS EXISTS. Both serious bugs in this gate made it QUIETER — the single-word blind spot and
// the dynamic-:dir island bug, which silenced a whole plugin's template. A scan that under-reports is
// indistinguishable from code that is fine, so a zero is only worth what its detector is worth ON
// THAT FILE. Canary mode plants a known leak in each production SFC and requires it to be caught:
// a plugin that cannot catch a planted leak cannot be trusted to report zero.
//
// IN MEMORY, NOT IN A TEMP DIR. scanSfc takes a source string, so nothing is copied to disk — there
// is no cleanup to get wrong, nothing to leave behind on a box that has been short of space all day,
// and no chance of scanning a stale copy.
const CANARY = 'Canary sentinel sentence that must be reported'

// Injected as a text node INSIDE the template root, so it inherits whatever the root carries. That
// is deliberate: if a plugin's root marks it as a deliberate-English island, the canary is reported
// as deliberate rather than as a leak, and the run says so — which is exactly the state that made
// regions-dashboard read 0 while being blind.
// ★ INSIDE THE ROOT ELEMENT, AND LOCATED BY THE PARSER. Two earlier attempts were wrong for the
// same reason in different ways. Injecting after <template> made the canary a SIBLING of the root,
// so it inherited none of the root's attributes — and a root-level attribute is exactly what blinded
// regions-dashboard, so that canary would have passed a plugin it could not see. Then finding the
// root tag with a regex broke on `:group-by="(item) => regionFor(item.id)"`, because the `>` of the
// arrow function ends the match mid-attribute and corrupts the file.
// A REGEX CANNOT TOKENISE MARKUP ANY MORE THAN IT CAN TOKENISE JAVASCRIPT — the third time that has
// cost something today — so the parser locates the root's first child and the canary goes there.
function withCanary(src, file) {
  let descriptor
  try { ({ descriptor } = parse(src, { filename: file })) } catch { return null }
  const root = descriptor?.template?.ast?.children?.find((c) => c.type === 1 || c.type === 2)
  const first = root && root.type === 1 ? (root.children || [])[0] : root
  const at = first?.loc?.start?.offset
  if (typeof at !== 'number') return null
  // template.ast offsets are relative to the whole file for compiler-sfc's parse, so slice directly.
  return src.slice(0, at) + `<span>${CANARY}</span>` + src.slice(at)
}

function canaryMode() {
  const dirs = productionPluginDirs('.')
  let fails = 0, checked = 0
  const skipped = []
  console.log('  CANARY: planting one known leak per SFC and requiring it to be caught\n')
  for (const d of dirs) {
    const plugin = d.split('/').pop()
    const files = sfcsIn(d)
    const bad = []
    for (const f of files) {
      const src = withCanary(readFileSync(f, 'utf8'), f)
      // ★ A SKIP IS NOT A PASS, and hiding it would repeat the mistake this whole mode exists to
      // prevent: a file nobody could plant a canary in is a file whose zero is unproven. Reported.
      if (src === null) {
        // ★ TRIAGE THE SKIP. "Unplantable" is two different states and they carry opposite risk: a
        // component with no text surface has nothing to leak, while one that hands literal English
        // to a child has a leak this gate cannot confirm. Reporting them together would bury the
        // second in the first — which is how gospel's poster-wall case sat inside a bland count.
        let why = 'no text surface'
        try {
          const probe = scanSfc(readFileSync(f, 'utf8'), f)
          const sp = probe.filter((x) => x.suspect)
          if (sp.length) why = `PASSES ${sp.length} LITERAL PROP(S) — ${sp.map((x) => x.text).join(', ')}`
        } catch { why = 'unparseable' }
        skipped.push(`${plugin}/${f.split('/').pop()} — ${why}`)
        continue
      }
      checked++
      let found
      try { found = scanSfc(src, f) } catch (e) { bad.push(`${f.split('/').pop()} (parse: ${e.message})`); continue }
      const hit = found.find((x) => String(x.text).includes(CANARY))
      if (!hit) bad.push(`${f.split('/').pop()} (NOT CAUGHT)`)
      else if (hit.deliberate) bad.push(`${f.split('/').pop()} (caught but marked DELIBERATE — this plugin is islanded at its root)`)
    }
    if (bad.length) { fails++; console.log(`  FAIL ${plugin}: ${bad.join('; ')}`) }
    else console.log(`  ok   ${plugin}: ${files.length} SFC(s), every canary caught as a leak`)
  }
  if (skipped.length) {
    console.log(`\n  ${skipped.length} SFC(s) SKIPPED — no plantable first child, so their zero is UNPROVEN:`)
    for (const f of skipped) console.log(`   · ${f}`)
  }
  console.log(fails
    ? `\nCANARY: ${fails} plugin(s) cannot be trusted to report zero  ·  tree ${treeStamp()}`
    : `\nCANARY: every production plugin catches a planted leak (${checked} of ${checked + skipped.length} SFCs; ${skipped.length} unproven)  ·  tree ${treeStamp()}`)
  return fails
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
// RUN ONLY WHEN INVOKED DIRECTLY. Without this guard, `import`ing the module to reuse scanSfc() runs
// the whole production scan as a side effect — which is how I first "verified" it against sr's real
// example and got a full gate run instead of one file's findings. A gate that cannot be imported
// cannot be unit-tested by whoever owns it.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (!isMain) { /* imported: expose scanSfc and do nothing */ }
else main()

function main() {
if (process.argv.includes('--canary')) process.exit(canaryMode() ? 1 : 0)
const selfOnly = process.argv.includes('--self-test')
let fails = selfTest()
if (fails) { console.log('\nHARDCODED-ENGLISH: self-test failed — findings below would not be trustworthy'); process.exit(1) }
if (selfOnly) process.exit(0)

const dirs = productionPluginDirs('.')
const findings = []
let files = 0
try {
  for (const d of dirs) for (const f of sfcsIn(d)) { files++; findings.push(...scanSfc(readFileSync(f, 'utf8'), f)) }
} catch (e) { console.error('HARDCODED-ENGLISH: parse error —', e.message); process.exit(2) }

const deliberate = findings.filter((f) => f.deliberate && !f.suspect)
const suspects = findings.filter((f) => f.suspect)
const leaks = findings.filter((f) => !f.deliberate && !f.suspect)
// ★ THE RUN NAMES ITS OWN SHA. Three reports today were true of an older artifact than the one in
// hand, and each cost someone a wasted investigation — the last one nearly had a working island
// check "fixed". gospel's corollary is that the reader cannot check what the writer did not say, so
// the tool says it: any number quoted from this output carries the tree it was measured on, and a
// dirty tree is marked because then the sha alone does not describe what ran.
//
// ★ AND IT PROVED ITSELF WITHIN THE HOUR, in the case that justifies it better than the one it was
// built for. gospel and I compared counts and disagreed — 185/169/155 against 178/168/147 — and
// spent the exchange assuming one set was stale. Neither was: SAME SCRIPT SHA, DIFFERENT SOURCE
// TREES, twelve scanned SFCs apart. Both numbers were honest measurements of different bytes.
// "7 production plugin(s), 19 SFC(s) scanned" describes the SHAPE of a scan and says nothing about
// WHICH BYTES, so two correct runs are indistinguishable in a report. The stamp is therefore not
// only for the writer who forgets to name a sha — it is what lets a READER tell two runs apart at
// all. When counts disagree, compare the tree line before anything else.
const composed = MANIFEST ? dirs.map((d) => d.split('/').pop()).filter((n) => stageReason(MANIFEST, n).startsWith('composed')) : []
console.log(`\n  ${dirs.length} production-for-gating plugin(s), ${files} SFC(s) scanned  ·  tree ${treeStamp()}`)
if (composed.length) {
  // Named, because "why is this experimental bundle in a production scan?" is the first question a
  // reader will have, and the answer is a fact about the composition graph rather than a judgement.
  console.log(`  including ${composed.length} reached only by composition: ${composed.map((n) => `${n} (${stageReason(MANIFEST, n)})`).join('; ')}`)
}
for (const f of leaks) console.log(`   ${f.kind.padEnd(16)} ${f.file.replace(/^.*plugin-designs\//, '')}  ${JSON.stringify(f.text).slice(0, 90)}`)
if (deliberate.length) {
  // Listed so nobody wonders where they went, but NOT counted: dir="ltr" is the plugin's own marker
  // for content the Driver ruled stays English. Asking someone to "fix" these would be asking them
  // to undo a decision.
  // PER ISLAND, LARGEST FIRST. A big island is not automatically wrong, but it is the shape an
  // over-broad one has, and a flat total cannot show it. Size is reported in LINES as well as
  // strings, because "one attribute covering 74 lines" is the fact that makes someone look.
  const byIsland = new Map()
  for (const f of deliberate) {
    const k = f.island ? `${f.island.file}:${f.island.line}` : '(unattributed)'
    const e = byIsland.get(k) || { k, n: 0, island: f.island }
    e.n++
    byIsland.set(k, e)
  }
  const islands = [...byIsland.values()].sort((a, b) => b.n - a.n)
  console.log(`\n  ${deliberate.length} inside dir="ltr" islands — DELIBERATE English, not counted, across ${islands.length} island(s):`)
  for (const i of islands.slice(0, 10)) {
    const loc = i.island ? `${i.island.file.replace(/^.*plugin-designs\//, '')}:${i.island.line}` : i.k
    const lines = i.island && i.island.endLine > i.island.line ? `, ${i.island.endLine - i.island.line + 1} lines` : ''
    console.log(`   · ${loc}  <${i.island?.tag ?? '?'}>  ${i.n} string(s)${lines}`)
  }
  if (islands.length > 10) console.log(`   · …and ${islands.length - 10} more island(s)`)
}
if (suspects.length) {
  // NOT counted. Whether the child renders the prop is not knowable from here, so this is a question
  // for a human rather than a defect. It is the only visibility we have into a class the gate cannot
  // confirm: the English is in one file and the render is in another.
  console.log(`\n  ${suspects.length} SUSPECT literal prop(s) — English handed to a component that may render it:`)
  for (const f of suspects) console.log(`   ? ${f.file.replace(/^.*plugin-designs\//, '')}  ${f.text}`)
}
// ★ THE STAMP GOES ON THE LINE PEOPLE QUOTE, not only on the header. gospel's qualification is that
// they investigated our mismatch because the ARITHMETIC WOULD NOT CLOSE — an eight-hit gap was too
// large to rationalise — and that a gap of one or two would have been shrugged off as drift. So the
// residual failure is a discrepancy SMALL ENOUGH TO EXPLAIN AWAY, and provenance in a header the
// quoter skips does nothing for it. The verdict line is the one that gets pasted into a report, so
// the tree travels with the number rather than three lines above it.
console.log(leaks.length
  ? `\nHARDCODED-ENGLISH: ${leaks.length} user-visible English string(s) not going through t()  [tree ${treeStamp()}]`
  : `\nHARDCODED-ENGLISH: PASS — no user-visible hardcoded English in any production plugin  [tree ${treeStamp()}]`)
process.exit(leaks.length ? 1 : 0)
}
