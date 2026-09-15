<template>
  <div 
    class="a4-page proposal-page"
    :class="[currentTheme]"
    :data-page-index="pageIndex"
    :style="customThemeStyle"
  >
    <div class="page-content-wrapper">
      <!-- Header -->
      <PageHeader
        :settings="settings"
        :client-name="clientName"
        :contact-email="contactEmail"
        @update:client-name="$emit('update:clientName', $event)"
        @update:contact-email="$emit('update:contactEmail', $event)"
      />

      <!-- Main Content (Two Columns) -->
      <div class="flex gap-6 flex-grow" :class="layoutClass">
        
        <!-- Left Column (Pricing & Specs) -->
        <div :class="leftColumnClass">
          
          <!-- Pricing Table -->
          <div class="mb-6">
            <div class="theme-card theme-text-accent text-[10px] font-bold uppercase px-3 py-1 mb-2 inline-block rounded border border-current shadow-sm" style="border-width: 1px;">
              Pricing
            </div>
            
            <table class="w-full text-sm border-collapse mt-1">
              <thead>
                <tr class="theme-border-b">
                  <th class="py-2 px-2 text-left text-[10px] theme-text-muted uppercase font-bold tracking-wider w-[15%]">Size</th>
                  <th class="py-2 px-2 text-center text-[10px] theme-text-muted uppercase font-bold tracking-wider w-[60%]">Dimensions</th>
                  <th class="py-2 px-2 text-right text-[10px] theme-text-muted uppercase font-bold tracking-wider w-[25%]">Price</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="(p, idx) in page.pricing" 
                  :key="idx"
                  class="theme-border-b hover:bg-white/5 transition-colors"
                >
                  <td class="py-3 px-2 font-bold w-[15%]">
                    <input v-model="p.size" class="editable-input" />
                  </td>
                  <td class="py-3 px-2 w-[60%] text-center">
                    <input v-model="p.dim" class="editable-input theme-text-muted text-xs text-center" />
                  </td>
                  <td class="py-3 px-2 w-[25%] text-right">
                      <div class="flex flex-col items-end justify-center">
                        <span v-if="p.discounted" class="bg-teal-900/50 text-teal-400 px-1 py-0 rounded text-[7px] font-bold whitespace-nowrap mb-0.5">PDF DISCOUNT</span>
                        <span v-else-if="p.cost" class="bg-teal-900/50 text-teal-400 px-1 py-0 rounded text-[7px] font-bold whitespace-nowrap mb-0.5">15% OFF</span>
                        <div class="flex items-center">
                          <span class="theme-text-accent font-bold mr-0.5">$</span>
                          <span class="text-right font-bold theme-text-accent text-lg leading-none">{{ p.discounted || calculateDiscount(p.cost) || '0' }}</span>
                        </div>
                        <a v-if="page.id" :href="`https://signagecrafting.vercel.app/api/stripe/pay/${$route.params.clientId}?itemId=${page.id}&priceIdx=${idx}`" target="_blank" class="mt-2 text-[9px] bg-blue-600 text-white px-2 py-1 rounded font-bold uppercase hover:bg-blue-700 transition-colors inline-block no-underline shadow-sm" style="position: relative; z-index: 50;">
                          <i class="fas fa-lock mr-1"></i> Pay Now
                        </a>
                      </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Specifications -->
          <div class="mb-4">
            <div class="theme-card p-5 rounded-lg shadow-md">
              <h4 class="text-[10px] font-bold uppercase theme-text-muted mb-3 tracking-widest theme-border-b pb-2 flex items-center gap-2">
                <i class="fas fa-list-ul"></i> Specifications
              </h4>
              
              <div class="space-y-1.5 text-xs">
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Sign Type:</span> 
                  <input v-model="page.signType" class="editable-input text-right font-bold w-2/3" />
                </div>
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Dimensions:</span> 
                  <span class="text-right font-medium">See Pricing</span>
                </div>
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Finish:</span> 
                  <input v-model="page.finish" class="editable-input text-right w-1/2" />
                </div>
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Illuminated:</span> 
                  <input v-model="page.illuminated" class="editable-input text-right w-1/2" />
                </div>
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Usage:</span> 
                  <input v-model="page.usage" class="editable-input text-right w-1/2" />
                </div>
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase whitespace-nowrap">UL Certificate:</span> 
                  <input v-model="page.ulCert" class="editable-input text-right flex-1 min-w-0 text-[9px]" />
                </div>
                <div class="flex justify-between items-center py-1.5 theme-border-b border-opacity-30">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Permit:</span> 
                  <input v-model="page.permit" class="editable-input text-right w-1/2" />
                </div>
                <div class="flex justify-between items-center py-1.5">
                  <span class="font-bold theme-text-muted text-[10px] uppercase">Installation:</span> 
                  <input v-model="page.install" class="editable-input text-right w-1/2" />
                </div>
              </div>
            </div>
          </div>

          <!-- Package Included - Flex grow to push footer down if needed or just fill space -->
          <div class="mt-auto">
            <div class="theme-card p-4 rounded-lg shadow-md h-full">
              <h4 class="text-center font-bold text-xs uppercase theme-text-muted mb-4 tracking-widest theme-border-b pb-2">
                Package Included
              </h4>
              <div class="grid grid-cols-2 gap-y-4 gap-x-2">
                <div class="flex items-center">
                  <div class="w-8 h-8 rounded-full theme-card flex items-center justify-center border border-current theme-text-accent mr-3">
                    <i class="fas fa-screwdriver text-xs"></i>
                  </div>
                  <div>
                    <p class="text-[10px] font-bold leading-none">Mounting</p>
                    <p class="text-[9px] theme-text-muted leading-none mt-0.5">Hardware</p>
                  </div>
                </div>
                <div class="flex items-center">
                  <div class="w-8 h-8 rounded-full theme-card flex items-center justify-center border border-current theme-text-accent mr-3">
                    <i class="fas fa-book-open text-xs"></i>
                  </div>
                  <div>
                    <p class="text-[10px] font-bold leading-none">Install</p>
                    <p class="text-[9px] theme-text-muted leading-none mt-0.5">Guide Book</p>
                  </div>
                </div>
                <div class="flex items-center">
                  <div class="w-8 h-8 rounded-full theme-card flex items-center justify-center border border-current theme-text-accent mr-3">
                    <i class="fas fa-plug text-xs"></i>
                  </div>
                  <div>
                    <p class="text-[10px] font-bold leading-none">Power</p>
                    <p class="text-[9px] theme-text-muted leading-none mt-0.5">Supply Unit</p>
                  </div>
                </div>
                <div class="flex items-center">
                  <div class="w-8 h-8 rounded-full theme-card flex items-center justify-center border border-current theme-text-accent mr-3">
                    <i class="fas fa-lightbulb text-xs"></i>
                  </div>
                  <div>
                    <p class="text-[10px] font-bold leading-none">LED</p>
                    <p class="text-[9px] theme-text-muted leading-none mt-0.5">Lighting</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Right Column (Images) - ALIGNMENT FIX: Use Flex Column to fill height -->
        <div :class="rightColumnClass" class="flex flex-col h-full">
          
          <div 
            v-for="(asset, aIdx) in page.assets" 
            :key="aIdx"
            class="flex flex-col gap-0 flex-1 relative group"
          >
            <!-- IMAGE BOX -->
            <div 
              @drop.prevent="handleDrop($event, pageIndex, aIdx)"
              @dragover.prevent
              @dragenter="asset.isDragging = true"
              @dragleave="asset.isDragging = false"
              @click="handleImageClick(pageIndex, aIdx)"
              class="rounded-t-lg flex flex-col items-center justify-center relative overflow-hidden shadow-lg border border-gray-700/50 transition-all image-container cursor-pointer w-full flex-1"
              :class="[
                asset.style === 'drawing' ? (asset.bgTransparent ? 'theme-card' : 'style-drawing') : ['mockup-container', page.bgClass],
                asset.isDragging ? 'border-cyan-400 border-dashed bg-cyan-900/20' : '',
                pendingAiImage ? 'pending-ai-glow' : ''
              ]"
            >
              
              <!-- Hidden file input -->
              <input 
                :id="`fileInput_${pageIndex}_${aIdx}`"
                type="file" 
                accept="image/*,video/*"
                @change="handleFileChange($event, pageIndex, aIdx)"
                @click.stop
                class="hidden no-print"
                style="display: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; opacity: 0 !important; position: absolute !important; top: -9999px !important; left: -9999px !important; pointer-events: none !important;"
                hidden
                aria-hidden="true"
              />

              <!-- PROFESSIONAL TAG STYLE -->
              <div 
                  class="absolute top-0 left-0 right-0 h-6 bg-black/80 backdrop-blur-sm border-b border-white/10 flex items-center px-3 z-30"
              >
                 <input 
                  v-model="asset.label"
                  class="bg-transparent border-none outline-none text-[9px] font-bold uppercase tracking-widest text-white w-full"
                  placeholder="Label"
                  @click.stop
                />
              </div>

              <!-- Delete Button -->
              <button
                v-if="asset.src"
                @click.stop="$emit('delete-image', { pageIndex, assetIndex: aIdx })"
                class="delete-image-btn no-print"
                title="Delete image"
              >
                <i class="fas fa-trash"></i>
              </button>

              <!-- Control Buttons (Fit/Fill) -->
              <div v-if="asset.src" class="absolute top-8 right-2 flex gap-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity no-print">
                 <button 
                  @click.stop="asset.aspectRatio = asset.aspectRatio === 'contain' ? 'cover' : 'contain'" 
                  class="bg-black/70 text-white text-[10px] px-2 py-1 rounded border border-white/20 hover:bg-cyan-600 font-bold"
                  title="Toggle Fit/Fill"
                >
                   {{ asset.aspectRatio === 'contain' ? 'FILL' : 'FIT' }}
                 </button>
              </div>

              <!-- IMAGE CONTENT -->
              <div class="relative w-full h-full overflow-hidden bg-white/5">
                  <img 
                    v-if="asset.src && asset.mediaType !== 'video'" 
                    :src="asset.src" 
                    class="absolute w-full h-full"
                    :class="asset.aspectRatio === 'contain' ? 'object-contain' : 'object-cover'"
                    draggable="false"
                  />
                  
                  <video 
                    v-else-if="asset.mediaType === 'video'" 
                    :src="asset.src" 
                    autoplay loop muted playsinline 
                    class="absolute w-full h-full object-cover pointer-events-none"
                  ></video>

                  <!-- Empty State -->
                  <div 
                    v-else 
                    class="flex flex-col items-center justify-center w-full h-full text-gray-400 pointer-events-none"
                  >
                    <i class="fas fa-image text-3xl mb-2 opacity-30"></i>
                    <span class="text-[10px] font-bold opacity-50">Click to upload</span>
                  </div>
              </div>

            </div>
          </div>

          <div 
            v-if="page.assets.length === 0" 
            class="border-2 border-dashed border-gray-500 border-opacity-30 rounded-lg flex items-center justify-center flex-1 theme-text-muted text-xs"
          >
            No images added
          </div>

        </div>
      </div>

      <!-- Footer & Trust Bar -->
      <PageFooter
        :footer="footer"
        :settings="settings"
        @update:instruction1="$emit('update:instruction1', $event)"
        @update:instruction2="$emit('update:instruction2', $event)"
        @update:instruction3="$emit('update:instruction3', $event)"
        @update:delivery="$emit('update:delivery', $event)"
        @update:note="$emit('update:note', $event)"
      />

      <TrustBar :items="settings.trustBarItems" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useProposalStore } from '@/stores/proposalStore'
