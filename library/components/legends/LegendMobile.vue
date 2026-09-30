<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { useLegendData } from '../../composables/legends/useLegendData.js'
import { RESEARCH_LEGEND_OPTIONS } from '../../composables/legends/researchLegendOptions.js'
import LegendRows from './LegendRows.vue'
import SemanticTreeLegend from './SemanticTreeLegend.vue'
import { useLanguageFamilyLegendData } from '../../composables/legends/useLanguageFamilyLegendData.js'
import { useAffinityBlockLegendData } from '../../composables/legends/useAffinityBlockLegendData.js'
import { useWagfRegionsLegendData }   from '../../composables/legends/useWagfRegionsLegendData.js'
import PeopleGroupDetail from '../PeopleGroupDetail.vue'
import ApproxPinNote from './ApproxPinNote.vue'
import { buildColocationIndex, colocatedWith } from '../../utils/colocation.js'

const { t } = useI18n()

useShadowStyles(`
/* ── Mobile bottom sheet — chrome only.
   The TABLE (title + column labels + data rows) is rendered by LegendRows,
   the SAME component desktop uses, with all the same default CSS. Mobile
   no longer overrides any .lrg-* rule — the bottom sheet is purely
   mobile chrome (pull tab, collapse/expand caret, touch drag). ── */
/* bottom = 30% (the sheet's open height) + 16px gap. The Mapbox watermark lives bottom-right
   and only rises by the collapsed strip, so nothing else needs room under this image. */
.floating-mini-image{position:absolute;inset-inline-start:16px;bottom:calc(30% + 16px);z-index:999;pointer-events:auto;cursor:pointer;}
.mini-image{width:120px;height:150px;object-fit:cover;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:block;}

/* Containment root: clamps absolute children to the map area. */
.legend-sheet-root{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
/* Sits just above the sheet's top edge, tracking it via --legend-sheet-h. Text only, so it stays
   pointer-events:none with the root — nothing here is tappable and it must never eat a map drag.
   The scrim keeps it legible over an arbitrary basemap without becoming another panel. */
.approx-pin-note--floating{position:absolute;inset-inline:0;bottom:calc(var(--legend-sheet-h,0px) + 6px);z-index:1001;margin:0 10px !important;text-align:center;pointer-events:none;text-shadow:0 1px 2px rgba(255,255,255,0.85);}
/* The note's own text colour flips with the dark prop, so the scrim has to flip with it: a white
   halo behind light text is a smear, not legibility. (No backticks in this comment: the whole
   block is a JS template literal and a backtick would end it — which is what it just did.) */
.approx-pin-note--floating-dark{text-shadow:0 1px 2px rgba(0,0,0,0.85);}
.legend-sheet-root>*{pointer-events:auto;}
/* ...except the floating note. The rule above re-enables pointer events for every direct child of
   the root, at the same specificity as the note's own rule and AFTER it, so it was winning and the
   note would have swallowed a map drag across the full width just above the sheet. It is text with
   nothing tappable in it; stated here, after the rule that would otherwise override it. */
.legend-sheet-root>.approx-pin-note--floating{pointer-events:none;}

/* ── Attribution stays visible (driver bug 2026-09-16) ──
   The sheet is a bottom overlay, so the engine's bottom-left logo / bottom-right
   attribution corners ended up UNDER it in every state (even the 48px collapsed
   footer fully covered the 19px logo). The sheet observes its own height
   (ResizeObserver, script below) and writes --legend-sheet-h on the custom-element
   HOST; custom properties inherit across the shadow boundary, so this one rule
   lifts both corners by exactly the sheet height, following drags and the 0.3s
   height transition frame by frame. Desktop: the sheet slot is display:none, the
   observer sees 0 and never writes the var, so nothing moves. Every profile that
   renders this sheet loads this stylesheet — no per-profile wiring. */
.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right,
/* One watermark, bottom-right, on every map: the Mapbox wordmark and the attribution "i" in a
   single tight row, slightly reduced and translucent. The corners sit just above the sheet's
   collapsed strip (48px), so the watermark is always visible when the legend is closed; an
   opened sheet covers it. */
.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right{transform:translateY(calc(-1 * min(var(--legend-sheet-h,0px),48px)));}
/* The scroll-edge gutters (the hoverable side strips, z-index 2) run the full height of the
   map and would otherwise swallow taps meant for the attribution in the corner: the corner
   controls sit one tier above them. (Moves to the shared z tiers with the token work.) */
.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right{z-index:3;}
.mapboxgl-ctrl-bottom-right,.maplibregl-ctrl-bottom-right{display:flex;flex-direction:row;align-items:center;justify-content:flex-end;gap:2px;opacity:0.72;transform:translateY(calc(-1 * min(var(--legend-sheet-h,0px),48px))) scale(0.85);transform-origin:bottom right;transition:opacity 0.15s;}
.mapboxgl-ctrl-bottom-right:hover,.maplibregl-ctrl-bottom-right:hover{opacity:1;}
.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl,.maplibregl-ctrl-bottom-right .maplibregl-ctrl{margin:0 6px 6px 0;}
.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-attrib.mapboxgl-compact{margin-right:6px;}
/* In the sheet the legend's rows fill the full width: the clear "x" column does not reserve
   space on the right — it floats over the row's right edge only when a row is selected. */
.legend-mobile-sheet .stl-row{position:relative;}
.legend-mobile-sheet .stl-row .stl-x-slot{position:absolute;inset-inline-end:6px;top:50%;transform:translateY(-50%);width:auto;}
.legend-mobile-sheet .stl-col-hdr .stl-x-slot{display:none;}

/* Sheet shell — no padding; drag strip and caret are absolutely
   positioned overlays. Legend content owns the top padding, matching
   desktop's arrangement so caret+title align on the same visual baseline.
   max-height reads --legend-sheet-top-reserve, set on this element from the
   TOP_RESERVE_PX constant in the script — the SAME number the touch-drag clamp
   uses, so CSS and JS can never disagree about how tall the sheet may get. */
.legend-mobile-sheet{position:absolute;bottom:0;left:0;right:0;z-index:1000;background:white;border-top-left-radius:var(--map-radius,16px);border-top-right-radius:var(--map-radius,16px);box-shadow:0 -4px 20px rgba(0,0,0,0.2);transition:height 0.3s ease-out;display:flex;flex-direction:column;overflow:hidden;max-height:calc(100% - var(--legend-sheet-top-reserve,80px));}
/* While a finger is resizing the sheet the height must be applied INSTANTLY —
   with the 0.3s transition left on, the measured height lagged the finger by
   14-30px (mobile-sheet-probe baseline 2026-09-16) and the release logic read a
   mid-animation value. Snapping on release re-enables the transition. */
.legend-mobile-sheet.dragging{transition:none!important;}

/* Drag strip — thin top overlay holding the pull-tab handle + touch
   gestures. z-index puts it above content. */
.sheet-drag-strip{position:absolute;top:0;left:0;right:0;height:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;z-index:2;}
.pull-tab-handle{width:40px;height:4px;background:#ccc;border-radius:2px;}

/* Collapse caret — in-flow, injected via #title-caret slot into the title
   row's column-1 caret slot (LegendRows .lrg-title-caret-slot or
   SemanticTreeLegend .stl-tb-caret-slot). Vertical alignment with the
   title text comes from the slot's align-items:center, so no absolute
   positioning or padding offsets are needed (qa: 2026-05-02 iter-9). */
/* Collapse caret — matches STL's .stl-collapse-btn exactly (22x20px,
   same bg/border/radius/hover as the desktop SemanticTreeLegend caret). */
.mobile-collapse-caret{width:22px;height:20px;display:flex;align-items:center;justify-content:center;background:rgba(208,215,222,0.4);border:1px solid #d0d7de;border-radius:5px;cursor:pointer;color:#57606a;padding:0;transition:transform 0.3s ease-out,color 0.1s,background 0.1s,border-color 0.1s;transform-origin:center;outline:none;-webkit-tap-highlight-color:transparent;flex-shrink:0;}
.mobile-collapse-caret:focus{outline:none;}
/* WCAG 2.5.8 Target Size (Minimum), AA = 24x24 CSS px. Scoped to (pointer:coarse):
   2.5.8 governs touch ergonomics, and these are SHARED components sitting on maps this
   change does not own -- a finger gets the bigger target, the mouse keeps the density
   those owners designed. min-height states the 24 rather than deriving it from a font. */
@media (pointer:coarse){.mobile-collapse-caret{width:24px;height:24px;}}
.mobile-collapse-caret:hover{color:#3b463d;background:rgba(59,70,61,0.12);border-color:#3b463d;}
/* WCAG 2.5.8 at EVERY pointer, not only coarse: a 24x24 hit area that adds no box (the f29b8151 pattern). */
.mobile-collapse-caret{position:relative;}.mobile-collapse-caret::after{content:'';position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);}
.legend-mobile-sheet.sheet-dark .mobile-collapse-caret{background:rgba(110,118,129,0.15);border-color:#30363d;color:#8b949e;box-shadow:none;}
.legend-mobile-sheet.sheet-dark .mobile-collapse-caret:hover{color:#c9d1d9;background:rgba(59,70,61,0.18);border-color:#73A17F;}

/* Detail-mode collapse caret — top-left of the sheet when in detail mode
   and the sheet is NOT collapsed. Mirrors the .detail-close-btn placement
   on the right; gives the user an always-visible, finger-sized tap target
   to collapse the sheet without having to find the 12px drag-strip. z-index
   above .sheet-drag-strip (z:2) so the strip's @click doesn't steal taps. */
.detail-collapse-btn-mobile{position:absolute;top:10px;inset-inline-start:12px;background:transparent;border:none;padding:0;cursor:pointer;color:transparent;width:28px;height:28px;z-index:3;outline:none;-webkit-tap-highlight-color:transparent;}
.detail-collapse-btn-mobile:focus{outline:none;}

/* Detail-mode close X — top-right corner */
.detail-close-btn{position:absolute;top:10px;inset-inline-end:12px;background:none;border:none;padding:4px;cursor:pointer;color:#666;display:flex;align-items:center;justify-content:center;z-index:3;transition:color 0.2s ease;}
.detail-close-btn:hover{color:#333;}
/* The people-group name lead sits on the same line as that absolute close X
   (right:12px, 26px wide): reserve its width so a long name ellipsizes
   before the X instead of running underneath it. */
.legend-mobile-sheet .pg-name-lead{padding-inline-end:32px;}

/* Collapsed-detail footer — mimics LegendRows collapsed-state footer
   (caret + centered title) but for PeopleGroupDetail mode. Renders only
   when state=collapsed AND mode=detail (template v-if). Sits below the
   12px drag-strip so the strip's tap+drag still works to expand. */
.collapsed-detail-footer{position:absolute;top:12px;left:0;right:0;height:36px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 16px;cursor:pointer;background:transparent;z-index:4;}
.collapsed-detail-title{font:600 13px system-ui,sans-serif;letter-spacing:0.02em;line-height:1.4;color:#1f2328;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.legend-mobile-sheet.sheet-dark .collapsed-detail-title{color:#F3F3F1;}

/* Content padding — symmetric, 12px top/bottom only. Caret no longer needs
   a wide left gutter (it's now in-flow inside the title row), and no right
   padding keeps the scrollbar at the far edge.
   display:flex+column gives child components (.stl-panel / .legend-row-group)
   a DEFINITE height via flex:1 — height:100% on a non-flex parent with only
   flex:1 (no explicit height) falls back to auto, which made the inner
   scrollable shorter than the sheet on tier-3 fullyOpen and left a white
   gap at the bottom (qa: 2026-05-02 iter-10).
   IMPORTANT: NO backticks anywhere in this comment block — it lives
   inside a JS template literal (useShadowStyles) and a stray backtick
   silently closes the string and blanks the entire mobile stylesheet. */
/* ★ THE LAST ROW MUST CLEAR THE LAYOUT'S FLOATING HAMBURGER CIRCLE. .vtl-fab is a 44px circle
   pinned bottom-left in VerticalTabsLayout, OUTSIDE this shadow root, so it paints over this
   sheet however high our z-index goes — scrolled to the end, the final legend row sat under it.
   The layout publishes --map-fab-clearance only while that button is rendered, so this reserves
   space ONLY when there is something to clear: no circle, no wasted whitespace, and the padding
   is additive so nothing that works today moves. */
.legend-content{flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;padding:12px 0 calc(12px + var(--map-fab-clearance, 0px));-webkit-overflow-scrolling:touch;}
/* Constrain only the table/tree shells to the .legend-content viewport so
   their inner scroll containers (.stl-rows / .lrg-items) bound correctly.
   PeopleGroupDetail keeps its natural size and lets .legend-content scroll. */
.legend-mobile-sheet .legend-content>.stl-panel,
.legend-mobile-sheet .legend-content>.legend-row-group{flex:1;min-height:0;}

/* LegendRows --lrg-caret-col bumped from 10px → 28px on mobile so column 1
   accommodates the slotted .mobile-collapse-caret (20px wide) with 4px
   breathing room on each side — caret doesn't hug the sheet edge. The
   title row's subgrid offsets the title text so it begins right after
   the caret without overlap. Same widening on column 5 (right gutter)
   keeps the table visually balanced. qa: 2026-05-02 iter-9. */
.legend-mobile-sheet .legend-row-group{--lrg-caret-col:24px;}
.legend-content::-webkit-scrollbar{width:4px;}
.legend-content::-webkit-scrollbar-track{background:transparent;}
.legend-content::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:4px;}
.legend-content::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.3);}

/* Collapsed state — hide data rows AND column labels but keep the title
   row visible. Mirrors desktop: collapsed legend shows only "Legend".
   The title row becomes a centered flex layout so the slotted caret
   and the title text sit beside each other, vertically and horizontally
   centered in the 48px footer. */
.legend-mobile-sheet.collapsed .legend-content .lrg-row,
.legend-mobile-sheet.collapsed .legend-content .lrg-footer,
.legend-mobile-sheet.collapsed .legend-content .lrg-header-col,
.legend-mobile-sheet.collapsed .legend-content .lft-row,
.legend-mobile-sheet.collapsed .legend-content .lft-row-child,
.legend-mobile-sheet.collapsed .legend-content .lft-header-col{display:none!important;}
/* Fully-collapsed sheet (showing only "Legend" + caret) drops the
   16px top-corner radius — square edges look cleaner when the sheet
   is acting as a thin bottom footer. Rounded corners return when
   expanded (user feedback 2026-04-27). */
.legend-mobile-sheet.collapsed{box-shadow:0 -2px 8px rgba(0,0,0,0.15);height:48px !important;min-height:48px;border-top-left-radius:0;border-top-right-radius:0;}
.legend-mobile-sheet.collapsed .legend-content{padding:0!important;display:flex;align-items:center;height:48px;}
.legend-mobile-sheet.collapsed .lrg-items,
.legend-mobile-sheet.collapsed .lft-items{padding:0!important;align-content:center;height:48px;}
/* Expanded state: SemanticTreeLegend's .stl-titlebar — caret is in the
   slot now, so no padding-left hack. Mixed-case title (text-transform:none)
   so it matches the other tabs ("Language Families" not "LANGUAGE FAMILIES").
   Font matches the LegendRows .lrg-title weight. Tighten left padding from
   PPLR's 12px → 8px so the caret sits closer to the sheet edge. Right padding
   equals the rows' --stl-pad-x (10px) so the title line and the progress bar
   end exactly where the table's last column ends. */
.legend-mobile-sheet .stl-titlebar{padding:8px 10px 8px 8px!important;border-bottom:1px solid rgba(33,38,45,0.10)!important;}
.legend-mobile-sheet .stl-tb-title{text-transform:none!important;letter-spacing:0!important;font:600 14px system-ui,sans-serif!important;color:#1f2328!important;}
.legend-mobile-sheet.sheet-dark .stl-tb-title{color:#F3F3F1!important;}
/* Collapsed state: title rows become a centered flex layout so the slotted
   caret and "Legend" text sit beside each other, both vertically and
   horizontally centered in the 48px footer. gap:8px gives the caret a bit
   of breathing room from the title text. */
.legend-mobile-sheet.collapsed .lrg-title-row,
.legend-mobile-sheet.collapsed .lft-title-row,
.legend-mobile-sheet.collapsed .stl-titlebar{padding:0 16px!important;display:flex;align-items:center;justify-content:center;gap:8px;height:48px;min-height:0!important;border-bottom:none!important;}
/* line-height:1.4 (not 1) so the descender of 'g' in "Legend" / "Engagement
   Progress" isn't clipped at the bottom — qa: 2026-05-02. */
.legend-mobile-sheet.collapsed .stl-tb-title,
.legend-mobile-sheet.collapsed .lrg-title,
.legend-mobile-sheet.collapsed .lrg-title-row .lrg-title,
.legend-mobile-sheet.collapsed .lft-title{font-size:13px!important;letter-spacing:0.02em!important;line-height:1.4!important;}
/* Hide tree/data content when collapsed so only the title bar shows. */
.legend-mobile-sheet.collapsed .stl-tabs-wrap,
.legend-mobile-sheet.collapsed .stl-col-hdr,
.legend-mobile-sheet.collapsed .stl-rows,
.legend-mobile-sheet.collapsed .lrg-row,
.legend-mobile-sheet.collapsed .lrg-footer,
.legend-mobile-sheet.collapsed .lrg-header-col,
.legend-mobile-sheet.collapsed .lft-row,
.legend-mobile-sheet.collapsed .lft-row-child,
.legend-mobile-sheet.collapsed .lft-header-col{display:none!important;}

/* ── SemanticTreeLegend embedded-in-sheet overrides ──
   The PPLR-ported SemanticTreeLegend was designed for standalone desktop
   use — its .stl-panel uses absolute positioning anchored to the map area
   with fixed width 380px, plus a separate .stl-reopen pill and
   .stl-collapse-btn. Inside the mobile bottom sheet we just need the
   inner tree rendering to fill the sheet's content area; the sheet
   already provides drag-strip + collapse caret + chrome. Override
   positioning, hide the desktop-only collapse affordances.
   max-width:none — the standalone panel caps itself at 380px on narrow
   viewports; inside the sheet that cap left a blank strip on the right of
   every phone whose map is wider than 380px (the sheet spans the map). */
.legend-mobile-sheet .stl-panel{position:static!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;width:100%!important;max-width:none!important;z-index:auto!important;display:flex;flex-direction:column;min-height:0;max-height:none!important;}
.legend-mobile-sheet .stl-panel.closed{transform:none!important;opacity:1!important;pointer-events:auto!important;}
.legend-mobile-sheet .stl-inner{border:none!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;}
/* Slim row height on mobile prayer/engagement/adoption tabs so they read
   as thin/dense like desktop, not chunky touch-targets (qa: 2026-05-03 user
   feedback — "desktop legend rows are thinner, can you make mobile match").
   Drops .lrg-item-inner min-height 36→28, vertical padding 6→2, and tightens
   the .lrg-items row-gap 6→3 for the same compact-table feel. */
.legend-mobile-sheet .lrg-item-inner{min-height:28px!important;padding:2px 0!important;}
.legend-mobile-sheet .lrg-items{row-gap:3px!important;}

/* min-height:0 is REQUIRED on .stl-rows for the flex:1+overflow:auto to
   actually scroll inside the constrained mobile sheet. The base .stl-rows
   only sets flex:1 — without min-height:0, the flex item's default
   min-height:auto = content height, so a long list grows past the parent
   instead of scrolling, leaving white space below the panel on tier-3
   fullyOpen (qa: 2026-05-02 iter-11). LegendRows' .lrg-items already has
   min-height:0 in its base CSS, which is why iter-10 fixed Prayer/Engagement/
   Adoption but missed Language Families. */
.legend-mobile-sheet .stl-rows{min-height:0;}
.legend-mobile-sheet .stl-reopen{display:none!important;}
.legend-mobile-sheet .stl-collapse-btn{display:none!important;}
/* (Removed iter-1 rule that was setting padding-left:0 here — it was
    overriding the iter-5 padding-left:36px rule above, causing the caret
    to overlap the title text "Lan-guage Families" → "guage Families"
    visible. qa: 2026-05-02.) Border-bottom color preserved. */
.legend-mobile-sheet .stl-titlebar{border-bottom-color:rgba(0,0,0,0.08)!important;}

/* ── Mobile language-family tree overrides ──
   IMPORTANT: do NOT override .lft-title-row grid-template-columns here.
   The desktop CSS makes the title-row a SUBGRID of .lft-items so the
   UPGS / POPULATION column headers line up with the data rows' badges.
   An explicit grid-template-columns on the title-row breaks subgrid
   inheritance and causes the misaligned headers we saw in user feedback
   (2026-04-27).
   Tap-area: rows are 44px tall (Apple HIG) so the row is comfortably
   tappable; the in-row caret stays slim like desktop. The colored pill
   keeps its desktop look.
   No backticks anywhere in this comment block — see the earlier note. */
.legend-mobile-sheet .lft-row{min-height:44px;column-gap:8px;}
.legend-mobile-sheet .lft-row-child{margin-inline-start:0;}
.legend-mobile-sheet .lft-item-inner{min-height:36px;padding:6px 8px;}
.legend-mobile-sheet .lft-name{font-size:13px;}
/* Collapsed-state row hiding lives in the unified block above (handles
   both .lrg-* and .lft-* in one place). */

/* ── Dark mode (class-based, driven by isDark prop) ── */
.sheet-dark{background:#3b463d!important;box-shadow:0 -4px 20px rgba(0,0,0,0.5)!important;}
/* Dark-mode caret — unified with STL palette (redundant with more-
   specific selectors above, but kept for cascade safety). */
.sheet-dark .mobile-collapse-caret{background:rgba(110,118,129,0.15)!important;border-color:#30363d!important;color:#8b949e!important;}
.sheet-dark .mobile-collapse-caret:hover{color:#c9d1d9!important;background:rgba(59,70,61,0.18)!important;border-color:#73A17F!important;}
.sheet-dark .detail-close-btn{color:rgba(243,243,241,0.75)!important;}
.sheet-dark .detail-close-btn:hover{color:#F3F3F1!important;}
.sheet-dark .pull-tab-handle{background:rgba(243,243,241,0.3)!important;}
.sheet-dark .legend-content{background:#3b463d!important;}
.sheet-dark .legend-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);}
`, 'legend-mobile-sheet')

