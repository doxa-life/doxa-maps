#!/usr/bin/env node
/**
 * check-mobile-gating.mjs — the SPA's device rules stay on the right shelves (DRV1650-MOBILE-GATING).
 *
 *   DESKTOP_ONLY   production rows BLOCKED on a narrow screen (disabled + "desktop only" + a message)
 *   MOBILE_NOTICE  experimental rows that OPEN on a narrow screen, with a "not built for mobile" notice
 *
 * Headless: reads plugin-designs/doxa-maps-spa/doxa-maps-spa.vue and src/strings.js. It fails if:
 *   · a DESKTOP_ONLY id is not a curated (production) tab, or a MOBILE_NOTICE id is not an Experimental
 *     bundle (curated, excluded, or no plugin folder), or an id is in both sets;
 *   · the predicates stop reading their set and the narrow flag, or the pane notice stops rendering;
 *   · any locale lacks mobileNotBuilt / mobileNotice / dismiss / desktopNotice, or desktopNotice
 *     stops naming the map ({label}), which it must now that more than one map can be desktop-only.
 * `--self-test` proves every rule can fail on a planted bad case before trusting a pass.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPA = join(ROOT, 'plugin-designs/doxa-maps-spa/doxa-maps-spa.vue')
const STRINGS = join(ROOT, 'plugin-designs/doxa-maps-spa/src/strings.js')
const KEYS = ['mobileNotBuilt', 'mobileNotice', 'dismiss', 'desktopNotice']

const setOf = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`))
  return m ? new Set([...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])) : null
}

export function checkGating(src, locales, hasPlugin) {
  const errs = []
  const desk = setOf(src, 'DESKTOP_ONLY'), mob = setOf(src, 'MOBILE_NOTICE'), notExp = setOf(src, 'NOT_EXPERIMENTAL')
  if (!desk) errs.push('DESKTOP_ONLY set not found')
  if (!mob) errs.push('MOBILE_NOTICE set not found')
  if (!notExp) errs.push('NOT_EXPERIMENTAL set not found')
  if (errs.length) return errs
  const curated = new Set([...src.matchAll(/bundle: '([a-z0-9-]+)'/g)].map((x) => x[1]))
  for (const id of desk) if (!curated.has(id)) errs.push(`DESKTOP_ONLY "${id}" is not a curated production tab`)
  for (const id of mob) {
    if (curated.has(id)) errs.push(`MOBILE_NOTICE "${id}" is a curated production tab (production maps are blocked, not warned)`)
    if (notExp.has(id)) errs.push(`MOBILE_NOTICE "${id}" is excluded from the Experimental shelf`)
    if (!hasPlugin(id)) errs.push(`MOBILE_NOTICE "${id}" has no plugin-designs/${id} folder`)
    if (desk.has(id)) errs.push(`"${id}" is in BOTH sets`)
  }
  if (!/isDesktopOnly\(id\)\s*\{\s*return DESKTOP_ONLY\.has\(id\) && this\.narrow/.test(src)) errs.push('isDesktopOnly no longer reads DESKTOP_ONLY + narrow')
  if (!/showsMobileNotice\(id\)\s*\{\s*return MOBILE_NOTICE\.has\(id\) && this\.narrow/.test(src)) errs.push('showsMobileNotice no longer reads MOBILE_NOTICE + narrow')
  if (!/v-if="showsMobileNotice\(t\.id\)"[^>]*role="status"/.test(src)) errs.push('the pane notice (showsMobileNotice, role=status) is not rendered')
  for (const [loc, t] of Object.entries(locales || {})) {
    for (const k of KEYS) if (!t || !String(t[k] || '').trim()) errs.push(`strings ${loc}: missing ${k}`)
    if (t && t.desktopNotice && !t.desktopNotice.includes('{label}')) errs.push(`strings ${loc}: desktopNotice does not name the map ({label})`)
  }
  if (!locales || Object.keys(locales).length < 11) errs.push(`strings: ${Object.keys(locales || {}).length} locales, expected 11`)
  return errs
}

async function loadLocales() {
  const mod = await import(pathToFileURL(STRINGS).href)
  return Object.values(mod).find((v) => v && typeof v === 'object' && v.en) || {}
}

if (process.argv.includes('--self-test')) {
  const src = readFileSync(SPA, 'utf8'), locales = await loadLocales()
  const yes = () => true
  const cases = [
    ['a clean tree passes', src, locales, yes, 0],
    ['a curated id in MOBILE_NOTICE', src.replace("new Set(['gospel-internet'])", "new Set(['gospel-internet', 'dashboard-plus-grid'])"), locales, yes, 1],
    ['an experimental id in DESKTOP_ONLY', src.replace("new Set(['dashboard-plus-grid'])", "new Set(['dashboard-plus-grid', 'gospel-internet'])"), locales, yes, 1],
    ['a MOBILE_NOTICE id with no plugin', src, locales, () => false, 1],
    ['the predicate stops reading narrow', src.replace('return DESKTOP_ONLY.has(id) && this.narrow', 'return DESKTOP_ONLY.has(id)'), locales, yes, 1],
    ['the pane notice is removed', src.replace('v-if="showsMobileNotice(t.id)"', 'v-if="false"'), locales, yes, 1],
    ['a locale loses mobileNotice', src, { ...locales, ar: { ...locales.ar, mobileNotice: '' } }, yes, 1],
    ['desktopNotice stops naming the map', src, { ...locales, zh: { ...locales.zh, desktopNotice: '仅支持桌面端' } }, yes, 1],
  ]
  let ok = true
  for (const [name, s, l, hp, want] of cases) {
    const n = checkGating(s, l, hp).length
    const pass = want === 0 ? n === 0 : n >= want
    if (!pass) ok = false
    console.log(`  ${pass ? '✓' : '✗'} ${name} -> ${n} error(s) (want ${want === 0 ? 0 : '≥' + want})`)
  }
  console.log(ok ? 'MOBILE-GATING SELF-TEST: PASS — every rule proven able to fail' : 'MOBILE-GATING SELF-TEST: FAIL')
  process.exit(ok ? 0 : 1)
}

const src = readFileSync(SPA, 'utf8')
const errs = checkGating(src, await loadLocales(), (id) => existsSync(join(ROOT, 'plugin-designs', id)))
if (errs.length) {
  console.error('MOBILE-GATING: FAIL\n' + errs.map((e) => '  ✗ ' + e).join('\n'))
  process.exit(1)
}
console.log(`MOBILE-GATING: PASS — desktop-only: ${[...setOf(src, 'DESKTOP_ONLY')].join(', ')} · mobile notice: ${[...setOf(src, 'MOBILE_NOTICE')].join(', ')} · 11 locales`)
