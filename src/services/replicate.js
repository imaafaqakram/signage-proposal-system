import axios from 'axios'

const REPLICATE_API_TOKEN = import.meta.env.VITE_REPLICATE_API_TOKEN
const MODEL_ID = import.meta.env.VITE_REPLICATE_MODEL_ID
const VERSION_ID = import.meta.env.VITE_REPLICATE_VERSION_ID

// Use local proxy in development (localhost:3001), Vercel function in production
const API_ENDPOINT = import.meta.env.DEV 
  ? 'http://localhost:3001/api/replicate' 
  : '/api/replicate'

/**
 * Regenerate image using Replicate API (via proxy)
 * @param {string} imageBase64 - Base64 encoded image (null for text-to-image)
 * @param {string} prompt - Text prompt for generation
 * @param {function} onProgress - Optional callback for progress updates
 * @param {object} modelConfig - Model configuration from store
 * @returns {Promise<string>} - URL of generated image
 */
export const regenerateImage = async (imageBase64, prompt = '', onProgress = null, modelConfig = null) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      throw new Error('Replicate API token not configured')
    }

    // Use provided model config or default to env variables
    const version = modelConfig?.version || VERSION_ID
    const parameters = modelConfig?.parameters || {
      num_inference_steps: 28,
      guidance_scale: 3,
      prompt_strength: 0.8
    }

    // Prepare input - ONLY include image if provided (not null!)
    const input = {
      prompt: prompt || 'professional commercial signage, high quality, detailed',
      ...parameters
    }

    // CRITICAL: Only add image parameter if we actually have an image
    if (imageBase64) {
      input.image = imageBase64
    }

    console.log('Using model:', modelConfig?.name || 'Custom')
    console.log('Mode:', imageBase64 ? 'Image-to-Image' : 'Text-to-Image')
    console.log('Parameters:', parameters)
    console.log('Input keys:', Object.keys(input))

    // Step 1: Create prediction via proxy
    const predictionResponse = await axios.post(API_ENDPOINT, {
      action: 'create-prediction',
      apiToken: REPLICATE_API_TOKEN,
      data: {
        version: version,
        input: input
      }
    })

    const predictionId = predictionResponse.data.id
    
    if (onProgress) {
      onProgress({ status: 'starting', message: 'Starting generation...', progress: 10 })
    }

    // Step 2: Poll for completion via proxy
    let prediction = predictionResponse.data
    const maxAttempts = 180 // 3 minutes max
    let attempts = 0

    while (
      prediction.status !== 'succeeded' && 
      prediction.status !== 'failed' && 
      prediction.status !== 'canceled' &&
      attempts < maxAttempts
    ) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const statusResponse = await axios.post(API_ENDPOINT, {
        action: 'get-prediction',
        apiToken: REPLICATE_API_TOKEN,
        data: { predictionId }
      })
      
      prediction = statusResponse.data
      attempts++

      if (onProgress) {
        const modelName = modelConfig?.name || 'Custom Model'
        onProgress({ 
          status: 'processing', 
          message: `Generating with ${modelName}... (${attempts}s)`,
          progress: Math.min(10 + (attempts / maxAttempts) * 85, 95)
        })
      }
    }

    // Step 3: Check result
    if (prediction.status === 'succeeded') {
      const outputUrl = Array.isArray(prediction.output) 
        ? prediction.output[0] 
        : prediction.output

      if (!outputUrl) {
        throw new Error('No output image URL received')
      }

      if (onProgress) {
        onProgress({ status: 'completed', message: 'Image generated successfully!', progress: 100 })
      }

      // Convert to data URL for immediate use
      const dataUrl = await fetchImageAsDataURL(outputUrl)
      return dataUrl

    } else if (prediction.status === 'failed') {
      const errorMsg = prediction.error || 'Image generation failed'
      console.error('Prediction failed:', prediction)
      throw new Error(errorMsg)
    } else if (attempts >= maxAttempts) {
      throw new Error('Image generation timed out after 3 minutes')
    } else {
      throw new Error('Image generation was canceled')
    }

  } catch (error) {
    console.error('Replicate API Error:', error)
    
    if (error.response) {
      const status = error.response.status
      const data = error.response.data
      const message = data?.detail || data?.error || error.message
      
      console.error('API Response:', status, data)
      
      if (status === 401) {
        throw new Error('Invalid Replicate API token. Please check your configuration.')
      } else if (status === 402) {
        throw new Error('Replicate API credit limit reached. Please add billing.')
      } else if (status === 422) {
        // Validation error - show the actual message
        throw new Error(`Replicate API error: ${message}`)
      } else if (status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.')
      } else {
        throw new Error(`Replicate API error: ${message}`)
      }
    } else {
      throw new Error(error.message || 'Unknown error occurred during image generation')
    }
  }
}

/**
 * Convert image URL to Data URL (base64)
 */
const fetchImageAsDataURL = async (url) => {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer'
    })
    
    const base64 = btoa(
      new Uint8Array(response.data)
        .reduce((data, byte) => data + String.fromCharCode(byte), '')
    )
    
    const contentType = response.headers['content-type'] || 'image/png'
    return `data:${contentType};base64,${base64}`
  } catch (error) {
    console.error('Error fetching image:', error)
    // Return the original URL as fallback
    return url
  }
}

/**
 * Convert File to base64 for API
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = error => reject(error)
  })
}

/**
 * Simple auto-regenerate (no prompt)
 */
export const autoRegenerateImage = async (imageBase64, onProgress) => {
  return regenerateImage(imageBase64, '', onProgress)
}

/**
 * Prompt-based regeneration
 */
export const regenerateWithPrompt = async (imageBase64, prompt, onProgress) => {
  return regenerateImage(imageBase64, prompt, onProgress)
}
