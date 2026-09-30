<template>
        <div class="wall-container">
            <div class="wall-header">
                <h1>{{ mode === 'bless' ? $t('wall.blessBanner') : $t('wall.title') }}</h1>
                <div class="wall-controls">
                    <button @click="toggleOrientation" class="control-btn orientation-btn">
                        <span class="btn-label">{{ isLandscape ? $t('wall.toPortrait') : $t('wall.toLandscape') }}</span>
                        <span class="current-mode">{{ isLandscape ? $t('wall.currentLandscape') : $t('wall.currentPortrait') }}</span>
                    </button>
                    <!-- Loading every card's HD photo can take a while: the button shows it is busy and cannot
                         start a second load while the first is still running. -->
                    <button @click="onPrint" class="control-btn" :class="{ busy: printing }" :disabled="printing" :aria-busy="printing ? 'true' : 'false'">{{ $t('wall.printPoster') }}</button>
                    <button @click="resetZoom" class="control-btn">{{ $t('wall.resetZoom') }}</button>
                    <!-- BLESS (default): name, photo and a blessing verse under every group, made to print.
                         SOCIAL: the interactive card (pray, comments, share). -->
                    <label v-if="mode === 'bless'" class="poster-size">
                        <span>{{ $t('wall.posterSize') }}</span>
                        <select v-model="posterPreset" class="control-btn">
                            <option v-for="p in posterPresets" :key="p.id" :value="p.id">{{ p.label }}</option>
                        </select>
                    </label>
                    <div class="mode-toggle" role="group" :aria-label="$t('wall.modeLabel')">
                        <button type="button" class="control-btn" :class="{ on: mode === 'bless' }" :aria-pressed="mode === 'bless' ? 'true' : 'false'" @click="setMode('bless')">{{ $t('wall.modeBless') }}</button>
                        <button type="button" class="control-btn" :class="{ on: mode === 'social' }" :aria-pressed="mode === 'social' ? 'true' : 'false'" @click="setMode('social')">{{ $t('wall.modeSocial') }}</button>
                    </div>
                    <span class="group-count">{{ $t('wall.groupsLoaded', { n: totalGroups }) }}</span>
                </div>
            </div>
            
            <div ref="canvas" class="wall-canvas"></div>
            
            <div v-if="loading" class="loading-overlay">
                <div class="spinner"></div>
                <p>{{ $t('wall.loading') }}</p>
            </div>

            <!-- OFFLINE / BLOCKED: the live API could not be reached. Measured on a local dev server,
                 where pray.doxa.life refuses a 127.0.0.1 origin (CORS): the wall used to sit at
                 "0 Groups Loaded" with nothing saying why. Say what failed and offer a retry. -->
            <div v-else-if="loadError && totalGroups === 0" class="wall-offline" role="status">
                <p class="wall-offline-title">{{ $t('wall.offlineTitle') }}</p>
                <p>{{ $t('wall.offlineBody') }}</p>
                <button type="button" class="control-btn" @click="fetchData">{{ $t('wall.tryAgain') }}</button>
            </div>
        </div>
    
</template>

