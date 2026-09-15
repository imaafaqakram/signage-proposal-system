<template>
  <div class="ai-panel no-print" :class="{ 'open': isOpen }">
    <!-- Toggle Button -->
    <button 
      @click="isOpen = !isOpen" 
      class="ai-toggle-btn"
      :class="{ 'open': isOpen }"
    >
      <i class="fas fa-magic"></i>
      <span>AI Studio</span>
    </button>

    <!-- Panel Content -->
    <transition name="slide-left">
      <div v-if="isOpen" class="ai-panel-content">
        <!-- Header -->
        <div class="ai-panel-header">
          <h3>
            <i class="fas fa-wand-magic-sparkles mr-2"></i>
            AI Sign Generator
          </h3>
          <button @click="isOpen = false" class="close-btn">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Mode Selector -->
        <div class="mode-selector">
          <button 
            @click="mode = 'text-to-image'" 
            class="mode-btn"
            :class="{ active: mode === 'text-to-image' }"
          >
            <i class="fas fa-text"></i>
            <span>Text to Image</span>
            <small>Generate from description</small>
          </button>
          <button 
            @click="mode = 'image-to-image'" 
            class="mode-btn"
            :class="{ active: mode === 'image-to-image' }"
          >
            <i class="fas fa-image"></i>
            <span>Transform Image</span>
            <small>Modify existing image</small>
          </button>
        </div>

        <!-- Text-to-Image Mode -->
        <div v-if="mode === 'text-to-image'" class="generation-section">
          <label class="label">Describe your sign:</label>
          <textarea 
            v-model="prompt"
            class="prompt-input"
            rows="4"
            placeholder="Example: Blue LED neon sign with text 'Love You', bright glow, modern style"
          ></textarea>

          <!-- Quick Prompts -->
          <div class="quick-prompts">
            <small class="label">Quick ideas:</small>
            <div class="prompt-chips">
              <button 
                v-for="(suggestion, idx) in textToImageSuggestions" 
                :key="idx"
                @click="prompt = suggestion"
                class="chip"
              >
                {{ suggestion }}
              </button>
            </div>
          </div>

          <button 
            @click="generateFromText" 
            class="generate-btn"
            :disabled="isGenerating || !prompt"
          >
            <i class="fas fa-sparkles"></i>
            {{ isGenerating ? 'Generating...' : 'Generate Sign' }}
          </button>
        </div>

        <!-- Image-to-Image Mode -->
        <div v-else class="generation-section">
          <!-- Upload Zone -->
          <div 
            class="upload-zone"
            :class="{ 'has-image': referenceImage, 'dragging': isDragging }"
            @drop.prevent="handleDrop"
            @dragover.prevent="isDragging = true"
            @dragleave="isDragging = false"
            @click="triggerFileInput"
          >
            <input 
              ref="fileInput" 
              type="file" 
              accept="image/*" 
              @change="handleFileSelect"
              style="display: none"
            />
            
            <div v-if="!referenceImage" class="upload-prompt">
              <i class="fas fa-cloud-upload-alt"></i>
              <p>Drop image or click to upload</p>
              <small>Reference image for transformation</small>
            </div>

            <div v-else class="image-preview">
              <img :src="referenceImage" alt="Reference" />
              <button @click.stop="referenceImage = null" class="remove-btn">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>

          <!-- Transformation Prompt -->
          <label class="label">What changes do you want?</label>
          <textarea 
            v-model="prompt"
            class="prompt-input"
            rows="3"
            placeholder="Example: Make it blue LED with bright glow"
          ></textarea>

          <!-- Quick Transformations -->
          <div class="quick-prompts">
            <small class="label">Quick transformations:</small>
            <div class="prompt-chips">
              <button 
                v-for="(suggestion, idx) in transformSuggestions" 
                :key="idx"
                @click="prompt = suggestion"
                class="chip"
              >
                {{ suggestion }}
              </button>
            </div>
          </div>

          <button 
            @click="generateFromImage" 
            class="generate-btn"
            :disabled="isGenerating || !referenceImage || !prompt"
          >
            <i class="fas fa-magic"></i>
            {{ isGenerating ? 'Transforming...' : 'Transform Image' }}
          </button>
        </div>

        <!-- Progress -->
        <div v-if="isGenerating" class="progress-section">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
          </div>
          <p class="progress-text">{{ progressMessage }}</p>
        </div>

        <!-- Result -->
        <div v-if="generatedImage" class="result-section">
          <label class="label">Generated Result:</label>
          <div class="result-image">
            <img :src="generatedImage" alt="Generated" />
          </div>

          <!-- Action Buttons -->
          <div class="result-actions">
            <button @click="insertIntoProposal" class="action-btn primary">
              <i class="fas fa-plus-circle"></i>
              Add to Proposal
            </button>
            <button @click="downloadImage" class="action-btn">
              <i class="fas fa-download"></i>
              Download
            </button>
            <button @click="regenerate" class="action-btn">
              <i class="fas fa-redo"></i>
              Try Again
            </button>
          </div>
        </div>

        <!-- History -->
        <div v-if="history.length > 0" class="history-section">
          <label class="label">Recent Generations:</label>
          <div class="history-grid">
            <div 
              v-for="(item, idx) in history" 
              :key="idx"
              class="history-item"
              @click="generatedImage = item.image"
            >
              <img :src="item.image" :alt="`Generation ${idx + 1}`" />
              <div class="history-overlay">
                <button @click.stop="insertImage(item.image)" class="mini-btn">
                  <i class="fas fa-plus"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { regenerateImage } from '@/services/replicate'
