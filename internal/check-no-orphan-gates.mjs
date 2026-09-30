#!/usr/bin/env node
/**
 * check-no-orphan-gates.mjs — a gate that nothing can run is not a gate.
 *
 * THE DEFECT THIS CATCHES. `internal/verify-shell-scroll.mjs` was written, negative-tested, and
 * proved a real Driver-reported bug with hard numbers (2586px of mounted grid, a real wheel gesture
 * moving 0px). Then it sat unreachable: no `package.json` entry, no importer. It would never have
 * run again. The repo has already carded this once —
 * BUILD-BROWSER-GATES-WERE-ALL-ORPHANS-ONE-COMMAND-RUNS-THEM — and it recurred anyway, because
 * writing a gate and REGISTERING a gate are two separate acts and only the first feels like work.
 *
 * ★ THE DISTINCTION THIS GATE HAS TO GET RIGHT, or it becomes noise nobody reads: not every
 * unreferenced file in internal/ is a lost gate.
 *   - `vite-plugin-strip-shadow-css-comments.mjs` is imported by vite.config.js — it runs on every
 *     build. Reachable.
 *   - `long-frames-probe.mjs` is imported by two library composables. Reachable.
 *   - `mobile-sheet-probe.mjs`, `theme-flash-probe.mjs`, `readme-shots-fix.mjs` are DATED ONE-SHOT
 *     DIAGNOSTICS (Sept 17/21) written to answer one question about a bug that is now fixed. They
 *     are history, not decay — deleting them would throw away a reproduction recipe, and wiring them
 *     up would add three checks nobody wants run.
 * So the rule is not "everything must be wired". The rule is: a file that PRESENTS ITSELF as a gate
 * must be runnable, and a file that is a one-shot probe must SAY SO. Anything else is ambiguous, and
 * ambiguity is exactly how a real gate hides among abandoned scripts.
 *
 * HOW A FILE DECLARES ITS INTENT (either is enough):
 *   - be referenced from package.json scripts, or imported by something that is; or
 *   - carry `@one-shot` in its header comment, naming it a diagnostic that is not expected to run
 *     again. The tag is cheap to add and makes the author state which kind of thing they wrote.
 *
 * WHAT IT ASSERTS: every internal/*.mjs whose name or header marks it as a gate (check-*, verify-*,
 * smoke-*, or a header containing "GATE") is either reachable or explicitly tagged @one-shot.
 *
 * NEGATIVE-TESTED: removing the check:shell-scroll entry from package.json makes this fail by name.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRaw = readFileSync(join(ROOT, 'package.json'), 'utf8')

const files = readdirSync(join(ROOT, 'internal')).filter((f) => f.endsWith('.mjs'))

const SELF = 'check-no-orphan-gates.mjs'

/**
 * A file is reachable if package.json names it, or if some OTHER source file imports it.
 *
 * ★ THE EXCLUSION OF THIS FILE IS LOad-BEARING, not tidiness. First version of this gate listed
 * `theme-flash-probe.mjs` in its own header as an example of a dated diagnostic — then grepped for
 * importers, found ITSELF, and declared the file reachable. The gate written to catch orphans made
 * an orphan pass, by citing it. A gate must never be its own witness.
 *
 * Same family as the `@one-shot` bug found in the same run: the tag-detection matched this file's
 * own prose explaining what the tag means, so the gate reported "1 tagged @one-shot" when no file
 * had ever been tagged. Both defects come from reading EVIDENCE out of DOCUMENTATION. Where a gate
 * must describe the thing it checks, it has to exclude its own text from the check.
 */
function reachable(base) {
  if (pkgRaw.includes(base)) return 'package.json'
  try {
    const hits = execSync(
      `grep -rl -- ${JSON.stringify(base.replace(/\.mjs$/, ''))} --include=*.mjs --include=*.js --include=*.ts . 2>/dev/null | grep -v node_modules | grep -v "internal/${base}" | grep -v "internal/${SELF}" || true`,
      { cwd: ROOT, encoding: 'utf8' }
    ).trim()
    if (hits) return hits.split('\n')[0]
  } catch {}
  return null
}

const orphans = []
let checked = 0
let tagged = 0

