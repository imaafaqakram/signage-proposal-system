/**
 * Luminus Bulk Automation — Image Generation Service
 * Phase 3: Nano Banana Pro (primary) → GPT Image 2 (fallback)
 *
 * Endpoints:
 *   POST /api/image-gen/process-batch/:batchId
 *     — kicks off async image generation for all queued items in a batch
 *
 *   POST /api/image-gen/regenerate/:itemId
 *     — manually regenerate one item with GPT Image 2 (reviewer UI button)
 *
 *   GET  /api/image-gen/status/:batchId
 *     — returns per-item generation status for a batch
 */

import express from 'express'
import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'
import dotenv from 'dotenv'

dotenv.config()

const router = express.Router()

// ----------------------------------------------------------------
// Supabase admin client
// ----------------------------------------------------------------
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ----------------------------------------------------------------
// Config — read from env
// ----------------------------------------------------------------
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN
const MODEL_PRIMARY   = process.env.REPLICATE_MODEL_PRIMARY   || 'black-forest-labs/flux-schnell'
const MODEL_KONTEXT   = process.env.REPLICATE_MODEL_KONTEXT   || 'black-forest-labs/flux-kontext-pro'
const MODEL_FALLBACK  = process.env.REPLICATE_MODEL_FALLBACK  || 'openai/gpt-image-2'
const CONCURRENCY_CAP = parseInt(process.env.IMAGE_GEN_CONCURRENCY || '5', 10)

const IMAGE_PROMPT_TEMPLATE = process.env.REPLICATE_IMAGE_PROMPT_TEMPLATE ||
  `Professional photorealistic storefront mockup of a {{signType}} sign{{size}}. ` +
  `Preserve the exact text, font, lettering, and layout of the original sign. ` +
  `Only update the surrounding scene, lighting, and materials to create a polished, commercial presentation. ` +
  `High quality, sharp details, clean composition, no extra text, no distorted letters.`

// Replicate polling interval (ms) and max wait time per prediction
const POLL_INTERVAL_MS = 2000
const MAX_WAIT_MS      = 120_000  // 2 minutes per image

// ----------------------------------------------------------------
// CORE: Call Replicate and poll until done
// ----------------------------------------------------------------
const callReplicate = async (model, input) => {
  if (!REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN is not set in .env')

  // 1. Create prediction
  let createUrl = 'https://api.replicate.com/v1/predictions'
  let bodyPayload = { version: model, input }
  
  // If the model looks like "owner/name" instead of a 64-char hash version, use the official model endpoint
  if (model.includes('/') && model.length < 60) {
    createUrl = `https://api.replicate.com/v1/models/${model}/predictions`
    bodyPayload = { input }
  }

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait=5'
    },
    body: JSON.stringify(bodyPayload),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Replicate create failed (${createRes.status}): ${err}`)
  }

  const prediction = await createRes.json()
  const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`

  // 2. Poll until succeeded / failed / timeout
  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    })
    const status = await pollRes.json()

    if (status.status === 'succeeded') {
      const outputUrl = Array.isArray(status.output) ? status.output[0] : status.output
      return { outputUrl, predictionId: prediction.id }
    }

    if (status.status === 'failed' || status.status === 'canceled') {
      throw new Error(`Replicate prediction ${status.status}: ${status.error || 'no details'}`)
    }
  }

  throw new Error(`Replicate timed out after ${MAX_WAIT_MS / 1000}s`)
}


const buildPrompt = (item) => {
  const signType = item.sign_type || 'sign'
  const isIlluminated = item.illuminated === 'Yes' || item.illuminated?.toLowerCase().includes('yes')
  const isIndoor = item.usage?.toLowerCase().includes('indoor')

  let envDesc = isIndoor 
    ? "modern indoor commercial building lobby, sleek interior architecture"
    : "commercial building storefront facade"

  let lightingDesc = isIlluminated 
    ? "dramatic sunset transitioning to evening, with the sign glowing brightly, moody atmospheric lighting"
    : "bright sunny daytime, clear outdoor lighting"

  return `High-quality commercial presentation of a ${signType}. ` +
         `DO NOT change the text, letters, font, logo, or proportions of the original sign. ` +
         `Replace ONLY the background with a ${envDesc}, ${lightingDesc}. ` +
         `Photorealistic, sharp focus, perfect blending, no distorted letters.`
}


