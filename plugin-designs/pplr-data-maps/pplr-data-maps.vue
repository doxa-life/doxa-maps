<script setup>
/**
 * pplr-data-maps.vue — PPLR data maps: ten views of the PPLR people-group data in one profile.
 *
 * @description Ten views that let a researcher check the PPLR people-group data by eye
 * @profile     pplr-data-maps
 * @bundle      pplr-data-maps
 * @element     pplr-data-maps
 *
 * MOVED 2026-09-25 from the PPLR-validate-data MFE (far-fast-tools, read-only) into this
 * plugin-designs folder. The ten views are its original app-profiles, now in src/views/, with its
 * own components, instance store and map helpers in src/. This hub replaces the original showcase
 * page's tab bar. The original registered <doxa-map>, which collided with doxa-simple-map; this
 * bundle registers <pplr-data-maps>.
 *
 * Data comes from data/pplr/ (built by scripts/build-data.mjs) through the tree's shared assets
 * base, so the bundle works embedded on any host. d3 loads on first need, for the sunburst.
 *
 * profile-config: { "profile":"pplr-data-maps", "tk":"pk...", "view":"pplr-religion" }
 */
import { inject, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { retryableAsyncComponent } from '@map/composables/retryableAsyncComponent.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { setDataBase, ensureD3 } from './src/utils/pplrData.js'
import { usePplrT } from './src/composables/usePplrT.js'

const profileConfig = inject('profileConfig')
const cfg = computed(() => profileConfig?.value || {})
setDataBase(resolveAssetsBase(cfg.value))

// Order and labels follow the original showcase page's tab bar.
// Tab labels are the chrome a reader sees first; they come from pplr.json (all 11 locales).
const t = usePplrT()
const VIEWS = [
  { key: 'pplr-religion',          label: 'Religion', tKey: 'pplr.tabs.religion',                  load: () => import('./src/views/pplr-religion.vue') },
  { key: 'pplr-rop-tree',          label: 'ROP Tree', tKey: 'pplr.tabs.ropTree',                  load: () => import('./src/views/pplr-rop-tree.vue') },
  { key: 'pplr-language-families', label: 'Language Families', tKey: 'pplr.tabs.languageFamilies',         load: () => import('./src/views/pplr-language-families.vue') },
  { key: 'pplr-semantic-trees',    label: 'Semantic Trees', tKey: 'pplr.tabs.semanticTrees',            load: () => import('./src/views/pplr-semantic-trees.vue') },
  { key: 'pplr-translations',      label: 'PG Name Locales', tKey: 'pplr.tabs.nameLocales',           load: () => import('./src/views/pplr-translations.vue') },
  { key: 'pplr-d3-tree',           label: 'ROP Sunburst', tKey: 'pplr.tabs.ropSunburst',              load: () => ensureD3().then(() => import('./src/views/pplr-d3-tree.vue')) },
  { key: 'pplr-pins',              label: 'All PG-in-country pins', tKey: 'pplr.tabs.allPins',    load: () => import('./src/views/pplr-pins.vue') },
  { key: 'pplr-rosetta-cards',     label: 'Cross-system ID Rosetta', tKey: 'pplr.tabs.rosetta',   load: () => import('./src/views/pplr-rosetta-cards.vue') },
  { key: 'pplr-coverage',          label: 'Translation coverage', tKey: 'pplr.tabs.coverage',      load: () => import('./src/views/pplr-coverage.vue') },
  { key: 'pplr-index',             label: 'Index', tKey: 'pplr.tabs.index',                     load: () => import('./src/views/pplr-index.vue') },
]
// The library wrapper, not Vue's raw async component: Vue caches a REJECTED loader, so one network blip
// left that tab dead until a full reload. retryableAsyncComponent retries the import instead.
const COMPONENTS = Object.fromEntries(VIEWS.map((v) => [v.key, retryableAsyncComponent(v.load)]))
const VALID = new Set(VIEWS.map((v) => v.key))

// Chosen at setup so a non-default view never mounts the default first (see upg-neighbor.vue).
const view = ref(VALID.has(cfg.value.view) ? cfg.value.view : 'pplr-religion')
function setView(k) { if (VALID.has(k)) view.value = k }

// The Index view's tiles dispatch pplr-select-profile on window (the original host page listened).
function onSelect(e) { setView(e?.detail?.profile || e?.detail?.id || e?.detail) }
onMounted(() => window.addEventListener('pplr-select-profile', onSelect))
onBeforeUnmount(() => window.removeEventListener('pplr-select-profile', onSelect))

useShadowStyles(
  '.pdm-root{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;background:#f3f3f1;' +
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;isolation:isolate}' +
  '.pdm-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fff;' +
  'border-bottom:1px solid #d1d4cd;overflow-x:auto;z-index:50}' +
  '.pdm-brand{font:700 12px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#3b463d;white-space:nowrap}' +
  '.pdm-seg{display:inline-flex;gap:4px;flex-wrap:nowrap}' +
  '.pdm-seg button{border:1px solid #d1d4cd;background:#fff;color:#3b463d;cursor:pointer;white-space:nowrap;' +
  'font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:7px 11px;border-radius:999px}' +
  '.pdm-seg button.on{background:#92b195;border-color:#92b195;color:#fff}' +
  '.pdm-seg button:hover:not(.on){border-color:#92b195}' +
  '.pdm-stage{flex:1 1 0;position:relative;min-height:0}',
  'pplr-data-maps')
</script>

<template>
  <div class="pdm-root">
    <div class="pdm-bar">
      <span class="pdm-brand">PPLR data maps</span>
      <div class="pdm-seg" role="tablist" :aria-label="t('pplr.ui.chooseView')">
        <button v-for="v in VIEWS" :key="v.key" role="tab" :aria-selected="view === v.key"
                :class="{ on: view === v.key }" @click="setView(v.key)">{{ t(v.tKey) }}</button>
      </div>
    </div>
    <div class="pdm-stage">
      <component :is="COMPONENTS[view]" :key="view" />
    </div>
  </div>
</template>