const props = defineProps({
  legendType: {
    type: String,
    required: true
  },
  /**
   * PROFILE-SUPPLIED TREE (optional override).
   *
   * By default this component derives its own tree from the injected people-group
   * data via the language-family / affinity-block / regions composables — the four
   * taxonomies the research map uses. A profile with its OWN taxonomy (e.g. a
   * curated list) has no way into that, which is why such profiles previously
   * shipped no mobile legend at all.
   *
   * Passing `nodes` bypasses the internal derivation entirely. When null (the
   * default) behaviour is unchanged, so existing consumers are unaffected.
   */
  nodes: {
    type: Array,
    default: null
  },
  /** Tab set to accompany `nodes`. Null → no tabs (single-taxonomy legend). */
  tabs: {
    type: Array,
    default: null
  },
  /** Which tab the sheet OPENS on, 0-based. Forwarded to SemanticTreeLegend below.
   *
   * ★ WHY IT HAD TO BE ADDED. The desktop legend has taken :default-tab for a while, and
   * my-upg-100-list passes 1 (the UPG-100 Lists tab) because the Driver asked for exactly
   * that — "it shouldn't have me sitting there on Regions, I don't know what to do, it's
   * confusing". The mobile sheet had no such prop, so a phone opened on Region no matter
   * what the profile declared: the same complaint, unfixed, on the surface prayer
   * mobilisation most uses. Default 0 keeps every other consumer where it is. */
  defaultTab: {
    type: Number,
    default: 0
  },
  /** Header label for the value column when supplying `nodes`. */
  columnLabel: {
    type: String,
    default: null
  },
  /**
   * PROFILE-SUPPLIED LEGEND TITLE (optional override).
   *
   * The sheet otherwise titles itself from the legend TAXONOMY ("Languages",
   * "People Groups", "WAGF Regions") or the generic "Legend". With several maps in
   * one app that is ambiguous — it names the tab, not the map you are looking at.
   * Passing `title` lets a profile say "My UPG 100 List — Legend" so the sheet is
   * self-identifying.
   *
   * NOTE this does NOT override the DETAIL header: when a people group is selected
   * the sheet still shows that group's name, which is the more specific and more
   * useful label at that moment.
   */
  title: {
    type: String,
    default: null
  },
  /** Which numeric columns to show. Defaults to the research-map pair. */
  columns: {
    type: Array,
    default: null
  },
  isDark: {
    type: Boolean,
    default: false
  },
  /** Popup action forwarded to PeopleGroupDetail — 'pray' | 'adopt' | 'none'. */
  popupAction: {
    type: String,
    default: 'pray',
    validator: (v) => ['pray', 'adopt', 'none'].includes(v)
  },
  /**
   * Disable collapse/expand caret for single-tier legends.
   * When true, hides the caret UI but keeps underlying functionality intact.
   */
  disableCollapse: {
    type: Boolean,
    default: false
  }
})