import { useProposalTheme } from '@/composables/useProposalTheme'
import PageHeader from './PageHeader.vue'
import PageFooter from './PageFooter.vue'
import TrustBar from './TrustBar.vue'

const props = defineProps({
  page: { type: Object, required: true },
  pageIndex: { type: Number, required: true },
  settings: { type: Object, required: true },
  clientName: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  footer: { type: Object, required: true },
  pendingAiImage: { type: String, default: null },
  layout: { type: String, default: 'default', validator: (v) => ['default', 'image-left', 'stacked'].includes(v) }
})

const emit = defineEmits([
  'update:clientName', 'update:contactEmail',
  'update:instruction1', 'update:instruction2', 'update:instruction3',
  'update:delivery', 'update:note',
  'image-container-clicked', 'delete-image', 'upload-image'
])

const proposalStore = useProposalStore()
const { currentTheme } = storeToRefs(proposalStore)

const layoutClass = computed(() => {
  switch (props.layout) {
    case 'image-left': return 'flex-row-reverse'
    case 'stacked': return 'flex-col'
    default: return ''
  }
})

const leftColumnClass = computed(() => {
  if (props.layout === 'stacked') return 'w-full flex flex-col'
  return 'w-5/12 flex flex-col flex-grow' // Allow grow
})

