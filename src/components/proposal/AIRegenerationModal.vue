<template>
  <div v-if="asset" class="ai-modal-overlay">
    <div class="ai-modal-backdrop" @click="$emit('close')"></div>
    
    <div class="ai-modal-content">
      <!-- Header -->
      <div class="ai-modal-header">
        <h3>
          <i class="fas fa-magic mr-2"></i>
          AI Image Regeneration
        </h3>
        <button @click="$emit('close')" class="close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Image Preview -->
      <div class="ai-modal-body">
        <div class="image-preview">
          <img v-if="asset.src" :src="asset.src" alt="Original" />
          <div v-else class="empty-preview">
            <i class="fas fa-image"></i>
            <p>No image uploaded</p>
          </div>
        </div>

        <!-- AI Model Selector -->
        <div class="model-selector">
          <label class="model-label">AI Model:</label>
          <div class="model-options">
            <button
              v-for="(model, key) in aiSettings.models"
              :key="key"
              @click="selectedModel = key"
              class="model-option-btn"
              :class="{ active: selectedModel === key }"
            >
              <i class="fas fa-robot"></i>
              <div class="model-info">
                <span class="model-name">{{ model.name }}</span>
                <span class="model-desc">{{ model.description }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Mode Selection -->
        <div class="mode-selector">
          <button
            v-for="mode in modes"
            :key="mode.id"
            @click="selectedMode = mode.id"
            class="mode-btn"
            :class="{ active: selectedMode === mode.id }"
          >
            <i :class="['fas', mode.icon]"></i>
            <span>{{ mode.label }}</span>
          </button>
        </div>

        <!-- Prompt Input (for prompt mode) -->
        <div v-if="selectedMode === 'prompt'" class="prompt-section">
          <label>Describe your changes:</label>
          <textarea
            v-model="customPrompt"
            placeholder="E.g., Make it blue with LED backlight, modern style..."
            rows="3"
          ></textarea>
          <div class="prompt-suggestions">
            <small>Quick suggestions:</small>
            <div class="suggestions-grid">
              <button
                v-for="suggestion in promptSuggestions"
                :key="suggestion"
                @click="customPrompt = suggestion"
                class="suggestion-btn"
              >
                {{ suggestion }}
              </button>
            </div>
          </div>
        </div>

        <!-- Progress Indicator -->
        <div v-if="isProcessing" class="progress-section">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
          </div>
          <p class="progress-text">{{ progressMessage }}</p>
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          {{ errorMessage }}
        </div>

        <!-- Result Preview (after generation) -->
        <div v-if="generatedImage" class="result-preview">
          <h4>Result:</h4>
          <img :src="generatedImage" alt="Generated" />
          <div class="result-actions">
            <button @click="acceptResult" class="accept-btn">
              <i class="fas fa-check"></i> Accept
            </button>
            <button @click="retryGeneration" class="retry-btn">
              <i class="fas fa-redo"></i> Try Again
            </button>
          </div>
        </div>

        <!-- Action Buttons -->
        <div v-if="!isProcessing && !generatedImage" class="action-buttons">
          <button @click="$emit('close')" class="cancel-btn">
            Cancel
          </button>
          <button
            @click="startGeneration"
            class="generate-btn"
            :disabled="!asset.src || (selectedMode === 'prompt' && !customPrompt.trim())"
          >
            <i class="fas fa-magic"></i>
            {{ selectedMode === 'auto' ? 'Auto Regenerate' : 'Generate with Prompt' }}
          </button>
        </div>

        <!-- History -->
        <div v-if="history.length > 0" class="history-section">
          <h4>Previous Attempts:</h4>
          <div class="history-grid">
            <div
              v-for="(item, idx) in history"
              :key="idx"
              class="history-item"
              @click="selectFromHistory(item)"
            >
              <img :src="item.url" alt="Attempt" />
              <span class="history-label">#{{ idx + 1 }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useProposalStore } from '@/stores/proposalStore'
import { regenerateImage, fileToBase64 } from '@/services/replicate'
import { showToast } from '@/utils/toast'

const props = defineProps({
  asset: {
    type: Object,
    required: true
  },
  pageIndex: {
    type: Number,
    required: true
  },
  assetIndex: {
    type: Number,
    required: true
  }
})

const emit = defineEmits(['close', 'regenerated'])

const proposalStore = useProposalStore()
const { aiSettings } = storeToRefs(proposalStore)

// Selected model (defaults to current model in store)
const selectedModel = ref(aiSettings.value.currentModel)

// Mode selection
const selectedMode = ref('auto')
const modes = [
  { id: 'auto', label: 'Auto', icon: 'fa-bolt' },
  { id: 'prompt', label: 'Custom Prompt', icon: 'fa-edit' }
]

// Prompt
const customPrompt = ref('')
const promptSuggestions = [
  'make it blue LED backlit, bright neon glow',
  'make it red neon, vibrant illumination',
  'make it green LED letters, modern design',
  'make it 3D metal with white backlight',
  'make it pink neon aesthetic, warm glow'
]

// Processing state
const isProcessing = ref(false)
const progress = ref(0)
const progressMessage = ref('')
const errorMessage = ref('')

// Results
const generatedImage = ref(null)
const history = ref([])

// Get current model config
const currentModelConfig = computed(() => {
  return aiSettings.value.models[selectedModel.value]
})

// Start generation
const startGeneration = async () => {
  if (!props.asset.src) {
    showToast('Please upload an image first', 'warning')
    return
  }

  isProcessing.value = true
  errorMessage.value = ''
  progress.value = 0

  try {
    // Convert image to base64 if needed
    let imageBase64 = props.asset.src
    if (!imageBase64.startsWith('data:')) {
      const response = await fetch(imageBase64)
      const blob = await response.blob()
      imageBase64 = await fileToBase64(blob)
    }

    // Get prompt based on mode - ALWAYS include trigger word!
    const triggerWord = 'signage' // Your model's activation word
    let finalPrompt = ''
    
    if (selectedMode.value === 'prompt' && customPrompt.value) {
      // User's custom prompt - add trigger word at start
      finalPrompt = `${triggerWord} ${customPrompt.value}`
    } else {
      // Auto mode - use trigger word with generic description
      finalPrompt = `${triggerWord} professional LED neon sign, high quality, commercial grade`
    }

    console.log('=== AI GENERATION DEBUG ===')
    console.log('Model:', currentModelConfig.value.name)
    console.log('Trigger Word:', triggerWord)
    console.log('Final Prompt:', finalPrompt)
    console.log('Parameters:', currentModelConfig.value.parameters)
    console.log('==========================')

    // Update store to use selected model
    proposalStore.setAIModel(selectedModel.value)

    // Progress callback
    const onProgress = (progressData) => {
      progress.value = progressData.progress || 0
      progressMessage.value = progressData.message || 'Processing...'
    }

    // Call Replicate API with selected model
    const result = await regenerateImage(
      imageBase64,
      finalPrompt,
      onProgress,
      currentModelConfig.value // Pass model config
    )

    // Success
    generatedImage.value = result
    history.value.push({ url: result, prompt: finalPrompt, model: selectedModel.value })

    showToast(`Generated with ${currentModelConfig.value.name}!`, 'success')

  } catch (error) {
    console.error('Generation error:', error)
    errorMessage.value = error.message || 'Failed to generate image'
    showToast(errorMessage.value, 'error')
  } finally {
    isProcessing.value = false
  }
}

// Accept result
const acceptResult = () => {
  emit('regenerated', {
    newImageUrl: generatedImage.value,
    pageIndex: props.pageIndex,
    assetIndex: props.assetIndex
  })
}

// Retry generation
const retryGeneration = () => {
  generatedImage.value = null
  errorMessage.value = ''
}

// Select from history
const selectFromHistory = (item) => {
  generatedImage.value = item.url
}
</script>

<style scoped>
.ai-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10002;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.ai-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
}