// Stores — injected from ProfileLoader (instance-scoped)
const uiStore = inject('uiStore')
const mapStore = inject('mapStore')
const dataStore = inject('dataStore')

// Provided by research-map app profile so the mobile SemanticTreeLegend
// row-clicks fire the same dim/clear pipeline as the desktop instance
// (qa: 2026-05-03 iter-18 — without this, deselecting a language-family
// row didn't restore the dimmed pins because mapStore.selectFamily was
// never updated by the mobile flow).
const onSemanticTreeSelect = inject('onSemanticTreeSelect', () => {})

// ★ THE EXPORT AFFORDANCE, WHICH THIS SHEET RENDERED AND NEVER ENABLED.
// This component already renders <SemanticTreeLegend> below — the same component that
// owns the Export menu — but passed neither :export-enabled nor @export. exportEnabled
// defaults to FALSE, so the control's v-if was never satisfied and a phone reader could
// browse the UPG-100 lists and not export a packet or a poster. The packet IS the product
// for that profile; the Driver asked for "print options at the top right of the legend...
// that's the only way that map would be usable".
//
// ⚠ IT WAS NOT A DESIGN QUESTION, WHICH IS WHAT I FIRST RECORDED. The 0x0 elements that
// measurement found belong to the OTHER, hidden SemanticTreeLegend instance — the desktop
// one, mounted but not laid out below the breakpoint. That geometry made it look as though
// the mobile sheet had nowhere to put the control. It renders its own instance, with a
// titlebar, and only needed the prop.
//
// PROVIDE/INJECT, matching onSemanticTreeSelect directly above, because this sheet is
// rendered deep inside a shell rather than as a direct child — an emit would not reach.
// OPT-IN BY CONSTRUCTION: exportEnabled is true only when a profile actually provides a
// handler, so the three profiles that do not provide one are untouched.
const onLegendExport = inject('onLegendExport', null)
const mobileExportEnabled = computed(() => typeof onLegendExport === 'function')

