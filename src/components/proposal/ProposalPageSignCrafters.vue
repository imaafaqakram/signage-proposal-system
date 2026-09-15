<template>
  <div 
    class="a4-page proposal-page sc-page"
    :class="theme"
    :data-page-index="pageIndex"
    :style="customThemeStyle"
  >
    <div class="sc-wrapper">

      <!-- ═══════ MAIN 3-COLUMN GRID ═══════ -->
      <div class="sc-grid">

        <!-- ══ LEFT COLUMN ══ -->
        <div class="sc-col-left">
          <!-- Quote Details Card -->
          <div class="sc-card sc-quote-card">
            <h3 class="sc-card-title">Quote Details</h3>
            <input 
              :value="clientName" 
              @input="$emit('update:clientName', $event.target.value)"
              class="sc-client-name" 
              placeholder="Client Name"
            />
            <input
              :value="contactEmail"
              @input="$emit('update:contactEmail', $event.target.value)"
              class="sc-client-email"
              placeholder="client@email.com"
            />
            <div class="sc-specs">
              <div class="sc-spec" :class="{ 'field-flagged': hasWarning('signType') }" :title="hasWarning('signType') ? 'Flagged — verify before sending' : ''"><span class="sc-spec-k">SIGN TYPE</span><span class="sc-spec-s">:</span><input v-model="page.signType" class="sc-spec-v" /><i v-if="hasWarning('signType')" class="fas fa-triangle-exclamation field-flag-icon no-print" title="Verified — click to dismiss" @click.stop="dismissWarning('signType')"></i></div>
              <div class="sc-spec" :class="{ 'field-flagged': hasWarning('dims') }" :title="hasWarning('dims') ? 'Flagged — verify before sending' : ''"><span class="sc-spec-k">DIMENSIONS</span><span class="sc-spec-s">:</span><input :value="page.pricing?.[0]?.dim || ''" @input="page.pricing[0] && (page.pricing[0].dim = $event.target.value)" class="sc-spec-v" /><i v-if="hasWarning('dims')" class="fas fa-triangle-exclamation field-flag-icon no-print" title="Verified — click to dismiss" @click.stop="dismissWarning('dims')"></i></div>
              <div class="sc-spec"><span class="sc-spec-k">COLOR</span><span class="sc-spec-s">:</span><input v-model="page.color" class="sc-spec-v" /></div>
              <div class="sc-spec"><span class="sc-spec-k">FINISH</span><span class="sc-spec-s">:</span><input v-model="page.finish" class="sc-spec-v" /></div>
              <div class="sc-spec"><span class="sc-spec-k">ILLUMINATED</span><span class="sc-spec-s">:</span><input v-model="page.illuminated" class="sc-spec-v" /></div>
              <div class="sc-spec"><span class="sc-spec-k">USAGE</span><span class="sc-spec-s">:</span><input v-model="page.usage" class="sc-spec-v" /></div>
              <div class="sc-spec"><span class="sc-spec-k">UL CERTIFICATION</span><span class="sc-spec-s">:</span><input v-model="page.ulCert" class="sc-spec-v" /></div>
              <div class="sc-spec"><span class="sc-spec-k">PERMIT</span><span class="sc-spec-s">:</span><input v-model="page.permit" class="sc-spec-v" /></div>
              <div class="sc-spec"><span class="sc-spec-k">INSTALLATION</span><span class="sc-spec-s">:</span><input v-model="page.install" class="sc-spec-v" /></div>
            </div>
            <!-- Pricing Table & Discount Controls -->
            <div class="sc-add-row-bar no-print" @click="addPriceRow">+ Add Size Option</div>
            <div class="sc-discount-controls no-print">
              <label>Discount</label>
              <select v-model="discountPreset" class="sc-discount-select">
                <option v-for="p in discountPresets" :key="p" :value="String(p)">{{ p === 0 ? 'None' : `${p}%` }}</option>
                <option value="custom">Custom</option>
              </select>
              <input
                v-if="discountPreset === 'custom'"
                type="number" min="0" max="100" v-model.number="page.discountPercent"
                class="sc-discount-custom" placeholder="%"
              />
              <button
                type="button"
                class="sc-discount-apply-all"
                title="Apply this discount to every sign on this proposal"
                @click="$emit('apply-discount-all', page.discountPercent)"
              >
                <i class="fas fa-copy"></i> Apply to all
              </button>
            </div>
            <div class="sc-pricing-table" v-if="page.pricing?.length" :class="{ 'field-flagged': hasWarning('pricing') }" :title="hasWarning('pricing') ? 'Flagged — verify before sending' : ''">
              <i v-if="hasWarning('pricing')" class="fas fa-triangle-exclamation field-flag-icon field-flag-icon--pricing no-print" title="Verified — click to dismiss" @click.stop="dismissWarning('pricing')"></i>

              <table class="sc-table">
                <thead>
                  <tr>
                    <th style="width:22%">Size</th>
                    <th style="width:30%">Dimension</th>
                    <th style="width:22%">Price</th>
                    <th style="width:26%">Disc. Price</th>
                    <th class="no-print" style="width:16px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(p, idx) in page.pricing" :key="idx">
                    <td><span class="sc-size-badge"><input v-model="p.size" class="sc-size-input" /></span></td>
                    <td><input v-model="p.dim" class="sc-dim-input" /></td>
                    <td class="sc-nowrap" :class="{ 'sc-td-price': effectiveDiscount > 0 }">
                      $<input v-model="p.cost" class="sc-cost-input" :class="{ 'sc-cost-strike': effectiveDiscount > 0 }" placeholder="0" />
                    </td>
                    <td class="sc-nowrap" :class="{ 'sc-td-discount': effectiveDiscount > 0 || p.discounted }">
                      $ {{ p.discounted || calculateDiscount(p.cost) || '0' }}
                      <br>
                      <a v-if="page.id" :href="`https://signagecrafting.vercel.app/api/stripe/pay/${$route.params.clientId}?itemId=${page.id}&priceIdx=${idx}`" target="_blank" class="mt-2 text-[9px] bg-blue-600 text-white px-2 py-1 rounded font-bold uppercase hover:bg-blue-700 transition-colors inline-block no-underline shadow-sm" style="margin-top: 8px; position: relative; z-index: 50;">
                        <i class="fas fa-lock" style="margin-right: 4px;"></i> Pay Now
                      </a>
                    </td>
                    <td class="no-print sc-del-cell"><button @click="removePriceRow(idx)" class="sc-btn-del-row" title="Remove">×</button></td>
                  </tr>
                </tbody>
              </table>
              <!-- Discount Display Badge -->
              <div v-if="effectiveDiscount > 0" class="sc-discount-box">
                <i class="fas fa-tag" style="color: #ef4444; font-size: 10px;"></i>
                <span class="sc-discount-lbl">Discount Applied</span>
                <input type="text" :value="`${effectiveDiscount}% OFF`" readonly class="sc-discount-val" />
              </div>
            </div>
            <!-- Discount & Buy box removed -->
          </div>

          <!-- Package Includes Card -->
          <div class="sc-card sc-package-card">
            <h3 class="sc-card-title">Your Package Includes</h3>
            <div class="sc-pkg-grid">
              <div class="sc-pkg-item">
                <div class="sc-pkg-icon"><i class="fas fa-sign"></i></div>
                <span>Your Sign</span>
              </div>
              <div class="sc-pkg-item">
                <div class="sc-pkg-icon"><i class="fas fa-screwdriver"></i></div>
                <span>Screws</span>
              </div>
              <div class="sc-pkg-item sc-pkg-full">
                <div class="sc-pkg-icon"><i class="fas fa-book-open"></i></div>
                <span>Installation Guide</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ CENTER COLUMN (3 images stacked) ══ -->
        <div class="sc-col-center">
          <!-- Sketch -->
          <div class="sc-img-block" v-if="page.assets?.[0]" :class="{ 'sc-edit-mode': editMode === 0 }" @mouseenter="hoverAsset = 0" @mouseleave="hoverAsset = null">
            <div class="sc-img-label"><input v-model="page.assets[0].label" class="sc-img-label-input" /></div>
            <div class="sc-img-box sc-img-white" :class="[page.assets[0]?.isDragging ? 'sc-drag-active' : '', hasWarning('drawing') ? 'field-flagged' : '']"
              :title="hasWarning('drawing') ? 'Flagged — verify before sending' : ''"
              @drop.prevent="handleDrop($event, pageIndex, 0)" @dragover.prevent
              @dragenter="page.assets[0].isDragging = true" @dragleave="page.assets[0].isDragging = false"
              @click="handleImageClick(pageIndex, 0)">
              <i v-if="hasWarning('drawing')" class="fas fa-triangle-exclamation field-flag-icon field-flag-icon--img no-print" title="Verified — click to dismiss" @click.stop="dismissWarning('drawing')"></i>
              <img v-if="page.assets[0]?.src" :src="page.assets[0].src" class="sc-img"
                   :style="{ transform: `scale(${page.assets[0].zoom || 1}) translate(${page.assets[0].x || 0}px, ${page.assets[0].y || 0}px)` }"
                   @mousedown.stop="startDrag($event, page.assets[0])" draggable="false" />
              <div v-else class="sc-img-empty"><i class="fas fa-pencil-ruler"></i><span>Click to upload Sketch</span></div>
              
              <div v-if="page.assets[0]?.src && hoverAsset === 0 && editMode !== 0" class="sc-img-controls no-print" @click.stop>
                 <button @click="editMode = 0" class="sc-btn-edit"><i class="fas fa-arrows-alt"></i> Adjust</button>
                 <button @click="$emit('upload-image', { pageIndex, assetIndex: 0 })" class="sc-btn-replace" title="Replace Image"><i class="fas fa-sync"></i></button>
                 <button @click="getVector(0, $event)" class="sc-btn-vector" title="Vectorize this image"><i class="fas fa-bezier-curve"></i></button>
                 <button @click="deleteAsset(0)" class="sc-btn-del" title="Remove Image"><i class="fas fa-trash"></i></button>
              </div>

              <div v-if="editMode === 0" class="sc-edit-panel no-print" @click.stop>
                <div class="sc-edit-row">
                  <label>Zoom</label>
                  <span class="sc-zoom-pct">{{ Math.round((page.assets[0].zoom || 1) * 100) }}%</span>
                  <input type="range" v-model.number="page.assets[0].zoom" min="0.5" max="3" step="0.1" />
                </div>
                <div class="sc-edit-row">
                  <small>Drag image to pan</small>
                  <button @click="editMode = null" class="sc-btn-done">Done</button>
                </div>
              </div>

              <div class="sc-file-input-wrap"><input type="file" :id="`fileInput_${pageIndex}_0`" accept="image/*,video/*" @change="handleFileChange($event, pageIndex, 0)" /></div>
            </div>
          </div>
          <!-- Day View -->
          <div class="sc-img-block" v-if="page.assets?.[1]" :class="{ 'sc-edit-mode': editMode === 1 }" @mouseenter="hoverAsset = 1" @mouseleave="hoverAsset = null">
            <div class="sc-img-label"><input v-model="page.assets[1].label" class="sc-img-label-input" /></div>
            <div class="sc-img-box sc-img-dark" :class="[page.assets[1]?.isDragging ? 'sc-drag-active' : '', hasWarning('day') ? 'field-flagged' : '']"
              :title="hasWarning('day') ? 'Flagged — verify before sending' : ''"
              @drop.prevent="handleDrop($event, pageIndex, 1)" @dragover.prevent
              @dragenter="page.assets[1].isDragging = true" @dragleave="page.assets[1].isDragging = false"
              @click="handleImageClick(pageIndex, 1)">
              <i v-if="hasWarning('day')" class="fas fa-triangle-exclamation field-flag-icon field-flag-icon--img no-print" title="Verified — click to dismiss" @click.stop="dismissWarning('day')"></i>
              <img v-if="page.assets[1]?.src" :src="page.assets[1].src" class="sc-img"
                   :style="{ transform: `scale(${page.assets[1].zoom || 1}) translate(${page.assets[1].x || 0}px, ${page.assets[1].y || 0}px)` }"
                   @mousedown.stop="startDrag($event, page.assets[1])" draggable="false" />
              <div v-else class="sc-img-empty"><i class="fas fa-sun"></i><span>Click to upload Day View</span></div>
              
              <div v-if="page.assets[1]?.src && hoverAsset === 1 && editMode !== 1" class="sc-img-controls no-print" @click.stop>
                 <button @click="editMode = 1" class="sc-btn-edit"><i class="fas fa-arrows-alt"></i> Adjust</button>
                 <button @click="$emit('upload-image', { pageIndex, assetIndex: 1 })" class="sc-btn-replace" title="Replace Image"><i class="fas fa-sync"></i></button>
                 <button @click="getVector(1, $event)" class="sc-btn-vector" title="Vectorize this image"><i class="fas fa-bezier-curve"></i></button>
                 <button @click="deleteAsset(1)" class="sc-btn-del" title="Remove Image"><i class="fas fa-trash"></i></button>
              </div>

              <div v-if="editMode === 1" class="sc-edit-panel no-print" @click.stop>
                <div class="sc-edit-row">
                  <label>Zoom</label>
                  <span class="sc-zoom-pct">{{ Math.round((page.assets[1].zoom || 1) * 100) }}%</span>
                  <input type="range" v-model.number="page.assets[1].zoom" min="0.5" max="3" step="0.1" />
                </div>
                <div class="sc-edit-row">
                  <small>Drag image to pan</small>
                  <button @click="editMode = null" class="sc-btn-done">Done</button>
                </div>
              </div>

              <div class="sc-file-input-wrap"><input type="file" :id="`fileInput_${pageIndex}_1`" accept="image/*,video/*" @change="handleFileChange($event, pageIndex, 1)" /></div>
            </div>
          </div>
          <!-- Night View -->
          <div class="sc-img-block" v-if="page.assets?.[2]" :class="{ 'sc-edit-mode': editMode === 2 }" @mouseenter="hoverAsset = 2" @mouseleave="hoverAsset = null">
            <div class="sc-img-label"><input v-model="page.assets[2].label" class="sc-img-label-input" /></div>
            <div class="sc-img-box sc-img-dark" :class="[page.assets[2]?.isDragging ? 'sc-drag-active' : '', hasWarning('night') ? 'field-flagged' : '']"
              :title="hasWarning('night') ? 'Flagged — verify before sending' : ''"
              @drop.prevent="handleDrop($event, pageIndex, 2)" @dragover.prevent
              @dragenter="page.assets[2].isDragging = true" @dragleave="page.assets[2].isDragging = false"
              @click="handleImageClick(pageIndex, 2)">
              <i v-if="hasWarning('night')" class="fas fa-triangle-exclamation field-flag-icon field-flag-icon--img no-print" title="Verified — click to dismiss" @click.stop="dismissWarning('night')"></i>
              <img v-if="page.assets[2]?.src" :src="page.assets[2].src" class="sc-img"
                   :style="{ transform: `scale(${page.assets[2].zoom || 1}) translate(${page.assets[2].x || 0}px, ${page.assets[2].y || 0}px)` }"
                   @mousedown.stop="startDrag($event, page.assets[2])" draggable="false" />
              <div v-else class="sc-img-empty"><i class="fas fa-moon"></i><span>Click to upload Night View</span></div>
              
              <div v-if="page.assets[2]?.src && hoverAsset === 2 && editMode !== 2" class="sc-img-controls no-print" @click.stop>
                 <button @click="editMode = 2" class="sc-btn-edit"><i class="fas fa-arrows-alt"></i> Adjust</button>
                 <button @click="$emit('upload-image', { pageIndex, assetIndex: 2 })" class="sc-btn-replace" title="Replace Image"><i class="fas fa-sync"></i></button>
                 <button @click="getVector(2, $event)" class="sc-btn-vector" title="Vectorize this image"><i class="fas fa-bezier-curve"></i></button>
                 <button @click="deleteAsset(2)" class="sc-btn-del" title="Remove Image"><i class="fas fa-trash"></i></button>
              </div>

              <div v-if="editMode === 2" class="sc-edit-panel no-print" @click.stop>
                <div class="sc-edit-row">
                  <label>Zoom</label>
                  <span class="sc-zoom-pct">{{ Math.round((page.assets[2].zoom || 1) * 100) }}%</span>
                  <input type="range" v-model.number="page.assets[2].zoom" min="0.5" max="3" step="0.1" />
                </div>
                <div class="sc-edit-row">
                  <small>Drag image to pan</small>
                  <button @click="editMode = null" class="sc-btn-done">Done</button>
                </div>
              </div>

              <div class="sc-file-input-wrap"><input type="file" :id="`fileInput_${pageIndex}_2`" accept="image/*,video/*" @change="handleFileChange($event, pageIndex, 2)" /></div>
            </div>
          </div>
        </div>

        <!-- ══ RIGHT COLUMN ══ -->
        <div class="sc-col-right">
          <!-- Logo + Badges -->
          <div class="sc-card sc-logo-section">
            <div class="sc-logo-area">
              <div class="sc-logo-ornament"><span class="sc-ornament-line"></span><i class="fas fa-gem"></i><span class="sc-ornament-line"></span></div>
              <h2 class="sc-logo-name">{{ settings.companyName }}</h2>
              <div class="sc-logo-tagline">Premium Sign Manufacturing</div>
            </div>
            <div class="sc-badges">
              <div class="sc-badge-item" v-for="(b, i) in trustBadges" :key="i">
                <div class="sc-badge-circle">
                  <img v-if="b.img" :src="b.img" class="sc-badge-img" />
                  <i v-else :class="['fas', b.icon]"></i>
                </div>
                <span class="sc-badge-text">{{ b.label }}</span>
              </div>
            </div>
          </div>
          <!-- Cross Section -->
          <div class="sc-img-block" v-if="page.assets?.[3]" :class="{ 'sc-edit-mode': editMode === 3 }" @mouseenter="hoverAsset = 3" @mouseleave="hoverAsset = null">
            <div class="sc-img-label"><input v-model="page.assets[3].label" class="sc-img-label-input" /></div>
            <div class="sc-img-box sc-img-white" :class="page.assets[3]?.isDragging ? 'sc-drag-active' : ''"
              @drop.prevent="handleDrop($event, pageIndex, 3)" @dragover.prevent
              @dragenter="page.assets[3].isDragging = true" @dragleave="page.assets[3].isDragging = false"
              @click="handleImageClick(pageIndex, 3)">
              <img v-if="page.assets[3]?.src" :src="page.assets[3].src" class="sc-img"
                   :style="{ transform: `scale(${page.assets[3].zoom || 1}) translate(${page.assets[3].x || 0}px, ${page.assets[3].y || 0}px)` }"
                   @mousedown.stop="startDrag($event, page.assets[3])" draggable="false" />
              <div v-else class="sc-img-empty"><i class="fas fa-drafting-compass"></i><span>Click to upload Cross Section</span></div>
              
              <div v-if="page.assets[3]?.src && hoverAsset === 3 && editMode !== 3" class="sc-img-controls no-print" @click.stop>
                 <button @click="editMode = 3" class="sc-btn-edit"><i class="fas fa-arrows-alt"></i> Adjust</button>
                 <button @click="$emit('upload-image', { pageIndex, assetIndex: 3 })" class="sc-btn-replace" title="Replace Image"><i class="fas fa-sync"></i></button>
                 <button @click="getVector(3, $event)" class="sc-btn-vector" title="Vectorize this image"><i class="fas fa-bezier-curve"></i></button>
                 <button @click="deleteAsset(3)" class="sc-btn-del" title="Remove Image"><i class="fas fa-trash"></i></button>
              </div>

              <div v-if="editMode === 3" class="sc-edit-panel no-print" @click.stop>
                <div class="sc-edit-row">
                  <label>Zoom</label>
                  <span class="sc-zoom-pct">{{ Math.round((page.assets[3].zoom || 1) * 100) }}%</span>
                  <input type="range" v-model.number="page.assets[3].zoom" min="0.5" max="3" step="0.1" />
                </div>
                <div class="sc-edit-row">
                  <small>Drag image to pan</small>
                  <button @click="editMode = null" class="sc-btn-done">Done</button>
                </div>
              </div>

              <div class="sc-file-input-wrap"><input type="file" :id="`fileInput_${pageIndex}_3`" accept="image/*,video/*" @change="handleFileChange($event, pageIndex, 3)" /></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════ FOOTER (full width) ═══════ -->
      <div class="sc-footer">
        <div class="sc-footer-grid">
          <div class="sc-footer-col">
            <h4 class="sc-footer-title">Please review this carefully</h4>
            <ul class="sc-footer-list">
              <li><input :value="footer.instruction1" @input="$emit('update:instruction1', $event.target.value)" class="sc-f-input" /></li>
              <li><input :value="footer.instruction2" @input="$emit('update:instruction2', $event.target.value)" class="sc-f-input" /></li>
              <li><input :value="footer.instruction3" @input="$emit('update:instruction3', $event.target.value)" class="sc-f-input" /></li>
            </ul>
          </div>
          <div class="sc-footer-col sc-footer-center">
            <p class="sc-footer-q">Any questions or concerns? <strong>CONTACT US</strong></p>
            <div class="sc-footer-contacts">
              <span><i class="fas fa-phone"></i> {{ proposalPhone }}</span>
              <span><i class="fas fa-envelope"></i> info@signagecrafting.com</span>
            </div>
          </div>
          <div class="sc-footer-col">
            <h4 class="sc-footer-title">COPYRIGHT NOTICE</h4>
            <div class="sc-footer-copy" v-html="settings.copyrightText"></div>
          </div>
        </div>
        <div class="sc-footer-note">
          <input :value="footer.note" @input="$emit('update:note', $event.target.value)" class="sc-f-input sc-note-input" placeholder="Note: Signage Crafting has up to 5% color and dimension tolerance acceptable difference between digital proof and actual product." />
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
import { ref, computed, onMounted } from 'vue'
import { useProposalTheme } from '@/composables/useProposalTheme'
import { usePublicSettings } from '@/composables/usePublicSettings'
import icon_shipping from '@/assets/nexus/icon_shipping.png'
import icon_support from '@/assets/nexus/icon_support.png'
import icon_warranty from '@/assets/nexus/icon_warranty.png'
import icon_certified from '@/assets/nexus/icon_certified.png'
import icon_bestprice from '@/assets/nexus/icon_bestprice.png'
import VectorizeModal from './VectorizeModal.vue'
import { cropAssetView } from '@/utils/vectorize'

