<template>
  <div class="pdf-render-container" :class="currentTheme">
    <div v-if="loading" class="loading-state">
      Loading PDF Data...
    </div>
    
    <div v-else-if="error" class="error-state">
      {{ error }}
    </div>

    <div v-else class="pages-container">
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
          :layout="companyLayout"
          :theme="currentTheme"
        />
      </template>

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
          :layout="companyLayout"
          :theme="currentTheme"
        />
      </template>

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
          :layout="companyLayout"
        />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '@/services/supabase'
import { useProposalStore } from '@/stores/proposalStore'

import ProposalPage from '@/components/proposal/ProposalPage.vue'
import ProposalPageSignCrafters from '@/components/proposal/ProposalPageSignCrafters.vue'
import ProposalPageNexusLeds from '@/components/proposal/ProposalPageNexusLeds.vue'

const route = useRoute()
const proposalStore = useProposalStore()

// State
const loading = ref(true)
const error = ref(null)
const pages = ref([])
const clientName = ref('')
const contactEmail = ref('')

// Compute store settings (using defaults for the chosen company)
const currentTheme = computed(() => proposalStore.currentTheme)
const settings = computed(() => proposalStore.settings)
const footer = computed(() => proposalStore.footer)
const activeCompanyId = computed(() => proposalStore.activeCompanyId)

const companyLayout = computed(() => {
  switch (activeCompanyId.value) {
    case 'signcrafters':
      return 'image-left'
    case 'nexusleds':
      return 'stacked'
    default:
      return 'default'
  }
})

onMounted(async () => {
  try {
    const clientId = route.params.clientId
    if (!clientId) throw new Error('No client ID provided')

    // Fetch client
    const { data: client, error: clientErr } = await supabase
      .from('import_clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (clientErr) throw new Error(clientErr.message)

    clientName.value = client.client_name
    contactEmail.value = client.client_email

    // Fetch items
    const { data: items, error: itemsErr } = await supabase
      .from('import_items')
      .select('*')
      .eq('client_id', clientId)
      .order('page_number')

    if (itemsErr) throw new Error(itemsErr.message)

    // Map DB items to the Proposal Editor 'pages' schema
    pages.value = items.map(item => {
      // Determine image to show
      let imageUrl = null
      if (item.regenerated_image_path) {
        imageUrl = supabase.storage.from('import-images').getPublicUrl(item.regenerated_image_path).data.publicUrl
      } else if (item.original_image_path) {
        imageUrl = supabase.storage.from('import-images').getPublicUrl(item.original_image_path).data.publicUrl
      }

      return {
        id: item.id,
        signType: item.sign_type || 'Custom Sign',
        usage: 'Outdoor',
        finish: 'Standard',
        illuminated: 'Yes',
        ulCert: 'Only For Illuminated variants',
        permit: 'On Demand',
        install: 'On Demand',
        glowColor: proposalStore.settings.glowColor,
        bgClass: 'bg-brick',
        color: 'Same as Mockup',
        discountCode: 'AUTO',
        pricing: [
          { size: 'Option', dim: item.size || 'Custom', cost: item.adjusted_price || item.original_price || '0' }
        ],
        assets: [
          {
            style: 'mockup',
            src: imageUrl,
            mediaType: 'image',
            label: 'Final Mockup',
            isRegenerating: false,
            originalSrc: imageUrl,
            isDragging: false,
            aspectRatio: 'auto',
            zoom: 1,
            x: 0,
            y: 0
          }
        ]
      }
    })

    // Signal Puppeteer that we are ready
    setTimeout(() => {
      window.PDF_READY = true
    }, 1500) // Give images 1.5s to render fully (a more robust solution would check image load events, but this is simple)

  } catch (err) {
    error.value = err.message
    window.PDF_READY = true // unblock puppeteer even on error
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.pdf-render-container {
  min-height: 100vh;
  background-color: transparent !important; /* Let jsPDF/Puppeteer decide */
}
.loading-state, .error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: 1.5rem;
  color: #fff;
  background: #0B1120;
}
.error-state {
  color: #ef4444;
}

/* Force PDF/Print friendly styles */
.pages-container {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
}

/* Hide interactive elements not needed in final PDF */
:deep(.no-print), :deep(.delete-btn), :deep(.upload-btn) {
  display: none !important;
}

/* Low-confidence warning badges (amber outline + triangle icon) are a review aid for
   whoever is editing the proposal — they must never reach the client-facing PDF, even
   for a field nobody dismissed before sending. .field-flag-icon is already covered by
   .no-print above; this resets the outline/background .field-flagged itself adds. */
:deep(.field-flagged) {
  outline: none !important;
  background: transparent !important;
}

/* Make inputs look like static text */
:deep(input), :deep(textarea) {
  border: none !important;
  background: transparent !important;
  resize: none !important;
  pointer-events: none !important;
}
</style>
