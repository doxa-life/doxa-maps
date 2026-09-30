<script setup>
/**
 * poster-wall.vue — the UPG-100 POSTER WALL (pane 2 of the my-upg-100-list family).
 *
 * @description A wall of printable poster cards, one per 100-list entry, each with a "Show on map"
 *   action that hands off to the map profile in the same bundle.
 *
 * ★ MIGRATED ONTO THE SHARED WALL 2026-09-24. This file was 890 lines carrying its own copy of
 * markup, CSS, the export modal and three print paths; the rendering now comes from
 * @map/components/poster/PosterWall.vue, which country-posters (94 lines) and key-cities (75)
 * already consume. This profile supplies ONLY what cannot be shared: its data, its taxonomy and
 * its records provider.
 *
 * WHAT COULD NOT BE SHARED, and why each is here rather than in the component:
 *   REGION_OF / regionFor  — the 100-list's own continental taxonomy, keyed by list id because a
 *                            selector can be a wagf_block, a country_codes array or an explicit
 *                            pg_slugs list and none of those implies a continent.
 *   fetchListRecords       — knows the people-groups API, the selector evaluator AND the pg_slugs
 *                            special case. Key Cities and Country Posters have entirely different
 *                            data shapes, which is exactly why the shared wall takes a PROVIDER.
 *
 * THREE CAPABILITIES HAD TO BE ADDED TO THE SHARED WALL FIRST, over two ticks, because migrating
 * without them would have REGRESSED this wall rather than consolidated it:
 *   cardStocks             — the reader picks the prayer-card size at print time.
 *   posterAction="print"   — open the print dialog instead of saving a file.
 *   hidePrayerListWhenSoon — no "coming soon" placeholder on a wall whose list DOES print.
 * The last two are a Driver ruling, not a preference (2026-09-23): "three print buttons, each
 * opening an in-browser print dialog, no silent file download as the default action. A raw
 * 'Download' button and a 'Prayer List: coming soon' placeholder were exactly the two buttons he
 * objected to."
 *
 * CROSS-PANE COMMS — unchanged and still the decoupling that matters: this wall NEVER imports the
 * map. The shared component dispatches the window CustomEvent named below, scoped by instanceId,
 * so several embeds on one page never cross-talk. The shell listens and drives the map pane.
 *
 * ASSETS. previews/<id>.webp (~65KB, 378 generated) SHIP and are what the wall paints. Full
 * posters/<id>.webp do NOT ship by default (~42MB); export and print fall back to fetching
 * posters/<id>.html and rasterising it in the browser. See
 * IDEA-POSTER-EXPORT-404-ON-DROPPED-FOLDER-TRADEOFF.
 */
