<script setup>
/**
 * GiBoundedSetMap.vue — the bounded set on the whiteboard: one circle, reached inside,
 * unreached outside, pannable and zoomable like its neighbour.
 *
 * The chart still makes exactly one claim — which side of the line a group is on — so nothing
 * here encodes distance, ranking or gradient. What zoom buys is reading the names: at 2,100
 * dots the inside is a cluster until you can get close to it.
 *
 * ★ THE BOUNDARY IS A DISH, AND ITS RADIUS MUST BE IN MAP UNITS. circle-radius is SCREEN
 * PIXELS: a fixed value would hold its size on screen while the dots spread out from under it,
 * so the circle would be correct at exactly one zoom and wrong at every other — and for dots
 * near the edge the inside/outside reading would silently invert, which is the only thing this
 * chart says. degreesToPixelRadius converts it with an exponential-base-2 interpolation, which
 * is exact rather than approximate because pixels-per-degree doubles with every zoom level.
 *
 * The cross rides in the point collection as its own tier rather than as an overlay, so it pans
 * and zooms with the drawing instead of floating over it.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { labelFont } from '@map/maps/label-font.js'
import { whiteboardProjection } from '@map/maps/whiteboard-projection.js'
import { addTieredPointLayers } from '@map/charts/whiteboard/tiered-points.js'
import { createBoardMap } from '../boardEngine.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { layoutBoundedSet } from '@map/components/charts/boundedSet.js'
import { boundedSetFeatures, toFeatureCollection, dishRadiusDegrees, degreesToPixelRadius, TIERS } from '../setChartFeatures.js'

const props = defineProps({ groups: { type: Array, default: () => [] } })

const T = useGiT()
const board = useBoardState()
const el = ref(null)
const mapRef = shallowRef(null)
const handle = shallowRef(null)
const failed = ref('')

const R = 120, SPREAD = 260
const project = whiteboardProjection({ extent: SPREAD })

const layout = computed(() => layoutBoundedSet(props.groups, { r: R, spread: SPREAD }))
const built = computed(() => boundedSetFeatures(layout.value, { population: (p) => p.pop ?? 0 }))

// The cross is a feature, not an overlay, so it moves with the drawing. It is its own tier so
// the label layer renders it at every zoom while group names stay hidden until you are close.
const features = computed(() => [
  ...built.value.features,
  { id: '__centre', label: '✝', tier: 'centre', k: 3e9, u: 0, v: 0 },
])
const data = computed(() => toFeatureCollection(features.value, project).collection)

const dishDegrees = computed(() => dishRadiusDegrees(R, project))

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
        sourceId: 'gbsm',
        tiers: [
          { tier: 'centre', minzoom: 0, weight: 'bold', offset: 0 },
          { tier: TIERS.GROUP, minzoom: 5.2, weight: 'regular', offset: 0.7 },
        ],
        // Inside and outside are the whole claim, so they are the whole palette.
        colorExpr: ['match', ['get', 'side'], 'in', '#92b195', 'out', '#6d766e', '#3b463d'],
        radiusExpr: ['interpolate', ['linear'], ['zoom'], 1, 1.8, 6, 3.6],
        opacityExpr: ['case', ['==', ['get', 'side'], 'out'], 0.65, 0.95],
        dish: {
          filter: ['==', ['get', 'id'], '__centre'],
          radiusExpr: degreesToPixelRadius(dishDegrees.value),
          color: 'rgba(0,0,0,0)',            // the boundary is a LINE, not a filled disc:
          stroke: '#3b463d',                 // a fill would imply the inside is a region
        },
        font: labelFont,
      }))
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
    failed.value = String(e?.message || e)
  }
})

watch(data, (d) => { try { mapRef.value?.getSource('gbsm')?.setData(d) } catch (_) {} })
onBeforeUnmount(() => { try { handle.value?.destroy?.() } catch (_) {} ; try { mapRef.value?.remove?.() } catch (_) {} })

useShadowStyles(
  '.gbsm{position:absolute;inset:0;min-height:0;min-width:0}' +
  '.gbsm-map{position:absolute;inset:0}' +
  '.gbsm-fail{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:16px;text-align:center;color:#3b463d;font-size:13px;background:#f3f3f1}',
  'gi-bounded-set-map',
)
</script>

<template>
  <div class="gbsm">
    <div ref="el" class="gbsm-map" />
    <p v-if="failed" class="gbsm-fail">
      {{ T('gospelInternet.bounded.failed', 'The reached/unreached table could not be loaded, so this chart is not drawn.') }}
      <span dir="ltr">{{ failed }}</span>
    </p>
  </div>
</template>
