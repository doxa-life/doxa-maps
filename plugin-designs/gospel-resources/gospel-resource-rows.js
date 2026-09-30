/**
 * ═══ WHAT COUNTS AS SCRIPTURE SOMEONE CAN READ — ONE DEFINITION ═══════════════════════════════
 * Exported because it had been written FOUR times: in the pin builder's tier function (as `!!c.s`,
 * which is why 2,001 groups were mis-tiered), in that builder's hasReadableScripture (correctly),
 * in check-gospel-coverage-consistent's arm F (narrowly, so it then disagreed with the fix), and
 * implicitly in resourceRows below. A rule with four copies has no owner. This is the owner.
 *
 * Text lives in four places: an eBible/PNG scripture URL, Scripture Earth, a Door43 translation
 * that is not Open Bible Stories, and — the one that was being missed — a Faith Comes By Hearing
 * record whose media list names text.
 */
export const hasReadableScripture = (c) =>
  !!c && (!!c.s || !!c.se || !!(c.au && /text/.test(c.au.m || '')) ||
    (c.d || []).some((d) => !/^Open Bible Stories/.test(d.s || '')))

/**
 * gospel-resource-rows.js — what a language's codes[] entry offers, in ONE place.
 *
 * PRIVATE TO THIS PLUGIN, deliberately. Nothing outside gospel-resources has a codes[]
 * entry, so this is not a shared component and does not belong in library/ — putting it
 * there would publish a signature only one bundle can call and invite a second consumer to
 * bend it.
 *
 * WHY IT EXISTS. Each surface used to list the resource fields for itself. The map grew
 * chips per type, the charts computed "has nothing" by hand, and the list built its links
 * from `c.s` and `c.d` only. So every new source had to be added in four places, and it
 * never was: when Scripture Earth and GRN landed, the list profile showed neither — a
 * language whose ONLY resource was a Words of Life recording rendered with no links at all,
 * while the map offered a working one for the same language. The charts had the same drift
 * and it took a hand count to find. The fix that lasts is not remembering harder.
 *
 * This mirrors scripts/build-resource-links-table.mjs, which types the shipped table. The
 * two must agree, because one is what the table says and the other is what the page shows,
 * and a reader comparing them is entitled to see the same answer. Types are kept honest in
 * the same way the table keeps them:
 *   - Open Bible Stories is Bible Stories, never Scripture — 50 illustrated narratives are
 *     not a translation.
 *   - Words of Life is Gospel audio, never Scripture — gospel messages with songs.
 *   - Zume is Discipleship training, a course.
 *   - A bible.is fileset is typed by what it actually carries, not by assumption.
 */

/** Scripture Earth directory names, as a reader would say them. */
const SE_KIND = { PDF: 'PDF', audio: 'audio', sab: 'app', study: 'study notes', viewer: 'read online' }

/**
 * Every resource a language offers, flattened for a list or a table.
 * @param {object} c  one entry of the pin index's codes[]
 * @returns {{url:string,title:string,type:string,scope:string}[]}
 */
export function resourceRows(c) {
  if (!c) return []
  const out = []
  const add = (title, type, url, scope = '') => {
    if (url) out.push({ url, title, type, scope })
  }

  add(c.sv || 'Scripture in this language', 'Scripture', c.s, c.ss || '')
  /* c.fT is set only where the JESUS Film component does NOT carry this language and a
     different JESUS Film Project feature does — The Savior, Magdalena. Calling that "JESUS
     Film" would be the same class of lie as calling Open Bible Stories Scripture. */
  add(c.fT || 'JESUS Film', 'Film', c.f)
  for (const d of c.d || []) {
    add(d.s, /^Open Bible Stories/.test(d.s) ? 'Bible Stories' : 'Scripture', d.u, d.sc || '')
  }
  if (c.au) {
    const media = String(c.au.m || 'audio')
    add(
      c.au.n || 'Scripture',
      /* ⚠ ONE RECORD, TWO CAPABILITIES, AND THE TYPE ONLY SAID ONE. Faith Comes By Hearing's media
         list is often "audio, text, video": this typed every such row 'Audio Scripture', so the
         access table's byType.Scripture never saw it and 2,001 people groups were published as
         "watch or hear, cannot read" while their own readable text sat behind that link. TEXT
         decides the type; the media list stays in the scope so nothing is hidden, and the access
         builder counts a Scripture row whose scope names audio as hearable too. */
      /text/.test(media) ? 'Scripture' : 'Audio Scripture',
      c.au.u,
      media === 'audio' ? 'Listen in a browser' : `In a browser — ${media}`,
    )
  }
  if (c.bv) add(c.bv.n || 'Bible video', 'Bible video', c.bv.u, c.bv.sc || '')
  if (c.gp) add(c.gp.n || 'Gospel presentation', 'Gospel presentation', c.gp.u, 'Read in this language')
  if (c.se) {
    add('Scripture Earth', 'Scripture', c.se.u, (c.se.k || []).map((k) => SE_KIND[k] || k).join(', '))
  }
  if (c.ga) {
    add(c.ga.n ? `Words of Life — ${c.ga.n}` : 'Gospel audio', 'Gospel audio', c.ga.u, 'Listen in this language')
  }
  add('Zume discipleship training', 'Discipleship training', c.z)
  return out
}