const props = defineProps({
  page: { type: Object, required: true },
  pageIndex: { type: Number, required: true },
  settings: { type: Object, required: true },
  clientName: { type: String, default: 'Client Name' },
  contactEmail: { type: String, default: 'email@example.com' },
  footer: { type: Object, required: true },
  pendingAiImage: { type: String, default: null },
  layout: { type: String, default: 'standard' },
  theme: { type: String, default: 'theme-signcrafters' }
})

// migrate.py tags a low-confidence/inferred field by name (see page.warningFields, set
// in proposalStore's importProposal) — this lets the exact flagged field/image carry a
// visible badge instead of the reviewer only finding out from a separate warning list.
const hasWarning = (field) => (props.page.warningFields || []).includes(field)

// Clicking a warning badge means "I checked this, it's fine" — clears just that one
// field's flag. Mutating warningFields directly (not a separate dismissed-set) so a
// cleared badge stays cleared through the normal proposal autosave, same as any other
// in-place page edit (discountPercent, color, pricing rows, etc.).
const dismissWarning = (field) => {
  props.page.warningFields = (props.page.warningFields || []).filter((f) => f !== field)
}

const emit = defineEmits([
  'update:clientName', 'update:contactEmail',
  'update:instruction1', 'update:instruction2', 'update:instruction3',
  'update:delivery', 'update:note',
  'image-container-clicked', 'delete-image', 'upload-image',
  'apply-discount-all'
])

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

