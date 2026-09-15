<template>
  <div class="batch-upload-view">

    <!-- TOP NAV -->
    <nav class="batch-nav no-print">
      <div class="batch-nav__brand">
        <i class="fas fa-layer-group"></i>
        <span>Signage Crafting <strong>Batch Engine</strong></span>
      </div>
      <div class="batch-nav__links">
        <router-link to="/" class="batch-nav__link">
          <i class="fas fa-pen-nib"></i> Proposal Editor
        </router-link>
        <router-link to="/settings" class="batch-nav__link">
          <i class="fas fa-cog"></i> Settings
        </router-link>
      </div>
    </nav>

    <!-- HERO HEADER -->
    <header class="batch-hero">
      <div class="batch-hero__inner">
        <div class="batch-hero__badge">
          <i class="fas fa-bolt"></i> Bulk Automation
        </div>
        <h1 class="batch-hero__title">Batch Proposal Engine</h1>
        <p class="batch-hero__subtitle">
          Drop 1 to 50 client PDFs. We extract, generate AI mockups, and queue them for one-click sending.
        </p>
      </div>
    </header>

    <!-- MAIN CONTENT -->
    <main class="batch-main">

      <!-- ============================================================ -->
      <!-- STEP 1: UPLOAD ZONE                                          -->
      <!-- ============================================================ -->
      <section class="batch-card" v-if="!batchResult">
        <div class="batch-card__head">
          <span class="batch-card__step">01</span>
          <h2>Select Client PDFs</h2>
          <p>Choose any number of PDFs — from 1 to 50 — in a single upload.</p>
        </div>

        <!-- Drag & Drop Zone -->
        <div
          class="drop-zone"
          :class="{
            'drop-zone--active': isDragging,
            'drop-zone--filled': selectedFiles.length > 0
          }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
          @click="triggerFileInput"
        >
          <input
            ref="fileInputRef"
            type="file"
            accept=".pdf,application/pdf"
            multiple
            class="drop-zone__input"
            @change="handleFileSelect"
          />

          <div v-if="selectedFiles.length === 0" class="drop-zone__prompt">
            <div class="drop-zone__icon">
              <i class="fas fa-file-pdf"></i>
            </div>
            <p class="drop-zone__label">Drag & Drop PDFs here</p>
            <p class="drop-zone__sub">or click to browse — up to 50 files</p>
          </div>

          <div v-else class="drop-zone__filled-state">
            <div class="drop-zone__count-badge">
              <i class="fas fa-check-circle"></i>
              {{ selectedFiles.length }} PDF{{ selectedFiles.length > 1 ? 's' : '' }} selected
            </div>
            <p class="drop-zone__sub">Click to change selection</p>
          </div>
        </div>

        <!-- File List Preview -->
        <div v-if="selectedFiles.length > 0" class="file-list">
          <div
            v-for="(file, i) in selectedFiles"
            :key="i"
            class="file-list__item"
          >
            <i class="fas fa-file-pdf file-list__icon"></i>
            <span class="file-list__name">{{ file.name }}</span>
            <span class="file-list__size">{{ formatSize(file.size) }}</span>
            <button class="file-list__remove" @click.stop="removeFile(i)" title="Remove">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <!-- OPTIONS ROW -->
        <div class="batch-options" v-if="selectedFiles.length > 0">
          <div class="batch-options__field">
            <label for="discount">Batch Discount %</label>
            <div class="batch-options__input-wrap">
              <input
                id="discount"
                v-model.number="discountPercent"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder="0"
              />
              <span class="batch-options__unit">%</span>
            </div>
            <p class="batch-options__hint">Applied to all prices in this batch</p>

            <div class="batch-options__checkbox">
              <input
                id="auto-gen"
                type="checkbox"
                v-model="autoGenerateImages"
              />
              <label for="auto-gen">Auto-generate AI mockups after extraction</label>
            </div>
            
            <div class="batch-options__checkbox">
              <input
                id="skip-last-page"
                type="checkbox"
                v-model="skipLastPage"
              />
              <label for="skip-last-page">Ignore the last page of each PDF (saves time/credits)</label>
            </div>
          </div>

          <div class="batch-options__field">
            <label>Summary</label>
            <div class="batch-options__summary">
              <div class="batch-options__stat">
                <span class="stat-value">{{ selectedFiles.length }}</span>
                <span class="stat-label">PDFs</span>
              </div>
              <div class="batch-options__stat">
                <span class="stat-value">{{ discountPercent }}%</span>
                <span class="stat-label">Discount</span>
              </div>
              <div class="batch-options__stat">
                <span class="stat-value">~{{ Math.ceil(selectedFiles.length * 0.5) }}m</span>
                <span class="stat-label">Est. Time</span>
              </div>
            </div>
          </div>
        </div>

        <!-- UPLOAD BUTTON -->
        <div class="batch-card__actions">
          <button
            class="btn-primary"
            :disabled="selectedFiles.length === 0 || isUploading"
            @click="startUpload"
          >
            <span v-if="!isUploading">
              <i class="fas fa-rocket"></i>
              Start Extraction ({{ selectedFiles.length }} PDF{{ selectedFiles.length > 1 ? 's' : '' }})
            </span>
            <span v-else>
              <i class="fas fa-spinner fa-spin"></i>
              Uploading &amp; Extracting...
            </span>
          </button>

          <button
            v-if="selectedFiles.length > 0 && !isUploading"
            class="btn-ghost"
            @click="clearAll"
          >
            <i class="fas fa-trash-alt"></i> Clear All
          </button>
        </div>

        <!-- Upload Progress -->
        <div v-if="isUploading" class="upload-progress">
          <div class="upload-progress__bar-wrap">
            <div class="upload-progress__bar" :style="{ width: uploadProgress + '%' }"></div>
          </div>
          <p class="upload-progress__label">{{ uploadStatusText }}</p>
        </div>

        <!-- Error -->
        <div v-if="uploadError" class="batch-error">
          <i class="fas fa-exclamation-triangle"></i>
          {{ uploadError }}
        </div>
      </section>


      <!-- ============================================================ -->
      <!-- STEP 2: RESULTS TABLE (after upload)                        -->
      <!-- ============================================================ -->
      <section class="batch-card" v-if="batchResult">
        <div class="batch-card__head">
          <span class="batch-card__step">02</span>
          <h2>Extraction Results</h2>
          <p>Batch ID: <code>{{ batchResult.batch_id }}</code></p>
        </div>

        <!-- Summary Pills -->
        <div class="result-pills">
          <div class="result-pill result-pill--total">
            <span class="pill-value">{{ batchResult.total }}</span>
            <span class="pill-label">Total PDFs</span>
          </div>
          <div class="result-pill result-pill--ok">
            <i class="fas fa-check"></i>
            <span class="pill-value">{{ batchResult.success }}</span>
            <span class="pill-label">Extracted OK</span>
          </div>
          <div class="result-pill result-pill--warn" v-if="batchResult.needs_manual_check > 0">
            <i class="fas fa-exclamation"></i>
            <span class="pill-value">{{ batchResult.needs_manual_check }}</span>
            <span class="pill-label">Need Review</span>
          </div>
          <div class="result-pill result-pill--error" v-if="batchResult.failed > 0">
            <i class="fas fa-times"></i>
            <span class="pill-value">{{ batchResult.failed }}</span>
            <span class="pill-label">Failed</span>
          </div>
        </div>

        <!-- Client Rows -->
        <div class="result-table">
          <div class="result-table__header">
            <span>Client Name</span>
            <span>Email</span>
            <span>Items</span>
            <span>Status</span>
          </div>

          <div
            v-for="row in batchResult.results"
            :key="row.file"
            class="result-table__row"
            :class="{
              'result-table__row--warn': row.needs_manual_check,
              'result-table__row--error': row.status === 'error'
            }"
          >
            <span class="result-table__name">
              <i class="fas fa-user-circle"></i>
              {{ row.client_name || '—' }}
            </span>
            <span class="result-table__file">{{ row.file }}</span>
            <span class="result-table__items">{{ row.items ?? '—' }} item{{ row.items !== 1 ? 's' : '' }}</span>
            <span class="result-table__status">
              <span v-if="row.status === 'error'" class="status-badge status-badge--error">
                <i class="fas fa-times-circle"></i> {{ row.error?.slice(0, 60) }}
              </span>
              <span v-else-if="row.needs_manual_check" class="status-badge status-badge--warn">
                <i class="fas fa-exclamation-circle"></i> Needs Review
              </span>
              <span v-else class="status-badge status-badge--ok">
                <i class="fas fa-check-circle"></i> Queued
              </span>
            </span>
          </div>
        </div>

        <!-- ACTION: Start Image Generation -->
        <div class="batch-card__actions batch-card__actions--result">
          <button
            class="btn-primary"
            :disabled="isGenerating"
            @click="startImageGeneration"
          >
            <span v-if="!isGenerating">
              <i class="fas fa-magic"></i>
              Generate AI Mockups ({{ batchResult.success }} clients)
            </span>
            <span v-else>
              <i class="fas fa-spinner fa-spin"></i>
              Generating Images...
            </span>
          </button>

          <button class="btn-ghost" @click="resetUpload">
            <i class="fas fa-plus"></i> Upload Another Batch
          </button>
        </div>

        <!-- Generation Progress -->
        <div v-if="generationStatus" class="gen-status">
          <div class="gen-status__grid">
            <div class="gen-stat">
              <span class="gen-stat__value">{{ generationStatus.summary?.ready || 0 }}</span>
              <span class="gen-stat__label">Ready for Review</span>
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
              <span class="gen-stat__label">Fallback Model Used</span>
            </div>
          </div>
          <p class="gen-status__note">
            <i class="fas fa-info-circle"></i>
            Image generation runs in the background. Check back in a few minutes or refresh this status.
          </p>
          <button class="btn-ghost btn-sm" @click="pollGenerationStatus">
            <i class="fas fa-sync-alt"></i> Refresh Status
          </button>
        </div>
      </section>

    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
