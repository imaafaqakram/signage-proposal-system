<template>
  <div class="a4-page proposal-page nl-page" :class="[theme]" :data-page-index="pageIndex" :style="{ ...pageStyle, '--accent-color': settings.accentColor, '--accent-color-glow': settings.glowEnabled !== false ? hexToRgba(settings.glowColor, settings.glowIntensity) : 'transparent' }">
    <div class="nl-wrapper">

      <!-- ═══════ TOP BAR ═══════ -->
      <div class="nl-topbar">
        <div class="nl-topbar-logo">
          <!-- Dynamic Gradient Brand -->
          <h1 class="nl-brand" v-html="formattedBrand"></h1>
        </div>
        <div class="nl-topbar-right">
          <span><i class="fas fa-phone"></i> <input :value="proposalPhone" readonly class="nl-top-input" /></span>
          <span><i class="fas fa-envelope"></i> <input :value="'info@signagecrafting.com'" readonly class="nl-top-input" style="width: 140px;" /></span>
        </div>
      </div>

      <!-- ═══════ MAIN BODY (Dynamic Grid) ═══════ -->
      <div class="nl-body" :class="`layout-${page.layoutMode || 'standard'}`">

        <!-- ══ LEFT: Images ══ -->
        <div class="nl-col-images">
          <div v-for="(asset, idx) in page.assets" :key="idx" 
               class="nl-img-block"
               :class="{ 'nl-edit-mode': editMode === idx }"
               @mouseenter="hoverAsset = idx" @mouseleave="hoverAsset = null">
            
            <div class="nl-img-box" :class="getSurfaceClass(idx)"
              @click="handleImageClick(pageIndex, idx)">
              
              <!-- Image with Transform -->
              <img v-if="asset.src" :src="asset.src" class="nl-img" 
                   :style="{ transform: `scale(${asset.zoom || 1}) translate(${asset.x || 0}px, ${asset.y || 0}px)` }"
                   @mousedown.stop="startDrag($event, asset)"
                   draggable="false" />
              
              <div v-else class="nl-img-empty">
                <i class="fas" :class="idx === 2 ? 'fa-camera' : (idx === 1 ? 'fa-image' : 'fa-pencil-ruler')"></i>
                <span>Click to upload</span>
              </div>

              <!-- Edit Controls Overlay (Hover) -->
              <div v-if="asset.src && hoverAsset === idx && editMode !== idx" class="nl-img-controls no-print" @click.stop>
                 <button @click="editMode = idx" class="nl-btn-edit"><i class="fas fa-arrows-alt"></i> Adjust</button>
                 <button @click="$emit('upload-image', { pageIndex, assetIndex: idx })" class="nl-btn-replace"><i class="fas fa-sync"></i></button>
                 <button @click="getVector(idx, $event)" class="nl-btn-vector" title="Vectorize this image"><i class="fas fa-bezier-curve"></i></button>
                 <button @click="deleteAsset(idx)" class="nl-btn-del" title="Remove Image"><i class="fas fa-trash"></i></button>
              </div>

              <!-- Active Edit Mode Controls -->
              <div v-if="editMode === idx" class="nl-edit-panel no-print" @click.stop>
                <div class="nl-edit-row">
                  <label>Zoom</label>
                  <span class="nl-zoom-pct">{{ Math.round((asset.zoom || 1) * 100) }}%</span>
                  <input type="range" v-model.number="asset.zoom" min="1" max="3" step="0.1" />
                </div>
                <div class="nl-edit-row">
                  <small>Drag image to pan</small>
                  <button @click="editMode = null" class="nl-btn-done">Done</button>
                </div>
              </div>

              <div class="nl-file-wrap"><input type="file" :id="`fileInput_${pageIndex}_${idx}`" accept="image/*,video/*" @change="handleFileChange($event, pageIndex, idx)" /></div>
            </div>
            <div class="nl-img-caption"><input v-model="asset.label" class="nl-caption-input" placeholder="Label" /></div>
          </div>
          
          <!-- Add Image Button -->
          <div v-if="page.assets.length < 3" class="nl-add-img-btn no-print" @click="addAsset">
            <i class="fas fa-plus"></i> Add Image
          </div>
        </div>

        <!-- ══ CENTER: Trust Badges (MASSIVE) ══ -->
        <div class="nl-col-badges">
          <div class="nl-badge" v-for="(b, i) in trustBadges" :key="i">
            <div class="nl-badge-circle">
              <img v-if="b.img" :src="b.img" class="nl-badge-img" draggable="false" />
              <i v-else :class="['fas', b.icon]"></i>
            </div>
            <span class="nl-badge-title">{{ b.title }}</span>
            <span class="nl-badge-sub">{{ b.sub }}</span>
          </div>
        </div>

        <!-- ══ RIGHT: Quote Details ══ -->
        <div class="nl-col-details">
          <div class="nl-details-card">
            <h3 class="nl-details-title">Quote Details</h3>
            <input :value="clientName" @input="$emit('update:clientName', $event.target.value)"
              class="nl-client-name" placeholder="Client Name" />
            <input :value="contactEmail" @input="$emit('update:contactEmail', $event.target.value)"
              class="nl-client-email" placeholder="Client Email" />
            
            <div class="nl-specs">
              <div class="nl-spec"><span class="nl-spec-k">SIGN TYPE</span><span class="nl-spec-s">:</span><input v-model="page.signType" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">DIMENSIONS</span><span class="nl-spec-s">:</span><input :value="(page.pricing?.[0]?.dim || '')" readonly class="nl-spec-v" placeholder="See table below" /></div>
              <div class="nl-spec"><span class="nl-spec-k">COLOR</span><span class="nl-spec-s">:</span><input v-model="page.color" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">FINISH</span><span class="nl-spec-s">:</span><input v-model="page.finish" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">ILLUMINATED</span><span class="nl-spec-s">:</span><input v-model="page.illuminated" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">USAGE</span><span class="nl-spec-s">:</span><input v-model="page.usage" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">UL CERTIFICATION</span><span class="nl-spec-s">:</span><input v-model="page.ulCert" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">PERMIT</span><span class="nl-spec-s">:</span><input v-model="page.permit" class="nl-spec-v" /></div>
              <div class="nl-spec"><span class="nl-spec-k">INSTALLATION</span><span class="nl-spec-s">:</span><input v-model="page.install" class="nl-spec-v" /></div>
            </div>

            <!-- PRICING TABLE -->
            <div class="nl-pricing-table">
              <table class="nl-table">
                <thead>
                  <tr>
                    <th style="width: 25%">Size</th>
                    <th style="width: 30%">Dimension</th>
                    <th style="width: 20%">Price</th>
                    <th style="width: 25%">Discounted Price</th>
                    <th class="no-print" style="width: 20px"></th> <!-- Action -->
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in page.pricing" :key="idx">
                    <td>
                      <div class="nl-size-badge" :data-label="item.label || 'SIZE'" :class="{'nl-badge-sm': item.label === 'Small', 'nl-badge-md': item.label === 'Medium', 'nl-badge-lg': item.label === 'Large'}">
                        <input v-model="item.label" class="nl-table-input nl-input-badge no-print" :placeholder="getSizePlaceholder(idx)" />
                        <span class="nl-print-only">{{ item.label || getSizePlaceholder(idx) }}</span>
                      </div>
                    </td>
                    <td><input v-model="item.dim" class="nl-table-input" placeholder="e.g. 48 in x 22 in" /></td>
                    <td>
                      <div class="nl-price-strike-wrap">
                        <input v-model="item.cost" class="nl-table-input nl-strike-input" placeholder="$0" />
                      </div>
                    </td>
                    <td class="nl-td-discount">
                      {{ item.discounted || calculateDiscount(item.cost) }} USD
                      <br/>
                      <a v-if="page.id" :href="`https://signagecrafting.vercel.app/api/stripe/pay/${$route.params.clientId}?itemId=${page.id}&priceIdx=${idx}`" target="_blank" class="text-[9px] bg-blue-600 text-white px-2 py-1 rounded font-bold uppercase hover:bg-blue-700 transition-colors inline-block no-underline shadow-sm" style="margin-top: 8px; position: relative; z-index: 50;">
                        <i class="fas fa-lock" style="margin-right: 4px;"></i> Pay Now
                      </a>
                    </td>
                    <td class="no-print">
                         <button @click="removePriceRow(idx)" class="nl-btn-del-row" title="Remove Row">×</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="nl-add-row-bar no-print" @click="addPriceRow">+ Add Size Option</div>
            </div>

            <!-- PRINT ONLY PRICING TABLE (Visible in Print, Hidden in Editor) -->
            <div class="nl-print-only-table">
              <table class="nl-table">
                <thead>
                  <tr>
                    <th style="width: 25%">Size</th>
                    <th style="width: 30%">Dimension</th>
                    <th style="width: 20%">Price</th>
                    <th style="width: 25%">Discounted Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in page.pricing" :key="idx">
                    <td class="nl-print-badge-cell">{{ item.label || getSizePlaceholder(idx) }}</td>
                    <td>{{ item.dim }}</td>
                    <td>{{ item.cost }}</td>
                    <td style="font-weight: 700; color: #000;">
                      {{ item.discounted || calculateDiscount(item.cost) }} USD
                      <br/>
                      <a v-if="page.id" :href="`https://signagecrafting.vercel.app/api/stripe/pay/${$route.params.clientId}?itemId=${page.id}&priceIdx=${idx}`" target="_blank" class="text-[9px] bg-blue-600 text-white px-2 py-1 rounded font-bold uppercase hover:bg-blue-700 transition-colors inline-block no-underline shadow-sm" style="margin-top: 4px; position: relative; z-index: 50;">
                        <i class="fas fa-lock" style="margin-right: 4px;"></i> Pay Now
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Package Included -->
            <div class="nl-package">
              <div class="nl-pkg-title">Package Included</div>
              <div class="nl-pkg-row">
                <div class="nl-pkg-item">
                  <div class="nl-pkg-icon"><i class="fas fa-sign"></i></div>
                  <span>Your Sign</span>
                </div>
                <div class="nl-pkg-item">
                  <div class="nl-pkg-icon"><i class="fas fa-book-open"></i></div>
                  <span>Installation Guide</span>
                </div>
                <div class="nl-pkg-item">
                  <div class="nl-pkg-icon"><i class="fas fa-screwdriver"></i></div>
                  <span>Screws</span>
                </div>
                <div class="nl-pkg-item">
                  <div class="nl-pkg-icon"><i class="fas fa-plug"></i></div>
                  <span>Power Supply</span>
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </div>

      <!-- ═══════ FOOTER ═══════ -->
      <div class="nl-footer">
        <div class="nl-footer-content">
          <div class="nl-footer-section">
            <h4 class="nl-footer-title">Terms &amp; Important Notes</h4>
            <ul class="nl-footer-list">
              <li>Please ensure all <strong>Spellings</strong> &amp; <strong>Dimensions</strong> are correct.</li>
              <li>Includes <strong>2 Year Warranty</strong> (UL Listed Components).</li>
              <li>Production: <strong>2-3 Weeks</strong> after approval.</li>
            </ul>
          </div>
          <div class="nl-footer-section">
            <h4 class="nl-footer-title">Technical Specs</h4>
            <ul class="nl-footer-list">
              <li>Test Proof of <strong>Color</strong> available on request.</li>
              <li>Tolerance: Up to <strong>5%</strong> color/dimension variance.</li>
            </ul>
          </div>
          <div class="nl-footer-section nl-footer-section-right">
            <h4 class="nl-footer-title">Copyright Notices</h4>
            <div class="nl-footer-text">
              © {{ new Date().getFullYear() }} {{ settings.companyName }}.
              All rights reserved. This document and mockups are refined intellectual property.
            </div>
          </div>
        </div>
      </div>

    </div>

    <VectorizeModal
      v-if="vectorAsset"
      :src="vectorSrc"
      :label="vectorAsset.label"
      :client-name="clientName"
      @close="vectorAsset = null"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { usePublicSettings } from '@/composables/usePublicSettings'

