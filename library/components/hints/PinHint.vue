<script setup>
/**
 * PinHint.vue — the conversion coach-mark (bottom-center of any map).
 *
 * WHY: partner-site visitors don't know map pins are clickable, so they never
 * reach a people group's page — the map mobilizes nobody. This one-time hint
 * teaches the single gesture that starts every conversion: tap a pin → the
 * detail card opens → "Pray for them" (which carries utm_source attribution,
 * see PeopleGroupDetail.vue).
 *
 * ANCHORED TO THE MAP, NOT THE PAGE (BUG-PRAYER-TOAST-COVERS-TABLE-ROWS):
 *   ProfileLoader mounts this as a SIBLING of the profile, inside .profile-loader
 *   — which is position:relative with a 100dvh floor. So `bottom:26px` used to
 *   resolve against the WHOLE PAGE. On a single-map profile that is the same
 *   rectangle as the map, which is why it looked right for so long. On a
 *   DASHBOARD (map hero on top, data table below) the two diverge badly: the
 *   pill landed on the people-groups table and covered ~2 data rows at 1440x900.
 *   A hint about the map must live over the map, so on mount we RE-PARENT the
 *   pill into the map's own positioned container (found at runtime, the same way
 *   the canvas is found — no per-profile wiring, no props, works for every
 *   bundle). If no positioned container turns up we stay put, which is exactly
 *   the old behaviour — a degraded anchor, never a crash.
 *   It also clears the bottom-right attribution strip, which is a LICENCE
 *   obligation (Mapbox ToS / OSM ODbL) and must never be covered.
 *
 * TASTEFUL BY DESIGN (no dark patterns):
 *   · SELF-GATING — shows only after a map <canvas> actually exists in this
 *     custom element's shadow root, so list/table profiles never see it, AND only
 *     while that map is on screen. A composite (pane-wrapper) keeps the map pane
 *     mounted while the reader scrolls to another pane, so "a canvas exists" is not
 *     "the map is showing": without the second test the pill was clamped into view
 *     over the UPG-100 poster pane, where there is no map to tap.
 *   · ONCE PER VISIT — it appears on every page load and stays until the reader closes
 *     it with the ×. Nothing is remembered between loads: leaving and returning (or a
 *     reload) shows it again, because the invitation is the point.
 *   · SELF-DISMISSING — first pointer-down on the map (they learned it), the
 *     ✕ button, or a quiet 14s timeout. Never blocks the map; pointer-events
 *     none except on the pill itself.
 *
 * OPT-OUT via profile-config `pinHint: false`; label override via
 * `pinHintLabel`. Styles via useShadowStyles — a child component's <style> is
 * dropped from the custom element's shadow DOM (see WARNING.md).
 */
import { ref, inject, computed, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useOptionalI18n } from '@map/composables/useOptionalT.js'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

