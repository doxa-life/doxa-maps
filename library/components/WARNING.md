# ⚠️ Read before you touch these components

**These are the SHARED, REUSABLE components — every map in `plugin-designs/` depends on them.**

A change here does not affect one map. It ripples to **all** of them. So:

- **Prototyping or experimenting? Don't edit these.** Put your custom, one-off, not-yet-proven component
  inside your own map's folder (`plugin-designs/<your-map>/`), where it can be as messy as you need and
  breaks nothing else.
- **Only proven, parameterized, reusable components graduate into this library.** If a component has hard-coded
  values, assumptions about one specific map, or hasn't been used by more than one map yet — it is **not**
  ready to live here.
- **A reusable component takes props, not assumptions.** Before you move something in, make it parameterized:
  the map, the legend, the controls, the search bar all take configuration — yours should too.
- **If you must change a shared component, check every map that uses it.** Run `bun run dev` and click through
  the maps before you commit. The whole point of this library is that maps *don't* have to be rewritten —
  don't undo that by breaking the shared pieces.

Rule of thumb: **custom code in your app-profile, reusable code in the library — and things only move from the
first to the second once they've earned it.**