// ── Data-driven legend (universal for all legend types) ─────────────────────
const legendTypeRef = toRef(props, 'legendType')
const {
  items: legendDataItems, columns: legendColumns, title: legendDataTitle,
  activeFilter, setFilter, totalCount, totalPopulation,
  fmtPop, fmtCount
} = useLegendData(legendTypeRef, RESEARCH_LEGEND_OPTIONS)

// LegendFamilyTree consumes the raw normalized people-groups (not pre-aggregated).
// research-map.vue provides the array via inject('normalizedPeopleGroups') —
// same contract as LegendDesktop. Falls back to scanning dataStore.sources so
// the tree still renders if the inject isn't wired (e.g. test harnesses).
const normalizedPeopleGroupsRef = inject('normalizedPeopleGroups', null)
const peopleGroupsForFamilyTree = computed(() => {
  if (normalizedPeopleGroupsRef?.value?.length) return normalizedPeopleGroupsRef.value
  const out = []
  for (const id in (dataStore?.sources || {})) {
    const src = dataStore.sources[id]
    if (src?.features?.length) out.push(...src.features)
  }
  return out
})

// SemanticTreeLegend tree adapter (mobile copy — same composable, same shape).
const _pgRefMobile = { get value() { return peopleGroupsForFamilyTree.value } }
const { langTree: langTreeForMobile } = useLanguageFamilyLegendData(_pgRefMobile)
const { affinityTree: affinityTreeForMobile } = useAffinityBlockLegendData(_pgRefMobile)
const { regionsTree: regionsTreeForMobile }   = useWagfRegionsLegendData(_pgRefMobile)
const LANG_TABS_MOBILE = [
  { id: 'family',   label: 'Lang Family', info: 'A language family is a group of languages descended from a common ancestor.' },
  { id: 'language', label: 'Language',    info: 'A language is a system of communication used by a people.' },
  { id: 'dialect',  label: 'Dialect',     info: 'A dialect/variety is a regional or social form of a language.' },
]
const AFFINITY_TABS_MOBILE = [
  { id: 'bloc',    label: 'Block',   info: 'Affinity Block (rop1) — broadest grouping. 16 blocks total.' },
  { id: 'cluster', label: 'Cluster', info: 'Cluster (imb_reg_of_people_2, ROP 2) — finer grouping inside a block. 194 total.' },
  { id: 'group',   label: 'PG',      info: 'People Group (imb_reg_of_people_25, ROP 2.5) — abstract identity. 1,736 PGs.' },
  { id: 'pgic',    label: 'PGIC',    info: 'PG in Country (imb_reg_of_people_3 + country_code) — one row per PG-country pair. 2,106 rows.' },
]
const REGIONS_TABS_MOBILE = [
  { id: 'region',  label: 'Region',  info: 'WAGF macro-region (e.g. "Asia", "Africa"). Color-coded on the map.' },
  { id: 'block',   label: 'Bloc',    info: 'WAGF bloc — organizational sub-grouping within each region (e.g. "South East Asia").' },
  { id: 'country', label: 'Country', info: 'Individual countries, listed by unreached-population size within their bloc.' },
]
// Flat tabs (prayer/adoption/engagement/religion) → STL node conversion
const _isFlatTabMobile = computed(() => ['prayer', 'engagement', 'adoption', 'religion'].includes(props.legendType))
function _flatItemsToStlNodes(items) {
  const out = []
  for (const item of items) {
    out.push({
      id: item.key, label: item.label, color: item.color,
      count: item.count ?? 0, pop: item.population ?? 0,
      filter: item.filterKey ? ['==', ['get', '_flat_filter'], item.filterKey] : null,
      children: [],
    })
    for (const c of (item.children || [])) {
      out.push({
        id: c.key, label: c.label, color: c.color,
        count: c.count ?? 0, pop: c.population ?? 0,
        filter: c.filterKey ? ['==', ['get', '_flat_filter'], c.filterKey] : null,
        children: [],
      })
    }
  }
  return out
}

