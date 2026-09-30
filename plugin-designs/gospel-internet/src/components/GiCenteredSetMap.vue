<script setup>
/**
 * GiCenteredSetMap.vue — the centered-set target on the whiteboard: pannable, zoomable, and
 * labelled by tier as the reader zooms in, the way the language tree is.
 *
 * WHY THE MAP ENGINE AND NOT SVG, which is the opposite of the call this chart shipped with:
 * the ask changed. A static target is fine in SVG; a zoomable one with ~2,100 labels is not.
 * The engine tiles the collection per zoom so it draws LESS when zoomed out, and its symbol
 * layers do label collision — which is the part that would take me longest to do badly. SVG
 * keeps every node in the page at every zoom, which is exactly what makes a big tree slow.
 *
 * THE LABEL STAGING IS THE DRIVER'S ASK, and it is one layer per tier with its own minzoom:
 * band names when zoomed out, ring names in the middle, group names when you are in close.
 * Nothing in that is tree-shaped, which is why it is a shared layer rather than a copy.
 *
 * ⚠ COORDINATES GO THROUGH THE PROJECTION, NEVER A SCALE. The whiteboard's inverse-Mercator is
 * the exact inverse of the renderer's own transform, so a circle stays a circle; a linear scale
 * would draw these concentric rings as ovals worsening outward, plausibly enough to waste an
 * afternoon on. The one number this chart owns is its EXTENT.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { labelFont } from '@map/maps/label-font.js'
import { whiteboardProjection } from '@map/maps/whiteboard-projection.js'
import { addTieredPointLayers } from '@map/charts/whiteboard/tiered-points.js'
import { createBoardMap } from '../boardEngine.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { ringInfo, CENTRE_COLOR } from '../ringInfo.js'
import { layoutCenteredSet, ringRadii, RING_MAX } from '@map/components/charts/centeredSet.js'
import { centeredSetFeatures, toFeatureCollection, TIERS } from '../setChartFeatures.js'

const props = defineProps({
  groups: { type: Array, default: () => [] },   // { id, label, ring, neighborId }
  activeRing: { type: [Number, null], default: null },
})
const emit = defineEmits(['select'])

const T = useGiT()
const board = useBoardState()
const el = ref(null)
const mapRef = shallowRef(null)
const handle = shallowRef(null)
const ready = ref(false)
const failed = ref('')

const EXTENT = 30 + (RING_MAX - 1) * 22          // 228 — the ring the outermost groups sit on
const project = whiteboardProjection({ extent: EXTENT })

const layout = computed(() => layoutCenteredSet(props.groups, { innerR: 30, ringGap: 22 }))
const features = computed(() => centeredSetFeatures(
  layout.value.placed,
  ringRadii({ innerR: 30, ringGap: 22 }),
  { population: (p) => p.pop ?? 0,
    ringLabel: (r) => T(`gospelInternet.rings.ring`, 'Ring') + ' ' + r,
    bandLabel: (b) => T(`gospelInternet.rings.band.${b}`, b) },
))
const data = computed(() => toFeatureCollection(features.value, project).collection)

// Colour comes from ringInfo so the chart, the legend and the printed sheet share one palette;
// a ring with no info (the centre) falls back to the cross's colour rather than to a default
// that would silently look like a real ring.
const colorExpr = computed(() => {
  const stops = []
  for (let r = 1; r <= RING_MAX; r++) stops.push(r, ringInfo(r)?.color || CENTRE_COLOR)
  return ['match', ['get', 'ring'], ...stops, CENTRE_COLOR]
})

// Dimming is a paint expression rather than a filter, for the same reason the SVG version dims
// instead of hiding: a ring emptied of dots reads as a ring with no groups, which is the
// opposite of what a reader selecting it just asked.
const opacityExpr = computed(() => props.activeRing == null
  ? 0.85
  : ['case', ['==', ['get', 'ring'], props.activeRing], 1, 0.12])

onMounted(async () => {
  try {
    const made = await createBoardMap(el.value, board.profileConfig?.value || {},
      { whiteboard: true, boundaries: false, center: [0, 0], zoom: 1 })
    const map = markRaw(made.map || made)
    mapRef.value = map
    // ★ createBoardMap ALREADY AWAITS LOAD. boardEngine resolves only after
    // `await new Promise(res => map.once('load', res))`, so by the time this runs the event has
    // fired and will not fire again — a second `map.on('load', …)` never runs and the layers are
    // never added. The chart then draws a basemap-less whiteboard with no source on it: empty,
    // silent, and with nothing thrown for a failure branch to catch.
    // Guarded rather than assumed: if a future engine resolves earlier, once('load') still fires.
    const setup = () => {
      handle.value = markRaw(addTieredPointLayers(map, {
        data: data.value,
        sourceId: 'gcsm',
        // The Driver's staging: bands read zoomed out, rings in the middle, groups in close.
        tiers: [
          { tier: TIERS.BAND, minzoom: 0, weight: 'bold', offset: 1.1 },
          { tier: TIERS.RING, minzoom: 3.2, weight: 'regular', offset: 0.8, muted: true },
          { tier: TIERS.GROUP, minzoom: 5.2, weight: 'regular', offset: 0.7 },
        ],
        colorExpr: colorExpr.value,
        radiusExpr: ['interpolate', ['linear'], ['zoom'], 1, 1.6, 6, 3.4],
        opacityExpr: opacityExpr.value,
        font: labelFont,
        onClick: (id, f) => { const r = f?.properties?.ring; if (r != null) emit('select', r) },
      }))
      ready.value = true
    }
    // ★ CALLED UNCONDITIONALLY, AND THE GUARD THAT USED TO BE HERE IS WHY THIS WAS BROKEN TWICE.
    // createBoardMap only resolves after `await map.once('load')`, so by here the event HAS fired.
    // The previous line read `map.loaded() ? setup() : map.once('load', setup)` — but loaded()
    // does not mean "the load event fired", it means "the style AND every tile are loaded", and
    // the basemap tiles were still arriving. So it returned false, took the else branch, and
    // registered a handler for an event that had already happened. A guard added for a
    // hypothetical future engine broke the only case that actually exists.
    // If a defensive check is ever wanted here it is isStyleLoaded(), not loaded().
    setup()
  } catch (e) {
    // FAILS VISIBLY: an empty whiteboard is indistinguishable from a chart with no groups.
    failed.value = String(e?.message || e)
  }
})

watch(data, (d) => { try { mapRef.value?.getSource('gcsm')?.setData(d) } catch (_) {} })
// ⚠ THE LAYER ID COMES FROM THE HANDLE, NOT FROM A GUESS. I first wrote 'gcsm-points'; the
// module names it `${sourceId}-dots`. Wrapped in a try/catch, that mistake does not throw — the
// dimming simply never happens, which looks like a legend that does nothing rather than like a
// bug. Reading layerIds means a rename over there cannot silently disable this.
const dotsLayer = computed(() => (handle.value?.layerIds || []).find((id) => id.endsWith('-dots')))
watch(opacityExpr, (o) => {
  const id = dotsLayer.value
  if (!id) return
  try { mapRef.value?.setPaintProperty(id, 'circle-opacity', o) } catch (_) {}
})

onBeforeUnmount(() => { try { handle.value?.destroy?.() } catch (_) {} ; try { mapRef.value?.remove?.() } catch (_) {} })

useShadowStyles(
  '.gcsm{position:absolute;inset:0;min-height:0;min-width:0}' +
  '.gcsm-map{position:absolute;inset:0}' +
  '.gcsm-fail{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:16px;text-align:center;color:#3b463d;font-size:13px;background:#f3f3f1}',
  'gi-centered-set-map',
)
</script>

<template>
  <div class="gcsm">
    <div ref="el" class="gcsm-map" />
    <p v-if="failed" class="gcsm-fail">
      {{ T('gospelInternet.centered.failed', 'The neighbour table could not be loaded, so this chart is not drawn.') }}
      <span dir="ltr">{{ failed }}</span>
    </p>
  </div>
</template>