const handleImageClick = (pi, ai) => {
  // Ignore click if we are in edit mode for this image
  if (editMode.value === ai) return
  
  emit('image-container-clicked', { pageIndex: pi, assetIndex: ai })
  if (!props.pendingAiImage) {
    const el = document.getElementById(`fileInput_${pi}_${ai}`)
    if (el) el.click()
  }
}

const deleteAsset = (ai) => {
  if (props.page.assets[ai]) {
    props.page.assets[ai].src = null
    props.page.assets[ai].zoom = 1
    props.page.assets[ai].x = 0
    props.page.assets[ai].y = 0
  }
}

// On-demand, per-image vectorizing — only the one sign a client actually approved, not a
// bulk pass over every mockup. Opens a preview so the operator can set the cutoff for this
// particular image and see the outline before downloading; the right cutoff varies per
// mockup, so downloading blind produced unusable files.
const vectorAsset = ref(null)
const vectorSrc = ref(null)
const getVector = (ai, evt) => {
  const asset = props.page.assets[ai]
  if (!asset?.src) return
  const imgEl = evt?.target?.closest('.sc-img-box')?.querySelector('.sc-img')
  vectorSrc.value = imgEl ? cropAssetView(imgEl) : asset.src
  vectorAsset.value = asset
}
const addPriceRow = () => {
  props.page.pricing.push({ size: 'Size', dim: '00in x 00in', cost: 0 })
}
const removePriceRow = (idx) => {
  props.page.pricing.splice(idx, 1)
}

