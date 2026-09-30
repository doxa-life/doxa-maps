<script setup>
// What this instance put on window, recorded AS IT IS SET so unmount can tell its own values
// from another instance's. Two of these can share a page; clearing by NAME alone would let the
// second unmount delete the first's live hooks.
const ownGlobals = Object.create(null)
function setGlobal(name, value) {
  try { window[name] = value; ownGlobals[name] = value } catch (_) {}
}
/**
 * connectivity-map.vue — THE CITIES-WITH-INTERNET GLOBAL MAP.
 *
 * @description Every country shaded by measured internet penetration, with its named carriers and dominant
 *   social platform on tap — the connectivity view of where DX people groups can be reached online.
 *
 * Every country shaded by measured internet penetration, with its NAMED carriers
 * and dominant social platform on tap. Brief: "all these are missing maps."
 *
 * CLONE of gospel-resources/resources-map.vue with the data and bands swapped —
 * profiles duplicate, the pattern does not get re-derived. Same mobile-first
 * rules: one WebGL context, tap-not-hover, legend strip, bottom sheet.
 *
 * MOBILE FIRST, deliberately. The brief asked for mobile-friendliness before this
 * map existed, so it is built that way rather than retrofitted:
 *   - one WebGL context (the ~16-cap rule; this is the app's only map pane)
 *   - tap-to-select with a bottom SHEET, not a hover popup — hover does not exist
 *     on a phone, and a hover-only map is an unusable map
 *   - the legend is a BOUNDED panel (380px, left-anchored), clear of the control
 *     rail on the right. It was a full-width strip; that is what made it collide.
 *   - boundaries FETCHED at runtime (the IIFE inlines every import; 2.7MB of
 *     geojson in the bundle would block first paint)
 *
 * ═══ WHAT THE COLOUR MEANS, AND WHAT IT MUST NOT BE READ AS ═════════════════
 * The band is NATIONAL internet penetration (World Bank, with its observation
 * year). It is NOT a city measurement — per-city connectivity does not exist
 * publicly at this scale, and shading a country then reading a city off it is the
 * error this whole corpus refuses. The sheet says so on every country.
 *
 * CARRIER NAMES come from ASN registry holders (RIPEstat). That set includes ISPs
 * and mobile carriers but ALSO banks, universities and hosting resellers; the
 * carrier flag is a NAME-PATTERN HEURISTIC, not a verified classification.
 */
import { computed, inject, ref, shallowRef, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { useOptionalT, fillParams } from '@map/composables/useOptionalT.js'
import { tStatic } from '@map/i18n/index.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { addMapAttribution } from '@map/composables/useMapAttribution'

// Map toolbar — canonical modular control rail (MapToolbar slot-wrapper + button
// children). ThemeToggleButton is omitted: this profile's isDark is a read-only
// computed off profile-config with no theme-toggle handler to wire it to.
import MapToolbar       from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton     from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton    from '@map/components/map-controls/ZoomOutButton.vue'
import LocationButton   from '@map/components/map-controls/LocationButton.vue'
import FullscreenButton from '@map/components/map-controls/FullscreenButton.vue'
import ShareButton      from '@map/components/map-controls/ShareButton.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { ensureEngineScript, engineGlobal, ensureEngineCSS, engineStylesheetUrl, engineUiLocale } from '@map/composables/useMapInstance.js'
import { localizeBasemapLabels } from '@map/maps/localize-labels.js'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
// People-group dots open the SAME detail panel as Prayer Progress (doxa-simple-map): the
// shared store selection, the shared GO-pin highlight, and the shared legend wrappers
// that host PeopleGroupDetail on desktop and in the phone sheet.
import { DataSourceManager } from '@map/utils/DataSourceManager.js'
import { useSelectedPin } from '@map/composables/useSelectedPin.js'
import { retryableAsyncComponent } from '@map/composables/retryableAsyncComponent.js'
import LegendDesktop from '@map/components/legends/LegendDesktop.vue'
const LegendMobile = retryableAsyncComponent(() => import('@map/components/legends/LegendMobile.vue'))

const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)
// The token through the library's channel (documentation/reference-universal-props.md): the
// profile-config tk, then ProfileLoader's injected mapboxToken (which carries the page-wide shared
// token, fed by window.MAP_TOKEN), then window.MAP_TOKEN. This read window.DOXA_TOKEN, which only a
// few dev pages set, so in the studio and on every built page the map ignored the page's token.
const injectedTk = inject('mapboxToken', null)
const mapboxToken = computed(() => profileConfig.value?.tk || injectedTk?.value
  || (typeof window !== 'undefined' && window.MAP_TOKEN) || '')
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

const mapEl = ref(null)
const mapRef = shallowRef(null)
const rows = ref([])
const selected = ref(null)
const aiNoticeOpen = ref(true)   // dismissible AI-research disclaimer in the detail sheet
const err = ref(null)
// India by state (data/tables/internet-by-adm1.json, NFHS-5): the one country with sub-national data.
const adm1 = shallowRef(null)          // { meta, byArea: { [adm1]: { name, women: {total,urban,rural}, men: {…} } } }
const adm1Sex = ref('women')           // which half of the survey the fill shows; both are in the sheet
const selectedAdm1 = ref(null)

