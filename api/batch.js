/**
 * Luminus Bulk Automation — Batch Upload API Endpoint
 * Phase 2: Accepts up to 50 PDFs, runs Python extractor,
 *          writes rows to Supabase (import_batches / import_clients / import_items)
 *
 * POST /api/batch/upload
 *   - multipart/form-data
 *   - fields: files[] (PDF files), discount_percent (optional, default 0)
 *
 * POST /api/batch/status/:batchId
 *   - returns batch + client + item status summary
 */

import express from 'express'
import multer from 'multer'
import { spawn } from 'child_process'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = express.Router()

// ----------------------------------------------------------------
// Supabase admin client (uses service role key — server-side only)
// ----------------------------------------------------------------
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // NOT the anon key
)

// ----------------------------------------------------------------
// Multer — store uploads in a temp dir before processing
// ----------------------------------------------------------------
const upload = multer({
  dest: path.join(__dirname, '../tmp/uploads/'),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB per file
    files: 50,                   // Max 50 PDFs per batch
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error(`Only PDF files are accepted. Got: ${file.mimetype}`))
    }
  }
})


// ----------------------------------------------------------------
// HELPER: Run Python extractor and return parsed JSON
// ----------------------------------------------------------------
const runExtractor = (pdfPath, skipLastPage = false) => {
  return new Promise((resolve, reject) => {
    const pyScript = path.join(__dirname, '../extraction/extractor.py')
    const args = [pyScript, pdfPath]
    if (skipLastPage === 'true' || skipLastPage === true) {
      args.push('--skip-last-page')
    }
    const proc = spawn('python', args, { env: process.env })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => {
      const line = d.toString()
      stderr += line
      // Stream OCR / extractor diagnostics to the server terminal so users can see them
      process.stderr.write(line)
    })

    proc.on('close', (code) => {
      if (code === 0 || code === 2) {
        // code 2 = soft error (client needs_manual_check) — still valid JSON
        try {
          resolve({ code, data: JSON.parse(stdout) })
        } catch {
          reject(new Error(`Extractor returned invalid JSON: ${stdout}`))
        }
      } else {
        reject(new Error(`Extractor failed (exit ${code}): ${stderr || stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python extractor: ${err.message}. Is Python installed?`))
    })
  })
}


// ----------------------------------------------------------------
// HELPER: Upload a file buffer to Supabase Storage
// ----------------------------------------------------------------
const uploadToStorage = async (bucket, storagePath, localFilePath, mimeType = 'application/pdf') => {
  const buffer = await fs.readFile(localFilePath)
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`Supabase storage upload failed: ${error.message}`)
  return storagePath
}


// ----------------------------------------------------------------
// HELPER: Insert item rows, retrying and stripping unknown columns
// ----------------------------------------------------------------
const stripUnknownColumns = (rows, columnName) => {
  return rows.map(r => {
    const clone = { ...r }
    delete clone[columnName]
    return clone
  })
}

const insertItemRows = async (rows) => {
  let currentRows = rows
  let attempt = 0

  while (attempt < 5) {
    attempt++
    const { error } = await supabase.from('import_items').insert(currentRows)

    if (!error) return

    const pgMissingMatch = error.message && error.message.match(/column "([^"]+)" of relation "import_items" does not exist/)
    const sbMissingMatch = error.message && error.message.match(/Could not find the '([^']+)' column/)
    const missingColumnMatch = pgMissingMatch || sbMissingMatch
    if (missingColumnMatch) {
      const columnName = missingColumnMatch[1]
      console.warn(`⚠️ Column ${columnName} not found; retrying without it. Run the latest Supabase migration.`)
      currentRows = stripUnknownColumns(currentRows, columnName)
      continue
    }

    throw new Error(`Items insert failed: ${error.message}`)
  }

  throw new Error('Items insert failed after stripping unknown columns. Please run the latest Supabase migration.')
}


