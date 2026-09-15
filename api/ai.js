// api/ai.js — unified AI endpoint (replaces gemini.js, gemini-prompt.js, huggingface.js, imagineart.js)
// Route by ?action=  or req.body.action
//   action=gemini-image   → gemini image stub
//   action=gemini-prompt  → Gemini prompt enhancer
//   action=huggingface    → HuggingFace inference
//   action=imagineart     → Imagine.art generation
import fetch from 'node-fetch'
import FormData from 'form-data'

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')
}

// ── Gemini image stub ───────────────────────────────────────────────────────
async function handleGeminiImage(req, res) {
  const { prompt } = req.body
  const svg = `
    <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#grad)"/>
      <text x="512" y="450" font-family="Arial" font-size="48" fill="white" text-anchor="middle" font-weight="bold">Gemini AI</text>
      <text x="512" y="520" font-family="Arial" font-size="32" fill="white" text-anchor="middle">${prompt ? prompt.substring(0, 40) : 'No prompt'}</text>
    </svg>`
  const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  return res.status(200).json({ imageUrl })
}

// ── Gemini prompt enhancer ─────────────────────────────────────────────────
async function handleGeminiPrompt(req, res) {
  const { prompt, context } = req.body
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) return res.status(200).json({ enhancedPrompt: prompt })
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are a prompt enhancer for AI image generation. Take this short prompt and enhance it with more visual details, materials, lighting, and professional qualities for ${context || 'signage'} design. Keep the enhancement concise (under 100 words). Return ONLY the enhanced prompt text, nothing else.\n\nOriginal prompt: "${prompt}"` }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
        })
      }
    )
    if (!r.ok) return res.status(200).json({ enhancedPrompt: prompt })
    const d = await r.json()
    const enhancedText = d.candidates?.[0]?.content?.parts?.[0]?.text || prompt
    return res.status(200).json({ enhancedPrompt: enhancedText.trim() })
  } catch {
    return res.status(200).json({ enhancedPrompt: prompt })
  }
}

// ── HuggingFace ─────────────────────────────────────────────────────────────
async function handleHuggingFace(req, res) {
  const { model, prompt } = req.body
  const apiKey = process.env.VITE_HUGGINGFACE_API_KEY
  if (!apiKey) return res.status(400).json({ error: 'Hugging Face API key not configured' })
  const modelMap = {
    'flux-dev': 'black-forest-labs/FLUX.1-dev',
    'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
    'stable-diffusion-xl': 'stabilityai/stable-diffusion-xl-base-1.0',
    'stable-diffusion-2.1': 'stabilityai/stable-diffusion-2-1',
    'dreamshaper': 'Lykon/DreamShaper'
  }
  const modelName = modelMap[model] || modelMap['stable-diffusion-xl']
  const r = await fetch(`https://api-inference.huggingface.co/models/${modelName}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: 30, guidance_scale: 7.5 } })
  })
  if (r.status === 503) {
    const txt = await r.text()
    const match = txt.match(/estimated_time":\s*(\d+\.?\d*)/)
    const waitTime = match ? parseFloat(match[1]) : 20
    return res.status(503).json({ error: 'Model is loading', retryAfter: waitTime, details: `Retry in ${Math.ceil(waitTime)}s` })
  }
  if (!r.ok) return res.status(r.status).json({ error: await r.text() })
  const buf = Buffer.from(await r.arrayBuffer())
  return res.status(200).json({ imageUrl: `data:image/png;base64,${buf.toString('base64')}` })
}

// ── Imagine.art ─────────────────────────────────────────────────────────────
async function handleImagineArt(req, res) {
  const { prompt, style, sourceImage, strength } = req.body
  const apiKey = process.env.VITE_IMAGINEART_API_KEY
  if (!apiKey) return res.status(400).json({ error: 'Imagine.art API key not configured' })
  const validStyles = ['realistic', 'anime', 'flux_schnell', 'flux_dev_fast', 'flux_dev', 'imagine_turbo']
  const finalStyle = validStyles.includes(style) ? style : 'realistic'
  const formData = new FormData()
  formData.append('prompt', prompt)
  formData.append('style', finalStyle)
  formData.append('aspect_ratio', '1:1')
  formData.append('variation', 'txt2img')
  formData.append('seed', Math.floor(Math.random() * 1000000).toString())
  if (sourceImage) {
    const imageBuffer = Buffer.from(sourceImage.split(',')[1], 'base64')
    formData.append('image', imageBuffer, { filename: 'source.png' })
    formData.append('strength', ((strength || 75) / 100).toString())
  }
  const r = await fetch('https://api.vyro.ai/v2/image/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
    body: formData
  })
  if (!r.ok) return res.status(r.status).json({ error: await r.text() })
  const contentType = r.headers.get('content-type') || ''
  if (contentType.includes('image/')) {
    const buf = Buffer.from(await r.arrayBuffer())
    return res.status(200).json({ imageUrl: `data:${contentType.split(';')[0]};base64,${buf.toString('base64')}` })
  }
  const data = await r.json()
  const imageUrl = data.data?.[0]?.url || data.url || data.output?.[0] || data.result || null
  if (imageUrl) return res.status(200).json({ imageUrl })
  return res.status(500).json({ error: 'No image URL in response', raw: data })
}

// ── Main Router ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const action = req.body?.action || req.query?.action

  try {
    switch (action) {
      case 'gemini-image':   return await handleGeminiImage(req, res)
      case 'gemini-prompt':  return await handleGeminiPrompt(req, res)
      case 'huggingface':    return await handleHuggingFace(req, res)
      case 'imagineart':     return await handleImagineArt(req, res)
      default:
        return res.status(400).json({ error: `Unknown action: "${action}". Use gemini-image, gemini-prompt, huggingface, or imagineart.` })
    }
  } catch (error) {
    console.error('AI handler error:', error)
    return res.status(500).json({ error: 'AI request failed', details: error.message })
  }
}