// ── People-group dots (Driver: "red dots on the map to show me where the people groups are")
// The DOXA list from pray-tools, the same list Prayer Progress draws. It carries the slug the
// detail panel fetches by. The shared pin table (tables/people-group-pins.json) has no slug,
// so its dots could not open that panel.
// Dark slate with a white ring (Driver 2026-09-28: the red dots looked wrong on the mostly green
// map). A neutral dark reads on every fill here, the green/amber/red/grey bands AND India's pale-to-deep
// blues, and it carries no "good/bad" meaning the way red does on a map whose red means under 25%.
// The white ring keeps it apart from the deepest blue and from the dark basemap.
const PG_DOT = '#1e293b'
const uiStore = inject('uiStore', null)
const _lang = (() => { const v = inject('lang', null)?.value; return (v && v !== 'en') ? v : null })()
// The reader's language for the ENGINE'S OWN labels (the canvas's "Map" name, "Zoom in", attribution…).
// This map is built raw, not through useMapInstance, so it must hand the engine that locale itself;
// without it they stayed English under ar on both engines (rega, row 34). Same ladder as
// useMapInstance's readerLang: ProfileLoader's lang, then profile-config, then ?lang=, then <html lang>.
const readerLang = () => {
  if (_lang) return _lang
  const pc = profileConfig.value
  if (pc && (pc.locale || pc.lang)) return String(pc.locale || pc.lang)
  try { const q = new URLSearchParams(location.search); return q.get('lang') || q.get('locale') || document.documentElement.lang || 'en' } catch { return 'en' }
}
const dsm = new DataSourceManager({ locale: _lang, profileConfig })
const groups = shallowRef([])
const dotCount = ref(0)
const selectedPin = useSelectedPin({ getMap: () => mapRef.value, getActivePinColor: () => PG_DOT })

async function loadGroups() {
  await dsm.init()
  const raw = await dsm.setActiveSource('pray-tools')
  groups.value = markRaw(raw || [])
}

