// Author: Burhan
//
// Luminus CRM — Phase 3: saved reply templates (backend)
// Mounted as: app.use('/api/crm/templates', createCrmTemplatesRouter({ requireAuth: requireBypassAuth }))
//
// Plain CRUD over public.crm_reply_templates (migration 006). Self-contained:
// the only thing it touches is the shared CRM Supabase client exported from
// crm-db.js (service-role key). Every route sits behind requireAuth.

import express from 'express'
import { _crmSupabase as supabase } from './crm-db.js'
import { auditWrite } from './crm-audit.js'

const TABLE = 'crm_reply_templates'

const clean = (v) => (v == null ? '' : String(v).trim())

// Who created / edited / deleted which template (crm-audit.js — never affects the response).
const audit = () => auditWrite({ table: TABLE, prefix: 'template', entityType: 'template', labelOf: (r) => r?.name || null })

export function createCrmTemplatesRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '512kb' })

  // Auth on every route in this router.
  router.use(auth)

  // ── GET /  — every template, ordered by name ──────────────
  router.get('/', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      res.json({ templates: data || [] })
    } catch (err) {
      console.error('[crm-templates]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── POST /  — create ─────────────────────────────────────
  router.post('/', jsonBody, audit(), async (req, res) => {
    try {
      const name = clean(req.body?.name)
      const body = clean(req.body?.body)
      if (!name || !body) {
        return res.status(400).json({ error: 'name and body are both required' })
      }
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ name, body })
        .select('*')
        .single()
      if (error) throw error
      res.status(201).json(data)
    } catch (err) {
      console.error('[crm-templates]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── PATCH /:id  — update name and/or body ─────────────────
  router.patch('/:id', jsonBody, audit(), async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })

      const patch = {}
      if (req.body?.name !== undefined) {
        const name = clean(req.body.name)
        if (!name) return res.status(400).json({ error: 'name cannot be empty' })
        patch.name = name
      }
      if (req.body?.body !== undefined) {
        const body = clean(req.body.body)
        if (!body) return res.status(400).json({ error: 'body cannot be empty' })
        patch.body = body
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'nothing to update' })
      }
      patch.updated_at = new Date().toISOString()

      const { data, error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'not found' })
      res.json(data)
    } catch (err) {
      console.error('[crm-templates]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── DELETE /:id ──────────────────────────────────────────
  router.delete('/:id', audit(), async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })

      const { error } = await supabase.from(TABLE).delete().eq('id', id)
      if (error) throw error
      res.status(204).end()
    } catch (err) {
      console.error('[crm-templates]', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