const { proposalPhone } = usePublicSettings()

const props = defineProps({
  page: { type: Object, required: true },
  pageIndex: { type: Number, required: true },
  settings: { type: Object, required: true },
  clientName: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  footer: { type: Object, required: true },
  pendingAiImage: { type: String, default: null },
  layout: { type: String, default: 'default' },
  theme: { type: String, default: 'theme-navy' }
})

const emit = defineEmits([
  'update:clientName', 'update:contactEmail',
  'image-container-clicked', 'delete-image', 'upload-image'
])

import icon_shipping from '@/assets/nexus/icon_shipping.png'
import icon_support from '@/assets/nexus/icon_support.png'
import icon_warranty from '@/assets/nexus/icon_warranty.png'
import icon_certified from '@/assets/nexus/icon_certified.png'
import icon_bestprice from '@/assets/nexus/icon_bestprice.png'
import VectorizeModal from './VectorizeModal.vue'
import { cropAssetView } from '@/utils/vectorize'

const trustBadges = [
  { img: icon_shipping, title: 'FREE SHIPPING', sub: 'Turnaround' },
  { img: icon_support, title: '24/7 SUPPORT', sub: 'Online' },
  { img: icon_warranty, title: '2 YEARS', sub: 'Warranty' },
  { img: icon_certified, title: 'UL CERTIFIED', sub: 'Approved' },
  { img: icon_bestprice, title: 'BEST PRICE', sub: 'Guaranteed' }
]

