// usePosterPrints.js — THE print actions every poster wall shares.
//
// ★ WHY THIS EXISTS. The poster wall was generalised into
// library/components/poster/PosterWall.vue and two bundles were migrated onto it —
// but the ORIGINAL, my-upg-100-list/poster-wall.vue (903 lines), was left behind.
// So the one wall carrying the real print actions is the one wall nothing else can
// benefit from, and the shared component's packet path is still a "coming soon"
// stub. Every print fix made in the 100-list is invisible to the three bundles on
// the shared component, and vice versa. That divergence is the bug.
//
// ── THE SEAM ────────────────────────────────────────────────────────────────
// The PRINT ACTIONS are shareable; the RECORD FETCHING is not. fetchListRecords in
// the 100-list knows the people-groups API, the selector evaluator and the pg_slugs
// special case; Key Cities and Country Posters have entirely different data shapes.
// So this composable takes a `records(item)` PROVIDER and owns everything after it:
// the HUD state machine, the in-place print frame, and the three documents.
//
// That is also what keeps the bundles honest — a wall that cannot supply records
// simply does not pass a provider, and the actions that need them stay hidden
// rather than failing at click time.
//
// ⚠ PRINTS IN PLACE, never window.open(). A popup is blockable and drops the reader
// out of the map; the shared openPrintFrame mounts a hidden same-page iframe. This
// is the mechanism the Driver asked for by name: "not supposed to open up a new
// browser, but should open up the print dialog directly in the browser".

import { ref } from 'vue';
import { openPrintFrame } from './printInPlace.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * @param {object} opts
 *   records   async (item) => rows[]   — REQUIRED for the list and deck prints.
 *   strings   () => Promise<object>    — the packet/card i18n catalog.
 *   lang      () => string             — the app locale; the deck and packet follow it.
 *   stock     () => string             — card stock id (see card-render.js STOCK).
 *   posterUrl (item) => string|null    — the pre-rendered image, when one exists.
 *   label     (item) => string
 */