// Mobile-side tier swap — ALL tabs through SemanticTreeLegend.
const treeForMobile = computed(() => {
  if (props.nodes) return props.nodes            // profile-supplied taxonomy wins
  if (_isFlatTabMobile.value) return _flatItemsToStlNodes(legendDataItems.value)
  if (props.legendType === 'affinity-block') return affinityTreeForMobile.value
  if (props.legendType === 'doxa-regions')   return regionsTreeForMobile.value
  return langTreeForMobile.value
})
const tabsForMobile = computed(() => {
  if (props.nodes) return props.tabs             // paired with the nodes override
  if (_isFlatTabMobile.value) return null
  if (props.legendType === 'affinity-block') return AFFINITY_TABS_MOBILE
  if (props.legendType === 'doxa-regions')   return REGIONS_TABS_MOBILE
  return LANG_TABS_MOBILE
})
const treeTitleForMobile = computed(() => {
  // A profile-supplied title names the MAP; the taxonomy names only the tab.
  if (props.title) return props.title
  if (_isFlatTabMobile.value) return t('legend.titleBar.legend')
  if (props.legendType === 'affinity-block') return t('legend.titleBar.peopleGroups')
  if (props.legendType === 'doxa-regions')   return t('legend.titleBar.wagfRegions')
  return t('legend.titleBar.languages')
})
const treeColumnLabelForMobile = computed(() => {
  if (props.columnLabel !== null) return props.columnLabel
  // From the catalog (legend.colLabel.*), translated in all 11 locales; these were English
  // literals, so a phone in ar/zh/ru/hi showed "Prayer Status" over translated rows.
  if (['religion', 'prayer', 'engagement', 'adoption'].includes(props.legendType)) return t('legend.colLabel.' + props.legendType)
  if (_isFlatTabMobile.value) return t('legend.colLabel.status')
  return ''
})