const nlDefaults = [
  { style: 'drawing', src: null, mediaType: 'image', label: 'Drawing', zoom: 1, x: 0, y: 0 },
  { style: 'mockup', src: null, mediaType: 'image', label: 'Mockup', zoom: 1, x: 0, y: 0 },
  { style: 'mixed', src: null, mediaType: 'image', label: 'Detail', zoom: 1, x: 0, y: 0 }
]

const formattedBrand = computed(() => {
  const name = props.settings.companyName || 'Signage Crafting'
  // If it contains "The ", split it
  if (name.startsWith('The ')) {
    const main = name.substring(4)
    return `<span style="color: var(--text-color); opacity: 0.9;">The</span> <span style="color: #2e63ff; text-shadow: 0 0 15px rgba(46,99,255,0.4);">` + main + `</span>`
  }
  // Otherwise use gradient text
  return `<span class="nl-brand-gradient">${name}</span>`
})

const pageStyle = computed(() => {
  // Off = flat background, no corner glow / accent text-shadow at all.
  const glowOn = props.settings.glowEnabled !== false
  const glowImage = glowOn
    ? (() => {
        const primaryGlow = hexToRgba(props.settings.glowColor, Math.min(props.settings.glowIntensity, 0.4))
        const softGlow = hexToRgba(props.settings.glowColor, Math.min(props.settings.glowIntensity * 0.2, 0.1))
        return `radial-gradient(circle at 100% 100%, ${primaryGlow} 0%, ${softGlow} 30%, transparent 70%)`
      })()
    : 'none'

  const base = {
    'background-image': glowImage,
    '--glow-color': props.settings.glowColor
  }

  if (props.theme === 'theme-custom') {
    return {
      ...base,
      '--bg-color': props.settings.themeBg,
      '--text-color': props.settings.themeText,
      '--panel-bg': hexToRgba(props.settings.themeText, 0.05),
      '--border-color': hexToRgba(props.settings.themeText, 0.15),
      'background-color': props.settings.themeBg
    }
  }
  return base
})

