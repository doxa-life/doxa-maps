<!--
  ShareButton.vue — Non-technical share modal for the map toolbar.

  Redesigned to match consumer-grade UX from YouTube, Spotify, Canva, and
  Google Maps. Two tabs:

    1. "Share Link" — clean URL display + one-click copy + social share icons
    2. "Add to Your Website" — friendly embed guidance with size presets

  The word "iframe" never appears in any user-visible text. The embed tab
  leads with a plain-English description, then shows the code below.

  Props:
    isDark    — theme flag forwarded from parent
    embedPath — this map's standalone embed page, TREE-RELATIVE
                (`<bundle>/<profile>/index.html`); resolved by utils/embedBase.js

  Popover closes on:
    - Click outside (shadow-DOM-aware via composedPath)
    - Escape key
    - Re-click the share button
-->
<script setup>
import { ref, computed, inject, unref, provide } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { resolveShareUrl } from '../../utils/embedBase.js'
import MapControlButton from './MapControlButton.vue'
import MapControlMenu from './MapControlMenu.vue'

/* ------------------------------------------------------------------ */
/* Shadow-DOM styles                                                   */
/* ------------------------------------------------------------------ */
useShadowStyles(`
/* ---- share button: a thin, slowly turning rainbow ring behind the round button ---- */
.share-wrap{position:relative;display:inline-block;border-radius:50%;}
.share-wrap::before{content:'';position:absolute;inset:-2px;border-radius:50%;padding:2px;pointer-events:none;
  background:conic-gradient(#ff6b6b,#ffd166,#6bd67b,#4dabf7,#9775fa,#f783ac,#ff6b6b);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  opacity:0.6;animation:share-ring-turn 5s linear infinite;}
.share-wrap:hover::before{opacity:0.95;}
/* The ring itself rotates, so the colours travel around the button in every browser. */
@keyframes share-ring-turn{to{transform:rotate(360deg);}}
@media(prefers-reduced-motion:reduce){.share-wrap::before{animation:none;}}
.share-steps{margin:10px 14px 6px;padding:0 0 0 15px;list-style:'- ';font:14px/1.55 system-ui,sans-serif;color:#c9d1d9;}
.share-steps li{margin:0 0 3px;padding-left:3px;}
.share-steps li:last-child{font-weight:600;color:#92b195;}
.share-pop.light .share-steps{color:#3b463d;}
.share-pop.light .share-steps li:last-child{color:#3b463d;}
/* ---- popover shell ---- */
/* ---- popover shell (imitates SemanticTreeLegend .stl-inner) ---- */
.share-pop{
  font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:13px;
  color:#e6edf3;
}
.share-pop.light{color:#1f2328;}

/* ---- tabs ---- */
.share-tabs{
  display:flex;
  gap:0;
  padding:0 16px;
  margin-top:8px;
  border-bottom:1px solid rgba(255,255,255,0.08);
}
.share-pop.light .share-tabs{border-bottom:1px solid rgba(0,0,0,0.08);}
.share-tab{
  padding:6px 0;
  margin-right:20px;
  font-size:12.5px;
  font-weight:600;
  background:none;border:none;
  color:inherit;opacity:0.5;
  cursor:pointer;
  border-bottom:2px solid transparent;
  transition:opacity 0.15s,border-color 0.2s;
  font-family:inherit;
  white-space:nowrap;
}
.share-tab:hover{opacity:0.75;}
.share-tab.active{
  opacity:1;
  border-bottom-color:#4a90d9;
}
.share-pop.light .share-tab.active{
  border-bottom-color:#1a73e8;
}

/* ---- tab body ---- */
.share-body{
  padding:12px 16px 14px 16px;
}

/* ---- Share Link tab ---- */
.share-url-box{
  display:flex;
  align-items:center;
  gap:0;
  background:rgba(0,0,0,0.22);
  border:1px solid rgba(255,255,255,0.08);
  border-radius:10px;
  overflow:hidden;
}
.share-pop.light .share-url-box{
  background:rgba(0,0,0,0.035);
  border:1px solid rgba(0,0,0,0.10);
}
.share-url-text{
  flex:1;
  padding:11px 14px;
  font-size:13px;
  color:#b0b8c8;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  -webkit-user-select:all;
  user-select:all;
}
.share-pop.light .share-url-text{color:#555;}

/* ---- primary CTA button ---- */
.share-primary-btn{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  width:100%;
  padding:12px 0;
  margin-top:14px;
  background:#4a90d9;
  border:none;
  border-radius:10px;
  color:#fff;
  font-size:14.5px;
  font-weight:600;
  cursor:pointer;
  transition:background 0.15s,transform 0.1s;
  font-family:inherit;
}
.share-primary-btn:hover{background:#3d7ec5;}
.share-primary-btn:active{transform:scale(0.98);}
.share-primary-btn.copied{
  background:#2ea44f;
}
.share-pop.light .share-primary-btn{
  background:#1a73e8;
}
.share-pop.light .share-primary-btn:hover{
  background:#1565c0;
}
.share-pop.light .share-primary-btn.copied{
  background:#2ea44f;
}

/* ---- social row ---- */
.share-social-row{
  display:flex;
  align-items:center;
  gap:10px;
  margin-top:16px;
  padding-top:14px;
  border-top:1px solid rgba(255,255,255,0.06);
}
.share-pop.light .share-social-row{
  border-top:1px solid rgba(0,0,0,0.06);
}
.share-social-label{
  font-size:12px;
  opacity:0.45;
  font-weight:500;
  margin-right:auto;
  white-space:nowrap;
}
.share-social-btn{
  width:36px;height:36px;
  border-radius:50%;
  border:1px solid rgba(255,255,255,0.10);
  background:rgba(255,255,255,0.06);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;
  color:inherit;
  transition:background 0.15s,border-color 0.15s;
}
.share-social-btn:hover{
  background:rgba(255,255,255,0.12);
  border-color:rgba(255,255,255,0.18);
}
.share-pop.light .share-social-btn{
  border:1px solid rgba(0,0,0,0.10);
  background:rgba(0,0,0,0.03);
}
.share-pop.light .share-social-btn:hover{
  background:rgba(0,0,0,0.07);
  border-color:rgba(0,0,0,0.16);
}

/* ---- Embed tab ---- */
.share-embed-desc{
  font-size:13.5px;
  line-height:1.55;
  opacity:0.72;
  margin-bottom:16px;
}

.share-size-pills{
  display:flex;
  gap:8px;
  margin-bottom:14px;
}
.share-size-pill{
  padding:6px 14px;
  border-radius:20px;
  border:1px solid rgba(255,255,255,0.12);
  background:transparent;
  color:inherit;
  font-size:12.5px;
  font-weight:500;
  cursor:pointer;
  transition:background 0.15s,border-color 0.15s;
  font-family:inherit;
}
.share-size-pill:hover{
  background:rgba(255,255,255,0.06);
}
.share-size-pill.active{
  background:rgba(74,144,217,0.18);
  border-color:rgba(74,144,217,0.45);
  color:#7ab8f5;
}
.share-pop.light .share-size-pill{
  border:1px solid rgba(0,0,0,0.12);
}
.share-pop.light .share-size-pill:hover{
  background:rgba(0,0,0,0.04);
}
.share-pop.light .share-size-pill.active{
  background:rgba(26,115,232,0.10);
  border-color:rgba(26,115,232,0.40);
  color:#1a73e8;
}

.share-code-box{
  background:rgba(0,0,0,0.28);
  border:1px solid rgba(255,255,255,0.06);
  border-radius:10px;
  padding:12px 14px;
  font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;
  font-size:11.5px;
  line-height:1.5;
  color:#a0aab8;
  word-break:break-all;
  white-space:pre-wrap;
  /* ★ NO SCROLLBAR — THE MENU SHOWS THE WHOLE SNIPPET (Driver 2026-09-23: "the share menu that
     opens up should be fully expanded; it shouldn't have a scroll bar, but it currently has one").
     Was max-height:90px + overflow-y:auto, which clipped a ~4-line embed snippet to about two and
     a half lines and put a scrollbar inside a popover. That is the wrong trade for THIS content:
     the box exists to be READ and COPIED in one glance, and user-select:all below means the whole
     snippet is selected by a single click -- a scrollport actively fights that gesture, because
     the selection extends into content the reader never saw.
     height:auto lets the snippet size itself; the popover is short-lived and anchored, so the few
     extra lines cost nothing. If a future snippet ever grows genuinely long, cap the POPOVER and
     let it scroll as one surface -- do not reintroduce a scrollport around the code box alone. */
  height:auto;
  -webkit-user-select:all;
  user-select:all;
}
.share-pop.light .share-code-box{
  background:rgba(0,0,0,0.035);
  border:1px solid rgba(0,0,0,0.08);
  color:#444;
}

/* ---- copy code button (secondary style) ---- */
.share-secondary-btn{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  width:100%;
  padding:11px 0;
  margin-top:12px;
  background:rgba(255,255,255,0.08);
  border:1px solid rgba(255,255,255,0.12);
  border-radius:10px;
  color:#e0e4ec;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  transition:background 0.15s,border-color 0.15s,transform 0.1s;
  font-family:inherit;
}
.share-secondary-btn:hover{
  background:rgba(255,255,255,0.13);
  border-color:rgba(255,255,255,0.18);
}
.share-secondary-btn:active{transform:scale(0.98);}
.share-secondary-btn.copied{
  background:rgba(46,164,79,0.16);
  border-color:rgba(46,164,79,0.35);
  color:#5cd680;
}
.share-pop.light .share-secondary-btn{
  background:rgba(0,0,0,0.04);
  border:1px solid rgba(0,0,0,0.12);
  color:#333;
}
.share-pop.light .share-secondary-btn:hover{
  background:rgba(0,0,0,0.07);
}
.share-pop.light .share-secondary-btn.copied{
  background:rgba(46,164,79,0.10);
  border-color:rgba(46,164,79,0.30);
  color:#2ea44f;
}

/* ---- responsive: align with MapToolbar's layout convention ----
   The research-map profile uses @media(max-width:767px) and positions the
   search bar at top:10, left:10, right:10. The geocoder pill renders ~60px
   tall on mobile, so its bottom edge is ~70px. MapToolbar sits at top:80
   (10px gap below search). We mirror MapToolbar exactly so the popover's
   top edge aligns with the top of the '+' button.
   right:52 = MapToolbar right(10) + button-width(36) + 6px breathing room. */
`, 'share-button')