const handleFileChange = (e, pi, ai) => {
  const file = e.target.files?.[0]
  if (file) {
    const url = URL.createObjectURL(file)
    // Reset zoom/pan when uploading new image
    if (props.page.assets[ai]) {
      props.page.assets[ai].zoom = 1
      props.page.assets[ai].x = 0
      props.page.assets[ai].y = 0
    }
    emit('upload-image', { pageIndex: pi, assetIndex: ai, url, mediaType: file.type.startsWith('video/') ? 'video' : 'image' })
  }
}

const handleDrop = (e, pi, ai) => {
  const file = e.dataTransfer.files?.[0]
  if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
    const url = URL.createObjectURL(file)
    if (props.page.assets[ai]) {
      props.page.assets[ai].zoom = 1
      props.page.assets[ai].x = 0
      props.page.assets[ai].y = 0
    }
    emit('upload-image', { pageIndex: pi, assetIndex: ai, url, mediaType: file.type.startsWith('video/') ? 'video' : 'image' })
  }
}

const trustBadges = [
  { img: icon_bestprice, label: 'Best Price' },
  { img: icon_warranty, label: '2 Years Warranty' },
  { img: icon_support, label: '24/7 Support' },
  { img: icon_certified, label: 'UL Certified' },
  { img: icon_shipping, label: '2 Weeks' },
  { img: icon_bestprice, label: 'Top Seller' }
]