const fileInputRef       = ref(null)
const selectedFiles      = ref([])
const discountPercent    = ref(0)
const isDragging         = ref(false)
const isUploading        = ref(false)
const uploadProgress     = ref(0)
const uploadStatusText   = ref('Uploading PDFs...')
const uploadError        = ref(null)
const batchResult        = ref(null)
const isGenerating       = ref(false)
const generationStatus   = ref(null)
const autoGenerateImages = ref(false)
const skipLastPage       = ref(true)
const router             = useRouter()

const API_BASE = 'http://localhost:3001'

// ----------------------------------------------------------------
// File Handling
// ----------------------------------------------------------------
const triggerFileInput = () => fileInputRef.value?.click()

const validateFiles = (files) => {
  const valid = []
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      continue  // silently skip non-PDFs
    }
    valid.push(file)
  }
  return valid.slice(0, 50)  // cap at 50
}

const handleFileSelect = (event) => {
  const newFiles = validateFiles(Array.from(event.target.files || []))
  // Merge with existing, dedup by name, cap at 50
  const existing = selectedFiles.value.map(f => f.name)
  const merged = [...selectedFiles.value, ...newFiles.filter(f => !existing.includes(f.name))]
  selectedFiles.value = merged.slice(0, 50)
  // Reset the input so the same file can be re-selected
  event.target.value = ''
}

