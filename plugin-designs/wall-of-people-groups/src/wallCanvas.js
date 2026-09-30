/**
 * wallCanvas.js — the Wall of People Groups drawn on ONE <canvas> instead of an SVG of ~36,000 nodes.
 *
 * Measured before (rega, main 16ff7e719, all 2,107 cards): 36,247 DOM nodes (36,214 SVG), a 0.5-1.6 s
 * long task on EVERY wheel tick, 41.7 s to zoom out to the whole wall, p95 350 ms frames when panning
 * it. The JS heap was only 8.3 MB: the cost was the SVG DOM being re-laid-out and re-painted per tick.
 * Here each frame draws only the cards in view, in world coordinates, with level of detail:
 *   · under ~12 px a card is a filled rectangle;
 *   · from ~40 px it gets its text;
 *   · from 48 px its photo (a capped, least-recently-used image cache).
 * Clicks are hit-tested by inverting the zoom transform (card → region).
 *
 * The same world as before (canvasWidth × canvasHeight, "meet"-fitted), the same grid (wallLod.wallGrid),
 * and the same d3 zoom behaviour (wheel, drag, dblclick), so the wall reads and moves as it did.
 * Nothing is written to window; destroy() releases every listener and image.
 */
import { wallD3 } from './wallD3.js'
import { wallGrid } from './wallLod.js'
import { blessingFor, wrapText } from './blessings.js'

