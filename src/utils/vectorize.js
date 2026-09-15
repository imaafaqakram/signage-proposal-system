/**
 * Vectorize a single sign image on demand — turns whichever mockup a client actually
 * approved into a production-ready SVG outline, instead of vectorizing every mockup on a
 * proposal. Uses imagetracerjs (Unlicense/public domain, pure JS, no WASM/build step)
 * entirely client-side — no server call, no per-image cost.
 *
 * WHY A SILHOUETTE AND NOT A FULL-COLOR TRACE:
 * These mockups are photorealistic storefront renders — brick, lighting, shadows, glow.
 * Tracing all of that in color produces a posterized photo: hard color bands and ragged
 * blob edges around every lit patch of wall. It looks pixelated because it effectively is
 * — a photo chopped into flat color regions, not artwork. Verified directly against a real
 * mockup: every colour-count/blur/smoothing combination traded background noise for lost
 * letter detail and none of them looked like something you'd send a fabricator.
 *
 * What production actually needs is the letterforms — so we threshold the image to a clean
 * two-tone mask first (letters vs. everything else), then trace THAT at high fidelity.
 * With only two colours there is no noise to suppress, so the curve-fitting can run tight
 * (ltres/qtres 0.1) and the letters come out as smooth, solid, cuttable outlines.
 *
 * The right cutoff is image-dependent (a lit sign at night thresholds differently from
 * dark letters on a pale wall), so `computeOtsuThreshold` picks a sensible starting point
 * and the UI lets the operator nudge it — plus invert, for dark-on-light signs.
 */
import ImageTracer from 'imagetracerjs'

/**
 * Crops+zooms a full mockup down to exactly what the adjuster currently shows for one
 * image — the same object-fit(contain/cover) + scale + translate math the PDF export uses
 * to bake a live-adjusted image, reused here for a different reason: a single luminance
 * threshold can't cleanly separate letters from wall on a whole unevenly-lit storefront
 * scene (verified directly — the wall right under the lights is nearly as bright as the
 * letters, so no cutoff isolates one from the other). Crop tight to just the sign first
 * (the same zoom/pan the operator already uses to frame the PDF) and the remaining patch
 * is lit far more evenly, so a plain threshold actually separates letters from background.
 * @param {HTMLImageElement} imgEl - the live, on-screen <img> for this asset
 * @returns {string} a data: URL of just the cropped/zoomed view
 */
export function cropAssetView(imgEl) {
  const style = window.getComputedStyle(imgEl)
  const containerW = parseFloat(style.width)
  const containerH = parseFloat(style.height)
  const natW = imgEl.naturalWidth || containerW
  const natH = imgEl.naturalHeight || containerH
  if (!containerW || !containerH || !natW || !natH) return imgEl.src

  const objectFit = style.objectFit === 'cover' ? 'cover' : 'contain'
  const transformStr = imgEl.style.transform || ''
  let zoom = 1
  let panX = 0
  let panY = 0
  const scaleMatch = transformStr.match(/scale\(([\d.]+)\)/)
  const translateMatch = transformStr.match(/translate\(([\d.-]+)px,\s*([\d.-]+)px\)/)
  if (scaleMatch) zoom = parseFloat(scaleMatch[1])
  if (translateMatch) {
    panX = parseFloat(translateMatch[1])
    panY = parseFloat(translateMatch[2])
  }

  const containerRatio = containerW / containerH
  const imageRatio = natW / natH
  let drawW
  let drawH
  if (objectFit === 'contain') {
    if (imageRatio > containerRatio) { drawW = containerW; drawH = containerW / imageRatio }
    else { drawH = containerH; drawW = containerH * imageRatio }
  } else {
    if (imageRatio > containerRatio) { drawH = containerH; drawW = containerH * imageRatio }
    else { drawW = containerW; drawH = containerW / imageRatio }
  }

  const scaledDrawW = drawW * zoom
  const scaledDrawH = drawH * zoom
  const drawX = (containerW - scaledDrawW) / 2 + panX * zoom
  const drawY = (containerH - scaledDrawH) / 2 + panY * zoom

  // Render at a few times the on-screen container size, not 1:1 CSS pixels, so the crop
  // stays sharp enough to trace even though the live preview box is small.
  const outScale = Math.max(2, Math.min(6, natW / containerW))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(containerW * outScale)
  canvas.height = Math.round(containerH * outScale)
  const ctx = canvas.getContext('2d')
  ctx.scale(outScale, outScale)
  ctx.drawImage(imgEl, drawX, drawY, scaledDrawW, scaledDrawH)
  return canvas.toDataURL('image/png')
}

/** Trace settings for a already-binarized (two-tone) image — tight curve fitting. */
export const SILHOUETTE_OPTIONS = {
  numberofcolors: 2,
  colorsampling: 0,
  blurradius: 0,
  pathomit: 12,
  ltres: 0.1,
  qtres: 0.1,
  strokewidth: 0
}

