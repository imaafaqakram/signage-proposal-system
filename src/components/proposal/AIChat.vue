<!-- Image-to-Image source-image fix: Author Burhan. -->
<template>
  <div v-if="isOpen" class="ai-chat-overlay" @click.self="$emit('close')">
    <div class="ai-chat-panel">
      <!-- Header -->
      <div class="ai-header">
        <div class="ai-title">
          <i class="fas fa-robot"></i>
          <h2>AI Studio</h2>
          <span class="ai-badge">Pro</span>
        </div>
        <button @click="$emit('close')" class="close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Provider Selection -->
      <div class="provider-section">
        <label class="section-label">
          <i class="fas fa-server"></i> AI Provider
        </label>
        <div class="provider-grid">
          <div 
            v-for="provider in providers" 
            :key="provider.id"
            @click="selectedProvider = provider.id"
            class="provider-card"
            :class="{ active: selectedProvider === provider.id }"
          >
            <div class="provider-icon" :style="{ background: provider.color }">
              <i :class="provider.icon"></i>
            </div>
            <div class="provider-info">
              <div class="provider-name">{{ provider.name }}</div>
              <div class="provider-status">{{ provider.status }}</div>
            </div>
            <i v-if="selectedProvider === provider.id" class="fas fa-check-circle active-check"></i>
          </div>
        </div>
      </div>

      <!-- Model Selection -->
      <div class="model-section">
        <label class="section-label">
          <i class="fas fa-brain"></i> Model
        </label>
        <select v-model="selectedModel" class="model-select">
          <optgroup v-for="provider in providers" :key="provider.id" :label="provider.name">
            <option 
              v-for="model in provider.models" 
              :key="model.id"
              :value="model.id"
              :disabled="selectedProvider !== provider.id"
            >
              {{ model.name }} {{ model.premium ? '⭐' : '' }}
            </option>
          </optgroup>
        </select>
        <div v-if="currentModelInfo" class="model-info">
          <span class="info-badge">⚡ {{ currentModelInfo.speed }}</span>
          <span class="info-badge">💰 {{ currentModelInfo.cost }}</span>
          <span class="info-badge">⭐ {{ currentModelInfo.quality }}</span>
        </div>
      </div>

      <!-- Mode Toggle: Text-to-Image vs Image-to-Image -->
      <div class="mode-toggle-section">
        <label class="section-label">
          <i class="fas fa-exchange-alt"></i> Generation Mode
        </label>
        <div class="mode-buttons">
          <button 
            @click="generationMode = 'text-to-image'"
            :class="['mode-btn', { active: generationMode === 'text-to-image' }]"
          >
            <i class="fas fa-keyboard"></i>
            <span>Text → Image</span>
          </button>
          <button 
            @click="generationMode = 'image-to-image'"
            :class="['mode-btn', { active: generationMode === 'image-to-image' }]"
          >
            <i class="fas fa-images"></i>
            <span>Image → Image</span>
          </button>
        </div>
      </div>

      <!-- Source Image Upload (Image-to-Image mode) -->
      <div v-if="generationMode === 'image-to-image'" class="source-image-section">
        <label class="section-label">
          <i class="fas fa-upload"></i> Source Image
        </label>
        <div 
          class="source-upload-zone"
          :class="{ 'has-image': sourceImage }"
          @click="triggerSourceUpload"
          @dragover.prevent="isDragging = true"
          @dragleave="isDragging = false"
          @drop.prevent="handleSourceDrop"
        >
          <img v-if="sourceImage" :src="sourceImage" alt="Source" class="source-preview" />
          <div v-else class="upload-placeholder">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>Click or drag image here</span>
          </div>
          <button v-if="sourceImage" @click.stop="sourceImage = null" class="remove-source-btn">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <input 
          type="file" 
          ref="sourceFileInput" 
          @change="handleSourceUpload" 
          accept="image/*" 
          class="hidden-input"
        />
        
        <!-- Strength Slider -->
        <div class="strength-slider">
          <label>Transformation Strength: {{ sourceStrength }}%</label>
          <input 
            type="range" 
            v-model="sourceStrength" 
            min="10" 
            max="100" 
            step="5"
            class="slider-input"
          />
          <p class="strength-hint">Higher = more transformation from original</p>
        </div>
      </div>

      <!-- Prompt Enhancement -->
      <div class="enhancement-section">
        <div class="enhancement-toggle">
          <label class="toggle-label">
            <i class="fas fa-magic"></i> Auto-Enhance Prompt
          </label>
          <label class="switch">
            <input type="checkbox" v-model="autoEnhance">
            <span class="slider"></span>
          </label>
        </div>
        <p class="enhancement-hint" v-if="autoEnhance">
          Gemini will automatically improve your prompt for better results ✨
        </p>
      </div>

      <!-- Prompt Input -->
      <div class="prompt-section">
        <label class="section-label">
          <i class="fas fa-pen"></i> Your Prompt
        </label>
        <textarea
          v-model="userPrompt"
          @input="onPromptChange"
          placeholder="Describe the signage you want to create..."
          class="prompt-input"
          rows="4"
        ></textarea>
        
        <!-- Enhanced Prompt Display -->
        <div v-if="enhancedPrompt && enhancedPrompt !== userPrompt" class="enhanced-preview">
          <div class="enhanced-header">
            <i class="fas fa-sparkles"></i>
            <span>Enhanced Prompt:</span>
          </div>
          <div class="enhanced-text">{{ enhancedPrompt }}</div>
        </div>

        <!-- Quick Suggestions -->
        <div class="quick-suggestions">
          <button 
            v-for="suggestion in suggestions" 
            :key="suggestion"
            @click="userPrompt = suggestion"
            class="suggestion-chip"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <!-- Advanced Settings -->
      <details class="advanced-settings">
        <summary>
          <i class="fas fa-cog"></i> Advanced Settings
        </summary>
        <div class="settings-grid">
          <div class="setting-item">
            <label>Quality</label>
            <input type="range" v-model="settings.quality" min="1" max="10" class="slider-input">
            <span class="setting-value">{{ settings.quality }}</span>
          </div>
          <div class="setting-item">
            <label>Creativity</label>
            <input type="range" v-model="settings.creativity" min="1" max="10" class="slider-input">
            <span class="setting-value">{{ settings.creativity }}</span>
          </div>
          <div class="setting-item">
            <label>Steps</label>
            <input type="number" v-model="settings.steps" min="20" max="100" class="number-input">
          </div>
          <div class="setting-item">
            <label>Aspect Ratio</label>
            <select v-model="settings.aspectRatio" class="select-input">
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Classic (4:3)</option>
            </select>
          </div>
        </div>
      </details>

      <!-- Generate Button -->
      <button 
        @click="generate"
        :disabled="isGenerating || !userPrompt"
        class="generate-btn"
      >
        <i v-if="isGenerating" class="fas fa-spinner fa-spin"></i>
        <i v-else class="fas fa-magic"></i>
        {{ isGenerating ? generationStatus : 'Generate Image' }}
      </button>

      <!-- Progress Bar -->
      <div v-if="isGenerating" class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
        </div>
        <div class="progress-text">{{ Math.round(progress) }}%</div>
      </div>

      <!-- Generated Images History -->
      <div v-if="history.length > 0" class="history-section">
        <div class="history-header">
          <h3><i class="fas fa-history"></i> Generated Images</h3>
          <button @click="history = []" class="clear-btn">
            <i class="fas fa-trash"></i> Clear
          </button>
        </div>
        <div class="history-grid">
          <div 
            v-for="(item, index) in history" 
            :key="index"
            class="history-item"
            @click="selectHistoryItem(item)"
          >
            <img :src="item.imageUrl" :alt="item.prompt" />
            <div class="history-overlay">
              <div class="history-info">
                <span class="history-provider">{{ item.provider }}</span>
                <span class="history-model">{{ item.model }}</span>
              </div>
              <button @click.stop="insertImage(item.imageUrl)" class="insert-btn">
                <i class="fas fa-check"></i> Insert
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