// The properties PeopleGroupDetail reads (plus uniqueId for the shared highlight). Flat
// primitives only: Mapbox stringifies nested feature properties.
function groupFC() {
  const feats = []
  for (const pg of groups.value) {
    const lng = parseFloat(pg.longitude ?? pg.lng), lat = parseFloat(pg.latitude ?? pg.lat)
    if (!isFinite(lng) || !isFinite(lat)) continue
    const n = pg._normalized || {}
    feats.push({
      type: 'Feature',
      properties: {
        uniqueId: pg.uniqueId, slug: pg.slug || '', name: pg.name,
        language: pg.language, languageFamily: pg.languageFamily || n.languageFamily || '',
        country: pg.country, countryIso: pg.countryIso, countryIsoLabel: pg.countryIsoLabel, countryName: pg.countryName,
        religion: pg.religion, religionLabel: pg.religionLabel, religionName: pg.religionName,
        population: pg.population, status: pg.status, description: pg.description || '', imageUrl: pg.imageUrl || '',
        peoplePraying: Number(pg.peoplePraying ?? n.peoplePraying ?? 0),
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features: feats }
}

function paintGroups(map) {
  if (!groups.value.length || map.getSource('language-families')) return
  const fc = groupFC()
  dotCount.value = fc.features.length
  // Named 'language-families' because the shared selected-pin highlight looks for it.
  map.addSource('language-families', { type: 'geojson', data: fc, promoteId: 'uniqueId' })
  // OPENING VIEW = the dots' own extent (gospel found this on its clone). A hard-coded zoom frames
  // the world only at one canvas size: MEASURED at 390 px, zoom 1.3 showed 1,579 of the 2,107
  // groups and cut off the Americas and the Pacific. Fitting the data means the first view cannot
  // depend on the screen. Once, on first paint; the user owns the camera after that.
  if (fc.features.length) {
    let w = 180, s = 90, e = -180, n = -90
    for (const f of fc.features) { const [x, y] = f.geometry.coordinates; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y }
    const pad = Math.round(Math.min(map.getContainer().clientWidth, map.getContainer().clientHeight) * 0.06) + 8
    try {
      const want = map.cameraForBounds([[w, s], [e, n]], { padding: pad })
      map.fitBounds([[w, s], [e, n]], { padding: pad, duration: 0 })
      // A PORTRAIT PHONE CANNOT FRAME THE WORLD IN MERCATOR: the engine will not zoom out past the
      // point where the world stops filling the viewport vertically (MEASURED at 390x844: floor
      // 0.72 while the fit wanted -0.62). When the fit is clamped like that, some dots must be off
      // screen; put the visible window where the MOST dots are rather than at the bbox centre.
      if (want && map.getZoom() > want.zoom + 0.05) {
        const b = map.getBounds(); const span = Math.min(360, b.getEast() - b.getWest())
        let bestLng = map.getCenter().lng, best = -1
        for (let c = -180; c < 180; c += 5) {
          let k = 0
          for (const f of fc.features) { let d = f.geometry.coordinates[0] - c; d = ((d + 540) % 360) - 180; if (Math.abs(d) <= span / 2) k++ }
          if (k > best) { best = k; bestLng = c }
        }
        map.jumpTo({ center: [bestLng, (s + n) / 2] })
      }
    } catch (_) {}
  }
  map.addLayer({
    id: 'ci-pg-dots', type: 'circle', source: 'language-families',
    paint: {
      'circle-color': PG_DOT,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.6, 4, 3.6, 8, 6, 12, 8.5],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 1.4, 12, 1.8],
      'circle-opacity': 0.95,
    },
  })
  map.on('click', 'ci-pg-dots', (e) => {
    const f = e.features?.[0]
    if (!f || !uiStore) return
    selected.value = null   // the carriers sheet and the group panel never stack
    uiStore.selectPeopleGroup(f)
  })
  map.on('mouseenter', 'ci-pg-dots', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'ci-pg-dots', () => { map.getCanvas().style.cursor = '' })
  // Verification handle, same contract as gospel-resources' __grState: the counts the layer holds.
  if (typeof window !== 'undefined') {
    setGlobal('__ciState', () => ({
      groups: groups.value.length,
      dots: dotCount.value,
      hasLayer: !!map.getLayer('ci-pg-dots'),
      rendered: map.queryRenderedFeatures({ layers: ['ci-pg-dots'] }).length,
      selected: uiStore?.selectedPeopleGroup?.properties?.slug || null,
    }))
    setGlobal('__ciMap', map)
  }
}

// ── UI text: library/i18n/locales/<lc>/connectivity.json, in all eleven locales ─────────
// i18n is OPTIONAL (the gospel-resources pattern): useI18n() throws on a host that never
// installed it, so English from the shipped catalog is the fallback, never a blank or a key.
// Carrier and platform names are data and are not translated.
// C4 wave 3b: the guard is library/composables/useOptionalT.js now, and the fallback resolves through
// tStatic — the RUNTIME LOCALE first, English as the last resort. exp-shepherd's call as this
// plugin's owner (2026-09-26), on the same reasoning gospel-plugin gave: the bundle already carries
// all 11 catalogues, so a partner embedding without vue-i18n being served English is a bug, not a
// decision. The old enLookup was English-only, which is exactly what that served.
// The local fill() is gone with the guard: fillParams applies the same interpolation, except it leaves
// a placeholder for a NULL value where this fill() rendered the string "null".
const t = useOptionalT('connectivity')

// Bands, not a continuous ramp: a reader can hold four categories, not a gradient.
const BANDS = [
  { id: 'yes',     color: '#10b981' },
  { id: 'partial', color: '#e8c15a' },
  { id: 'no',      color: '#b42318' },
  { id: 'unknown', color: '#9aa2ad' },
]
const bandColor = (b) => (BANDS.find((x) => x.id === b) || {}).color || '#9aa2ad'

const byIso = computed(() => {
  const m = {}
  for (const r of rows.value) m[r.iso3] = r
  return m
})

async function load() {
  const [data, adm0] = await Promise.all([
    fetch(`${assetsBase.value}/tables/internet-by-country.json`).then((r) => r.json()),
      // world-adm0 now INCLUDES India, so there is one ADM0 file and no patched
      // variant. It used to omit IND (the 100-list splits India into 10 provincial
      // zones, so its geometry shipped only as gb-IND-ADM1.geojson) — which left the
      // LARGEST field in the dataset, 856 people groups, as a hole on every map. The
      // review caught it as "India seems to have no internet coverage". The fix was a
      // second file, world-adm0-plus.geojson; that file is gone and India is fetched
      // at ADM0 like every other country (data/source-boundaries.mjs).
    fetch(`${assetsBase.value}/boundaries/world-adm0-web.geojson`).then((r) => r.json()),
  ])
  rows.value = data.countries || []
  return adm0
}

function paint(map, adm0) {
  const m = byIso.value
  const feats = (adm0.features || []).map((f) => {
    const iso = f.properties?.iso3
    const d = m[iso]
    return {
      type: 'Feature',
      properties: {
        iso3: iso,
        band: d?.band || 'none',
        color: d ? bandColor(d.band) : 'rgba(0,0,0,0)',
        hasData: !!d,
      },
      geometry: f.geometry,
    }
  })
  const fc = { type: 'FeatureCollection', features: feats }

  if (map.getSource('ci-src')) { map.getSource('ci-src').setData(fc); return }
  map.addSource('ci-src', { type: 'geojson', data: fc })
  map.addLayer({
    id: 'ci-fill', type: 'fill', source: 'ci-src',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'hasData'], 0.72, 0] },
  })
  map.addLayer({
    id: 'ci-line', type: 'line', source: 'ci-src',
    paint: { 'line-color': 'rgba(255,255,255,0.5)', 'line-width': 0.5 },
  })
  // TAP, not hover. On a phone hover never fires, so a hover-only map is dead.
  map.on('click', 'ci-fill', (e) => {
    // A tap on a people-group dot belongs to the dot, not the country under it.
    if (map.getLayer('ci-pg-dots') && map.queryRenderedFeatures(e.point, { layers: ['ci-pg-dots'] }).length) return
    const iso = e.features?.[0]?.properties?.iso3
    if (iso && byIso.value[iso]) { uiStore?.selectPeopleGroup(null); selectedAdm1.value = null; selected.value = byIso.value[iso] }
  })
  map.on('mouseenter', 'ci-fill', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'ci-fill', () => { map.getCanvas().style.cursor = '' })
}

