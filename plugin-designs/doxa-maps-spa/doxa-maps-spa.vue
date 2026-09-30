<!--
  doxa-maps-spa.vue — the Category-5 (nested-mfe-spa / app-shell) root component.

  * @description The DX-maps app itself: one element whose vertical-tab rail nests every other
    plugin as a tab, so a user reaches all the research maps in one place instead of a dozen
    separate embeds. Curated sections encode the teaching order; anything else in the built
    manifest is auto-discovered into Experimental, so a new plugin appears with no edit here.

  ONE element, <doxa-maps-spa>, renders a VERTICAL-TAB layout that nests the other plugins
  as its tabs. This IS the DX-maps app: the unified place a user opens to reach every research
  map without getting confused by a dozen separate embeds.

  TAB 1 = Big Picture — the cap-4 composite `dashboard-plus-grid`: the research dashboard with the
    real people-groups grid stacked beneath it, scrolled as one element.

  HOW EVERY TAB NESTS. ONE way, for every tab: inject that bundle's script once (guarded), wait for
    its tag to REGISTER, then create the REAL custom element in an empty Vue-unmanaged slot. There
    is NO iframe mode. Every plugin here is a compiled Vue custom element, so the SPA embeds the
    element itself rather than a page wrapped around one — which is what lets the same bundle serve
    all five deployment methods and compose further.

  ★ THE IFRAME MODE THAT USED TO LIVE HERE, AND WHY IT IS GONE (2026-09-22).
    Every tab used to point a lazy <iframe> at that bundle's standalone leaf page, for two stated
    reasons: (a) the map bundles each run a one-shot customElements.define, so sharing a document
    risked a collision, and (b) window.MAP_TOKEN does not cross an iframe boundary, so a leaf's own
    baked token kept each map independently correct.

    Reason (a) was MEASURED away: the tree holds 19 distinct tags across 19 bundles with ZERO tags
    claimed twice, so loading every bundle into one document registers 19 distinct tags and collides
    with nothing. Two map elements were proven to coexist in one document. Reason (b) inverts once
    the frames are gone — sharing THIS document means every tab reads the page's own token, so the
    shell forwards tk/tokenUrl through profile-config instead (see mountElement).

    What the iframes COST was the actual defect: each tab carried a HARDCODED, BUILT-TREE page path
    ('dashboard-plus-grid/dashboard-plus-grid/index.html'). Those pages do not exist under the dev
    server, so every tab 404'd there — the Driver saw exactly that in his browser console. A path is
    a deployment detail; the manifest's scriptUrl + element are identities that are correct in BOTH
    trees. Tabs now name a bundle+profile and resolve the rest from the manifest.

    WHAT REPLACED THE GUARD. The real cost of direct mounting is the browser's WebGL CONTEXT BUDGET,
    so that is what the code now bounds (see HEAVY_ELEMENTS): heavy tabs are DESTROYED on deactivate
    rather than hidden, keeping at most one live map context.

  TREE BASE: the SPA must know where the tree lives to fetch manifest.json and each bundle's script.
    index.js captures the running <script src=".../doxa-maps/doxa-maps-spa/doxa-maps-spa.js">
    URL at IIFE load (document.currentScript) and provides its tree root (two levels up). A host
    can override it with profile-config.treeBase or the tree-base="" attribute. Default falls
    back to a same-tree relative guess so a plain drop still resolves.

  NO re-import of any nested plugin's components and NO re-registration of a tag another bundle
  owns — the only tag this bundle defines is <doxa-maps-spa> (see index.js). Each nested bundle
  registers its own tag from its own script, and the tags are disjoint by naming discipline.
