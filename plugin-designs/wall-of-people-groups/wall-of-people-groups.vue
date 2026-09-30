<script>
/**
 * wall-of-people-groups.vue — Wall of People Groups: every Doxa people group on one zoomable wall.
 *
 * @description Every Doxa people group as a card on one zoomable prayer wall
 * @profile     wall-of-people-groups
 * @bundle      wall-of-people-groups
 * @element     wall-of-people-groups
 *
 * MOVED 2026-09-25 from the wall-of-people-groups no-build SPA (far-fast-tools, read-only). Its
 * components were plain objects with template strings compiled in the browser; they are now SFCs
 * in src/components. This file is the app container from its main.js, without the router (the
 * only other route was an API developer panel, which does not ship).
 *
 * Data: the live pray.doxa.life people-group list (2,107 groups, with photos and prayer counts).
 * Prayers and comments stay in this browser's localStorage, under a 'wall-pg:' prefix.
 * d3 and Font Awesome are CDN globals, loaded on first mount.
 */
import PeopleGroupsWall from './src/components/PeopleGroupsWall.vue'
import CommentsDialog from './src/components/CommentsDialog.vue'
import PrayerDialog from './src/components/PrayerDialog.vue'
import SourceSelector from './src/components/SourceSelector.vue'
import { ensureD3 } from './src/wallD3.js'

export default {
  name: 'WallOfPeopleGroups',
  components: { PeopleGroupsWall, CommentsDialog, PrayerDialog, SourceSelector },
  data() {
    return { ready: false, error: null, commentsDialogVisible: false, prayerDialogVisible: false, selectedGroup: null }
  },
  mounted() {
    ensureD3().then(() => { this.ready = true }, (e) => { this.error = e.message })
  },
  methods: {
    openCommentsDialog(group) { this.selectedGroup = group; this.commentsDialogVisible = true },
    closeCommentsDialog() {
      this.commentsDialogVisible = false
      setTimeout(() => { this.selectedGroup = null }, 300)
    },
    openPrayerDialog(group) { this.selectedGroup = group; this.prayerDialogVisible = true },
    closePrayerDialog() {
      this.prayerDialogVisible = false
      setTimeout(() => { if (!this.commentsDialogVisible) this.selectedGroup = null }, 300)
    },
    handlePrayerConfirmed() { /* PrayerDialog already updated the store */ },
  },
}
</script>

<template>
  <div class="app-container">
    <source-selector />
    <people-groups-wall v-if="ready" @open-comments="openCommentsDialog" @open-prayer="openPrayerDialog" />
    <div v-else-if="error" class="wall-error">{{ $t('wall.drawLibError') }} {{ error }}</div>
    <comments-dialog :visible="commentsDialogVisible" :group="selectedGroup" @close="closeCommentsDialog" />
    <prayer-dialog :is-open="prayerDialogVisible" :group="selectedGroup" @close="closePrayerDialog" @prayer-confirmed="handlePrayerConfirmed" />
  </div>
</template>

<style src="./src/wall.css"></style>
<style>
:host { display: block; position: relative; min-height: 600px; }
.app-container { position: relative; width: 100%; height: 100%; }
.wall-error { padding: 24px; color: #3b463d; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
</style>