// ── Sheet geometry — ONE set of numbers for CSS and JS ─────────────────────
// TOP_RESERVE_PX: room kept free above a fully-open sheet for the search pill
// (top 10 + 35 tall) and a gap. Bound to --legend-sheet-top-reserve on the sheet
// (CSS max-height) AND used as the drag clamp below; it equals the 80 in
// uiStore.legendHeight's fullyOpen value 'calc(100% - 80px)'.
const TOP_RESERVE_PX = 80
// COLLAPSED_PX: the footer height — uiStore's collapsed '48px' / the .collapsed rule.
const COLLAPSED_PX = 48
// GRAB_ZONE_PX: a finger-sized handle measured from the sheet's top edge — the
// 12px drag strip plus the title row / detail header. A touch starting here
// resizes the sheet; below it the content scrolls as usual (Apple HIG 44pt).
const GRAB_ZONE_PX = 44
// SNAP_MIN_PX: hysteresis. A release after less travel than this snaps back to
// the state the drag started from, so a tap or thumb jitter never changes state.
const SNAP_MIN_PX = 24

// Touch gesture state (plain object — nothing here needs to be reactive except
// the .dragging class flag).
const sheetRef = ref(null)
const isDragging = ref(false)
const drag = { pending: null, active: false, startY: 0, startH: 0, startState: '', containerH: 0, maxH: 0, lastH: 0, contentEl: null }
let lastDragEndAt = 0
// A drag that starts on a button (caret / close X / strip) can still be followed
// by a synthesized click on release in some browsers — ignore it.
const justDragged = () => Date.now() - lastDragEndAt < 400

// Computed properties from stores
const legendState = computed(() => uiStore.legendState)
/**
 * ★ WHAT THE CARET ANNOUNCES. Every toggle in this file carried aria-label="aria.toggleLegend" and
 * NO aria-expanded, so a screen-reader user was told the control is a toggle and never told its
 * STATE — they could not hear whether the legend was open or closed. SemanticTreeLegend has had
 * this right all along; this is the copy that drifted, and it drifted on whether the control is
 * usable without sight rather than on decoration. gospel found it while measuring four
 * implementations of the same control; I verified it here before changing anything: 0 occurrences
 * of aria-expanded against 4 toggle labels.
 */
const legendExpanded = computed(() => legendState.value !== 'collapsed')
const legendHeight = computed(() => uiStore.legendHeight)
const caretRotation = computed(() => uiStore.caretRotation)
const showPullTab = computed(() => uiStore.showPullTab)
const legendMode = computed(() => uiStore.legendMode)
const selectedPeopleGroup = computed(() => uiStore.selectedPeopleGroup)
// APPROXPIN: the other groups on the selected pin's coordinate, from the roster THIS map draws.
const drawnPeopleGroups = inject('normalizedPeopleGroups', null)
const colocation = computed(() => {
  if (drawnPeopleGroups?.value?.length) return buildColocationIndex(drawnPeopleGroups.value)
  const rows = []
  for (const id in (dataStore?.sources || {})) { const src = dataStore.sources[id]; if (src?.features?.length) rows.push(...src.features) }
  return buildColocationIndex(rows)
})
const selectedShared = computed(() => (selectedPeopleGroup.value ? colocatedWith(colocation.value, selectedPeopleGroup.value) : []))

// Legend title — swaps based on legend state and selection
const legendTitle = computed(() => {
  if (legendMode.value === 'detail' && selectedPeopleGroup.value) {
    return selectedPeopleGroup.value.properties?.name || t('legend.header.peopleGroupFallback')
  }

  if (legendState.value === 'collapsed') {
    // Even collapsed, say WHICH map — that strip is often all the user can see.
    return props.title || t('legend.header.collapsed')
  }

  return props.title || legendDataTitle.value
})

// Handle row click from LegendRowGroup
function handleRowFilterClick(filterKey) {
  uiStore.handleLegendItemClick()
  setFilter(filterKey)
}

// Methods
function handleCaretClick() {
  if (justDragged()) return
  uiStore.toggleLegend()
}

function handleCloseDetail() {
  if (justDragged()) return
  uiStore.selectPeopleGroup(null) // Return to data-view mode
  uiStore.openLegend() // Snap back to 30% so map is visible
}

// Mini-image URL for the floating image above drawer at 30%
const miniImageUrl = computed(() => {
  if (!selectedPeopleGroup.value) return null
  const props_ = selectedPeopleGroup.value.properties || {}
  // TODO: `_raw.ImageURL` is a DOXA CSV-specific fallback. Generic usage
  // should rely on a normalized `imageUrl` field from the data source.
  return props_.imageUrl || props_._raw?.ImageURL || null
})

// ── Touch resize — handlers live on the SHEET, not the 12px strip ──────────
// Driver bug 2026-09-16 ("moving the informational page up and down has bugs"),
// reproduced by internal/mobile-sheet-probe.mjs. Three real causes, all fixed
// here: (1) the only grab surface was the 12px strip, so a thumb on the title
// row scrolled the content instead of resizing; (2) the 0.3s height transition
// stayed on during touchmove, so the sheet lagged the finger by 14-30px and the
// release logic read a mid-animation height; (3) touchmove clamped at 30%, so a
// downward drag from 'open' could not shrink the sheet at all — the
// open → collapsed ladder step (and the free-drag collapse) was dead code and a
// stale custom px height was left behind.
//
// Gesture model:
//   touchstart  in the top GRAB_ZONE_PX of the sheet → this gesture is a resize.
//               Below the zone, in DETAIL mode, the gesture is provisional: the
//               FIRST touchmove decides (that is the only cancelable one once the
//               browser starts a native scroll) — a pull UP while the sheet can
//               still grow, or a pull DOWN with the content scrolled to its top,
//               resizes the sheet; anything else is a normal content scroll.
//               Non-detail tabs keep content scrolling untouched (qa 2026-05-03).
//   touchmove   .dragging (transition:none) + an explicit px height every move,
//               clamped to [COLLAPSED_PX, container - TOP_RESERVE_PX].
//   touchend    snap. Detail mode = ladder open ↔ fullyOpen with hysteresis
//               (< SNAP_MIN_PX travel → back to the start state); pulled below
//               half the open height → collapsed. Non-detail = free-drag: stay
//               where released, collapse only below half the open height.
// The collapsed footer is tap-only (its 48px height is a CSS !important rule).
function onSheetTouchStart(event) {
  if (legendState.value === 'collapsed') return
  const t = event.touches[0]
  const sheet = sheetRef.value
  if (!t || !sheet) return
  const inGrabZone = (t.clientY - sheet.getBoundingClientRect().top) <= GRAB_ZONE_PX
  const mode = inGrabZone ? 'grab' : (legendMode.value === 'detail' ? 'content' : null)
  if (!mode) return
  drag.pending = mode
  drag.active = false
  drag.startY = t.clientY
  // offsetHeight is the CURRENT visual height even mid-transition, so a drag
  // that starts while the sheet is still animating continues from where it is.
  drag.startH = sheet.offsetHeight
  drag.lastH = drag.startH
  drag.startState = legendState.value
  drag.containerH = sheet.parentElement?.offsetHeight || window.innerHeight
  drag.maxH = drag.containerH - TOP_RESERVE_PX
  drag.contentEl = sheet.querySelector('.legend-content')
}

