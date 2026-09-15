<template>
  <div class="editor-container">
    <!-- Top-right utility toolbar — grouped into one consistent pill instead of two
         separately-floating buttons with different colors, sizes and offsets. -->
    <div class="top-toolbar no-print">
      <router-link to="/batch-upload" class="top-toolbar-btn" title="Bulk upload client PDFs">
        <i class="fas fa-cloud-upload-alt"></i>
        <span>Batch Upload</span>
      </router-link>
      <div class="top-toolbar-divider"></div>
      <button @click="showAIChat = true" class="top-toolbar-btn top-toolbar-btn--accent" title="Open AI Signage Generator">
        <i class="fas fa-robot"></i>
        <span>AI Studio</span>
      </button>
    </div>

    <!-- Toggle Sidebar Button -->
    <button
      v-if="!sidebarOpen"
      @click="sidebarOpen = true"
      class="no-print sidebar-toggle-button"
    >
      <i class="fas fa-sliders-h"></i>
    </button>

    <!-- SIDEBAR -->
    <EditorSidebar 
      v-model:open="sidebarOpen"
      v-model:theme="currentTheme"
      @save-pdf="handleSavePDF"
      @create-payment="handleCreatePayment"
      @send-email="handleSendEmail"
    />

    <!-- MAIN CONTENT -->
    <div class="main-content-area">
      <!-- Loading a queue entry can take a couple seconds (on-demand image fetch for a
           multi-sign proposal) — this overlay is the only thing that told a reviewer
           something was actually happening between the click and the canvas updating. -->
      <div v-if="isLoadingQueueEntry" class="queue-loading-overlay no-print">
        <i class="fas fa-circle-notch fa-spin"></i>
        <span>Loading proposal…</span>
      </div>
      <div :class="currentTheme" class="pages-container" :key="currentTheme">
        <!-- Each Page (SignCrafters layout) -->
        <template v-if="activeCompanyId === 'signcrafters'">
          <ProposalPageSignCrafters
            v-for="(page, index) in pages"
            :key="'sc-' + index"
            :page="page"
            :page-index="index"
            :settings="settings"
            :client-name="clientName"
            :contact-email="contactEmail"
            :footer="footer"
            :pending-ai-image="pendingAIImage"
            :layout="companyLayout"
            :theme="currentTheme"
            @update:client-name="clientName = $event"
            @update:contact-email="contactEmail = $event"
            @update:instruction1="footer.instruction1 = $event"
            @update:instruction2="footer.instruction2 = $event"
            @update:instruction3="footer.instruction3 = $event"
            @update:delivery="footer.delivery = $event"
            @update:note="footer.note = $event"
            @image-container-clicked="handleImageContainerClick"
            @delete-image="handleDeleteImage"
            @upload-image="handleUploadImage"
            @apply-discount-all="handleApplyDiscountAll"
          />
          <ProposalPageTerms :theme="currentTheme" :settings="settings" />
        </template>

        <!-- Each Page (NexusLEDs layout) -->
        <template v-else-if="activeCompanyId === 'nexusleds'">
          <ProposalPageNexusLeds
            v-for="(page, index) in pages"
            :key="'nl-' + index"
            :page="page"
            :page-index="index"
            :settings="settings"
            :client-name="clientName"
            :contact-email="contactEmail"
            :footer="footer"
            :pending-ai-image="pendingAIImage"
            :layout="companyLayout"
            :theme="currentTheme"
            @update:client-name="clientName = $event"
            @update:contact-email="contactEmail = $event"
            @update:instruction1="footer.instruction1 = $event"
            @update:instruction2="footer.instruction2 = $event"
            @update:instruction3="footer.instruction3 = $event"
            @update:delivery="footer.delivery = $event"
            @update:note="footer.note = $event"
            @image-container-clicked="handleImageContainerClick"
            @delete-image="handleDeleteImage"
            @upload-image="handleUploadImage"
          />
          <ProposalPageTerms :theme="currentTheme" :settings="settings" />
        </template>

        <!-- Each Page (Default Luminus layout) -->
        <template v-else>
          <ProposalPage
            v-for="(page, index) in pages"
            :key="index"
            :page="page"
            :page-index="index"
            :settings="settings"
            :client-name="clientName"
            :contact-email="contactEmail"
            :footer="footer"
            :pending-ai-image="pendingAIImage"
            :layout="companyLayout"
            @update:client-name="clientName = $event"
            @update:contact-email="contactEmail = $event"
            @update:instruction1="footer.instruction1 = $event"
            @update:instruction2="footer.instruction2 = $event"
            @update:instruction3="footer.instruction3 = $event"
            @update:delivery="footer.delivery = $event"
            @update:note="footer.note = $event"
            @image-container-clicked="handleImageContainerClick"
            @delete-image="handleDeleteImage"
            @upload-image="handleUploadImage"
          />
          <ProposalPageTerms :theme="currentTheme" :settings="settings" />
        </template>
      </div>
    </div>

    <!-- AI Chat Panel -->
    <AIChat
      :isOpen="showAIChat"
      @close="showAIChat = false"
      @image-generated="handleAIImageGenerated"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useProposalStore } from '@/stores/proposalStore'
