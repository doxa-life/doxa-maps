<!--
  HelpButton.vue — Opens the "About this map" help modal.

  Service logic extension point: swap the `open-help` emit for an inline
  tooltip, an external link, a Pinia help-store action, etc.

  Props:
    isDark — theme flag forwarded from parent

  Emits:
    open-help — fires on click; parent decides how to display help content
-->
<script setup>
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'

const { t } = useI18n()

defineProps({
  isDark: { type: Boolean, default: false }
})

defineEmits(['open-help'])
</script>

<template>
  <MapControlButton data-control="help" :is-dark="isDark" :title="t('buttons.aboutThisMap')" @click="$emit('open-help')">
    <span style="font-size:15px;font-weight:700;font-family:serif;line-height:1;">?</span>
  </MapControlButton>
</template>