// ── INDIA BY STATE: "ever used the internet", NFHS-5 2019–21, women and men asked separately ─────
// A share of PEOPLE (0–100%), so it gets its own ramp and its own legend block, never the country
// bands: the bands are World Bank national "internet users", a different measure and source.
// Blues, so no state can be read as one of the band colours.
const ADM1_STEPS = [
  { from: 0,  color: '#deebf7' },
  { from: 25, color: '#9ecae1' },
  { from: 40, color: '#6baed6' },
  { from: 55, color: '#3182bd' },
  { from: 70, color: '#08519c' },
]
const adm1Fill = (sex) => ['case', ['==', ['typeof', ['get', sex]], 'number'],
  ['step', ['get', sex], ...ADM1_STEPS.flatMap((st, i) => (i === 0 ? [st.color] : [st.from, st.color]))],
  'rgba(0,0,0,0)']

async function loadAdm1() {
  const [table, geo] = await Promise.all([
    fetch(`${assetsBase.value}/tables/internet-by-adm1.json`).then((r) => { if (!r.ok) throw new Error('internet-by-adm1 ' + r.status); return r.json() }),
    // All 36 states (data/boundaries/gb-IND-ADM1-full.geojson). NOT gb-IND-ADM1.geojson: that one is
    // UPG-100's partition, curated to 34 units, and it left Mizoram and Nagaland with no geometry.
    fetch(`${assetsBase.value}/boundaries/gb-IND-ADM1-full-web.geojson`).then((r) => { if (!r.ok) throw new Error('gb-IND-ADM1-full ' + r.status); return r.json() }),
  ])
  const byArea = {}
  for (const r of table.rows || []) {
    if (r.iso3 !== 'IND' || r.measure !== 'ever_used_internet' || !r.adm1) continue
    const a = (byArea[r.adm1] ??= { name: r.adm1_name || r.adm1, women: {}, men: {} })
    a[r.sex][r.area] = r.value
  }
  adm1.value = markRaw({ meta: table.meta || {}, byArea })
  return geo
}

function paintAdm1(map, geo) {
  const byArea = adm1.value.byArea
  const fc = { type: 'FeatureCollection', features: (geo.features || []).map((f) => {
    const a = byArea[f.properties?.shapeName]
    return { type: 'Feature', geometry: f.geometry,
      properties: { adm1: f.properties?.shapeName, women: a?.women.total ?? null, men: a?.men.total ?? null } }
  }) }
  // Under the people-group dots, which stay tappable on top.
  const before = map.getLayer('ci-pg-dots') ? 'ci-pg-dots' : undefined
  map.addSource('ci-adm1-src', { type: 'geojson', data: fc })
  map.addLayer({ id: 'ci-adm1-fill', type: 'fill', source: 'ci-adm1-src',
    paint: { 'fill-color': adm1Fill(adm1Sex.value), 'fill-opacity': 0.85 } }, before)
  map.addLayer({ id: 'ci-adm1-line', type: 'line', source: 'ci-adm1-src',
    paint: { 'line-color': 'rgba(255,255,255,0.8)', 'line-width': 0.6 } }, before)
  // India's national band would sit under its states and show through any state without a
  // feature as if it were that state's figure. Take India out of the country layer.
  if (map.getLayer('ci-fill')) map.setFilter('ci-fill', ['!=', ['get', 'iso3'], 'IND'])
  map.on('click', 'ci-adm1-fill', (e) => {
    if (map.getLayer('ci-pg-dots') && map.queryRenderedFeatures(e.point, { layers: ['ci-pg-dots'] }).length) return
    const key = e.features?.[0]?.properties?.adm1
    const a = key && byArea[key]
    if (a) { uiStore?.selectPeopleGroup(null); selected.value = null; selectedAdm1.value = { key, ...a } }
  })
  map.on('mouseenter', 'ci-adm1-fill', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'ci-adm1-fill', () => { map.getCanvas().style.cursor = '' })
}

