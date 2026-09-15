<template>
  <div class="batch-review">
    <!-- TOP NAV -->
    <nav class="batch-nav no-print">
      <div class="batch-nav__brand">
        <i class="fas fa-layer-group"></i>
        <span>Signage Crafting <strong>Batch Engine</strong></span>
      </div>
      <div class="batch-nav__links">
        <router-link to="/batch-upload" class="batch-nav__link batch-nav__link--back">
          <i class="fas fa-arrow-left"></i> Upload More PDFs
        </router-link>
        <router-link to="/" class="batch-nav__link">
          <i class="fas fa-pen-nib"></i> Proposal Editor
        </router-link>
        <router-link to="/batch-upload" class="batch-nav__link">
          <i class="fas fa-cloud-upload-alt"></i> New Batch
        </router-link>
      </div>
    </nav>

    <!-- HERO HEADER -->
    <header class="batch-hero">
      <div class="batch-hero__inner">
        <div class="batch-hero__badge">
          <i class="fas fa-bolt"></i> Bulk Automation
        </div>
        <h1 class="batch-hero__title">Review Extracted Proposals</h1>
        <p class="batch-hero__subtitle">
          Each PDF becomes one client profile. Review, edit, and load a client into the Proposal Editor for final send.
        </p>
      </div>
    </header>

    <main class="batch-main">
      <!-- LOADING -->
      <div v-if="loading" class="batch-state">
        <div class="spinner"></div>
        <p>Loading batch details...</p>
      </div>

      <!-- ERROR -->
      <div v-else-if="error" class="batch-error batch-error--large">
        <i class="fas fa-exclamation-triangle"></i>
        <div>
          <strong>Could not load this batch</strong>
          <p>{{ error }}</p>
        </div>
      </div>

      <template v-else>
        <!-- BATCH SUMMARY -->
        <section class="batch-summary">
          <div class="summary-card">
            <span class="summary-card__value">{{ clients.length }}</span>
            <span class="summary-card__label">Clients</span>
          </div>
          <div class="summary-card">
            <span class="summary-card__value">{{ totalItems }}</span>
            <span class="summary-card__label">Sign Items</span>
          </div>
          <div class="summary-card">
            <span class="summary-card__value">{{ selectedClients.length }}</span>
            <span class="summary-card__label">Selected</span>
          </div>
          <div class="summary-card summary-card--discount">
            <span class="summary-card__value">{{ batch?.discount_percent || 0 }}%</span>
            <span class="summary-card__label">Batch Discount</span>
          </div>
          <div class="summary-card summary-card--status">
            <span class="summary-card__value status-dot" :class="`status-dot--${batchStatus}`"></span>
            <span class="summary-card__label">{{ batchStatus.replace(/_/g, ' ') }}</span>
          </div>
        </section>

        <!-- BULK ACTIONS -->
        <section class="batch-toolbar">
          <router-link to="/batch-upload" class="btn-ghost btn-back">
            <i class="fas fa-arrow-left"></i> Upload More PDFs
          </router-link>

          <button class="btn-secondary" @click="refreshData" :disabled="refreshing">
            <i class="fas fa-sync-alt" :class="{ 'fa-spin': refreshing }"></i> Refresh
          </button>

          <button
            class="btn-primary"
            :disabled="selectedClients.length === 0 || isGenerating"
            @click="generateImagesForSelected"
          >
            <span v-if="isGenerating"><i class="fas fa-spinner fa-spin"></i> Generating...</span>
            <span v-else><i class="fas fa-magic"></i> Generate AI Mockups ({{ selectedClients.length }})</span>
          </button>

          <button
            class="btn-accent"
            :disabled="selectedClients.length === 0 || sending"
            @click="sendApproved"
          >
            <span v-if="sending"><i class="fas fa-spinner fa-spin"></i> Sending...</span>
            <span v-else><i class="fas fa-paper-plane"></i> Send Selected to N8N ({{ selectedClients.length }})</span>
          </button>
        </section>

        <!-- EXTRACTION QUALITY BANNER -->
        <section v-if="clients.length > 0" class="quality-banner" :class="`quality-banner--${qualityLevel}`">
          <div class="quality-banner__icon">
            <i v-if="qualityLevel === 'good'" class="fas fa-check-circle"></i>
            <i v-else-if="qualityLevel === 'mixed'" class="fas fa-exclamation-circle"></i>
            <i v-else class="fas fa-times-circle"></i>
          </div>
          <div class="quality-banner__body">
            <strong>{{ qualityTitle }}</strong>
            <p>{{ qualityMessage }}</p>
          </div>
          <div class="quality-banner__score">
            <span class="quality-score__value">{{ qualityScore }}%</span>
            <span class="quality-score__label">Extracted</span>
          </div>
        </section>

        <!-- GENERATION STATUS -->
        <section v-if="generationStatus" class="gen-status">
          <div class="gen-status__grid">
            <div class="gen-stat">
              <span class="gen-stat__value">{{ generationStatus.summary?.ready || 0 }}</span>
              <span class="gen-stat__label">Ready</span>
            </div>
            <div class="gen-stat">
              <span class="gen-stat__value">{{ generationStatus.summary?.processing || 0 }}</span>
              <span class="gen-stat__label">Processing</span>
            </div>
            <div class="gen-stat">
              <span class="gen-stat__value">{{ generationStatus.summary?.needs_review || 0 }}</span>
              <span class="gen-stat__label">Need Review</span>
            </div>
            <div class="gen-stat">
              <span class="gen-stat__value">{{ generationStatus.summary?.fallback_model_used || 0 }}</span>
              <span class="gen-stat__label">Fallback Used</span>
            </div>
          </div>
          <p class="gen-status__note">
            <i class="fas fa-info-circle"></i>
            Image generation runs in the background. Refresh to see updates.
          </p>
        </section>

        <!-- CLIENT CARDS -->
        <section class="clients-list">
          <div
            v-for="client in clients"
            :key="client.id"
            class="client-card"
            :class="{ 'client-card--expanded': expandedClients.includes(client.id) }"
          >
            <!-- CLIENT HEADER -->
            <div class="client-card__header" @click="toggleClient(client.id)">
              <div class="client-card__select">
                <input
                  type="checkbox"
                  :value="client.id"
                  v-model="selectedClients"
                  @click.stop
                />
              </div>

              <div class="client-card__info">
                <h3 class="client-card__name">
                  <i class="fas fa-user-circle"></i>
                  {{ client.client_name || 'Unknown Client' }}
                </h3>
                <p class="client-card__email">
                  <i class="fas fa-envelope"></i> {{ client.client_email || 'No email' }}
                </p>
              </div>

              <div class="client-card__meta">
                <span class="client-card__count">{{ client.items?.length || 0 }} item{{ client.items?.length !== 1 ? 's' : '' }}</span>
                <span class="status-badge" :class="`status-badge--${client.status}`">
                  {{ client.status.replace(/_/g, ' ') }}
                </span>
                <i class="fas fa-chevron-down client-card__chevron"></i>
              </div>
            </div>

            <!-- CLIENT BODY -->
            <div v-if="expandedClients.includes(client.id)" class="client-card__body">
              <div v-if="client.items?.length === 0" class="client-card__empty">
                No items extracted from this PDF.
              </div>

              <div v-else class="items-grid">
                <div
                  v-for="item in client.items"
                  :key="item.id"
                  class="item-card"
                  :class="{ 'item-card--needs-review': item.status === 'needs_manual_check' }"
                >
                  <!-- IMAGES -->
                  <div class="item-card__images">
                    <div
                      v-for="(url, imgIdx) in getItemImageUrls(item)"
                      :key="imgIdx"
                      class="item-card__image"
                    >
                      <img :src="url" :alt="`Image ${imgIdx + 1}`" />
                      <div class="item-card__image-label">
                        {{ ['Drawing', 'Mockup', 'Day View', 'Night View'][imgIdx] || `Extra ${imgIdx + 1}` }}
                      </div>

                      <div class="item-card__image-overlay">
                        <button
                          class="btn-overlay"
                          @click="regenerateImage(item)"
                          :disabled="regenerating[item.id]"
                        >
                          <i class="fas fa-magic"></i>
                          {{ regenerating[item.id] ? 'Generating...' : 'Regenerate AI' }}
                        </button>
                      </div>

                      <div v-if="item.generation_model && imgIdx === 0" class="item-card__model-tag">
                        {{ item.generation_model.replace(/\//g, ' ') }}
                        <span v-if="item.fallback_reason">({{ item.fallback_reason }})</span>
                      </div>
                    </div>

                    <div v-if="getItemImageUrls(item).length === 0" class="item-card__image">
                      <div class="item-card__image-placeholder">
                        <i class="fas fa-image"></i>
                        <span>No image yet</span>
                      </div>
                    </div>
                  </div>

                  <!-- FIELDS -->
                  <div class="item-card__fields">
                    <div class="field-group">
                      <label>Sign Type</label>
                      <input v-model="item.sign_type" @change="updateItem(item, 'sign_type', item.sign_type)" />
                    </div>

                    <div class="field-row">
                      <div class="field-group">
                        <label>Size</label>
                        <input v-model="item.size" @change="updateItem(item, 'size', item.size)" />
                      </div>
                      <div class="field-group">
                        <label>Base Price</label>
                        <input type="number" v-model.number="item.original_price" @change="updateItem(item, 'original_price', item.original_price)" />
                      </div>
                    </div>

                    <div class="field-row">
                      <div class="field-group">
                        <label>Discounted Price</label>
                        <input type="number" v-model.number="item.discounted_price" @change="updateItem(item, 'discounted_price', item.discounted_price)" />
                      </div>
                      <div class="field-group">
                        <label>Discount Code</label>
                        <input v-model="item.discount_code" @change="updateItem(item, 'discount_code', item.discount_code)" />
                      </div>
                    </div>

                    <div class="field-row">
                      <div class="field-group">
                        <label>Color</label>
                        <input v-model="item.color" @change="updateItem(item, 'color', item.color)" />
                      </div>
                      <div class="field-group">
                        <label>Finish</label>
                        <input v-model="item.finish" @change="updateItem(item, 'finish', item.finish)" />
                      </div>
                    </div>

                    <div class="field-row">
                      <div class="field-group">
                        <label>Illuminated</label>
                        <input v-model="item.illuminated" @change="updateItem(item, 'illuminated', item.illuminated)" />
                      </div>
                      <div class="field-group">
                        <label>Usage</label>
                        <input v-model="item.usage" @change="updateItem(item, 'usage', item.usage)" />
                      </div>
                    </div>

                    <div class="field-row">
                      <div class="field-group">
                        <label>UL Cert</label>
                        <input v-model="item.ul_cert" @change="updateItem(item, 'ul_cert', item.ul_cert)" />
                      </div>
                      <div class="field-group">
                        <label>Permit</label>
                        <input v-model="item.permit" @change="updateItem(item, 'permit', item.permit)" />
                      </div>
                      <div class="field-group">
                        <label>Install</label>
                        <input v-model="item.install" @change="updateItem(item, 'install', item.install)" />
                      </div>
                    </div>

                    <!-- PRICING TABLE -->
                    <div v-if="item.pricing_json?.length" class="pricing-table">
                      <div class="pricing-table__header">
                        <span>Size</span>
                        <span>Dimension</span>
                        <span>Cost</span>
                        <span>Discounted</span>
                      </div>
                      <div
                        v-for="(row, idx) in item.pricing_json"
                        :key="idx"
                        class="pricing-table__row"
                      >
                        <span>{{ row.size }}</span>
                        <span>{{ row.dim }}</span>
                        <span>{{ row.cost }}</span>
                        <span>{{ row.discounted_cost }}</span>
                      </div>
                    </div>

                    <div v-if="item.validation_flags && Object.keys(item.validation_flags).length" class="item-card__flags">
                      <i class="fas fa-exclamation-circle"></i>
                      {{ Object.keys(item.validation_flags).join(', ') }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- CLIENT ACTIONS -->
              <div class="client-card__actions">
                <button class="btn-primary" @click="loadIntoProposal(client)">
                  <i class="fas fa-pen-nib"></i> Open in Proposal Editor
                </button>
                <button
                  class="btn-secondary"
                  :disabled="!canGenerate(client) || isGenerating"
                  @click="generateImagesForClient(client)"
                >
                  <i class="fas fa-magic"></i> Generate Mockups
                </button>
                <button
                  class="btn-accent"
                  :disabled="sending || !canSend(client)"
                  @click="sendClient(client)"
                >
                  <i class="fas fa-paper-plane"></i> Send to N8N
                </button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/services/supabase'
import { showToast } from '@/utils/toast'
import { loadImportIntoProposal } from '@/utils/importMapper'

const route = useRoute()
const router = useRouter()
const batchId = route.params.batchId

const API_BASE = 'http://localhost:3001'

const loading = ref(true)
const refreshing = ref(false)
const sending = ref(false)
const isGenerating = ref(false)
const error = ref(null)
const batch = ref(null)
const clients = ref([])
const expandedClients = ref([])
const selectedClients = ref([])
const regenerating = ref({})
const generationStatus = ref(null)
const pollTimer = ref(null)

const totalItems = computed(() => clients.value.reduce((sum, c) => sum + (c.items?.length || 0), 0))

const batchStatus = computed(() => {
  if (!batch.value) return 'unknown'
  return batch.value.status
})

const qualityScore = computed(() => {
  if (clients.value.length === 0) return 0
  let totalFields = 0
  let filledFields = 0
  const required = ['sign_type', 'size', 'original_price', 'color', 'finish']
  for (const client of clients.value) {
    for (const item of client.items || []) {
      for (const field of required) {
        totalFields++
        if (item[field] != null && String(item[field]).trim() !== '') {
          filledFields++
        }
      }
    }
  }
  if (totalFields === 0) {
    // Fallback: count clients with names vs unknown
    const named = clients.value.filter(c => c.client_name && c.client_name !== 'Unknown Client').length
    return Math.round((named / clients.value.length) * 100)
  }
  return Math.round((filledFields / totalFields) * 100)
})

const qualityLevel = computed(() => {
  if (qualityScore.value >= 90) return 'good'
  if (qualityScore.value >= 50) return 'mixed'
  return 'poor'
})

const qualityTitle = computed(() => {
  if (qualityLevel.value === 'good') return 'Extraction looks good'
  if (qualityLevel.value === 'mixed') return 'Some fields need review'
  return 'Extraction is incomplete — please edit'
})

const qualityMessage = computed(() => {
  if (qualityLevel.value === 'good') return 'Most key fields were found. Review each client, then load into the Proposal Editor or send to N8N.'
  if (qualityLevel.value === 'mixed') return 'Some sign types, sizes, or prices were missing from the PDFs. Fill them in manually, then proceed.'
  return 'This PDF is image-based and could not be fully read. The AI Vision extraction may have hit a rate limit (free-tier quota). You can: (1) Fill the fields manually below, (2) Wait a minute and re-upload, or (3) Upgrade your Gemini API key to remove rate limits.'
})

const fetchBatchData = async (silent = false) => {
  if (!silent) loading.value = true
  else refreshing.value = true
  error.value = null
  try {
    const res = await fetch(`${API_BASE}/api/batch/status/${batchId}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `Failed to fetch batch status (${res.status})`)
    }

    const data = await res.json()
    batch.value = data.batch

    const enriched = []
    for (const client of data.clients || []) {
      let items = []
      try {
        const clientRes = await fetch(`${API_BASE}/api/batch/client/${client.id}`)
        if (clientRes.ok) {
          const clientData = await clientRes.json()
          items = clientData.items || []
        }
      } catch (e) {
        console.warn('Failed to fetch client items:', e)
      }
      enriched.push({ ...client, items })
    }

    clients.value = enriched

    // Keep selected clients that still exist
    selectedClients.value = selectedClients.value.filter(id => clients.value.some(c => c.id === id))

    // Auto-select ready/extracted clients if none selected yet
    if (selectedClients.value.length === 0) {
      selectedClients.value = clients.value
        .filter(c => c.status === 'ready_for_review' || c.status === 'extracted' || c.status === 'queued_for_processing')
        .map(c => c.id)
    }
  } catch (err) {
    error.value = err.message
  } finally {
    if (!silent) loading.value = false
    else refreshing.value = false
  }
}

onMounted(() => {
  fetchBatchData()
  startPolling()
})

onUnmounted(() => {
  if (pollTimer.value) clearInterval(pollTimer.value)
})

watch(batchStatus, (status) => {
  if (status === 'processing_images') startPolling()
})

const startPolling = () => {
  if (pollTimer.value) return
  pollGenerationStatus()
  pollTimer.value = setInterval(() => {
    pollGenerationStatus()
    fetchBatchData(true)
  }, 5000)
}

const refreshData = () => {
  fetchBatchData(true)
  pollGenerationStatus()
}

const toggleClient = (clientId) => {
  const idx = expandedClients.value.indexOf(clientId)
  if (idx > -1) expandedClients.value.splice(idx, 1)
  else expandedClients.value.push(clientId)
}

const getImageUrl = (item) => {
  if (!item) return ''
  const path = item.regenerated_image_path || item.original_image_path
  if (!path) return ''
  if (path.startsWith('http')) return path
  if (supabase) {
    return supabase.storage.from('import-images').getPublicUrl(path).data.publicUrl
  }
  return ''
}

const getItemImageUrls = (item) => {
  if (!item) return []
  const paths = item.original_image_paths?.length
    ? item.original_image_paths
    : (item.original_image_path ? [item.original_image_path] : [])
  const primary = item.regenerated_image_path

  const urls = paths.map(p => {
    if (!p) return null
    if (p.startsWith('http')) return p
    if (supabase) return supabase.storage.from('import-images').getPublicUrl(p).data.publicUrl
    return null
  }).filter(Boolean)

  if (primary && !urls.some(u => u.includes(primary))) {
    const primaryUrl = primary.startsWith('http')
      ? primary
      : supabase?.storage.from('import-images').getPublicUrl(primary).data.publicUrl
    if (primaryUrl) urls.unshift(primaryUrl)
  }

  return urls
}

const updateItem = async (item, field, value) => {
  try {
    const { error: err } = await supabase
      .from('import_items')
      .update({ [field]: value })
      .eq('id', item.id)
    if (err) throw err
    showToast('Updated', 'success')
  } catch (err) {
    console.error('Update error:', err)
    showToast('Failed to update', 'error')
  }
}

const canGenerate = (client) => {
  return client.items?.some(i => !i.regenerated_image_path)
}

const canSend = (client) => {
  return client.status === 'ready_for_review' || client.status === 'extracted' || client.status === 'queued_for_processing'
}

const generateImagesForClient = async (client) => {
  await generateImagesForClients([client.id])
}

const generateImagesForSelected = async () => {
  if (selectedClients.value.length === 0) return
  await generateImagesForClients(selectedClients.value)
}

const generateImagesForClients = async (clientIds) => {
  isGenerating.value = true
  try {
    // For simplicity, we call the batch-level process endpoint for the whole batch.
    // The backend only processes items that are queued_for_processing.
    // First, reset the selected clients' items to queued_for_processing so they can be re-generated.
    for (const clientId of clientIds) {
      const client = clients.value.find(c => c.id === clientId)
      if (!client?.items?.length) continue
      for (const item of client.items) {
        await supabase.from('import_items').update({ status: 'queued_for_processing' }).eq('id', item.id)
      }
    }

    const res = await fetch(`${API_BASE}/api/image-gen/process-batch/${batchId}`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to start image generation')
    showToast('Image generation started', 'success')
    startPolling()
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    isGenerating.value = false
  }
}

const pollGenerationStatus = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/image-gen/status/${batchId}`)
    if (!res.ok) return
    generationStatus.value = await res.json()
  } catch (e) {
    // silent
  }
}

const regenerateImage = async (item) => {
  try {
    regenerating.value[item.id] = true
    const res = await fetch(`${API_BASE}/api/image-gen/regenerate/${item.id}`, { method: 'POST' })
    if (!res.ok) throw new Error('Regeneration failed')
    showToast('Regeneration queued', 'success')
    setTimeout(() => refreshData(), 2000)
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    regenerating.value[item.id] = false
  }
}

const loadIntoProposal = (client) => {
  localStorage.setItem('pendingImportClient', JSON.stringify(client))
  const url = router.resolve({ path: '/' }).href
  window.open(url, '_blank')
}

const sendClient = async (client) => {
  await sendClients([client.id])
}

const sendApproved = async () => {
  if (selectedClients.value.length === 0) return
  if (!confirm(`Generate PDFs and send proposals to ${selectedClients.value.length} clients via N8N?`)) return
  await sendClients(selectedClients.value)
}

const sendClients = async (clientIds) => {
  sending.value = true
  try {
    const res = await fetch(`${API_BASE}/api/batch/${batchId}/send-approved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientIds })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || 'Failed to start sending')
    }
    showToast('Send started. Check terminal for progress.', 'success', 5000)
    clients.value.forEach(c => {
      if (clientIds.includes(c.id)) c.status = 'sending'
    })
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
/* ----------------------------------------------------------------
   BASE LAYOUT
---------------------------------------------------------------- */
.batch-review {
  min-height: 100vh;
  background: #080c14;
  color: #e2e8f0;
  font-family: 'Inter', 'Segoe UI', sans-serif;
}

/* ----------------------------------------------------------------
   NAV
---------------------------------------------------------------- */
.batch-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  height: 60px;
  background: rgba(10, 15, 30, 0.95);
  border-bottom: 1px solid rgba(0, 243, 255, 0.12);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 100;
}

.batch-nav__brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1rem;
  color: #00f3ff;
}

.batch-nav__brand i { font-size: 1.1rem; }

.batch-nav__links {
  display: flex;
  gap: 1.5rem;
}

.batch-nav__link {
  color: #94a3b8;
  text-decoration: none;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transition: color 0.2s;
}

.batch-nav__link:hover,
.batch-nav__link.router-link-active { color: #00f3ff; }

/* ----------------------------------------------------------------
   HERO
---------------------------------------------------------------- */
.batch-hero {
  padding: 3rem 2rem 2rem;
  background: linear-gradient(180deg, rgba(0,243,255,0.04) 0%, transparent 100%);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  text-align: center;
}

.batch-hero__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(0,243,255,0.1);
  border: 1px solid rgba(0,243,255,0.25);
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  font-size: 0.78rem;
  color: #00f3ff;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 1rem;
}

.batch-hero__title {
  font-size: clamp(1.8rem, 4vw, 2.8rem);
  font-weight: 800;
  color: #fff;
  margin: 0 0 0.75rem;
  letter-spacing: -0.02em;
}

.batch-hero__subtitle {
  color: #94a3b8;
  font-size: 1rem;
  max-width: 600px;
  margin: 0 auto;
  line-height: 1.6;
}

/* ----------------------------------------------------------------
   MAIN
---------------------------------------------------------------- */
.batch-main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ----------------------------------------------------------------
   SUMMARY
---------------------------------------------------------------- */
.batch-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
}

.summary-card {
  background: rgba(15, 22, 40, 0.85);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  padding: 1.25rem;
  text-align: center;
}

.summary-card__value {
  display: block;
  font-size: 1.8rem;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}

.summary-card__label {
  display: block;
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 0.4rem;
}

.summary-card--discount .summary-card__value { color: #00f3ff; }
.summary-card--status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #64748b;
}
.status-dot--extracted { background: #94a3b8; }
.status-dot--queued_for_processing { background: #3b82f6; }
.status-dot--processing_images { background: #3b82f6; animation: pulse 1.5s infinite; }
.status-dot--ready_for_review { background: #f59e0b; }
.status-dot--approved { background: #10b981; }
.status-dot--sent { background: #10b981; }
.status-dot--failed { background: #ef4444; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ----------------------------------------------------------------
   TOOLBAR
---------------------------------------------------------------- */
.batch-toolbar {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: center;
}

/* ----------------------------------------------------------------
   BUTTONS
---------------------------------------------------------------- */
.btn-primary,
.btn-secondary,
.btn-accent {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
  border-radius: 10px;
  padding: 0.65rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: linear-gradient(135deg, #00f3ff, #0088cc);
  color: #000;
}
.btn-primary:hover:not(:disabled) {
  box-shadow: 0 0 20px rgba(0,243,255,0.35);
  transform: translateY(-1px);
}

.btn-secondary {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e2e8f0;
}
.btn-secondary:hover:not(:disabled) { background: rgba(255,255,255,0.1); }

.btn-accent {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff;
}
.btn-accent:hover:not(:disabled) {
  box-shadow: 0 0 20px rgba(16,185,129,0.35);
  transform: translateY(-1px);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.12);
  color: #94a3b8;
  border-radius: 10px;
  padding: 0.65rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s;
}
.btn-ghost:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
.btn-back { margin-right: auto; }

.batch-nav__link--back {
  background: rgba(0,243,255,0.08);
  border: 1px solid rgba(0,243,255,0.18);
  border-radius: 8px;
  padding: 0.4rem 0.8rem;
  color: #00f3ff;
}
.batch-nav__link--back:hover { background: rgba(0,243,255,0.14); color: #fff; }

/* ----------------------------------------------------------------
   QUALITY BANNER
---------------------------------------------------------------- */
.quality-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  font-size: 0.9rem;
}
.quality-banner__icon { font-size: 1.5rem; }
.quality-banner__body { flex: 1; }
.quality-banner__body strong { display: block; color: #fff; margin-bottom: 0.2rem; }
.quality-banner__body p { margin: 0; color: #94a3b8; line-height: 1.4; }
.quality-banner__score {
  text-align: center;
  min-width: 60px;
}
.quality-score__value {
  display: block;
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1;
}
.quality-score__label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.quality-banner--good {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}
.quality-banner--good .quality-score__value { color: #10b981; }
.quality-banner--mixed {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}
.quality-banner--mixed .quality-score__value { color: #f59e0b; }
.quality-banner--poor {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
.quality-banner--poor .quality-score__value { color: #ef4444; }

.btn-overlay {
  background: rgba(0,0,0,0.7);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  border-radius: 8px;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-overlay:hover:not(:disabled) { background: rgba(0,0,0,0.85); }

/* ----------------------------------------------------------------
   GENERATION STATUS
---------------------------------------------------------------- */
.gen-status {
  background: rgba(15, 22, 40, 0.85);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  padding: 1.25rem;
}

.gen-status__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.gen-stat {
  text-align: center;
}

.gen-stat__value {
  display: block;
  font-size: 1.5rem;
  font-weight: 800;
  color: #00f3ff;
}

.gen-stat__label {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
}

.gen-status__note {
  margin: 1rem 0 0;
  font-size: 0.82rem;
  color: #64748b;
  text-align: center;
}

/* ----------------------------------------------------------------
   CLIENT CARDS
---------------------------------------------------------------- */
.clients-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.client-card {
  background: rgba(15, 22, 40, 0.85);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 14px;
  overflow: hidden;
}

.client-card__header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  cursor: pointer;
  transition: background 0.15s;
}

.client-card__header:hover { background: rgba(255,255,255,0.02); }

.client-card__select input {
  width: 18px;
  height: 18px;
  accent-color: #00f3ff;
  cursor: pointer;
}

.client-card__name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.3rem;
  font-size: 1.15rem;
  color: #fff;
}

.client-card__email {
  margin: 0;
  font-size: 0.85rem;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.client-card__meta {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.client-card__count {
  font-size: 0.85rem;
  color: #64748b;
}

.client-card__chevron {
  color: #64748b;
  transition: transform 0.2s;
}

.client-card--expanded .client-card__chevron { transform: rotate(180deg); }

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}

.status-badge--extracted { background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border-color: rgba(148, 163, 184, 0.25); }
.status-badge--queued_for_processing { background: rgba(59, 130, 246, 0.12); color: #93c5fd; border-color: rgba(59, 130, 246, 0.25); }
.status-badge--processing_images { background: rgba(59, 130, 246, 0.15); color: #93c5fd; border-color: rgba(59, 130, 246, 0.35); }
.status-badge--ready_for_review { background: rgba(245, 158, 11, 0.12); color: #fcd34d; border-color: rgba(245, 158, 11, 0.25); }
.status-badge--approved { background: rgba(16, 185, 129, 0.12); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.25); }
.status-badge--sent { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.35); }
.status-badge--failed { background: rgba(239, 68, 68, 0.12); color: #fca5a5; border-color: rgba(239, 68, 68, 0.25); }
.status-badge--needs_manual_check { background: rgba(245, 158, 11, 0.15); color: #fcd34d; border-color: rgba(245, 158, 11, 0.35); }
.status-badge--sending { background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.35); }

/* ----------------------------------------------------------------
   CLIENT BODY
---------------------------------------------------------------- */
.client-card__body {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 1.5rem;
}

.client-card__empty {
  color: #64748b;
  font-size: 0.9rem;
  padding: 1rem;
  text-align: center;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.25rem;
  margin-bottom: 1.5rem;
}

.item-card {
  background: rgba(8, 12, 20, 0.6);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  overflow: hidden;
}

.item-card--needs-review { border-color: rgba(245, 158, 11, 0.35); }

.item-card__images {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  background: #0a0f1a;
  padding: 0.5rem;
}

@media (max-width: 600px) {
  .item-card__images { grid-template-columns: 1fr; }
}

.item-card__image-label {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  background: rgba(0,0,0,0.7);
  color: #e2e8f0;
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  z-index: 2;
}

.item-card__image {
  position: relative;
  aspect-ratio: 16 / 10;
  background: #0a0f1a;
  overflow: hidden;
}

.item-card__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-card__image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #475569;
  gap: 0.5rem;
}

.item-card__image-placeholder i { font-size: 2rem; }

.item-card__image-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.55);
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}

.item-card__image:hover .item-card__image-overlay { opacity: 1; }

.item-card__model-tag {
  position: absolute;
  bottom: 0.5rem;
  left: 0.5rem;
  background: rgba(0,0,0,0.65);
  color: #94a3b8;
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}

.item-card__fields {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-group label {
  font-size: 0.7rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
}

.field-group input {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #e2e8f0;
  font-size: 0.9rem;
  outline: none;
}

.field-group input:focus { border-color: rgba(0,243,255,0.5); }

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.pricing-table {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.85rem;
}

.pricing-table__header,
.pricing-table__row {
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr 1fr;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
}

.pricing-table__header {
  background: rgba(255,255,255,0.04);
  color: #64748b;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
}

.pricing-table__row {
  border-top: 1px solid rgba(255,255,255,0.04);
  color: #e2e8f0;
}

.pricing-table__row span:last-child { color: #00f3ff; }

.item-card__flags {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: #fcd34d;
  font-size: 0.78rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.client-card__actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  padding-top: 1rem;
  border-top: 1px solid rgba(255,255,255,0.06);
}

/* ----------------------------------------------------------------
   STATES
---------------------------------------------------------------- */
.batch-state {
  text-align: center;
  padding: 4rem 2rem;
  color: #94a3b8;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #00f3ff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin { to { transform: rotate(360deg); } }

.batch-error {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 10px;
  padding: 1rem;
  color: #fca5a5;
  font-size: 0.9rem;
}

.batch-error--large {
  flex-direction: column;
  text-align: center;
  padding: 2rem;
}

.batch-error--large i { font-size: 2rem; }
.batch-error--large strong { display: block; margin-bottom: 0.5rem; color: #fff; }

@media (max-width: 768px) {
  .gen-status__grid { grid-template-columns: repeat(2, 1fr); }
  .client-card__header { grid-template-columns: auto 1fr; }
  .client-card__meta { grid-column: 1 / -1; justify-content: flex-start; }
  .items-grid { grid-template-columns: 1fr; }
  .field-row { grid-template-columns: 1fr; }
}
</style>
