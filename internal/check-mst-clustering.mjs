#!/usr/bin/env node
/**
 * check-mst-clustering — the "MST" clustering mode draws a true minimum spanning tree, fast enough to
 * run on the main thread. Headless.
 *
 * WHY (2026-09-26): MST built and sorted every pair of pins (~2.2 million edges for the 2,107-pin roster),
 * ~12 s on the main thread, twice over with a stats pass. Choosing "MST" froze the page, and the browser
 * gate check:clustering-modes read the map before any line existed ("MST drew no cluster lines").
 * MSTClusteringUtil now runs Prim in O(n²).
 *
 * ASSERTS  (1) on sizes 2-400, capped and uncapped, the util's tree has the SAME edge count and total
 *          length as a reference all-pairs Kruskal written here; (2) 2,107 pins in under 3 s.
 * EXIT 0 pass · 1 fail
 */
import MST from '../library/utils/MSTClusteringUtil.js'
import { euclideanDistance } from '../library/utils/ClusterHelpers.js'

const kruskal = (pts, cap) => {
  const e = []
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = euclideanDistance(pts[i].latitude, pts[i].longitude, pts[j].latitude, pts[j].longitude)
    if (d <= cap) e.push([d, i, j])
  }
  e.sort((a, b) => a[0] - b[0])
  const p = pts.map((_, i) => i), f = (x) => (p[x] === x ? x : (p[x] = f(p[x])))
  let n = 0, len = 0
  for (const [d, i, j] of e) { const a = f(i), b = f(j); if (a !== b) { p[a] = b; n++; len += d } }
  return { n, len }
}
const pts = (n, k = 1) => Array.from({ length: n }, (_, i) => ({ latitude: Math.sin(i * 1.7 * k) * 60, longitude: Math.cos(i * 1.3 * k) * 170 }))
const quiet = console.warn; console.warn = () => {}
let bad = 0
for (const [n, cap] of [[2, Infinity], [3, Infinity], [50, Infinity], [400, Infinity], [400, 12], [400, 4]]) {
  const P = pts(n), ref = kruskal(P, cap)
  const L = new MST({ maxConnectionDistance: cap }).generateMSTLines(P)
  const len = L.reduce((a, f) => a + f.properties.distance, 0)
  const ok = L.length === ref.n && Math.abs(len - ref.len) < 1e-6
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${String(n).padStart(4)} pins, cap ${cap}: ${L.length} edges, length ${len.toFixed(4)} (reference ${ref.n}, ${ref.len.toFixed(4)})`)
}
console.warn = quiet
const t = Date.now()
const L = new MST({}).generateAllMSTLines({ A: pts(1500, 1.1), B: pts(607, 0.9) })
const ms = Date.now() - t
const fast = ms < 3000 && L.length === 2105
if (!fast) bad++
console.log(`  ${fast ? 'ok  ' : 'FAIL'}  2,107 pins in two groups: ${L.length} lines in ${ms} ms (budget 3000 ms)`)
if (bad) { console.log(`MST-CLUSTERING: FAIL — ${bad} case(s).`); process.exit(1) }
console.log('MST-CLUSTERING: PASS — a true minimum spanning tree/forest, and fast enough for the main thread.')
