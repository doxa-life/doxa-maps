/**
 * pane-wrapper — the MFE pane GRID, a layout nested inside app-wrapper-material.
 *
 * WHAT IT IS
 * `app-wrapper-material` owns the chrome (header, side menu, the View fieldset).
 * This layout owns the STAGE INSIDE it: a parameterized grid of panes, each pane
 * holding a different app-profile MFE that is another VIEW of the same subject.
 * `my-upg-100-list` is a family — a map view and a poster-wall view — not one app
 * with tabs. Together the two layouts form the app harness that displays the
 * custom elements shipped in the vite bundles.
 *
 * THE MOTION CONTRACT (the design decision everything else follows from)
 *   • VERTICAL neighbours are ONE SCROLLABLE PAGE. Both panes are live; you scroll
 *     between them. The edge strips (useEdgeScrollAffordance) are what let you
 *     escape a scroll-capturing child like a Mapbox canvas.
 *   • HORIZONTAL movement is a FLY-TO. The target column is NOT loaded until you
 *     go there, and the origin column is released on arrival.
 * So AT MOST TWO PANES ARE EVER ALIVE. That is not an arbitrary cap — it is what
 * preserves the ~16-WebGL-context budget the wrapper's teardown has always
 * protected. A naive "keep all four panes mounted" grid would break on a phone.
 *
 * WHY A COLUMN IS ONE SCROLLING PAGE RATHER THAN TWO SWAPPED VIEWS
 * A pane you scroll to keeps its sibling on screen during the transition, so the
 * relationship between the views stays legible ("the list is UNDER the map"). A
 * swap teaches nothing.
 *
 * 2×2 IS A DEFAULT, NOT A CEILING. Panes carry [row, col] coordinates rather than
 * a fixed enum, so the grid expands (2×3, 3×3 …) and contracts (a single column,
 * or one pane) from the same code. A profile with no `panes` key behaves exactly
 * as before this layout existed.
 *
 * AR is the reason the grid exists at all: today you see one pane (or one
 * scrolling column), but the coordinates mean a future AR client can zoom out and
 * see every pane laid out like posters on a wall.
 */

export const PANE_GRID_STYLES = `
/* The column that scrolls. Vertical neighbours stack here and the user scrolls
   between them; scroll-snap makes each pane settle cleanly instead of stopping
   half-way between two views. */
.pane-col{
  position:absolute; inset:0; overflow-y:auto; overflow-x:hidden;
  scroll-snap-type:y mandatory; scroll-behavior:smooth;
  -webkit-overflow-scrolling:touch;
  /* DOUBLE SCROLLBAR FIX. A pane's own content (e.g. the poster wall) scrolls
     inside the pane; this column only scrolls BETWEEN panes. With both visible
     the desktop showed two bars side by side. The column's bar is hidden — pane
     navigation is driven by the View switcher and scroll-snap, not by dragging a
     bar — while the inner content keeps its own, which is the one a user wants.
     Scrolling still works here; only the indicator is suppressed. */
  scrollbar-width:none;            /* Firefox */
  -ms-overflow-style:none;         /* legacy Edge */
}
.pane-col::-webkit-scrollbar{ width:0; height:0; }  /* WebKit/Blink */
/* Each pane fills the stage exactly, so "scroll down" moves you one full view. */
.pane{
  position:relative; width:100%; height:100%;
  scroll-snap-align:start; scroll-snap-stop:always;
}
/* The live custom element fills its pane. */
.pane > .pane-mount{ position:absolute; inset:0; }
/* Placeholder copy for a pane whose profile is not built yet — same card styling
   as the wrapper's own placeholder so an unbuilt pane never looks broken. */
.pane-placeholder{
  position:absolute; inset:0; display:grid; place-items:center; padding:24px;
  text-align:center;
}
.pane-placeholder .pane-card{
  max-width:520px; background:var(--card,#fff); border-radius:14px; padding:22px 26px;
  box-shadow:0 1px 3px rgba(0,0,0,.12),0 6px 20px rgba(0,0,0,.08);
}
.pane-placeholder h2{ margin:0 0 8px; font-size:18px; font-weight:600 }
.pane-placeholder p{ margin:0; font-size:13px; line-height:1.55; opacity:.78 }
/* A small persistent hint that there IS something below — the affordance the
   edge strips reinforce once you start interacting. Hidden on the last pane. */
.pane-more{
  position:absolute; left:50%; bottom:10px; transform:translateX(-50%);
  display:flex; align-items:center; gap:6px; padding:5px 12px; border-radius:999px;
  background:rgba(0,0,0,.55); color:#fff; font-size:11px; letter-spacing:.02em;
  pointer-events:none; z-index:6; opacity:.9;
}
`