// Image Edit Logic
const hoverAsset = ref(null)
const editMode = ref(null)
const isDragging = ref(false)
const dragStart = { x: 0, y: 0, assetX: 0, assetY: 0 }

const startDrag = (e, asset) => {
  if (editMode.value === null) return
  isDragging.value = true
  dragStart.x = e.clientX
  dragStart.y = e.clientY
  dragStart.assetX = asset.x || 0
  dragStart.assetY = asset.y || 0
  
  const moveHandler = (ev) => {
    if (!isDragging.value) return
    const dx = ev.clientX - dragStart.x
    const dy = ev.clientY - dragStart.y
    asset.x = dragStart.assetX + dx
    asset.y = dragStart.assetY + dy
  }
  const upHandler = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', moveHandler)
    document.removeEventListener('mouseup', upHandler)
  }
  document.addEventListener('mousemove', moveHandler)
  document.addEventListener('mouseup', upHandler)
}

const getSurfaceClass = (idx) => {
  if (idx === 1) return 'nl-img-surface-2'
  return 'nl-img-surface-1'
}

const pricingDefaults = [
  { label: 'Small', dim: '48 in x 22 in', cost: '1415', size: 'Small' },
  { label: 'Medium', dim: '60 in x 28 in', cost: '2125', size: 'Medium' },
  { label: 'Large', dim: '72 in x 34 in', cost: '3001', size: 'Large' }
]

const ensureDefaults = () => {
  // Ensure at least 2 assets
  while (props.page.assets.length < 2) {
    props.page.assets.push({ ...nlDefaults[props.page.assets.length] || nlDefaults[2] })
  }
  props.page.assets.forEach(a => {
    if (typeof a.zoom === 'undefined') a.zoom = 1
    if (typeof a.x === 'undefined') a.x = 0
    if (typeof a.y === 'undefined') a.y = 0
  })

  // Ensure Pricing
  if (!props.page.pricing || props.page.pricing.length === 0) {
    props.page.pricing = JSON.parse(JSON.stringify(pricingDefaults))
  } else {
    // REMOVED FORCED REFILL to allow empty values
  }
  
  if (!props.page.color) props.page.color = 'Same as Mockup'
  if (!props.settings.companyName) props.settings.companyName = 'Signage Crafting'
}

onMounted(() => {
  ensureDefaults()
})

watch(() => props.page.pricing, ensureDefaults, { deep: true })
watch(() => props.page.assets, ensureDefaults, { deep: true })

