import { reactive } from 'vue'
import { crmJson } from '@/services/crmApi'
import { relTime } from '@/services/crmHistory'

/**
 * "Added by Sam · edited by Ali 2 hr ago" lines for a page of records.
 *
 *   const attribution = useAttribution('expense')
 *   await attribution.load(rows.map((r) => r.id))     // after each page of rows loads
 *   attribution.text(row.id)                          // '' until there is something to say
 *
 * One lightweight request per page (server: GET /api/crm/history/summary). It's decoration
 * on top of the list, so any failure is swallowed and the rows simply show no byline.
 * Money record types are admin-only on the server, hence admin: true.
 */
export function useAttribution(entityType, { admin = true } = {}) {
  const map = reactive({})

  async function load(ids) {
    const list = [...new Set((ids || []).map(String))].filter(Boolean).slice(0, 200)
    if (!list.length) return
    try {
      const q = new URLSearchParams({ entity_type: entityType, ids: list.join(',') })
      const res = await crmJson(`/history/summary?${q}`, { admin })
      for (const id of list) map[id] = res.summary?.[id] || null
    } catch { /* byline is optional */ }
  }

  function text(id) {
    const s = map[String(id)]
    if (!s) return ''
    const parts = []
    if (s.createdBy) parts.push(`Added by ${s.createdBy}`)
    if (s.updatedBy) parts.push(`edited by ${s.updatedBy} ${relTime(s.updatedAt)}`)
    const out = parts.join(' · ')
    return out ? out.charAt(0).toUpperCase() + out.slice(1) : ''
  }

  return { load, text }
}