const scDefaults = [
  { style: 'drawing', src: null, mediaType: 'image', label: 'Sketch', isRegenerating: false, originalSrc: null, isDragging: false, aspectRatio: 'auto', bgTransparent: false, zoom: 1, x: 0, y: 0 },
  { style: 'mockup', src: null, mediaType: 'image', label: 'Day View', isRegenerating: false, originalSrc: null, isDragging: false, aspectRatio: 'auto', zoom: 1, x: 0, y: 0 },
  { style: 'mockup', src: null, mediaType: 'image', label: 'Night View', isRegenerating: false, originalSrc: null, isDragging: false, aspectRatio: 'auto', zoom: 1, x: 0, y: 0 },
  { style: 'drawing', src: null, mediaType: 'image', label: 'Cross Section', isRegenerating: false, originalSrc: null, isDragging: false, aspectRatio: 'auto', zoom: 1, x: 0, y: 0 }
]

onMounted(() => {
  while (props.page.assets.length < 4) {
    const idx = props.page.assets.length
    props.page.assets.push({ ...scDefaults[idx] })
  }
  props.page.assets.forEach(a => {
    if (typeof a.zoom === 'undefined') a.zoom = 1
    if (typeof a.x === 'undefined') a.x = 0
    if (typeof a.y === 'undefined') a.y = 0
  })
  if (!props.page.color) props.page.color = 'Same as Mockup'
})

// Was hardcoded to a flat 10% with no way to change it — the dropdown below now drives
// page.discountPercent directly (persisted with the proposal, not just a display value).
// A writable computed, not a separate ref+watch — confirmed live that a ref went stale
// across proposal switches (this component is keyed by page INDEX, so switching to a
// different lead reuses the same instance rather than remounting; a ref's initial value
// only computes once, at first mount, so it kept whatever the previous lead's page N had
// instead of the new one's). Deriving straight from the prop on every read has no state
// to go stale in the first place.
const { proposalPhone, discountPresets } = usePublicSettings()
const discountPreset = computed({
  get: () => discountPresets.value.includes(Number(props.page.discountPercent)) ? String(props.page.discountPercent) : 'custom',
  set: (val) => {
    if (val !== 'custom') props.page.discountPercent = Number(val)
  }
})

const effectiveDiscount = computed(() => Number(props.page.discountPercent) || 0)

