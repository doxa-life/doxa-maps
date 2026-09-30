<!--
  MapControlMenu.vue — the ONE menu every map control opens.

  A control (share, export, …) only toggles `open`; this component owns where the menu
  lives and how it behaves, on phones and desktop alike:

    • It renders INSIDE the map area (teleported out of the toolbar into the same shadow
      root), so it never escapes the map's walls, never uses position:fixed, and scrolls
      with the map when the host page scrolls.
    • Its top edge is the toolbar's top edge. By default it is as tall as its content needs
      (bounded only by the map's bottom edge — no scrolling); `maxHeight` caps it lower and
      `matchToolbar` limits it to the toolbar column's height (content then scrolls).
    • It opens on the toolbar's inner side: to the LEFT of right-hand controls, to the
      RIGHT of left-hand controls. The side is measured, so a right-to-left page that
      mirrors the toolbar mirrors the menu as well.
    • Width: as wide as fits between the toolbar and the opposite edge, capped at `width`.
    • One z tier for menus (--z-menu, default 3000); only one menu is open per map at a
      time; closes on Escape or on a tap on the bare map canvas (never on legend/search).

  Props: open (Boolean), title (String), isDark (Boolean),
         width     (Number, 340)  — preferred width; shrinks to what fits (mobile friendly)
         maxHeight    (Number|null) — cap the height (null = fit the content within the map)
         height       (Number|null) — a fixed height instead of fitting the content
         matchToolbar (Boolean)     — limit the height to the toolbar column (content scrolls)
  Emits: close
  Slot:  the menu content (tabs, buttons, text) — chrome (header, close) is provided here.
-->
<script setup>
import { ref, inject, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '../../composables/useShadowStyles.js'

useShadowStyles(`
.mcm{position:absolute;z-index:var(--z-menu,3000);display:flex;flex-direction:column;box-sizing:border-box;
  background:#161b22;border:1px solid #30363d;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.45);
  color:#e6edf3;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;
  overflow:hidden;opacity:0;transform:translateY(-4px) scale(0.98);animation:mcm-in 0.18s ease-out forwards;}
@keyframes mcm-in{to{opacity:1;transform:translateY(0) scale(1);}}
.mcm.light{background:#ffffff;border-color:#d8dee4;box-shadow:0 6px 24px rgba(0,0,0,0.16);color:#1f2328;}
.mcm-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;min-height:32px;flex:0 0 auto;border-bottom:1px solid #21262d;}
.mcm.light .mcm-header{border-bottom-color:#d8dee4;}
.mcm-title{font:600 10px ui-monospace,monospace;color:#73A17F;text-transform:uppercase;letter-spacing:0.07em;}
.mcm.light .mcm-title{color:#3b463d;}
.mcm-close{width:22px;height:20px;border:1px solid #30363d;background:rgba(110,118,129,0.12);border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#8b949e;padding:0;transition:color 0.1s,background 0.1s,border-color 0.1s;}
.mcm-close:hover{color:#c9d1d9;background:rgba(59,70,61,0.18);border-color:#73A17F;}
.mcm.light .mcm-close{background:rgba(208,215,222,0.4);border-color:#d0d7de;color:#57606a;}
.mcm.light .mcm-close:hover{color:#3b463d;background:rgba(59,70,61,0.12);border-color:#3b463d;}
.mcm-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}
`, 'map-control-menu')

const props = defineProps({
  open:   { type: Boolean, default: false },
  title:  { type: String,  default: '' },
  width:  { type: Number,  default: 340 },
  isDark: { type: Boolean, default: false },
  maxHeight: { type: Number, default: null },
  height:    { type: Number, default: null },
  matchToolbar: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

// The toolbar this menu belongs to (MapToolbar provides its element); the map area is the
// nearest positioned map container above it — where the menu is teleported to.
const toolbar = inject('mapToolbar', null)
const host = ref(null)
const el = ref(null)
const style = ref({})

// ★ AN ALLOWLIST OF THREE PLUGIN CLASS NAMES DECIDED WHETHER THIS MENU HAD AN ANCHOR AT ALL, and a
// plugin not on the list got no placement rather than a worse one. `.dsm-map-area` is doxa-simple-map,
// `.rm-map-area` is research-map, `.dm-map-area` is demo-map -- so Prayer Progress and Simple Research
// placed correctly and everyone else fell through to `|| null`, which place() answers with an EMPTY
// STYLE, which leaves `.mcm{position:absolute}` at its STATIC position: below-and-right of a button
// already at the top right. Off the page.
// That is the identical failure the 2026-09-22 dashboard fix describes below, returning through a
// different door: not "a wrong side was chosen" but "nothing chose anything".
// MEASURED 2026-09-28: cities-internet, gospel-resources, key-cities and upg-neighbor carry NO map-area
// class and no data-map-area, so all four were unanchored. The Driver reported two of them; the list is
// what made it four.
const AREA = '.dsm-map-area, .rm-map-area, .dm-map-area, [data-map-area]'

function place() {
  const tb = toolbar?.el?.value, area = host.value
  if (!tb || !area) { style.value = {}; return }
  const ar = area.getBoundingClientRect(), tr = tb.getBoundingClientRect()
  const onRight = (tr.left + tr.right) / 2 > (ar.left + ar.right) / 2
  const gap = 8, edge = 12
  const offset = onRight ? (ar.right - tr.left + gap) : (tr.right - ar.left + gap)
  const width = Math.max(200, Math.min(props.width, ar.width - offset - edge))
  const top = Math.max(0, tr.top - ar.top)
  // "Fit inside the map" is the rule ONLY for a real map area. When ShareButton mounted in a
  // page HEADER, its fallback self-tagged that header band as the area (data-map-area=
  // "share-fallback", see ShareButton.bindAnchor) -- and this line then dutifully clamped the
  // menu INSIDE a ~56px band: measured on upg-100-mfe, a 291px share menu rendered with a 69px
  // scrolling body (BUG-SHARE-MENU-HAS-A-SCROLLBAR-SHOULD-BE-FULLY-EXPANDED). A menu must never
  // outgrow a MAP's walls, but a header band is not a wall -- nothing clips below it -- so the
  // fallback area bounds against the VIEWPORT instead and the menu opens at natural height.
  const isFallbackArea = area.getAttribute && area.getAttribute('data-map-area') === 'share-fallback'
  let maxHeight = isFallbackArea
    ? Math.max(120, (window.innerHeight || 900) - tr.top - edge)   // header host: the page below is available
    : Math.max(120, ar.height - top - edge)                        // map host: fit inside the map
  if (props.matchToolbar) maxHeight = Math.max(120, Math.min(maxHeight, tr.height))
  if (props.maxHeight) maxHeight = Math.min(maxHeight, props.maxHeight)
  style.value = {
    top: `${Math.round(top)}px`,
    [onRight ? 'right' : 'left']: `${Math.round(offset)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
    ...(props.height ? { height: `${Math.round(Math.min(props.height, maxHeight))}px` } : {}),
  }
}

// Only one menu open per map: opening this one closes any other.
const OPEN_EVENT = 'doxa-map-menu-open'
function onOtherOpened(e) { if (props.open && e.detail !== el.value) emit('close') }

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  place()
  try { host.value?.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: el.value })) } catch (_) {}
})

function onResize() { if (props.open) place() }
function onKeyDown(e) { if (e.key === 'Escape' && props.open) emit('close') }
// Close only on the bare map canvas — never while the user works the legend, search or toolbar.
function onClickOutside(e) {
  if (!props.open) return
  const path = e.composedPath ? e.composedPath() : [e.target]
  if (el.value && path.includes(el.value)) return
  if (toolbar?.el?.value && path.includes(toolbar.el.value)) return
  if (path.some(n => n?.classList?.contains?.('mapboxgl-canvas') || n?.classList?.contains?.('maplibregl-canvas'))) emit('close')
}

onMounted(() => {
  // ★ NEVER null. A named area is still preferred -- it is the MAP's walls, and a menu must not outgrow
  // them -- but when a plugin has not tagged one, the toolbar's own offsetParent is the containing block
  // this menu is absolutely positioned against, so placing against it is geometrically correct by
  // definition rather than by convention. A plugin that adopts a class or data-map-area later simply
  // gets the better anchor; nothing has to be registered anywhere for the menu to be on screen.
  const tbEl = toolbar?.el?.value || null
  host.value = tbEl?.closest(AREA) || tbEl?.offsetParent || tbEl?.parentElement || null
  host.value?.addEventListener(OPEN_EVENT, onOtherOpened)
  window.addEventListener('resize', onResize)
  document.addEventListener('click', onClickOutside, true)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  host.value?.removeEventListener(OPEN_EVENT, onOtherOpened)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onClickOutside, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport :to="host" :disabled="!host">
    <div v-if="open" ref="el" class="mcm" :class="{ light: !isDark }" :style="style" role="dialog" :aria-label="title">
      <div class="mcm-header">
        <span class="mcm-title">{{ title }}</span>
        <button class="mcm-close" type="button" :aria-label="T('buttons.close', 'Close')" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
          </svg>
        </button>
      </div>
      <div class="mcm-body"><slot /></div>
    </div>
  </Teleport>
</template>
