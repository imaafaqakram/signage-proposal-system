/**
 * usePageSync Composable
 * Handles synchronization between sidebar and visible page
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useScrollspy, scrollToPage as scrollToPageUtil } from '@/utils/scrollspy'

export const usePageSync = (pages) => {
  const currentPageIndex = ref(0)

  // Current page data
  const currentPage = computed(() => {
    return pages.value[currentPageIndex.value] || pages.value[0]
  })

  // Scrollspy for auto-detection
  const { initScrollspy, cleanup } = useScrollspy((pageIndex) => {
    currentPageIndex.value = pageIndex
  })

  // Initialize on mount
  onMounted(() => {
    initScrollspy()
  })

  // Cleanup on unmount
  onUnmounted(() => {
    cleanup()
  })

  // Scroll to specific page
  const scrollToPage = (pageIndex) => {
    if (pageIndex >= 0 && pageIndex < pages.value.length) {
      currentPageIndex.value = pageIndex
      scrollToPageUtil(pageIndex, 'smooth')
    }
  }

  // Navigate to next page
  const nextPage = () => {
    if (currentPageIndex.value < pages.value.length - 1) {
      scrollToPage(currentPageIndex.value + 1)
    }
  }

  // Navigate to previous page
  const prevPage = () => {
    if (currentPageIndex.value > 0) {
      scrollToPage(currentPageIndex.value - 1)
    }
  }

  // Check if can navigate
  const canGoNext = computed(() => currentPageIndex.value < pages.value.length - 1)
  const canGoPrev = computed(() => currentPageIndex.value > 0)

  return {
    currentPageIndex,
    currentPage,
    scrollToPage,
    nextPage,
    prevPage,
    canGoNext,
    canGoPrev
  }
}