// 'rtl' when a string's first strong character is Hebrew/Arabic-script, else 'ltr' (canvas has no dir="auto").
const RTL_FIRST = /^[^A-Za-z\u00C0-\u024F\u0370-\u052F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
export const textDir = (s) => (RTL_FIRST.test(String(s || '')) ? 'rtl' : 'ltr')

const ICON = {
  heart: 'M12 20.5s-7.2-4.4-9.2-8.8C1.3 8.3 3.2 4.6 6.7 4.6c2 0 3.5 1.1 4.3 2.4.8-1.3 2.3-2.4 4.3-2.4 3.5 0 5.4 3.7 3.9 7.1-2 4.4-9.2 8.8-9.2 8.8z',
  comment: 'M4 4.5h16v11.5H9.5L4 20.5z',
  plane: 'M21 3.5 3 10.8l7 2.7 2.7 7 8.3-17z',
}
// Where a group's name links: its prayer page on pray.doxa.life (the live data has a slug), else its
// Joshua Project page (the CSV data has a PeopleID3), else nowhere.
export function groupLink(g) {
  if (g && g.slug) return `https://pray.doxa.life/${encodeURIComponent(g.slug)}?source=doxalife`
  const id = g && (g.peopleID3 || g.PeopleID3)
  return id && String(id).trim() ? `https://joshuaproject.net/people_groups/${String(id).trim()}` : ''
}
const TEXT_PX = 40, IMG_PX = 48, RECT_PX = 12, IMG_CACHE = 400, IMG_PARALLEL = 12

export class WallCanvas {
  /**
   * host: the element to draw into. opts: { worldW, worldH, spacing, vSpacing, labels(key, params)→string,
   * prayCount(group)→number, onPray(group), onComments(group), onShare(group) }
   */
  constructor(host, opts) {
    this.host = host
    this.o = opts
    this.groups = []
    this.mode = 'bless'
    this.k0 = 1; this.ox = 0; this.oy = 0            // "meet" fit of the world into the canvas
    this.t = { k: 1, x: 0, y: 0 }                     // d3 zoom transform (in world-fit space)
    this.images = new Map()                           // url → { img, ok, used }
    this.loading = 0
    this.queue = []
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'wall-canvas-el'
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
    // Focusable, with a name: a dialog opened from a click on the wall returns focus HERE on close
    // (a non-focusable canvas left focus on <body>), and the wall itself is reachable by keyboard.
    this.canvas.tabIndex = 0
    if (opts.label) this.canvas.setAttribute('aria-label', opts.label)
    this.canvas.setAttribute('role', 'img')
    host.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.icons = Object.fromEntries(Object.entries(ICON).map(([k, d]) => [k, new Path2D(d)]))
    const d3 = wallD3()
    this.zoom = d3.zoom().scaleExtent([0.1, 20]).filter((e) => !e.ctrlKey && !e.button)
      .on('zoom', (e) => { this.t = e.transform; this.request() })
    this.sel = d3.select(this.canvas).call(this.zoom).on('dblclick.zoom', null)
    this._click = (e) => this.onClick(e)
    this._move = (e) => this.onMove(e)
    this.canvas.addEventListener('click', this._click)
    this.canvas.addEventListener('mousemove', this._move)
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null
    this.ro?.observe(host)
    this.resize()
  }

  setWorld(worldW, worldH) { this.o.worldW = worldW; this.o.worldH = worldH; this.layout(); this.resize() }
  setGroups(groups) { this.groups = groups || []; this.layout(); this.request() }
  setMode(mode) { this.mode = mode; this.request() }

  layout() {
    const n = this.groups.length
    this.grid = n ? wallGrid(n, this.o.worldW, this.o.worldH, this.o.spacing, this.o.vSpacing) : null
  }

  resize() {
    const r = this.host.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height)
    this.canvas.width = Math.round(this.cssW * dpr); this.canvas.height = Math.round(this.cssH * dpr)
    this.dpr = dpr
    // "meet": the whole world fits, centred (the SVG viewBox's preserveAspectRatio="xMidYMid meet").
    this.k0 = Math.min(this.cssW / this.o.worldW, this.cssH / this.o.worldH)
    this.ox = (this.cssW - this.o.worldW * this.k0) / 2
    this.oy = (this.cssH - this.o.worldH * this.k0) / 2
    this.request()
  }

  /** Screen px of one world unit, and world → screen. */
  get scale() { return this.k0 * this.t.k }
  toScreen(x, y) { return [this.ox + (x * this.t.k + this.t.x) * this.k0, this.oy + (y * this.t.k + this.t.y) * this.k0] }
  toWorld(px, py) { return [((px - this.ox) / this.k0 - this.t.x) / this.t.k, ((py - this.oy) / this.k0 - this.t.y) / this.t.k] }

  /** Open at a zoom where one card is `cardPx` wide (the old wall opened at ~96 px). */
  startView(cardPx = 96) {
    if (!this.grid) return
    const k = Math.max(1, Math.min(20, cardPx / (this.grid.cw * this.k0)))
    this.sel.call(this.zoom.transform, wallD3().zoomIdentity.scale(k))
  }
  resetZoom() { this.sel.transition().duration(750).call(this.zoom.transform, wallD3().zoomIdentity) }

  request() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw() }) }

  cardRect(i) {
    const g = this.grid
    const col = i % g.cols, row = Math.floor(i / g.cols)
    return { x: col * (g.cw + g.spacing) + g.spacing, y: row * (g.ch + g.vSpacing) + g.vSpacing, w: g.cw, h: g.ch }
  }

  visibleRange() {
    const g = this.grid
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.cssW, this.cssH)
    const sx = g.cw + g.spacing, sy = g.ch + g.vSpacing, rows = Math.ceil(g.n / g.cols)
    return {
      c0: Math.max(0, Math.floor(x0 / sx) - 1), c1: Math.min(g.cols - 1, Math.floor(x1 / sx) + 1),
      r0: Math.max(0, Math.floor(y0 / sy) - 1), r1: Math.min(rows - 1, Math.floor(y1 / sy) + 1),
    }
  }

  draw() {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!this.grid) return
    const s = this.scale, cardPx = this.grid.cw * s
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.ox + this.t.x * this.k0), this.dpr * (this.oy + this.t.y * this.k0))
    const { c0, c1, r0, r1 } = this.visibleRange()
    const want = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.grid.cols + c
        if (i >= this.groups.length) break
        const R = this.cardRect(i)
        if (cardPx < RECT_PX) { ctx.fillStyle = '#e6e6e6'; ctx.fillRect(R.x, R.y, R.w, R.h); continue }
        this.drawCard(ctx, i, R, cardPx, want)
      }
    }
    if (want.length) this.load(want)
  }

  drawCard(ctx, i, R, cardPx, want) {
    const g = this.groups[i], w = R.w, h = R.h, x = R.x, y = R.y
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h)
    ctx.lineWidth = 0.5; ctx.strokeStyle = '#dbdbdb'; ctx.strokeRect(x, y, w, h)
    const imgY = y + h * 0.18, imgH = h * 0.5
    const url = g.imageUrl
    const cached = url && this.images.get(url)
    if (cached && cached.ok) {
      cached.used = performance.now()
      const im = cached.img, ar = im.naturalWidth / im.naturalHeight || 1, box = w / imgH
      let sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight
      if (ar > box) { sw = sh * box; sx = (im.naturalWidth - sw) / 2 } else { sh = sw / box; sy = (im.naturalHeight - sh) / 2 }
      ctx.drawImage(im, sx, sy, sw, sh, x, imgY, w, imgH)                  // object-fit: cover
    } else {
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x, imgY, w, imgH)
      if (url && cardPx >= IMG_PX) want.push(url)
    }
    if (cardPx < TEXT_PX) return
    // Name (two lines if needed), in the card's top band.
    const nameSize = Math.max(3.5, w * 0.07)
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    ctx.font = `700 ${nameSize}px -apple-system, "Segoe UI", Arial, sans-serif`
    ctx.fillStyle = groupLink(g) ? '#0095f6' : '#262626'
    const name = g.name || g.post_title || this.o.labels('wall.unknownGroup')
    const lines = ctx.measureText(name).width > w * 0.95 ? wrapText(name, Math.max(6, Math.floor(name.length / 2) + 2), 2) : [name]
    // Each data string is drawn in its OWN direction, not the page's: an English verse on an RTL page
    // keeps its full stop at the end (canvas direction otherwise inherits the page's rtl).
    ctx.direction = textDir(name)
    lines.forEach((ln, k) => ctx.fillText(ln, x + w / 2, y + h * 0.06 + k * nameSize * 1.1, w * 0.96))
    if (this.mode === 'bless') {
      // The verse under the photo (blessings.js, WEB, verbatim), then its reference.
      const vSize = Math.max(3, w * 0.052), per = Math.max(10, Math.floor(w / (vSize * 0.5)))
      const b = blessingFor(i), vl = wrapText(b.text, per, 4)
      const vy = imgY + imgH + vSize * 1.5
      ctx.font = `italic ${vSize}px Georgia, "Times New Roman", serif`; ctx.fillStyle = '#262626'
      ctx.direction = textDir(b.text)
      vl.forEach((ln, k) => ctx.fillText(ln, x + w / 2, vy + k * vSize * 1.25, w * 0.96))
      ctx.font = `${vSize * 0.82}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#8e8e8e'
      ctx.direction = textDir(b.ref)
      ctx.fillText(b.ref, x + w / 2, vy + vl.length * vSize * 1.25 + vSize * 0.4, w * 0.96)
      return
    }
    // SOCIAL: status, then heart / comment / share, the prayer count and "view prayers".
    ctx.font = `${Math.max(3, w * 0.055)}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#8e8e8e'
    if (g.status) { ctx.direction = textDir(g.status); ctx.fillText(g.status, x + w / 2, y + h * 0.14, w * 0.96) }
    ctx.direction = 'inherit'   // the translated counters below follow the page
    const L = this.socialLayout(R)
    const count = this.o.prayCount(g)
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    for (const [k, bx] of [['heart', L.hx], ['comment', L.cx], ['plane', L.px]]) {
      ctx.save(); ctx.translate(bx, L.by); ctx.scale(L.bs / 24, L.bs / 24)
      const on = k === 'heart' && count > 0
      ctx.strokeStyle = on ? '#ed4956' : '#262626'; if (on) { ctx.fillStyle = '#ed4956'; ctx.fill(this.icons[k]) }
      ctx.stroke(this.icons[k]); ctx.restore()
    }
    ctx.textAlign = 'left'; ctx.font = `600 ${L.pf}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#262626'
    ctx.fillText(this.o.labels('wall.prayedCount', { n: count }, count), L.hx, L.by + L.bs + L.pf + 2, w * 0.9)
    ctx.font = `${L.pf}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#8e8e8e'
    ctx.fillText(this.o.labels('wall.viewPrayers'), L.hx, L.by + L.bs + L.pf * 2 + 4, w * 0.9)
  }

  socialLayout(R) {
    const w = R.w, iconSize = Math.max(8, w * 0.12), bs = iconSize * 0.7, sp = bs * 1.6
    const hx = R.x + (w - (bs * 3 + sp * 2)) / 2, by = R.y + R.h * 0.72
    return { bs, hx, cx: hx + sp, px: hx + sp * 2, by, pf: Math.max(3.5, w * 0.065) }
  }

  /** Which card and region a screen point is on: { i, region: 'name'|'heart'|'comment'|'share'|'view'|'card' }. */
  hit(px, py) {
    if (!this.grid || this.grid.cw * this.scale < TEXT_PX) return null
    const [wx, wy] = this.toWorld(px, py), g = this.grid
    const c = Math.floor((wx - g.spacing) / (g.cw + g.spacing)), r = Math.floor((wy - g.vSpacing) / (g.ch + g.vSpacing))
    if (c < 0 || c >= g.cols || r < 0) return null
    const i = r * g.cols + c
    if (i >= this.groups.length) return null
    const R = this.cardRect(i)
    if (wx < R.x || wx > R.x + R.w || wy < R.y || wy > R.y + R.h) return null
    if (wy < R.y + R.h * 0.12) return { i, region: 'name' }
    if (this.mode === 'social') {
      const L = this.socialLayout(R)
      if (wy >= L.by && wy <= L.by + L.bs) {
        if (wx >= L.hx && wx <= L.hx + L.bs) return { i, region: 'heart' }
        if (wx >= L.cx && wx <= L.cx + L.bs) return { i, region: 'comment' }
        if (wx >= L.px && wx <= L.px + L.bs) return { i, region: 'share' }
      }
      if (wy > L.by + L.bs + L.pf && wy < L.by + L.bs + L.pf * 2 + 6) return { i, region: 'view' }
    }
    return { i, region: 'card' }
  }

  onMove(e) {
    const h = this.hit(e.offsetX, e.offsetY)
    const g = h && this.groups[h.i]
    const link = h && h.region === 'name' && groupLink(g)
    this.canvas.style.cursor = h && (link || ['heart', 'comment', 'share', 'view'].includes(h.region)) ? 'pointer' : ''
  }

  onClick(e) {
    if (e.defaultPrevented) return
    const h = this.hit(e.offsetX, e.offsetY)
    if (!h) return
    const g = this.groups[h.i]
    if (h.region === 'name') {
      const url = groupLink(g)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } else if (h.region === 'heart') this.o.onPray(g)
    else if (h.region === 'comment' || h.region === 'view') this.o.onComments(g)
    else if (h.region === 'share') this.o.onShare(g)
  }

  /** Load wanted photos, IMG_PARALLEL at a time; keep at most IMG_CACHE (least recently drawn dropped). */
  load(urls) {
    for (const u of urls) if (!this.images.has(u) && !this.queue.includes(u)) this.queue.push(u)
    while (this.loading < IMG_PARALLEL && this.queue.length) {
      const u = this.queue.shift()
      const img = new Image()
      const rec = { img, ok: false, used: performance.now() }
      this.images.set(u, rec)
      this.loading++
      img.onload = () => { rec.ok = true; this.loading--; this.request(); this.load([]) }
      img.onerror = () => { this.loading--; this.load([]) }
      img.src = u
    }
    if (this.images.size > IMG_CACHE) {
      const old = [...this.images.entries()].filter(([, r]) => r.ok).sort((a, b) => a[1].used - b[1].used)
      for (const [u] of old.slice(0, this.images.size - IMG_CACHE)) this.images.delete(u)
    }
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.sel.on('.zoom', null)
    this.canvas.removeEventListener('click', this._click)
    this.canvas.removeEventListener('mousemove', this._move)
    for (const r of this.images.values()) { r.img.onload = r.img.onerror = null; r.img.src = '' }
    this.images.clear(); this.queue = []
    this.canvas.remove()
  }
}