.ai-modal-content {
  position: relative;
  background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 25px 75px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  animation: modalSlideIn 0.3s ease;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(-30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ai-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.ai-modal-header h3 {
  color: white;
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
}

.close-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #9ca3af;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.ai-modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.image-preview {
  background: rgba(0, 0, 0, 0.3);
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.image-preview img {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 8px;
}

.empty-preview {
  text-align: center;
  color: #6b7280;
}

.empty-preview i {
  font-size: 48px;
  margin-bottom: 12px;
  display: block;
}

/* Model Selector */
.model-selector {
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}

.model-label {
  display: block;
  color: #22d3ee;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}

.model-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-option-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.model-option-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(34, 211, 238, 0.3);
}

.model-option-btn.active {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(14, 165, 233, 0.2));
  border-color: #22d3ee;
  color: white;
}

.model-option-btn.active i {
  color: #22d3ee;
}

.model-option-btn i {
  font-size: 24px;
  flex-shrink: 0;
}

.model-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-name {
  font-size: 14px;
  font-weight: 600;
  color: inherit;
}

.model-desc {
  font-size: 11px;
  opacity: 0.7;
}

/* Mode Selector */
.mode-selector {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.mode-btn {
  flex: 1;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #9ca3af;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn i {
  font-size: 24px;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(34, 211, 238, 0.3);
}

.mode-btn.active {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(14, 165, 233, 0.2));
  border-color: #22d3ee;
  color: #22d3ee;
}

.prompt-section {
  margin-bottom: 20px;
}

.prompt-section label {
  display: block;
  color: #e5e7eb;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.prompt-section textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  color: white;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
}

.prompt-section textarea:focus {
  outline: none;
  border-color: #22d3ee;
}

.prompt-suggestions {
  margin-top: 12px;
}

.prompt-suggestions small {
  color: #9ca3af;
  font-size: 12px;
  display: block;
  margin-bottom: 8px;
}

.suggestions-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggestion-btn {
  padding: 6px 12px;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 6px;
  color: #22d3ee;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.suggestion-btn:hover {
  background: rgba(34, 211, 238, 0.2);
}

.progress-section {
  margin-bottom: 20px;
}

.progress-bar {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  height: 20px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #22d3ee, #0ea5e9);
  transition: width 0.3s ease;
  border-radius: 10px;
}

.progress-text {
  color: #22d3ee;
  font-size: 14px;
  text-align: center;
}

.error-message {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 12px;
  color: #fca5a5;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.result-preview {
  margin-bottom: 20px;
}

.result-preview h4 {
  color: white;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}

.result-preview img {
  width: 100%;
  border-radius: 8px;
  margin-bottom: 16px;
}

.result-actions {
  display: flex;
  gap: 12px;
}

.accept-btn,
.retry-btn {
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.accept-btn {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  border: none;
}

.accept-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
}

.retry-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #9ca3af;
}

.retry-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.cancel-btn,
.generate-btn {
  flex: 1;
  padding: 14px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #9ca3af;
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.generate-btn {
  background: linear-gradient(135deg, #22d3ee, #0ea5e9);
  color: white;
  border: none;
}

.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(34, 211, 238, 0.4);
}

.generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.history-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.history-section h4 {
  color: white;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
}

.history-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.history-item:hover {
  border-color: #22d3ee;
  transform: scale(1.05);
}

.history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-label {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}

/* Scrollbar */
.ai-modal-body::-webkit-scrollbar {
  width: 6px;
}

.ai-modal-body::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}

.ai-modal-body::-webkit-scrollbar-thumb {
  background: rgba(34, 211, 238, 0.3);
  border-radius: 3px;
}

.ai-modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(34, 211, 238, 0.5);
}
</style>