const handleDrop = (event) => {
  isDragging.value = false
  const newFiles = validateFiles(Array.from(event.dataTransfer?.files || []))
  const existing = selectedFiles.value.map(f => f.name)
  const merged = [...selectedFiles.value, ...newFiles.filter(f => !existing.includes(f.name))]
  selectedFiles.value = merged.slice(0, 50)
}

const removeFile = (index) => {
  selectedFiles.value.splice(index, 1)
}

const clearAll = () => {
  selectedFiles.value = []
  uploadError.value = null
}

const formatSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}


// ----------------------------------------------------------------
// Upload & Extract
// ----------------------------------------------------------------
const startUpload = async () => {
  if (!selectedFiles.value.length) return

  isUploading.value  = true
  uploadProgress.value = 10
  uploadStatusText.value = `Uploading ${selectedFiles.value.length} PDF(s)...`
  uploadError.value  = null

  const formData = new FormData()
  for (const file of selectedFiles.value) {
    formData.append('files', file)
  }
  formData.append('discount_percent', discountPercent.value)
  formData.append('skip_last_page', skipLastPage.value)

  try {
    uploadProgress.value = 30
    uploadStatusText.value = 'Sending to server...'

    // Start a simulated progress bar since the API blocks until all PDFs are extracted
    const progressInterval = setInterval(() => {
      if (uploadProgress.value < 90) {
        uploadProgress.value += (90 - uploadProgress.value) * 0.1 // Ease towards 90%
        if (uploadProgress.value > 45) {
          uploadStatusText.value = 'Extracting data with AI... (this may take a minute)'
        }
      }
    }, 1500)

    let res;
    try {
      res = await fetch(`${API_BASE}/api/batch/upload`, {
        method: 'POST',
        body: formData,
      })
    } finally {
      clearInterval(progressInterval)
    }

    uploadProgress.value = 95
    uploadStatusText.value = 'Finalizing...'

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `Server error: ${res.status}`)
    }

    const result = await res.json()
    uploadProgress.value = 100
    uploadStatusText.value = 'Done!'

    setTimeout(() => {
      batchResult.value = result
      isUploading.value = false

      if (result.failed === result.total) {
        uploadError.value = 'All PDFs failed to extract. Check the results below.'
        return
      }

      if (autoGenerateImages.value && result.success > 0) {
        startImageGeneration()
      }

      // Navigate to the review page so the user can see/edit/fill the proposal
      router.push(`/batch-review/${result.batch_id}`)
    }, 800)

  } catch (err) {
    uploadError.value = err.message
    isUploading.value = false
    uploadProgress.value = 0
  }
}


