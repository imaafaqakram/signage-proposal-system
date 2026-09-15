// Deletes batch-archive folders (VM disk) and lead_versions rows (Supabase) older than
// the retention window — see Milestone 3 of the multi-company fetch plan: images live on
// the VM's own disk (50GB free vs. Supabase's 500MB free tier), so pruning happens here
// rather than depending on Supabase Storage limits. Run via cron; safe to run daily.
import 'dotenv/config'
import path from 'path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BATCH_ARCHIVE_DIR = path.join(__dirname, '..', 'batch-archive')
const RETENTION_DAYS = parseInt(process.env.BATCH_RETENTION_DAYS || '60', 10)

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function pruneArchiveDir() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  let entries
  try {
    entries = await fs.readdir(BATCH_ARCHIVE_DIR, { withFileTypes: true })
  } catch {
    return { removed: 0 } // archive dir doesn't exist yet — nothing to prune
  }
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(BATCH_ARCHIVE_DIR, entry.name)
    const stat = await fs.stat(dirPath)
    if (stat.mtimeMs < cutoff) {
      await fs.rm(dirPath, { recursive: true, force: true })
      removed++
    }
  }
  return { removed }
}

async function pruneOldVersions() {
  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('lead_versions')
    .delete()
    .lt('created_at', cutoffIso)
    .select('id')
  if (error) throw error
  return { removed: data?.length || 0 }
}

async function main() {
  console.log(`🧹 Pruning batch archive + lead_versions older than ${RETENTION_DAYS} days...`)
  const disk = await pruneArchiveDir()
  const db = await pruneOldVersions()
  console.log(`   Archive folders removed: ${disk.removed}`)
  console.log(`   lead_versions rows removed: ${db.removed}`)
}

main().catch((err) => {
  console.error('❌ Prune failed:', err.message)
  process.exit(1)
})
