/**
 * PDF Generator - Professional Quality with Page Size Options
 * Uses jsPDF + html2canvas for proper proposal page capture
 */

import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { showToast, showLoading, hideLoading } from './toast'

// Page size definitions in mm
export const PAGE_SIZES = {
  letter: { width: 215.9, height: 279.4, name: 'Letter', displayName: 'Letter (8.5" × 11")' },
  legal: { width: 215.9, height: 355.6, name: 'Legal', displayName: 'Legal (8.5" × 14")' },
  a4: { width: 210, height: 297, name: 'A4', displayName: 'A4 (210 × 297 mm)' },
  a3: { width: 297, height: 420, name: 'A3', displayName: 'A3 (297 × 420 mm)' }
}

/**
 * Get CSS dimensions for preview based on page size
 */
export const getPagePreviewDimensions = (pageSize = 'letter') => {
  const size = PAGE_SIZES[pageSize] || PAGE_SIZES.letter
  const baseWidth = 794 // Base width in pixels for A4-ish size
  const aspectRatio = size.height / size.width
  return {
    width: baseWidth,
    height: Math.round(baseWidth * aspectRatio),
    aspectRatio,
    cssWidth: `${baseWidth}px`,
    cssHeight: `${Math.round(baseWidth * aspectRatio)}px`
  }
}

/**
 * Generate PDF from proposal pages
 * @param {Object} options - Generation options
 * @param {string} options.clientName - Client name for filename
 * @param {string} options.pageSize - Page size key (letter, legal, a4, a3)
 * @param {Function} options.onProgress - Progress callback
 */
