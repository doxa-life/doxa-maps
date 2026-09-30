<script setup>
/**
 * connectivity-list.vue — CITIES WITH INTERNET, the list/detail pane.
 *
 * @description Countries where DX people groups live, grouped by region, showing measured internet penetration
 *   and mobile coverage. Every figure carries its source, so the numbers can be audited.
 *
 * Countries where DX people groups live, grouped by region, showing measured
 * internet penetration and mobile coverage. Every figure carries its SOURCE and
 * its OBSERVATION YEAR — a number without a year is not citable.
 *
 * ═══ THE HONESTY THIS PROFILE IS BUILT AROUND ═══════════════════════════════
 * The brief asked for internet access PER CITY, with ISP and carrier names. That
 * data does not exist publicly for 175 countries. Rather than assume "the city has
 * whatever the country has" — a guess wearing a citation — every row states its
 * own resolution:
 *
 *   resolution: "country"  a national figure (World Bank, with year)
 *   resolution: "city"     an actual city measurement (none yet)
 *
 * and rows with no data say `unknown` rather than defaulting to a plausible number.
 * MEASURED 2026-08-01: 129 of 175 countries resolved, 46 unknown. Showing the 46 as
 * "unknown" is the point of the app, not a gap in it — an unknown is a research
 * target, and a fabricated figure is a lie a reader cannot detect.
 *
 * ISP / carrier names and censorship history are NOT here. They live in reports
 * (OONI, Access Now #KeepItOn, Freedom on the Net) that are not machine-readable
 * per-country APIs. They are a cited, per-country human task — deliberately left
 * undone rather than approximated.
 *
 * PERSECUTION-SAFETY: this profile carries connectivity + population + language
 * only. It has NO gospel-resource, church or believer field and must not gain one.
 */
import { computed, inject, ref } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import data from './data/connectivity.json'
import { useOptionalT } from '@map/composables/useOptionalT.js'

const profileConfig = inject('profileConfig', ref(null))

// ── UI text: library/i18n/locales/<lc>/connectivity.json (the connectivity-map pattern) ──────
// i18n is OPTIONAL: useI18n() throws on a host that never installed it, so English from the
// shipped catalog is the fallback, never a blank or a key. Region and country names are data.
// C4 wave 3b: the guard is library/composables/useOptionalT.js now, and the fallback resolves through
// tStatic — the RUNTIME LOCALE first, English as the last resort. exp-shepherd's call as this
// plugin's owner (2026-09-26), on the same reasoning gospel-plugin gave: the bundle already carries
// all 11 catalogues, so a partner embedding without vue-i18n being served English is a bug, not a
// decision. The old enLookup was English-only, which is exactly what that served.
// The local fill() is gone with the guard: fillParams applies the same interpolation, except it leaves
// a placeholder for a NULL value where this fill() rendered the string "null".
const t = useOptionalT('connectivity')
// NUMERALS ARE HELD for the Driver (dx-shepherd, 2026-09-26): a locale-following format would switch
// 'ar' to Arabic-Indic digits. Until that is decided, numbers keep the browser-default format they
// had before this pass; only the TEXT is translated.
const num = (n) => (Number(n) || 0).toLocaleString()
const isDark = computed(() => profileConfig.value?.isDark === true)

const countries = computed(() => data.countries || [])

// Sections by region, ordered by people-group count — the same "greatest need
// leads" rule the poster walls use.
const sections = computed(() => {
  const by = new Map()
  for (const c of countries.value) {
    const r = c.region || 'Other'
    if (!by.has(r)) by.set(r, [])
    by.get(r).push(c)
  }
  return [...by.entries()]
    .map(([name, items]) => ({
      name,
      items: items.slice().sort((a, b) => b.people_groups - a.people_groups),
      groups: items.reduce((n, x) => n + x.people_groups, 0),
      // How much of this region is still unmeasured — the research signal.
      unknown: items.filter((x) => x.internet_access === 'unknown').length,
    }))
    .sort((a, b) => b.groups - a.groups)
})

const collapsed = ref({})
const isShut = (n) => !!collapsed.value[n]
const toggle = (n) => { collapsed.value = { ...collapsed.value, [n]: !collapsed.value[n] } }

const totals = computed(() => {
  const c = countries.value
  return {
    countries: c.length,
    resolved: c.filter((x) => x.internet_access !== 'unknown').length,
    unknown: c.filter((x) => x.internet_access === 'unknown').length,
    low: c.filter((x) => x.internet_access === 'no').length,
  }
})

const band = (a) => a === 'yes' ? 'ok' : a === 'partial' ? 'mid' : a === 'no' ? 'low' : 'unk'
const bandLabel = (a) => t('connectivity.list.band.' + (['yes', 'partial', 'no'].includes(a) ? a : 'unknown'))

