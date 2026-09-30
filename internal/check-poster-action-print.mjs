#!/usr/bin/env node
/**
 * check-poster-action-print — a poster button prints unless its consumer says why it downloads. Headless.
 *
 * Driver rule 2026-09-28: an export-poster button opens the PRINT DIALOG with a preview, never a direct
 * download. PosterWall defaults posterAction to 'print'; this asserts that (a) the default stays 'print',
 * and (b) any consumer passing posterAction 'download' has a `posterAction-download:` comment with its
 * reason within the 3 lines above.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const fail = (m) => { bad++; console.log('  FAIL  ' + m) }

const wall = readFileSync(join(ROOT, 'library/components/poster/PosterWall.vue'), 'utf8')
if (!/posterAction:\s*\{\s*type:\s*String,\s*default:\s*'print'\s*\}/.test(wall)) fail("PosterWall's posterAction default is not 'print'")
// PosterDialog too (gospel's audit, card 7): its Render button only ever downloaded.
const dialog = readFileSync(join(ROOT, 'library/components/poster/PosterDialog.vue'), 'utf8')
if (!/action:\s*\{\s*type:\s*String,\s*default:\s*'print'\s*\}/.test(dialog)) fail("PosterDialog's action default is not 'print'")

const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}
const USE = /(?:posterAction|<PosterDialog[^>]*\baction)\s*[=:]\s*["']download["']|:poster-action\s*=\s*["']'download'["']|poster-action\s*=\s*["']download["']/
let optIns = 0
for (const f of [...walk(join(ROOT, 'plugin-designs')), ...walk(join(ROOT, 'library'))]) {
  if (f.endsWith('PosterWall.vue') || f.endsWith('PosterDialog.vue')) continue
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((l, i) => {
    if (!USE.test(l)) return
    optIns++
    const above = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
    if (!/posterAction-download:\s*\S/.test(above)) fail(`${relative(ROOT, f)}:${i + 1} opts into posterAction 'download' without a "posterAction-download: <why>" comment`)
  })
}
if (bad) { console.log(`POSTER-ACTION-PRINT: FAIL — ${bad} problem(s).`); process.exit(1) }
console.log(`POSTER-ACTION-PRINT: PASS — PosterWall prints by default; ${optIns} explicit download opt-in(s), each with its reason.`)