for (const f of files) {
  const src = readFileSync(join(ROOT, 'internal', f), 'utf8')
  const header = src.slice(0, 2600)

  // Does this file present itself as a GATE (something meant to run repeatedly)?
  const looksLikeGate = /^(check|verify|smoke)-/.test(f) || /\bGATE\b|\bgate for\b/i.test(header)
  if (!looksLikeGate) continue
  checked++

  // The tag must be a MARKER on its own line (` * @one-shot  <reason>`), not the string appearing
  // anywhere in prose. This gate's own header discusses `@one-shot` at length, and a loose test
  // counted that discussion as a tag — reporting "1 tagged" when nothing had ever been tagged.
  // Requiring line-start-plus-comment-prefix makes the tag a deliberate act instead of a word.
  if (/^\s*(?:\*|\/\/)\s*@one-shot\b/m.test(header) && f !== SELF) { tagged++; continue }
  const via = reachable(f)
  if (!via) orphans.push(f)
}

if (orphans.length) {
  console.error(`NO-ORPHAN-GATES: FAIL — ${orphans.length} gate(s) exist but nothing can run them.\n`)
  for (const f of orphans) {
    console.error(`  internal/${f}`)
  }
  console.error('\n  A gate nobody can invoke is a file, not a check. Pick one:')
  console.error('    1. add a package.json script (and, if it needs a browser, an entry in the GATES')
  console.error('       array of internal/verify-browser-all.mjs so the one-command suite runs it);')
  console.error('    2. or add `@one-shot` to its header if it was a diagnostic for a single bug and')
  console.error('       is kept only as a reproduction recipe.')
  console.error('\n  This already happened once (card BUILD-BROWSER-GATES-WERE-ALL-ORPHANS). It recurs')
  console.error('  because writing a gate and registering it are separate acts, and only the first')
  console.error('  one feels like the work.')
  process.exit(1)
}

// ── SECOND, DISTINCT QUESTION: does it RUN? ────────────────────────────────
// Reachable and wired are not the same property, and conflating them is how 70 of
// 100 check:* scripts came to sit outside every gate wave without anyone noticing —
// including this gate itself. A script entry means a human CAN run it; membership in
// gates:pre/gates:post means it runs on every build.
//
// This REPORTS rather than fails, deliberately. Most unwired gates are correctly
// hand-run: they need a served tree (check:mobile, check:shots), a device, a token,
// or an argument (check:packet-render takes a path). Failing the build on those
// would be wrong and the gate would be disabled within a day.
//
// ⚠ AND SOME MUST NEVER BE WIRED, which "it passes when I run it" cannot tell you.
// check:settled asserts the tree is QUIET — no builder running, no recent churn — so
// it fails inside a build BY DESIGN. Measured 2026-09-24: it passed twice standalone,
// was wired on that evidence, and failed the very next build (29/30). The test for
// wave membership is not "does it pass" but "is its assertion compatible with running
// mid-build". What it must not do is
// stay silent — a gate that could run and does not is indistinguishable from one
// that is broken, which is the exact failure verify-shell-scroll had.
const pkg = JSON.parse(pkgRaw)
const waves = `${pkg.scripts['gates:pre'] || ''} ${pkg.scripts['gates:post'] || ''}`
const checks = Object.keys(pkg.scripts).filter((k) => /^(check|verify|smoke):/.test(k)
  && !k.endsWith(':self-test'))
const unwired = checks.filter((k) => !waves.includes(k))
console.log(`  wave membership : ${checks.length - unwired.length}/${checks.length} `
  + `check/verify script(s) run in gates:pre or gates:post`)
if (unwired.length) {
  console.log(`  ${unwired.length} run only by hand — expected for gates needing a served tree, a`)
  console.log('  device, a token or an argument. If one of these needs no precondition, wire it:')
  for (const k of unwired.slice(0, 8)) console.log(`    · ${k}`)
  if (unwired.length > 8) console.log(`    …and ${unwired.length - 8} more`)
}

console.log(`NO-ORPHAN-GATES: PASS — ${checked} gate-shaped file(s); all reachable (${tagged} tagged @one-shot).`)
console.log('  Reachable means named in package.json or imported by something that is. The @one-shot')
console.log('  tag exists so a dated diagnostic can be KEPT as a reproduction recipe without either')
console.log('  masquerading as a live check or being deleted for tidiness.')
