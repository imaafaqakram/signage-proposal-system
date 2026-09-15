// One-off manual re-fetch: forces a genuine fresh re-process (bypassing dedup) for every
// lead confirmed to belong to 2026-08-19, so leads originally fetched under older,
// less-accurate migrate.py code (before this week's vision-matching and other fixes) get
// redone with the current, corrected logic. Not part of the regular automated pipeline —
// run once, by hand.
const BASE_URL = 'http://localhost:3001'
const DATE = '2026-08-19'
const CHUNK_SIZE = 15
const BATCH_ID = `refetch-${DATE}-${Date.now()}`

const BY_SOURCE = {
  "1": ["rec5vSOB0sArNrU3J", "recI1Imn1ifyfFz5e", "recJNTTlnkju8wBMx", "recNo1DmnaltHQcOD", "recSL6Ncmeuq5RDRk", "recSPENpewPF3dhMG", "recWK1sVb13BfPhoB", "recbLROmomqwPzixO", "recit0h3fFpbAS3aa", "reclHQq3aQktMVARF", "recnQy2FcOtQ6qnot", "recniX2ndiQ8UT1ua", "recrRAfFFGcRmXFX2", "recski2CSOLyPWAqv", "recv9Bgs5yLWkPHUV"],
  "2": ["rec6hqm2aQY8t8ruK", "recTSedpCW1scF2TR", "recZL4QKULj9jHWbh", "recuKplc55Dp5G1Y0", "recvjl1CZDJRCCNAl"],
  "3": ["recLDsrjUIVKG3nVp", "recb4szapjttdW3CP", "recdAlymQBjL5fVSv", "rectUyod3wIZjYrvz", "reczKZ1YGDtRsddZg"],
  "4": ["rec0W8mijEbLeyy99", "rec0cn5fOZb9T7OpZ", "rec13YWHMBITAfDIR", "rec2kcxRcBKMG5oq7", "rec3x8g0m3bz2sx2B", "rec60kXFAigUIKc53", "rec6qfn5ftkyXRF8r", "rec8Tlv4GBk3gEwfE", "rec9k7uxd73yRVBUw", "recEHXG1ClxKx5gM0", "recJVdBA4lb9ft1jP", "recK6mWlabwEMKX3E", "recL7869YhQBHzxzC", "recOiMJ9eblbDYmmq", "recPKUKUgsJlaFGsz", "recZgM3Z88nKomAWh", "recaQTXaxIceiwJXi", "reclWbqPwVEQCiQxa", "recnFOgr05HZMVlaq", "recpae6VV89100o6B", "recqNqvl7usJXtCSm", "recu7buUymxSiHuuO", "recw5SPBwyHrMcrZy", "recx8WKoFRDqWpXbb", "recxLHVoAnKUkUwQO", "recytZxJDotsz7IGp"]
}
const ALIASES = { "1": "Brown", "2": "Black", "3": "Blue", "4": "White" }

async function refetchChunk(sourceId, ids) {
  const res = await fetch(`${BASE_URL}/api/migrate-lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: ids, source: sourceId, date: DATE, force: true, useCache: false, batchId: BATCH_ID, dailyAuto: false })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  let succeeded = 0, failed = 0
  for (const line of text.trim().split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'done') succeeded++
      else if (event.type === 'failed') failed++
    } catch { /* ignore unparsable lines */ }
  }
  return { succeeded, failed }
}

async function main() {
  console.log(`🔄 Force re-fetch starting for ${DATE} (batch ${BATCH_ID})`)
  let totalSucceeded = 0
  let totalFailed = 0
  for (const [sourceId, ids] of Object.entries(BY_SOURCE)) {
    const alias = ALIASES[sourceId]
    let sourceSucceeded = 0
    let sourceFailed = 0
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE)
      try {
        const { succeeded, failed } = await refetchChunk(sourceId, chunk)
        sourceSucceeded += succeeded
        sourceFailed += failed
      } catch (err) {
        console.error(`   ❌ ${alias} chunk (${i + 1}-${i + chunk.length} of ${ids.length}) errored: ${err.message}`)
        sourceFailed += chunk.length
      }
    }
    console.log(`   ${alias}: ${sourceSucceeded} re-fetched, ${sourceFailed} failed`)
    totalSucceeded += sourceSucceeded
    totalFailed += sourceFailed
  }
  console.log(`✅ Force re-fetch complete: ${totalSucceeded} succeeded, ${totalFailed} failed`)
}

main().catch((err) => {
  console.error('❌ Re-fetch script failed:', err.message)
  process.exit(1)
})
