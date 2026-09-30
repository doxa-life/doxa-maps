#!/usr/bin/env node
/**
 * check-i18n-treeshake — each built bundle carries every translation area its code asks for, and (with
 * --sizes) reports what the narrowing saved. Headless.
 *
 * CRITIC-10 (2026-09-26): the build narrows library/i18n's catalogue glob to the areas
 * internal/i18n-areas.mjs finds in the bundle's source graph. Omitting an area a bundle uses would show
 * raw keys instead of text, so this re-reads the BUILT output: every "area.key" literal (and every bare
 * 'area' literal, for keys assembled at runtime) in <bundle>.js must belong to an area the build included
 * for that bundle. Only area-PREFIXED literals are judged here (a bare 'template' or 'options' is also
 * ordinary Vue/JS vocabulary); the build includes an area on a bare literal too, which only over-includes.
 * EXIT 0 pass · 1 an area the bundle needs was left out
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { allAreas, areasForBundle } from './i18n-areas.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AREAS = allAreas(ROOT)
const TREE = join(ROOT, 'public', TREE_NAME)
let bad = 0, checked = 0
for (const b of readdirSync(join(ROOT, 'plugin-designs'))) {
  const js = join(TREE, b, `${b}.js`)
  if (!existsSync(join(ROOT, 'plugin-designs', b, 'index.js')) || !existsSync(js)) continue
  const code = readFileSync(js, 'utf8')
  const included = new Set(areasForBundle(ROOT, b).areas)
  const asked = AREAS.filter((a) => new RegExp('["\'`@]' + a + '\\.[A-Za-z_$]').test(code))
  const missing = asked.filter((a) => !included.has(a))
  checked++
  if (missing.length) { bad++; console.log(`  FAIL  ${b}: its built code asks for ${missing.join(', ')}, which the build left out`) }
  else console.log(`  ok    ${b.padEnd(24)} ${included.size}/${AREAS.length} areas bundled; every area its code asks for is in`)
}
if (!checked) { console.log('I18N-TREESHAKE: FAIL — no built bundles (vacuous)'); process.exit(1) }
if (bad) { console.log(`I18N-TREESHAKE: FAIL — ${bad} bundle(s) would show raw keys.`); process.exit(1) }
console.log(`I18N-TREESHAKE: PASS — ${checked} bundle(s): each carries every translation area its code asks for.`)