const calculateDiscount = (price) => {
  if (!price) return null
  const n = parseFloat(price.toString().replace(/[^0-9.]/g, ''))
  if (isNaN(n)) return null
  
  const discountPct = effectiveDiscount.value / 100
  const d = n * (1 - discountPct)
  
  return d.toLocaleString('en-US', { minimumFractionDigits: d % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
}

const customThemeStyle = useProposalTheme(computed(() => props.settings))

</script>

<style scoped>
/* ═══════════════════════════════════════════════ */
/* LANDSCAPE PAGE OVERRIDE & THEMES               */
/* ═══════════════════════════════════════════════ */
.sc-page {
  width: 297mm !important;
  min-height: 210mm !important;
  max-height: 210mm;
  padding: 8mm !important;
  overflow: hidden;
  background: var(--page-bg, #000);
}

/* ── THEME: NAVY ── */
.sc-page.theme-navy {
  --page-bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.4); 
  --text-main: #f8fafc; --text-muted: #94a3b8; --text-accent: #38bdf8;
  --text-accent-glow: rgba(56, 189, 248, 0.5);
  --border-color: rgba(56, 189, 248, 0.15);
}
/* ── THEME: GRAY/ONYX ── */
.sc-page.theme-gray {
  --page-bg: #09090b; --card-bg: rgba(39, 39, 42, 0.5); 
  --text-main: #fafafa; --text-muted: #a1a1aa; --text-accent: #a1a1aa;
  --text-accent-glow: rgba(161, 161, 170, 0.4);
  --border-color: rgba(255, 255, 255, 0.1);
}
/* ── THEME: LIGHT ── */
.sc-page.theme-light {
  --page-bg: #ffffff; --card-bg: rgba(241, 245, 249, 0.8); 
  --text-main: #334155; --text-muted: #64748b; --text-accent: #2e63ff;
  --text-accent-glow: rgba(46, 99, 255, 0.3);
  --border-color: rgba(148, 163, 184, 0.2);
}
/* ── THEME: PRO (Futuristic Neon Cyan) ── */
.sc-page.theme-pro {
  --page-bg: #050505;
  --card-bg: rgba(10, 15, 30, 0.6);
  --text-main: #e2e8f0;
  --text-muted: #8c9ac2;
  --text-accent: #00f3ff;
  --text-accent-glow: rgba(0, 243, 255, 0.4);
  --border-color: rgba(46, 99, 255, 0.3);
  background-color: #050505;
  background-image: radial-gradient(circle at top right, #1a237e 0%, #000000 60%);
}

/* ── THEME: SIGNCRAFTERS (Futuristic Neon Gold) ── */
.sc-page.theme-signcrafters {
  --page-bg: #050505;
  --card-bg: rgba(15, 12, 8, 0.7);
  --text-main: #fcfbf8;
  --text-muted: #a3957a;
  --text-accent: #ffaa00;
  --text-accent-glow: rgba(255, 170, 0, 0.5);
  --border-color: rgba(255, 170, 0, 0.2);
  background-color: #050505;
  background-image: radial-gradient(circle at 100% 0%, rgba(255, 170, 0, 0.45) 0%, rgba(255, 170, 0, 0.15) 25%, transparent 50%),
                    radial-gradient(circle at 0% 100%, rgba(255, 170, 0, 0.40) 0%, rgba(255, 170, 0, 0.12) 25%, transparent 50%);
}

.sc-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 6px;
}

/* ═══════ MAIN 3‑COLUMN GRID ═══════ */
.sc-grid {
  display: grid;
  grid-template-columns: 24% 42% 34%;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

/* ── Left column ── */
.sc-col-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Center column ── */
.sc-col-center {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Right column ── */
.sc-col-right {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ═══════ CARDS ═══════ */
.sc-card {
  background: var(--card-bg);
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
}

.sc-card-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--text-main);
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 2px solid var(--text-accent);
  letter-spacing: 0.06em;
}

/* ═══════ QUOTE DETAILS ═══════ */
.sc-quote-card {
  flex: 1;
}

.sc-client-name {
  width: 100%;
  font-size: 17px;
  font-weight: 700;
  font-style: italic;
  color: var(--text-main);
  background: transparent;
  border: none;
  outline: none;
  margin-bottom: 8px;
  padding: 1px 0;
  border-bottom: 1px solid transparent;
}
.sc-client-name:hover, .sc-client-name:focus { border-bottom-color: var(--text-accent); }
.sc-client-email {
  width: 100%;
  font-size: 10.5px;
  color: var(--text-accent);
  background: transparent;
  border: none;
  outline: none;
  margin-bottom: 10px;
  padding: 0;
}

/* Warning badges — the exact field/image migrate.py flagged (low-confidence match,
   inferred sign type, etc.), not just a line in the sidebar's warning list. */
.field-flagged {
  outline: 1.5px solid #f59e0b;
  outline-offset: 2px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.08);
  position: relative;
}
.field-flag-icon {
  color: #f59e0b;
  font-size: 10px;
  margin-left: 6px;
  cursor: pointer;
}
.field-flag-icon:hover {
  color: #d97706;
}
.field-flag-icon--img {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 14px;
  z-index: 5;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}
.field-flag-icon--pricing {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
  z-index: 5;
}

/* Specs */
.sc-specs { display: flex; flex-direction: column; gap: 2px; }
.sc-spec { display: flex; align-items: center; font-size: 10.5px; padding: 3.5px 0; }
.sc-spec-k { font-weight: 700; text-transform: uppercase; color: var(--text-main); min-width: 92px; flex-shrink: 0; letter-spacing: 0.02em; }
.sc-spec-s { margin: 0 6px; color: var(--text-muted); }
.sc-spec-v {
  background: transparent; border: none; outline: none;
  color: var(--text-main); font-size: 10.5px; flex: 1; padding: 0 2px;
  border-bottom: 1px solid transparent;
}
.sc-spec-v:hover, .sc-spec-v:focus { border-bottom-color: var(--text-accent); }

/* ═══════ PRICING TABLE ═══════ */
.sc-pricing-table {
  position: relative;
  margin-top: 10px;
  border: 1.5px solid var(--text-accent);
  border-radius: 6px;
  overflow: hidden;
}

.sc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5px;
  table-layout: fixed;
}

.sc-table thead tr {
  background: rgba(0,0,0,0.2);
}

.sc-table th {
  padding: 7px 5px;
  font-size: 8.5px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--text-main);
  text-align: center;
  letter-spacing: 0.03em;
  border-bottom: 1.5px solid var(--text-accent);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-table td {
  padding: 7px 5px;
  text-align: center;
  color: var(--text-main);
  border-bottom: 1px solid var(--border-color);
  font-size: 9.5px;
  vertical-align: middle;
  overflow: hidden;
}

.sc-table tbody tr:last-child td {
  border-bottom: none;
}

.sc-table tbody tr:hover {
  background: rgba(0,0,0,0.1);
}

/* Size badge */
.sc-size-badge {
  display: inline-block;
  background: transparent;
  color: #ffffff;
  border-radius: 4px;
  padding: 1px 6px;
  font-weight: 800;
  font-size: 10px;
}
.sc-btn-del-row {
  background: transparent;
  border: none;
  color: #ef4444;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  padding: 0 2px;
  line-height: 1;
}
.sc-del-cell { width: 16px; padding: 4px 2px !important; }
.sc-add-row-bar {
  text-align: center;
  font-size: 8px;
  font-weight: 700;
  color: var(--text-accent);
  cursor: pointer;
  padding: 4px;
  border-top: 1px dashed var(--border-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.sc-add-row-bar:hover { background: rgba(255,255,255,0.04); }
.sc-footer-note { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-color); }
.sc-note-input { font-size: 7px !important; font-style: italic; opacity: 0.7; width: 100%; }

.sc-size-input {
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font-weight: 800;
  font-size: 7.5px;
  text-align: center;
  width: 40px;
}

.sc-dim-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-main);
  font-size: 7.5px;
  text-align: center;
  width: 100%;
}