// ★ i18n IS OPTIONAL HERE, NOT REQUIRED. useI18n() THROWS ("Need to install with `app.use`
// function") on any host that never installed vue-i18n, and seven bundles in this repo do not --
// big-picture, doxa-maps-spa, doxa-vision-card, golden-path-check, people-groups-grid,
// plugin-studio, stack-demo. An unguarded call in a LIBRARY component is therefore a blank page
// waiting for the first bare host that renders it: that is exactly how library FilterDropdown
// blanked people-groups-grid everywhere (a production plugin), fixed by studio in 6603dc17.
// This call was mine, added in 9ba6ad7a. Same shape of fix: use the host's translations when it
// has them, the English literal otherwise. `te` becomes a "no, I don't have it" so every caller
// falls through to its own default.
const PINHINT_FALLBACK = { 'messages.pinHint.tapDot': 'Tap a dot to see who still needs prayer' }
// C4: the guard is library/composables/useOptionalI18n now. PINHINT_FALLBACK is passed in unchanged
// and `te` still answers false on a bare host, so every caller keeps its own default.
const { t, te } = useOptionalI18n('', { fallback: (key) => PINHINT_FALLBACK[key] })
const uiStore = inject('uiStore', null)
const profileConfig = inject('profileConfig', null)
const isDark = computed(() => uiStore?.theme === 'dark')
// ★ THE DEFAULT MUST NOT NAME A COLOUR (Driver, reported 5+ times).
// The old default was "Tap a red dot — someone still needs prayer". It shipped on EVERY map,
// because `pinHintLabel` is an override no profile has ever set and `pinHint:false` is an opt-out
// no profile has ever used — verified: zero occurrences of either across plugin-designs/.
// So maps with NO red dots (cities-with-internet, gospel-resources) invited readers to tap a red
// dot that does not exist, and UPG-100 — whose dots are a four-colour reached/unreached scale —
// told them the wrong colour. A hint that describes something the reader cannot see is worse than
// no hint: it makes a working map look broken.
// The fix is the DEFAULT, not per-profile config, because the defect came from a default that
// asserted more than it could know. A shared component cannot know what colour a given map's dots
// are, so it must not claim one; profiles that DO want to name a colour still can, via pinHintLabel.
// ★ AND IT WAS NEVER TRANSLATED — on ANY map, in ANY locale. The colour half of this defect was
// found and fixed (the default no longer says "red"), and the note above records that carefully.
// What nobody checked is that the sentence is a JAVASCRIPT STRING LITERAL: this component has no
// useI18n, and no locale file anywhere carries the text. A reader in Arabic, Russian or Chinese
// has been shown an English sentence on every map that renders the hint. That is the same shape as
// the Russian-heading bug next door — wrong only for readers who do not file bug reports in
// English, and therefore invisible to everyone who could.
// The key falls back to the English sentence when a locale lacks it, so a missing translation
// degrades to today's behaviour rather than to "messages.pinHint.tapDot".
const label = computed(() => {
  const override = profileConfig?.value?.pinHintLabel
  if (override) return override
  const EN = 'Tap a coloured dot — someone still needs prayer'
  try { return te('messages.pinHint.tapDot') ? t('messages.pinHint.tapDot') : EN } catch (_) { return EN }
})

const visible = ref(false)
// Whether the map box is actually in view (IntersectionObserver, below). Separate from `visible`,
// which only the reader's × turns off: scrolling away hides the pill, scrolling back shows it again.
const onScreen = ref(true)
let mapIO = null
// Whether the map's pane is the ACTIVE view. A composite that stacks views (upg-100-mfe on a phone puts the
// map pane BEHIND Prayer Resources, both position:absolute; inset:0) passes the geometry test above while
// the reader sees only the posters, because an IntersectionObserver measures geometry, not occlusion. The
// contract: a composite marks an inactive view `inert` (or hidden / aria-hidden="true"), which is right for
// assistive technology anyway, and the pill hides while any ancestor of its map carries one of those.
const paneActive = ref(true)
let paneMOs = []
const INACTIVE_ATTRS = ['inert', 'hidden', 'aria-hidden']
function ancestorsOf(el) {
  const out = []
  let n = el
  while (n) {
    if (n.nodeType === 1) out.push(n)
    n = n.parentNode || n.host || null   // a ShadowRoot has no parentNode; continue at its host
  }
  return out
}
function isInactive(el) {
  return ancestorsOf(el).some((a) => a.hasAttribute('inert') || a.hasAttribute('hidden') || a.getAttribute('aria-hidden') === 'true')
}
function watchPaneActive(box) {
  const check = () => {
    const now = !isInactive(box)
    if (now !== paneActive.value) { paneActive.value = now; if (now) nextTick(clampIntoView) }
  }
  check()
  if (typeof MutationObserver === 'undefined') return
  for (const a of ancestorsOf(box)) {
    try {
      const mo = new MutationObserver(check)
      mo.observe(a, { attributes: true, attributeFilter: INACTIVE_ATTRS })
      paneMOs.push(mo)
    } catch (_) { /* detached or foreign node: skip it */ }
  }
}
const hintEl = ref(null)
let watchTimer = null
let movedTo = null   // the element we re-parented into, so we can put ourselves back
let attribRO = null
// The root this pill was mounted in, kept so a later clamp can look for obstacles (the phone
// legend sheet) that did not exist at mount time.
let hintRoot = null
let sheetRO = null
let sheetWatched = null
let settleTimers = []  // observes the attribution control (it resizes on its own, see below)
let hostRO = null    // observes the pill's layout parent, so a LATE layout re-runs the clamp
let attribEl = null

// The reader closes it; nothing else does — no timer, and no dismissal on the first pan,
// so the invitation is still there when they come back to the map.
function dismiss() { visible.value = false }