import { generatePDFWithProgress, generateProposalPDF } from '@/utils/pdfGenerator'
import { showToast } from '@/utils/toast'
import EditorSidebar from '@/components/proposal/EditorSidebar.vue'
import ProposalPage from '@/components/proposal/ProposalPage.vue'
import ProposalPageSignCrafters from '@/components/proposal/ProposalPageSignCrafters.vue'
import ProposalPageNexusLeds from '@/components/proposal/ProposalPageNexusLeds.vue'
import ProposalPageTerms from '@/components/proposal/ProposalPageTerms.vue'
import AIChat from '@/components/proposal/AIChat.vue'
import { loadImportIntoProposal } from '@/utils/importMapper'

const proposalStore = useProposalStore()
const { sidebarOpen, currentTheme, pages, settings, clientName, contactEmail, footer, activeCompanyId, isLoadingQueueEntry, activeLeadMeta } = storeToRefs(proposalStore)

onMounted(async () => {
  const pending = localStorage.getItem('pendingImportClient')
  if (pending) {
    try {
      const client = JSON.parse(pending)
      loadImportIntoProposal(client, client.items || [], { replace: true })
      showToast(`Loaded ${client.client_name} into the Proposal Editor`, 'success')
      localStorage.removeItem('pendingImportClient')
    } catch (e) {
      console.error('Failed to parse pending import client', e)
    }
    return
  }

  // Auto-recover from a refresh mid-edit — confirmed as a real complaint: correcting a
  // sign type/price then losing it to an accidental reload before clicking Save. A draft
  // only exists if pages actually changed after a lead loaded (see proposalStore's
  // watch(pages, saveDraft)), and only matches here if nothing else has already claimed
  // this mount (activeLeadMeta.dbLeadId still null) — never overwrite an intentional
  // fresh load with a leftover draft from a previous session.
  if (activeLeadMeta.value.dbLeadId == null) {
    try {
      const raw = localStorage.getItem('luminus_draft_v1')
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft.dbLeadId != null) {
          const response = await fetch(`/api/leads?id=${draft.dbLeadId}&action=version&version=${draft.dbVersion}`)
          const result = await response.json()
          if (response.ok) {
            const loadResult = proposalStore.importProposal(result.data, { dbLeadId: draft.dbLeadId, version: result.version })
            if (loadResult.draftRestored) {
              showToast(`Restored your unsaved changes on ${result.data.clientName} from before the refresh`, 'success', 5000)
            }
          }
        }
      }
    } catch (e) {
      console.error('Draft auto-restore failed (non-critical):', e)
    }
  }
})

// Company layout mapping: each company gets a different layout
const companyLayout = computed(() => {
  switch (activeCompanyId.value) {
    case 'signcrafters':
      return 'image-left' // Images on left side
    case 'nexusleds':
      return 'stacked' // Stacked single column
    default:
      return 'default' // Luminus: images on right
  }
})

// AI Chat state
const showAIChat = ref(false)
const pendingAIImage = ref(null)