const { t, tm, rt } = useI18n()

const props = defineProps({
  isDark: { type: Boolean, default: false },
  embedPath: { type: String, default: '' }
})

/* ---- state ---- */
const rootEl = ref(null)
const isOpen = ref(false)
const popoverEl = ref(null)
const btnEl = ref(null)
const activeTab = ref('link')          // 'link' | 'embed'
const linkCopied = ref(false)
const embedCopied = ref(false)
const embedSize = ref('medium')        // 'small' | 'medium' | 'large'

const sizePresets = {
  small:  { label: 'Small',  height: 400 },
  medium: { label: 'Medium', height: 600 },
  large:  { label: 'Large',  height: 800 }
}

/* ---- computed ---- */
/* The standalone embed page this map is shared/iframed as — resolved by
   utils/embedBase.js (its header documents the full ladder). In short:
   (1) profileConfig.shareUrl — a WHOLE url the HOST supplies wins (the dev
       plugin gallery passes its own #/<bundle>/<profile>[/<instance>] deep link);
   (2) the `embedPath` prop — the PROFILE owns an ID→URL table and passes the
       active instance's page (parameterized profiles keyed by active tab id) —
       or the app-profile config (provided by ProfileLoader as 'profileConfig')
       via profile-config.shareEmbedPath. Paths are TREE-RELATIVE
       (`<bundle>/<profile>/index.html`) and join the embed base:
       profileConfig.embedBaseUrl → window.MAP_EMBED_BASE_URL → the root the
       built bundle derives from its OWN script url — so a dropped tree shares
       working links on the plugin gallery, doxa.life or any CDN with no config.
       Absolute urls pass through; a leading '/' is legacy root-relative;
   (3) the page's own location — each map builds to a self-contained page
       ("Share shares THE MAP"), so with nothing configured the current page IS
       the correct embed url. */