import { showToast } from '@/utils/toast'

const emit = defineEmits(['insert-image'])

const isOpen = ref(false)
const mode = ref('text-to-image') // 'text-to-image' or 'image-to-image'
const prompt = ref('')
const referenceImage = ref(null)
const generatedImage = ref(null)
const isGenerating = ref(false)
const progress = ref(0)
const progressMessage = ref('')
const isDragging = ref(false)
const fileInput = ref(null)
const history = ref([])

// Suggestions
const textToImageSuggestions = [
  'Blue LED neon sign "Open", bright glow',
  'Red neon sign "Love", vintage style',
  'Green LED letters "Fresh", modern',
  '3D metal sign "Premium", backlit',
  'Pink neon "Welcome", warm aesthetic'
]

const transformSuggestions = [
  'Make it blue LED with bright glow',
  'Turn it into red neon sign',
  'Make it 3D metal with backlight',
  'Change to green modern style',
  'Make it pink neon aesthetic'
]

// File handling
const triggerFileInput = () => {
  fileInput.value?.click()
}

const handleFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    referenceImage.value = URL.createObjectURL(file)
  }
}

const handleDrop = (event) => {
  isDragging.value = false
  const file = event.dataTransfer.files[0]
  if (file && file.type.startsWith('image/')) {
    referenceImage.value = URL.createObjectURL(file)
  }
}

// Generation
const generateFromText = async () => {
  isGenerating.value = true
  progress.value = 0
  
  try {
    // Text-to-image generation
    const fullPrompt = `signage ${prompt.value}`
    
    const onProgress = (data) => {
      progress.value = data.progress || 0
      progressMessage.value = data.message || 'Generating...'
    }

    // For text-to-image, no reference image
    const result = await regenerateImage(null, fullPrompt, onProgress)
    
    generatedImage.value = result
    history.value.unshift({ image: result, prompt: prompt.value })
    if (history.value.length > 6) history.value.pop()
    
    showToast('Sign generated successfully!', 'success')
    
  } catch (error) {
    console.error('Generation error:', error)
    showToast(error.message || 'Generation failed', 'error')
  } finally {
    isGenerating.value = false
  }
}

const generateFromImage = async () => {
  if (!referenceImage.value) {
    showToast('Please upload a reference image', 'warning')
    return
  }

  isGenerating.value = true
  progress.value = 0
  
  try {
    // Convert image to base64
    const response = await fetch(referenceImage.value)
    const blob = await response.blob()
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })

    const fullPrompt = `signage ${prompt.value}`
    
    const onProgress = (data) => {
      progress.value = data.progress || 0
      progressMessage.value = data.message || 'Transforming...'
    }

    const result = await regenerateImage(base64, fullPrompt, onProgress)
    
    generatedImage.value = result
    history.value.unshift({ image: result, prompt: prompt.value })
    if (history.value.length > 6) history.value.pop()
    
    showToast('Image transformed successfully!', 'success')
    
  } catch (error) {
    console.error('Generation error:', error)
    showToast(error.message || 'Transformation failed', 'error')
  } finally {
    isGenerating.value = false
  }
}

const regenerate = () => {
  if (mode.value === 'text-to-image') {
    generateFromText()
  } else {
    generateFromImage()
  }
}

const insertIntoProposal = () => {
  if (generatedImage.value) {
    emit('insert-image', generatedImage.value)
    showToast('Image added to proposal!', 'success')
  }
}

const insertImage = (imageUrl) => {
  emit('insert-image', imageUrl)
  showToast('Image added to proposal!', 'success')
}

const downloadImage = () => {
  const link = document.createElement('a')
  link.href = generatedImage.value
  link.download = `ai-generated-sign-${Date.now()}.png`
  link.click()
}
</script>

<style scoped>
.ai-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 9999;
  pointer-events: none;
}