function showAdm1Sex(sex) {
  adm1Sex.value = sex
  const map = mapRef.value
  if (map?.getLayer('ci-adm1-fill')) map.setPaintProperty('ci-adm1-fill', 'fill-color', adm1Fill(sex))
}
const adm1Missing = computed(() => (adm1.value?.meta?.boundaries?.IND?.missing || []).join(', '))

// ── HONOUR THE PROVIDER SWITCH: this profile builds its map RAW ─────────────
// Every bundle that goes through useMapInstance gets the switch for free. This one calls
// `new gl.Map` directly, so it was invisible to it — MEASURED by sweeping all 16 isMap leaves:
// at ?provider=maplibre this leaf still loaded Mapbox and made 18 requests to api.mapbox.com,
// identical to its mapbox run, while 12 of 16 siblings swapped. Same shape and same fix as
// my-upg-100-list; the engine loader is IMPORTED, never a second copy of the ENGINES table.
// No geocoder is mounted here, so the deferred-search-bar rule does not apply to this profile.
const ciProvider = resolveMapProvider(inject('profileConfig', null))
let unmounted = false   // set on unmount; onMounted's awaits check it before building the map

onMounted(async () => {
  try { await ensureEngineScript(ciProvider) } catch (_) { /* fall through to the notice below */ }
  // THE ENGINE THE PAGE ASKED FOR, OR NONE. This read `engineGlobal(ciProvider) || window.mapboxgl`:
  // engineGlobal already answers for Mapbox, so the fallback only fired when MapLibre was asked for and
  // failed to load, and it silently handed back MAPBOX, the token-gated engine, on a page that chose
  // the keyless one (regions' C3 read; upg100's ade12e4c is the same fix). A missing engine is now a
  // visible error that names it, never a quiet swap.
  const gl = engineGlobal(ciProvider)
  if (unmounted) return
  if (!gl) {
    const engine = ciProvider === 'maplibre' ? 'MapLibre' : 'Mapbox'
    console.warn(`[connectivity-map] the ${engine} engine did not load; refusing to substitute another engine.`)
    // messages.engineMissing is the SHARED key, so read it qualified with tStatic: this file's t() prefixes
    // every key with connectivity., which made it connectivity.messages.engineMissing, a miss, so the
    // message was English in every locale. tStatic follows the page locale and falls back to English itself.
    err.value = fillParams(tStatic('messages.engineMissing'), { engine })
    return
  }
  if (!mapEl.value) { err.value = tStatic('messages.engineNotLoaded'); return }
  // RTL SHAPING, before the first map exists. This raw map does not go through useMapInstance
  // (which installs it), and the basemap draws each place in its OWN script: over the Middle East
  // most labels are Arabic, Persian or Hebrew for EVERY viewer. An entry-time call cannot do this,
  // because the engine is injected lazily, after the bundle has run.
  installRtlTextPlugin(gl)
  try {
    // The dots are a second layer, not a precondition: if the list fails, the map still shades.
    const groupsLoaded = loadGroups().catch((e) => { console.warn('[connectivity-map] people groups:', e?.message || e) })
    // India by state is a third layer, and optional like the dots: without it India keeps its band.
    const adm1Loaded = loadAdm1().catch((e) => { console.warn('[connectivity-map] India by state:', e?.message || e); return null })
    const adm0 = await load()
    // The pane can unmount during the awaits above (a tab switch mid-load). Building a map
    // into a container that no longer exists throws; this is the raw-map twin of the
    // useMapInstance guard (0c1a91cd), which this profile does not go through.
    if (unmounted || !mapEl.value) return
    // The engine's stylesheet must be INSIDE this shadow root; a document-level <link> never reaches
    // it. Without it Mapbox's CSS canary fires and controls/markers lose their positioning rules.
    const css = engineStylesheetUrl(ciProvider)
    if (css) await ensureEngineCSS(mapEl.value, css)
    if (unmounted || !mapEl.value) return
    const map = new gl.Map({
      container: mapEl.value,
      // Paired through the registry so both engines show the same intent: 'ink' is the
      // near-black entry (mapbox dark-v11 / OpenFreeMap dark) and 'paper' the near-white one
      // (light-v11 / positron). Falls back to the literal if a name ever stops resolving.
      style: resolveNamedStyle(isDark.value ? 'ink' : 'paper', ciProvider).style
        || (isDark.value ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11'),
      accessToken: mapboxToken.value,
      locale: engineUiLocale(readerLang(), ciProvider),
      center: [42, 18], zoom: 1.3, projection: 'mercator', attributionControl: false,
    })
    mapRef.value = markRaw(map)
    // LICENCE OBLIGATION, not decoration. attributionControl:false above kills
    // Mapbox's built-in credit and nothing replaced it — this map was shipping with
    // NO attribution at all. It SHADES geoBoundaries polygons, so the geoBoundaries
    // credit + link back is required, and gbOpen is mixed-licence with several
    // countries carrying a real attribution requirement (India CC BY 2.5 IN, etc).
    addMapAttribution(map, { boundaries: true })
    map.once('load', async () => {
      // The BASEMAP's place names in the reader's language (Mapbox setLanguage / MapLibre name:<lang>),
      // the library's own helper. useMapInstance applies it for every map built through it; this map is
      // built raw, so it was the one map whose country and city names stayed English under ar.
      try { localizeBasemapLabels(map, readerLang()) } catch (_) { /* a nicety lost, never a broken map */ }
      paint(map, adm0)
      selectedPin.initialize()
      await groupsLoaded
      paintGroups(map)
      const geo = await adm1Loaded
      if (geo && !unmounted) paintAdm1(map, geo)
    })
  } catch (e) { err.value = String(e.message || e) }
})
onBeforeUnmount(() => {
  // ★ RELEASE THE TEST HOOKS. Each pins whatever it closes over — a map instance pins its
  // canvas, its sources, and through them the whole app — so every mount that leaves one behind
  // leaks another copy, measured at roughly 10 MB each.
  // Released as a SET, not just the obvious one: a block that sets several and clears one leaks
  // the rest silently, and the named one is the one you remember. One delete per line, so the
  // released set is readable and greppable.
  // Identity-checked: only this instance's own value is cleared, so a second instance sharing the
  // page does not delete the first's live hooks on its way out.
  try { if (window.__ciState === ownGlobals.__ciState) delete window.__ciState } catch (_) {}
  try { if (window.__ciMap === ownGlobals.__ciMap) delete window.__ciMap } catch (_) {}
  unmounted = true
  selectedPin.cleanup()
  uiStore?.selectPeopleGroup(null)
  try { mapRef.value?.remove() } catch (_) {}
})

const fmt = (n) => (Number(n) || 0).toLocaleString()
const groupOpen = computed(() => !!uiStore?.selectedPeopleGroup)

useShadowStyles(
  '.gm{position:absolute;inset:0;overflow:hidden}' +
  '.gm-map{position:absolute;inset:0}' +
  // LEGEND: a BOUNDED, left-anchored panel — NOT a full-width strip.
  // It used to be `left:8px;right:8px`, which is a strip spanning the whole map
  // (MEASURED 1264px of a 1280px map, 98.75%). That collided with the floating
  // control rail by construction: MapToolbar is inset-inline-end:3px with 32px
  // buttons, so ANY box reaching right:8px intersects it at every viewport. The
  // rail's z-index:10 beats this z-index:4, so the buttons stayed clickable and
  // the defect read as "the legend underlaps the controls" — reported 3x.
  // The fix imitates the shared SemanticTreeLegend, which has always done it
  // correctly: `left:8px; width:var(--map-legend-width,380px)`. Bounded and
  // left-anchored cannot reach the right rail, so the two can never overlap
  // again — a geometric guarantee, not a tuned z-index.
  // LOGICAL, not physical: the control rail sits at inset-inline-end, so in Arabic it moves to the
  // LEFT; a legend pinned left:8px then sat under the zoom buttons (measured in the ar gallery tab).
  '.gm-legend{position:absolute;top:8px;inset-inline-start:8px;width:var(--map-legend-width,380px);' +
  'max-width:calc(100% - 16px);box-sizing:border-box;z-index:4;padding:8px 10px;' +
  'border-radius:10px;background:rgba(255,255,255,.94);color:#0f1419;' +
  "font:12px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.16)}" +
  // Narrow screens: the rail is still on the right, so the legend must stop short
  // of it rather than run under it. 46px = 32px button + 3px inset + clearance.
  '@media(max-width:480px){.gm-legend{width:auto;inset-inline-end:46px}}' +
  '.is-dark .gm-legend{background:rgba(19,32,25,.95);color:#e5e7eb}' +
  '.gm-title{font-weight:700;font-size:12.5px;margin-bottom:5px}' +
  '.gm-keys{display:flex;flex-wrap:wrap;gap:5px 12px}' +
  '.gm-key{display:flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap}' +
  '.gm-sw{width:12px;height:12px;border-radius:3px;flex:none}' +
  '.gm-caveat{margin-top:5px;font-size:10.5px;opacity:.72;line-height:1.4}' +
  '.gm-adm1{margin-top:8px;padding-top:7px;border-top:1px solid rgba(0,0,0,.12)}' +
  '.gm-adm1-h{font-weight:600;font-size:12px;margin-bottom:5px}' +
  '.gm-seg{display:inline-flex;border:1px solid rgba(0,0,0,.2);border-radius:6px;overflow:hidden;margin-bottom:6px}' +
  '.gm-seg button{font:inherit;font-size:11px;padding:3px 10px;min-height:24px;border:0;background:transparent;color:inherit;cursor:pointer}' +   // 24px: the AA touch-target minimum, at every width
  '.gm-seg button.on{background:#08519c;color:#fff}' +
  '.gm-adm1-t{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0 6px}' +
  '.gm-adm1-t th,.gm-adm1-t td{padding:3px 4px;text-align:end}' +
  '.gm-adm1-t th:first-child{text-align:start}' +
  '.is-dark .gm-adm1{border-top-color:rgba(255,255,255,.15)}' +
  '.is-dark .gm-seg{border-color:rgba(255,255,255,.3)}' +
  // DETAIL: a bottom sheet on a phone, a corner card on desktop.
  '.gm-sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;max-height:62%;overflow-y:auto;' +
  'background:#fff;color:#0f1419;border-radius:14px 14px 0 0;padding:14px 16px 22px;' +
  "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 -6px 26px rgba(0,0,0,.28)}" +
  '@media(min-width:700px){.gm-sheet{inset-inline-start:auto;inset-inline-end:14px;bottom:14px;width:330px;border-radius:12px}}' +
  '.is-dark .gm-sheet{background:#132019;color:#e5e7eb}' +
  '.gm-sh-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}' +
  '.gm-sh-name{font-weight:800;font-size:15px}' +
  '.gm-ai{display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;padding:7px 9px;border-radius:8px;font-size:11px;line-height:1.35;background:rgba(180,120,0,.12);color:#7a4f00;border:1px solid rgba(180,120,0,.25)}' +
  '.is-dark .gm-ai{background:rgba(255,200,80,.10);color:#f0cf88;border-color:rgba(255,200,80,.22)}' +
  '.gm-ai-x{margin-left:auto;flex:none;border:0;background:none;cursor:pointer;font-size:15px;line-height:1;color:inherit;opacity:.7;padding:0 2px;min-width:24px;min-height:24px}' +   // 24px: the AA target minimum; the glyph alone was ~15px
  '.gm-ai-x:hover{opacity:1}' +
  '.gm-x{margin-left:auto;border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit;' +
  'font:600 12px inherit;padding:6px 12px;border-radius:8px;cursor:pointer;min-height:34px}' +
  '.gm-stat{display:flex;justify-content:space-between;gap:12px;padding:4px 0;' +
  'border-bottom:1px solid rgba(0,0,0,.07);font-variant-numeric:tabular-nums}' +
  '.is-dark .gm-stat{border-bottom-color:rgba(255,255,255,.09)}' +
  '.gm-stat b{font-weight:700}' +
  '.gm-list{margin-top:9px}' +
  '.gm-list-h{font-weight:700;font-size:12px;margin-bottom:3px}' +
  '.gm-list ul{margin:0;padding-left:17px;font-size:12px;line-height:1.5}' +
  '.gm-note{margin-top:9px;font-size:11px;line-height:1.5;opacity:.75}' +
  '.gm-err{position:absolute;top:50%;left:0;right:0;text-align:center;font-size:13px;opacity:.7}' +
  '.gm-dot{width:10px;height:10px;border-radius:50%;flex:none;box-sizing:border-box;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)}' +
  // The group panel uses Prayer Progress's two wrappers, switched at the same breakpoint.
  '.gm-pg-mobile{display:none}' +
  '@media(max-width:767px){.gm-pg-mobile{display:block}.gm-pg-desktop{display:none}}',
  'doxa-connectivity-map',
)
</script>

<template>
  <div class="gm" :class="{ 'is-dark': isDark }">
    <div ref="mapEl" class="gm-map"></div>

    <!-- Shared control rail — MapToolbar self-positions top-right. Zoom/Location/
         Fullscreen gate on the live map instance; ShareButton needs neither and
         always renders so the map is embeddable. -->
    <MapToolbar v-if="mapRef">
      <ZoomInButton     :map="mapRef"          :is-dark="isDark" />
      <ZoomOutButton    :map="mapRef"          :is-dark="isDark" />
      <LocationButton   :map="mapRef"          :is-dark="isDark" />
      <FullscreenButton :map-container="mapEl" :is-dark="isDark" />
      <ShareButton      :is-dark="isDark"      :embed-path="'cities-internet/connectivity-map/index.html'" />
    </MapToolbar>

    <div v-show="!groupOpen" class="gm-legend">
      <div class="gm-title">{{ t('connectivity.title') }}</div>
      <div class="gm-keys">
        <span v-for="b in BANDS" :key="b.id" class="gm-key">
          <i class="gm-sw" :style="{ background: b.color }"></i>{{ t('connectivity.bands.' + b.id) }}
        </span>
        <span v-if="groups.length" class="gm-key">
          <i class="gm-dot" :style="{ background: PG_DOT }"></i>{{ t('connectivity.peopleGroup') }} ({{ fmt(groups.length) }})
        </span>
      </div>
      <div class="gm-caveat">
        {{ t('connectivity.caveat') }}
      </div>
      <!-- India by state: a different measure and source, so its own block and its own ramp. -->
      <div v-if="adm1" class="gm-adm1">
        <div class="gm-adm1-h">{{ t('connectivity.adm1.title') }}</div>
        <div class="gm-seg" role="group" :aria-label="t('connectivity.adm1.title')">
          <button type="button" :class="{ on: adm1Sex === 'women' }" :aria-pressed="adm1Sex === 'women'" @click="showAdm1Sex('women')">{{ t('connectivity.adm1.women') }}</button>
          <button type="button" :class="{ on: adm1Sex === 'men' }" :aria-pressed="adm1Sex === 'men'" @click="showAdm1Sex('men')">{{ t('connectivity.adm1.men') }}</button>
        </div>
        <div class="gm-keys">
          <span v-for="(st, i) in ADM1_STEPS" :key="st.from" class="gm-key">
            <i class="gm-sw" :style="{ background: st.color }"></i>{{ i + 1 < ADM1_STEPS.length ? st.from + '–' + ADM1_STEPS[i + 1].from + '%' : st.from + '%+' }}
          </span>
        </div>
        <div class="gm-caveat">{{ t('connectivity.adm1.source') }}</div>
        <div v-if="adm1Missing" class="gm-caveat">{{ t('connectivity.adm1.missing', { names: adm1Missing }) }}</div>
      </div>
    </div>

    <div v-if="err" class="gm-err">{{ err }}</div>

    <!-- A tapped people-group dot: the same PeopleGroupDetail panel Prayer Progress opens. -->
    <div v-if="groupOpen" class="gm-pg-desktop">
      <LegendDesktop legend-type="prayer" popup-action="pray" :initially-collapsed="false" :is-dark="isDark" />
    </div>
    <div v-if="groupOpen" class="gm-pg-mobile">
      <LegendMobile legend-type="prayer" popup-action="pray" :is-dark="isDark" />
    </div>

    <!-- Tap an Indian state: the same sheet, with both halves of the survey. -->
    <div v-if="selectedAdm1" class="gm-sheet">
      <div class="gm-sh-head">
        <span class="gm-sh-name">{{ selectedAdm1.name }}</span>
        <button type="button" class="gm-x" @click="selectedAdm1 = null">{{ t('connectivity.sheet.close') }}</button>
      </div>
      <div class="gm-list-h">{{ t('connectivity.adm1.title') }}</div>
      <table class="gm-adm1-t">
        <thead><tr><th></th><th>{{ t('connectivity.adm1.total') }}</th><th>{{ t('connectivity.adm1.urban') }}</th><th>{{ t('connectivity.adm1.rural') }}</th></tr></thead>
        <tbody>
          <tr v-for="sex in ['women', 'men']" :key="sex">
            <th>{{ t('connectivity.adm1.' + sex) }}</th>
            <td v-for="area in ['total', 'urban', 'rural']" :key="area">{{ selectedAdm1[sex][area] != null ? selectedAdm1[sex][area] + '%' : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="gm-note">{{ t('connectivity.adm1.source') }}</p>
    </div>

    <!-- Tap a country: bottom sheet on mobile, corner card on desktop. -->
    <div v-if="selected" class="gm-sheet">
      <div class="gm-sh-head">
        <span class="gm-sh-name">{{ selected.country }}</span>
        <button type="button" class="gm-x" @click="selected = null">{{ t('connectivity.sheet.close') }}</button>
      </div>
      <div v-if="aiNoticeOpen" class="gm-ai">
        <span>{{ t('connectivity.sheet.ai') }}</span>
        <button type="button" class="gm-ai-x" @click="aiNoticeOpen = false" :aria-label="t('connectivity.sheet.dismiss')">×</button>
      </div>
      <div class="gm-stat"><span>{{ t('connectivity.sheet.internetUsers') }}</span><b>{{ selected.internet_pct != null ? selected.internet_pct + '%' : t('connectivity.sheet.unknown') }}</b></div>
      <div class="gm-stat"><span>{{ t('connectivity.sheet.measured') }}</span><b>{{ selected.internet_year || '—' }}</b></div>
      <div class="gm-stat"><span>{{ t('connectivity.sheet.mobilePer100') }}</span><b>{{ selected.mobile_per_100 ?? '—' }}</b></div>
      <div class="gm-stat"><span>{{ t('connectivity.sheet.peopleGroups') }}</span><b>{{ fmt(selected.people_groups) }}</b></div>
      <div class="gm-stat"><span>{{ t('connectivity.sheet.topPlatform') }}</span><b>{{ selected.top_platform || t('connectivity.sheet.unknown') }}<template v-if="selected.top_platform_pct"> · {{ selected.top_platform_pct }}%</template></b></div>
      <div v-if="selected.carriers && selected.carriers.length" class="gm-list">
        <div class="gm-list-h">{{ t('connectivity.sheet.carriers', { n: selected.carrier_count }) }}</div>
        <ul><li v-for="(c, i) in selected.carriers" :key="i">{{ c }}</li></ul>
      </div>
      <div v-if="selected.platforms && selected.platforms.length" class="gm-list">
        <div class="gm-list-h">{{ t('connectivity.sheet.socialPlatforms') }}</div>
        <ul><li v-for="(p, i) in selected.platforms" :key="i">{{ p.name }} · {{ p.pct }}%</li></ul>
      </div>
      <p class="gm-note">{{ t('connectivity.sheet.note') }}</p>
    </div>
  </div>
</template>
