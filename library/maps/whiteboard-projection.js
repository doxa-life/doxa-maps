/**
 * whiteboard-projection.js — abstract chart coordinates onto a map, undistorted.
 *
 * A whiteboard chart is laid out in its OWN units (the language tree in layout units, gospel's
 * centered set in ring radii) and then drawn by a map engine, which reads coordinates as lng/lat and
 * renders them through Web Mercator. This converts the one into the other.
 *
 * ★ IT IS NOT A SCALE FACTOR, AND THAT IS THE WHOLE REASON IT IS A MODULE. Mercator stretches
 * vertically by 1/cos(latitude), so a drawing mapped LINEARLY into degrees is rendered progressively
 * taller the further it sits from the equator: 1.0154x at 10 degrees, 1.0642x at 20, 1.1547x at 30.
 * A circle becomes an oval, and worse at the edges than the middle. This applies the INVERSE of
 * Mercator, so the degree-height it emits shrinks by exactly the amount the renderer will add back.
 * MEASURED on a unit circle at increasing distance from centre (height as a fraction of width):
 * 0.9996 at the centre, 0.9729, 0.8993, 0.7953, and 0.6794 at the outer edge — those numbers ARE the
 * correction, not an error in it, and they are what make the circle round on screen.
 *
 * ★ EXTRACTED, NOT WRITTEN. This was private inside library/scripts/build-language-tree.mjs and would
 * have been copied the moment a second chart needed it — gospel's set charts were about to scale
 * linearly by one number, which renders concentric rings as ovals, worst at the outer ring where the
 * labels are. One rule, one place, before there are two copies rather than after.
 */

/**
 * How much of the Mercator square the drawing spans, per unit of its own extent.
 * ★ extentFraction DECIDES HOW FAR A READER CAN ZOOM OUT, which is why it is a parameter with a
 * measured default rather than a constant. The engines stop at zoom 0 (the whole square), so the
 * SMALLER the drawing, the more room there is below its opening view. At 0.68 there was about one
 * level of room to zoom further out; at 0.17 there are two.
 */
export function whiteboardScale(extent, extentFraction = 0.17) {
  return extentFraction / (extent || 1)
}

/**
 * @param {Object} o
 * @param {number} o.extent           the drawing's half-extent in its OWN units (its outermost point)
 * @param {number} [o.extentFraction] share of the Mercator square to span; see above
 * @returns {function(number, number): [number, number]} (u, v) -> [lng, lat], with `.K` (the scale)
 *          exposed because a caller that also sizes RADII in degrees needs the same factor.
 */
export function whiteboardProjection({ extent, extentFraction = 0.17 } = {}) {
  const K = whiteboardScale(extent, extentFraction)
  const project = (u, v) => {
    const X = 0.5 + u * K, Y = 0.5 - v * K
    const lng = (X - 0.5) * 360
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI
    return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
  }
  project.K = K
  return project
}

export default whiteboardProjection