function onSheetTouchMove(event) {
  if (!drag.pending && !drag.active) return
  const t = event.touches[0]
  if (!t) return
  const dy = drag.startY - t.clientY   // + = finger moved up = sheet grows
  if (!drag.active) {
    if (dy === 0) return
    let take = drag.pending === 'grab'
    if (drag.pending === 'content') {
      const atTop = !drag.contentEl || drag.contentEl.scrollTop <= 0
      take = dy > 0 ? drag.startH < drag.maxH - 1 : atTop
    }
    drag.pending = null
    if (!take) return                  // native content scroll owns this gesture
    drag.active = true
    isDragging.value = true            // .dragging → transition:none, same flush as the height
  }
  event.preventDefault()               // no page/content scroll while resizing
  const h = Math.round(Math.min(drag.maxH, Math.max(COLLAPSED_PX, drag.startH + dy)))
  drag.lastH = h
  uiStore.setLegendHeight(`${h}px`)
}

function onSheetTouchEnd() {
  drag.pending = null
  if (!drag.active) return             // a tap — the @click handlers own it
  drag.active = false
  isDragging.value = false             // transition back on BEFORE the snap so it animates
  lastDragEndAt = Date.now()
  const h = drag.lastH
  const travel = h - drag.startH
  const openH = drag.containerH * 0.3  // the 'open' resting height (uiStore '30%')

  if (legendMode.value !== 'detail') {
    // Free-drag tabs: leave the sheet where it was released (custom px stays,
    // state unchanged) — the user reads the legend and the map together.
    if (h < openH * 0.5) uiStore.collapseLegend()
    return
  }
  if (Math.abs(travel) < SNAP_MIN_PX) { snapTo(drag.startState); return }   // hysteresis
  if (h < openH * 0.5) { uiStore.collapseLegend(); return }                 // pulled to the bottom
  if (travel > 0) uiStore.fullyOpenLegend()                                 // up → full
  else if (drag.startState === 'fullyOpen') uiStore.openLegend()            // down one step
  else uiStore.collapseLegend()                                             // down from open
}

function snapTo(state) {
  if (state === 'fullyOpen') uiStore.fullyOpenLegend()
  else if (state === 'collapsed') uiStore.collapseLegend()
  else uiStore.openLegend()
}

// ── Sheet height → host CSS var (keeps the engine's attribution visible) ───
// Writes --legend-sheet-h on the custom-element host (the CSS rule near the top
// of the stylesheet lifts the bottom control corners by it). Only a sheet with a
// real height writes: the hidden twin that LegendDesktop mounts inside the
// display:none desktop slot in detail mode (both profiles) observes 0 and must
// never zero the var under the visible sheet. The owner clears it on unmount.
const SHEET_H_VAR = '--legend-sheet-h'
let _sheetResizeObserver = null
let _sheetVarTarget = null
let _observedSheet = null

onMounted(() => {
  const sheet = sheetRef.value
  if (!sheet || typeof ResizeObserver === 'undefined') return
  const root = sheet.getRootNode()
  _sheetVarTarget = (root instanceof ShadowRoot) ? root.host : (root.documentElement || null)
  if (!_sheetVarTarget) return
  _observedSheet = sheet
  _sheetResizeObserver = new ResizeObserver(() => {
    const h = sheet.offsetHeight
    if (h <= 0) return
    _sheetVarTarget.style.setProperty(SHEET_H_VAR, `${h}px`)
    _sheetVarTarget.__legendSheetVarOwner = sheet
  })
  _sheetResizeObserver.observe(sheet)
})

onBeforeUnmount(() => {
  if (_sheetResizeObserver) { _sheetResizeObserver.disconnect(); _sheetResizeObserver = null }
  if (_sheetVarTarget && _sheetVarTarget.__legendSheetVarOwner === _observedSheet) {
    _sheetVarTarget.style.removeProperty(SHEET_H_VAR)
    _sheetVarTarget.__legendSheetVarOwner = null
  }
  _sheetVarTarget = null
  _observedSheet = null
})
</script>