/**
 * From the map <canvas>, walk up to the element the pill should live inside: the
 * nearest ancestor that ESTABLISHES A CONTAINING BLOCK for absolute positioning
 * (position other than static). That is the map's own box — .rd-mapwrap on the
 * dashboard, the map shell on a single-map profile.
 *
 * Why walk up from the canvas instead of matching a class: a class list would be a
 * hardcoded registry of every profile's private markup, and this component lives in
 * library/ where it must stay parameterized. The containing block is a STRUCTURAL
 * fact that is true in every bundle, so it needs no per-profile knowledge.
 *
 * Stops at the shadow root / the loader wrapper — re-parenting into .profile-loader
 * would just reproduce the bug we are fixing.
 */
function findMapBox(canvas, root) {
  let el = canvas?.parentElement
  for (let hops = 0; el && hops < 12; hops++, el = el.parentElement) {
    if (el === root || el.classList?.contains('profile-loader')) return null
    let pos = ''
    try { pos = getComputedStyle(el).position } catch (_) { /* detached */ }
    if (pos && pos !== 'static') {
      // Guard against a container so short the pill would overflow it.
      const r = el.getBoundingClientRect()
      if (r.height >= 120 && r.width >= 160) return el
    }
  }
  return null
}

/**
 * Last resort: if the pill still renders BELOW THE FOLD, lift it into view.
 *
 * WHY THIS EXISTS (BUG-PINHINT-CLIPPED-IN-THE-CAP4-COMPOSITE, measured 2026-09-21)
 * The header above promises that when no positioned container turns up we "stay put — a degraded
 * anchor, never a crash". Measured in the cap-4 composite (my-upg-100-list/upg-100-mfe), that
 * degraded anchor is not merely imperfect: it is OFF-SCREEN. Same component, same 1440x900 viewport:
 *
 *     leaf  upg-100-list : pill bottom 864 / viewport 900  -> fully visible
 *     composite upg-100-mfe: pill bottom 917 / viewport 900 -> CLIPPED BY 17px
 *
 * The composite adds a ~53px header above the nested child's stage, so `bottom:26px` resolves past
 * the fold. findMapBox() returns null there (the pill's parent stayed `.pin-hint`, its own wrapper),
 * so the re-parent never ran and nothing else was watching.
 *
 * ★ A GRACEFUL DEGRADATION THAT DEGRADES TO INVISIBLE IS A FAILURE, NOT A FALLBACK. The README's
 * cap-4 image shipped the hint sliced through the middle of its sentence. Measure the RENDERED rect
 * rather than trusting the anchor: that is the only check that holds for a nesting depth nobody has
 * built yet.
 *
 * Deliberately additive and conservative: it only ever moves the pill UP, only when it is actually
 * clipped, and leaves a correctly-placed pill untouched — so every surface that already worked is
 * byte-identical in behaviour.
 */
/**
 * The phone legend sheet is an obstacle too, not just the fold.
 *
 * MEASURED 2026-09-24 at 390x844 on doxa-research-map: the pill sat at y=700 and the open sheet
 * began at y=603, so "Tap a coloured dot — someone still needs prayer" printed straight across the
 * Progress rows — 1,418 Needs Prayer and the Full Prayer Coverage line were unreadable underneath
 * it. It is the phone screenshot the README showcases. Nothing was clipped, so the existing
 * below-the-fold clamp had nothing to say: the pill was fully visible and fully in the way.
 *
 * Same lever as the attribution strip, which this component already treats as a floor rather than
 * something to cover: find the sheet, and if the pill would cross its top edge, lift by exactly the
 * overlap. Only when the two actually intersect horizontally — a sheet that does not sit under the
 * pill is not an obstacle — and only ever upward, so every surface with no sheet is unchanged.
 */
function sheetFloor(pill) {
  const sheet = hintRoot?.querySelector?.('.legend-mobile-sheet')
  if (!sheet) return Infinity
  // ★ ATTACH THE OBSERVER HERE, NOT AT MOUNT. Measured: the sheet does not exist yet when the pill
  // mounts — LegendMobile renders after the map's first canvas — so a mount-time querySelector
  // found nothing, no observer was attached, and the clamp never ran again. The pill stayed exactly
  // where it was and the "fix" moved it by 0px. Binding lazily, the first clamp that SEES a sheet
  // is the one that starts watching it.
  if (sheetRO && sheetWatched !== sheet) { try { sheetRO.disconnect() } catch (_) {} sheetRO = null }
  if (!sheetRO && typeof ResizeObserver !== 'undefined') {
    try {
      sheetRO = new ResizeObserver(() => clampIntoView())
      sheetRO.observe(sheet)
      sheetWatched = sheet
    } catch (_) { sheetRO = null }
  }
  try {
    const sr = sheet.getBoundingClientRect()
    // A collapsed sheet is a thin strip; still an obstacle, but only if it is really there.
    if (!(sr.height > 16) || !(sr.width > 16)) return Infinity
    const apart = pill.right <= sr.left || sr.right <= pill.left
    return apart ? Infinity : sr.top
  } catch (_) { return Infinity }
}

