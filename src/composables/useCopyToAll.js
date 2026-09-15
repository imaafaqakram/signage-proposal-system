/**
 * useCopyToAll Composable
 * Handles copying field values to all pages
 */

import { showToast, confirmAction } from '@/utils/toast'

export const useCopyToAll = (pages, currentPageIndex) => {
  /**
   * Copy a single field to all other pages
   * @param {string} fieldName - Name of the field to copy
   * @param {boolean} includeCurrentPage - Whether to include current page
   */
  const copyFieldToAll = async (fieldName, includeCurrentPage = false) => {
    const currentPage = pages.value[currentPageIndex.value]
    const value = currentPage[fieldName]
    
    // Check if value exists
    if (value === undefined || value === null || value === '') {
      showToast('Field is empty', 'warning')
      return false
    }

    // Confirm action
    const totalPages = includeCurrentPage ? pages.value.length : pages.value.length - 1
    const confirmed = await confirmAction(
      `Copy "${value}" to ${totalPages} page${totalPages !== 1 ? 's' : ''}?`,
      'Copy'
    )

    if (!confirmed) return false

    // Copy to all pages
    let copiedCount = 0
    pages.value.forEach((page, index) => {
      if (includeCurrentPage || index !== currentPageIndex.value) {
        page[fieldName] = value
        copiedCount++
      }
    })

    showToast(`Copied to ${copiedCount} page${copiedCount !== 1 ? 's' : ''}!`, 'success')
    return true
  }

  /**
   * Copy multiple fields to all pages
   * @param {Array<string>} fieldNames - Array of field names
   * @param {boolean} includeCurrentPage
   */
  const copyMultipleFields = async (fieldNames, includeCurrentPage = false) => {
    if (!fieldNames || fieldNames.length === 0) {
      showToast('No fields selected', 'warning')
      return false
    }

    const currentPage = pages.value[currentPageIndex.value]
    const totalPages = includeCurrentPage ? pages.value.length : pages.value.length - 1

    // Confirm action
    const confirmed = await confirmAction(
      `Copy ${fieldNames.length} field${fieldNames.length !== 1 ? 's' : ''} to ${totalPages} page${totalPages !== 1 ? 's' : ''}?`,
      'Copy All'
    )

    if (!confirmed) return false

    // Copy all fields
    fieldNames.forEach(fieldName => {
      const value = currentPage[fieldName]
      if (value !== undefined && value !== null && value !== '') {
        pages.value.forEach((page, index) => {
          if (includeCurrentPage || index !== currentPageIndex.value) {
            page[fieldName] = value
          }
        })
      }
    })

    showToast(`Copied ${fieldNames.length} fields to ${totalPages} pages!`, 'success')
    return true
  }

  /**
   * Copy pricing table to all pages
   */
  const copyPricingToAll = async (includeCurrentPage = false) => {
    const currentPage = pages.value[currentPageIndex.value]
    const pricing = currentPage.pricing

    if (!pricing || pricing.length === 0) {
      showToast('No pricing data to copy', 'warning')
      return false
    }

    const totalPages = includeCurrentPage ? pages.value.length : pages.value.length - 1
    const confirmed = await confirmAction(
      `Copy pricing table (${pricing.length} rows) to ${totalPages} page${totalPages !== 1 ? 's' : ''}?`,
      'Copy'
    )

    if (!confirmed) return false

    // Deep copy pricing array
    const pricingCopy = JSON.parse(JSON.stringify(pricing))

    pages.value.forEach((page, index) => {
      if (includeCurrentPage || index !== currentPageIndex.value) {
        page.pricing = JSON.parse(JSON.stringify(pricingCopy))
      }
    })

    showToast(`Pricing copied to ${totalPages} pages!`, 'success')
    return true
  }

  /**
   * Copy images/assets to all pages
   */
  const copyAssetsToAll = async (includeCurrentPage = false) => {
    const currentPage = pages.value[currentPageIndex.value]
    const assets = currentPage.assets

    if (!assets || assets.length === 0) {
      showToast('No images to copy', 'warning')
      return false
    }

    const totalPages = includeCurrentPage ? pages.value.length : pages.value.length - 1
    const confirmed = await confirmAction(
      `Copy ${assets.length} image${assets.length !== 1 ? 's' : ''} to ${totalPages} page${totalPages !== 1 ? 's' : ''}?`,
      'Copy'
    )

    if (!confirmed) return false

    // Deep copy assets array
    const assetsCopy = JSON.parse(JSON.stringify(assets))

    pages.value.forEach((page, index) => {
      if (includeCurrentPage || index !== currentPageIndex.value) {
        page.assets = JSON.parse(JSON.stringify(assetsCopy))
      }
    })

    showToast(`Images copied to ${totalPages} pages!`, 'success')
    return true
  }

  /**
   * Copy entire page to specific indices
   * @param {Array<number>} targetIndices - Indices of pages to copy to
   */
  const copyPageTo = async (targetIndices) => {
    if (!targetIndices || targetIndices.length === 0) {
      showToast('No target pages selected', 'warning')
      return false
    }

    const currentPage = pages.value[currentPageIndex.value]

    const confirmed = await confirmAction(
      `Copy entire page to ${targetIndices.length} selected page${targetIndices.length !== 1 ? 's' : ''}?`,
      'Copy'
    )

    if (!confirmed) return false

    // Create deep copy of current page
    const pageCopy = JSON.parse(JSON.stringify(currentPage))

    targetIndices.forEach(index => {
      if (index >= 0 && index < pages.value.length && index !== currentPageIndex.value) {
        // Merge with existing page (preserve page-specific IDs if any)
        pages.value[index] = {
          ...pages.value[index],
          ...pageCopy
        }
      }
    })

    showToast(`Page copied to ${targetIndices.length} location${targetIndices.length !== 1 ? 's' : ''}!`, 'success')
    return true
  }

  /**
   * Get list of copyable fields from current page
   */
  const getCopyableFields = () => {
    const currentPage = pages.value[currentPageIndex.value]
    const fields = []

    // Standard fields
    const standardFields = [
      'signType',
      'usage',
      'finish',
      'illuminated',
      'ulCert',
      'permit',
      'install',
      'glowColor',
      'bgClass'
    ]

    standardFields.forEach(field => {
      if (currentPage[field] !== undefined && currentPage[field] !== null) {
        fields.push({
          name: field,
          label: formatFieldLabel(field),
          value: currentPage[field]
        })
      }
    })

    return fields
  }

  /**
   * Format field name to readable label
   */
  const formatFieldLabel = (fieldName) => {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim()
  }

  return {
    copyFieldToAll,
    copyMultipleFields,
    copyPricingToAll,
    copyAssetsToAll,
    copyPageTo,
    getCopyableFields,
    formatFieldLabel
  }
}