// Handle AI image generation
const handleAIImageGenerated = (imageUrl) => {
  pendingAIImage.value = imageUrl
  showAIChat.value = false
  showToast('AI image ready! Click any image container to insert it.', 'success', 5000)
}

// Handle image container clicks
const handleImageContainerClick = ({ pageIndex, assetIndex }) => {
  if (pendingAIImage.value) {
    // Insert the pending AI-generated image
    proposalStore.setAssetImage(pageIndex, assetIndex, pendingAIImage.value, 'image')
    pendingAIImage.value = null
    showToast('AI image inserted successfully!', 'success')
  }
  // If no pending image, ProposalPage will handle file picker
}

// Handle image deletion
const handleDeleteImage = ({ pageIndex, assetIndex }) => {
  proposalStore.setAssetImage(pageIndex, assetIndex, null, 'image')
  showToast('Image deleted', 'success')
}

// Handle image upload
const handleUploadImage = ({ pageIndex, assetIndex, url, mediaType }) => {
  proposalStore.setAssetImage(pageIndex, assetIndex, url, mediaType)
  showToast('Image uploaded!', 'success')
}

// One sign's discount, applied to every sign on this proposal — confirmed as a real gap:
// each page's discount was independent, so a reviewer had to set it N times by hand for
// an N-sign proposal instead of once.
const handleApplyDiscountAll = (discountPercent) => {
  pages.value.forEach((p) => { p.discountPercent = discountPercent })
  showToast(`${discountPercent}% discount applied to all ${pages.value.length} sign(s)`, 'success')
}

// Handle PDF generation
const handleSavePDF = async (pageSize = 'letter') => {
  const selectedPageSize = pageSize || proposalStore.pageSize || 'letter'
  
  try {
    await generatePDFWithProgress(
      clientName.value || 'Proposal',
      (progress) => {
        console.log(`PDF Progress: ${progress.percentage}% - ${progress.message}`)
      },
      selectedPageSize
    )
  } catch (error) {
    console.error('PDF generation error:', error)
    showToast('PDF generation failed. Please try again.', 'error')
  }
}

// Handle payment link creation
const handleCreatePayment = async () => {
  try {
    // Get pricing from first page
    const firstPage = pages.value[0]
    const firstPrice = firstPage?.pricing?.[0]
    
    if (!firstPrice) {
      showToast('No pricing information available', 'warning')
      return
    }

    showToast('Generating payment link...', 'info', 2000)
    
    // 1. Get first VALID pricing (not zero)
    let selectedPrice = firstPage.pricing[0]
    for (const p of firstPage.pricing) {
      if (p.cost && parseInt(p.cost) > 0) {
        selectedPrice = p
        break
      }
    }

    // 2. Get first AVAILABLE image
    let selectedImage = ''
    // Check all pages for any image
    for (const page of pages.value) {
      const foundAsset = page.assets.find(a => a.src)
      if (foundAsset) {
        selectedImage = foundAsset.src
        break
      }
    }

    // Fallback image if none found (Signage Crafting Logo / Placeholder)
    if (!selectedImage) {
      selectedImage = 'https://placehold.co/600x400/0B1120/22d3ee?text=Signage+Crafting+Proposal' 
    }

    // Calculate discounted price (5% off)
    const originalPrice = parseFloat(selectedPrice.cost.replace(/[^0-9.]/g, ''))
    const discountedPrice = (originalPrice * 0.95)
    const finalPrice = discountedPrice % 1 === 0 ? discountedPrice.toFixed(0) : discountedPrice.toFixed(2)

    // Send to Google Sheets
    const payload = {
      name: clientName.value || 'Valued Client',
      price: finalPrice || '0',
      size: selectedPrice.dim || 'Custom',
      image: selectedImage,
      signType: firstPage.signType || 'Custom Sign',
      timestamp: new Date().toISOString()
    }

    console.log('📊 Preparing to send to sheets:', payload)

    const response = await fetch('/api/send-to-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    // Generate payment link
    const paymentResponse = await fetch('/api/payment-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: clientName.value || 'Valued Client',
        clientEmail: contactEmail.value,
        items: [{ ...selectedPrice, cost: finalPrice }], // Send item with discounted price
        totalAmount: finalPrice
      })
    })

    const paymentData = await paymentResponse.json()
    
    if (paymentData.success) {
      // Copy payment link to clipboard
      await navigator.clipboard.writeText(paymentData.paymentLink)
      showToast(`Payment link copied! Ref: ${paymentData.paymentRef}`, 'success', 4000)
    } else {
      showToast('Payment link generated. Check console for details.', 'info')
    }
    
    console.log('Payment link:', paymentData.paymentLink)
    console.log('Data sent to sheets:', { name: clientName.value, price: firstPrice.cost })
    
  } catch (error) {
    console.error('Payment error:', error)
    showToast('Payment link generation failed', 'error')
  }
}