useShadowStyles(
  '.ci{position:absolute;inset:0;overflow-y:auto;padding:20px 18px 44px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.ci.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.ci-h{margin:0 0 4px;font-size:19px;font-weight:700;text-align:center}' +
  '.ci-sub{margin:0 auto 18px;max-width:640px;font-size:12.5px;line-height:1.55;text-align:center;opacity:.75}' +
  '.ci-tot{display:flex;gap:14px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}' +
  '.ci-chip{font-size:11.5px;padding:4px 11px;border-radius:999px;background:rgba(0,0,0,.06);font-weight:600}' +
  '.is-dark .ci-chip{background:rgba(255,255,255,.10)}' +
  '.sec{max-width:1080px;margin:0 auto;padding-bottom:34px}' +
  // Same sticky-header pattern as the poster wall: the region stays visible while
  // its countries scroll, so you can collapse without scrolling back up.
  '.sec-head{position:sticky;top:0;z-index:6;background:#f6f7f9;display:flex;align-items:baseline;gap:10px;' +
  'padding:10px 10px 8px;margin:0 2px 10px;border-bottom:1px solid rgba(0,0,0,.10);cursor:pointer;' +
  'user-select:none;width:100%;text-align:left;border-top:0;border-left:0;border-right:0;font:inherit;color:inherit;' +
  'box-shadow:0 6px 10px -8px rgba(0,0,0,.35);border-radius:4px 4px 0 0}' +
  '.is-dark .sec-head{background:#0a1410;border-bottom-color:rgba(255,255,255,.12)}' +
  '.sec-caret{display:inline-block;width:12px;font-size:10px;opacity:.55;transition:transform .18s}' +
  '.sec-caret.open{transform:rotate(90deg)}' +
  '.sec-name{margin:0;font-size:15px;font-weight:700}' +
  '.sec-meta{font-size:11px;opacity:.6;font-variant-numeric:tabular-nums}' +
  '.row{display:grid;grid-template-columns:1fr auto auto auto;gap:12px;align-items:center;' +
  'padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.06)}' +
  '.is-dark .row{border-bottom-color:rgba(255,255,255,.07)}' +
  '.r-name{font-size:13.5px;font-weight:600}' +
  '.r-sub{font-size:11px;opacity:.6}' +
  '.r-num{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right;min-width:72px}' +
  '.pill{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}' +
  '.pill.ok{background:rgba(16,185,129,.15);color:#0b7a5b}' +
  '.pill.mid{background:rgba(245,158,11,.16);color:#8a6414}' +
  '.pill.low{background:rgba(220,38,38,.13);color:#a12020}' +
  // UNKNOWN is styled as a NEUTRAL research target, not an error. It is honest
  // missing data, and the app's job is to make it visible rather than hide it.
  '.pill.unk{background:rgba(0,0,0,.07);color:#6b7280}' +
  '.is-dark .pill.unk{background:rgba(255,255,255,.10);color:#9ca3af}' +
  '.src{max-width:1080px;margin:8px auto 0;font-size:11px;line-height:1.6;opacity:.6;text-align:center}',
  'doxa-cities-internet',
)
</script>

<template>
  <div class="ci" :class="{ 'is-dark': isDark }">
    <h2 class="ci-h">{{ t('connectivity.list.title') }}</h2>
    <p class="ci-sub">
      {{ t('connectivity.list.intro') }} <strong>{{ t('connectivity.list.introStrong') }}</strong>
    </p>

    <div class="ci-tot">
      <span class="ci-chip">{{ t('connectivity.list.countries', { n: num(totals.countries) }) }}</span>
      <span class="ci-chip">{{ t('connectivity.list.measured', { n: num(totals.resolved) }) }}</span>
      <span class="ci-chip">{{ t('connectivity.list.unknown', { n: num(totals.unknown) }) }}</span>
      <span class="ci-chip">{{ t('connectivity.list.low', { n: num(totals.low) }) }}</span>
    </div>

    <section v-for="sec in sections" :key="sec.name" class="sec">
      <button type="button" class="sec-head" @click="toggle(sec.name)">
        <span class="sec-caret" :class="{ open: !isShut(sec.name) }">▶</span>
        <h3 class="sec-name">{{ sec.name }}</h3>
        <span class="sec-meta">
          {{ t('connectivity.list.sectionMeta', { countries: num(sec.items.length), groups: num(sec.groups) }) }}
          <template v-if="sec.unknown"> · {{ t('connectivity.list.unmeasured', { n: num(sec.unknown) }) }}</template>
        </span>
      </button>

      <div v-show="!isShut(sec.name)">
        <div v-for="c in sec.items" :key="c.iso3" class="row">
          <div>
            <div class="r-name">{{ c.country }}</div>
            <div class="r-sub">
              {{ t('connectivity.list.rowMeta', { groups: num(c.people_groups), locations: num(c.clusters) }) }}
              <template v-if="c.multi"> · {{ t('connectivity.list.centres', { n: num(c.multi) }) }}</template>
            </div>
          </div>
          <div class="r-num">
            <template v-if="c.internet_pct !== null && c.internet_pct !== undefined">
              {{ c.internet_pct }}%
              <div class="r-sub">{{ c.internet_year }}</div>
            </template>
            <template v-else>—</template>
          </div>
          <div class="r-num">
            <template v-if="c.mobile_per_100 !== null && c.mobile_per_100 !== undefined">
              {{ c.mobile_per_100 }}
              <div class="r-sub">{{ t('connectivity.list.mobPer100') }}</div>
            </template>
            <template v-else>—</template>
          </div>
          <span class="pill" :class="band(c.internet_access)">{{ bandLabel(c.internet_access) }}</span>
        </div>
      </div>
    </section>

    <p class="src">{{ t('connectivity.list.source') }}</p>
  </div>
</template>
