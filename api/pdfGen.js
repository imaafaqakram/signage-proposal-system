/**
 * Luminus Bulk Automation — Server-Side PDF Generation
 * Phase 4: Uses Puppeteer to render the Vue templates headlessly.
 *
 * POST /api/pdf-gen/process/:clientId
 */

import express from 'express'
import puppeteer from 'puppeteer'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = express.Router()

// Supabase admin client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// ----------------------------------------------------------------
// POST /api/pdf-gen/process/:clientId
// ----------------------------------------------------------------
router.post('/process/:clientId', async (req, res) => {
  const { clientId } = req.params
  let browser = null

  try {
    console.log(`\n📄 === PDF GEN: starting for client ${clientId} ===`)

    // Verify client exists
    const { data: client, error: clientErr } = await supabase
      .from('import_clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (clientErr || !client) {
      throw new Error(`Client not found: ${clientErr?.message}`)
    }

    // Update status
    await supabase.from('import_clients').update({ status: 'generating_pdf' }).eq('id', clientId)

    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const page = await browser.newPage()
    
    // Set viewport to roughly match a desktop
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 })
    
    const targetUrl = `${FRONTEND_URL}/pdf-render/${clientId}`
    console.log(`  🌐 Navigating to ${targetUrl}`)

    // Go to page and wait for it to be fully loaded
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // Wait for the custom Vue flag to signal rendering is fully done
    console.log('  ⏳ Waiting for PDF_READY flag...')
    await page.waitForFunction(() => window.PDF_READY === true, { timeout: 15000 })

    console.log('  🖨️  Taking PDF snapshot...')
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    })

    console.log('  ☁️  Uploading to Supabase Storage...')
    const sanitizedName = (client.client_name || 'Client').replace(/[^a-zA-Z0-9]/g, '_')
    const fileName = `${sanitizedName}_Proposal_${Date.now()}.pdf`
    const storagePath = `final_proposals/${clientId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('import-pdfs')
      .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true })

    if (uploadError) throw new Error(`Supabase storage upload failed: ${uploadError.message}`)

    const { data: urlData } = supabase.storage.from('import-pdfs').getPublicUrl(storagePath)
    const publicUrl = urlData.publicUrl

    // Update client row
    console.log('  ✅ PDF Generated and Uploaded')
    await supabase
      .from('import_clients')
      .update({
        status: 'ready_for_review', // Go back to review state or maybe 'approved' depending on workflow
        final_pdf_path: storagePath,
      })
      .eq('id', clientId)

    res.json({
      success: true,
      pdf_url: publicUrl,
      storage_path: storagePath
    })

  } catch (error) {
    console.error(`  ❌ PDF Gen Error: ${error.message}`)
    
    // Fallback status
    await supabase.from('import_clients').update({ status: 'needs_manual_check' }).eq('id', clientId)
    
    res.status(500).json({ error: error.message })
  } finally {
    if (browser) {
      await browser.close()
    }
  }
})

export default router