/** Loads an image source (data: URI or URL) into an HTMLImageElement. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the image'))
    img.src = src
  })
}

/** Grabs raw pixels from a loaded image. */
export function getImageData(img) {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * A single global cutoff (Otsu or otherwise) turned out not to work on these mockups —
 * verified directly on a real dramatically-lit sign: the wall brightness varies enough
 * across the frame (each letter sitting under its own light fixture, some in the direct
 * beam, some between fixtures) that letters on the dim side of the image and wall on the
 * bright side land on the SAME side of any single cutoff. No global number separates them.
 *
 * Adaptive (local-mean) thresholding fixes this by comparing each pixel to the average
 * brightness of its OWN neighborhood rather than to the whole image — a letter is still
 * reliably brighter than the wall immediately behind it, even when that wall's absolute
 * brightness is totally different on the left of the sign vs. the right. Computed via an
 * integral image (summed-area table) so the local average at every pixel is O(1) regardless
 * of window size, instead of re-summing a window per pixel.
 */
function buildIntegral(lum, w, h) {
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += lum[y * w + x]
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum
    }
  }
  return integral
}

function boxMean(integral, w, h, cx, cy, radius) {
  const x0 = Math.max(0, cx - radius)
  const x1 = Math.min(w - 1, cx + radius)
  const y0 = Math.max(0, cy - radius)
  const y1 = Math.min(h - 1, cy + radius)
  const A = integral[y0 * (w + 1) + x0]
  const B = integral[y0 * (w + 1) + (x1 + 1)]
  const C = integral[(y1 + 1) * (w + 1) + x0]
  const D = integral[(y1 + 1) * (w + 1) + (x1 + 1)]
  const area = (x1 - x0 + 1) * (y1 - y0 + 1)
  return (D - B - C + A) / area
}

/** A window a bit wider than typical letter-stroke spacing, scaled to the image itself. */
export function defaultAdaptiveRadius(width, height) {
  return Math.round(Math.max(8, Math.min(60, Math.min(width, height) * 0.08)))
}

export const DEFAULT_SENSITIVITY = 18

/**
 * Flattens an image to two tones: a pixel becomes solid "shape" when it's `sensitivity`
 * luminance levels brighter (or, inverted, darker) than the local average around it —
 * not brighter than the image as a whole. `radius` sets how local "local" is; roughly
 * letter-spacing-sized is the sweet spot (too small and stroke interiors get eaten, too
 * large and it degrades toward a single global threshold).
 */
export function adaptiveBinarize(imageData, sensitivity, invert = false, radius = null) {
  const { width, height, data } = imageData
  const r = radius || defaultAdaptiveRadius(width, height)
  const lum = new Float64Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  const integral = buildIntegral(lum, width, height)
  const out = new ImageData(new Uint8ClampedArray(data), width, height)
  const od = out.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const diff = lum[p] - boxMean(integral, width, height, x, y, r)
      const isShape = invert ? diff < -sensitivity : diff > sensitivity
      const v = isShape ? 0 : 255
      const i = p * 4
      od[i] = od[i + 1] = od[i + 2] = v
      od[i + 3] = 255
    }
  }
  return out
}

/**
 * imagetracerjs emits width/height attributes but no viewBox, so a viewer that scales the
 * element by CSS (width:100%) clips instead of scaling. Adding one here makes every preview
 * that embeds this SVG behave like any other responsive image, without changing the file a
 * production shop would open in Illustrator (width/height stay exactly as traced).
 */
export function addViewBox(svgString) {
  if (/viewBox=/.test(svgString)) return svgString
  const w = svgString.match(/width="([\d.]+)"/)?.[1]
  const h = svgString.match(/height="([\d.]+)"/)?.[1]
  if (!w || !h) return svgString
  return svgString.replace('<svg ', `<svg viewBox="0 0 ${w} ${h}" `)
}

/** Full pipeline: source image -> two-tone mask -> traced SVG string. */
export async function vectorizeSilhouette(src, { sensitivity = DEFAULT_SENSITIVITY, invert = false } = {}) {
  if (!src) throw new Error('No image to vectorize')
  const img = await loadImage(src)
  const imageData = getImageData(img)
  const mask = adaptiveBinarize(imageData, sensitivity, invert)
  return {
    svg: addViewBox(ImageTracer.imagedataToSVG(mask, SILHOUETTE_OPTIONS))
  }
}

/** Triggers a real browser download of the given SVG string. */
export function downloadSVG(svgString, filename) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Builds a safe, readable filename from client name + image label. */
export function vectorFilename(clientName, label) {
  const safe = (s) => (s || '').toString().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const namePart = safe(clientName) || 'sign'
  const labelPart = safe(label) || 'image'
  return `${namePart}_${labelPart}_vector.svg`
}