// ----------------------------------------------------------------
// CORE: Upload generated image to Supabase Storage
// ----------------------------------------------------------------
const storeGeneratedImage = async (imageUrl, itemId, modelUsed) => {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Failed to fetch generated image from Replicate: ${response.status}`)

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const storagePath = `generated/${itemId}_${modelUsed.replace(/\//g, '-')}_${Date.now()}.webp`

  const { error } = await supabase.storage
    .from('import-images')
    .upload(storagePath, buffer, { contentType: 'image/webp', upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data: urlData } = supabase.storage.from('import-images').getPublicUrl(storagePath)
  return { storagePath, publicUrl: urlData.publicUrl }
}


// ----------------------------------------------------------------
// HELPER: Convert a Supabase storage path to a public URL
// ----------------------------------------------------------------
const getPublicImageUrl = (storagePath) => {
  if (!storagePath) return null
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath
  const { data } = supabase.storage.from('import-images').getPublicUrl(storagePath)
  return data?.publicUrl || null
}


// ----------------------------------------------------------------
// CORE: Generate image for one item (primary → fallback logic)
// ----------------------------------------------------------------
const generateForItem = async (item) => {
  const prompt = buildPrompt(item)

  // Resolve reference image URL if available
  const referenceImageUrl = getPublicImageUrl(item.original_image_path)

  // Build Replicate input — use reference image if we have one
  const makeInput = (hasImage) => {
    // For text-to-image (flux-schnell)
    const base = { prompt, num_inference_steps: 4, guidance_scale: 0 }
    
    if (hasImage && referenceImageUrl) {
      // For image-to-image (flux-kontext-pro)
      return {
        prompt,
        image: referenceImageUrl,
        steps: 28, // Default for pro models
        guidance: 3.5,
        output_format: "webp"
      }
    }
    return base
  }

  // === PRIMARY: Nano Banana Pro / FLUX ===
  const hasImage = !!referenceImageUrl
  const primaryModelToUse = hasImage ? MODEL_KONTEXT : MODEL_PRIMARY
  console.log(`    🎨 [${item.id.slice(0, 8)}] Primary model: ${primaryModelToUse}`)
  let generationModel = primaryModelToUse
  let fallbackReason = null

  try {
    const { outputUrl } = await callReplicate(primaryModelToUse, makeInput(hasImage))
    const { storagePath, publicUrl } = await storeGeneratedImage(outputUrl, item.id, primaryModelToUse)

    return {
      success: true,
      regenerated_image_path: storagePath,
      regenerated_image_url: publicUrl,
      generation_model: primaryModelToUse,
      fallback_reason: null,
    }

  } catch (primaryErr) {
    // === FALLBACK: GPT Image 2 — ONE retry only ===
    console.warn(`    ⚠️  [${item.id.slice(0, 8)}] Primary failed: ${primaryErr.message}`)
    console.log(`    🔄 [${item.id.slice(0, 8)}] Fallback model: ${MODEL_FALLBACK}`)

    fallbackReason = primaryErr.message.includes('timeout') ? 'timeout'
      : primaryErr.message.includes('rate') ? 'rate_limited'
      : 'api_error'

    generationModel = MODEL_FALLBACK

    try {
      const { outputUrl } = await callReplicate(MODEL_FALLBACK, makeInput(false))
      const { storagePath, publicUrl } = await storeGeneratedImage(outputUrl, item.id, MODEL_FALLBACK)

      return {
        success: true,
        regenerated_image_path: storagePath,
        regenerated_image_url: publicUrl,
        generation_model: MODEL_FALLBACK,
        fallback_reason: fallbackReason,
      }

    } catch (fallbackErr) {
      console.error(`    ❌ [${item.id.slice(0, 8)}] Fallback also failed: ${fallbackErr.message}`)
      return {
        success: false,
        generation_model: generationModel,
        fallback_reason: fallbackReason,
        error: fallbackErr.message,
      }
    }
  }
}


// ----------------------------------------------------------------
// HELPER: Update item row in Supabase
// ----------------------------------------------------------------
const updateItem = async (itemId, fields) => {
  const { error } = await supabase
    .from('import_items')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', itemId)

  if (error) console.error(`Failed to update item ${itemId}: ${error.message}`)
}


// ----------------------------------------------------------------
// POST /api/image-gen/process-batch/:batchId
// Kicks off async generation for all queued_for_processing items
// ----------------------------------------------------------------
router.post('/process-batch/:batchId', async (req, res) => {
  const { batchId } = req.params
  console.log(`\n🖼️  === IMAGE GEN: batch ${batchId} ===`)

  // Fetch all queued items across all clients in this batch
  const { data: items, error } = await supabase
    .from('import_items')
    .select(`
      id, sign_type, size, original_image_path,
      import_clients!inner(batch_id)
    `)
    .eq('import_clients.batch_id', batchId)
    .in('status', ['queued_for_processing'])

  if (error) return res.status(500).json({ error: error.message })
  if (!items || items.length === 0) {
    return res.json({ message: 'No items queued for processing', processed: 0 })
  }

  console.log(`  📋 ${items.length} items to process (concurrency cap: ${CONCURRENCY_CAP})`)

  // Respond immediately — processing runs in background
  res.json({
    message: 'Image generation started',
    total_items: items.length,
    batch_id: batchId,
  })

  // === Process in concurrency-capped chunks ===
  let processed = 0, succeeded = 0, failed = 0

  const chunks = []
  for (let i = 0; i < items.length; i += CONCURRENCY_CAP) {
    chunks.push(items.slice(i, i + CONCURRENCY_CAP))
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (item) => {
      // Mark as processing
      await updateItem(item.id, { status: 'processing_images' })

      const result = await generateForItem(item)
      processed++

      if (result.success) {
        succeeded++
        await updateItem(item.id, {
          status: 'ready_for_review',
          regenerated_image_path: result.regenerated_image_path,
          generation_model: result.generation_model,
          fallback_reason: result.fallback_reason,
        })
        console.log(`  ✅ [${item.id.slice(0, 8)}] → ready_for_review (${result.generation_model})`)
      } else {
        failed++
        await updateItem(item.id, {
          status: 'needs_manual_check',
          generation_model: result.generation_model,
          fallback_reason: result.fallback_reason,
          validation_flags: { generation_error: result.error },
        })
        console.error(`  ❌ [${item.id.slice(0, 8)}] → needs_manual_check`)
      }
    }))
  }

  // Update batch status
  const allFailed = succeeded === 0
  const partialFail = failed > 0 && succeeded > 0
  const batchStatus = allFailed ? 'needs_manual_check'
    : partialFail ? 'ready_for_review'
    : 'ready_for_review'

  await supabase.from('import_batches').update({ status: batchStatus }).eq('id', batchId)
  console.log(`\n📊 Batch ${batchId} image gen complete: ${succeeded} ok, ${failed} failed`)
})


// ----------------------------------------------------------------
// POST /api/image-gen/regenerate/:itemId
// Manual regenerate with fallback model (reviewer UI)
// ----------------------------------------------------------------
router.post('/regenerate/:itemId', async (req, res) => {
  const { itemId } = req.params
  
  const { data: item, error } = await supabase
    .from('import_items')
    .select('*')
    .eq('id', itemId)
    .single()

  if (error || !item) return res.status(404).json({ error: 'Item not found' })

  const referenceImageUrl = getPublicImageUrl(item.original_image_path)
  const hasImage = !!referenceImageUrl
  
  // Try to use the best model. For image-to-image, use KONTEXT. Else, use FALLBACK.
  const modelToUse = hasImage ? MODEL_KONTEXT : MODEL_FALLBACK
  
  console.log(`\n🔄 Manual regenerate: item ${itemId} with ${modelToUse}`)

  await updateItem(itemId, { status: 'processing_images' })

  try {
    const prompt = buildPrompt(item)
    
    // Build input based on model required format
    let input = {
      prompt,
      num_inference_steps: 4,
      guidance_scale: 0
    }
    
    if (hasImage && modelToUse === MODEL_KONTEXT) {
      input = {
        prompt,
        image: referenceImageUrl,
        steps: 28,
        guidance: 3.5,
        output_format: "webp"
      }
    }

    const { outputUrl } = await callReplicate(modelToUse, input)
    const { storagePath, publicUrl } = await storeGeneratedImage(outputUrl, itemId, modelToUse)

    await updateItem(itemId, {
      status: 'ready_for_review',
      regenerated_image_path: storagePath,
      generation_model: modelToUse,
      fallback_reason: 'manual_override',
    })

    res.json({
      success: true,
      image_url: publicUrl,
      model: modelToUse,
    })

  } catch (err) {
    await updateItem(itemId, { status: 'needs_manual_check' })
    res.status(500).json({ error: err.message })
  }
})


// ----------------------------------------------------------------
// GET /api/image-gen/status/:batchId
// Returns generation progress for Review UI polling
// ----------------------------------------------------------------
router.get('/status/:batchId', async (req, res) => {
  const { batchId } = req.params

  const { data: items, error } = await supabase
    .from('import_items')
    .select(`
      id, status, generation_model, fallback_reason, regenerated_image_path,
      import_clients!inner(batch_id, client_name)
    `)
    .eq('import_clients.batch_id', batchId)

  if (error) return res.status(500).json({ error: error.message })

  const summary = {
    total: items.length,
    processing: items.filter(i => i.status === 'processing_images').length,
    ready: items.filter(i => i.status === 'ready_for_review').length,
    needs_review: items.filter(i => i.status === 'needs_manual_check').length,
    primary_model_used: items.filter(i => i.generation_model === MODEL_PRIMARY).length,
    fallback_model_used: items.filter(i => i.generation_model === MODEL_FALLBACK).length,
  }

  res.json({ batch_id: batchId, summary, items })
})


export default router