const handleImageClick = (pi, ai) => {
  if (editMode.value === ai) return
  emit('image-container-clicked', { pageIndex: pi, assetIndex: ai })
  if (!props.pendingAiImage) {
    const el = document.getElementById(`fileInput_${pi}_${ai}`)
    if (el) el.click()
  }
}
const handleFileChange = (e, pi, ai) => {
  const file = e.target.files?.[0]
  if (file) emit('upload-image', { pageIndex: pi, assetIndex: ai, url: URL.createObjectURL(file), mediaType: file.type.startsWith('video/') ? 'video' : 'image' })
}
const calculateDiscount = (price) => {
  if (!price) return null
  const n = parseFloat(price.toString().replace(/[^0-9.]/g, ''))
  if (isNaN(n)) return null
  const d = n * 0.90
  return '$ ' + d.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const addAsset = () => {
  if (props.page.assets.length < 3) {
    props.page.assets.push({ ...nlDefaults[2], label: 'Extra View' })
  }
}
const deleteAsset = (idx) => {
  if (props.page.assets.length > 2) {
    props.page.assets.splice(idx, 1)
  } else {
    if (props.page.assets[idx].src) {
        props.page.assets[idx].src = null; // Clear image
    }
  }
}

// On-demand, per-image vectorizing — only the one sign a client actually approved, not a
// bulk pass over every mockup. Opens a preview so the operator can set the cutoff for this
// particular image and see the outline before downloading; the right cutoff varies per
// mockup, so downloading blind produced unusable files.
const vectorAsset = ref(null)
const vectorSrc = ref(null)
const getVector = (idx, evt) => {
  const asset = props.page.assets[idx]
  if (!asset?.src) return
  const imgEl = evt?.target?.closest('.nl-img-box')?.querySelector('.nl-img')
  vectorSrc.value = imgEl ? cropAssetView(imgEl) : asset.src
  vectorAsset.value = asset
}

const addPriceRow = () => {
  props.page.pricing.push({ label: 'Size', dim: '00in x 00in', cost: 0, size: 'Medium' })
}
const removePriceRow = (idx) => {
  props.page.pricing.splice(idx, 1)
}

const getSizePlaceholder = (index) => {
  const placeholders = ['Small', 'Medium', 'Large']
  return placeholders[index] || 'Size'
}

const hexToRgba = (hex, alpha) => {
  if (!hex) return 'transparent'
  const c = hex.substring(1).split('')
  if (c.length === 3) {
    c.push(c[2], c[1], c[1], c[0], c[0])
  }
  const color = parseInt(hex.substring(1), 16)
  if (isNaN(color)) return 'transparent'
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
</script>

<style scoped>
/* ═══════════════════════════════════════════ */
/* NEXUS LEDS - FUTURISTIC THEME SYSTEM       */
/* ═══════════════════════════════════════════ */
.nl-page {
  width: 297mm !important;
  min-height: 210mm !important;
  max-height: 210mm;
  padding: 0 !important;
  overflow: hidden;
  position: relative;
  font-family: 'Inter', sans-serif;
  color: var(--text-color);
  background: var(--bg-color);
  
  /* DEFAULT (Classic Navy) */
  --bg-color: #0f172a;
  --text-color: #f1f5f9;
  --accent-color: #38bdf8;
  --panel-bg: rgba(30, 41, 59, 0.4);
  --border-color: rgba(148, 163, 184, 0.1);
  --input-bg: rgba(15, 23, 41, 0.6);
}

/* ── THEME: NAVY (Default) ── */
.nl-page.theme-navy {
  --bg-color: #0f172a; 
  --text-color: #f8fafc;
  --accent-color: #38bdf8;
  --panel-bg: rgba(30, 41, 59, 0.5);
  --border-color: rgba(56, 189, 248, 0.15);
}

/* ── THEME: DARK (Onyx) ── */
.nl-page.theme-gray {
  --bg-color: #09090b; 
  --text-color: #fafafa;
  --accent-color: #a1a1aa;
  --panel-bg: rgba(39, 39, 42, 0.5);
  --border-color: rgba(255, 255, 255, 0.1);
}

/* ── THEME: LIGHT (Corporate) ── */
.nl-page.theme-light {
  --bg-color: #ffffff;
  --text-color: #334155;
  --accent-color: #2e63ff; /* User's Blue */
  --panel-bg: rgba(241, 245, 249, 0.8);
  --border-color: rgba(148, 163, 184, 0.2);
  background: #fff;
}
.nl-page.theme-light .nl-img-surface-2 { background: #f1f5f9; }

/* ── THEME: PRO (Futuristic) ── */
.nl-page.theme-pro {
  --bg-color: #050505; /* Deepest Black */
  --text-color: #e2e8f0;
  --accent-color: #00f3ff; /* Neon Cyan */
  --accent-color-glow: rgba(0, 243, 255, 0.4);
  --panel-bg: rgba(10, 15, 30, 0.6); /* Glassy Blue-Black */
  --border-color: rgba(46, 99, 255, 0.3);
  
  /* Advanced Gradient Bg */
  background: radial-gradient(circle at top right, #1a237e 0%, #000000 60%);
  transition: all 0.3s ease;
}
.nl-page.theme-pro .nl-details-card { box-shadow: 0 0 20px rgba(46, 99, 255, 0.15); backdrop-filter: blur(12px); border-radius: 16px; }
.nl-page.theme-pro .nl-img-box { border-radius: 12px; }
.nl-page.theme-pro .nl-badge-circle { box-shadow: 0 0 10px var(--accent-color-glow, transparent); border-color: var(--accent-color-glow, transparent); }

.nl-brand-gradient {
  background: linear-gradient(90deg, #ffffff 40%, var(--accent-color) 100%);
  background-clip: text;
  -webkit-background-clip: text; color: transparent;
}


.nl-wrapper { display: flex; flex-direction: column; height: 100%; z-index: 1; }

.nl-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px;
  background: var(--panel-bg); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-color); flex-shrink: 0;
}
.nl-brand { font-size: 26px; font-weight: 900; text-transform: uppercase; margin: 0; letter-spacing: 0.05em; color: var(--text-color); }
.nl-topbar-right { display: flex; gap: 20px; font-size: 11px; color: var(--text-color); opacity: 0.9; }
.nl-topbar-right i { color: var(--accent-color); margin-right: 5px; }
.nl-top-input { background: transparent; border: none; outline: none; color: inherit; font-size: 11px; width: 150px; }

/* LAYOUT MODES */
.nl-body { display: grid; grid-template-columns: 46% 12% 42%; flex: 1; min-height: 0; transition: grid-template-columns 0.3s ease; }
.layout-wide { grid-template-columns: 58% 10% 32%; } /* Wide Images Mode */

.nl-col-images { display: flex; flex-direction: column; padding: 12px; gap: 8px; }
.nl-img-block { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.nl-img-box {
  flex: 1; border-radius: 8px; overflow: hidden; position: relative;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-color); background: var(--panel-bg);
}
.nl-img-surface-1 { background: var(--panel-bg); }
.nl-img-surface-2 { background: rgba(0,0,0,0.2); }
:global(.theme-light) .nl-img-surface-2 { background: #f1f5f9; }

.nl-img { 
  width: 100%; height: 100%; object-fit: contain; position: absolute; inset: 0; 
  transition: transform 0.1s linear;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: high-quality;
}
.nl-img-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-color); opacity: 0.5; font-size: 11px; }

/* Image Controls */
.nl-img-controls {
  position: absolute; top: 10px; right: 10px; z-index: 10;
  display: flex; gap: 5px;
}
.nl-btn-edit, .nl-btn-replace, .nl-btn-vector {
  background: rgba(0,0,0,0.7); color: white; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; text-transform: uppercase; font-weight: 700;
  backdrop-filter: blur(4px);
}
.nl-btn-edit:hover { background: var(--accent-color); color: #000; }
.nl-btn-vector:hover { background: var(--accent-color); color: #000; }

.nl-edit-panel {
  position: absolute; bottom: 10px; left: 10px; right: 10px; z-index: 20;
  background: rgba(0,0,0,0.9); border: 1px solid var(--accent-color); border-radius: 6px;
  padding: 8px; display: flex; flex-direction: column; gap: 6px; color: white;
}
.nl-edit-row { display: flex; justify-content: space-between; align-items: center; font-size: 10px; }
.nl-btn-done { background: var(--accent-color); color: #000; padding: 2px 8px; border-radius: 3px; font-weight: 700; }
.nl-zoom-pct {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-color);
  min-width: 40px;
  text-align: center;
  background: rgba(0,0,0,0.5);
  padding: 1px 6px;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
}

.nl-file-wrap { display: none !important; }
.nl-img-caption { padding: 2px 0; }
.nl-caption-input { background: transparent; border: none; outline: none; color: var(--text-color); font-size: 10px; font-weight: 700; width: 100%; }

/* BADGES - MASSIVE UPDATE */
.nl-col-badges {
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  padding: 15px 4px; background: rgba(0,0,0,0.05);
  gap: 15px;
}
.nl-badge { display: flex; flex-direction: column; align-items: center; text-align: center; width: 100%; }
.nl-badge-title { 
  display: block; width: 100%;
  font-size: 10px; font-weight: 800; text-transform: uppercase; 
  color: var(--text-color); margin-top: 6px; margin-bottom: 2px;
  line-height: 1.2; letter-spacing: 0.5px;
}
.nl-badge-sub { 
  display: block; width: 100%;
  font-size: 9px; color: var(--text-color); opacity: 0.7; 
  font-weight: 400; letter-spacing: 0.3px;
}
.nl-badge-circle {
  width: 75px; height: 75px;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-color); font-size: 38px;
  background: var(--panel-bg); overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  transition: all 0.3s ease;
}
.nl-badge-img { width: 85%; height: 85%; object-fit: contain; } /* INCREASED IMAGE SIZE */


.nl-col-details { padding: 12px 14px; display: flex; flex-direction: column; }
.nl-details-card {
  flex: 1; display: flex; flex-direction: column;
  background: var(--panel-bg); backdrop-filter: blur(5px);
  border-radius: 12px; padding: 14px;
  border: 1px solid var(--border-color);
}
.nl-details-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: var(--text-color); margin-bottom: 8px; border-bottom: 1px solid var(--border-color); }
.nl-client-name { width: 100%; font-size: 16px; font-weight: 700; font-style: italic; color: var(--text-color); background: transparent; border: none; outline: none; margin-bottom: 4px; }
.nl-client-email { width: 100%; font-size: 11px; font-weight: 400; color: var(--text-color); background: transparent; border: none; outline: none; margin-bottom: 12px; opacity: 0.8; }

.nl-specs { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.nl-spec { display: flex; align-items: center; font-size: 11px; padding: 1px 0; }
.nl-spec-k { font-weight: 700; text-transform: uppercase; color: var(--text-color); opacity: 0.7; min-width: 110px; font-size: 10px; }
.nl-spec-s { margin: 0 5px; color: var(--accent-color); }
.nl-spec-v { background: transparent; border: none; outline: none; color: var(--text-color); font-size: 11px; flex: 1; }

.nl-pricing-table { margin-top: 6px; margin-bottom: 12px; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.1); }
.nl-table { width: 100%; border-collapse: collapse; }
.nl-table th { background: rgba(0,0,0,0.2); color: var(--text-color); font-size: 12px; font-weight: 800; text-transform: uppercase; padding: 8px; text-align: center; border-bottom: 1px solid var(--border-color); }
.nl-table td { padding: 8px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-color); font-size: 13px; vertical-align: middle; }
.nl-table-input { background: transparent; border: none; outline: none; color: inherit; width: 100%; text-align: center; font-weight: 600; font-size: 13px; }

.nl-size-badge {
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto;
  padding: 4px 10px; width: 80px; height: 30px;
  border-radius: 15px;
  background: transparent;
  border: 1.5px solid rgba(255,255,255,0.3);
  color: #ffffff;
}
.nl-input-badge { font-size: 13px; font-weight: 800; color: #ffffff; text-align: center; letter-spacing: 0.3px; }
.nl-print-only { display: none; }

.nl-package { margin-top: auto; border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.02); }
.nl-pkg-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--text-color); margin-bottom: 8px; border-bottom: 1px solid var(--border-color); }
.nl-pkg-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.nl-pkg-item { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; font-size: 8px; font-weight: 600; color: var(--text-color); }
.nl-pkg-icon { width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--accent-color); }