// ----------------------------------------------------------------
// POST /api/batch/upload
// ----------------------------------------------------------------
router.post('/upload', upload.array('files'), async (req, res) => {
  const files = req.files
  const discountPercent = parseFloat(req.body.discount_percent) || 0
  const uploadedBy = req.body.user_id || null  // optionally passed from frontend
  const skipLastPage = req.body.skip_last_page || false

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No PDF files were uploaded.' })
  }

  console.log(`\n📦 === BATCH UPLOAD: ${files.length} PDF(s), ${discountPercent}% discount ===`)

  // 1. Create the batch record
  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      uploaded_by: uploadedBy,
      discount_percent: discountPercent,
      total_clients: files.length,
      status: 'extracted',
    })
    .select()
    .single()

  if (batchError) {
    console.error('❌ Failed to create batch:', batchError.message)
    const msg = batchError.message.toLowerCase()
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(500).json({
        error: 'Supabase tables are not set up. Please run the SQL migration in supabase/migrations/001_bulk_automation_phase1.sql (and 002_add_pricing_json.sql if you already ran the first one).',
        details: batchError.message
      })
    }
    if (msg.includes('bucket') && msg.includes('not found')) {
      return res.status(500).json({
        error: 'Supabase Storage buckets are missing. Please run the storage bucket creation lines in supabase/migrations/001_bulk_automation_phase1.sql.',
        details: batchError.message
      })
    }
    return res.status(500).json({ error: `Failed to create batch: ${batchError.message}` })
  }

  console.log(`✅ Batch created: ${batch.id}`)

  const results = []

  // 2. Process each PDF concurrently (capped at 5 at a time)
  const CONCURRENCY = 5
  const chunks = []
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    chunks.push(files.slice(i, i + CONCURRENCY))
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (file) => {
      const originalName = file.originalname
      const localPath = file.path

      console.log(`  🔍 Extracting: ${originalName}`)

      try {
        // Run extraction
        const { code, data: extracted } = await runExtractor(localPath, skipLastPage)

        if (extracted.error) {
          throw new Error(extracted.error)
        }

        const clientData = extracted.client
        const items = extracted.items || []

        // Upload raw PDF to Supabase Storage
        const storagePdfPath = `${batch.id}/${file.filename}_${originalName}`
        await uploadToStorage('import-pdfs', storagePdfPath, localPath)

        // 3. Insert client record
        const { data: client, error: clientError } = await supabase
          .from('import_clients')
          .insert({
            batch_id: batch.id,
            client_name: clientData.client_name,
            client_email: clientData.client_email,
            status: clientData.needs_manual_check ? 'needs_manual_check' : 'queued_for_processing',
            source_pdf_path: storagePdfPath,
            validation_flags: clientData.validation_flags || {},
          })
          .select()
          .single()

        if (clientError) throw new Error(`Client insert failed: ${clientError.message}`)

        // 4. Apply batch discount to prices
        const applyDiscount = (price) => {
          if (price == null) return null
          return parseFloat((price * (1 - discountPercent / 100)).toFixed(2))
        }

        // 5. Insert item records
        const itemRows = []
        for (const item of items) {
          // Upload all extracted images and collect their storage paths
          const imagePaths = []
          if (item.extracted_images && item.extracted_images.length > 0) {
            for (let imgIdx = 0; imgIdx < item.extracted_images.length; imgIdx++) {
              const localImgPath = item.extracted_images[imgIdx]
              const ext = path.extname(localImgPath) || '.png'
              const storageImagePath = `${batch.id}/${client.id}_page${item.page_number}_img${imgIdx}${ext}`
              try {
                await uploadToStorage('import-images', storageImagePath, localImgPath, 'image/png')
                imagePaths.push(storageImagePath)
              } catch (imgErr) {
                console.warn(`  ⚠️ Failed to upload extracted image ${imgIdx}: ${imgErr.message}`)
              }
              // Clean up local extracted image
              await fs.unlink(localImgPath).catch(() => {})
            }
          }

          // Base effective price: prefer the PDF's discounted price, fall back to original
          const effectiveBasePrice = item.discounted_price != null ? item.discounted_price : item.original_price

          itemRows.push({
            client_id: client.id,
            page_number: item.page_number,
            sign_type: item.sign_type,
            size: item.size,
            original_price: item.original_price,
            discounted_price: item.discounted_price,
            adjusted_price: applyDiscount(effectiveBasePrice),
            pricing_json: item.pricing || null,
            color: item.color,
            finish: item.finish,
            illuminated: item.illuminated,
            usage: item.usage,
            ul_cert: item.ul_cert,
            permit: item.permit,
            install: item.install,
            discount_code: item.discount_code,
            original_image_path: imagePaths[0] || null,
            original_image_paths: imagePaths.length ? imagePaths : null,
            status: item.needs_manual_check ? 'needs_manual_check' : 'queued_for_processing',
            validation_flags: item.validation_flags || {},
          })
        }

        if (itemRows.length > 0) {
          await insertItemRows(itemRows)
        }

        console.log(`  ✅ ${originalName} → client ${client.id} (${items.length} items)`)
        results.push({
          file: originalName,
          client_id: client.id,
          client_name: clientData.client_name,
          items: items.length,
          needs_manual_check: clientData.needs_manual_check || items.some(i => i.needs_manual_check),
          status: 'ok',
        })

      } catch (err) {
        console.error(`  ❌ ${originalName}: ${err.message}`)
        results.push({ file: originalName, status: 'error', error: err.message })
      } finally {
        // Always clean up the temp file
        await fs.unlink(localPath).catch(() => {})
      }
    }))
  }

  const successCount = results.filter(r => r.status === 'ok').length
  const failCount = results.filter(r => r.status === 'error').length
  const manualCount = results.filter(r => r.needs_manual_check).length

  console.log(`\n📊 Batch ${batch.id} complete: ${successCount} ok, ${failCount} failed, ${manualCount} need review`)

  res.status(200).json({
    batch_id: batch.id,
    total: files.length,
    success: successCount,
    failed: failCount,
    needs_manual_check: manualCount,
    results,
  })
})


