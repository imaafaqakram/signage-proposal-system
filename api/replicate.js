// api/replicate.js — handles POST (create prediction) and GET ?id= (check status)
// Replaces api/replicate.js + api/replicate/[id].js — saves one serverless function slot
import fetch from 'node-fetch'

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = process.env.VITE_REPLICATE_API_TOKEN
  if (!apiKey) return res.status(400).json({ error: 'Replicate API token not configured' })

  try {
    // ── GET /api/replicate?id=<predictionId> — check status ────────────────
    if (req.method === 'GET') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Prediction ID missing' })
      const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { 'Authorization': `Token ${apiKey}` }
      })
      if (!r.ok) return res.status(r.status).json({ error: await r.text() })
      return res.status(200).json(await r.json())
    }

    // ── POST /api/replicate — create prediction ─────────────────────────────
    if (req.method === 'POST') {
      const { prompt, sourceImage, strength, steps } = req.body
      const input = {
        prompt,
        num_inference_steps: steps || 28,
        guidance_scale: 7.5
      }
      if (sourceImage) {
        input.image = sourceImage
        input.prompt_strength = (strength || 75) / 100
      }
      const r = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: process.env.VITE_REPLICATE_VERSION_ID, input })
      })
      if (!r.ok) {
        const errorText = await r.text()
        try { return res.status(r.status).json(JSON.parse(errorText)) }
        catch { return res.status(r.status).json({ error: errorText }) }
      }
      return res.status(200).json(await r.json())
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (error) {
    console.error('Replicate API Error:', error)
    return res.status(500).json({ error: 'Replicate request failed', details: error.message })
  }
}