/* ═══════ FOOTER ═══════ */
.nl-footer {
  border-top: 1px solid var(--border-color);
  padding: 15px 25px; flex-shrink: 0;
  background: var(--bg-color); /* Match theme bg */
  background: var(--bg-color); /* Match theme bg */
}

/* ═══════════════════════════════════════════ */
/* PDF GENERATION OVERRIDES (HTML2CANVAS)      */
/* ═══════════════════════════════════════════ */
:global(body.is-generating-pdf) .nl-pricing-table,
:global(body.is-generating-pdf) .nl-img-controls,
:global(body.is-generating-pdf) .nl-edit-panel,
:global(body.is-generating-pdf) .no-print,
:global(body.is-generating-pdf) .nl-input-badge {
  display: none !important;
}

:global(body.is-generating-pdf) .nl-print-only-table {
  display: block !important;
  margin-top: 6px; margin-bottom: 12px;
  border: 1px solid rgba(0,243,255,0.3);
  background: transparent;
}
:global(body.is-generating-pdf) .nl-print-only-table .nl-table th {
  background: rgba(0,243,255,0.12) !important;
  color: #00f3ff !important;
  border-bottom: 1.5px solid rgba(0,243,255,0.4);
  font-size: 12px; padding: 6px 8px;
  text-transform: uppercase; letter-spacing: 0.05em;
}
:global(body.is-generating-pdf) .nl-print-only-table .nl-table td {
  color: #ffffff !important;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 7px 8px; font-size: 13px;
  vertical-align: middle; text-align: center;
}
:global(body.is-generating-pdf) .nl-print-badge-cell {
  display: inline-flex !important;
  align-items: center; justify-content: center;
  font-weight: 800; text-transform: uppercase; font-size: 13px;
  background: transparent !important;
  border-radius: 14px;
  padding: 3px 12px !important;
  border: 1.5px solid rgba(255,255,255,0.4);
  color: #ffffff !important;
  letter-spacing: 0.3px;
}

