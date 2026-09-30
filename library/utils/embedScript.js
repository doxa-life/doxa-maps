/**
 * embedScript — load another bundle's script and wait for its element to register.
 *
 * ★ WHAT AN APP SHELL DOES. A capability-5 plugin nests other plugins, so it needs three things:
 * work out the tree root it was served from, load a bundle's `.js` exactly once, and wait for the
 * custom element to actually exist before mounting it. Both shells in this repo — the Research
 * Gallery (`doxa-maps-spa`) and the Plugin Studio (`plugin-studio`) — had their own copy of all
 * three, identical in code (DEDUP-AUDIT.md, 2026-09-28: 33 lines, the only cross-plugin cluster
 * that is identical, closes over nothing, and spans one owner's plugins).
 *
 * Moved verbatim; the comments below are the originals, because each records a measurement.
 *
 * ★ ONE BEHAVIOUR CHANGE, AND IT IS AN IMPROVEMENT: `_loaded` is now shared. Two shells on one page
 * previously kept separate caches and would each load the same bundle. Now the second one reuses
 * the first's promise. Same result, one network request instead of two.
 */

/**
 * Load a bundle exactly once per URL; resolves after its script has executed.
 *
 * ★ A CLASSIC SCRIPT FIRES onload AND THEN FAILS, for a dev-server bundle. Measured 2026-09-22:
 *   pointing a plain <script> at a dev entry (/plugin-designs/<bundle>/index.js, a real ES MODULE)
 *   fires onload — so a loader watching onload reports SUCCESS — and only THEN throws "Cannot use
 *   import statement outside a module" as an ASYNC page error. The tag is never defined,
 *   document.createElement(tag) yields an inert HTMLUnknownElement, and the pane sits empty while its
 *   own state reads 'ready'. onload is structurally incapable of seeing this, so it is not a usable
 *   success signal by itself — which is why every mount below also waits on whenTagDefined().
 *
 *   The built tree ships IIFEs, where a classic tag is correct, so this only ever bites under the dev
 *   server — exactly the surface a developer works on. Rule: a rooted /plugin-designs/ entry (or any
 *   .../index.js) is a dev ES module; everything else is a built IIFE.
 *   MEASURED a second time, independently, on stack-demo's dev leaf 2026-09-22 (StackLayout, before it
 *   used this file): 0 failed requests, and yet customElements.get('research-dashboard-map') === false
 *   with 0 rows rendered. VerticalTabsLayout's private copy LACKED this rule until it moved here, so a
 *   bundle nested through it on the dev server never defined its tag.
 *
 * An empty url is a no-op: a <script src=""> would re-fetch the page itself.
 *
 * SRI is optional (attrs.integrity).
 */
const _loaded = {}
export function loadScriptOnce(url, attrs) {
  if (!url) return Promise.resolve()
  if (_loaded[url]) return _loaded[url]
  _loaded[url] = new Promise((ok, fail) => {
    const s = document.createElement('script')
    s.src = url
    if (/^\/plugin-designs\//.test(url) || /\/index\.js(\?|$)/.test(url)) s.type = 'module'
    if (attrs) for (const k in attrs) if (attrs[k]) s.setAttribute(k, attrs[k])
    s.onload = () => ok()
    s.onerror = () => { delete _loaded[url]; fail(new Error('failed to load ' + url)) }
    document.head.appendChild(s)
  })
  return _loaded[url]
}

// Wait for a tag to ACTUALLY register. loadScriptOnce resolving is not proof the element exists (see
// above), and a module script's define() runs only after its import graph settles, so the tag can
// appear a tick or two after onload. customElements.whenDefined is the browser's own authoritative
// answer; the timeout turns a never-registered tag into THIS tab's error overlay rather than a silent
// blank pane that claims to be ready.
export function whenTagDefined(tag, ms) {
  if (typeof customElements === 'undefined') return Promise.resolve()
  if (customElements.get(tag)) return Promise.resolve()
  return Promise.race([
    customElements.whenDefined(tag),
    new Promise((_, fail) => setTimeout(() => {
      if (customElements.get(tag)) return
      fail(new Error('<' + tag + '> never registered (bundle loaded but defined no element)'))
    }, ms || 15000))
  ])
}

/**
 * The tree root this shell was served from, with a trailing slash, or '' when it cannot be known.
 *
 * ⚠ READS document.currentScript, so it is only valid AT MODULE EVALUATION TIME. Call it once at the
 * top of an entry file (`const TREE_BASE = deriveTreeBase()`), never later — `currentScript` is null
 * once the script has finished executing, and a late call silently returns ''.
 */
export function deriveTreeBase() {
  try {
    const cur = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || ''
    if (!cur) return ''
    // Strip the trailing "<bundle>/<bundle>.js" → the tree root, with trailing slash.
    const root = cur.replace(/[^/]+\/[^/]+$/, '')
    return root.replace(/\/+$/, '') + '/'
  } catch { return '' }
}