<template>
  <!-- Containment wrapper: ensures position:absolute children are clipped to the map area
       and never escape the shadow DOM host / staging frame. -->
  <div class="legend-sheet-root">
    <!-- ★ THE NOTE FLOATS ABOVE THE SHEET, IT DOES NOT SIT INSIDE IT. It used to be the last child
         of .legend-content, a natural-height sibling of a flex:1 options panel — so every pixel it
         took was a pixel the options' inner scroller lost, and the reader scrolled further inside
         the tree to reach the same rows. Moving it WITHIN the sheet would not have helped: the
         sheet's height is fixed at 30%, so anything inside it costs the options the same either
         way. Out here it costs them nothing and the options keep the full sheet.
         Positioned off --legend-sheet-h, which a ResizeObserver already writes for the engine's
         own bottom controls, so it tracks the sheet as it opens, drags and collapses rather than
         assuming a height. -->
    <ApproxPinNote
      v-if="legendMode !== 'detail' && legendState !== 'collapsed'"
      class="approx-pin-note--floating"
      :class="{ 'approx-pin-note--floating-dark': isDark }"
      :dark="isDark"
    />
    <!-- Floating mini-image: fixed 16px above the sheet's resting position (30%).
         The sheet slides UP over it — the image never moves. -->
    <div
      v-if="legendMode === 'detail' && selectedPeopleGroup && legendState === 'open' && miniImageUrl"
      class="floating-mini-image"
      @click="uiStore.fullyOpenLegend()"
    >
      <img
        :src="miniImageUrl"
        :alt="selectedPeopleGroup.properties?.name"
        class="mini-image"
      />
    </div>

    <!-- Touch resize handlers sit on the SHEET: a drag may start anywhere in the
         top GRAB_ZONE_PX (strip + title row) — and, in detail mode, on the content
         when it can't scroll that way. See onSheetTouchStart for the model. -->
    <div
      ref="sheetRef"
      class="legend-mobile-sheet"
      :class="[legendState, { 'sheet-dark': isDark, dragging: isDragging }]"
      :style="{ height: legendHeight, '--legend-sheet-top-reserve': TOP_RESERVE_PX + 'px' }"
      @touchstart="onSheetTouchStart"
      @touchmove="onSheetTouchMove"
      @touchend="onSheetTouchEnd"
      @touchcancel="onSheetTouchEnd"
    >
      <!-- Thin drag strip at the very top: pull-tab visual + tap-to-toggle. -->
      <div class="sheet-drag-strip" @click="handleCaretClick">
        <div v-if="showPullTab" class="pull-tab-handle"></div>
      </div>

      <!-- (Collapse caret moved into the title row's column 1 via #title-caret
           slot below, so it's vertically aligned with the title text via
           grid/flex align-items:center — matching desktop's slot pattern.
           No more absolute positioning or padding hacks.) -->

      <!-- Detail-mode collapse caret — top-left, mirrors the close X on the
           right. Provides an always-visible finger-sized affordance to
           collapse the sheet when a people-group is selected. The 12px
           drag-strip alone is too small to reliably hit on touch. -->
      <button
        v-if="legendMode === 'detail' && legendState !== 'collapsed'"
        class="detail-collapse-btn-mobile"
        @click.stop="handleCaretClick"
        :aria-expanded="String(legendExpanded)"
        :aria-label="t('aria.toggleLegend')"
      ></button>

      <!-- Detail-mode close X — absolutely positioned top-right.
           Hidden when collapsed so the footer is clean (the user can re-expand
           via the collapsed-detail-footer caret to reach the X). -->
      <button
        v-if="legendMode === 'detail' && legendState !== 'collapsed'"
        class="detail-close-btn"
        @click.stop="handleCloseDetail"
        :aria-label="t('aria.backToLegend')"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <!-- Collapsed-detail footer: shown only when sheet is collapsed AND in
           detail mode. PeopleGroupDetail isn't designed to render at 48px, so
           we render a footer-style title bar inline (caret + people-group
           name) that mimics the LegendRows / SemanticTreeLegend collapsed
           footer pattern. (qa: 2026-05-03 user feedback iter-16) -->
      <div
        v-if="legendState === 'collapsed' && legendMode === 'detail' && selectedPeopleGroup"
        class="collapsed-detail-footer"
        @click="handleCaretClick"
      >
        <button class="mobile-collapse-caret"
          :style="{ transform: `rotate(${caretRotation}deg)` }"
          :aria-expanded="String(legendExpanded)"
        :aria-label="t('aria.toggleLegend')"
          tabindex="-1"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="collapsed-detail-title">{{ legendTitle }}</span>
      </div>

      <!-- Sheet body — same LegendRows invocation as desktop. -->
      <div class="legend-content">
        <!-- Detail-mode branch — wrapped in <template v-if> so when the sheet
             is collapsed in detail mode the v-else-if fallbacks (Semantic-
             TreeLegend / LegendRows) DO NOT render. Without this wrap the
             collapsed-detail-footer above + the v-else-if titlebar both
             showed the people-group name, producing the duplicated label
             reported 2026-05-03 iter-17. -->
        <template v-if="legendMode === 'detail' && selectedPeopleGroup">
          <PeopleGroupDetail
            v-if="legendState !== 'collapsed'"
            :peopleGroup="selectedPeopleGroup"
            :hideHeader="true"
            :dark="isDark"
            :action="popupAction"
          />
          <ApproxPinNote v-if="legendState !== 'collapsed'" :shared="selectedShared" :dark="isDark" />
        </template>

        <!-- Semantic-tree tabs (Languages, People Groups, WAGF Regions):
             SemanticTreeLegend (PPLR-ported, R4). Caret injected via
             #title-caret slot so it sits in column 1 of the .stl-titlebar,
             vertically aligned with the title text. -->
        <SemanticTreeLegend
          v-else-if="legendType !== 'default'"
          :nodes="treeForMobile"
          :tabs="tabsForMobile"
          :default-tab="defaultTab"
          :title="legendTitle || treeTitleForMobile"
          :hideTabs="nodes ? !tabs : _isFlatTabMobile"
          :columnLabel="treeColumnLabelForMobile"
          :columns="columns || ['count', 'pop']"
          :export-enabled="mobileExportEnabled"
          @select="onSemanticTreeSelect"
          @export="(kind) => onLegendExport && onLegendExport(kind)"
        >
          <template #title-caret>
            <button class="mobile-collapse-caret"
              :style="{ transform: `rotate(${caretRotation}deg)` }"
              @click.stop="handleCaretClick"
              :aria-expanded="String(legendExpanded)"
        :aria-label="t('aria.toggleLegend')">
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </template>
        </SemanticTreeLegend>

        <!-- Other tabs: LegendRows. Caret injected via #title-caret slot so
             it sits in .lrg-title-caret-slot at grid-column:1 of the title
             row, vertically aligned with the title via subgrid align-self. -->
        <LegendRows
          v-else
          :title="legendTitle"
          :items="legendDataItems"
          :columns="legendColumns"
          :activeFilter="activeFilter"
          :isDark="isDark"
          :hideColumnHeader="false"
          :showFooter="false"
          :disableCollapse="true"
          :totalCount="totalCount"
          :totalPopulation="totalPopulation"
          :fmtPop="fmtPop"
          :fmtCount="fmtCount"
          @filter-click="handleRowFilterClick"
        >
          <template #title-caret>
            <button class="mobile-collapse-caret"
              :style="{ transform: `rotate(${caretRotation}deg)` }"
              @click.stop="handleCaretClick"
              :aria-expanded="String(legendExpanded)"
        :aria-label="t('aria.toggleLegend')">
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </template>
        </LegendRows>

      </div>
    </div>
  </div><!-- /.legend-sheet-root -->
</template>

<style scoped>
/* All runtime styles are injected via useShadowStyles above. */
</style>