:global(body.is-generating-pdf) .nl-img-box {
  background: #fff !important; border: 1px solid #ddd !important;
}
:global(body.is-generating-pdf) .nl-page {
  width: 794px !important;
  min-height: 1123px !important;
  height: auto !important;
  overflow: visible !important;
}

.nl-footer-content {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px;
}
.nl-footer-section { display: flex; flex-direction: column; }
.nl-footer-section-right { align-items: flex-end; text-align: right; }

.nl-footer-title {
  font-size: 10px; font-weight: 800; text-transform: uppercase;
  color: var(--accent-color); margin-bottom: 6px; letter-spacing: 0.05em;
}

.nl-footer-list { list-style: none; padding: 0; margin: 0; }
.nl-footer-list li {
  font-size: 9px; color: var(--text-color); margin-bottom: 3px; line-height: 1.4; opacity: 0.9;
}
.nl-footer-text {
  font-size: 8px; color: var(--text-color); opacity: 0.6; line-height: 1.5;
}

/* Print */
@media print {
  .nl-page { width: 297mm !important; min-height: 210mm !important; }
  .nl-page::before { display: none; }
  @page { size: landscape; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* PRINT TABLE STYLES */
  .nl-pricing-table, .nl-img-controls, .nl-edit-panel, .no-print { display: none !important; }

  .nl-print-only-table { 
    display: block !important; 
    margin-top: 6px; margin-bottom: 12px;
    border: 1px solid #ccc;
    background: transparent;
  }
  .nl-print-only-table .nl-table th { 
    background: #f3f4f6 !important; color: #000 !important; border-bottom: 2px solid #000; 
    font-size: 10px; padding: 4px;
  }
  .nl-print-only-table .nl-table td { 
    color: #000 !important; border-bottom: 1px solid #ddd; 
    padding: 6px; font-size: 11px;
  }
  .nl-print-badge-cell {
    font-weight: 800; text-transform: uppercase; font-size: 11px;
    background: #e5e7eb !important; border-radius: 12px;
    padding: 2px 8px !important; display: inline-block;
    margin: 4px; border: 1px solid #000;
  }

  /* Reset other hacks */
  .nl-size-badge::after { content: none !important; }
  .nl-print-only { display: none !important; }
  
  /* Ensure images play nice */
  .nl-img-box { background: #fff !important; border: 1px solid #ddd !important; }
}

.nl-print-only-table { display: none; }
  


.nl-add-row-bar {
    text-align: center; font-size: 10px; padding: 4px; cursor: pointer;
    background: rgba(255,255,255,0.05); color: var(--text-color); opacity: 0.6;
}
.nl-add-row-bar:hover { opacity: 1; background: rgba(255,255,255,0.1); }
.nl-btn-del-row { 
    background: transparent; color: #ef4444; border: none; cursor: pointer; font-size: 14px; font-weight: bold; padding: 0 4px;
}
.nl-btn-del-row:hover { color: #ff0000; }

.nl-add-img-btn {
  margin-top: 10px; padding: 10px; border: 1px dashed var(--border-color);
  border-radius: 8px; text-align: center; cursor: pointer;
  color: var(--accent-color); font-size: 11px; font-weight: 600;
  transition: all 0.2s;
}
.nl-add-img-btn:hover { background: rgba(46,99,255,0.1); border-color: var(--accent-color); }
.nl-btn-del {
    background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);
    padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; margin-left: 4px;
}
.nl-btn-del:hover { background: #ef4444; color: white; }
</style>