/**
 * Build the pane column for a profile.
 *
 * @param {Object} spec                 the PROFILES registry entry
 * @param {Object} opts
 * @param {HTMLElement} opts.host       container to render into (the wrapper's #slot)
 * @param {(pane:Object, mountEl:HTMLElement) => Promise<void>} opts.mountPane
 *        called for each pane that should be LIVE; the caller owns element creation
 *        so this layout never needs to know about bundles, tags or tokens.
 * @returns {{ panes:Object[], scrollTo:(paneId:string)=>void, destroy:()=>void }}
 */
export function buildPaneColumn(spec, { host, mountPane }) {
  const panes = Array.isArray(spec?.panes) ? spec.panes : []
  // No pane declaration → not a pane profile. The caller falls back to its
  // original single-mount path, so nothing changes for existing profiles.
  if (panes.length < 2) return null

  // v1 renders ONE COLUMN (col 0). Other columns are reachable by fly-to, which is
  // a later slice — but the coordinates are already carried on every pane, so that
  // work does not require reshaping this data.
  const column = panes
    .filter(p => (p.at?.[1] ?? 0) === 0)
    .sort((a, b) => (a.at?.[0] ?? 0) - (b.at?.[0] ?? 0))

  if (column.length < 2) return null

  const col = document.createElement('div')
  col.className = 'pane-col'

  const mounts = new Map()
  column.forEach((pane, i) => {
    const el = document.createElement('div')
    el.className = 'pane'
    el.dataset.paneId = pane.id
    const mount = document.createElement('div')
    mount.className = 'pane-mount'
    el.appendChild(mount)
    mounts.set(pane.id, mount)

    // A pane with no bundle yet still renders — as a labelled placeholder, so the
    // column is scrollable and testable before every view profile exists.
    if (pane.placeholder) {
      const ph = document.createElement('div')
      ph.className = 'pane-placeholder'
      ph.innerHTML = `<div class="pane-card"><h2>${pane.label}</h2><p>${pane.placeholder}</p></div>`
      el.appendChild(ph)
    }

    // "scroll for more" hint on every pane except the last.
    // OPT-OUT per profile via `paneHint: false` in the PROFILES registry entry.
    // The header already carries a Map | Posters view switcher, so on a profile
    // where that is visible this pill is a second, redundant control that just
    // sits on top of the map. Left ON by default so existing profiles are
    // unchanged. (design note 2026-08-01: "component that says posters below should
    // not exist.")
    if (i < column.length - 1 && spec?.paneHint !== false) {
      const more = document.createElement('div')
      more.className = 'pane-more'
      more.innerHTML = `<span>${column[i + 1].label} below</span><span aria-hidden="true">↓</span>`
      el.appendChild(more)
    }

    col.appendChild(el)
  })

  host.appendChild(col)

  return {
    panes: column,
    /** Animate to a pane by id — this is what the View fieldset tabs call. */
    scrollTo(paneId) {
      const target = col.querySelector(`.pane[data-pane-id="${paneId}"]`)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    /** Which pane is currently filling the viewport (for URL sync). */
    current() {
      const tops = column.map(p => {
        const el = col.querySelector(`.pane[data-pane-id="${p.id}"]`)
        return { id: p.id, d: Math.abs((el?.offsetTop ?? 0) - col.scrollTop) }
      })
      tops.sort((a, b) => a.d - b.d)
      return tops[0]?.id || column[0].id
    },
    onScroll(cb) {
      let t = null
      const h = () => { if (t) clearTimeout(t); t = setTimeout(cb, 120) }
      col.addEventListener('scroll', h, { passive: true })
      return () => { if (t) clearTimeout(t); col.removeEventListener('scroll', h) }
    },
    mountEl: (paneId) => mounts.get(paneId) || null,
    destroy() { col.remove(); mounts.clear() },
  }
}
