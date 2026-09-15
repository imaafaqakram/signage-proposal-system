/**
 * Luminus Bulk Automation — Import → Proposal Editor mapping
 *
 * Converts a client + items from the bulk extraction DB into the
 * proposalStore.js data model so the user can review and send.
 */

import { useProposalStore } from '@/stores/proposalStore'
import { supabase } from '@/services/supabase'

const STORAGE_BUCKET = 'import-images'

const getImageUrl = (path) => {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (supabase) {
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
    return data?.publicUrl || null
  }
  return null
}

const defaultAsset = (label, style = 'mockup') => ({
  style,
  src: null,
  mediaType: 'image',
  label,
  isRegenerating: false,
  originalSrc: null,
  isDragging: false,
  aspectRatio: 'auto',
  zoom: 1,
  x: 0,
  y: 0
})

/**
 * Map extracted image paths to proposal asset labels.
 * Order: Technical Drawing, Day View, Night View, Extra View, ...
 */
const buildAssets = (item) => {
  const imagePaths = item.original_image_paths?.length
    ? item.original_image_paths
    : (item.original_image_path ? [item.original_image_path] : [])

  const assetLabels = ['Technical Drawing', 'Day View', 'Night View', 'Extra View']
  const assetStyles = ['drawing', 'mockup', 'mockup', 'mockup']

  const assets = []
  for (let i = 0; i < Math.max(3, imagePaths.length); i++) {
    const url = getImageUrl(imagePaths[i] || item.regenerated_image_path)
    assets.push({
      ...defaultAsset(assetLabels[i] || `Extra View ${i + 1}`, assetStyles[i] || 'mockup'),
      src: url,
      originalSrc: url
    })
  }
  return assets
}

const buildPage = (item, settings) => {
  // Build pricing rows from pricing_json, or fall back to a single row
  let pricing = []
  if (item.pricing_json && Array.isArray(item.pricing_json) && item.pricing_json.length > 0) {
    pricing = item.pricing_json.map(row => ({
      size: row.size || 'Option',
      dim: row.dim || item.size || 'Custom',
      cost: String(row.cost ?? item.original_price ?? '0'),
      discounted: String(row.discounted_cost ?? item.discounted_price ?? '')
    }))
  } else {
    const cost = item.original_price ?? item.discounted_price ?? 0
    pricing = [
      {
        size: item.size && !/\d/.test(item.size) ? item.size : 'Option',
        dim: item.size || 'Custom',
        cost: String(cost),
        discounted: item.discounted_price != null ? String(item.discounted_price) : ''
      }
    ]
  }

  const truthy = (val) => val && val !== '' && val.toLowerCase() !== 'no' ? val : null

  return {
    id: item.id,
    signType: item.sign_type || 'Custom Sign',
    usage: item.usage || 'Outdoor',
    finish: item.finish || 'Standard',
    illuminated: item.illuminated || 'Yes',
    ulCert: item.ul_cert || 'Only For Illuminated variants',
    permit: item.permit || 'On Demand',
    install: item.install || 'On Demand',
    glowColor: settings?.glowColor || '#00f3ff',
    bgClass: 'bg-brick',
    color: item.color || 'Same as Mockup',
    discountCode: item.discount_code || 'AUTO',
    assets: buildAssets(item),
    pricing
  }
}

/**
 * Load an imported client into the proposal editor store.
 * @param {Object} client - import_clients row
 * @param {Array} items - import_items rows for this client
 * @param {Object} options
 * @param {boolean} options.replace - if true, replaces current proposal; if false, appends pages
 */
export const loadImportIntoProposal = (client, items, options = {}) => {
  const proposalStore = useProposalStore()
  const { replace = true } = options

  proposalStore.clientName = client.client_name || 'Valued Client'
  proposalStore.contactEmail = client.client_email || ''

  const pages = (items || []).map(item => buildPage(item, proposalStore.settings))

  if (pages.length === 0) {
    // Create at least one blank page so the editor isn't empty
    pages.push(buildPage({ sign_type: 'Custom Sign', size: 'Custom' }, proposalStore.settings))
  }

  if (replace) {
    proposalStore.pages = pages
  } else {
    proposalStore.pages.push(...pages)
  }

  return pages.length
}

/**
 * Map a raw extraction result (from the Python extractor) directly into the store.
 * Useful for a preview without saving to DB.
 */
export const loadExtractionIntoProposal = (extracted) => {
  const proposalStore = useProposalStore()
  const client = extracted.client || {}
  const items = extracted.items || []

  proposalStore.clientName = client.client_name || 'Valued Client'
  proposalStore.contactEmail = client.client_email || ''
  proposalStore.pages = items.map(item => buildPage(item, proposalStore.settings))

  if (proposalStore.pages.length === 0) {
    proposalStore.pages.push(buildPage({ sign_type: 'Custom Sign', size: 'Custom' }, proposalStore.settings))
  }
}

export default { loadImportIntoProposal, loadExtractionIntoProposal }