// ----------------------------------------------------------------
// Image Generation
// ----------------------------------------------------------------
const startImageGeneration = async () => {
  if (!batchResult.value?.batch_id) return

  isGenerating.value = true

  try {
    const res = await fetch(`${API_BASE}/api/image-gen/process-batch/${batchResult.value.batch_id}`, {
      method: 'POST',
    })

    if (!res.ok) throw new Error('Failed to start image generation')

    await res.json()

    // Start polling after a short delay
    setTimeout(pollGenerationStatus, 5000)

  } catch (err) {
    uploadError.value = err.message
    isGenerating.value = false
  }
}

const pollGenerationStatus = async () => {
  if (!batchResult.value?.batch_id) return

  try {
    const res = await fetch(`${API_BASE}/api/image-gen/status/${batchResult.value.batch_id}`)
    if (!res.ok) return
    generationStatus.value = await res.json()

    const { summary } = generationStatus.value
    if (summary && summary.processing === 0) {
      isGenerating.value = false
    }
  } catch {
    // Silent fail — user can manually refresh
  }
}


// ----------------------------------------------------------------
// Reset
// ----------------------------------------------------------------
const resetUpload = () => {
  batchResult.value      = null
  generationStatus.value = null
  selectedFiles.value    = []
  discountPercent.value  = 0
  uploadError.value      = null
  isUploading.value      = false
  isGenerating.value     = false
  uploadProgress.value   = 0
}
</script>

<style scoped>
/* ----------------------------------------------------------------
   BASE LAYOUT
---------------------------------------------------------------- */
.batch-upload-view {
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
  padding: 3.5rem 2rem 2.5rem;
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
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.6;
}