function clampIntoView() {
  const el = hintEl.value
  if (!el || !onScreen.value || !paneActive.value) return
  try {
    // ★ ADJUST `bottom`, NEVER `transform`. My first attempt set el.style.transform and cleared it
    // between measurements — both wrong here, and the diagnosis took two failed builds:
    //   · `.pin-hint` already uses `transform: translateX(-50%)` to CENTRE itself, so writing a
    //     translateY would have silently destroyed the horizontal centring.
    //   · the pill's computed transform also carries the `pinhint-bob` keyframe animation, so a
    //     computed-transform reading is never just "my offset".
    // The wrapper positions with `bottom: calc(var(--pin-hint-attrib-clear) + 12px)`, so the honest
    // lever is that variable's companion offset — additive, and it composes with the attribution
    // clearance instead of fighting it.
    el.style.removeProperty('--pin-hint-lift')
    const r = el.getBoundingClientRect()
    if (!r.height) return
    // The lowest thing the pill may touch: the fold, or the top of the phone legend sheet when one
    // is open beneath it. Whichever is higher wins.
    const floor = Math.min(window.innerHeight, sheetFloor(r))
    const overflow = Math.round(r.bottom - floor)
    if (overflow > 0) el.style.setProperty('--pin-hint-lift', (overflow + 8) + 'px')
  } catch (_) { /* detached — nothing to clamp */ }
}

/**
 * Raise the pill clear of the map's attribution strip. Mapbox swaps between an expanded
 * credit line and a compact round "i" button depending on map WIDTH, and the compact
 * button is TALLER (24px vs 20px) — so a fixed offset that clears the strip at 1440px
 * can still clip the button at 1024px. Measure the real control instead of assuming.
 * Attribution is a LICENCE obligation; this only ever READS it.
 */
function syncAttribClearance(root) {
  const el = hintEl.value
  if (!el || !root?.querySelector) return
  let h = 0
  try {
    // TWO attribution flavours ship in this repo and the pill must clear EITHER:
    //   .mapboxgl-ctrl-attrib  — Mapbox's own control (useMapInstance, attributionControl:true)
    //   .doxa-attribution      — our own credit line (useMapAttribution.js) on the profiles
    //                            that construct with attributionControl:false
    // Both are licence-required credit, so both are obstacles, never things to cover.
    const a = root.querySelector(
      '.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-attrib, .mapboxgl-ctrl-bottom-right .doxa-attribution, .doxa-attribution')
    if (a) {
      // Measure the strip the control OCCUPIES from the bottom of the box we are anchored
      // in, not the control's own height: Mapbox adds a margin inside
      // .mapboxgl-ctrl-bottom-right, so height alone undercounts the reserved space.
      const cr = a.getBoundingClientRect()
      const host = el.parentElement
      const hr = host ? host.getBoundingClientRect() : null
      h = hr ? Math.max(cr.height || 0, hr.bottom - cr.top) : (cr.height || 0)
      // Mapbox collapses the credit to the compact "i" button AFTER first paint, and that
      // swap changes the CONTROL's height without changing the map's — so observe the
      // control itself or we stay pinned to the stale expanded measurement.
      if (attribEl !== a && typeof ResizeObserver !== 'undefined') {
        if (attribRO) { try { attribRO.disconnect() } catch (_) {} }
        attribEl = a
        attribRO = new ResizeObserver(() => syncAttribClearance(root))
        attribRO.observe(a)
      }
    }
  } catch (_) { /* not painted yet */ }
  const clear = Math.min(Math.max(Math.ceil(h) || 20, 20), 72)
  el.style.setProperty('--pin-hint-attrib-clear', clear + 'px')
  // ★ Clamp LAST and from HERE, not only from the mount hook. A single nextTick clamp measured a
  // layout that had not settled — in the cap-4 composite the nested child is still sizing then, so
  // the pill measured on-screen and the clamp correctly did nothing, and nothing re-checked after
  // the real layout arrived. This function already re-runs from the attribution ResizeObserver on
  // every later layout change, so hanging the clamp off it gets the re-measure for free.
  clampIntoView()
}

