#!/usr/bin/env node
/**
 * check-legend-logical-insets.mjs — the legend components position themselves with LOGICAL insets.
 *
 * WHY: the shared legend (.stl-panel, its reopen button, the detail buttons, the tree-guide hairlines) used
 * `left: 8px`. MapToolbar uses `inset-inline-end`, which mirrors under dir="rtl"; a physical `left` does not.
 * So in Arabic the controls moved left onto a legend that stayed left, on three production maps at once
 * (Simple Research, Prayer Progress, UPG-100; rega's survey at 52eeb0db). The fix is inset-inline-start /
 * inset-inline-end; this gate keeps a physical left/right from coming back.
 *
 * WHAT IT READS: every CSS declaration in library/components/legends/*.vue (comments stripped). A
 * declaration `left:` / `right:` / `padding-left|right:` / `margin-left|right:` fails unless it is:
 *   - a centring or full-width rule, which is symmetric under RTL (`left:50%`, `left:0` beside `right:0`);
 *   - a reset to auto (`left:auto`), which undoes rather than places;
 *   - listed in ALLOWED below with the reason it may stay physical.
 * Inline :style bindings computed in JS (the progress bar's popover) are not CSS declarations and are not read.
 *
 * --self-test poisons a copy of one rule and asserts the gate notices: a gate that cannot fail proves nothing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'library/components/legends')

// file -> substrings of declarations that may stay physical, each with its reason.
const ALLOWED = {
  'LegendMobile.vue': [
    ['.mapboxgl-ctrl-attrib.mapboxgl-compact{margin-right', "the engine's own attribution control, which the engine places"],
  ],
  'LegendProgressBar.vue': [
    ['.lpb-pop{', 'the popover is placed by JS (popLeft) over the bar segment it describes'],
  ],
}

const PHYSICAL = /(^|[;{\s])((?:padding|margin)-(?:left|right)|left|right)\s*:\s*([^;}]+)/g

function findings(file, src) {
  const out = []
  const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|`([^`]*\{[^`]*\}[^`]*)`/g)].map((m) => m[1] ?? m[2])
  const allowed = ALLOWED[file] || []
  for (const css of styles) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of clean.split('}')) {
      const [sel = '', body = ''] = rule.split('{')
      const decl = sel.trim() + '{' + body
      for (const m of body.matchAll(PHYSICAL)) {
        const prop = m[2], val = m[3].trim().replace(/!important$/, '').trim()
        if (val === 'auto') continue
        if ((prop === 'left' || prop === 'right') && /^50%$/.test(val)) continue
        if (prop === 'left' && val === '0' && /right\s*:\s*0\b/.test(body)) continue
        if (prop === 'right' && val === '0' && /left\s*:\s*0\b/.test(body)) continue
        if (allowed.some(([s]) => decl.replace(/\s+/g, '').includes(s.replace(/\s+/g, '')))) continue
        out.push(`${file}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 70)} { ${prop}: ${val} }`)
      }
    }
  }
  return out
}

function run(read) {
  const all = []
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.vue')).sort()) all.push(...findings(f, read(f)))
  return all
}

const readReal = (f) => readFileSync(join(DIR, f), 'utf8')

if (process.argv.includes('--self-test')) {
  const poisoned = (f) => {
    const s = readReal(f)
    return f === 'SemanticTreeLegend.vue' ? s.replace('inset-inline-start: 8px; top: var(--stl-top', 'left: 8px; top: var(--stl-top') : s
  }
  const hit = run(poisoned)
  if (!hit.some((h) => h.includes('.stl-panel') && h.includes('left: 8px'))) {
    console.error('LEGEND-LOGICAL-INSETS self-test: FAIL — a poisoned `.stl-panel { left: 8px }` was not caught')
    process.exit(1)
  }
  console.log('LEGEND-LOGICAL-INSETS self-test: PASS — a physical `left: 8px` on .stl-panel is caught')
  process.exit(0)
}

const bad = run(readReal)
if (bad.length) {
  console.error(`LEGEND-LOGICAL-INSETS: FAIL — ${bad.length} physical left/right declaration(s) in the legend components:`)
  for (const b of bad) console.error('  ✗ ' + b)
  console.error('\n  A physical inset does not mirror under dir="rtl" while the map controls (inset-inline-end) do,')
  console.error('  so in Arabic they overlap. Use inset-inline-start / inset-inline-end (padding-/margin-inline-*),')
  console.error('  or add the rule to ALLOWED in this file with the reason it must stay physical.')
  process.exit(1)
}
console.log('LEGEND-LOGICAL-INSETS: PASS — every legend inset is logical, symmetric, or allowed with a reason.')