const profileConfig = inject('profileConfig', null)
const shareUrl = computed(() => resolveShareUrl({
  embedPath: props.embedPath,
  profileConfig: unref(profileConfig) || null,
}))

const embedSnippet = computed(() => {
  const h = sizePresets[embedSize.value].height
  return '<iframe src="' + shareUrl.value + '" width="100%" height="' + h + '" style="border:none; border-radius:12px;" allowfullscreen></iframe>'
})

/* ---- actions ---- */
function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    activeTab.value = 'link'
    linkCopied.value = false
    embedCopied.value = false
  }
}

function close() {
  isOpen.value = false
}

/* Copy that works EVERYWHERE (maintainer bug 2026-07-11: on file:// the button did nothing —
   navigator.clipboard exists only in secure contexts (https/localhost). Fallback: the
   classic hidden-textarea + execCommand path, which insecure contexts still support. */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

async function copyLink() {
  if (await copyText(shareUrl.value)) {
    linkCopied.value = true
    setTimeout(() => { linkCopied.value = false }, 2000)
  }
}

async function copyEmbed() {
  if (await copyText(embedSnippet.value)) {
    embedCopied.value = true
    setTimeout(() => { embedCopied.value = false }, 2000)
  }
}

/* ------------------------------------------------------------------ */
/* Anchoring OFF a map — the "menu opens off the right edge" fix        */
/* ------------------------------------------------------------------ */
/*
  ★ DRIVER-REPORTED TWICE (2026-09-22): "when you click the share button on the research
  dashboard, the menu is showing down to the RIGHT of the share button, and the share button is at
  the very top right of the page. So down-to-the-right is actually OFF the page."

  THE ROOT CAUSE IS AN ABSENT ANCHOR, NOT A WRONG ALIGNMENT CHOICE — measured, and it is a
  DIFFERENT bug from the FilterDropdown one it superficially resembles. That one was a
  position:fixed popover whose viewport frame was stolen by `contain:layout paint` on an ancestor.
  This menu is not fixed at all. MapControlMenu.place() reads an INJECTED `mapToolbar`:

      const tb = toolbar?.el?.value, area = host.value
      if (!tb || !area) { style.value = {}; return }          // <-- this branch

  `provide('mapToolbar')` comes from MapToolbar.vue, and in the research dashboard MapToolbar is
  rendered by DashboardMapPanel — a SIBLING of the top bar, not an ancestor of it. inject() walks
  the COMPONENT TREE, so a ShareButton mounted in the top bar resolves the fallback `null`, place()
  returns an EMPTY style, and `.mcm{position:absolute}` with no top/right falls back to its STATIC
  position: immediately below-and-right of a button already at the far top-right. Off the page,
  exactly as reported. Nothing was ever choosing "right" — nothing was choosing anything.

  SO THE FIX IS TO GIVE IT AN ANCHOR, not to add a second placement scheme. When no toolbar is
  provided, this button provides one pointing at its OWN wrapper, and marks that wrapper as the
  containing area. MapControlMenu's existing measured logic then does the whole job unchanged:
  it compares the anchor's centre to the area's centre, opens on the INNER side, and clamps the
  width to what fits. A share button at the top right is right-of-centre, so the menu opens to the
  LEFT — which is what the Driver asked for, arrived at by measurement rather than by hardcoding a
  side that would then be wrong for a left-hand placement.

  WHY `inject` FIRST AND `provide` ONLY AS A FALLBACK: on a real map this component must keep
  behaving byte-identically — the toolbar is the correct anchor there, and the menu should still
  align to the control COLUMN, not to one button in it. This only engages where the injection
  genuinely resolves to nothing, so no map profile changes.
*/
const providedToolbar = inject('mapToolbar', null)
const selfAnchor = ref(null)
// Re-provide UNCONDITIONALLY so the value is stable for the child's inject(); `el` stays null when
// a real toolbar was found, and MapControlMenu keeps using that toolbar instead.
provide('mapToolbar', providedToolbar || { el: selfAnchor })
const hasOwnAnchor = !providedToolbar