.ai-toggle-btn {
  position: fixed;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
  border: none;
  border-radius: 12px 0 0 12px;
  padding: 20px 15px;
  writing-mode: vertical-rl;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  box-shadow: -4px 0 12px rgba(139, 92, 246, 0.3);
  transition: all 0.3s ease;
  pointer-events: all;
  z-index: 10000;
}

.ai-toggle-btn:hover {
  transform: translateY(-50%) translateX(-5px);
  box-shadow: -6px 0 20px rgba(139, 92, 246, 0.5);
}

.ai-toggle-btn.open {
  right: 450px;
}

.ai-panel-content {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 450px;
  background: #1a1a1a;
  border-left: 1px solid #333;
  overflow-y: auto;
  pointer-events: all;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
}

.ai-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #333;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
}

.ai-panel-header h3 {
  color: white;
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.close-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.mode-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 20px;
}

.mode-btn {
  background: #2a2a2a;
  border: 2px solid #333;
  border-radius: 12px;
  padding: 15px 10px;
  color: #999;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.mode-btn i {
  font-size: 24px;
  margin-bottom: 5px;
}

.mode-btn span {
  font-weight: 600;
  font-size: 13px;
}

.mode-btn small {
  font-size: 10px;
  opacity: 0.7;
}

.mode-btn.active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.2));
  border-color: #8b5cf6;
  color: #a78bfa;
}

.generation-section {
  padding: 20px;
}

.label {
  display: block;
  color: #a78bfa;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.prompt-input {
  width: 100%;
  background: #2a2a2a;
  border: 2px solid #333;
  border-radius: 8px;
  padding: 12px;
  color: white;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
}

.prompt-input:focus {
  outline: none;
  border-color: #8b5cf6;
}

.quick-prompts {
  margin-top: 15px;
  margin-bottom: 20px;
}

.prompt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.chip {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 20px;
  padding: 6px 12px;
  color: #999;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.chip:hover {
  background: #333;
  border-color: #8b5cf6;
  color: #a78bfa;
}

.upload-zone {
  background: #2a2a2a;
  border: 2px dashed #444;
  border-radius: 12px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
  margin-bottom: 20px;
}

.upload-zone.dragging {
  border-color: #8b5cf6;
  background: rgba(139, 92, 246, 0.1);
}

.upload-zone.has-image {
  padding: 0;
  border-style: solid;
}

.upload-prompt i {
  font-size: 48px;
  color: #666;
  margin-bottom: 10px;
}

.upload-prompt p {
  color: #999;
  font-weight: 600;
  margin-bottom: 5px;
}

.upload-prompt small {
  color: #666;
  font-size: 11px;
}

.image-preview {
  position: relative;
}

.image-preview img {
  width: 100%;
  height: auto;
  border-radius: 12px;
  display: block;
}

.remove-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(239, 68, 68, 0.9);
  border: none;
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.remove-btn:hover {
  background: rgb(220, 38, 38);
  transform: scale(1.1);
}

.generate-btn {
  width: 100%;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  border: none;
  color: white;
  padding: 15px;
  border-radius: 12px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);
}

.generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-section {
  padding: 20px;
  border-top: 1px solid #333;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #2a2a2a;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #6366f1);
  transition: width 0.3s ease;
}

.progress-text {
  color: #999;
  font-size: 12px;
  text-align: center;
}

.result-section {
  padding: 20px;
  border-top: 1px solid #333;
}

.result-image {
  background: #2a2a2a;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 15px;
}

.result-image img {
  width: 100%;
  height: auto;
  display: block;
}

.result-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

.action-btn {
  background: #2a2a2a;
  border: 1px solid #444;
  color: #999;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.action-btn:hover {
  background: #333;
  color: white;
}

.action-btn.primary {
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  border-color: #8b5cf6;
  color: white;
}

.action-btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
}

.history-section {
  padding: 20px;
  border-top: 1px solid #333;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 10px;
}

.history-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
}

.history-item:hover {
  transform: scale(1.05);
}

.history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.history-item:hover .history-overlay {
  opacity: 1;
}

.mini-btn {
  background: #8b5cf6;
  border: none;
  color: white;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}

.mini-btn:hover {
  transform: scale(1.1);
  background: #7c3aed;
}

/* Animations */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.3s ease;
}

.slide-left-enter-from {
  transform: translateX(100%);
}

.slide-left-leave-to {
  transform: translateX(100%);
}

/* Scrollbar */
.ai-panel-content::-webkit-scrollbar {
  width: 8px;
}

.ai-panel-content::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.ai-panel-content::-webkit-scrollbar-thumb {
  background: #8b5cf6;
  border-radius: 4px;
}
</style>