/* ----------------------------------------------------------------
   MAIN
---------------------------------------------------------------- */
.batch-main {
  max-width: 860px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* ----------------------------------------------------------------
   CARD
---------------------------------------------------------------- */
.batch-card {
  background: rgba(15, 22, 40, 0.85);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 8px 40px rgba(0,0,0,0.35);
}

.batch-card__head {
  margin-bottom: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.batch-card__step {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #00f3ff;
}

.batch-card__head h2 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: #fff;
}

.batch-card__head p {
  margin: 0;
  color: #64748b;
  font-size: 0.9rem;
}

.batch-card__head p code {
  background: rgba(0,243,255,0.1);
  color: #00f3ff;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.8rem;
}

/* ----------------------------------------------------------------
   DROP ZONE
---------------------------------------------------------------- */
.drop-zone {
  border: 2px dashed rgba(0,243,255,0.2);
  border-radius: 12px;
  padding: 3rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  background: rgba(0,243,255,0.02);
}

.drop-zone:hover,
.drop-zone--active {
  border-color: rgba(0,243,255,0.55);
  background: rgba(0,243,255,0.05);
}

.drop-zone--filled {
  border-color: rgba(0,243,255,0.35);
}

.drop-zone__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  width: 100%;
  height: 100%;
}

.drop-zone__icon {
  font-size: 2.5rem;
  color: #00f3ff;
  opacity: 0.5;
  margin-bottom: 1rem;
}

.drop-zone__label {
  font-size: 1rem;
  font-weight: 600;
  color: #e2e8f0;
  margin: 0 0 0.3rem;
}

.drop-zone__sub {
  font-size: 0.82rem;
  color: #475569;
  margin: 0;
}

.drop-zone__count-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(0,243,255,0.12);
  border: 1px solid rgba(0,243,255,0.3);
  border-radius: 999px;
  padding: 0.4rem 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #00f3ff;
  margin-bottom: 0.5rem;
}

/* ----------------------------------------------------------------
   FILE LIST
---------------------------------------------------------------- */
.file-list {
  margin-top: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 260px;
  overflow-y: auto;
}

.file-list__item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
}