/*
  ★ THIS IS A FUNCTION REF, AND onMounted WOULD NOT HAVE WORKED — the hazard is worth naming,
  because the fix silently does NOTHING if it is written the obvious way.

  MapControlMenu latches its area ONCE, in its own onMounted:
      host.value = toolbar?.el?.value?.closest(AREA) || null
  and place() bails forever after if that is null. MapControlMenu is a CHILD of this component, and
  Vue runs a child's mounted hook BEFORE its parent's. So an onMounted here would set the anchor
  one tick too late: the child would have already read `null`, latched `host = null`, and no later
  assignment would revive it — the menu would go on opening at its static position and the fix
  would look applied while changing nothing.

  A function ref is invoked during RENDER, before any mounted hook on either component, so the
  anchor and the area tag are in place by the time the child looks for them.

  `data-map-area` is what MapControlMenu.AREA finds via closest(). It is tagged on the OFFSET
  PARENT, not on .share-wrap: the wrapper is a 32px button, and an area that small would clamp the
  menu to its 200px minimum jammed against the edge. The offset parent is the top bar, which spans
  the row, so the menu has the full width to open leftward into.
*/
function bindAnchor(el) {
  rootEl.value = el || null
  if (!hasOwnAnchor || !el) { if (!el) selfAnchor.value = null; return }
  const area = el.offsetParent || el.parentElement
  // Never re-tag a host that already declares itself an area — that host owns the decision.
  if (area && !area.closest('.dsm-map-area, .rm-map-area, .dm-map-area, [data-map-area]')) {
    area.setAttribute('data-map-area', 'share-fallback')
  }
  selfAnchor.value = el
}