-->
<template>
  <!-- The SHELL (top bar + vertical tab rail + content frame) is the ONE shared beautiful layout,
       VerticalTabsLayout (library/layouts). This SPA only supplies the tab manifest + owns the panes:
       the direct-element mount and the heavy-tab teardown machinery live in the default slot below,
       driven by activeIndex. -->
  <VerticalTabsLayout
    :dir="uiDir"
    :lang="uiLocale"
    :labels="layoutLabels"
    :title="heading"
    :nav-label="t('navLabel')"
    :header="showHeader"
    :groups="navGroups"
    :active="activeKey"
    @update:active="onSelect">

    <!-- #brand: the DX-Maps logo mark, left of the title (a compass-star glyph, self-drawn SVG — no
         external asset, offline/F-Droid safe; the accent green matches the admin shell). -->
    <template #brand>
      <span class="dms-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#92b195" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polygon points="12 6 14 12 12 18 10 12" fill="#92b195" stroke="none" />
          <polygon points="6 12 12 10 18 12 12 14" fill="#92b195" opacity="0.55" stroke="none" />
        </svg>
      </span>
    </template>

    <template #meta>{{ t('meta', { n: tabs.length }) }}</template>

    <!-- #toolbar: the i18n locale switcher (3-dots/flag). GATED by showLocaleSwitcher — the cap-5
         DX-Maps SPA has NO standalone language dropdown by default; it INHERITS its language from the
         parent page via the `language` prop (see effectiveLocale). The dropdown only shows when the
         header is ON (a host explicitly opts the SPA into its own chrome). Reuses
         app-wrapper-material/languages.js — persists the choice + re-sets the mounted tab-1 element's
         profile-config.locale (languages.js's contract). No routing, no dep. -->
    <template #toolbar v-if="showLocaleSwitcher">
      <div class="dms-locale">
        <button type="button" class="dms-locale-btn" :aria-expanded="String(localeOpen)"
          aria-label="Change language" @click="localeOpen = !localeOpen">
          <span class="dms-flag">{{ activeLang.flag }}</span>
          <span class="dms-locale-name">{{ activeLang.nativeName }}</span>
          <span class="dms-dots" aria-hidden="true">⋮</span>
        </button>
        <ul class="dms-locale-menu" v-if="localeOpen" role="listbox">
          <li v-for="l in switcherLangs" :key="l.code" role="option"
            :aria-selected="String(l.code === locale)">
            <button type="button" class="dms-locale-opt" :class="{ active: l.code === locale }"
              @click="setLocale(l.code)">
              <span class="dms-flag">{{ l.flag }}</span>
              <span class="dms-locale-name">{{ l.nativeName }}</span>
              <span class="dms-locale-en">{{ l.name }}</span>
            </button>
          </li>
        </ul>
      </div>
    </template>

    <!-- EVERY tab mounts its plugin's REAL custom element — there is no iframe mode. The tag is
         created imperatively into an EMPTY, Vue-unmanaged slot div (:ref, no children) after that
         bundle's script is injected once, so Vue never fights the custom element's own shadow DOM.
         The loading/error hint is a SEPARATE overlay sibling, so clearing the slot with innerHTML
         can never remove a Vue-managed node.

         TWO LIFETIMES, and the difference is the WebGL context budget, not cosmetics:
           LIGHT rows (v-show) stay mounted once loaded, so switching back is instant and state
             survives. This is deliberate — do not "simplify" it to v-if.
           HEAVY rows (v-if, t.heavy — anything that owns or NESTS a map) are DESTROYED on
             deactivate. Removing the host node runs the element's disconnected lifecycle
             (onBeforeUnmount → map.remove()), which is what actually releases the GPU context.
             Without it every map ever visited would hold a live context until the browser silently
             dropped the OLDEST one and an already-visited tab went blank with NO error. -->
    <section
      v-for="(t, i) in tabs" :key="t.id" class="dms-pane"
      v-show="i === activeIndex" :hidden="i !== activeIndex">

      <template v-if="!t.heavy || i === activeIndex">
        <div v-if="showsMobileNotice(t.id)" class="dms-mobile-notice" role="status">
          <span>{{ tr('mobileNotice') }}</span>
          <button type="button" class="dms-mobile-notice-x" :aria-label="tr('dismiss')" @click="dismissMobileNotice(t.id)">×</button>
        </div>
        <div class="dms-slot" :ref="el => setSlot(i, el)"></div>
        <div v-if="t.state === 'loading'" class="dms-hint">{{ tr('loading', { label: tabLabel(t) }) }}</div>
        <div v-else-if="t.state === 'error'" class="dms-hint err">
          {{ tr('loadFailed', { label: tabLabel(t) }) }}<br><small>{{ t.error }}</small>
        </div>
        <!-- ★ THE FOURTH STATE, and the one that used to render NOTHING. A tab whose scriptUrl the
             manifest never supplied sits in state 'idle' forever: not loading, not errored, just an
             empty slot — the grey pane the Driver reported four times. Covering it here means a
             missing manifest now READS as a failure instead of looking like a blank app. -->
        <div v-else-if="t.state === 'idle' && !t.scriptUrl && manifestError" class="dms-hint err">
          {{ tr('loadFailed', { label: tabLabel(t) }) }}<br>
          <small>{{ manifestError }}</small><br>
          <small>{{ tr('manifestHint') }}</small>
        </div>
      </template>
    </section>

    <!-- THE DEVICE-RULE NOTICE — fires when a mobile user clicks the disabled Big Picture row (see
         onSelect's intercept). A transient toast rather than a modal: the point is to explain why
         nothing switched, not to block the app. Sibling of the panes, not inside one, so it survives
         whichever tab is currently active. -->
    <div v-if="disabledNotice" class="dms-notice" role="status">{{ disabledNotice }}</div>

    <!-- THE EXPERIMENTAL "?" — what a shelf map is for and how to use it (src/experimentalHelp.js).
         Shown only on a discovered tab that HAS an entry: a map with no text shows no button rather
         than an empty dialog. Modal: focus moves to Close, Tab stays inside, Escape or Close returns
         focus to the "?", and switching tab closes it. -->
    <button v-if="activeHelp" ref="helpBtn" type="button" class="dms-help-btn"
            :aria-label="tr('help')" :title="tr('help')" @click="openHelp">?</button>
    <div v-if="helpOpen && activeHelp" class="dms-help-scrim" @click.self="closeHelp"
         @keydown.esc.stop.prevent="closeHelp">
      <div class="dms-help" role="dialog" aria-modal="true" aria-labelledby="dms-help-title"
           @keydown.tab.prevent="$refs.helpClose && $refs.helpClose.focus()">
        <h2 id="dms-help-title" class="dms-help-title">{{ tabLabel(tabs[activeIndex]) }}</h2>
        <p class="dms-help-what"><strong>{{ activeHelp.what }}</strong></p>
        <p class="dms-help-how">{{ activeHelp.how }}</p>
        <button ref="helpClose" type="button" class="dms-help-close" @click="closeHelp">{{ tr('close') }}</button>
      </div>
    </div>
  </VerticalTabsLayout>
</template>

<script>
import { defineComponent, inject } from 'vue'
import VerticalTabsLayout from '@map/layouts/VerticalTabsLayout.vue'
import { SWITCHER_LANGUAGES, loadLocale, saveLocale, getLanguage } from '@map/layouts/app-wrapper-material/languages.js'
import { translate, LOCALES, hasKey } from './src/strings.js'
import { helpFor } from './src/experimentalHelp.js'
import { loadScriptOnce, whenTagDefined } from '@map/utils/embedScript.js'

// THE HOST PAGE'S LANGUAGE, by the same ladder every nested map already uses (library/i18n
// detectLocale): ?lang= / ?locale= on the page URL, then <html lang>. '' when the page says nothing.
// NOT navigator.language: the gallery used to fall back to the BROWSER's language and force it onto
// every child through profile-config.locale — measured 2026-09-25, a Spanish page (<html lang="es">)
// viewed in a German browser rendered its maps in German and its own rail in English.
function detectHostLocale() {
  try {
    const q = new URLSearchParams(location.search)
    const fromUrl = (q.get('lang') || q.get('locale') || '').split('-')[0].toLowerCase()
    if (LOCALES.includes(fromUrl)) return fromUrl
  } catch { /* no window */ }
  try {
    const fromHtml = (document.documentElement.lang || '').split('-')[0].toLowerCase()
    if (LOCALES.includes(fromHtml)) return fromHtml
  } catch { /* no document */ }
  return ''
}

// The Driver's section/folder nav model, ported from app-wrapper-material/nav.js (the verified
// source of the exact sections the Driver wants). Each entry is a GROUP for VerticalTabsLayout; each
// `tab` names a REAL TAB_DEFS id so clicking a row still drives the SAME mount machinery (onSelect →
// findIndex(t.id === key)). Sections/folders + icons are authored here; rows whose bundle does not
// exist in this SPA are OMITTED (never paint a dead nav row — nav.js's own navForTarget prunes empty
// groups the same way). `folder:true` (Experimental) renders collapsible, starting closed.
const NAV_MODEL = [
  // ── THREE SECTIONS, PER THE SPEC (2026-09-22 audio, transcribed to
  //    _qa-cycle/01-ideation-research/SPEC-the-six-map-product-and-its-tab-order.md — that file is
  //    AUTHORITATIVE; this comment explains how the code satisfies it, not the ruling itself).
  //
  //    Driver, verbatim: "in one of the earlier messages i mentioned i wanted 3 tab sections. one
  //    called dashboards, one called prayer mobilization, one called gospel research. with two maps
  //    inside of each of them."
  //
  //    A PRIOR CUT REMOVED DASHBOARDS ENTIRELY (see git history / the spec's "duplicate-key trap"),
  //    because Big Picture had been declared TWICE — once as a one-row Dashboards section and once as
  //    Prayer Mobilization's first rung — and VerticalTabsLayout keys its tab-ref map and `active`
  //    highlight BY ID, so two rows sharing one id painted both active at once and stalled keyboard
  //    nav. That was a REGRESSION, not a fix for the underlying constraint. The constraint (no id
  //    painted twice) is real and still enforced (see dedupeRows + the assertNoDuplicateTabKeys
  //    dev-time gate below); the fix is that Dashboards now owns TWO DISTINCT rows of its own — Big
  //    Picture never appears in Prayer Mobilization again — so it is not a one-row section that begs
  //    to be folded away.
  { key: 'dashboards', label: 'Dashboards', i18n: 'sec.dashboards', icon: 'chart',
    tabs: [
      // 1. Big Picture — desktop default. Present on EVERY width (the device rule is "same tab
      //    order everywhere"), but DISABLED on mobile rather than hidden — see isDesktopOnly /
      //    onSelect's intercept and the `disabled`-row note above navGroups. Clicking it on mobile
      //    shows a message instead of switching; it never disappears from the rail.
      { id: 'dashboard-plus-grid',     icon: 'chart' },
      // 2. Simple Research — mobile default; RENAMED from "Research Map" and RECATEGORISED here as a
      //    dashboard (it used to live as Prayer Mobilization's mobile-only rung 1). It is the research
      //    map + People Groups grid composite — "the mobile dashboard" per the spec — and it stays
      //    reachable on desktop too, as the second dashboard row.
      { id: 'research-map-plus-grid',  icon: 'map' },
      // 3. Regions — the THIRD dashboard the Driver named: "in the dashboard section I need to have
      //    the Big Picture dashboard, the Simple Research dashboard and the Regions dashboard."
      //    Seven plugins across three sections was the ask; this row is the seventh.
      //
      //    ★ WHAT SHIPS TODAY IS TAB 1 OF 2. regions-dashboard currently builds a single profile,
      //    `regions-list` (verified in the manifest: profiles ['regions-list'], element
      //    'regions-dashboard') — the WAGF region list refactored from DX-life's /regions page,
      //    which emits region-selected / country-selected. The second profile, the scrollable
      //    region/country detail dashboard those events will drive, is a separate card and lands as
      //    an ADDITIONAL profile in the same bundle; this row needs no edit when it does, because
      //    the row names the BUNDLE and the shell resolves its profile from the manifest.
      //
      //    Listing it now rather than waiting for tab 2: a working list that reaches the rail is
      //    worth more than a complete feature nobody can open, and its absence was the one real gap
      //    between the Driver's seven and the six that shipped.
      { id: 'regions-dashboard',       icon: 'map' },
    ] },
  // Prayer Mobilization — now TWO rows only: the onboarding ramp's steps 2 and 3. Big Picture (former
  // step 1) moved to Dashboards above; Gospel Resources (former step 4) moved to Gospel Research below
  // per the spec's table. UPG-100 BEFORE Prayer Progress is still the Driver's deliberate order —
  // "if you're trying to mobilize prayer, UPG-100 list probably comes first because it's a NEW thing
  // to people — you want them introduced to it first" — hand the newcomer the concrete new artifact,
  // THEN ask them to pray it.
  { key: 'prayer-mobilization', label: 'Prayer Mobilization', i18n: 'sec.prayer', icon: 'heart',
    tabs: [
      { id: 'upg-100',    icon: 'list' },   // 1. UPG-100 List — the NEW thing, introduced first
      { id: 'prayer-map', icon: 'embed' },  // 2. Prayer Progress — now pray the list
    ] },
  // Gospel Research — RENAMED section (was "Research"). Cities with Internet then Gospel Resources,
  // per the spec's table (rows 5-6). The plain, uncomposited "Research Map" tab (doxa-research-map)
  // is no longer one of the six curated tabs — its research-map+grid composite now IS Dashboards row
  // 2 (Simple Research) — so the standalone map is left OUT of every curated section and falls
  // through to Experimental automatically (see curatedBundles/experimentalTabsFromManifest); that is
  // correct, not an omission.
  { key: 'gospel-research', label: 'Gospel Research', i18n: 'sec.gospel', icon: 'search',
    tabs: [
      { id: 'cities-internet',  icon: 'wifi' },  // renamed label: "Cities with Internet"
      { id: 'gospel-resources', icon: 'book' },
    ] },
  // Experimental — a collapsible FOLDER at the bottom (nav.js: kind 'folder', open:false). Starts
  // CLOSED; click the heading to open.
  //
  // ★ GENERIC BY CONSTRUCTION — no hardcoded row list. Its `tabs` is deliberately EMPTY here and is
  //   filled at runtime by discoverExperimental() from the BUILT manifest.json: every bundle that
  //   exists in the tree but is not placed in a named section above lands here automatically. Add a
  //   new plugin to plugin-designs/ and it appears in this folder with ZERO edits to this file.
  //   WHY this matters: a hardcoded list fails SILENTLY — the next plugin author ships a bundle, it
  //   builds fine, and it is simply invisible in the app with no error to notice. Same principle the
  //   Driver set for the data bundler: handle every plugin generically, or the next author gets
  //   nothing. The named sections above stay curated (they encode the teaching order); Experimental
  //   is the automatic catch-all so nothing can go missing.
  { key: 'experimental', label: 'Experimental', i18n: 'sec.experimental', icon: 'flask', folder: true, open: false, tabs: [] },
]

// Bundles that are NOT candidates for auto-discovery into Experimental, with the reason each is
// excluded. Everything else the manifest reports becomes an Experimental tab automatically.
//   - doxa-maps-spa : this shell itself (nesting the app inside its own tab = infinite regress)
//   - plugin-studio : the authoring/dev tool, not an end-user map
//   - template-bundle: the copy-me scaffold for new plugin authors, not real content
//   - people-groups-grid / research-dashboard / big-picture: the PARTS that are already composed
//     into the ONE `dashboard-plus-grid` Big Picture tab — surfacing them separately is the exact
//     redundancy the Driver removed ("we don't need multiple dashboards").
// ── DEVICE RULES (Driver, 2026-09-28 16:50Z: DRV1650-MOBILE-GATING) ─────────────────────────
// PRODUCTION maps that are not mobile-ready are BLOCKED on a narrow screen: the row stays in the rail,
// disabled with a "desktop only" badge, and a tap explains why instead of mounting (Big Picture was the
// first, and still works exactly that way). EXPERIMENTAL maps not built for mobile still OPEN on a
// narrow screen, with a "not built for mobile" badge and a dismissible notice in the pane: an
// experiment should be reachable, and honest about where it works. Add an id here, not a width test
// anywhere else; check:mobile-gating holds the two sets to their shelves.
const DESKTOP_ONLY = new Set(['dashboard-plus-grid'])
const MOBILE_NOTICE = new Set(['gospel-internet'])

const NOT_EXPERIMENTAL = new Set([
  'doxa-maps-spa',
  'plugin-studio',
  'template-bundle',
  'people-groups-grid',
  'research-dashboard',
  'big-picture',
  // roundup ruling (EXPERIMENTAL-MAPS-ROUNDUP.md, 2026-09-24): scaffolding and authoring
  // tooling, not maps -- the studio still surfaces them for developers.
  'demo-map',
  'golden-path-check',
  // doxa-research-map is the PART already composed into the Simple Research tab
  // (research-map-plus-grid) -- same redundancy rule as research-dashboard/big-picture.
  'doxa-research-map',
  // stack-demo is broken and Driver-DEFERRED; a broken tab in the giveaway shelf reads as
  // product damage. It returns when someone fixes it (a tracked issue).
  'stack-demo'
])

// ── EXPERIMENTAL ORDER = KINGDOM IMPACT, not the alphabet ────────────────────────────────
// The roundup charter orders the folder by "potential to get people TO the unreached groups
// and help them meet and understand Jesus", finalized 2026-09-24 AFTER reading every map's
// rendered output (EXPERIMENTAL-MAPS-ROUNDUP.md has the per-map reasoning). Rank is
// EDITORIAL, the same class of decision as the curated TAB_DEF above -- which is why it
// lives here and not in per-bundle meta: the manifest deliberately strips meta config, and
// an order is a statement about the whole shelf, not about one bundle. Unranked bundles
// still appear (discovery is never gated by this) -- they sort after the ranked, A-Z.
// ★ TOP THREE SET BY THE DRIVER (brief 2026-09-28 16:50Z, DRV1650-EXP-ORDER): Prayer Walk Planner,
// then Gospel × Internet, then UPG Neighbor ("one of our up-and-coming"). The rest keep their order.
const EXPERIMENTAL_RANK = {
  'prayer-walk-planner': 1,   // feet on streets: zones -> printed one-page walking maps
  'gospel-internet': 2,       // the unified dashboard: language tree, bounded/centered sets, map
  'upg-neighbor': 3,          // near reached neighbors, both directions ("who goes, to whom")
  'key-cities': 4,            // where the unreached physically live
  'all-people-groups': 5,     // the census view that feeds everything else
  'country-posters': 6,       // mobilization print artifacts
  'doxa-vision-card': 7,      // vision framing
}

// The tab manifest. Each entry CURATES one tab: which bundle+profile it shows, in what order, under
// what human label. Every tab nests its plugin's REAL custom element — there is no iframe mode.
//
// ★ WHAT A TAB DECLARES, AND WHAT IT DELIBERATELY DOES NOT. A tab names a `bundle` and a `profile`
//   — two IDENTITIES the manifest can resolve — and never a PATH. The script URL and the element tag
//   are looked up from manifest.json at runtime (see resolveTabsFromManifest), because the manifest
//   is the one artifact that is correct in BOTH trees: it hands "/plugin-designs/<b>/index.js" under
//   the dev server and "./<b>/<b>.js" under the built tree.
//
// ★ THE 404 CLASS THIS REPLACED (measured 2026-09-22, hit by the Driver in his own browser). Every
//   entry used to carry a hardcoded `leaf:` — a BUILT-tree page path, e.g.
//       leaf: 'dashboard-plus-grid/dashboard-plus-grid/index.html'
//       leaf: 'my-upg-100-list/upg-100-mfe/index.html'
//   and each tab pointed an iframe at it. Under the dev server those pages do not exist, so the
//   console filled with
//       GET /__plugin-gallery/dashboard-plus-grid/dashboard-plus-grid/index.html?locale=en  404
//       GET /__plugin-gallery/my-upg-100-list/upg-100-mfe/index.html?locale=en              404
//   The dev MANIFEST was clean the whole time (zero profiles carry a leaf-style iframeUrl); the 404s
//   came only from this hardcoded list. A path is a deployment detail; an identity is not. Naming
//   identities is what makes ONE dev server show every plugin — the Driver's actual ask.
//
//   A second, sharper symptom proved the paths were built-tree fossils rather than merely stale:
//   `prayer-map` pointed at 'doxa-simple-map/doxa-simple-map/prayer/index.html', and the dev
//   manifest has NO `prayer` instance at all — only the `doxa-simple-map` profile. That path could
//   never resolve under dev no matter how the base was joined.
//
// `profile` is LOAD-BEARING, not decoration: gospel-resources ships four profiles (charts /
// data-tables / resources-list / resources-map) through the SAME tag <gospel-resources-map>, so the
// tag alone cannot say which view to paint. profile-config.profile is what selects it.
const TAB_DEFS = [
  {
    // THE ONE DASHBOARD (the Driver's "Big Picture"): research-dashboard + people-groups-grid compiled
    // into ONE element on a single scroll-page — scroll down past the dashboard to the grid. Replaces the
    // former separate `big-picture` and `research-dashboard` tabs (removed as redundant).
    id: 'dashboard-plus-grid', label: 'Big Picture', sub: 'dashboard + people-groups grid, stacked', emoji: '🌍',
    bundle: 'dashboard-plus-grid', profile: 'dashboard-plus-grid'
  },
  {
    id: 'research-map', label: 'Research Map', sub: 'prayer · engagement · regions', emoji: '🗺️',
    bundle: 'doxa-research-map', profile: 'research-map'
  },
  {
    // RENAMED (spec): "Research Map" → "Simple Research", and RECATEGORISED as a Dashboards row (the
    // mobile-default dashboard). Driver 2026-09-22, having reversed an earlier idea: "We made the
    // wrong choice of saying that we should swap elements based on mobile and desktop... It'd be
    // easier just to have two separate capability-4 plugins." So there are two cap-4 composites,
    // neither aware of the other — this one and 'dashboard-plus-grid' above — and the shell decides
    // which is AUTO-SELECTED by width (see firstVisibleIndex/isDesktopOnly), never which is
    // SHOWN: per the device rule both rows are always in the rail. Both composites stay independently
    // embeddable, which a self-swapping element could not be (an embedder at a fixed size could never
    // ask for one).
    //
    // NOTE the `id` stays 'research-map-plus-grid': the id is the stable join key between NAV_MODEL
    // and TAB_DEFS, so only the human-facing LABEL/sub change on a rename — never the id.
    //
    // Same cap-4 tier as its desktop sibling: research-map-plus-grid.meta.json declares
    // {"type":"nested-elements-mfe"}, verified against the built manifest.
    id: 'research-map-plus-grid', label: 'Simple Research', sub: 'research map + people-groups grid', emoji: '🗺️',
    bundle: 'research-map-plus-grid', profile: 'research-map-plus-grid'
  },
  {
    // RENAMED (Driver): "Prayer Map" → "Prayer Progress". His words: "the prayer maps can be renamed
    // Prayer Progress Map, or just Prayer Progress, and it can sit UNDERNEATH UPG-100 List." The
    // shorter form won — the rail is narrow and "Progress" already implies the map. NOTE the `id`
    // stays 'prayer-map': the id is the stable join key between NAV_MODEL and TAB_DEFS, so only the
    // human-facing LABEL changes. Renaming the id would break the nav lookup for no user-visible gain.
    //
    // `prayer` is an INSTANCE of the parameterized doxa-simple-map bundle, present in the BUILT tree
    // and absent from the dev manifest. It is declared as an optional `instance` rather than baked
    // into a path: where it exists the tab renders that preset, and where it does not the tab falls
    // back to the bundle's own profile instead of 404ing. See resolveTabsFromManifest.
    id: 'prayer-map', label: 'Prayer Progress', sub: 'simple world prayer map', emoji: '🙏',
    bundle: 'doxa-simple-map', profile: 'doxa-simple-map', instance: 'prayer'
  },
  {
    // RENAMED (spec): "Cities & Internet" → "Cities with Internet" — the Gospel Research section's
    // first row. NOTE the `id` stays 'cities-internet' for the same stable-join-key reason as above.
    id: 'cities-internet', label: 'Cities with Internet', sub: 'connectivity of key cities', emoji: '📡',
    bundle: 'cities-internet', profile: 'connectivity-map'
  },
  {
    id: 'gospel-resources', label: 'Gospel Resources', sub: 'resources by place', emoji: '📖',
    bundle: 'gospel-resources', profile: 'resources-map'
  },
  {
    // The third Dashboards row. `profile` names the ONE profile this bundle currently builds;
    // when the region-detail profile lands it becomes tab 2 INSIDE this element, so this entry
    // still does not change — the shell resolves the profile from the manifest either way.
    // ★ MOUNT THE COMPOSITE, NOT THE LEAF (Driver 2026-09-23: "the Regions tab is supposed to be a
    // capability-4 plugin, but right now it looks like it's only a capability-1").
    // He was right, and the cause was here rather than in the regions bundle: regions-mfe (the cap-4
    // nested-elements-mfe composing regions-list + region-dashboards, with the shared Select View
    // strip) HAD shipped, but this entry still named the bare `regions-list` leaf — the cap-1 half.
    // So the shell rendered one flat list with no tab strip while the composite sat unused.
    // The note above anticipated exactly this ("when the region-detail profile lands it becomes tab
    // 2 INSIDE this element") but assumed the shell would follow automatically; it does not — the
    // profile named here is the one that mounts. Compare the UPG-100 entry below, which correctly
    // names `upg-100-mfe` rather than `upg-100-list`: same shape, and it is why that tab has tabs.
    id: 'regions-dashboard', label: 'Regions', sub: 'regions and their countries', emoji: '🌐',
    bundle: 'regions-dashboard', profile: 'regions-mfe'
  },
  {
    id: 'upg-100', label: 'UPG-100 List', sub: 'my unreached list + posters', emoji: '📋',
    bundle: 'my-upg-100-list', profile: 'upg-100-mfe'
  },
  // ── NOTE: there are deliberately NO hardcoded Experimental entries here. Every built bundle not
  //    named above is discovered from manifest.json at runtime and appended as an Experimental tab
  //    (see discoverExperimental + NOT_EXPERIMENTAL). That is what keeps a NEW plugin visible with
  //    zero edits to this file.
]

// THE SPEC'S REQUIRED GATE, run once at module load — see assertNoDuplicateTabKeys below for why this
// exists as a LOUD check on top of dedupeRows' silent runtime safety net. `function` declarations
// hoist, so this call is valid even though the function body is defined later in the file.
assertNoDuplicateTabKeys(NAV_MODEL)

// MAP ELEMENTS — the rows this shell DESTROYS on deactivate rather than hiding.
//
// ★ THIS IS A WebGL CONTEXT BUDGET, NOT A STYLE CHOICE. The browser allows ~8-16 live WebGL contexts.
//   Exceeding it prints "Too many active WebGL contexts" and silently kills the OLDEST one —
//   getContext() still returns a context and NO event fires on the new canvas, so a previously
//   visited map simply goes blank with no error anywhere. Keeping every pane alive with v-show (the
//   right default for light rows, since state survives and switching is instant) would walk straight
//   into that ceiling. So heavy rows use v-if and are torn down, bounding the document to ~1 live map.
//
// ★ MEASURED, NOT GUESSED — and NOT a copy of the old iframe list. A row is heavy if its element
//   holds a live WebGL CONTEXT, which a TAG NAME CANNOT TELL YOU: the cap-4 composites embed maps as
//   nested CHILDREN, so <dashboard-plus-grid> and <research-map-plus-grid> own a context while
//   looking like plain composites. Counting canvases inside the ACTIVE PANE reports 1 and looks
//   clean; counting them DOCUMENT-WIDE is what exposes the real total. Measure the document.
//   Mirrors plugin-studio.vue's HEAVY_ELEMENTS, which was derived the same way over the same tree.
const HEAVY_ELEMENTS = new Set([
  // map elements proper
  'doxa-research-map', 'doxa-simple-map', 'cities-internet-map', 'gospel-resources-map',
  'my-upg-100-list-map', 'doxa-map', 'doxa-maps-spa',
  // composites that NEST a map, so they own a context too (measured, see above)
  'dashboard-plus-grid', 'research-dashboard-map', 'demo-map', 'all-people-groups',
  'country-posters-map', 'key-cities-map', 'research-map-plus-grid',
  // up to TWO contexts: its map, plus the language-tree whiteboard once that is opened
  'gospel-internet-board'
])

// SCROLL-STACK ELEMENTS — the rows this shell mounts WITHOUT the fixed-viewport inline style
// (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID, Driver-reported). Every mounted tab used to get
// `position:absolute;inset:0;height:100%` unconditionally, which is correct for a single
// FIXED-VIEWPORT map (it fills the pane exactly, scrollHeight===clientHeight, no scrollbar) but
// traps a SCROLL-STACK composite: `dashboard-plus-grid` and `research-map-plus-grid` are built on
// the shared StackLayout (library/layouts/StackLayout.vue), which is natural-height, flow-root,
// NO fixed height by design — the whole point is that the host page grows and scrolls through it.
// Pinning that element to `inset:0` forces it back to exactly one viewport tall regardless of its
// real content height, which is the trap: a tall composite (research-dashboard + people-groups
// grid stacked, ~2600px of real mounted content) had nowhere for that height to go, because BOTH
// the element AND its container (.dms-pane/.dms-slot) were absolutely positioned with no scroller.
// The two composites here are exactly the two bundle ids that use StackLayout as their OWN root —
// same identification method as HEAVY_ELEMENTS (measured against the tree, not guessed), and it is
// not a coincidence that both entries already appear in that set too (they also nest a map).
const SCROLL_ELEMENTS = new Set(['dashboard-plus-grid', 'research-map-plus-grid'])

// The set of bundle ids the CURATED sections above already place, derived from NAV_MODEL + TAB_DEFS
// rather than hand-written. Deriving it means the "is this already placed?" answer can never drift
// out of sync with the actual rail — the classic failure mode of a parallel hardcoded list.
function curatedBundles() {
  const byId = Object.fromEntries(TAB_DEFS.map(t => [t.id, t]))
  const out = new Set()
  for (const g of NAV_MODEL) {
    if (g.key === 'experimental') continue          // the catch-all places nothing by definition
    for (const r of g.tabs || []) {
      // Every curated tab now declares its `bundle` outright. It used to be recovered from the first
      // segment of the hardcoded `leaf` path — a second reason those paths were load-bearing, and a
      // silent one: a tab with a wrong leaf ALSO mis-reported which bundle it had placed, which would
      // let an already-curated bundle reappear in Experimental.
      const t = byId[r.id]
      if (t && t.bundle) out.add(t.bundle)
    }
  }
  return out
}

/**
 * THE RAIL'S ONE ENUMERATION RULE — one row per TAB ID, first declaration wins.
 *
 * ★ THE RULE, stated once so the next plugin author inherits it deliberately rather than by accident:
 *   a BUNDLE contributes exactly ONE rail row. Its profiles (gospel-resources ships charts /
 *   data-tables / resources-list / resources-map; big-picture ships instances) are alternate VIEWS of
 *   that one map and are reachable INSIDE the pane — they are NOT promoted to rail rows. The rail is
 *   an onboarding ramp, not an inventory: per-profile rows would add four rows for gospel-resources
 *   alone and bury the teaching order the sections above encode.
 *
 * WHY A FUNCTION AND NOT JUST A CAREFULLY-WRITTEN NAV_MODEL: sections are allowed to DECLARE the same
 * tab twice on purpose (Gospel Resources is both the prayer ramp's "then act" step and a research
 * surface). Declaring twice is expressive; RENDERING twice is a bug. This keeps the first declaration
 * — which is what makes the curated order authoritative — and silently drops later ones, so the two
 * concerns stop fighting.
 *
 * WHY IT IS A CORRECTNESS FIX, NOT COSMETICS: VerticalTabsLayout keys its tab-element map by row key
 * (`registerTab(row.key, el)`) and computes highlight as `row.key === active`. Two rows sharing an id
 * means the second node overwrites the first in that map (so roving-focus can only ever reach one),
 * BOTH copies render as active simultaneously, and `orderedKeys` visits the duplicate twice — arrow
 * keys appear to stall. De-duplicating by id restores all three invariants at once.
 *
 * Generic by construction: nothing here names a bundle, so it holds for every plugin added later.
 */
function dedupeRows(rows, seen) {
  const out = []
  for (const r of rows) {
    if (!r || seen.has(r.key)) continue   // a later section yields to the first declaration
    seen.add(r.key)
    out.push(r)
  }
  return out
}

/**
 * THE SPEC'S REQUIRED GATE — "any implementation must assert that no tab key appears twice across
 * all sections" (SPEC-the-six-map-product-and-its-tab-order.md, "the duplicate-key trap"). dedupeRows
 * above is the RUNTIME safety net (silently keeps the first declaration, so a duplicate can never
 * stall the rail); this is the LOUD check that a duplicate should not exist among the CURATED
 * sections in the first place — the previous regression happened because nobody had this and a
 * silent safety net alone does not stop a duplicate from being written again by a future edit.
 *
 * Runs once at module load (see the call below NAV_MODEL/TAB_DEFS), so a duplicate is a build/dev-
 * console error the moment the file is edited wrong, not something only Playwright would catch.
 * Never throws in production: a duplicate is a code defect to fix, not a reason to take the whole
 * SPA down for a live user, so this reports loudly and returns rather than throwing.
 */
function assertNoDuplicateTabKeys(navModel) {
  const seen = new Map()   // id -> section key that first claimed it
  const dupes = []
  for (const g of navModel) {
    if (g.key === 'experimental') continue   // the catch-all is generic by construction; nothing to assert
    for (const r of g.tabs || []) {
      if (!r || !r.id) continue
      const first = seen.get(r.id)
      if (first === undefined) { seen.set(r.id, g.key); continue }
      if (first !== g.key || dupes.indexOf(r.id) === -1) dupes.push(r.id + ' (' + first + ' + ' + g.key + ')')
    }
  }
  if (dupes.length && typeof console !== 'undefined') {
    console.error('[doxa-maps-spa] duplicate tab key(s) across NAV_MODEL sections: ' + dupes.join(', ') +
      ' — VerticalTabsLayout keys its tab-ref map and `active` highlight by id, so a row declared in ' +
      'two sections paints twice and stalls keyboard nav. See the duplicate-key trap in ' +
      'SPEC-the-six-map-product-and-its-tab-order.md.')
  }
  return dupes
}

// Turn a bundle id into a human label: "all-people-groups" → "All People Groups". Small, local and
// dependency-free; a bundle may override it by shipping a profile `title` in the manifest.
function titleize(id) {
  return String(id).split(/[-_]/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * GENERIC EXPERIMENTAL DISCOVERY — the whole point of Card 2.
 *
 * Reads the BUILT manifest.json (the authoritative list of what actually exists in this tree — the
 * same file the gallery and every bundle page read) and returns a tab def for every bundle that is
 * (a) not already placed in a curated section and (b) not in NOT_EXPERIMENTAL. Nothing about any
 * specific plugin is encoded here, so a brand-new bundle shows up on the next build by itself.
 *
 * WHY THE MANIFEST AND NOT A DIRECTORY LISTING: manifest.json is generated by the build and already
 * honors `gatedProfiles` (e.g. key-cities is intentionally withheld), so reading it inherits every
 * publishing decision for free. A raw listing of the served folder would resurrect gated/stale
 * directories as phantom tabs.
 *
 * WHY RUNTIME AND NOT BUILD-TIME: baking the list in at compile time would just move the hardcoding
 * one layer down — the shell would still ship a frozen list. Fetching at runtime means the SAME
 * built shell adapts to whatever tree it is dropped into. manifest.json is inside the drop-in
 * allowlist, so it travels with the tree everywhere the shell does.
 *
 * FAIL-SOFT: if the manifest is unreachable (offline file:// drop, a host that did not ship it), we
 * return [] and the Experimental folder simply stays empty. The curated sections are unaffected —
 * a discovery failure must never take down the app's main rail.
 */
function experimentalTabsFromManifest(manifest) {
  const placed = curatedBundles()
  const bundles = (manifest && Array.isArray(manifest.bundles)) ? manifest.bundles : []
  const out = []
  for (const b of bundles) {
    const id = b && b.bundle
    if (!id || placed.has(id) || NOT_EXPERIMENTAL.has(id) || b.stage === 'production') continue  // stage: the bundle's .meta.json, same field the Plugin Studio reads
    // Pick the bundle's entry profile: prefer a real MAP profile, else the profile named like the
    // bundle, else simply the first one. A bundle contributes exactly ONE rail row (see dedupeRows),
    // so this chooses which of its profiles that row opens on.
    const profiles = Array.isArray(b.profiles) ? b.profiles : []
    if (!profiles.length) continue
    // Not for the web: a plugin whose every profile is a corner widget or declares targets without "web"
    // (Rudder: desktop + the Plugin Studio's corner). As a tab it probed a backend that a static host
    // does not have, and every embed of the gallery logged three 404s.
    if (profiles.every(p => p.widget || (Array.isArray(p.targets) && !p.targets.includes('web')))) continue
    const entry = profiles.find(p => p.isMap) || profiles.find(p => p.profile === id) || profiles[0]
    // A discovered tab nests the same way a curated one does: its ELEMENT, loaded from the bundle's
    // own scriptUrl. Both are read straight off the manifest, so this path needs no knowledge of the
    // tree layout — which is the whole reason discovery survives a move between the dev and built
    // trees. (It previously took entry.iframeUrl and framed the leaf page.)
    const tag = entry.element || (Array.isArray(b.elements) && b.elements[0]) || id
    const scriptUrl = b.scriptUrl || entry.scriptUrl || ''
    if (!scriptUrl) continue
    out.push({
      id,                                   // bundle id doubles as the stable tab id
      label: entry.title || titleize(id),
      sub: (entry.description || '').trim().replace(/[,;]\s*$/, '') || 'experimental bundle',
      emoji: '🧪',
      tag,
      bundle: id,
      profile: entry.profile || id,
      scriptUrl,
      heavy: HEAVY_ELEMENTS.has(tag) || HEAVY_ELEMENTS.has(id),
      scroll: SCROLL_ELEMENTS.has(tag) || SCROLL_ELEMENTS.has(id),
      discovered: true                      // marks an auto-discovered tab (used by the rail + tests)
    })
  }
  // Ranked first (Kingdom impact, see EXPERIMENTAL_RANK), then A-Z -- stable between builds.
  out.sort((a, z) => {
    const ra = EXPERIMENTAL_RANK[a.id] || 999
    const rz = EXPERIMENTAL_RANK[z.id] || 999
    return ra !== rz ? ra - rz : a.label.localeCompare(z.label)
  })
  return out
}

/**
 * CURATED TAB → its real element, resolved from the manifest.
 *
 * Each TAB_DEF names a `bundle` + `profile`; this looks both up in manifest.json and fills in the two
 * things only the manifest knows: the bundle's `scriptUrl` and the profile's element `tag`. Returns a
 * patch per tab id, so a tab whose bundle is missing from this tree is simply left as declared and
 * pruned by the caller (never painted as a dead row).
 *
 * WHY LOOK UP THE TAG TOO, rather than keep it in TAB_DEFS: the tag was already hardcoded there and
 * was already WRONG in one place — `prayer-map` declared tag 'doxa-simple-map' (the BUNDLE name),
 * while that bundle's element is actually <doxa-map>. Under the old iframe mode the tag was never
 * used to create anything, so the error was invisible. Mounting directly would have created an inert
 * <doxa-simple-map> and rendered an empty pane. One source of truth removes the whole class.
 *
 * INSTANCE FALLBACK: a tab may name an optional `instance` (a preset of a parameterized bundle, e.g.
 * doxa-simple-map's `prayer`). Where the manifest lists it, it is passed down as profile-config
 * instanceId; where it does not exist (the dev tree has no `prayer`), the tab still mounts the
 * bundle's profile rather than failing. A curated tab must degrade, not disappear.
 */
function resolveTabsFromManifest(manifest, defs) {
  const bundles = (manifest && Array.isArray(manifest.bundles)) ? manifest.bundles : []
  const byBundle = Object.fromEntries(bundles.map(b => [b.bundle, b]))
  const out = {}
  for (const d of defs) {
    const b = byBundle[d.bundle]
    if (!b) continue                                   // not in this tree → caller prunes the row
    const profiles = Array.isArray(b.profiles) ? b.profiles : []
    const p = profiles.find(x => x.profile === d.profile) || profiles[0]
    const tag = (p && p.element) || (Array.isArray(b.elements) && b.elements[0]) || d.bundle
    const scriptUrl = b.scriptUrl || (p && p.scriptUrl) || ''
    if (!scriptUrl) continue
    // Only claim the instance if this tree actually ships it.
    const instances = (p && Array.isArray(p.instances)) ? p.instances : []
    const hasInstance = !!(d.instance && instances.some(i => (i && (i.id || i.instance)) === d.instance))
    out[d.id] = {
      tag,
      scriptUrl,
      profile: (p && p.profile) || d.profile,
      instance: hasInstance ? d.instance : '',
      heavy: HEAVY_ELEMENTS.has(tag) || HEAVY_ELEMENTS.has(d.bundle),
      scroll: SCROLL_ELEMENTS.has(tag) || SCROLL_ELEMENTS.has(d.bundle)
    }
  }
  return out
}



export default defineComponent({
  name: 'DoxaMapsSpa',
  // THE HOST'S ATTRIBUTES STAY ON THE HOST. This component is the custom-element root, so Vue would
  // otherwise copy every non-prop attribute of <doxa-maps-spa> — a host's style="…", class, data-* —
  // onto VerticalTabsLayout's .vtl. An inline display there beats the layout's own rules; that is
  // exactly how the Prayer Walk Planner's map collapsed to 76px when this gallery styled its host
  // (measured 2026-09-25). .vtl survives today only because it declares display:grid !important.
  // Everything the layout needs (dir, lang, labels, …) is passed explicitly below.
  inheritAttrs: false,
  components: { VerticalTabsLayout },
  // profile-config props the standalone leaf page + gallery hand every element. treeBase lets a
  // host pin the tree root explicitly; the rest are accepted so the element is a well-behaved
  // member of the bundler (profile/instanceId/assetsBase/tk/shareUrl/qa are ignored here — the
  // app-shell itself paints no map, its tabs do).
  props: {
    treeBase: { type: String, default: '' },
    profileConfig: { type: [String, Object], default: '' },
    // NOT `title` — see the matching note in plugin-studio.vue. `title` is a native HTMLElement
    // property, and defineCustomElement maps every prop to an attribute, so Vue warns on every
    // mount that it will overwrite the native one. Both capability-5 shells had the same
    // declaration, which is the same duplicate-implementation pattern that turned one resolver
    // assumption into two separate outages — when one shell is fixed, grep for its twin.
    heading: { type: String, default: 'DX-Maps' },
    // Optional: pin the Mapbox token / token URL forwarded to each tab's element via profile-config.
    tokenUrl: { type: String, default: '' },
    tk: { type: String, default: '' },
    // LOCALIZATION PROP (loc architecture). The SPA has NO standalone language dropdown by default;
    // it INHERITS its language from the parent page via this `language` prop (canonical name). When a
    // cap-5 header hosts a dropdown it sets this prop for all tabs; otherwise the host page passes it
    // down. `locale`/`lang` are also accepted via profile-config (ProfileLoader's contract) — see
    // effectiveLocale below, which prefers this prop, then profile-config, then the manual switcher.
    // NOTE: no `locale` PROP here on purpose — `locale` is a data() field (the manual switcher's
    // state); a same-named prop+data collides in Vue. The alias lives in profile-config instead.
    language: { type: String, default: '' },
    // ── THE EMBED CONTRACT (card DELEGATE-NEW-TAB-REGA-RESEARCH-GALLERY-CAP5-EMBEDDABILITY) ──
    // A host that drops <doxa-maps-spa> onto its own page (the DX-life research page) supplies NONE
    // of the page globals a generated leaf page bakes — window.MAP_APP_API_URL, window.MAP_TOKEN, a
    // correct assets path. Measured 2026-09-24 from a second origin: the shell mounted and 8 of 13
    // tabs painted an error card, every data call returning the HOST's HTML ("API returned text/html
    // … Server at  may be down"). Each of these is therefore settable here, and each defaults from
    // the tree's own manifest.json (its `runtime` block), so a bare two-line embed needs no config.
    // See EMBED.md beside this file.
    apiBaseUrl: { type: String, default: '' },
    // The map engine for every nested map: 'maplibre' (keyless) or 'mapbox'. Also accepted as
    // profile-config.provider. Unset = each map's own ladder (?provider= → window.MAP_PROVIDER → mapbox).
    provider: { type: String, default: '' },
    // Which tab opens first, by tab id (e.g. "upg-100", "gospel-resources"). Lets a host page deep-
    // link into one map of the gallery. Falls back to ?tab= on the page URL, then the device default.
    tab: { type: String, default: '' }
  },
  emits: ['tab-change'],
  setup() {
    // index.js provides the tree base it derived from the running <script> URL. Prop/attr override
    // it if present (resolved in `base` below).
    const injectedBase = inject('dmsTreeBase', '')
    return { injectedBase }
  },
  data() {
    return {
      activeIndex: 0,
      // The cap-5 DX-Maps SPA is HEADER-OFF by default (sidebar-only, full-page — no stacked headers
      // when embedded under a host that already has one). This ONE flag drives BOTH the shell header
      // and the standalone locale dropdown, so the Driver's rule ("header-off → no dropdown; the SPA
      // inherits its language from the parent via the `language` prop") can never drift: see
      // showLocaleSwitcher. A future host that wants the SPA's own chrome flips this to true.
      showHeader: false,
      // ★ VIEWPORT WIDTH AS REACTIVE STATE, for the device rule (default row + Big Picture disable).
      // 760px is THE SAME BREAKPOINT library/layouts/VerticalTabsLayout.vue uses for its rail/drawer
      // switch. The layout keeps its own `narrow` flag PRIVATE (it emits only update:active), so the
      // shell cannot read it and must watch the same query itself. That duplicates a CONSTANT, not
      // logic — but if either side ever moves, move BOTH: a shell that thinks it is on desktop while
      // the rail has become a drawer would leave Big Picture enabled inside a mobile drawer, which is
      // precisely what the Driver asked to never happen.
      narrow: false, _mql: null, _onMedia: null,
      // The transient "desktop only" message shown when Big Picture is clicked while disabled (see
      // onSelect's intercept). '' renders nothing; _noticeTimer clears any earlier message's timeout
      // so two quick clicks don't fight over when it disappears.
      disabledNotice: '', _noticeTimer: null,
      helpOpen: false,
      mobileNoticeDismissed: {},
      // Set when EVERY manifest candidate failed. The manifest carries each tab's scriptUrl, so
      // without it no src-composed tab can mount; this turns that into a visible pane message
      // instead of an empty grey rectangle. See loadManifest().
      manifestError: '',
      // The DIRECTORY of the manifest that actually answered, with a trailing slash. Tree-relative
      // scriptUrls are resolved against THIS, not the document — see resolve(). Empty until a
      // manifest lands, which is exactly when there are no scriptUrls to resolve anyway.
      manifestBase: '',
      // The manifest's `runtime` block — the build's own apiBaseUrl + public map token, published so
      // an embed on a foreign page can default to them. {} until a manifest lands (or on an older
      // tree that predates the block), in which case only host-supplied values are forwarded.
      runtime: {},
      // i18n locale switcher (reuses app-wrapper-material/languages.js — persisted, offline, no dep).
      locale: loadLocale(),
      // The host page's own language (detectHostLocale), kept live by a MutationObserver on <html lang>
      // — a host app that switches language at runtime (Nuxt i18n does) re-drives the whole gallery.
      hostLang: detectHostLocale(),
      localeOpen: false,
      switcherLangs: SWITCHER_LANGUAGES,
      // Curated tabs start from TAB_DEFS and are COMPLETED from the manifest (tag + scriptUrl) as
      // soon as it arrives — see applyManifest. Until then `scriptUrl` is empty and select() simply
      // defers the mount, so a slow manifest delays the first paint instead of erroring.
      tabs: TAB_DEFS.map(t => ({
        ...t,
        tag: '',            // resolved from the manifest (never hardcoded — see resolveTabsFromManifest)
        scriptUrl: '',      // resolved from the manifest; correct in BOTH the dev and built trees
        heavy: false,       // resolved from the manifest's tag (a tag name alone cannot tell you)
        scroll: false,      // resolved from the manifest's tag — true only for the two stack composites
        resolved: false,    // has the manifest filled this tab in yet
        mounted: false,     // has the tag been created yet
        state: 'idle',      // idle | loading | ready | error
        error: ''
      }))
    }
  },
  computed: {
    // The active tab's "?" text, or null: only discovered (Experimental) tabs, and only when
    // experimentalHelp.js has an entry for that bundle in this locale (English fallback inside).
    activeHelp() {
      const t = this.tabs[this.activeIndex]
      return t && t.discovered ? helpFor(t.id, this.uiLocale) : null
    },
    // Merge profile-config (string or object) over the discrete props, so a host can pass either.
    cfg() {
      let pc = this.profileConfig
      if (typeof pc === 'string') { try { pc = pc ? JSON.parse(pc) : {} } catch { pc = {} } }
      return pc && typeof pc === 'object' ? pc : {}
    },
    // The tree root URL, with a trailing slash. Precedence:
    //   1. treeBase prop / profile-config.treeBase (host override)
    //   2. the base index.js derived from the running <script> URL
    //   3. a same-tree relative guess ('') so a co-located drop still resolves.
    base() {
      const raw = (this.treeBase || this.cfg.treeBase || this.injectedBase || '').trim()
      if (!raw) return ''                    // relative: leaf pages sit beside this bundle's folder
      return raw.replace(/\/+$/, '') + '/'
    },
    // The ABSOLUTE url of the tree's shared asset pool, forwarded to every nested element.
    //
    // ★ WHY THE SHELL MUST SAY IT. The pool ships INSIDE the tree (<tree>/assets/ — generate-tree's
    //   assetsBaseFor), but a nested element given no absolute assetsBase falls to
    //   library/utils/embedBase.js resolveAssetsBase, which climbs to <tree>/../assets — the web-root
    //   SIBLING pool the publisher does not ship. Measured 2026-09-24: live
    //   /plugin-assets/doxa-maps/assets/tables/… = 200, /plugin-assets/assets/tables/… = 404, and
    //   locally the sibling copy lacks internet-by-country.json / gospel-by-country.json, so
    //   Cities with Internet and Gospel Resources failed in BOTH embed modes. Fonts fared worse: a
    //   raw './assets' resolved against the shell's own leaf page (…/doxa-maps-spa/doxa-maps-spa/assets).
    //   An absolute value is ladder rung 1 there, so saying it here fixes every tab at once.
    // Precedence: an absolute host value, then the directory the manifest answered from (that IS the
    // tree root in both the built and dev trees), then nothing (children keep their own ladder).
    assetsBase() {
      const v = String(this.cfg.assetsBase || '').trim()
      if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v.replace(/\/+$/, '')
      return this.manifestBase ? this.manifestBase.replace(/\/+$/, '') + '/assets' : ''
    },
    // The GROUPED rail model the shared VerticalTabsLayout paints, built from NAV_MODEL (the Driver's
    // ported sections/folder) projected over the REAL tabs. Each row's `key` = the tab id (stable),
    // which onSelect maps back to the tab index the mount machinery uses — so the sections are pure
    // presentation, the mount path is unchanged. Rows whose tab id has no matching TAB_DEF are
    // dropped, and a group with no surviving rows is omitted (never paint a dead section/row).
    //
    // ★ THE DEVICE RULE, PER THE SPEC — "it shouldn't change the tab order, it should open you up to
    //   the 2nd tab by default on mobile and disable the 1st tab." That is why there is NO width
    //   filter on rows here any more (the old `onlyWhen:'desktop'|'mobile'` hide-a-row mechanism is
    //   gone — every row is in the rail on every width, same order, always). The ONLY width-driven
    //   thing left is which row is DISABLED (Big Picture, on mobile — see isDesktopOnly) and
    //   which row auto-opens (see firstVisibleIndex) — both presentation, neither touches NAV_MODEL.
    navGroups() {
      const byId = Object.fromEntries(this.tabs.map(t => [t.id, t]))
      // ONE `seen` set threaded across ALL groups (not per-group): the rail must hold one node per tab
      // id GLOBALLY, since the layout's tab-ref map and `active` highlight are keyed by id across the
      // whole rail. A per-group set would still let two sections each paint the same tab. See
      // dedupeRows() for the rule and why duplicates are a correctness bug, not a cosmetic one.
      const seen = new Set()
      return NAV_MODEL
        .map(g => {
          let rows = dedupeRows(
            (g.tabs || [])
              .filter(r => byId[r.id])
              .map(r => {
                const t = byId[r.id]
                // Big Picture is DISABLED (not hidden) on mobile — the one row-level exception the
                // device rule requires. `disabled`/`badge` are read by THIS shell's onSelect intercept
                // and CSS below; VerticalTabsLayout itself does not know about `disabled` (it has no
                // such concept — see the comment on isDesktopOnly), so the row stays clickable
                // at the layout level and this shell is what turns that click into a message instead
                // of a mount.
                const disabled = this.isDesktopOnly(t.id)
                return {
                  key: t.id, label: this.tabLabel(t), sub: this.tabSub(t), icon: r.icon,
                  badge: disabled ? this.tr('desktopOnly') : r.badge, disabled
                }
              }),
            seen)
          // The Experimental folder is not authored — it is FILLED with every discovered tab (any
          // built bundle no curated section placed). This is the one group whose rows come from the
          // manifest rather than NAV_MODEL, which is what makes a new plugin appear by itself.
          if (g.key === 'experimental') {
            // Discovered rows go through the SAME de-dup gate as curated ones. Belt-and-braces: a
            // discovered bundle should already be excluded by curatedBundles()/NOT_EXPERIMENTAL, but
            // routing it through `seen` means even a mis-declared bundle can only ever paint one row.
            rows = rows.concat(dedupeRows(
              this.tabs.filter(t => t.discovered)
                .map(t => ({ key: t.id, label: this.tabLabel(t), sub: this.tabSub(t), icon: 'flask',
                  badge: MOBILE_NOTICE.has(t.id) && this.narrow ? this.tr('mobileNotBuilt') : this.tr('lab') })),
              seen))
          }
          return { key: g.key, label: g.i18n ? this.tr(g.i18n) : g.label, icon: g.icon, folder: !!g.folder, open: g.open, rows }
        })
        .filter(g => g.rows.length)
    },
    // Whether the standalone #toolbar locale dropdown renders. The Driver's rule: the cap-5 SPA has
    // NO standalone dropdown by default — it INHERITS its language from the parent via the `language`
    // prop (effectiveLocale). The dropdown is only offered when the header is ON (a host opting the
    // SPA into its own chrome). Keyed to the SAME flag as the shell header so the two never diverge.
    showLocaleSwitcher() { return this.showHeader },
    // The active language's flag/native name for the toolbar toggle button.
    activeLang() { return getLanguage(this.locale) || { code: this.locale, flag: '🌐', nativeName: this.locale } },
    // The EFFECTIVE preview language pushed down to every tab. Precedence, most-authoritative first:
    //   1. `language` prop / profile-config.language|locale|lang — the parent-page (inherited) value.
    //   2. the manual switcher's data.locale (only meaningful when a header dropdown is present).
    // Every tab's element receives THIS via profile-config.locale, so the SPA honors one language prop.
    //   1. `language` prop / profile-config.language|locale|lang — what the host SAYS.
    //   2. the gallery's own switcher choice — only while that switcher is actually offered.
    //   3. the host page's language (?lang= / <html lang>, see detectHostLocale).
    //   4. English.
    effectiveLocale() {
      const fromProp = (this.language || this.cfg.language || this.cfg.locale || this.cfg.lang || '').trim()
      const fromSwitcher = this.showLocaleSwitcher ? this.locale : ''
      return (fromProp || fromSwitcher || this.hostLang || 'en').split('-')[0].toLowerCase()
    },
    // The locale the gallery's OWN words render in: the effective one when it ships, else English.
    uiLocale() { return LOCALES.includes(this.effectiveLocale) ? this.effectiveLocale : 'en' },
    // Direction FOLLOWS THE GALLERY'S LANGUAGE, set explicitly on the layout root (a fallthrough attr
    // on VerticalTabsLayout's .vtl): Arabic lays the shell out right-to-left (the layout mirrors its
    // rail under :dir(rtl)), every other shipped locale left-to-right — including an English gallery
    // placed on some other RTL page, whose Latin rail must not be mirrored.
    uiDir() { return this.uiLocale === 'ar' ? 'rtl' : 'ltr' },
    // The shared layout's own controls (its visible "Collapse" button and four aria-labels) — English
    // defaults inside VerticalTabsLayout, translated here through its `labels` contract.
    layoutLabels() {
      const out = {}
      for (const k of ['toggleList', 'openViews', 'expandList', 'collapseList', 'collapse']) out[k] = this.tr(k)
      return out
    },
    // The engine a HOST asked for ('' = none; each map keeps its own ladder).
    effectiveProvider() {
      const p = String(this.provider || this.cfg.provider || '').trim().toLowerCase()
      return (p === 'maplibre' || p === 'mapbox') ? p : ''
    },
    activeKey() {
      const t = this.tabs[this.activeIndex]
      return t ? t.id : ''
    }
  },
  mounted() {
    // ★ Establish the viewport class BEFORE select(0), so the first tab opened is the one that will
    // actually be in the rail. Setting it after would open Big Picture on a phone for one frame and
    // then drop the row out from under the active highlight — the tab would be mounted but
    // unreachable, which reads as a broken app rather than a flicker.
    this.watchWidth()
    this.watchHostLang()
    // Open the first tab immediately (its map is the one load the SPA pays on open). The shared
    // VerticalTabsLayout owns rail open/close + narrow-screen collapse now.
    this.select(this.initialIndex())
    // …then read the manifest in the background: it completes each curated tab (tag + scriptUrl) and
    // fills the Experimental folder. Deliberately AFTER select() and never awaited — the rail must
    // paint instantly. select() defers the actual mount until scriptUrl exists, and applyManifest
    // re-drives it, so the first tab mounts the moment the manifest lands.
    this.loadManifest()
  },
  // Release the media-query listener. This element is a custom element a host can add and REMOVE at
  // will (a cap-5 SPA is mounted and unmounted by shells, tabs and the studio), and a live listener
  // holding a reference to a detached component leaks it for the page's lifetime.
  beforeUnmount() {
    if (this._langObs) { this._langObs.disconnect(); this._langObs = null }
    if (!this._mql || !this._onMedia) return
    if (this._mql.removeEventListener) this._mql.removeEventListener('change', this._onMedia)
    else if (this._mql.removeListener) this._mql.removeListener(this._onMedia)
    this._mql = null; this._onMedia = null
  },
  watch: {
    activeIndex() { this.helpOpen = false },
    // When the parent page changes the inherited `language` prop at runtime, re-drive the CURRENTLY
    // visible tab into the new language by re-setting its element's profile-config.locale (which is
    // languages.js's contract). Other tabs pick it up lazily on their next open, since mountElement
    // reads effectiveLocale fresh. ONE path now — every tab is a real element, so the old
    // iframe-src-repoint branch is gone along with the iframes.
    effectiveLocale(loc) {
      const t = this.tabs[this.activeIndex]
      if (!t || !t.mounted) return
      try {
        const slot = this._slots && this._slots[this.activeIndex]
        const el = slot && slot.firstElementChild
        // Rebuild the SAME config the mount used (childConfig), so a language switch cannot silently
        // drop the profile/instance/token and re-render a different view in the new language.
        if (el && el.setAttribute) el.setAttribute('profile-config', JSON.stringify(this.childConfig(t)))
      } catch { /* non-fatal: the tab keeps its previous language */ }
    },
    // A host re-pointing the `tab` attribute after mount (e.g. from its own nav) switches the gallery.
    tab(id) { if (id) this.onSelect(id) }
  },
  methods: {
    openHelp() { this.helpOpen = true; this.$nextTick(() => this.$refs.helpClose && this.$refs.helpClose.focus()) },
    closeHelp() { this.helpOpen = false; this.$nextTick(() => this.$refs.helpBtn && this.$refs.helpBtn.focus()) },
    setSlot(i, el) { if (el) this._slots = Object.assign(this._slots || {}, { [i]: el }) },
    // The gallery's own words in uiLocale (src/strings.js). `t` in the template is shadowed by the
    // v-for tab variable inside the panes, so those use `tr`; both are the same function.
    tr(key, params) { return translate(this.uiLocale, key, params) },
    t(key, params) { return translate(this.uiLocale, key, params) },
    // A curated tab's label/sub come from the string table; a DISCOVERED (Experimental) tab has only
    // its manifest title, which stays as published. Its English manifest description is replaced by
    // the translated generic subtitle outside English, so no English prose leaks into the rail.
    // Known Experimental bundles have proper names in the table (the manifest's titleized id reads
    // "Upg Neighbor" even in English); an unknown future bundle keeps its manifest title.
    tabLabel(t) { return (!t.discovered || hasKey('tab.' + t.id)) ? translate(this.uiLocale, 'tab.' + t.id) : t.label },
    tabSub(t) {
      if (!t.discovered) return translate(this.uiLocale, 'sub.' + t.id)
      return this.uiLocale === 'en' ? t.sub : this.tr('experimentalSub')
    },
    // ── VIEWPORT WATCH (the device rule: same rail, different default + one disabled row) ────────
    // Mirrors the SAME (max-width:760px) query VerticalTabsLayout uses. See the `narrow` note in
    // data() for why the shell must watch it independently.
    //
    // FAIL-SOFT: if matchMedia is unavailable (an old webview, a non-browser render) `narrow` stays
    // false and the SPA behaves exactly as it did before this change — desktop rail, Big Picture
    // first. A viewport feature must never be able to take the app down.
    // Follow the host page's <html lang> live. Fail-soft: without MutationObserver the language read
    // at mount stands.
    watchHostLang() {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
      this._langObs = new MutationObserver(() => { this.hostLang = detectHostLocale() })
      this._langObs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    },
    watchWidth() {
      if (typeof window === 'undefined' || !window.matchMedia) return
      this._mql = window.matchMedia('(max-width: 760px)')
      this.narrow = this._mql.matches
      this._onMedia = (e) => {
        const wasNarrow = this.narrow
        this.narrow = !!e.matches
        if (wasNarrow === this.narrow) return
        // A breakpoint crossing can DISABLE the row that is currently active (Big Picture, going
        // desktop→mobile). Every row stays IN the rail on both widths per the device rule — nothing
        // is removed any more — but a disabled active tab must not be left mounted/highlighted with
        // no way to reach it, so snap to the default row for the new width.
        if (this.isDesktopOnly(this.activeKey)) this.select(this.firstVisibleIndex())
      }
      // addEventListener is the modern API; addListener is the deprecated fallback some webviews
      // still need. Try both rather than assume — a missed listener means the swap silently never
      // happens on rotate.
      if (this._mql.addEventListener) this._mql.addEventListener('change', this._onMedia)
      else if (this._mql.addListener) this._mql.addListener(this._onMedia)
    },
    // THE ONE ROW THE DEVICE RULE DISABLES. Driver, verbatim: "it shouldn't change the tab order, it
    // should open you up to the 2nd tab by default on mobile and disable the 1st tab." Named as a
    // predicate (not a hardcoded width filter in navGroups) so the ONE place that knows "Big Picture"
    // means 'dashboard-plus-grid' is this method — navGroups, onSelect and watchWidth all call it
    // rather than each re-encoding the id + the width test.
    isDesktopOnly(id) {
      return DESKTOP_ONLY.has(id) && this.narrow
    },
    // An experimental map that opens on a phone but warns first (MOBILE_NOTICE), until dismissed.
    showsMobileNotice(id) {
      return MOBILE_NOTICE.has(id) && this.narrow && !this.mobileNoticeDismissed[id]
    },
    dismissMobileNotice(id) {
      this.mobileNoticeDismissed = { ...this.mobileNoticeDismissed, [id]: true }
    },
    // Index (into this.tabs) of the row the rail should auto-open at the CURRENT width. Desktop opens
    // tab 1 (Big Picture); mobile opens tab 2 (Simple Research) because tab 1 is disabled there — the
    // rail itself is UNCHANGED, only the default selection moves. Falls back to the first row of the
    // first surviving group (then 0) so the app always opens something even if a future NAV_MODEL
    // edit leaves a width with no curated rows.
    firstVisibleIndex() {
      let fallback = -1
      for (const g of this.navGroups) {
        for (const r of g.rows) {
          const i = this.tabs.findIndex(t => t.id === r.key)
          if (i < 0) continue
          if (fallback < 0) fallback = i
          if (!r.disabled) return i
        }
      }
      return fallback >= 0 ? fallback : 0
    },
    // Fetch the manifest ONCE and use it for BOTH jobs: complete the curated tabs (tag + scriptUrl)
    // and fill the Experimental folder. One read, because the two answers must describe the same
    // tree — fetching twice would let a curated tab and a discovered tab disagree about what exists.
    //
    // Fail-soft by design: any error (no manifest shipped, a file:// drop where fetch is blocked,
    // malformed JSON) leaves the curated tabs unresolved and Experimental empty rather than throwing.
    //
    // ★ FAIL-SOFT IS NOT FAIL-SILENT (BUG-SIMPLE-RESEARCH-GREY-PANE, Driver reported 4x).
    // Every `src`-composed tab — Simple Research, Regions, every map — gets its `scriptUrl` from
    // this manifest and from nowhere else. Only tab 1 (Big Picture) is BAKED, so only tab 1 can
    // paint without it. When this fetch 404'd the old code swallowed it, mountTab() hit
    // `if (!t.scriptUrl) return`, and the pane stayed in state 'idle' — which renders NEITHER the
    // loading hint NOR the error hint. The result was a perfectly empty grey pane with no console
    // error, no overlay, and a correctly-highlighted rail row: it looks exactly like a mount
    // failure and is actually a missing file. MEASURED under `bun run dev` at
    // /plugin-designs/doxa-maps-spa/index.html: 404 /plugin-designs/manifest.json, deep element
    // count 134, <research-map-plus-grid> count 0. The SAME shell on the BUILT tree resolved the
    // manifest and painted 4778px of content with a live canvas.
    //
    // TWO CANDIDATES, because the shell runs in two trees that put the manifest in different
    // places. The built tree has it beside the bundle folders (resolve() → <base>/manifest.json).
    // The dev tree serves SOURCE from /plugin-designs/, where no manifest exists — it is a BUILD
    // ARTIFACT and lives under /public/<tree>/ (the build config names the tree). Trying the built-tree path second means a dev
    // run finds the real manifest instead of going dark, and a production run is unchanged
    // (candidate 1 answers, candidate 2 is never requested).
    loadManifest() {
      // Each candidate is { url, root }: WHERE to read the manifest, and the tree ROOT its
      // tree-relative scriptUrls resolve against (normally the manifest's own directory).
      const rootUrl = this.resolve('manifest.json')
      const dirOf = (u) => { try { return new URL(u, location.href).href.replace(/[^/]*$/, '') } catch { return '' } }
      const root = { url: rootUrl, root: dirOf(rootUrl) }
      // ★ THE CORS-READABLE COPY (generate-tree writes it beside this bundle, byte-identical).
      // A script embed on a partner page FETCHES the manifest cross-origin, and the live static layer
      // sends Access-Control-Allow-Origin only on paths INSIDE a folder of the tree — every bundle file
      // and assets/ carry it, the ROOT manifest.json does not (measured 2026-09-25 on the live test host: the
      // root 200 without it, doxa-maps-spa/<anything> with it, even a 404). So on a foreign page the
      // copy is read FIRST (no CORS error in the host's console) and the root second; same-origin keeps
      // the root first. Script URLs still resolve against the TREE ROOT, never the copy's folder.
      const copy = { url: this.resolve('doxa-maps-spa/manifest.json'), root: root.root }
      let crossOrigin = false
      try { crossOrigin = new URL(rootUrl, location.href).origin !== location.origin } catch { /* relative = same */ }
      const candidates = crossOrigin ? [copy, root] : [root, copy]
      // The tree's name comes from the build config (vite define), never a literal here: this was the
      // one tree path compiled into any bundle, so a renamed tree would have needed a gallery edit.
      const devFallback = '/public/' + __DOXA_TREE_NAME__ + '/manifest.json'
      if (!candidates.some(c => c.url === devFallback)) candidates.push({ url: devFallback, root: dirOf(devFallback) })
      const tried = []
      const attempt = (i) => {
        if (i >= candidates.length) {
          // Every candidate failed. Record it on the tabs so the PANE says so — see mountTab().
          this.manifestError = 'manifest.json not found (tried ' + tried.join(', ') + ')'
          console.error('[doxa-maps-spa] ' + this.manifestError +
            ' — every tab except Big Picture is composed from it, so their panes cannot mount.')
          return
        }
        const { url, root: treeRoot } = candidates[i]
        tried.push(url)
        return fetch(url, { credentials: 'same-origin' })
          .then(r => { if (!r || !r.ok) throw new Error(url + ' → HTTP ' + (r ? r.status : '?')); return r.json() })
          .then(m => {
            if (!m) throw new Error(url + ' → empty')
            this.manifestError = ''
            // Anchor every tree-relative scriptUrl on the TREE ROOT this candidate names (the
            // manifest's own directory, or the root for the copy). new URL() against location
            // resolves '../' and rooted forms alike, so a caller-supplied treeBase, a built-tree
            // path and the dev fallback all normalise here.
            this.manifestBase = treeRoot || ''
            this.applyManifest(m)
          })
          .catch(() => attempt(i + 1))
      }
      try { attempt(0) } catch { /* fetch unavailable (non-browser): same fail-soft path */ }
    },
    // Complete the curated tabs from the manifest, drop any whose bundle this tree does not ship,
    // then append the discovered Experimental tabs — and finally (re)drive the active tab's mount,
    // which could not run before its scriptUrl existed.
    applyManifest(m) {
      // The build's published defaults for a foreign-page embed (apiBaseUrl + public token). Set the
      // page globals BEFORE select() below mounts anything — a nested map reads them at init/fetch.
      this.runtime = (m && m.runtime && typeof m.runtime === 'object') ? m.runtime : {}
      this.applyPageGlobals()
      const patch = resolveTabsFromManifest(m, TAB_DEFS)
      const activeId = this.activeKey
      // PRUNE rather than paint a dead row: a curated tab whose bundle is absent from this tree can
      // never mount, and a rail row that mounts nothing is worse than a missing one (it reads as a
      // broken app). navGroups already drops rows with no matching tab, so removing the tab is enough.
      const kept = []
      for (const t of this.tabs) {
        if (t.discovered) { kept.push(t); continue }
        const p = patch[t.id]
        if (!p) continue
        Object.assign(t, p, { resolved: true })
        kept.push(t)
      }
      const have = new Set(kept.map(t => t.id))
      for (const d of experimentalTabsFromManifest(m)) {
        if (have.has(d.id)) continue
        kept.push({ ...d, resolved: true, mounted: false, state: 'idle', error: '' })
      }
      this.tabs = kept
      // Re-point activeIndex at the SAME tab id — pruning can shift indices under it, and activeIndex
      // is what every pane is keyed on. If that tab is gone, fall back to the first visible row.
      // A host-requested tab may be one only the manifest could supply (an Experimental bundle), so
      // it is honoured here as well as at mount.
      const want = this.requestedTab()
      const w = want ? this.tabs.findIndex(t => t.id === want) : -1
      const i = this.tabs.findIndex(t => t.id === activeId)
      if (w >= 0 && !this.isDesktopOnly(want) && !this._honouredTab) this.select(w)
      else this.select(i >= 0 ? i : this.firstVisibleIndex())
      this._honouredTab = true
    },
    // The tab a HOST asked to open first: the `tab` attribute, then profile-config.tab, then ?tab= on
    // the page URL (so an iframe src or a shared link can deep-link). '' when nobody asked.
    requestedTab() {
      let q = ''
      try { q = new URLSearchParams(location.search).get('tab') || '' } catch { /* non-browser */ }
      return String(this.tab || this.cfg.tab || q || '').trim()
    },
    // The index to open on mount: the requested tab when it exists and is enabled at this width,
    // otherwise the device default (firstVisibleIndex).
    initialIndex() {
      const want = this.requestedTab()
      const i = want ? this.tabs.findIndex(t => t.id === want) : -1
      if (i >= 0) this._honouredTab = true
      return (i >= 0 && !this.isDesktopOnly(want)) ? i : this.firstVisibleIndex()
    },
    // Switch UI language. Persist the choice and let the `effectiveLocale` WATCHER apply it — it
    // re-sets profile-config on the active tab's element, generically, with no per-tab special case.
    //
    // ★ THIS ALSO USED TO POKE SLOT 0 BY HAND, writing a profile-config that named 'big-picture'
    // onto slot 0's first child. It was stale in two ways at once and harmless in a third: tab-1 is
    // `dashboard-plus-grid`, not `big-picture`, and back then every tab was an <iframe>, which
    // ignores a profile-config attribute entirely. Being harmless is exactly why it survived — the
    // watcher was doing the real work the whole time. Removed rather than repaired: a second
    // hardcoded locale path is one more thing to keep in sync for no gain.
    setLocale(code) {
      this.locale = code
      this.localeOpen = false
      saveLocale(code)
    },
    // The shared rail emits the selected tab's `key` (its id); map it back to the index the
    // pane-mount machinery below is keyed on.
    //
    // ★ THE DISABLED-ROW INTERCEPT. VerticalTabsLayout has no `disabled` concept of its own (its
    // `pick(key)` emits update:active unconditionally on click — see the layout file's `pick`), and
    // this shell does not own that file (see the studio-wide file-ownership rule), so Big Picture's
    // "disabled on mobile" behavior is enforced HERE: the click still arrives, but on mobile it is
    // turned into a transient message instead of a mount. The row stays visibly present (greyed via
    // the `disabled`-badge styling below), never removed — exactly the device rule's "disable, don't
    // hide."
    onSelect(key) {
      if (this.isDesktopOnly(key)) {
        const t = this.tabs.find(x => x.id === key)
        this.disabledNotice = this.tr('desktopNotice', { label: t ? this.tabLabel(t) : key })
        clearTimeout(this._noticeTimer)
        this._noticeTimer = setTimeout(() => { this.disabledNotice = '' }, 4000)
        return
      }
      const i = this.tabs.findIndex(t => t.id === key)
      if (i !== -1) this.select(i)
    },
    // Resolve a tree-relative ref ("./x" / "x") against the tree base. If base is '' we keep it
    // relative to THIS document — but this bundle's own folder is <base>/doxa-maps-spa/, so a
    // co-located leaf at <base>/big-picture/... is one level UP: prefix '../'.
    resolve(ref) {
      const raw = String(ref)
      // AN ALREADY-ABSOLUTE REF IS RETURNED UNTOUCHED. Identical rule (and identical prior bug) to
      // plugin-studio.vue's resolve — the two cap-5 shells had byte-identical implementations, so
      // they inherited the same defect. Measured 2026-09-22 with this SPA nested inside the studio
      // under the dev server: 404 /doxa-research-map/doxa-research-map.js — a BUILT-tree path, the
      // shape the old hardcoded TAB_DEFS used ("<bundle>/<profile>/index.html"). Under the built
      // tree that is correct; under dev the manifest hands ROOTED refs (/plugin-designs/...),
      // and prefixing a rooted ref is what produced a path that exists nowhere.
      // A URL already anchored at the root needs no base by definition, so this is right for BOTH
      // trees rather than a dev-only special case.
      if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw
      const r = raw.replace(/^\.\//, '')
      // ★ TREE-RELATIVE REFS FOLLOW THE MANIFEST THAT SUPPLIED THEM, not this document.
      // Every scriptUrl comes out of manifest.json as a tree-relative path ("<bundle>/<bundle>.js"),
      // so it is only meaningful against the root the MANIFEST was read from. Those two roots are
      // the same in the built tree and DIFFERENT under the dev server, where the page is served
      // from /plugin-designs/ while the manifest lives at /public/<tree>/. Resolving against the
      // document there produced 404 /plugin-designs/research-map-plus-grid/research-map-plus-grid.js
      // — a path that exists nowhere. Anchoring on the manifest's own directory makes one rule
      // correct for both trees (in the built tree manifestBase === base, so nothing changes).
      if (this.manifestBase) return this.manifestBase.replace(/\/+$/, '') + '/' + r
      // Join through exactly one slash: base() normalises to a trailing "/", but a caller-supplied
      // tree-base may not, and a double slash 404s just as surely as a wrong prefix.
      if (this.base) return this.base.replace(/\/+$/, '') + '/' + r
      return '../' + r     // relative fallback: sibling bundle folders are one level up
    },
    select(i) {
      const prevIndex = this.activeIndex
      this.activeIndex = i
      // Release the OUTGOING heavy pane first, so at most one live map context exists at a time. Its
      // v-if subtree is about to be torn down by the re-render anyway; resetting the tab's state here
      // is what lets it re-mount correctly next time (a stale mounted:true would leave an empty slot
      // forever, since mountElement skips an already-mounted tab).
      if (prevIndex !== i && prevIndex >= 0) {
        const prev = this.tabs[prevIndex]
        if (prev && prev.heavy && prev.mounted) this.releaseTab(prevIndex, prev)
      }
      const t = this.tabs[i]
      if (!t) return
      // Tell the host which map is showing (a CustomEvent 'tab-change' on <doxa-maps-spa>, detail[0] =
      // { id, label }), so a host page can mirror it into its own URL or analytics.
      if (prevIndex !== i || !this._announced) { this._announced = true; this.$emit('tab-change', { id: t.id, label: t.label }) }
      // Not yet completed by the manifest — applyManifest calls select() again once it lands.
      if (!t.scriptUrl) return
      // A heavy tab's slot only exists after its v-if subtree renders, so wait a tick before mounting
      // into it: on the first activation the ref is still null at this point.
      if (!t.mounted) this.$nextTick(() => { if (this.activeIndex === i) this.mountElement(i) })
    },
    // Destroy a pane's nested element. Removing the host node runs the element's disconnected
    // lifecycle (onBeforeUnmount → map.remove()), which is what actually frees the GPU context — the
    // node vanishing is not by itself proof the context was released.
    releaseTab(i, t) {
      try {
        const slot = this._slots && this._slots[i]
        if (slot) slot.innerHTML = ''
      } catch { /* the tab resets either way; a failed cleanup must not wedge navigation */ }
      if (this._slots) delete this._slots[i]
      t.mounted = false
      t.state = 'idle'
      t.error = ''
    },
    // ★ withToken() WAS REMOVED WITH THE IFRAMES. It appended ?tk / ?tokenUrl / ?locale to a leaf
    // PAGE url, because a query string was the only channel across an iframe boundary (window.
    // MAP_TOKEN does not cross one). Mounting elements directly, all three ride in profile-config on
    // the element itself — see mountElement — so there is nothing left to encode into a URL. It is
    // deleted rather than kept "just in case": an unreachable second token path is one more thing to
    // keep in sync, and the ?locale= it emitted is precisely what produced the 404 URLs the Driver
    // saw (".../index.html?locale=en").
    // THE ONE profile-config every nested element receives — built here and nowhere else, so the mount
    // and the language watcher can never disagree about what a tab was told.
    childConfig(t) {
      // `profile` is the manifest's profile name, NOT the tab id: one tag can serve several profiles
      // (gospel-resources ships four views through <gospel-resources-map>), so the tab id would select
      // the wrong view — or none. instanceId stays tab-scoped so two panes of the same element never
      // collide; a preset instance replaces it only where this tree ships one.
      const pc = { profile: t.profile || t.id, instanceId: t.instance || ('dms-' + t.id) }
      if (this.effectiveLocale) pc.locale = this.effectiveLocale
      // TOKEN LADDER. Direct mounting shares THIS document, so a leaf page's baked token does not
      // apply — there is no leaf page. Host prop/config first, then the tree's published public token
      // (manifest runtime), and when neither exists the element keeps its own ladder (window.MAP_TOKEN
      // on the SPA's own leaf page, which bakes it).
      const tk = this.tk || this.cfg.tk || this.runtime.token
      if (tk) pc.tk = tk
      if (this.tokenUrl || this.cfg.tokenUrl) pc.tokenUrl = this.tokenUrl || this.cfg.tokenUrl
      // ★ AND THE ENGINE. resolveMapProvider's ladder starts at profile-config.provider, and a child
      // reads only the config written HERE — so a gallery asked for maplibre mounted children that
      // resolved mapbox (bundler-2 measured 19 api.mapbox.com requests for a maplibre request on the
      // studio, the same hole). Validated to the two known engines so a typo cannot pick a third.
      if (this.effectiveProvider) pc.provider = this.effectiveProvider
      // PASS THE TREE BASE DOWN — a nested cap-5 shell (or any element that fetches the manifest)
      // cannot guess it, and guessing is what produced the original 404 class.
      if (this.base) pc.treeBase = this.base
      if (this.assetsBase) pc.assetsBase = this.assetsBase
      // THE HOST OWNS ITS URL AND TITLE. A nested map must not write the page's hash, history or
      // document.title: measured 2026-09-25, opening Regions on a host page stripped the host's own
      // #anchor and retitled the host's browser tab "Regions". A child that syncs its state into the
      // URL standalone should read this and stand down; children that never write the URL ignore it.
      pc.urlSync = false
      return pc
    },
    // The PAGE GLOBALS a generated leaf page bakes and a foreign host page does not — set here, and
    // ONLY when the page has not set them itself: a host's own value wins, always.
    //   window.MAP_APP_API_URL — the data API every nested map calls. library/api/apiBaseUrl.js reads
    //     only this global (there is no profile-config path), so the shell cannot pass it any other way.
    //   window.MAP_TOKEN — profile-config.tk (childConfig) reaches every element with a ProfileLoader,
    //     but a BAKED composite mounts its map components directly and reads only this global.
    //     Measured 2026-09-24: Big Picture (dashboard-plus-grid) logged "No Mapbox access token
    //     provided" on a foreign page and painted no map, while every other tab took tk from config.
    applyPageGlobals() {
      if (typeof window === 'undefined') return
      const api = (this.apiBaseUrl || this.cfg.apiBaseUrl || this.runtime.apiBaseUrl || '').trim()
      if (api && !window.MAP_APP_API_URL) window.MAP_APP_API_URL = api.replace(/\/+$/, '')
      const tk = this.tk || this.cfg.tk || this.runtime.token
      if (tk && !window.MAP_TOKEN) window.MAP_TOKEN = tk
      //   window.MAP_PROVIDER — the engine, when a host explicitly asked this gallery for one.
      //     childConfig forwards it as profile-config.provider, which the simple map elements honour,
      //     but a COMPOSITE mounts its inner maps without passing its own config's provider on.
      //     Measured 2026-09-24 with provider="maplibre", one tab per clean page: Prayer Progress and
      //     All People Groups made 0 api.mapbox.com requests, while Big Picture (19), Regions (17),
      //     UPG-100 (15) and Simple Research (14) loaded mapbox-gl and Mapbox styles. The page global
      //     is rung 3 of every map's resolveMapProvider ladder, so it reaches maps nested at any depth.
      if (this.effectiveProvider && !window.MAP_PROVIDER) window.MAP_PROVIDER = this.effectiveProvider
    },
    // Mount a tab's REAL custom element: inject the bundle's script once, wait for the tag to be
    // registered, then create it in the pane's empty slot. This is the ONE path for every tab.
    mountElement(i) {
      const t = this.tabs[i]
      t.mounted = true
      t.state = 'loading'
      const jsUrl = this.resolve(t.scriptUrl)
      // Gate the mount on the TAG being registered, NOT on the script's onload — onload fires even
      // when a dev ES module then fails to execute (see loadScriptOnce), which would hand us an inert
      // HTMLUnknownElement and an empty pane cheerfully reporting 'ready'.
      loadScriptOnce(jsUrl).then(() => whenTagDefined(t.tag)).then(() => {
        // Everything below is per-nested-plugin machinery; a throw here (a nested element that blows
        // up in its connectedCallback, a serialise failure) must NOT crash the SPA — it lands in THIS
        // tab's error pane. Hence the try/catch on top of the .catch() that handles a failed load.
        try {
          // A heavy tab may have been deactivated (and released) while its bundle loaded. Mounting
          // into a torn-down pane would leak exactly the context this design exists to bound, so drop
          // the mount and let the next select() redo it cleanly.
          if (t.heavy && this.activeIndex !== i) { t.mounted = false; t.state = 'idle'; return }
          const slot = this._slots && this._slots[i]
          if (!slot) { t.state = 'error'; t.error = 'no slot'; return }
          // Remove the loading hint, insert the real element with its profile-config.
          slot.innerHTML = ''
          const el = document.createElement(t.tag)
          el.setAttribute('profile-config', JSON.stringify(this.childConfig(t)))
          // ★ ALSO SET tree-base AS A PLAIN ATTRIBUTE, not only inside profile-config. Not every
          // element reads profile-config: an element that mounts its OWN SFC has no ProfileLoader
          // above it and therefore no provide('profileConfig'), so it takes tree-base as a prop
          // instead (golden-path-check documents exactly this, and is the case that caught it).
          // Such an element otherwise falls back to deriving the root from location.pathname —
          // which is correct on its own <tree>/<bundle>/<profile>/ leaf page and WRONG once it is
          // nested here, where the path belongs to the SHELL, not to the child. Measured: nesting
          // golden-path-check produced 404 /manifest.json, while its standalone leaf was clean.
          // An element that does not declare the prop simply ignores an unknown attribute, so this
          // is safe for all of them — the same belt-and-braces the dev leaf route already applies.
          if (this.base) el.setAttribute('tree-base', this.base.replace(/\/+$/, ''))
          // FIXED-VIEWPORT (the default): pin the element to the pane exactly — inset:0 fills it and
          // scrollHeight===clientHeight, so .dms-pane's overflow:auto (below) paints no scrollbar.
          // SCROLL-STACK (t.scroll — dashboard-plus-grid, research-map-plus-grid): do NOT pin it. Both
          // are built on the shared StackLayout, natural-height by design, and inset:0 would force
          // them back to exactly one viewport regardless of real content height — the trap this fixes
          // (see SCROLL_ELEMENTS above). static+height:auto lets the element grow the pane's
          // scrollHeight past its clientHeight, which is what gives .dms-pane something to scroll.
          // ★ min-height:0 IS LOAD-BEARING, AND height:100% DOES NOT IMPLY IT. CSS resolves a used
          // height by CLAMPING the computed height between min-height and max-height, so a child's own
          // min-height WINS over the height:100% we set here — it is a floor, not a preference. Nine
          // bundles ship a root floor (research-dashboard 560px, gospel-internet 640px,
          // wall-of-people-groups 600px, big-picture 480px, country-posters / my-upg-100-list 420px),
          // and wherever the pane is shorter than that floor the pinned element grew TALLER than the
          // pane it was supposed to fill. .dms-slot then grew with it and .dms-pane's overflow-y:auto
          // (below) turned into a real scroll container — one that contains the WHOLE plugin, tab strip
          // and all, so scrolling it scrolled the tab header out of view. That is the second scrollbar
          // the Driver has been looking at: not the plugin's content scroller, the PANE scrolling the
          // plugin bodily. The invariant two comments below ("fills the pane exactly, so
          // scrollHeight===clientHeight") was written as a description and was only ever a hope.
          // An inline style outranks the child's own :host rule, so this one property restores the
          // invariant for every fixed-viewport plugin at once, without editing any of them. A floor set
          // on an element INSIDE the child's shadow root is out of reach from here and stays its
          // owner's to fix (research-dashboard's .rd-shell, gospel-internet's .gb).
          // NOT added to the scroll-stack branch: those are natural-height by design and a floor is
          // exactly what they are entitled to.
          el.style.cssText = t.scroll
            ? 'display:block;position:static;width:100%;height:auto;'
            : 'display:block;position:absolute;inset:0;width:100%;height:100%;min-height:0;'
          slot.appendChild(el)
          t.state = 'ready'
        } catch (e) {
          t.state = 'error'
          t.error = 'mount failed: ' + ((e && e.message) || String(e))
        }
      }).catch((e) => {
        t.state = 'error'
        t.error = (e && e.message) || String(e)
      })
    }
  }
})
</script>

<style>
/* ★ THE HOST BOX — what makes a bare <doxa-maps-spa> embeddable on someone else's page.
   The shared layout's root is `.vtl { position:absolute; inset:0 }`, and a custom element is
   display:INLINE with no positioning by default. So on any page that did not happen to wrap the tag
   in a positioned box, .vtl anchored to the nearest positioned ANCESTOR — usually the viewport —
   and the gallery painted over the host's own header. Measured 2026-09-24 on a foreign test page:
   the element's box sat at (59,100) 1200x760 while .vtl drew at (0,0) 1400x760, covering the site
   header. The generated leaf page never showed it because it pins the tag `position:fixed`.
   :host makes the element its OWN containing block with a real height, so the gallery always lives
   inside the box the host placed it in. The height is a DEFAULT, not a lock: a host's own
   style="height:…" (or any page rule) outranks :host, and --doxa-maps-spa-height tunes it without
   CSS specificity games. */
:host { display: block; position: relative; height: var(--doxa-maps-spa-height, 85vh); min-height: 480px; }
/* ★ THE HOST'S TYPOGRAPHY STOPS AT THE BOX. Shadow DOM isolates SELECTORS, not INHERITANCE: every
   inherited property on the host page flows straight into the gallery and into every nested map.
   Measured 2026-09-25 on a host with `body{font:20px/3 Georgia; letter-spacing:2px}`: the gallery
   root computed font-size 20px, line-height 60px, letter-spacing 2px — every rail row and map legend
   re-flowed by the partner's blog styles. These are reset to the values the gallery is designed
   against (its own leaf page's defaults). `direction` is not reset here: the layout root carries an
   explicit dir from the gallery's language (uiDir), which is what actually decides RTL. Family and
   colour are set by the layout itself (.vtl). */
:host {
  font-size: 16px; line-height: normal; font-weight: 400; font-style: normal; font-variant: normal;
  font-stretch: normal; letter-spacing: normal; word-spacing: normal; text-transform: none;
  text-align: start; text-indent: 0; text-shadow: none; white-space: normal; hyphens: manual;
  visibility: visible; cursor: auto;
}
:host([hidden]) { display: none; }

/* The shell (top bar + rail + content frame) is the shared VerticalTabsLayout. Only the PANE-local
   styles for this SPA's own tab content remain here — panes fill the shell's content slot, and the
   element slot / loading hint each fill their pane.
   (.dms-frame went with the iframes: there is no framed pane left to style.)
   ★ THE PANE OWNS THE SCROLL (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID, this shell). .dms-pane was
   `position:absolute; inset:0` with no overflow, and .dms-slot the same — so a tall composite
   (dashboard-plus-grid, the Big Picture tab) grew the SLOT's scrollHeight past the PANE's
   clientHeight with nothing to scroll it: an absolutely-positioned child cannot grow its own
   scroll container. This is the exact same trap library/layouts/VerticalTabsLayout.vue already
   fixed on .vtl-host/.vtl-host-slot (see that file's comment) — this SPA does NOT go through that
   layout's `element` row mechanism (it mounts its own custom elements into #default panes here),
   so the library fix never reached this copy. Porting the same proven shape:
     .dms-pane  gets overflow-y:auto (+ overscroll-behavior:contain so a bottomed-out wheel does
                not chain to the document) instead of plain inset:0 with no scroller.
     .dms-slot  becomes position:relative; min-height:100% instead of inset:0, so it can grow
                taller than the pane (letting scrollHeight exceed clientHeight) while still
                filling the pane at minimum.
   SAFE FOR THE FIXED-VIEWPORT MAP TABS (the majority): a map ships position:absolute;inset:0 (or
   height:100%) and fills the pane exactly, so scrollHeight===clientHeight and overflow:auto paints
   NO scrollbar — nothing changes for them. Only a pane whose content genuinely exceeds one
   viewport (the Big Picture dashboard+grid stack) gets a scrollbar, which is the one that needs it.
   Do NOT go the other way and remove .dms-pane's absolute/inset — that was measured and produced a
   worse defect (grid landing far below the fold); overflow:auto on a BOUNDED pane is correct. */
/* ★ --profile-min-h:0 IS THE THIRD LINE OF THE SHAPE ABOVE, AND IT IS THE ONE THAT WAS LEFT BEHIND.
   library/ProfileLoader.vue:336 floors EVERY profile at `min-height: var(--profile-min-h, 100dvh)`.
   That floor measures against the VIEWPORT while this pane measures against its HOST, so on any page
   with chrome above the gallery the profile is taller than the pane by exactly the height of that
   chrome -- and .dms-pane's overflow-y:auto then scrolls the whole plugin, tab strip included.
   MEASURED by rega on DX Life: 1440x900 viewport, 794px pane, content exactly 900 (106px over, the
   header); 390x844, 712px pane, content exactly 844 (132px). On 12 of 16 tabs, INCLUDING plugins with
   no min-height of their own -- which is what proves the floor is ProfileLoader's, not theirs.
   It cannot be fixed from outside: the floor is in the element's SHADOW ROOT where no host-page
   selector reaches, so an inherited custom property is the only lever a host has. ProfileLoader
   documents this opt-out for exactly this case, and .vtl-host and plugin-studio's .ps-pane both set
   it. This pane was ported from .vtl-host and took two of its three lines. */
.dms-pane { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; --profile-min-h: 0; }
.dms-slot { position: relative; min-height: 100%; }
.dms-hint {
  position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
  color: #6d766e; font-size: 13px; padding: 20px;
}
.dms-hint.err { color: #f87171; }
.dms-hint small { color: var(--dx-muted, #6d766e); }

/* THE DEVICE-RULE NOTICE — the transient "desktop only" toast for the disabled Big Picture row on
   mobile. Material light only (surface/border/text/muted tokens), matching the rest of this file. */
.dms-help-btn {
  /* Top-centre: map plugins use the corners (zoom top-right, logo bottom-left, attribution
     bottom-right, the mobile legend sheet along the bottom), so the one free edge is the top middle.
     ABSOLUTE, not fixed: it anchors to the layout's .vtl-content (position:relative), i.e. the map pane.
     Fixed would sit at the HOST page's viewport top when the SPA is embedded lower down. */
  position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 40; width: 36px; height: 36px; border-radius: 50%;
  font: 700 17px/1 Georgia, serif; color: #3b463d; background: #fff; border: 1px solid #d1d4cd;
  box-shadow: 0 4px 12px rgba(0,0,0,.12); cursor: pointer;
}
.dms-help-btn:focus-visible, .dms-help-close:focus-visible { outline: 2px solid #3f8f5a; outline-offset: 2px; }
.dms-help-scrim { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); padding: 16px; }
.dms-help {
  max-width: 420px; width: 100%; color: #3b463d; background: #fff; border-radius: 12px;
  padding: 18px 20px 14px; box-shadow: 0 12px 32px rgba(0,0,0,.2); font-size: 14px; line-height: 1.5;
}
.dms-help-title { margin: 0 0 8px; font-size: 16px; }
.dms-help-what, .dms-help-how { margin: 0 0 10px; }
.dms-help-close { float: right; font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid #d1d4cd; background: #f3f3f1; cursor: pointer; }
.dms-notice {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 40;
  max-width: 320px; text-align: center; font-size: 13px; line-height: 1.4;
  color: #3b463d; background: #fff; border: 1px solid #d1d4cd; border-radius: 10px;
  padding: 10px 16px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
}

/* "Not built for mobile" (MOBILE_NOTICE): sticky at the top of the pane's own scroller, so it stays in
   view over the map and never covers the rail. Dismissible per map for the session. */
.dms-mobile-notice {
  position: sticky; top: 0; z-index: 30; display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; font-size: 13px; line-height: 1.4; color: #3b463d;
  background: #fff8e6; border-bottom: 1px solid #f0d58c;
}
.dms-mobile-notice span { flex: 1; }
.dms-mobile-notice-x {
  flex: none; min-width: 32px; min-height: 32px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font-size: 18px; line-height: 1; cursor: pointer;
}
.dms-mobile-notice-x:focus-visible { outline: 2px solid #3b463d; outline-offset: 1px; }

/* #brand logo mark (left of the shell title). */
.dms-logo { display: inline-flex; align-items: center; }
.dms-logo svg { display: block; }

/* #toolbar i18n locale switcher — matches the admin shell tokens (neutral surfaces, green accent). */
.dms-locale { position: relative; padding: 8px 12px 0; display: flex; justify-content: flex-end; }
.dms-locale-btn {
  display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 12px;
  padding: 5px 10px; border: 1px solid #d1d4cd; border-radius: 8px; background: #d1d4cd;
  color: #3b463d; cursor: pointer;
}
.dms-locale-btn:hover { background: #d1d4cd; }
.dms-flag { font-size: 14px; line-height: 1; }
.dms-locale-name { max-width: 12ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dms-dots { color: #6d766e; margin-left: 2px; }
.dms-locale-menu {
  position: absolute; top: 100%; right: 12px; margin-top: 4px; z-index: 30; min-width: 180px;
  list-style: none; padding: 6px; border: 1px solid #d1d4cd; border-radius: 10px;
  background: #ffffff; box-shadow: 0 12px 32px rgba(0,0,0,.5); max-height: 320px; overflow: auto;
}
.dms-locale-opt {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit;
  font-size: 13px; padding: 7px 9px; border: 0; border-radius: 7px; background: none;
  color: #3b463d; cursor: pointer;
}
.dms-locale-opt:hover { background: #d1d4cd; color: #3b463d; }
.dms-locale-opt.active { background: #d1d4cd; color: #3b463d; }
.dms-locale-opt.active .dms-locale-name { color: #92b195; }
.dms-locale-en { margin-left: auto; font-size: 11px; color: #6d766e; }
</style>