// ----------------------------------------------------------------
// GET /api/batch/status/:batchId
// ----------------------------------------------------------------
router.get('/status/:batchId', async (req, res) => {
  const { batchId } = req.params

  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .single()

  if (batchErr) return res.status(404).json({ error: 'Batch not found' })

  const { data: clients } = await supabase
    .from('import_clients')
    .select('id, client_name, client_email, status, validation_flags')
    .eq('batch_id', batchId)
    .order('created_at')

  res.json({ batch, clients: clients || [] })
})


// ----------------------------------------------------------------
// GET /api/batch/client/:clientId
// ----------------------------------------------------------------
router.get('/client/:clientId', async (req, res) => {
  const { clientId } = req.params

  const { data: client, error } = await supabase
    .from('import_clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (error) return res.status(404).json({ error: 'Client not found' })

  const { data: items } = await supabase
    .from('import_items')
    .select('*')
    .eq('client_id', clientId)
    .order('page_number')

  res.json({ client, items: items || [] })
})


// ----------------------------------------------------------------
// POST /api/batch/:batchId/send-approved
// ----------------------------------------------------------------
router.post('/:batchId/send-approved', async (req, res) => {
  const { batchId } = req.params
  const { clientIds } = req.body

  if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
    return res.status(400).json({ error: 'No clients selected for sending.' })
  }

  console.log(`\n🚀 === SENDING APPROVED PROPOSALS FOR BATCH ${batchId} ===`)
  console.log(`Sending ${clientIds.length} clients...`)

  // Run asynchronously in the background to avoid blocking the HTTP response
  // as this could take minutes for many clients.
  res.json({ success: true, message: `Started sending ${clientIds.length} approved proposals in the background.` })

  // Background processing
  const delay = ms => new Promise(res => setTimeout(res, ms))

  // Helper for exponential backoff retries
  const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
        return response
      } catch (err) {
        if (i === maxRetries - 1) throw err
        const backoff = Math.pow(2, i) * 1000 // 1s, 2s, 4s
        console.warn(`    ⚠️ Request failed. Retrying in ${backoff}ms... (${err.message})`)
        await delay(backoff)
      }
    }
  }

  for (const clientId of clientIds) {
    try {
      console.log(`\n--- Processing Client: ${clientId} ---`)
      
      // 1. Fetch Client Details
      const { data: client } = await supabase.from('import_clients').select('*').eq('id', clientId).single()
      if (!client) throw new Error('Client not found')

      // IDEMPOTENCY CHECK
      if (client.status === 'sent' || client.status === 'sending') {
        console.log(`  ⏭️  Skipping: Client already sent or sending (Status: ${client.status})`)
        continue
      }

      // Mark as sending to prevent race conditions if clicked again
      await supabase.from('import_clients').update({ status: 'sending' }).eq('id', clientId)

      // Fetch items for Google Sheets integration
      const { data: items } = await supabase.from('import_items').select('*').eq('client_id', clientId)
      
      // 2. Generate PDF via internal call
      console.log(`  [1/4] Generating PDF...`)
      const port = process.env.PORT || 3001
      const pdfRes = await fetchWithRetry(`http://localhost:${port}/api/pdf-gen/process/${clientId}`, {
        method: 'POST'
      })
      const pdfData = await pdfRes.json()

      // 3. Fetch PDF buffer and encode to Base64 (needed by N8N email webhook)
      console.log(`  [2/4] Fetching PDF buffer for email...`)
      const pdfBufferRes = await fetchWithRetry(pdfData.pdf_url)
      const arrayBuffer = await pdfBufferRes.arrayBuffer()
      const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

      // 4. Send Email via internal call
      console.log(`  [3/4] Triggering N8N Email Webhook...`)
      try {
        await fetchWithRetry(`http://localhost:${port}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: client.client_name,
            clientEmail: client.client_email,
            pdfBase64,
            companyId: 'luminus'
          })
        })
      } catch (emailErr) {
        console.warn(`  ⚠️ Email sending failed after retries: ${emailErr.message}`)
        throw new Error(`Email Delivery Failed: ${emailErr.message}`)
      }

      // 5. Send to Sheets via internal call
      console.log(`  [4/4] Triggering N8N Sheets Webhook...`)
      if (items && items.length > 0) {
        for (const item of items) {
          try {
            await fetchWithRetry(`http://localhost:${port}/api/send-to-sheets`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: client.client_name,
                price: item.adjusted_price,
                size: item.size,
                signType: item.sign_type,
                timestamp: new Date().toISOString()
              })
            })
          } catch (sheetsErr) {
             console.warn(`  ⚠️ Sheets update failed after retries for item ${item.id}`)
          }
        }
      }

      // 6. Update Status
      console.log(`  ✅ Successfully sent proposal to ${client.client_email}`)
      await supabase.from('import_clients').update({ status: 'sent' }).eq('id', clientId)

      // 7. Rate Limiting Delay (Phase 6 requirement)
      // Pause for 2 seconds to prevent overwhelming N8N/Email provider
      await delay(2000)

    } catch (err) {
      console.error(`  ❌ Failed to process client ${clientId}: ${err.message}`)
      await supabase.from('import_clients').update({ status: 'failed' }).eq('id', clientId)
    }
  }

  console.log(`\n🎉 === BATCH SEND COMPLETE ===\n`)
})

export default router

