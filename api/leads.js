// api/leads.js — Vercel serverless mirror of server.js's /api/leads routes.
// Same Supabase-backed persistence (db.js) so a lead saved locally (via the CRM
// import script, which needs a real filesystem + Python and so only runs from the
// local dev server) is immediately visible/editable here on the deployed app too —
// this file never spawns that script itself, it only reads/writes the shared DB.
// Author: Burhan.
import { saveLeadVersion, listLeads, listVersions, getVersion, deleteLead } from '../db.js'

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'POST') {
      const { data, label, source } = req.body || {}
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Missing proposal data' })
      }
      const result = await saveLeadVersion({
        crmRecordId: data._source?.crmRecordId || null,
        clientName: data.clientName,
        contactEmail: data.contactEmail,
        data,
        label,
        source: source || 'manual-edit'
      })
      return res.status(200).json(result)
    }

    if (req.method === 'GET') {
      const { id, action, version } = req.query
      if (!id) return res.status(200).json({ leads: await listLeads() })
      if (action === 'versions') return res.status(200).json({ versions: await listVersions(Number(id)) })
      if (action === 'version') {
        const result = await getVersion(Number(id), version)
        if (!result) return res.status(404).json({ error: 'Version not found' })
        return res.status(200).json(result)
      }
      return res.status(400).json({ error: 'Unknown action' })
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const ok = await deleteLead(Number(id))
      if (!ok) return res.status(404).json({ error: 'Lead not found' })
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('leads handler error:', error)
    return res.status(500).json({ error: 'Request failed', details: error.message })
  }
}