.file-list__icon { color: #ef4444; font-size: 1rem; flex-shrink: 0; }

.file-list__name {
  flex: 1;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-list__size { color: #475569; font-size: 0.78rem; flex-shrink: 0; }

.file-list__remove {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
  transition: color 0.15s;
  flex-shrink: 0;
}

.file-list__remove:hover { color: #ef4444; }

/* ----------------------------------------------------------------
   OPTIONS
---------------------------------------------------------------- */
.batch-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.batch-options__field label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  margin-bottom: 0.5rem;
}

.batch-options__input-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.batch-options__input-wrap input {
  width: 100%;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 0.55rem 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.batch-options__input-wrap input:focus { border-color: rgba(0,243,255,0.5); }

.batch-options__unit { color: #64748b; font-size: 0.9rem; }

.batch-options__hint {
  font-size: 0.75rem;
  color: #475569;
  margin: 0.35rem 0 0;
}

.batch-options__checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
}

.batch-options__checkbox input {
  width: 16px;
  height: 16px;
  accent-color: #00f3ff;
  cursor: pointer;
}

.batch-options__checkbox label {
  font-size: 0.82rem;
  color: #94a3b8;
  cursor: pointer;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
}

.batch-options__summary {
  display: flex;
  gap: 1.5rem;
}

.batch-options__stat { text-align: center; }

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 800;
  color: #00f3ff;
  line-height: 1;
}

.stat-label {
  display: block;
  font-size: 0.72rem;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0.2rem;
}

/* ----------------------------------------------------------------
   ACTIONS
---------------------------------------------------------------- */
.batch-card__actions {
  display: flex;
  gap: 1rem;
  margin-top: 1.75rem;
  flex-wrap: wrap;
}

.batch-card__actions--result { margin-top: 2rem; }

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  background: linear-gradient(135deg, #00f3ff, #0088cc);
  color: #000;
  border: none;
  border-radius: 10px;
  padding: 0.75rem 1.5rem;
  font-size: 0.92rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: none;
}

.btn-primary:hover:not(:disabled) {
  box-shadow: 0 0 20px rgba(0,243,255,0.4);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: #94a3b8;
  border-radius: 10px;
  padding: 0.75rem 1.25rem;
  font-size: 0.88rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-ghost:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }

.btn-sm { padding: 0.45rem 0.9rem; font-size: 0.8rem; }

/* ----------------------------------------------------------------
   UPLOAD PROGRESS
---------------------------------------------------------------- */
.upload-progress {
  margin-top: 1.25rem;
}

.upload-progress__bar-wrap {
  background: rgba(255,255,255,0.07);
  border-radius: 999px;
  height: 6px;
  overflow: hidden;
}

.upload-progress__bar {
  height: 100%;
  background: linear-gradient(90deg, #00f3ff, #0088cc);
  border-radius: 999px;
  transition: width 0.4s ease;
}

.upload-progress__label {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0.5rem 0 0;
  text-align: center;
}

/* ----------------------------------------------------------------
   ERROR
---------------------------------------------------------------- */
.batch-error {
  margin-top: 1rem;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.25);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: #fca5a5;
  font-size: 0.85rem;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

/* ----------------------------------------------------------------
   RESULT PILLS
---------------------------------------------------------------- */
.result-pills {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

.result-pill {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
}

.result-pill--total { background: rgba(255,255,255,0.06); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.1); }
.result-pill--ok    { background: rgba(16,185,129,0.1);  color: #6ee7b7;  border: 1px solid rgba(16,185,129,0.25); }
.result-pill--warn  { background: rgba(245,158,11,0.1);  color: #fcd34d;  border: 1px solid rgba(245,158,11,0.25); }
.result-pill--error { background: rgba(239,68,68,0.1);   color: #fca5a5;  border: 1px solid rgba(239,68,68,0.25); }

.pill-value { font-size: 1.1rem; font-weight: 800; }
.pill-label { font-size: 0.75rem; font-weight: 400; opacity: 0.75; }

/* ----------------------------------------------------------------
   RESULT TABLE
---------------------------------------------------------------- */
.result-table {
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
  overflow: hidden;
}

.result-table__header {
  display: grid;
  grid-template-columns: 1fr 1.5fr 80px 160px;
  gap: 1rem;
  padding: 0.6rem 1rem;
  background: rgba(255,255,255,0.04);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #475569;
}

.result-table__row {
  display: grid;
  grid-template-columns: 1fr 1.5fr 80px 160px;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-size: 0.85rem;
  align-items: center;
  transition: background 0.15s;
}

.result-table__row:hover { background: rgba(255,255,255,0.025); }
.result-table__row--warn { background: rgba(245,158,11,0.04); }
.result-table__row--error { background: rgba(239,68,68,0.04); }

.result-table__name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #e2e8f0;
  font-weight: 600;
}

.result-table__name i { color: #475569; }

.result-table__file { color: #64748b; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-table__items { color: #94a3b8; text-align: center; }

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-badge--ok   { background: rgba(16,185,129,0.12); color: #6ee7b7; }
.status-badge--warn { background: rgba(245,158,11,0.12); color: #fcd34d; }
.status-badge--error { background: rgba(239,68,68,0.12); color: #fca5a5; font-size: 0.7rem; }

/* ----------------------------------------------------------------
   GENERATION STATUS
---------------------------------------------------------------- */
.gen-status {
  margin-top: 1.75rem;
  background: rgba(0,243,255,0.04);
  border: 1px solid rgba(0,243,255,0.15);
  border-radius: 12px;
  padding: 1.25rem;
}

.gen-status__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.gen-stat { text-align: center; }

.gen-stat__value {
  display: block;
  font-size: 1.8rem;
  font-weight: 800;
  color: #00f3ff;
  line-height: 1;
}

.gen-stat__label {
  display: block;
  font-size: 0.72rem;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0.3rem;
}

.gen-status__note {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0 0 0.75rem;
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
}

/* ----------------------------------------------------------------
   RESPONSIVE
---------------------------------------------------------------- */
@media (max-width: 640px) {
  .batch-options { grid-template-columns: 1fr; }
  .result-table__header,
  .result-table__row { grid-template-columns: 1fr 1fr; }
  .result-table__file,
  .result-table__items { display: none; }
  .gen-status__grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