<script>
import { WallCanvas } from '../wallCanvas.js'
import { buildBlessPosterHtml, PRESETS, DEFAULT_PRESET } from '../blessPoster.js'
import { openPrintFrame } from '@map/composables/printInPlace.js'
// Wall of People Groups: a zoomable canvas wall (wallCanvas.js), Bless or Social cards, and the poster print.
export default {
    name: 'PeopleGroupsWall',
    // The page's profile-config, for its people-group LIST (library/lists/); handed to the store.
    inject: { profileConfig: { default: null } },
    data() {
        return {
            mode: 'bless',     // 'bless' (default) | 'social'
            posterPreset: DEFAULT_PRESET,   // blessPoster.js PRESETS: 5×8 ft (3 sheets) by default
            posterPresets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label + (p.sheets > 1 ? ' · ' + p.sheets + '×' : '') })),
            printing: false,   // the HD poster print is loading photos (drives the button's busy state)
            cardWidth: 50,      
            cardHeight: 70,     
            cardSpacing: 8,        // Increased horizontal spacing (was 2)
            cardVerticalSpacing: 8, // same as the horizontal gap, so the rows don't read as one block
            canvasWidth: 0,
            canvasHeight: 0,
            isLandscape: true,
            lodState: { mode: 'placeholder', loaded: 0, total: 0, cardPx: 0 }
        };
    },
    computed: {
        loading() {
            return this.$store?.loading || false;
        },
        
        totalGroups() {
            return this.$store?.totalGroups || 0;
        },
        
        peopleGroups() {
            return this.$store?.peopleGroups || [];
        },

        loadError() {
            return this.$store?.error || null;
        }
    },
    mounted() {
        // A test hook on the HOST element (not window): the level-of-detail state, as before.
        try { const host = this.$el?.getRootNode?.()?.host; if (host) host.__wallLod = () => ({ ...this.lodState }); } catch (_) { /* no host */ }
        this.initializeCanvas();
        this.fetchData();
        // The canvas is not reactive: redraw when a prayer is added (heart + count) or the language changes.
        this.$watch(() => this.$store?.prayers, () => this._wc?.request(), { deep: true });
        this.$watch(() => this.$i18n?.locale, () => this._wc?.request());
    },
    beforeUnmount() {
        // Release the canvas, its listeners and every cached photo (the fleet's leak rule).
        this._wc?.destroy(); this._wc = null;
        try { const host = this.$el?.getRootNode?.()?.host; if (host) delete host.__wallLod; } catch (_) { /* no host */ }
    },
    methods: {
        async fetchData() {
            if (this.$store) {
                this.$store.profileConfig = this.profileConfig;
                await this.$store.fetchPeopleGroups();
                this.renderCards();
            } else {
                console.error('❌ Store not available!');
            }
        },
        
        // ONE <canvas> (wallCanvas.js) instead of an SVG of ~36,000 nodes: the same world, grid and
        // gestures, drawn per frame for the cards in view only.
        initializeCanvas() {
            this.canvasWidth = this.isLandscape ? 4000 : 3000;
            this.canvasHeight = this.isLandscape ? 3000 : 4000;
            if (this._wc) { this._wc.setWorld(this.canvasWidth, this.canvasHeight); return; }
            this._wc = new WallCanvas(this.$refs.canvas, {
                worldW: this.canvasWidth, worldH: this.canvasHeight,
                label: this.$t('wall.title'),
                spacing: this.cardSpacing, vSpacing: this.cardVerticalSpacing,
                labels: (k, p, n) => (n === undefined ? this.$t(k, p) : this.$t(k, p, n)),
                prayCount: (d) => Number(d.peoplePraying || 0) + (this.$store?.prayers?.[d.ID] || 0),
                onPray: (d) => this.openPrayerDialog(d),
                onComments: (d) => this.openComments(d),
                onShare: () => alert(this.$t('wall.shareSoon')),
            });
            this._wc.setMode(this.mode);
        },
        renderCards() {
            if (!this._wc || !this.peopleGroups || this.peopleGroups.length === 0) return;
            this._wc.setGroups(this.peopleGroups);
            this.$nextTick(() => this._wc?.startView(96));
            this.lodState = { mode: 'canvas', loaded: 0, total: this.peopleGroups.length, cardPx: 0 };
        },
        // Print always prints the poster (blessPoster.js): 5 × 8 ft on three stacked sheets by default.
        onPrint() { return this.printBlessPoster(); },
        printBlessPoster() {
            if (this.printing) return;
            const groups = (this.peopleGroups || []).map((d) => ({ name: d.name || d.post_title || '', imageUrl: d.imageUrl || '' }));
            if (!groups.length) return;
            this.printing = true;
            const texts = {
                banner: this.$t('wall.blessBanner'),
                subtitle: this.$t('wall.posterSubtitle', { n: groups.length.toLocaleString('en-US') }),
                glueHere: this.$t('wall.glueHere'),
                // The chart labels and the closing line are translated; the journey's station names print in
                // English (blessPoster defaults) until they have keys, and the verses are WEB English in every
                // locale for now (sheet row 103).
                labels: {
                    themesLabel: this.$t('wall.themesLabel'),
                    oldTestament: this.$t('wall.oldTestament'),
                    newTestament: this.$t('wall.newTestament'),
                    theme_treasure: this.$t('wall.themeTreasure'),
                    theme_mountain: this.$t('wall.themeMountain'),
                    theme_sea: this.$t('wall.themeSea'),
                    closing: this.$t('wall.posterClosing'),
                },
                lang: String(this.$i18n?.locale || 'en'),
                dir: /^(ar|he|fa|ur)/.test(String(this.$i18n?.locale || '')) ? 'rtl' : 'ltr',
            };
            const win = openPrintFrame(buildBlessPosterHtml(groups, this.posterPreset, texts), { autoprint: true });
            // Busy until the photos have loaded and the print dialog is up (the frame prints on its own 'load').
            const done = () => { this.printing = false; };
            if (win) { try { win.addEventListener('load', () => setTimeout(done, 300), { once: true }); } catch (_) { done(); } setTimeout(done, 120000); }
            else done();
        },
        setMode(m) {
            if (this.mode === m) return;
            this.mode = m;
            this._wc?.setMode(m);
        },
        handlePrayer(group) {
            // This method is deprecated - now using openPrayerDialog
            this.openPrayerDialog(group);
        },
        
        openPrayerDialog(group) {
            this.$emit('open-prayer', group);
        },
        
        openComments(group) {
            this.$emit('open-comments', group);
        },
        
        truncateText(text, maxLength) {
            if (!text) return '';
            return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
        },
        
        // The wall opens where the photos are (wallCanvas.startView: cards ~96 px); Reset Zoom shows it all.
        resetZoom() { this._wc?.resetZoom(); },
        toggleOrientation() {
            this.isLandscape = !this.isLandscape;
            this.initializeCanvas();
            this.renderCards();
        },
    },
};
</script>