.sc-td-price {
  color: var(--text-muted);
  font-size: 10px;
  text-decoration: line-through;
}

.sc-nowrap {
  white-space: nowrap;
}

.sc-cost-input {
  background: transparent;
  border: none;
  outline: none;
  font-size: 10px;
  text-align: center;
  width: 40px;
  color: var(--text-main);
}
.sc-cost-strike {
  color: var(--text-muted);
  text-decoration: line-through;
}

/* The actual charged price — the single most important number on the page. */
.sc-td-discount {
  font-weight: 900;
  color: var(--text-accent);
  font-size: 15px;
  text-shadow: 0 0 12px var(--text-accent-glow, transparent);
}

/* Discount Controls */
.sc-discount-controls {
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.03); padding: 4px 6px; border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.sc-discount-controls label { font-size: 7px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
.sc-discount-select {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(212, 175, 55, 0.3); color: var(--text-main);
  border-radius: 3px; font-size: 8px; padding: 2px 4px; outline: none; cursor: pointer;
}
.sc-discount-custom {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(212, 175, 55, 0.3); color: var(--text-main);
  border-radius: 3px; font-size: 8px; padding: 2px 4px; outline: none; width: 30px; text-align: center;
}
.sc-discount-apply-all {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(212, 175, 55, 0.3); color: var(--text-accent);
  border-radius: 3px; font-size: 7px; font-weight: 700; text-transform: uppercase;
  padding: 3px 6px; outline: none; cursor: pointer; margin-left: auto; white-space: nowrap;
}
.sc-discount-apply-all:hover { background: rgba(212, 175, 55, 0.15); }
.sc-discount-apply-all i { margin-right: 3px; }

/* Discount Box */
.sc-discount-box {
  margin-top: 5px;
  border: 1px solid #ef4444;
  border-radius: 4px;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(239,68,68,0.08);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.15);
}
.sc-discount-lbl { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #ef4444; white-space: nowrap; }
.sc-discount-val {
  background: transparent; border: none; outline: none;
  color: #fff; font-size: 11px; font-weight: 900; flex: 1;
}

/* ═══════ PACKAGE ═══════ */
.sc-package-card { flex-shrink: 0; }
.sc-pkg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sc-pkg-full { grid-column: 1 / -1; justify-content: center; }
.sc-pkg-item {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3px;
  font-size: 8px; font-weight: 600; color: var(--text-main);
}
.sc-pkg-icon {
  width: 32px; height: 32px; border-radius: 6px;
  background: rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--text-accent);
}

/* ═══════ IMAGE BLOCKS ═══════ */
.sc-img-block { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sc-col-right .sc-img-block { flex: 1; min-height: 120px; }
.sc-col-right .sc-img-block .sc-img-box { min-height: 120px; }
.sc-img-label { margin-bottom: 2px; }
.sc-img-label-input {
  background: transparent; border: none; outline: none;
  color: var(--text-main); font-size: 10px; font-weight: 700; font-style: italic;
  width: 100%; padding: 1px 0; border-bottom: 1px solid transparent;
}
.sc-img-label-input:hover, .sc-img-label-input:focus { border-bottom-color: var(--text-accent); }

.sc-img-box {
  flex: 1; border-radius: 6px; overflow: hidden; position: relative;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.3s ease; border: 1px solid rgba(255, 255, 255, 0.04); min-height: 0;
  background: var(--card-bg);
}
.sc-img-box:hover { 
  border-color: var(--text-accent);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6), 0 0 15px var(--text-accent-glow, transparent); 
}
.sc-img-white { background: rgba(255, 255, 255, 0.02); }
.sc-img-dark { background: rgba(0, 0, 0, 0.2); }
.sc-drag-active { border-color: var(--text-accent) !important; border-style: dashed; background: var(--text-accent-glow, transparent) !important; }

