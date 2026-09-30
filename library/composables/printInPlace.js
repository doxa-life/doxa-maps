/**
 * printInPlace.js — SHARED (@map/composables/printInPlace.js).
 *
 * ★ THE ONE print mechanism, graduated VERBATIM from my-upg-100-list/poster-wall.vue
 * openPrintWindow() (commit e957cbe "Print the poster in place, on a portrait sheet") on the
 * Driver's ruling that killed the pop-up path: print must happen IN PLACE — no new browser
 * window, no pop-up blocker, the dialog rises over the page the user is looking at.
 *
 * WHY IT GRADUATES (library high bar: reusable + parameterized, 2+ consumers): the
 * prayer-walk-planner's print still used window.open(), and that is not just the rejected UX --
 * it is AGENT-HOSTILE. window.open() without a user gesture is pop-up-blocked, so
 * PrayerWalkPlanner.print() called from an agent (the Driver: "the agent can also create
 * polygons and trigger the print function") silently did nothing. An iframe cannot be blocked
 * and needs no gesture, which is what makes the same call work for a human click AND an agent.
 *
 * Mechanics preserved from the poster-wall original, each for a measured reason:
 *   - OFF-SCREEN 1x1, not display:none — a display:none iframe does not lay out in every
 *     engine, and a zero-height layout can print a blank first page.
 *   - autoprint appends the print bootstrap AFTER the caller's markup so it runs once the
 *     document is parsed (matches <img onload> timing).
 *   - afterprint + a 60s floor reclaim the frame, so repeated prints never leak nodes.
 *
 * Returns the frame's contentWindow, or null when the host is sandboxed/detached (caller
 * keeps its own fallback).
 */
export function openPrintFrame(bodyHtml, { autoprint = false } = {}) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  if (!doc) { frame.remove(); return null }
  doc.open()
  doc.write(bodyHtml)
  if (autoprint) {
    doc.write(
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},150)})</' + 'script>')
  }
  doc.close()

  const drop = () => { if (frame.parentNode) frame.remove() }
  try { frame.contentWindow.addEventListener('afterprint', () => setTimeout(drop, 0)) } catch { /* cross-doc guard */ }
  setTimeout(drop, 60000)

  return frame.contentWindow
}

/**
 * Print a rendered poster IMAGE, at its real paper size, through the same in-place frame.
 *
 * ★ THE DRIVER'S RULE (2026-09-28): an "Export poster" button opens the PRINT DIALOG with a preview.
 * It never hands over a file. Simple Research was rendering a PNG and calling a download helper, so
 * the reader got doxa-prayer-poster.png in their downloads folder and no preview, no paper size, and
 * no way to print it without opening it somewhere else first. The dialog IS the preview: the sheet the
 * browser shows is the poster, at the size the spec asked for.
 *
 * @page carries the spec's own inches so the preview is not letter-shaped by default — a 8.5x11
 * poster previewed on A4 is a different document from the one that was rendered. margin:0 because the
 * renderer already composed the margins into the image; a second set would scale the poster down.
 *
 * The object URL is revoked on afterprint AND on the frame's 60s reclaim, since afterprint does not
 * fire in every engine when the dialog is dismissed. Revoking early would blank the preview, so the
 * image element is kept alive by the frame itself rather than by a timer here.
 *
 * Returns true when the dialog was opened, false when the host blocked the frame — the caller decides
 * what to do about it, because a silent no-op is exactly the failure this replaced.
 */
export function printImageBlob(blob, { widthIn = 8.5, heightIn = 11, title = '', alt = '' } = {}) {
  if (!blob || typeof URL === 'undefined' || !URL.createObjectURL) return false
  const url = URL.createObjectURL(blob)
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // The image is sized by the PAGE, not by its pixels: object-fit keeps a poster rendered at any DPI
  // on its own sheet without cropping. The <img> also gates the print — openPrintFrame's bootstrap
  // waits for load, which is what keeps the first page from printing blank.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>`
    + `<style>@page{size:${widthIn}in ${heightIn}in;margin:0}`
    + 'html,body{margin:0;padding:0;background:#fff}'
    + 'img{display:block;width:100%;height:100%;object-fit:contain}</style></head>'
    + `<body><img src="${url}" alt="${esc(alt || title)}"></body></html>`
  const win = openPrintFrame(html, { autoprint: true })
  if (!win) { URL.revokeObjectURL(url); return false }
  const revoke = () => { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
  try { win.addEventListener('afterprint', () => setTimeout(revoke, 0)) } catch { /* cross-doc guard */ }
  setTimeout(revoke, 60000)
  return true
}

/**
 * Print THIS page (not a frame) once the things it draws have finished drawing, with a busy state
 * the whole time — the ONE shared version of a pattern that exists five times in this repo today
 * (upg-100-list.vue c54a11d5a, four in exp's plugins 786a83461, PeopleGroupsWall.printWall).
 *
 * ★ WHY A HELPER RATHER THAN THE FIVE COPIES: they agree on the easy half (set a flag, print, clear
 * the flag) and each invents the hard half — what "ready" means, and what happens when ready never
 * arrives. The hard half is the one that strands a reader.
 *
 * ★ THE TIMEOUT PRINTS. It does not reject and it does not cancel. A reader who clicked Print and
 * waited has asked for paper; a slow tile server is a reason to print a plainer map, not a reason to
 * produce nothing. The return value says which happened so a caller can say so if it wants.
 *
 * ★ onBusy IS CALLED IN A finally. Every path clears it: a wait that rejects, a print that throws,
 * a dialog dismissed instantly, a host with no window.print at all. A busy state that can outlive
 * its own operation is worse than no busy state, because the page looks broken rather than slow.
 *
 * @param waitFor   promises to settle before printing. Rejections are swallowed on purpose: a map
 *                  that failed to report readiness must not also cost the reader their printout.
 * @param onBusy    (busy: boolean) => void — drives the caller's own indicator.
 * @param timeoutMs ceiling on the wait. 0 or negative prints immediately.
 * @returns 'ready' | 'timeout' | 'no-print' — what actually happened.
 */
export async function printWhenReady({ waitFor = [], onBusy = null, timeoutMs = 8000 } = {}) {
  const busy = (v) => { try { if (onBusy) onBusy(v) } catch { /* a caller's indicator must not break printing */ } }
  busy(true)
  let outcome = 'ready'
  let timer = null
  try {
    const waits = (Array.isArray(waitFor) ? waitFor : [waitFor]).filter(Boolean)
    if (waits.length && timeoutMs > 0) {
      // Settled, not all: one waiter that rejects should not skip the others or the print.
      const settled = Promise.allSettled(waits).then(() => 'ready')
      const expired = new Promise((res) => { timer = setTimeout(() => res('timeout'), timeoutMs) })
      outcome = await Promise.race([settled, expired])
    }
    if (typeof window === 'undefined' || typeof window.print !== 'function') return (outcome = 'no-print')
    window.print()
    return outcome
  } finally {
    if (timer) clearTimeout(timer)
    busy(false)
  }
}
