/**
 * plugin-designs/doxa-simple-map/index.js
 *
 * Bundle entry — registers the doxa-simple-map web component(s).
 *
 * Registers TWO custom-element tag names that mount the SAME ProfileLoader
 * (separate defineCustomElement calls so each tag gets its own class):
 *   - <doxa-map>          legacy production tag (Q1 back-compat — must keep working)
 *   - <doxa-simple-map>   new explicit tag matching the bundle name
 *
 * Usage from a host page (legacy):
 *   <script src="/app/doxa-simple-map.iife.js"></script>
 *   <doxa-map profile-config='{"profile":"doxa-simple-map","tk":"pk.eyJ..."}'></doxa-map>
 *
 * Usage (new):
 *   <script src="/app/doxa-simple-map.iife.js"></script>
 *   <doxa-simple-map profile-config='{"profile":"doxa-simple-map","tk":"pk.eyJ..."}'></doxa-simple-map>
 *
 * The profile-config attribute is parsed by ProfileLoader (in @map).
 * `profile` must match a .vue file in this bundle's folder.
 *
 * Profile registry — Q3 contract from the migration plan: ProfileLoader lives
 * inside @map, so it cannot use import.meta.glob to reach into a
 * bundle's folder. The bundle MUST evaluate import.meta.glob('./*.vue')
 * locally and hand the result to the loader via app.provide('profileModules').
 *
 * Mapbox RTL text plugin: registered ONCE at module init (before any map
 * constructs), lazy-loads when Arabic/Hebrew text appears on the basemap.
 */

import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerStrategies } from '@map/colors/_registry.js'

// ─── Bundle-private profile registry ─────────────────────────────────────────
// import.meta.glob is evaluated by Vite at build time relative to THIS file —
// so it captures only this bundle's profiles. Handed to ProfileLoader via
// app.provide('profileModules', ...) below.
const profileModules = import.meta.glob('./*.vue')

// ─── Bundle-private color strategies ─────────────────────────────────────────
// Same seam as profileModules, for colors. Any `<name>.js` a contributor drops in
// this bundle's `src/colors/` folder is merged OVER the shared library set
// (same mode key = override; new key = profile-private). This bundle inlines its own
// copy of the registry (IIFE build), so registering here affects THIS bundle only.
// No-op today: doxa-simple-map ships no local strategies (empty glob).
registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

/**
 * Build a fresh defineCustomElement-wrapped class.
 *
 * Vue's defineCustomElement returns a class that gets registered with
 * customElements.define exactly once per tag name. Reusing a single class
 * across two tags is undefined behavior, so we call defineCustomElement TWICE
 * with the same component to produce two independent classes.
 *
 * Each instance gets its own Pinia + its own i18n via configureApp — that
 * isolation is important when multiple <doxa-map> embeds share a page.
 */
function buildDoxaMapElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Install i18n AND hand the instance to ProfileLoader by reference. The
      // defineCustomElement root cannot use useI18n() (see ProfileLoader.vue);
      // it drives locale through this provided instance instead.
      // Hand the bundle's profile registry to ProfileLoader (Q3 contract).
      // ProfileLoader inject('profileModules')s this — see ProfileLoader.vue.
  },
})
}

const DoxaMapElement       = buildDoxaMapElement()
const DoxaSimpleMapElement = buildDoxaMapElement()

// ─── Register both tag names ─────────────────────────────────────────────────
// Guards prevent "already registered" errors when this IIFE is loaded twice
// (e.g. on a page that ships both legacy and new <script> tags during a
// transition window).
if (typeof customElements !== 'undefined') {
  if (!customElements.get('doxa-map')) {
    customElements.define('doxa-map', DoxaMapElement)
  }
  if (!customElements.get('doxa-simple-map')) {
    customElements.define('doxa-simple-map', DoxaSimpleMapElement)
  }
}

export default DoxaMapElement
export { DoxaSimpleMapElement }