.sc-img {
  width: 100%; height: 100%; object-fit: contain;
  position: absolute; top: 0; left: 0;
}

.sc-img-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; color: var(--text-muted); font-size: 9px; padding: 10px; text-align: center;
}
.sc-img-empty i { font-size: 18px; opacity: 0.5; }

/* ─ Image Edit Overlays ─ */
.sc-img-controls {
  position: absolute; inset: 0; background: rgba(0,0,0,0.65);
  display: flex; align-items: center; justify-content: center; gap: 8px;
  opacity: 0; transition: opacity 0.2s; z-index: 10;
}
.sc-img-box:hover .sc-img-controls { opacity: 1; }

.sc-btn-edit {
  background: var(--text-accent); color: #000; border: none; border-radius: 4px;
  padding: 4px 10px; font-size: 9px; font-weight: 800; cursor: pointer; text-transform: uppercase;
  transition: all 0.2s; display: flex; align-items: center; gap: 4px;
}
.sc-btn-edit:hover { background: #fff; }

.sc-btn-replace, .sc-btn-del, .sc-btn-vector {
  background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3);
  border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  font-size: 10px; cursor: pointer; transition: all 0.2s;
}
.sc-btn-replace:hover, .sc-btn-del:hover, .sc-btn-vector:hover { background: rgba(255,255,255,0.3); border-color: #fff; }

/* ─ Active Edit Panel ─ */
.sc-edit-mode .sc-img-box {
  border: 2px solid var(--text-accent); cursor: grab;
}
.sc-edit-mode .sc-img-box:active { cursor: grabbing; }

.sc-edit-panel {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: rgba(10, 10, 10, 0.95); border-top: 1px solid var(--text-accent);
  padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; z-index: 20;
}
.sc-edit-row {
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
}
.sc-edit-row label { font-size: 9px; font-weight: 700; color: #fff; text-transform: uppercase; }
.sc-edit-row small { font-size: 8px; color: var(--text-muted); font-style: italic; }
.sc-zoom-pct { font-size: 8px; color: var(--text-accent); font-weight: 700; width: 20px; text-align: right; }
.sc-edit-row input[type=range] { flex: 1; accent-color: var(--text-accent); height: 4px; }
.sc-btn-done {
  background: var(--text-accent); color: #000; border: none; border-radius: 4px;
  padding: 3px 12px; font-size: 9px; font-weight: 800; text-transform: uppercase; cursor: pointer;
}

.sc-file-input-wrap {
  display: none !important; width: 0; height: 0; overflow: hidden; position: absolute;
}

/* ═══════ LOGO + BADGES ═══════ */
.sc-logo-section {
  flex-shrink: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center;
}

.sc-logo-area { margin-bottom: 8px; position: relative; }

/* Ornament row */
.sc-logo-ornament {
  display: flex; align-items: center; gap: 6px;
  justify-content: center; margin-bottom: 6px;
}
.sc-logo-ornament i {
  font-size: 10px;
  color: var(--text-accent);
  filter: drop-shadow(0 0 4px var(--text-accent));
}
.sc-ornament-line {
  flex: 1; height: 1px; max-width: 28px;
  background: linear-gradient(90deg, transparent, var(--text-accent), transparent);
}

.sc-logo-name {
  font-size: 20px; font-weight: 900; text-transform: uppercase;
  line-height: 1.1; letter-spacing: 0.08em;
  color: var(--text-main); text-shadow: 0 0 12px var(--text-accent-glow, transparent);
}

.sc-logo-tagline {
  font-size: 6.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.16em; color: var(--text-accent); opacity: 0.9;
  margin-top: 3px;
}

.sc-badges {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px 10px; width: 100%;
  position: relative;
}



.sc-badge-item {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 4px;
}

.sc-badge-circle {
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid var(--border-color);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-accent); font-size: 14px;
  background: var(--card-bg);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), inset 0 2px 10px var(--text-accent-glow, transparent);
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.sc-badge-circle:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 15px var(--text-accent-glow, transparent), inset 0 2px 12px var(--text-accent-glow, transparent);
  border-color: var(--text-accent);
}

.sc-badge-img {
  width: 65%; height: 65%; object-fit: contain; filter: drop-shadow(0 0 4px var(--text-accent-glow, transparent));
}

.sc-badge-text {
  font-size: 6.5px; font-weight: 800;
  color: var(--text-main); text-transform: uppercase;
  letter-spacing: 0.06em; opacity: 0.95;
}

/* ═══════ FOOTER ═══════ */
.sc-footer {
  border-top: 2px solid var(--border-color);
  padding-top: 6px;
  flex-shrink: 0;
}

.sc-footer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.sc-footer-title {
  font-size: 7px; font-weight: 800; text-transform: uppercase;
  color: var(--text-main); margin-bottom: 3px; letter-spacing: 0.04em;
}

.sc-footer-list { list-style: disc; padding-left: 12px; margin: 0; }
.sc-footer-list li { font-size: 6.5px; color: var(--text-muted); margin-bottom: 1px; }

.sc-f-input {
  background: transparent; border: none; outline: none;
  color: var(--text-muted); font-size: 6.5px; width: 100%; padding: 0;
}
.sc-f-inline { display: inline; width: auto; }

.sc-footer-center { text-align: center; }
.sc-footer-q { font-size: 7px; color: var(--text-main); margin-bottom: 3px; }
.sc-footer-contacts { font-size: 7px; color: var(--text-muted); display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.sc-footer-contacts i { margin-right: 3px; color: var(--text-accent); }
.sc-footer-copy { font-size: 5.5px; color: var(--text-muted); line-height: 1.3; opacity: 0.8; }

/* ═══════ PRINT OVERRIDE ═══════ */
@media print {
  .sc-page {
    width: 297mm !important;
    min-height: 210mm !important;
    max-height: 210mm !important;
    page-break-after: always;
  }
  @page { size: landscape; }
}
</style>