export function usePosterPrints(opts = {}) {
  // ⚠ ACCEPT the caller's state ref when it has one. A wall that renders its OWN
  // exportState while these actions write to a private ref shows no progress and
  // swallows errors — the mechanism works and the feedback does not. Owning a ref
  // here is only the standalone default.
  const exportState = opts.state || ref(null);
  const busy = () => exportState.value !== null;

  const label = opts.label || ((item) => item?.label || item?.id || '');
  const lang = opts.lang || (() => 'en');
  const stock = opts.stock || (() => 'poker');

  const set = (item, kind, phase, message, pct) => {
    exportState.value = { label: label(item), kind, phase, message, pct };
  };
  const done = (item, kind) => {
    set(item, kind, 'done', 'print dialog opened', 100);
    setTimeout(() => { exportState.value = null; }, 900);
  };
  const fail = (item, kind, e) => {
    set(item, kind, 'error', String(e?.message || e).slice(0, 140), 0);
  };
  function dismiss() { exportState.value = null; }

  async function rows(item) {
    if (typeof opts.records !== 'function') {
      throw new Error('this wall supplies no records provider');
    }
    const r = await opts.records(item);
    if (!r || !r.length) throw new Error('that list resolved to no records');
    return r;
  }

  // ── 1. THE POSTER ─────────────────────────────────────────────────────────
  // Prefers the pre-rendered image; falls back to rasterising the poster's own
  // HTML in the browser, which is what lets the repo stop shipping 41 MB of webp.
  // ★ THIS IS THE WALL'S posterAction='print' PATH, PROMOTED. It was a private function in
  // PosterWall.vue, which meant the MAP LEGEND's own "print this list's poster" had no way to
  // reach it — and the legend had grown a fourth implementation instead: a hand-rolled
  // `<a download>` of the .webp. That was wrong twice over. It silently downloads a file,
  // which the Driver ruled out explicitly (2026-09-23: "no silent file download as the default
  // action"), and it has NO fallback, so on the 27 lists whose .webp does not ship it simply
  // saved a 404.
  //
  // Two guards below were each learned the hard way and MUST survive any future move:
  //   1. a THROWN fetch is a MISS, not an error (blocked/offline/refused reject rather than
  //      returning !ok). Letting it escape skips the rasterise fallback entirely — measured
  //      during the wall migration, when check-poster-print-fallback went PASS -> FAIL with 0
  //      .html requests.
  //   2. a blank raster must fail LOUDLY. An SVG inside an <img> is an isolated document, so a
  //      missing stylesheet paints every fill black with no error at all.
  //
  // `assetsBase` is the seam: the wall and the map profile resolve their own base, and this
  // stays ignorant of where a bundle serves its posters from.
  async function printPoster(item) {
    if (busy()) return;
    const kind = 'Poster';
    const base = opts.assetsBase ? opts.assetsBase() : null;
    const id = item?.id ?? item;
    set(item, kind, 'fetch', 'fetching the poster', 25);
    try {
      // An explicit posterUrl still wins — it is how a caller points at a poster that is not
      // <base>/posters/<id>.webp at all.
      const direct = opts.posterUrl ? opts.posterUrl(item) : null;
      let res = null;
      const webp = direct || (base ? `${base}/posters/${id}.webp` : null);
      if (webp) { try { res = await fetch(webp); } catch { /* a miss, see guard 1 */ } }
      if (res && res.ok) { await deliverPoster(await res.blob(), item, kind); return; }
      if (!base) throw new Error('no poster available for this item');
      // NO PRE-RENDERED IMAGE? GENERATE IT. The .webp posters are ~41MB across a tree and are
      // not shipped by default; the HTML is the SOURCE and is smaller than the image it makes.
      set(item, kind, 'render', 'generating the poster', 45);
      const htmlRes = await fetch(`${base}/posters/${id}.html`);
      if (!htmlRes.ok) throw new Error(`poster not found (${htmlRes.status})`);
      const { rasterPoster, looksRendered } = await import('@map/packet/poster-raster.js');
      const blob = await rasterPoster(await htmlRes.text(), { scale: 2 });
      if (!(await looksRendered(blob))) throw new Error('the generated poster rendered blank');
      await deliverPoster(blob, item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  // A 3ft SQUARE on a PORTRAIT sheet must fit by its SHORTER axis: scaling to the full page
  // WIDTH makes it taller than the printable height and it overflows onto a second page.
  // Constrain both axes and let object-fit letterbox it.
  const posterObjectUrls = [];
  async function deliverPoster(blob, item, kind) {
    set(item, kind, 'save', 'opening the print dialog', 80);
    const url = URL.createObjectURL(blob);
    posterObjectUrls.push(url);
    const title = `${opts.downloadPrefix || 'doxa'} — ${label(item)}`;
    openPrintFrame(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
      + '<style>@page{size:letter portrait;margin:12mm}'
      + 'html,body{margin:0;height:100%;background:#fff}'
      + 'body{display:flex;align-items:center;justify-content:center}'
      + 'img{max-width:100%;max-height:100vh;object-fit:contain;display:block}'
      + '@media print{body{height:auto}'
      + 'img{width:auto;max-width:100%;max-height:100%;object-fit:contain}}</style></head>'
      + `<body><img src="${url}" alt="${esc(label(item))}"></body></html>`,
      { autoprint: true },
    );
    done(item, kind);
  }

  // ── 2. THE LIST ───────────────────────────────────────────────────────────
  // The Driver's FIRST option — "that's what the whole app was about": the list
  // itself as a print-paginated table with a prayer checkbox per row.
  async function printList(item, { columns, title } = {}) {
    if (busy()) return;
    const kind = 'List';
    set(item, kind, 'fetch', 'fetching records', 30);
    try {
      const data = await rows(item);
      const cols = columns || [
        { key: 'name', head: 'Name', cls: 'c-name' },
        { key: 'country_code_label', head: 'Country' },
        { key: 'population', head: 'People', cls: 'c-num', num: true },
        { key: 'religion_label', head: 'Religion' },
      ];
      const head = cols.map((c) => `<th>${esc(c.head)}</th>`).join('') + '<th class="c-pray">✓</th>';
      const body = data.map((r) => '<tr>' + cols.map((c) => {
        const raw = r[c.key] ?? r[`${c.key}_label`] ?? '—';
        const v = c.num && Number.isFinite(Number(raw))
          ? Number(raw).toLocaleString(lang()) : raw;
        return `<td${c.cls ? ` class="${c.cls}"` : ''}>${esc(v)}</td>`;
      }).join('') + '<td class="c-pray">□</td></tr>').join('');

      set(item, kind, 'render', `laying out ${data.length} rows`, 70);
      const docTitle = title || `${label(item)} — ${data.length}`;
      openPrintFrame(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title>`
        + '<style>'
        + '@page{size:letter portrait;margin:14mm 12mm}'
        + 'html,body{margin:0;background:#fff;color:#0f1419;'
        + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"
        + '.hd{margin-bottom:14px}.hd h1{margin:0 0 3px;font-size:18px}'
        + '.hd p{margin:0;font-size:11px;color:#5b6672}'
        + 'table{width:100%;border-collapse:collapse;font-size:11px}'
        + 'thead th{text-align:left;border-bottom:2px solid #0f1419;padding:5px 6px;'
        + 'font-size:9.5px;text-transform:uppercase;letter-spacing:.05em}'
        + 'tbody td{padding:5px 6px;border-bottom:1px solid #e3e6ea}'
        + '.c-name{font-weight:600}.c-num{font-variant-numeric:tabular-nums}'
        + '.c-pray{width:26px;text-align:center;font-size:13px}'
        + 'tbody tr{break-inside:avoid}'
        + '</style></head><body>'
        + `<div class="hd"><h1>${esc(docTitle)}</h1>`
        + `<p>${data.length} entries · pray for them by name</p></div>`
        + `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
        + '</body></html>',
        { autoprint: true },
      );
      done(item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  // ── 3. THE CARD DECK ──────────────────────────────────────────────────────
  // One card per PAGE at the chosen stock, so the print dialog shows CARDS rather
  // than letter paper. The geometry lives in the shared card renderer.
  async function printCardDeck(item) {
    if (busy()) return;
    const kind = 'Card Deck';
    set(item, kind, 'fetch', 'fetching records', 30);
    try {
      const data = await rows(item);
      const [{ createCardRenderer }, strings] = await Promise.all([
        import('../packet/card-render.js'),
        opts.strings ? opts.strings() : import('../scripts/posters/packet-strings.json').then((m) => m.default || m),
      ]);
      set(item, kind, 'render', `laying out ${data.length} cards`, 70);
      const R = createCardRenderer({ strings, lang: lang(), stock: stock() });
      openPrintFrame(R.buildDeck(item, data), { autoprint: true });
      done(item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  // ── 4. THE PRAYER PACKET ──────────────────────────────────────────────────
  // The full booklet: map one-pager, people groups 20-per-page with photos, the 12
  // prayer points, the prayer wheel. Shares the renderer with the build-time
  // generator (library/packet/packet-render.js), so a printed packet and a
  // generated one cannot diverge.
  //
  // The MAP PAGE is optional by design: `mapSvg` is supplied by the caller because
  // only the bundle knows where its posters are served from. If it cannot be
  // fetched the packet still prints — a cover without the map beats no packet.
  // `funnel` is the page-2 narrowing data (see packet-render.funnelPage). It is passed THROUGH
  // untouched: this composable does not know how a host defines its lists, and deriving the counts
  // here would make a second source of truth for numbers the Vision Card already publishes.
  // `variant` selects WHICH packet ('full' | 'lightweight' — packet-render's VARIANTS). It defaults
  // to 'full', so every existing caller keeps printing exactly what it prints today.
  // The poster's <svg>, lifted into the packet's map page. Exported-shape helper so the lift is
  // unit-testable against a real generated poster without a fetch.
  function liftPosterSvg(html, R) {
    const svg = String(html).match(/<svg[\s\S]*?<\/svg>/);
    if (!svg) return '';
    return `<style>${R.mapCss(html)}</style>`
      + `<div style="position:absolute;left:0;top:250px;width:${R.W}px;`
      + `transform:scale(0.62);transform-origin:top center">${svg[0]}</div>`;
  }

  async function printPacket(item, { mapSvg = '', funnel = null, variant = 'full' } = {}) {
    if (busy()) return;
    const kind = 'Prayer Packet';
    set(item, kind, 'fetch', 'fetching people groups', 30);
    try {
      const data = await rows(item);
      // `christian` is the flock-wide evangelical share behind the packet's %-evangelical page. The
      // Node generator passes it (packet.mjs reads data/people-groups/christian-share.json); this
      // path did not, so buildPacket's christianPage returned '' and a browser print had one sheet
      // fewer with nothing to say so. Same seam as strings: a host may supply its own figure.
      // `nearTable` feeds the FULL packet's bounded/centered sets page. Same seam as strings and
      // christian: a host that can reach the served asset pool supplies a loader (opts.sets), and a
      // host that cannot simply prints a packet without that page — setsPage's ''-without-data rule.
      // .catch(() => null): the sets page is the one page whose absence must never block a print.
      const [{ createPacketRenderer }, { buildPacketSets }, strings, christian, nearTable] = await Promise.all([
        import('../packet/packet-render.js'),
        import('../packet/packetSets.js'),
        opts.strings ? opts.strings() : import('../scripts/posters/packet-strings.json').then((m) => m.default || m),
        opts.christian ? opts.christian() : import('../../data/people-groups/christian-share.json').then((m) => m.default || m),
        opts.sets ? Promise.resolve().then(() => opts.sets()).catch(() => null) : Promise.resolve(null),
      ]);
      // ★ THE DESCRIBER IS COMPOSED HERE AND INJECTED, because this is the BROWSER path and only it
      // can reach the Vite-only pieces. packet-render.js runs under Node too (the offline generator),
      // where importing describeGroup's country resolver would be fatal — it resolves through the
      // `@map/` alias and imports JSON without an import attribute. So the renderer takes `describe`
      // the same way it takes `strings`, and each host supplies the one it can build.
      // ⚠ Loaded with `.catch(() => null)` rather than awaited unconditionally: a packet that cannot
      // resolve its describer must still PRINT, degrading to the metadata line. The description is
      // the widest column on the page, but it is not worth failing the whole packet for.
      const describe = await Promise.all([
        import('../packets/describeGroup.js').then((m) => m.describeGroup).catch(() => null),
        import('../utils/countryName.js').then((m) => m.countryName || m.default).catch(() => null),
      ]).then(([describeGroup, countryName]) => (describeGroup
        ? (g) => describeGroup(g, lang(), { strings, countryName: countryName || undefined })
        : null));
      const R = createPacketRenderer({ strings, lang: lang(), describe });
      // Photos stay as URLs. The Node generator base64-inlines them so its file is
      // self-contained offline; in a browser the print frame fetches them, and
      // inlining ~95 images client-side would stall the tab for no gain.
      const photos = new Map(
        data.filter((g) => g.image_url).map((g) => [g.slug, g.image_url]),
      );
      set(item, kind, 'render', `printing ${data.length} people groups`, 70);
      // The join runs over the SAME rows the packet prints, so the sets page cannot describe a
      // different population than the profile table beside it.
      // ── DEFAULT SUPPLIERS for hosts that pass nothing — the wall printed a packet MISSING two
      // of its five card pages (no map, no triangle) because only the legend path supplied them.
      // A capability behind an argument nobody passes is a feature that never runs.
      // The funnel default states ONLY the steps: listCount/unassigned stay absent, so funnelPage
      // omits the share line rather than printing a denominator that is wrong under ?list=…
      // (the measured off-by-30 class). Half a fraction is not a fact.
      if (!funnel) {
        funnel = await import('../../data/people-groups/vision-funnel.json')
          .then((m) => { const raw = m.default || m; return raw && Array.isArray(raw.steps) && raw.steps.length ? { steps: raw.steps } : null })
          .catch(() => null);
      }
      // The map default lifts this bundle's own poster — the same file printPoster already reads.
      if (!mapSvg && opts.assetsBase) {
        try {
          const res = await fetch(`${opts.assetsBase()}/posters/${item.id}.html`, { cache: 'force-cache' });
          if (res.ok) mapSvg = liftPosterSvg(await res.text(), R);
        } catch (_) { /* a cover without the map beats no packet */ }
      }
      const sets = nearTable ? buildPacketSets(data, nearTable) : null;
      openPrintFrame(R.buildPacket(item, data, photos, mapSvg, funnel, christian, variant, sets), { autoprint: true });
      done(item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  return { exportState, dismiss, printPoster, printList, printCardDeck, printPacket };
}