// Handle sending email
const handleSendEmail = async () => {
  if (!contactEmail.value) {
    showToast('Please enter a client contact email', 'warning')
    return
  }

  try {
    showToast('Generating PDF for email...', 'info')
    
    // Generate PDF as Blob
    const pdfBlob = await generateProposalPDF({
      clientName: clientName.value,
      pageSize: proposalStore.pageSize || 'letter',
      returnBlob: true
    })

    if (!pdfBlob) {
      throw new Error('Failed to generate PDF')
    }

    showToast('Sending email...', 'info', 3000)

    // Convert Blob to Base64
    const reader = new FileReader()
    reader.readAsDataURL(pdfBlob)
    
    reader.onloadend = async () => {
      const base64data = reader.result.split(',')[1] // Remove data URL prefix

      // Send to backend
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: clientName.value || 'Valued Client',
          clientEmail: contactEmail.value,
          pdfBase64: base64data,
          companyId: activeCompanyId.value, // Include company context
          leadId: activeLeadMeta.value?.dbLeadId ?? null // lets a later duplicate-fetch of this lead show "email sent"
        })
      })

      if (!response.ok) {
        const errorData = await response.text()
        console.error('Server Error Details:', errorData)
        throw new Error(`Server Error: ${response.status} - ${errorData}`)
      }

      const result = await response.json()
      
      if (result.success) {
        showToast('Email sent successfully!', 'success')
      } else {
        showToast('Failed to send email. Check logs.', 'error')
      }
    }

  } catch (error) {
    console.error('Email error:', error)
    showToast('Failed to send email', 'error')
  }
}
</script>

<style scoped>
.editor-container {
  display: flex;
  min-height: 100vh;
  overflow: hidden;
  background: #1a1a1a;
}

/* Top-right utility toolbar — one grouped pill instead of two separately-floating
   buttons at different, hardcoded offsets. */
.top-toolbar {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(24, 26, 32, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 5px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.top-toolbar-divider {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: rgba(255, 255, 255, 0.08);
}

.top-toolbar-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #cbd5e1;
  background: transparent;
  border: none;
  border-radius: 10px;
  padding: 9px 16px;
  font-weight: 600;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.top-toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: white;
}

.top-toolbar-btn i {
  font-size: 14px;
}

.top-toolbar-btn--accent {
  color: #67e8f9;
}

.top-toolbar-btn--accent:hover {
  background: rgba(34, 211, 238, 0.12);
  color: #a5f3fc;
}

/* Sidebar Toggle Button */
.sidebar-toggle-button {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 50;
  background: #1f2937;
  color: #22d3ee;
  border: 1px solid #374151;
  border-radius: 50%;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.sidebar-toggle-button:hover {
  background: #111827;
  border-color: #22d3ee;
  transform: scale(1.05);
}

/* Main Content */
.main-content-area {
  position: relative;
  flex: 1;
  background: #1f2937;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  height: 100vh;
}

.queue-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(17, 24, 39, 0.75);
  backdrop-filter: blur(2px);
  color: #5eead4;
  font-size: 14px;
  font-weight: 600;
}

.queue-loading-overlay i {
  font-size: 28px;
}

.pages-container {
  width: 100%;
  max-width: 1200px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 100px;
}

/* Print Styles */
@media print {
  .sidebar-toggle-button,
  .no-print {
    display: none !important;
  }
}
</style>