export const generateProposalPDF = async (options = {}) => {
  const {
    clientName = 'Proposal',
    pageSize = 'letter',
    onProgress = null,
    returnBlob = false // NEW: Option to return blob instead of saving
  } = options

  const size = PAGE_SIZES[pageSize] || PAGE_SIZES.letter
  const loadingId = showLoading('Generating PDF...')
  document.body.classList.add('is-generating-pdf') // FORCE PRINT MODE

  try {
    // Find all proposal pages (exclude UI elements)
    const proposalPages = document.querySelectorAll('.proposal-page')

    if (!proposalPages.length) {
      hideLoading(loadingId)
      showToast('No proposal pages found!', 'error')
      return null
    }

    if (onProgress) {
      onProgress({
        current: 0,
        total: proposalPages.length,
        percentage: 0,
        message: `Preparing ${proposalPages.length} page(s)...`
      })
    }

    // Create PDF — initial orientation will be set per first page
    // We'll delete the first blank page and add pages dynamically
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [size.width, size.height]
    })

    // Temporarily hide no-print elements
    const noPrintElements = document.querySelectorAll('.no-print, .sidebar, .ai-panel, .editor-sidebar, [class*="sidebar"], .ai-toggle-button')
    noPrintElements.forEach(el => {
      el.dataset.originalDisplay = el.style.display
      el.style.display = 'none'
    })

    // Process each proposal page
    for (let i = 0; i < proposalPages.length; i++) {
      const page = proposalPages[i]

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: proposalPages.length,
          percentage: Math.round(((i + 0.5) / proposalPages.length) * 100),
          message: `Capturing page ${i + 1} of ${proposalPages.length}...`
        })
      }

      // Get computed background color from the page
      const computedStyle = window.getComputedStyle(page)
      let bgColor = computedStyle.backgroundColor

      // If transparent or rgba with 0 alpha, use a dark background
      if (bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)' || bgColor.includes('rgba(0, 0, 0, 0)')) {
        bgColor = '#0B1120' // Default dark page background
      }

      // FIX: Patch createPattern to prevent html2canvas crash on zero-dimension canvas
      const _origCreatePattern = CanvasRenderingContext2D.prototype.createPattern
      CanvasRenderingContext2D.prototype.createPattern = function (image, repetition) {
        if (image && (image.width === 0 || image.height === 0)) {
          return null
        }
        return _origCreatePattern.call(this, image, repetition)
      }

      // Capture page at high resolution with proper background
      const canvas = await html2canvas(page, {
        scale: 2, // 2x resolution for quality
        useCORS: true,
        allowTaint: true,
        backgroundColor: bgColor, // Use computed or default background
        logging: false,
        width: page.offsetWidth,
        height: page.offsetHeight,
        onclone: async (clonedDoc, clonedEl) => {
          // Ensure the cloned element has proper dimensions
          clonedEl.style.width = page.offsetWidth + 'px'
          clonedEl.style.height = page.offsetHeight + 'px'

          // FIX: Replace inputs with spans to fix PDF text alignment
          // html2canvas often renders inputs with incorrect vertical alignment
          const originalInputs = page.querySelectorAll('input')
          const clonedInputs = clonedEl.querySelectorAll('input')

          originalInputs.forEach((originalInput, index) => {
            const clonedInput = clonedInputs[index]
            if (!clonedInput) return

            const style = window.getComputedStyle(originalInput)
            const span = clonedDoc.createElement('span')

            span.innerText = originalInput.value || originalInput.placeholder || ''

            // Copy typography
            span.style.fontFamily = style.fontFamily
            span.style.fontSize = style.fontSize
            span.style.fontWeight = style.fontWeight
            span.style.color = style.color
            span.style.letterSpacing = style.letterSpacing
            span.style.textTransform = style.textTransform

            // Layout - use inline-flex to respect surrounding layout
            span.style.display = 'inline-flex'
            span.style.alignItems = 'center'
            span.style.width = style.width
            span.style.height = style.height
            span.style.padding = style.padding
            span.style.margin = style.margin
            span.style.boxSizing = style.boxSizing
            span.style.backgroundColor = 'transparent'

            // Horizontal alignment
            if (style.textAlign === 'right') {
              span.style.justifyContent = 'flex-end'
            } else if (style.textAlign === 'center') {
              span.style.justifyContent = 'center'
            } else {
              span.style.justifyContent = 'flex-start'
            }

            if (clonedInput.parentNode) {
              clonedInput.replaceWith(span)
            }
          })

          // FIX: Remove background images from zero-dimension elements to prevent
          // html2canvas createPattern crash ("canvas element with a width or height of 0")
          const originalAllEls = page.querySelectorAll('*')
          const clonedAllEls = clonedEl.querySelectorAll('*')
          originalAllEls.forEach((origEl, index) => {
            const clonedElItem = clonedAllEls[index]
            if (!clonedElItem) return
            const origStyle = window.getComputedStyle(origEl)
            const bgImage = origStyle.backgroundImage
            if (bgImage && bgImage !== 'none') {
              const rect = origEl.getBoundingClientRect()
              if (rect.width === 0 || rect.height === 0) {
                clonedElItem.style.backgroundImage = 'none'
              }
            }
          })

          // FIX: Pre-render images onto canvas to handle object-fit + zoom/pan
          // html2canvas doesn't support object-fit, so we pre-render the exact visual output
          // onto an offscreen canvas and replace the img src with the result.
          const originalImages = page.querySelectorAll('img')
          const clonedImages = clonedEl.querySelectorAll('img')

          for (let index = 0; index < originalImages.length; index++) {
            const originalImage = originalImages[index]
            const clonedImage = clonedImages[index]
            if (!clonedImage) continue

            const style = window.getComputedStyle(originalImage)
            const objectFit = style.objectFit

            // Only apply fix if object-fit is used (contain or cover)
            if (objectFit && (objectFit === 'contain' || objectFit === 'cover')) {
              const containerW = parseFloat(style.width)
              const containerH = parseFloat(style.height)
              const natW = originalImage.naturalWidth || containerW
              const natH = originalImage.naturalHeight || containerH

              if (!natW || !natH || !containerW || !containerH) continue

              // Get the zoom and pan from the transform
              const transformStr = originalImage.style.transform || ''
              let zoom = 1, panX = 0, panY = 0
              const scaleMatch = transformStr.match(/scale\(([\d.]+)\)/)
              const translateMatch = transformStr.match(/translate\(([\d.-]+)px,\s*([\d.-]+)px\)/)
              if (scaleMatch) zoom = parseFloat(scaleMatch[1])
              if (translateMatch) { panX = parseFloat(translateMatch[1]); panY = parseFloat(translateMatch[2]) }

              // Create an offscreen canvas at 2x the container size for sharpness
              const canvasScale = 2
              const offCanvas = document.createElement('canvas')
              offCanvas.width = containerW * canvasScale
              offCanvas.height = containerH * canvasScale
              const ctx = offCanvas.getContext('2d')

              // Calculate base object-fit dimensions
              let drawW, drawH
              const containerRatio = containerW / containerH
              const imageRatio = natW / natH

              if (objectFit === 'contain') {
                if (imageRatio > containerRatio) {
                  drawW = containerW; drawH = containerW / imageRatio
                } else {
                  drawH = containerH; drawW = containerH * imageRatio
                }
              } else { // cover
                if (imageRatio > containerRatio) {
                  drawH = containerH; drawW = containerH * imageRatio
                } else {
                  drawW = containerW; drawH = containerW / imageRatio
                }
              }

              // Apply zoom and centering
              const scaledDrawW = drawW * zoom
              const scaledDrawH = drawH * zoom
              const drawX = (containerW - scaledDrawW) / 2 + (panX * zoom)
              const drawY = (containerH - scaledDrawH) / 2 + (panY * zoom)

              // Draw the image onto canvas at high res
              ctx.scale(canvasScale, canvasScale)
              try {
                ctx.drawImage(originalImage, drawX, drawY, scaledDrawW, scaledDrawH)
              } catch (e) {
                // If drawing fails (e.g. tainted canvas), skip this image
                console.error('[pdfGenerator] drawImage failed for image', index, e)
                continue
              }

              // The baked bitmap above already IS the final zoom/pan/crop result (it was
              // computed FROM the live scale()/translate() transform), sized to exactly
              // fill the container. The cloned <img> still carries that same original
              // transform in its inline style (cloneNode copies it verbatim) — left alone,
              // html2canvas would apply it a SECOND time on top of the already-adjusted
              // bitmap, compounding the zoom/pan on every download (more zoom, cropped
              // edges, worse the more a lead's images were adjusted). Clear it before
              // swapping the src.
              clonedImage.style.transform = 'none'

              // Replace the cloned img src with the pre-rendered canvas output
              let bakedSrc
              try {
                // Use PNG to preserve transparency for object-fit: contain
                bakedSrc = offCanvas.toDataURL('image/png')
              } catch (e) {
                console.error('[pdfGenerator] toDataURL failed for image', index, e)
                continue // Skip if toDataURL fails
              }

              // html2canvas resolves/waits for images during its own cloning pass, which
              // already finished before this onclone callback runs — reassigning .src here
              // starts a NEW, separate decode that html2canvas has no reason to wait for.
              // Without waiting for it ourselves, html2canvas can (and, per real reproduction
              // when testing this file, reliably did) rasterize the clone before the new
              // bitmap has actually painted, capturing a blank box instead. onclone is async
              // and html2canvas awaits it (documented behavior), so block on the image's own
              // load event before moving on to the next one.
              await new Promise((resolve) => {
                clonedImage.onload = resolve
                clonedImage.onerror = resolve // don't hang the whole capture over one bad image
                clonedImage.src = bakedSrc
              })

              // Do NOT force object-fit: fill or explicit pixel dimensions,
              // as this breaks responsive flexbox layouts in the PDF and causes stretching.
              // Just let the original CSS (w-full h-full object-cover) handle the new src!
            }
          }
        }
      })

      // Restore original createPattern after html2canvas is done
      CanvasRenderingContext2D.prototype.createPattern = _origCreatePattern

      // Scale canvas to fill page WIDTH exactly
      // PDF Page Height will be dynamic to fit content (No white space, No truncation)
      const imgData = canvas.toDataURL('image/jpeg', 0.92)

      // Calculate required height to maintain aspect ratio at full page width
      const scaledWidth = size.width
      const scaledHeight = (canvas.width > 0) ? (canvas.height / canvas.width) * size.width : size.height

      // Defensive check: ensure valid dimensions
      if (!scaledWidth || !scaledHeight || !isFinite(scaledWidth) || !isFinite(scaledHeight) || scaledWidth <= 0 || scaledHeight <= 0) {
        console.error(`Invalid page dimensions: w=${scaledWidth}, h=${scaledHeight}, canvas=${canvas.width}x${canvas.height}`)
        continue
      }

      // For the first page, we might need to resize if it was initialized differently
      // But jsPDF doesn't easily resize the first page after init.
      // Strategy: Add new page with correct size for all pages, and delete the initial blank one if needed?
      // Better: Just add pages with specific dimensions.

      // Detect if this page is landscape (SignCrafters or NexusLEDs)
      const isLandscape = page.classList.contains('sc-page') || page.classList.contains('nl-page') || page.classList.contains('terms-page-landscape')
      const pageOrientation = isLandscape ? 'landscape' : 'portrait'

      if (i === 0) {
        // First page is already created in constructor — delete it and add correctly
        pdf.deletePage(1)
        pdf.addPage([scaledWidth, scaledHeight], pageOrientation)
      } else {
        pdf.addPage([scaledWidth, scaledHeight], pageOrientation)
      }

      pdf.addImage(imgData, 'JPEG', 0, 0, scaledWidth, scaledHeight)

      // Restore clickable hyperlinks that html2canvas flattened
      const links = page.querySelectorAll('a[href]')
      links.forEach(a => {
        const rect = a.getBoundingClientRect()
        const pageRect = page.getBoundingClientRect()
        
        // Calculate relative coordinates in pixels
        const px = rect.left - pageRect.left
        const py = rect.top - pageRect.top
        
        // Convert to PDF units (mm) using the scaling ratio
        const ratio = scaledWidth / page.offsetWidth
        const mmX = px * ratio
        const mmY = py * ratio
        const mmW = rect.width * ratio
        const mmH = rect.height * ratio

        // Add invisible clickable box over the rendered button
        pdf.link(mmX, mmY, mmW, mmH, { url: a.href })
      })

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: proposalPages.length,
          percentage: Math.round(((i + 1) / proposalPages.length) * 100),
          message: `Page ${i + 1} captured`
        })
      }
    }

    // Restore hidden elements
    noPrintElements.forEach(el => {
      el.style.display = el.dataset.originalDisplay || ''
      delete el.dataset.originalDisplay
    })

    // Generate filename
    const sanitizedName = clientName.replace(/[^a-zA-Z0-9]/g, '_')
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = `${sanitizedName}_Proposal_${timestamp}.pdf`

    // If returnBlob is true, return the blob object
    if (returnBlob) {
      const blob = pdf.output('blob')
      if (onProgress) {
        onProgress({
          current: proposalPages.length,
          total: proposalPages.length,
          percentage: 100,
          message: 'PDF generated successfully!'
        })
      }
      hideLoading(loadingId) // FIX: Hide loading before returning
      return blob
    }

    // Save PDF
    pdf.save(filename)

    hideLoading(loadingId)
    showToast(`PDF saved: ${filename}`, 'success', 3000)

    if (onProgress) {
      onProgress({
        current: proposalPages.length,
        total: proposalPages.length,
        percentage: 100,
        message: 'PDF generated successfully!'
      })
    }

    return filename

  } catch (error) {
    console.error('PDF generation error:', error)
    hideLoading(loadingId)
    showToast('PDF generation failed. Please try again.', 'error')
    return null
  } finally {
    document.body.classList.remove('is-generating-pdf') // REMOVE PRINT MODE
  }
}

/**
 * Legacy function for backward compatibility
 */
export const generatePDFWithProgress = async (clientName, onProgress = null, pageSize = 'letter') => {
  return generateProposalPDF({
    clientName,
    pageSize,
    onProgress
  })
}

/**
 * Quick generate using browser print dialog (fallback)
 */
export const printProposal = () => {
  showToast('Opening print dialog...', 'info', 2000)
  setTimeout(() => window.print(), 300)
}