onMounted(() => {
  // Find this custom element's shadow root and wait (max ~12s) for a map canvas.
  const inst = getCurrentInstance()
  const root = inst?.proxy?.$el?.getRootNode?.()
  if (!root || typeof root.querySelector !== 'function') return
  hintRoot = root
  let tries = 0
  watchTimer = setInterval(() => {
    tries++
    // Only a MAP ENGINE's canvas: a plugin that draws with its own canvas (the Wall's renderer) is not a
    // map, and a coach-mark about tapping dots would sit over its dialogs.
    const canvas = root.querySelector('canvas.maplibregl-canvas, canvas.mapboxgl-canvas')
    if (canvas) {
      clearInterval(watchTimer); watchTimer = null
      visible.value = true
      // Re-parent AFTER the v-if has rendered the pill, so hintEl exists.
      nextTick(() => {
        const box = findMapBox(canvas, root)
        const el = hintEl.value
        if (box && el && el.parentElement !== box) {
          try { box.appendChild(el); movedTo = box } catch (_) { /* keep the page anchor */ }
        }
        // SHOW ONLY WHILE THE MAP IS IN VIEW. The observer's root is the viewport, and it clips by every
        // scrolling ancestor, so a map pane scrolled out of a composite's column reads as not intersecting.
        // Less than a fifth of the map on screen counts as away: the pill needs map under it.
        if (box) watchPaneActive(box)
        if (box && typeof IntersectionObserver !== 'undefined') {
          try {
            mapIO = new IntersectionObserver((entries) => {
              const e = entries[entries.length - 1]
              const now = !!e && e.isIntersecting && e.intersectionRatio >= 0.2
              if (now !== onScreen.value) { onScreen.value = now; if (now) nextTick(clampIntoView) }
            }, { threshold: [0, 0.2, 0.5] })
            mapIO.observe(box)
          } catch (_) { /* no observer: behave as before, shown once a canvas exists */ }
        }
        syncAttribClearance(root)
        clampIntoView()
        // The attribution ResizeObserver only fires when THAT control resizes, which need not
        // coincide with the host settling. Watch the pill's own offsetParent as well, so a late
        // layout (a composite sizing its nested child after mount) triggers a re-measure.
        // RE-CLAMP AS THE PAGE SETTLES. The phone legend sheet mounts AFTER the map's first canvas,
        // so the clamp above runs while the only floor is the fold. These three re-measures catch
        // the sheet arriving; once one of them sees it, sheetFloor() binds a ResizeObserver and the
        // sheet's own drags and collapses keep the pill clear from then on.
        settleTimers.push(setTimeout(clampIntoView, 1200), setTimeout(clampIntoView, 3000), setTimeout(clampIntoView, 6000))
        try {
          const watch = (hintEl.value && hintEl.value.offsetParent) || null
          if (watch && typeof ResizeObserver !== 'undefined') {
            if (hostRO) { try { hostRO.disconnect() } catch (_) {} }
            hostRO = new ResizeObserver(() => clampIntoView())
            hostRO.observe(watch)
          }
        } catch (_) { /* no layout parent — the mount-time clamp is all we get */ }
      })
    } else if (tries > 40) { // ~12s: no canvas → not a map profile → never show
      clearInterval(watchTimer); watchTimer = null
    }
  }, 300)
})
onBeforeUnmount(() => {
  if (watchTimer) clearInterval(watchTimer)
  if (mapIO) { try { mapIO.disconnect() } catch (_) {} mapIO = null }
  for (const mo of paneMOs) { try { mo.disconnect() } catch (_) {} }
  paneMOs = []
  if (attribRO) { try { attribRO.disconnect() } catch (_) {} attribRO = null } attribEl = null
  if (hostRO) { try { hostRO.disconnect() } catch (_) {} hostRO = null }
  if (sheetRO) { try { sheetRO.disconnect() } catch (_) {} sheetRO = null } sheetWatched = null
  for (const t of settleTimers) clearTimeout(t)
  settleTimers = []
  hintRoot = null
  // We appended our own element into a node Vue does not own. Vue removes the element
  // it created, but only from where IT thinks it is — so detach explicitly to be certain
  // no orphan pill is left behind in the map container on profile teardown.
  if (movedTo && hintEl.value?.parentElement === movedTo) {
    try { movedTo.removeChild(hintEl.value) } catch (_) {}
  }
  movedTo = null
})