const rightColumnClass = computed(() => {
  if (props.layout === 'stacked') return 'w-full flex flex-col gap-4'
  return 'w-7/12 flex flex-col gap-4 h-full'
})

const handleImageClick = (pageIndex, assetIndex) => {
  emit('image-container-clicked', { pageIndex, assetIndex })
  if (!props.pendingAiImage) {
    const fileInput = document.getElementById(`fileInput_${pageIndex}_${assetIndex}`)
    if (fileInput) fileInput.click()
  }
}

const handleFileChange = (event, pageIndex, assetIndex) => {
  const file = event.target.files?.[0]
  if (file) {
    const url = URL.createObjectURL(file)
    const mediaType = file.type.startsWith('video/') ? 'video' : 'image'
    emit('upload-image', { pageIndex, assetIndex, url, mediaType })
  }
}

const handleDrop = (event, pageIndex, assetIndex) => {
  const files = event.dataTransfer.files
  if (files.length > 0) {
    const file = files[0]
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file)
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image'
      emit('upload-image', { pageIndex, assetIndex, url, mediaType })
    }
  }
}

const calculateDiscount = (price) => {
  if (!price) return null
  const n = parseFloat(price.toString().replace(/[^0-9.]/g, ''))
  if (isNaN(n)) return null
  const d = n * 0.90
  return d.toLocaleString('en-US', { minimumFractionDigits: d % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
}

const customThemeStyle = useProposalTheme(computed(() => props.settings))
</script>

<style scoped>
/* 
  THEME OVERRIDES FOR COMPANY 1 (Luminus)
  Basically ensuring it behaves like the other proposal pages 
*/

.proposal-page {
  /* Ensure it fills height like others */
  display: flex; 
  flex-direction: column;
}

.page-content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Delete Button */
.delete-image-btn {
  position: absolute;
  top: 30px; /* Below the label bar */
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.9);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 25;
  font-size: 10px;
}
.image-container:hover .delete-image-btn { opacity: 1; }
.delete-image-btn:hover { background: #dc2626; }

/* Drag & Drop Zone */
.drag-drop-zone { transition: all 0.3s ease; }
.pending-ai-glow { animation: ai-glow 2s infinite; border-color: #22d3ee !important; }
@keyframes ai-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(34, 211, 238, 0.4); }
  50% { box-shadow: 0 0 40px rgba(34, 211, 238, 0.8); }
}

/* Theme Pro Integration */
.theme-pro {
  background: radial-gradient(circle at top right, #1a237e 0%, #000000 60%);
  color: #e2e8f0;
}
</style>