/* Placement, stacking, outside-click and Escape live in MapControlMenu (shared by every
   control menu); this button only toggles `isOpen`. */
</script>

<template>
  <!-- :ref is a FUNCTION, deliberately — it must run during render, before MapControlMenu's
       mounted hook latches its area. See bindAnchor() in <script> for why onMounted is too late. -->
  <div :ref="bindAnchor" class="share-wrap" data-share-root>
    <MapControlButton
      ref="btnEl"
      data-control="share"
      :is-dark="isDark"
      :active="isOpen"
      :title="t('buttons.share')"
      @click="toggle"
    >
      <!-- Share icon: box with upward arrow (iOS / Material standard) -->
      <svg xmlns="http://www.w3.org/2000/svg"
           width="18" height="18" viewBox="0 0 24 24"
           fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
    </MapControlButton>

    <!-- =================== Menu (shared MapControlMenu owns placement + chrome) =================== -->
    <MapControlMenu :open="isOpen" :title="t('buttons.share')" :is-dark="isDark" @close="close">
    <div ref="popoverEl" class="share-pop" :class="{ light: !isDark }">
      <!-- The multiplication path — one line each, top of the menu -->
      <ul class="share-steps">
        <li v-for="(step, i) in tm('buttons.shareSteps')" :key="i">{{ rt(step) }}</li>
      </ul>
      <!-- Tabs -->
      <div class="share-tabs">
        <button
          class="share-tab"
          :class="{ active: activeTab === 'link' }"
          @click="activeTab = 'link'"
        >{{ T('share.embed_link', 'Embed link') }}</button>
        <button
          class="share-tab"
          :class="{ active: activeTab === 'embed' }"
          @click="activeTab = 'embed'"
        >{{ T('share.add_to_website', 'Add to Your Website') }}</button>
      </div>

      <!-- ===== Tab 1: Share Link ===== -->
      <div v-if="activeTab === 'link'" class="share-body">
        <!-- URL display -->
        <div class="share-url-box">
          <div class="share-url-text">{{ shareUrl }}</div>
        </div>

        <!-- Copy Link primary CTA -->
        <button
          class="share-primary-btn"
          :class="{ copied: linkCopied }"
          @click="copyLink"
        >
          <!-- Copy / Check icon -->
          <svg v-if="!linkCopied" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ linkCopied ? 'Copied!' : 'Copy Link' }}
        </button>
      </div>

      <!-- ===== Tab 2: Add to Your Website ===== -->
      <div v-if="activeTab === 'embed'" class="share-body">
        <!-- Friendly description -->
        <div class="share-embed-desc">
          {{ T('share.embed_paste_hint', 'Paste this code into your website builder (WordPress, Squarespace, Wix, or any site that accepts HTML widgets).') }}
        </div>

        <!-- Size presets -->
        <div class="share-size-pills">
          <button
            v-for="(preset, key) in sizePresets"
            :key="key"
            class="share-size-pill"
            :class="{ active: embedSize === key }"
            @click="embedSize = key"
          >{{ preset.label }}</button>
        </div>

        <!-- Code box -->
        <div class="share-code-box">{{ embedSnippet }}</div>

        <!-- Copy Code button -->
        <button
          class="share-secondary-btn"
          :class="{ copied: embedCopied }"
          @click="copyEmbed"
        >
          <svg v-if="!embedCopied" width="15" height="15" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ embedCopied ? 'Copied!' : 'Copy Code' }}
        </button>
      </div>
    </div>
    </MapControlMenu>
  </div>
</template>