import { computed, inject, ref } from 'vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'
// The page's people-group LIST (library/lists/): every people-group fetch below keeps only its groups.
import { applyPeopleGroupList, resolvePeopleGroupList } from '@map/lists/peopleGroupList.js'
import PosterWall from '@map/components/poster/PosterWall.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
// The reader's language, for the DATA fetch below. Not for interface text — that goes through t().
import { getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
// Named imports: only the list arrays ship in the bundle; the file's bookkeeping fields stay out.
import { zonesForList } from './data/zones-for-list.js'
// The SAME normalize+evaluate pipeline the sibling map profile uses to turn the live
// /people-groups/list payload + a list's `selector` into the exact rows that belong to it.
import { normalizeRecords, extractRecords } from './data/normalize.js'
import { evaluate as evaluateSelector } from './data/selector-evaluator.js'

const profileConfig = inject('profileConfig', ref(null))
const instanceId = computed(() => profileConfig.value?.instanceId || 'upg-100-wall')
const isDark     = computed(() => profileConfig.value?.isDark === true)
// Assets resolve RELATIVE to the host page so the tree stays drop-portable —
// file://, a CDN subpath, Railway and Capacitor all behave identically.
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

// Config-only, fail-closed API base — SAME resolution as the sibling map profile. No default
// host: a dev harness that never sets window.MAP_APP_API_URL simply gets no PG-level data, and
// the shared wall hides the row-dependent buttons rather than failing at click time.
const API_BASE = (typeof window !== 'undefined' && window.MAP_APP_API_URL)
  || import.meta.env.VITE_API_BASE_URL
  || ''

// ─── REGIONAL SECTIONS ───────────────────────────────────────────────────────
// clusters.json carries no region field, so the mapping lives here. It is keyed by
// list id rather than derived from the selector: a selector can be a wagf_block, a
// country_codes array or an explicit pg_slugs list, and none of those reliably
// implies the continent a reader expects to browse by.
//
// SE Asia + Oceania are ONE section deliberately (the island chains read as a
// single sweep), and the Americas gathers Brazil, the Andean/Caribbean list and the
// US-bearing scatter list.
const REGION_OF = {
  // Africa
  'west-africa': 'Africa', 'sudan': 'Africa', 'east-africa': 'Africa',
  'central-africa': 'Africa', 'southern-africa-islands': 'Africa',
  // Middle East. Maghreb+Egypt is geographically North AFRICA but belongs here:
  // the region is read as a cultural/linguistic sweep.
  'maghreb-egypt': 'Middle East',
  'middle-east-core': 'Middle East',
  // CENTRAL ASIA is its own section. Brief: "the 55 UPG Pakistan map is wrongly
  // added to Middle East, it is Central Asia." It had been folded into the Middle
  // East as "the same sweep continuing east", but Pakistan, Afghanistan,
  // Uzbekistan, Tajikistan, Kyrgyzstan and Kazakhstan are Central/South Asia —
  // filing them under the Middle East misnames six countries to save a heading.
  'uncovered-nas-a': 'Central Asia',
  // Southeast Asia + Oceania
  'laos': 'Southeast Asia + Oceania', 'oceania-indonesia': 'Southeast Asia + Oceania',
  'mainland-se-asia-philippines': 'Southeast Asia + Oceania',
  // Americas
  'brazil': 'Americas', 'andean-caribbean': 'Americas', 'uncovered-scatter': 'Americas',
  // Europe
  'europe': 'Europe',
  // India and China are their OWN sections, not one lump called "Asia". Between
  // them they are 1,122 people groups across 12 lists — more than every other
  // section combined — so collapsing them hides the two largest prayer fields in
  // the dataset behind a single continental label. Matched by id prefix below.
}
// ⚠ TAKES AN ID, while the shared wall's groupBy takes the whole ITEM. The template
// adapts it — `:group-by="(item) => regionFor(item.id)"` — rather than changing this
// signature, because the id is what the taxonomy is keyed by and every prefix rule
// below reads it directly. Passing regionFor straight in built and loaded cleanly and
// then threw `c.startsWith is not a function` at first render: the whole wall was blank,
// 0 cards, with nothing wrong at the source layer.
// ★ THE ENGLISH VALUES ABOVE ARE GROUPING KEYS; THIS TRANSLATES AT RENDER (studio's split).
// REGION_OF keeps its English values as stable identity — changing them would re-key the
// grouping — and the heading a reader sees is resolved here, per locale.
//
// ⚠ TWO OF THE SEVEN HEADINGS HAVE NO KEY YET: 'India' and 'Other'. check:hardcoded-english
// reported five, not seven, and it was honest about why — its header states it CANNOT SEE
// SINGLE-WORD STRINGS, since a bare word carries too many non-prose meanings to flag without
// drowning the signal. So the spec was built from five and these two are the blind spot
// materialising. They fall through to their English text until poster.region_india /
// poster.region_other exist; raised with studio rather than coined here.
const REGION_KEY = {
  'Africa': 'region_africa',
  'Middle East': 'region_middle_east',
  'Central Asia': 'region_central_asia',
  'Southeast Asia + Oceania': 'region_southeast_asia_oceania',
  'China + Mongolia': 'region_china_mongolia',
  'India': 'region_india',
  'Other': 'region_other',
}
const regionLabel = (english) => {
  const key = REGION_KEY[english]
  return key ? t(`poster.${key}`) : english   // no key yet -> the English heading, not a raw key
}
const regionFor = (id) => {
  if (REGION_OF[id]) return regionLabel(REGION_OF[id])
  if (id.startsWith('asia-india-')) return regionLabel('India')
  // "China + Mongolia": the northern zone declares Mongolia as a member country
  // (its land is drawn and highlighted), so the section heading names both rather
  // than folding a sovereign country under a China label.
  if (id.startsWith('asia-china-')) return regionLabel('China + Mongolia')
  return regionLabel('Other')
}
// One flat list of the zones the map paints — for WHICHEVER list is showing.
//
// ★ THROUGH zonesForList, not a static clusters.json import (pattern work, 2026-09-27). This wall already
// filtered its RECORDS by list (applyPeopleGroupList, below), so before this it showed another list's
// people groups arranged under UPG-100's zone names — half list-aware, which is the worst of the two
// states because it looks right. Now the zones follow the list too.
// Safe inside a computed: profileConfig is injected at :54 and this evaluates lazily, after setup —
// a module-level call would hit the temporal dead zone (it does in upg-100-list.vue, which is why that
// file resolves per call as well).
// ⚠ AND THE OLD COMMENT SAID "the same 27", which was already stale: the legend has 28 leaves, because
// buildLegendNodes collapses the two deaf_lists into one unified row. This spread still yields 27 because
// it reads the three geographic buckets and the deaf row is synthesised — so the number is right for what
// this list IS, and the old comment was describing the wrong thing.
const items = computed(() => {
  const z = zonesForList(resolvePeopleGroupList(profileConfig))
  return [
    ...(z.lists || []),
    ...(z.asia_lists || []),
    ...(z.uncovered_lists || []),
  ].filter(l => l && l.id)
})

// ─── THE RECORDS PROVIDER — the one thing that cannot be shared ──────────────
async function fetchListRecords(list) {
  if (!API_BASE) throw new Error('no API configured')
  // image_url + primary_language are what make a PRAYER CARD rather than a data
  // tile: a face and the tongue the gospel has to reach them in. The deck shipped
  // without either because they were never requested here — measured 95/95 groups
  // DO have a portrait, so the omission cost every card its photo.
  const fields = 'slug,name,country_code,wagf_region,wagf_block,rop1,population,religion,'
    // imb_gsec feeds the profile description's reachedness sentence — absent, every wall-printed
    // packet ran at HALF LENGTH (the same missing-field class as the other two fetch sites, found
    // by diffing what the wall path actually prints against the packet's card).
    + 'image_url,primary_language,imb_gsec'
  // ★ THE READER'S LANGUAGE, NOT ENGLISH. This was `&lang=en`, hardcoded, so the on-screen prayer
  // cards showed English people-group and country names whatever language the reader picked —
  // while every word of the interface AROUND them was translated. Found in gospel's Driver-lens
  // audit (card 3, 2026-09-28). The resolution order is the one the sibling plugins already use
  // (people-groups-grid.vue:276, research-map-plus-grid.vue:147): what the host set at runtime,
  // then what the page itself says.
  // ⚠ SEPARATE FROM THE PRINTED POSTER. The poster generator fetches lang=en of its own accord
  // (generate.mjs:93) and that is an open question for the Driver about what a print artifact is
  // for. This line is the ON-SCREEN wall only.
  const lang = getRuntimeLocale() || detectLocale()
  const resp = await fetch(`${API_BASE}/api/people-groups/list?fields=${fields}&lang=${lang}`, { cache: 'no-store' })
  if (!resp.ok) throw new Error(`people-groups fetch failed (${resp.status})`)
  const records = normalizeRecords(await applyPeopleGroupList(extractRecords(await resp.json()), profileConfig))
  // ★ pg_slugs BYPASSES the shared evaluator — MEASURED live (2026-09-23): 12 of the 27
  // lists (the entire India + China buckets) carry `{ type:'pg_slugs', values:[...] }`,
  // and selector-evaluator.js documents that it "intentionally THROWS" on that type
  // (upg-100-list.vue:1455-1461, "BUG-A FIX"). Calling evaluateSelector() unconditionally
  // threw on every India/China card, which silently ate the click (the async function's
  // catch surfaced the evaluator's own error text, and window.open() was never reached —
  // found by polling the exportState HUD after a real click during verification, not by
  // inspection: the button looked fine and clicked fine). Ported the SAME special-case
  // upg-100-list.vue already uses: pg_slugs matches slug ∈ selector.values directly;
  // every other selector type still goes through the shared evaluator so the map, the
  // list print and the card deck can never disagree about membership.
  const slugs = (list.selector && list.selector.type === 'pg_slugs')
    ? new Set(list.selector.values || [])
    : evaluateSelector(list.selector, records)
  return records.filter((r) => r && slugs.has(r.slug))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

// The wall's own copy. v-html in the shared component, so the <strong> lands as markup —
// the emphasis is the point: praying for them BY NAME is the whole brief.
//
// ★ THROUGH t(), NOT A LITERAL. rega measured ?lang=ar and found this intro, the heading and
// the tag rendering in English while the wall's buttons beside them were translated — the
// copy a reader reads FIRST was the untranslated part. The <strong> travels inside the
// translated string so each language can emphasise its own words, which is not something a
// wrapper around an English sentence could do.
// Guarded like every other useI18n() here: it throws on a host without vue-i18n. useOptionalT stores
// that guard once (host i18n -> catalogue -> the key) instead of a hand-rolled copy.
// No namespace: callers pass FULL keys here, exactly as the raw useI18n().t they used to get.
//
// ★ ONE BEHAVIOUR GAIN FROM WAVE 3c (regions-plugin, 4c05e589): the old path was the bare
// useI18n().t, so on a host WITH i18n a missing key rendered the raw dotted key. It now falls through.
//
// ★ AND THE humanizeKey FALLBACK IS GONE — the one deliberate departure from 4c05e589, which kept it.
// It rendered a key's last segment title-cased, so a bare host showed "Upg100 Wall Intro" where a
// whole SENTENCE exists: wrong even in English, and untranslatable because it comes from the
// identifier rather than a catalogue. It was kept on the theory that these keys were not fully
// catalogued — I told regions-plugin exactly that, and it was FALSE: this file's three keys are
// present in all ELEVEN locales, 0 gaps (enumerated 2026-09-27; the only three, all string literals).
// ⚠ IT GUARDS A BARE HOST, NOT A MISSING KEY. Those are different failures and I had them confused.
// Product call taken by dx-shepherd (UPGHK, 2026-09-27) under the Driver's standing goal that the
// production maps be localized.
const t = useOptionalT('')

// ★ THE MARKUP IS COMPOSED HERE, so the CATALOGUE holds plain text (dx-shepherd UPGHTML, 2026-09-27).
// vue-i18n warns "[intlify] Detected HTML in '…'" twice per tab pass, and it is right to: a translated
// string carrying <strong> is the only one in this tree that does — I measured every en catalogue area
// and upg100WallIntro is 1 of 1, so this was not a convention, it was my outlier.
//
// ⚠ WHY THE OBVIOUS FIXES DO NOT APPLY HERE. The shepherd's suggestion — markup in the template, or
// <i18n-t> interpolation — assumes this profile renders the sentence. It does not: `intro` is a STRING
// PROP on the library PosterWall, rendered there with v-html (PosterWall.vue:955), and that component
// has no slots at all. So the markup has to arrive inside the string, and the only question is who
// builds the string. Building it HERE keeps the catalogue clean without a library change.
//
// ★ AND IT IS STRICTLY SAFER THAN WHAT IT REPLACES, which is the part worth keeping. v-html on a whole
// catalogue string TRUSTS THE CATALOGUE: any tag a translator (or a bad merge) puts in any of the 11
// locale files renders as markup. Composing here escapes each part and emits exactly one tag I control,
// so the trusted surface shrinks from "every translation of this key" to "this line".
//
// THREE PARTS, NOT A WRAPPER AROUND ONE, because the emphasis is not in the same place in every
// language. Measured across all 11 locales: each has exactly one <strong> and no other tags, and de, hi
// and zh carry real text AFTER the emphasised run (" beten.", " प्रार्थना करते हुए।", "為他們禱告。")
// where the others end on a full stop. A head+emphasis wrapper would have silently dropped those tails.
const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const intro = computed(() => {
  // The three plain-text keys studio adds (rule 5B — the catalogue is theirs). Until they land, the
  // single legacy key is still the source of truth, so this renders identically before AND after: no
  // flag day, and my landing does not have to be ordered against theirs.
  const a = t('messages.upg100WallIntroA')
  const b = t('messages.upg100WallIntroEmph')
  const c = t('messages.upg100WallIntroB')
  const missing = (v, key) => !v || v === key
  // ★ THE LEGACY upg100WallIntro FALLBACK IS GONE (2026-09-27). It existed for exactly one window: the
  // three plain-text keys were landing in studio's catalogue while this consumer was already written,
  // so the branch rendered the old single markup-bearing key until they arrived. They are on main in
  // all eleven locales, so the branch is now DEAD CODE — and dead code that names a key keeps that key
  // alive: studio cannot delete upg100WallIntro while this line reads it (their L13U measurement).
  // A fallback whose condition can no longer be true is not safety, it is a reference.
  // If A or Emph ever went missing the per-key fallback still yields English from the en block, and
  // check:i18n-keys-exist fails the build before a reader could see it.
  const tail = missing(c, 'messages.upg100WallIntroB') ? '' : escHtml(c)
  return `${escHtml(a)}<strong>${escHtml(b)}</strong>${tail}`
})
const heading = computed(() => t('messages.upg100WallHeading'))
const wallTag = computed(() => t('messages.upg100WallTag'))

</script>

<template>
  <PosterWall
    :items="items"
    :group-by="(item) => regionFor(item.id)"
    :instance-id="instanceId"
    :is-dark="isDark"
    :assets-base="assetsBase"
    event-name="doxa-upg-100-list:show-on-map"
    :heading="heading"
    :tag="wallTag"
    :intro="intro"
    unit="UPG"
    item-noun="list"
    :records="fetchListRecords"
    :card-stocks="true"
    poster-action="print"
    preview-action="print"
    :hide-prayer-list-when-soon="true"
    download-prefix="doxa-upg-100"
    :columns-control="true"
  />
</template>
