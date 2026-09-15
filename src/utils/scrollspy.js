/**
 * Scrollspy Utility
 * Detects which page is currently in viewport
 */

import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Create scrollspy observer for proposal pages
 * @param {Function} onPageChange - Callback when active page changes
 * @param {number} threshold - Percentage of page visible to trigger (0-1)
 * @returns {Object} - { activePageIndex, observer }
 */
export const useScrollspy = (onPageChange, threshold = 0.5) => {
  const activePageIndex = ref(0)
  let observer = null

  const initScrollspy = () => {
    // Create intersection observer
    observer = new IntersectionObserver(
      (entries) => {
        // Find the entry with highest intersection ratio
        let maxRatio = 0
        let activeEntry = null

        entries.forEach(entry => {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            activeEntry = entry
          }
        })

        // Update active page if threshold met
        if (activeEntry && activeEntry.intersectionRatio >= threshold) {
          const pageIndex = parseInt(activeEntry.target.dataset.pageIndex)
          if (!isNaN(pageIndex) && pageIndex !== activePageIndex.value) {
            activePageIndex.value = pageIndex
            if (onPageChange) {
              onPageChange(pageIndex)
            }
          }
        }
      },
      {
        threshold: [0, 0.25, 0.5, 0.75, 1], // Multiple thresholds for accuracy
        rootMargin: '-100px 0px -100px 0px' // Offset for better detection
      }
    )

    // Observe all pages
    setTimeout(() => {
      const pages = document.querySelectorAll('.a4-page')
      pages.forEach((page, index) => {
        page.dataset.pageIndex = index
        observer.observe(page)
      })
    }, 100)
  }

  const cleanup = () => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  return {
    activePageIndex,
    observer,
    initScrollspy,
    cleanup
  }
}

/**
 * Smooth scroll to specific page
 * @param {number} pageIndex - Index of page to scroll to
 * @param {string} behavior - 'smooth' or 'instant'
 */
export const scrollToPage = (pageIndex, behavior = 'smooth') => {
  const page = document.querySelector(`[data-page-index="${pageIndex}"]`)
  if (page) {
    page.scrollIntoView({
      behavior,
      block: 'center'
    })
  }
}

/**
 * Get current scroll percentage of an element
 * @param {HTMLElement} element
 * @returns {number} - 0 to 100
 */
export const getScrollPercentage = (element) => {
  const rect = element.getBoundingClientRect()
  const viewportHeight = window.innerHeight
  
  // Calculate how much of the element is visible
  const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
  const elementHeight = element.offsetHeight
  
  return (visibleHeight / elementHeight) * 100
}

/**
 * Debounce function for scroll events
 * @param {Function} func
 * @param {number} wait
 * @returns {Function}
 */
export const debounce = (func, wait = 100) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}