// Props & Emits
defineProps({
  isOpen: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['close', 'image-generated'])

// State
const selectedProvider = ref('replicate')
const selectedModel = ref('flux-dev')
const userPrompt = ref('')
const enhancedPrompt = ref('')
const autoEnhance = ref(true)
const isGenerating = ref(false)
const progress = ref(0)
const generationStatus = ref('Generating...')
const history = ref([])

// Image-to-Image state
const generationMode = ref('text-to-image')
const sourceImage = ref(null)
const sourceStrength = ref(75)
const isDragging = ref(false)
const sourceFileInput = ref(null)

const settings = ref({
  quality: 8,
  creativity: 7,
  steps: 28,
  aspectRatio: '1:1'
})

let enhanceTimeout = null

// Providers Configuration
const providers = ref([
  {
    id: 'replicate',
    name: 'Replicate',
    icon: 'fas fa-bolt',
    color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    status: 'Custom LoRA',
    models: [
      { id: 'flux-dev', name: 'FLUX Dev', speed: 'Fast', cost: '$', quality: '⭐⭐⭐⭐' },
      { id: 'flux-schnell', name: 'FLUX Schnell', speed: 'Very Fast', cost: '$', quality: '⭐⭐⭐' },
      { id: 'flux-pro', name: 'FLUX Pro', speed: 'Medium', cost: '$$', quality: '⭐⭐⭐⭐⭐', premium: true },
      { id: 'sdxl', name: 'Stable Diffusion XL', speed: 'Fast', cost: '$', quality: '⭐⭐⭐⭐' },
      { id: 'sd-3', name: 'Stable Diffusion 3', speed: 'Medium', cost: '$', quality: '⭐⭐⭐⭐' },
      { id: 'custom-lora', name: 'Your Custom LoRA', speed: 'Fast', cost: '$', quality: '⭐⭐⭐⭐', premium: true }
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    icon: 'fab fa-google',
    color: 'linear-gradient(135deg, #4285f4 0%, #34a853 100%)',
    status: 'Free Tier',
    models: [
      { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', speed: 'Fast', cost: 'Free', quality: '⭐⭐⭐' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', speed: 'Very Fast', cost: 'Free', quality: '⭐⭐⭐' },
      { id: 'gemini-pro-vision', name: 'Gemini Pro Vision', speed: 'Medium', cost: 'Free', quality: '⭐⭐⭐⭐' }
    ]
  },
  {
    id: 'imagineart',
    name: 'Imagine.art',
    icon: 'fas fa-palette',
    color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    status: 'Credits',
    models: [
      { id: 'imagine-v5', name: 'Imagine V5', speed: 'Fast', cost: '5 credits', quality: '⭐⭐⭐⭐⭐' },
      { id: 'imagine-v4.1', name: 'Imagine V4.1', speed: 'Fast', cost: '4 credits', quality: '⭐⭐⭐⭐' },
      { id: 'sdxl-turbo', name: 'SDXL Turbo', speed: 'Very Fast', cost: '2 credits', quality: '⭐⭐⭐' },
      { id: 'realistic-vision', name: 'Realistic Vision', speed: 'Medium', cost: '5 credits', quality: '⭐⭐⭐⭐⭐' },
      { id: 'anime-v3', name: 'Anime V3', speed: 'Fast', cost: '3 credits', quality: '⭐⭐⭐⭐' },
      { id: 'creative-v6', name: 'Creative V6', speed: 'Medium', cost: '6 credits', quality: '⭐⭐⭐⭐⭐', premium: true }
    ]
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    icon: 'fas fa-cube',
    color: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)',
    status: 'Open Source',
    models: [
      { id: 'stable-diffusion-xl', name: 'Stable Diffusion XL', speed: 'Slow', cost: 'Free', quality: '⭐⭐⭐⭐' },
      { id: 'stable-diffusion-2.1', name: 'Stable Diffusion 2.1', speed: 'Medium', cost: 'Free', quality: '⭐⭐⭐' },
      { id: 'kandinsky-2.2', name: 'Kandinsky 2.2', speed: 'Slow', cost: 'Free', quality: '⭐⭐⭐' },
      { id: 'dreamshaper', name: 'DreamShaper', speed: 'Medium', cost: 'Free', quality: '⭐⭐⭐⭐' }
    ]
  }
])

// Quick Suggestions
const suggestions = ref([
  'modern LED signage with blue glow',
  'vintage neon sign red and white',
  'professional metal signage brushed steel',
  'illuminated storefront sign at night',
  'minimalist black and gold signage'
])

// Computed
const currentModelInfo = computed(() => {
  for (const provider of providers.value) {
    const model = provider.models.find(m => m.id === selectedModel.value)
    if (model) return model
  }
  return null
})

// Watchers
watch(selectedProvider, (newProvider) => {
  // Auto-select first model of selected provider
  const provider = providers.value.find(p => p.id === newProvider)
  if (provider && provider.models.length > 0) {
    selectedModel.value = provider.models[0].id
  }
})

// Methods
const onPromptChange = () => {
  if (autoEnhance.value) {
    // Debounce enhancement
    clearTimeout(enhanceTimeout)
    enhanceTimeout = setTimeout(() => {
      enhancePromptWithGemini()
    }, 1000)
  } else {
    enhancedPrompt.value = userPrompt.value
  }
}

const enhancePromptWithGemini = async () => {
  if (!userPrompt.value || userPrompt.value.length < 3) {
    enhancedPrompt.value = userPrompt.value
    return
  }

  try {
    const response = await fetch('/api/gemini-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: userPrompt.value,
        context: 'signage design'
      })
    })

    const data = await response.json()
    if (data.enhancedPrompt) {
      enhancedPrompt.value = data.enhancedPrompt
    }
  } catch (error) {
    console.error('Prompt enhancement failed:', error)
    enhancedPrompt.value = userPrompt.value
  }
}

