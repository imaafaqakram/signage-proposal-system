// Matches a sign's extracted signType (and illuminated flag) against a fixed library of
// cross-section construction diagrams, one per sign style. The library is a set of static
// files (public/cross-sections/) rather than embedded data — these are shared, reusable
// diagrams, not proposal-specific content, so there's no reason to bloat every fetched
// lead's stored JSON with a copy of the same image.
//
// signType text comes from freeform PDF/AI extraction, so it varies in phrasing
// ("Acrylic Front-lit" vs "Front Lit Channel Letters") - matching is keyword-overlap
// based, not exact string comparison. illuminated breaks ties between a style's lit/
// non-lit variants when the signType text itself doesn't say which.

const LIBRARY = [
  { file: '2d-metal-letters.png', keywords: ['2d', 'metal', 'letters'] },
  { file: '2d-metal-sign.png', keywords: ['2d', 'metal', 'sign'] },
  { file: '3d-blade-sign-double-lit.png', keywords: ['3d', 'blade', 'sign', 'double', 'lit'], illuminated: true },
  { file: '3d-blade-sign-double-sided-non-lit.png', keywords: ['3d', 'blade', 'sign', 'double', 'sided', 'non', 'lit'], illuminated: false },
  { file: '3d-metal-non-lit.png', keywords: ['3d', 'metal', 'non', 'lit'], illuminated: false },
  { file: 'acrylic-double-lit-dual-chains.png', keywords: ['acrylic', 'double', 'lit', 'dual', 'chains'], illuminated: true },
  { file: 'acrylic-double-lit-single-chain.png', keywords: ['acrylic', 'double', 'lit', 'single', 'chain'], illuminated: true },
  { file: 'acrylic-non-lit.png', keywords: ['acrylic', 'non', 'lit'], illuminated: false },
  { file: 'acrylic-panel.png', keywords: ['acrylic', 'panel', 'letters'], illuminated: false },
  { file: 'blade-sign.png', keywords: ['blade', 'sign'], illuminated: true },
  { file: 'blade-sign-non-lit.png', keywords: ['blade', 'sign', 'non', 'lit'], illuminated: false },
  { file: 'double-lit.png', keywords: ['double', 'lit'], illuminated: true },
  { file: 'front-lit-channel-letters.png', keywords: ['front', 'lit', 'frontlit', 'channel', 'letters', 'acrylic'], illuminated: true },
  { file: 'lightbox-double-sided.png', keywords: ['lightbox', 'double', 'sided', 'light', 'box'] },
  { file: 'lightbox-single-sided.png', keywords: ['lightbox', 'single', 'sided', 'light', 'box'] },
  { file: 'metal-back-lit.png', keywords: ['metal', 'back', 'lit', 'backlit'], illuminated: true },
  { file: 'neon-acrylic-sign.png', keywords: ['neon', 'acrylic', 'sign'], illuminated: true },
  { file: 'neon-sign.png', keywords: ['neon', 'sign'], illuminated: true },
  { file: 'push-thru-acrylic-sign.png', keywords: ['push', 'thru', 'through', 'acrylic', 'sign'] },
  { file: 'raceway-front-lit.png', keywords: ['raceway', 'race', 'way', 'front', 'lit', 'frontlit'], illuminated: true },
  { file: 'raceway-metal-back-lit.png', keywords: ['raceway', 'race', 'way', 'metal', 'back', 'lit', 'backlit'], illuminated: true }
]

const tokenize = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)

/**
 * Returns the best-matching cross-section image path for a sign, or null if nothing
 * scores confidently enough — callers should leave the slot empty rather than apply a
 * low-confidence guess to a real customer-facing proposal.
 */
export function matchCrossSection(signType, illuminated) {
  const words = tokenize(signType)
  if (words.length === 0) return null

  const illuminatedBool = typeof illuminated === 'boolean'
    ? illuminated
    : /^y/i.test(illuminated || '') ? true : /^n/i.test(illuminated || '') ? false : null

  const wordSet = new Set(words)
  let best = null
  let bestScore = 0
  for (const entry of LIBRARY) {
    const overlap = entry.keywords.filter((k) => wordSet.has(k)).length
    if (overlap === 0) continue
    // Blend of recall (how much of the SEARCH text this candidate accounts for) and
    // precision (how much of the CANDIDATE's keyword list is actually relevant here).
    // Recall-only let a plain "Blade Sign" tie against "3d-blade-sign-double-lit" (same
    // overlap, extra unmentioned concepts ignored). Precision-only (plain Jaccard)
    // over-penalized entries that need a longer keyword list for legitimate synonym
    // coverage (e.g. "raceway"+"race"+"way"+"frontlit" all on one entry), pushing a
    // clean match like "Raceway Frontlit" below the confidence threshold. Weighting
    // recall higher fixes both: a full explanation of the search text wins, with
    // precision only separating candidates that explain it equally well.
    const recall = overlap / words.length
    const precision = overlap / entry.keywords.length
    let score = recall * 0.7 + precision * 0.3
    if (illuminatedBool !== null && typeof entry.illuminated === 'boolean') {
      // A soft nudge for close calls only - the sign type's own wording (often
      // literally saying "lit"/"non-lit") is the more direct, primary signal and
      // shouldn't be overridden by this secondary field.
      score += entry.illuminated === illuminatedBool ? 0.05 : -0.08
    }
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  // Require the search text to be substantially accounted for, not just one incidental
  // shared word (e.g. "sign" alone matching everything) - below this the match is
  // coincidence, not confidence.
  if (!best || bestScore < 0.55) return null
  return `/cross-sections/${best.file}`
}