useShadowStyles(`
/* ★ NOT ON PAPER (rega, RQ-RGPRINT on fc93c97e4). "Tap a coloured dot — someone still needs
   prayer" printed across the bottom of the map. It is an instruction for a finger, addressed to
   a reader who is now holding a sheet of paper; on the page it reads as part of the map's own
   caption and is simply untrue there. */
@media print { .pin-hint { display: none !important; } }

  /* bottom: clears the attribution strip along the map's bottom edge. That credit line is a
     LICENCE obligation (Mapbox ToS / OSM ODbL) and must never be covered — so the pill sits
     ABOVE it rather than on it. max-width keeps the pill inside narrow map panels instead of
     bleeding past their edges at 1024px and below. */
  .pin-hint { position: absolute; left: 50%;
    bottom: calc(var(--pin-hint-attrib-clear, 20px) + 12px + var(--pin-hint-lift, 0px)); transform: translateX(-50%);
    z-index: 2147482000; pointer-events: none;
    max-width: calc(100% - 24px); box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: pinhint-in .5s ease both; }
  .pin-hint-pill { pointer-events: auto; display: inline-flex; align-items: center; gap: 9px;
    padding: 9px 14px 9px 11px; border-radius: 999px;
    background: rgba(23, 29, 38, .92); color: #fff; font-size: 13.5px; font-weight: 600;
    letter-spacing: .01em; box-shadow: 0 4px 18px rgba(0,0,0,.30);
    animation: pinhint-bob 2.6s ease-in-out 1s infinite; }
  .pin-hint-dot { position: relative; width: 12px; height: 12px; flex: none; }
  .pin-hint-dot::before { content: ''; position: absolute; inset: 0; border-radius: 50%;
    background: #e05252; box-shadow: 0 0 0 2px rgba(224,82,82,.35); }
  .pin-hint-dot::after { content: ''; position: absolute; inset: -5px; border-radius: 50%;
    border: 2px solid rgba(224,82,82,.55); animation: pinhint-pulse 1.8s ease-out infinite; }
  .pin-hint-x { pointer-events: auto; border: none; background: none; color: #aeb7c2;
    font-size: 16px; line-height: 1; cursor: pointer; padding: 0 0 0 2px; }
  .pin-hint-x:hover { color: #fff; }
  /* WCAG 2.5.8 at EVERY pointer, not only coarse: a 24x24 hit area that adds no box (the f29b8151 pattern). */
  .pin-hint-x{position:relative;}.pin-hint-x::after{content:'';position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);}
  /* WCAG 2.5.8 Target Size (Minimum), AA = 24x24 CSS px. Scoped to (pointer:coarse):
     2.5.8 governs touch ergonomics, and these are SHARED components sitting on maps this
     change does not own -- a finger gets the bigger target, the mouse keeps the density
     those owners designed. min-height states the 24 rather than deriving it from a font. */
  @media (pointer:coarse) { .pin-hint-x { min-width: 24px; min-height: 24px;
    display: inline-flex; align-items: center; justify-content: center; padding: 0; } }
  .pin-hint.dark .pin-hint-pill { background: rgba(240, 243, 247, .95); color: #1b212b; }
  .pin-hint.dark .pin-hint-x { color: #5a6470; }
  .pin-hint.dark .pin-hint-x:hover { color: #1b212b; }
  @keyframes pinhint-pulse { 0% { transform: scale(.6); opacity: .9 } 70% { transform: scale(1.5); opacity: 0 } 100% { opacity: 0 } }
  @keyframes pinhint-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
  @keyframes pinhint-in { from { opacity: 0; transform: translateX(-50%) translateY(10px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
  @media (prefers-reduced-motion: reduce) {
    .pin-hint, .pin-hint-pill, .pin-hint-dot::after { animation: none !important; }
  }
`, 'pin-hint')
</script>

<template>
  <div v-if="visible" v-show="onScreen && paneActive" ref="hintEl" class="pin-hint" :class="{ dark: isDark }" role="status">
    <span class="pin-hint-pill">
      <span class="pin-hint-dot" aria-hidden="true"></span>
      {{ label }}
      <button class="pin-hint-x" type="button" :aria-label="T('aria.dismissHint', 'Dismiss hint')" @click="dismiss">×</button>
    </span>
  </div>
</template>