const generate = async () => {
  const finalPrompt = autoEnhance.value && enhancedPrompt.value 
    ? enhancedPrompt.value 
    : userPrompt.value

  if (!finalPrompt) {
    alert('Please enter a prompt')
    return
  }

  isGenerating.value = true
  progress.value = 0
  generationStatus.value = 'Initializing...'

  try {
    let imageUrl

    // Route to appropriate provider
    switch (selectedProvider.value) {
      case 'replicate':
        imageUrl = await generateWithReplicate(finalPrompt)
        break
      case 'gemini':
        imageUrl = await generateWithGemini(finalPrompt)
        break
      case 'imagineart':
        imageUrl = await generateWithImagineArt(finalPrompt)
        break
      case 'huggingface':
        imageUrl = await generateWithHuggingFace(finalPrompt)
        break
    }

    // Add to history
    history.value.unshift({
      imageUrl,
      prompt: finalPrompt,
      originalPrompt: userPrompt.value,
      provider: providers.value.find(p => p.id === selectedProvider.value)?.name,
      model: currentModelInfo.value?.name,
      timestamp: new Date().toISOString()
    })

    // Keep only last 10
    if (history.value.length > 10) {
      history.value = history.value.slice(0, 10)
    }

    // Emit event
    emit('image-generated', imageUrl)

    generationStatus.value = 'Complete!'
    progress.value = 100

  } catch (error) {
    console.error('Generation failed:', error)
    alert(`Generation failed: ${error.message}`)
    generationStatus.value = 'Failed'
  } finally {
    setTimeout(() => {
      isGenerating.value = false
      progress.value = 0
    }, 1000)
  }
}

