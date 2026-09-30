<script setup>
/**
 * template-map-b.vue — example profile "B"
 *
 * @description Minimal example profile B — a second profile in the same bundle.
 * @profile     template-map-b
 * @bundle      template-bundle
 * @element     template-bundle
 *
 * A SECOND profile living in the SAME bundle folder, alongside
 * template-map-a.vue (both flat, no profiles/ subfolder). Both compile into the
 * single output file public/dx-maps/template-bundle/template-bundle.js — one
 * bundle, two profiles.
 * The host chooses which one to show with the `profile` field:
 *
 *   <template-bundle profile-config='{"profile":"template-map-b"}'></template-bundle>
 */
import { inject, computed } from 'vue'

const config = inject('profileConfig', null)
const note = computed(() => config?.value?.note || '(no note passed in profile-config)')
</script>

<template>
  <div class="tpl tpl--b">
    <h2>Profile B</h2>
    <p>Served from <code>template-map-b.vue</code> in the <code>template-bundle</code> bundle.</p>
    <p class="note">note: {{ note }}</p>
  </div>
</template>

<style scoped>
.tpl {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; gap: 6px;
  align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  text-align: center;
}
/* MATERIAL LIGHT (2026-09-21). Was background #1f0b2a / color #d8b4fe. See template-map-a.vue for
   why the STARTER matters most: the copy-me recipe propagates whatever it finds here.
   Kept visibly distinct from profile a (white card + neutral border, vs a's tinted surface and
   accent border) so the two-profile demo still reads as two profiles. */
.tpl--b { background: #ffffff; color: #3b463d; border: 1px solid #d1d4cd; }
.tpl h2 { font-size: 22px; font-weight: 700; }
.tpl code { background: rgba(59, 70, 61, 0.08); padding: 1px 6px; border-radius: 4px; }
.tpl .note { font-size: 12px; opacity: 0.7; }
</style>