// Provider-specific generation methods
const generateWithReplicate = async (prompt) => {
  generationStatus.value = 'Connecting to Replicate...'
  progress.value = 10

  const requestBody = {
    model: selectedModel.value,
    prompt: `signage ${prompt}`,
    settings: {
      num_inference_steps: settings.value.steps,
      guidance_scale: settings.value.creativity,
      lora_scale: settings.value.quality / 10
    }
  }

  // Add source image for Image-to-Image mode
  if (generationMode.value === 'image-to-image' && sourceImage.value) {
    requestBody.sourceImage = sourceImage.value
    requestBody.strength = sourceStrength.value / 100
  }

  const response = await fetch('/api/replicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  // Check if response is ok
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Server error (${response.status}): ${errorText || 'Unknown error'}`)
  }

  // Parse response with error handling
  let data
  try {
    const responseText = await response.text()
    if (!responseText) {
      throw new Error('Empty response from server')
    }
    data = JSON.parse(responseText)
  } catch (parseError) {
    throw new Error(`Failed to parse response: ${parseError.message}`)
  }

  // Check for API error
  if (data.error) {
    throw new Error(data.error)
  }
  
  // Poll for completion
  let predictionId = data.id
  let prediction = data

  while (prediction.status === 'processing' || prediction.status === 'starting') {
    await new Promise(resolve => setTimeout(resolve, 1000))
    progress.value = Math.min(90, progress.value + 5)
    generationStatus.value = `Generating... ${Math.round(progress.value)}%`

    const statusResponse = await fetch(`/api/replicate/${predictionId}`)
    if (!statusResponse.ok) {
      throw new Error(`Status check failed: ${statusResponse.status}`)
    }
    const statusText = await statusResponse.text()
    if (!statusText) {
      throw new Error('Empty status response')
    }
    prediction = JSON.parse(statusText)
  }

  if (prediction.status === 'succeeded') {
    progress.value = 100
    return prediction.output[0]
  } else {
    throw new Error(prediction.error || 'Generation failed')
  }
}

const generateWithGemini = async (prompt) => {
  generationStatus.value = 'Generating with Gemini...'
  progress.value = 30

  const requestBody = {
    model: selectedModel.value,
    prompt: `professional signage: ${prompt}`,
    aspectRatio: settings.value.aspectRatio
  }

  // Add source image for Image-to-Image mode
  if (generationMode.value === 'image-to-image' && sourceImage.value) {
    requestBody.sourceImage = sourceImage.value
  }

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  progress.value = 70

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Server error (${response.status}): ${errorText || 'Unknown error'}`)
  }

  const data = await response.json()

  if (data.imageUrl) {
    progress.value = 100
    return data.imageUrl
  } else {
    throw new Error(data.error || 'No image returned from Gemini')
  }
}

const generateWithImagineArt = async (prompt) => {
  generationStatus.value = 'Creating with Imagine.art...'
  progress.value = 20

  const requestBody = {
    model: selectedModel.value,
    prompt: `professional signage: ${prompt}`,
    style: 'realistic',
    cfg_scale: settings.value.creativity,
    steps: settings.value.steps
  }

  // Add source image for Image-to-Image mode
  if (generationMode.value === 'image-to-image' && sourceImage.value) {
    requestBody.sourceImage = sourceImage.value
    requestBody.strength = sourceStrength.value
  }

  const response = await fetch('/api/imagineart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  // Check if response is ok
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Server error (${response.status}): ${errorText || 'Unknown error'}`)
  }

  // Parse response with error handling
  let data
  try {
    const responseText = await response.text()
    if (!responseText) {
      throw new Error('Empty response from Imagine.art')
    }
    data = JSON.parse(responseText)
  } catch (parseError) {
    throw new Error(`Failed to parse response: ${parseError.message}`)
  }

  // Check for immediate error
  if (data.error) {
    throw new Error(data.error)
  }
  
  // Poll for completion if needed
  if (data.status === 'processing') {
    let imageId = data.id
    let result = data

    while (result.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 2000))
      progress.value = Math.min(90, progress.value + 10)
      generationStatus.value = `Processing... ${Math.round(progress.value)}%`

      const statusResponse = await fetch(`/api/imagineart/${imageId}`)
      if (!statusResponse.ok) {
        throw new Error(`Status check failed: ${statusResponse.status}`)
      }
      const statusText = await statusResponse.text()
      if (!statusText) {
        throw new Error('Empty status response')
      }
      result = JSON.parse(statusText)
    }

    if (result.status === 'completed') {
      progress.value = 100
      return result.imageUrl
    } else {
      throw new Error('Generation failed')
    }
  } else if (data.imageUrl) {
    progress.value = 100
    return data.imageUrl
  } else {
    throw new Error('No image returned')
  }
}

const generateWithHuggingFace = async (prompt) => {
  generationStatus.value = 'Generating with Hugging Face...'
  progress.value = 25

  const requestBody = {
    model: selectedModel.value,
    prompt: `high quality signage design: ${prompt}`,
    num_inference_steps: settings.value.steps
  }

  // Add source image for Image-to-Image mode
  if (generationMode.value === 'image-to-image' && sourceImage.value) {
    requestBody.sourceImage = sourceImage.value
    requestBody.strength = sourceStrength.value / 100
  }

  const response = await fetch('/api/huggingface', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  progress.value = 80
  
  // Hugging Face returns image as blob
  const blob = await response.blob()
  const imageUrl = URL.createObjectURL(blob)
  
  progress.value = 100
  return imageUrl
}

const insertImage = (imageUrl) => {
  emit('image-generated', imageUrl)
  emit('close')
}

const selectHistoryItem = (item) => {
  userPrompt.value = item.originalPrompt
  enhancedPrompt.value = item.prompt
}

// Image-to-Image handlers
const triggerSourceUpload = () => {
  sourceFileInput.value?.click()
}

const handleSourceUpload = async (event) => {
  const file = event.target.files?.[0]
  if (file) {
    sourceImage.value = await fileToBase64(file)
  }
}

const handleSourceDrop = async (event) => {
  isDragging.value = false
  const file = event.dataTransfer.files?.[0]
  if (file && file.type.startsWith('image/')) {
    sourceImage.value = await fileToBase64(file)
  }
}

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
</script>

<style scoped>
/* Overlay */
.ai-chat-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  animation: fadeIn 0.2s ease;
}

/* Panel */
.ai-chat-panel {
  width: 500px;
  max-width: 90vw;
  height: 100vh;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  box-shadow: -10px 0 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.3s ease;
  overflow-y: auto;
}

/* Header */
.ai-header {
  padding: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
}

.ai-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-title i {
  font-size: 24px;
  color: #22d3ee;
}

.ai-title h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: white;
}

.ai-badge {
  background: linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%);
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
}

.close-btn {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 20px;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* Sections */
.provider-section,
.model-section,
.enhancement-section,
.prompt-section {
  padding: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
}

/* Provider Grid */
.provider-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.provider-card {
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid transparent;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.provider-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(34, 211, 238, 0.3);
}

.provider-card.active {
  background: rgba(34, 211, 238, 0.1);
  border-color: #22d3ee;
}

.provider-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  font-size: 20px;
  color: white;
}

.provider-info {
  text-align: left;
}

.provider-name {
  color: white;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 4px;
}

.provider-status {
  color: #94a3b8;
  font-size: 11px;
}

.active-check {
  position: absolute;
  top: 12px;
  right: 12px;
  color: #22d3ee;
  font-size: 18px;
}

/* Model Select */
.model-select {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.model-select:focus {
  outline: none;
  border-color: #22d3ee;
  background: rgba(255, 255, 255, 0.08);
}

.model-select option {
  background: #1e293b;
  color: white;
}

.model-info {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.info-badge {
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 11px;
  color: #94a3b8;
  font-weight: 600;
}

/* Enhancement Toggle */
.enhancement-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.toggle-label i {
  color: #22d3ee;
}

.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: rgba(255, 255, 255, 0.2);
  transition: 0.3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background: #22d3ee;
}

input:checked + .slider:before {
  transform: translateX(24px);
}

.enhancement-hint {
  color: #22d3ee;
  font-size: 12px;
  margin: 0;
  font-style: italic;
}

/* Prompt Input */
.prompt-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  color: white;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: all 0.2s;
}

.prompt-input:focus {
  outline: none;
  border-color: #22d3ee;
  background: rgba(255, 255, 255, 0.08);
}

.prompt-input::placeholder {
  color: #64748b;
}

/* Enhanced Preview */
.enhanced-preview {
  margin-top: 12px;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 8px;
  padding: 12px;
}

.enhanced-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #22d3ee;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}

.enhanced-text {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.5;
}

/* Quick Suggestions */
.quick-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.suggestion-chip {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 6px 12px;
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.suggestion-chip:hover {
  background: rgba(34, 211, 238, 0.1);
  border-color: #22d3ee;
  color: #22d3ee;
}

/* Advanced Settings */
.advanced-settings {
  padding: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.advanced-settings summary {
  cursor: pointer;
  color: white;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  list-style: none;
}

.advanced-settings summary::-webkit-details-marker {
  display: none;
}

.advanced-settings summary i {
  color: #22d3ee;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-item label {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 600;
}

.slider-input,
.number-input,
.select-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 8px;
  color: white;
  font-size: 13px;
}

.slider-input {
  -webkit-appearance: none;
  height: 6px;
  border-radius: 3px;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: #22d3ee;
  border-radius: 50%;
  cursor: pointer;
}

.setting-value {
  color: #22d3ee;
  font-weight: 700;
  font-size: 14px;
  text-align: center;
}

/* Generate Button */
.generate-btn {
  margin: 24px;
  width: calc(100% - 48px);
  background: linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%);
  color: white;
  border: none;
  border-radius: 12px;
  padding: 16px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.2s;
}

.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(34, 211, 238, 0.4);
}

.generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Progress */
.progress-container {
  padding: 0 24px 24px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #22d3ee 0%, #0ea5e9 100%);
  transition: width 0.3s ease;
  border-radius: 4px;
}

.progress-text {
  text-align: center;
  color: #22d3ee;
  font-size: 12px;
  font-weight: 700;
}

/* History */
.history-section {
  padding: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.history-header h3 {
  color: white;
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.clear-btn {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

.history-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
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
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 50%);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.history-item:hover .history-overlay {
  opacity: 1;
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.history-provider,
.history-model {
  color: white;
  font-size: 11px;
  font-weight: 600;
}

.history-model {
  opacity: 0.7;
}

.insert-btn {
  background: #22d3ee;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  transition: all 0.2s;
}

.insert-btn:hover {
  background: #0ea5e9;
}

/* Animations */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

/* Scrollbar */
.ai-chat-panel::-webkit-scrollbar {
  width: 8px;
}

.ai-chat-panel::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

.ai-chat-panel::-webkit-scrollbar-thumb {
  background: rgba(34, 211, 238, 0.5);
  border-radius: 4px;
}

.ai-chat-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(34, 211, 238, 0.7);
}

/* Mode Toggle */
.mode-toggle-section {
  padding: 16px 24px;
}

.mode-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.mode-btn {
  flex: 1;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #94a3b8;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.mode-btn.active {
  background: linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%);
  border-color: #22d3ee;
  color: white;
}

/* Source Image Upload */
.source-image-section {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.source-upload-zone {
  position: relative;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.source-upload-zone:hover {
  border-color: #22d3ee;
  background: rgba(34, 211, 238, 0.05);
}

.source-upload-zone.has-image {
  padding: 8px;
  border-style: solid;
  border-color: #22d3ee;
}

.upload-placeholder {
  color: #64748b;
}

.upload-placeholder i {
  font-size: 32px;
  margin-bottom: 8px;
  display: block;
}

.source-preview {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 8px;
}

.remove-source-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.9);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hidden-input {
  display: none;
}

.strength-slider {
  margin-top: 16px;
}

.strength-slider label {
  color: #94a3b8;
  font-size: 13px;
  font-weight: 600;
}

.strength-slider .slider-input {
  width: 100%;
  margin-top: 8px;
}

.strength-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #64748b;
}
</style>
