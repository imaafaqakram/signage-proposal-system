import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { matchCrossSection } from '@/utils/crossSectionMatcher'

// importProposal / importBatch / proposalQueue / pushToQueue additions: Author Burhan.
export const useProposalStore = defineStore('proposal', () => {
  // UI State
  const sidebarOpen = ref(true)
  const currentTheme = ref('theme-navy')
  const pageSize = ref('letter') // letter, legal, a4, a3

  // AI Model Configuration
  const aiSettings = ref({
    currentModel: 'custom',
    customPromptEnabled: false,
    triggerWord: 'signage', // CRITICAL: Your model's trigger word!
    models: {
      custom: {
        id: import.meta.env.VITE_REPLICATE_MODEL_ID || '',
        version: import.meta.env.VITE_REPLICATE_VERSION_ID || '',
        name: 'Your Custom LoRA',
        description: 'Your trained model for signage',
        parameters: {
          // FLUX LoRA parameters (from your model's API schema)
          model: 'dev',                   // Use dev model (better quality)
          lora_scale: 1,                  // LoRA strength (0-3, default: 1)
          num_inference_steps: 28,        // Default for dev model
          guidance_scale: 3,              // Lower is better for FLUX! (default: 3)
          prompt_strength: 0.8,           // Image-to-image strength (0-1)
          num_outputs: 1,
          output_format: 'webp',
          output_quality: 90,
          disable_safety_checker: false,
          go_fast: false                  // Use full quality
        }
      },
      flux: {
        id: 'black-forest-labs/flux-schnell',
        version: 'bf96d3e8a2e42b8e3d90fa4d1ad28097e9e67a4ac3cf3db34db7e42d6dc5b0bb',
        name: 'FLUX Schnell',
        description: 'Fast, high-quality generations',
        parameters: {
          num_inference_steps: 4,
          guidance_scale: 0
        }
      },
      sdxl: {
        id: 'stability-ai/sdxl',
        version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
        name: 'Stable Diffusion XL',
        description: 'High quality, detailed images',
        parameters: {
          num_inference_steps: 40,
          guidance_scale: 9.5,
          strength: 0.95
        }
      }
    }
  })

  // Multi-Company System - 3 distinct business profiles with futuristic themes
  const companies = ref([
    {
      id: 'luminus',
      name: 'Signage Crafting',
      tagline: 'Custom Signage & Illumination',
      email: 'info@signagecrafting.com',
      logo: null, // User can add later
      theme: {
        name: 'Cyber Neon',
        primary: '#22d3ee',      // Cyan
        secondary: '#0ea5e9',    // Blue
        accent: '#06b6d4',       // Teal
        background: 'linear-gradient(135deg, #0B1120 0%, #1a1a2e 100%)',
        text: '#e2e8f0',
        glow: '0 0 20px rgba(34, 211, 238, 0.4)'
      },
      copyrightText: 'This document and all enclosed mockups are the exclusive property of <strong>Signage Crafting</strong>.'
    },
    {
      id: 'signcrafters',
      name: 'Signage Crafting',
      tagline: 'Premium Sign Manufacturing',
      email: 'info@signagecrafting.com',
      logo: null,
      theme: {
        name: 'Cyan Dark',
        primary: '#00f3ff',
        secondary: '#00bcd4',
        accent: '#00f3ff',
        background: 'linear-gradient(135deg, #050505 0%, #0a0a0a 100%)',
        text: '#ffffff',
        glow: '0 0 20px rgba(255,255,255,0.4)',
        themeBg: '#050505',
        themeText: '#ffffff',
        accentColor: '#00f3ff',
        glowColor: '#ffffff',
        glowIntensity: 0.4
      },
      copyrightText: 'This document and all enclosed mockups are the exclusive property of <strong>Signage Crafting</strong>. Any reproduction, distribution, or use of this material, in whole or in part, is strictly prohibited.'
    },
    {
      id: 'nexusleds',
      name: 'Signage Crafting',
      tagline: 'Signage Solutions',
      email: 'info@signagecrafting.com',
      logo: null,
      theme: {
        name: 'Electric Green',
        primary: '#10b981',      // Emerald
        secondary: '#059669',    // Green
        accent: '#34d399',       // Light green
        background: 'linear-gradient(135deg, #022c22 0%, #064e3b 100%)',
        text: '#ecfdf5',
        glow: '0 0 20px rgba(16, 185, 129, 0.4)'
      },
      copyrightText: 'This document and all enclosed mockups are the exclusive property of <strong>Signage Crafting</strong>.'
    }
  ])

  const activeCompanyId = ref('signcrafters')

  // Global Settings (Switchable based on company)
  const settings = ref({
    companyName: 'Signage Crafting',
    companyTagline: 'Custom Signage & Illumination',
    contactEmail: 'info@signagecrafting.com',
    themeBg: '#050505',      // Default Background (Deep Black)
    themeText: '#e2e8f0',    // Default Text
    accentColor: '#00f3ff',  // Default Accent (Neon Cyan)
    glowColor: '#00f3ff',    // Default Glow Color
    glowIntensity: 0.4,      // Default Glow Intensity (0-1)
    glowEnabled: true,       // Off = flat background, no corner glow / text glow at all
    copyrightText: 'This document and all enclosed mockups are the exclusive property of <strong>Signage Crafting</strong>. Any reproduction, distribution, or use of this material, in whole or in part, is strictly prohibited.',
    trustBarItems: [
      { icon: 'fa-tag', label: 'Best Price' },
      { icon: 'fa-shield-alt', label: 'Warranty' },
      { icon: 'fa-truck', label: 'Free Ship' },
      { icon: 'fa-headset', label: '24/7 Help' },
      { icon: 'fa-certificate', label: 'UL Listed' }
    ]
  })

  // Proposal Data
  const clientName = ref('Alexis Bradshaw')
  const contactEmail = ref('info@signagecrafting.com')

  const footer = ref({
    instruction1: 'Please ensure all spellings are correct.',
    instruction2: 'Kindly verify that dimensions are accurate.',
    instruction3: 'Includes a 2 Year Warranty.',
    delivery: '18-22 working days.',
    note: 'Note: Signage Crafting has up to 5% color and dimension tolerance acceptable difference between digital proof and actual product.'
  })

  const pages = ref([
    {
      signType: '3D Metal Back-lit',
      usage: 'Outdoor',
      finish: 'Matte',
      illuminated: 'Yes',
      ulCert: 'Only For Illuminated variants',
      permit: 'On Demand',
      install: 'On Demand',
      glowColor: '#00ffff',
      bgClass: 'bg-brick',
      color: 'Same as Mockup',
      discountCode: 'SM10SALE',
      discountPercent: 5,
      paymentLink: '',
      assets: [
        {
          style: 'drawing',
          src: null,
          mediaType: 'image',
          label: 'Technical Drawing',
          isRegenerating: false,
          originalSrc: null, // For tracking before/after
          isDragging: false,
          aspectRatio: 'auto',
          isDragging: false,
          aspectRatio: 'auto',
          bgTransparent: false,
          zoom: 1,
          x: 0,
          y: 0
        },
        {
          style: 'mockup',
          src: null,
          mediaType: 'image',
          label: 'Day View',
          isRegenerating: false,
          originalSrc: null,
          isDragging: false,
          isDragging: false,
          aspectRatio: 'auto',
          zoom: 1,
          x: 0,
          y: 0
        },
        {
          style: 'mockup',
          src: null,
          mediaType: 'image',
          label: 'Night View',
          isRegenerating: false,
          originalSrc: null,
          isDragging: false,
          isDragging: false,
          aspectRatio: 'auto',
          zoom: 1,
          x: 0,
          y: 0
        }
      ],
      pricing: [
        { size: 'Small', dim: '24in x 24in', cost: '570', quantity: 1 },
        { size: 'Medium', dim: '36in x 35in', cost: '962', quantity: 1 },
        { size: 'Large', dim: '48in x 47in', cost: '1721', quantity: 1 }
      ]
    }
  ])

  // Actions
  const addPage = () => {
    pages.value.push({
      signType: 'New Option',
      usage: 'Outdoor',
      finish: 'Standard',
      illuminated: 'Yes',
      ulCert: 'Only For Illuminated variants',
      permit: 'On Demand',
      install: 'On Demand',
      glowColor: '#ffffff',
      bgClass: 'bg-brick',
      color: 'Same as Mockup',
      discountCode: 'SM10SALE',
      discountPercent: 5,
      paymentLink: '',
      assets: [
        {
          style: 'drawing',
          src: null,
          mediaType: 'image',
          label: 'Technical Drawing',
          isRegenerating: false,
          originalSrc: null,
          isDragging: false,
          aspectRatio: 'auto',
          auto: 'aspectRatio',
          bgTransparent: false,
          zoom: 1,
          x: 0,
          y: 0
        },
        {
          style: 'mockup',
          src: null,
          mediaType: 'image',
          label: 'Option 2',
          isRegenerating: false,
          originalSrc: null,
          isDragging: false,
          aspectRatio: 'auto',
          zoom: 1,
          x: 0,
          y: 0
        },
        {
          style: 'mockup',
          src: null,
          mediaType: 'image',
          label: 'Option 3',
          isRegenerating: false,
          originalSrc: null,
          isDragging: false,
          aspectRatio: 'auto',
          zoom: 1,
          x: 0,
          y: 0
        }
      ],
      pricing: [
        { size: 'Small', dim: '', cost: '0', quantity: 1 },
        { size: 'Medium', dim: '', cost: '0', quantity: 1 },
        { size: 'Large', dim: '', cost: '0', quantity: 1 }
      ]
    })
  }

  const removePage = (index) => {
    if (pages.value.length > 1) {
      pages.value.splice(index, 1)
    }
  }

  const addAsset = (pageIndex) => {
    pages.value[pageIndex].assets.push({
      style: 'mockup',
      src: null,
      mediaType: 'image',
      label: 'Additional View',
      isRegenerating: false,
      originalSrc: null,
      isDragging: false,
      isDragging: false,
      aspectRatio: 'auto',
      zoom: 1,
      x: 0,
      y: 0
    })
  }

  const removeAsset = (pageIndex, assetIndex) => {
    pages.value[pageIndex].assets.splice(assetIndex, 1)
  }

  const setAssetImage = (pageIndex, assetIndex, src, mediaType = 'image') => {
    const asset = pages.value[pageIndex].assets[assetIndex]
    asset.src = src
    asset.mediaType = mediaType
    if (!asset.originalSrc) {
      asset.originalSrc = src // Save original
    }
  }

  const setAssetRegenerating = (pageIndex, assetIndex, isRegenerating) => {
    pages.value[pageIndex].assets[assetIndex].isRegenerating = isRegenerating
  }

  // Update settings
  const updateSettings = (newSettings) => {
    settings.value = { ...settings.value, ...newSettings }
  }

  // Tracks what's currently loaded in the editor, so the Save button knows whether to
  // create a brand new saved lead or a new version of the one already open. The server
  // also dedupes by crmRecordId independently, so dbLeadId being stale/unknown here
  // is harmless — crmRecordId alone is enough for a save to land on the right lead.
  const activeLeadMeta = ref({ crmRecordId: null, dbLeadId: null, latestVersion: null })

  // Safety net against an accidental refresh/crash wiping unsaved edits — confirmed as a
  // real complaint: correcting a sign type or price, then losing it to a refresh before
  // clicking Save, with no way to get it back. Images are deliberately left out of the
  // snapshot (they're always re-derivable from the saved lead itself on reload) — a
  // multi-sign proposal's embedded mockups can be several MB each, and localStorage's
  // ~5-10MB quota would turn this safety net into a QuotaExceededError that silently
  // breaks itself. Scoped to ONE draft slot, matched by lead+version on restore, so a
  // draft from a different client never bleeds into whatever's freshly loaded.
  const DRAFT_KEY = 'luminus_draft_v1'
  let draftSaveTimer = null
  const saveDraft = () => {
    clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          dbLeadId: activeLeadMeta.value.dbLeadId,
          dbVersion: activeLeadMeta.value.latestVersion,
          clientName: clientName.value,
          contactEmail: contactEmail.value,
          pages: pages.value.map((p) => ({
            ...p,
            assets: (p.assets || []).map((a) => ({ ...a, src: null, originalSrc: null }))
          })),
          savedAt: Date.now()
        }))
      } catch {
        // best-effort only — a failed draft write must never block real editing
      }
    }, 2000)
  }
  const clearDraft = () => {
    clearTimeout(draftSaveTimer)
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* best-effort */ }
  }
  const restoreDraftIfMatching = (dbLeadId, dbVersion) => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return false
      const draft = JSON.parse(raw)
      if (draft.dbLeadId == null || draft.dbLeadId !== dbLeadId || draft.dbVersion !== dbVersion) return false
      pages.value = pages.value.map((freshPage, i) => {
        const draftPage = draft.pages[i]
        if (!draftPage) return freshPage
        return { ...draftPage, assets: freshPage.assets } // text/pricing from draft, images stay freshly loaded
      })
      if (draft.clientName) clientName.value = draft.clientName
      if (draft.contactEmail) contactEmail.value = draft.contactEmail
      return true
    } catch {
      return false
    }
  }
  watch(pages, saveDraft, { deep: true })

  // Load a migrated proposal (see the lead-import script's output).
  // Merges onto page defaults so any field the migration couldn't resolve keeps its template value.
  const importProposal = (data, meta = {}) => {
    if (!data || !Array.isArray(data.pages) || data.pages.length === 0) {
      throw new Error('Invalid proposal file: expected a "pages" array.')
    }

    const blankAsset = {
      style: 'mockup', src: null, mediaType: 'image', label: '',
      isRegenerating: false, originalSrc: null, isDragging: false,
      aspectRatio: 'auto', bgTransparent: false, zoom: 1, x: 0, y: 0
    }
    const pageDefaults = {
      signType: 'New Option', usage: 'Outdoor', finish: 'Standard', illuminated: 'Yes',
      ulCert: 'Only For Illuminated variants', permit: 'On Demand', install: 'On Demand',
      glowColor: '#00ffff', bgClass: 'bg-brick', color: 'Same as Mockup',
      discountCode: 'SM10SALE',
      discountPercent: 5,
      paymentLink: ''
    }

    if (data.clientName) clientName.value = data.clientName
    if (data.contactEmail) contactEmail.value = data.contactEmail

    // Normalizes both shapes: newer migrate.py output is {message, pageIndex, fields},
    // but leads already saved before this change still have plain strings — those just
    // can't be pointed at a specific field (fields: []), only shown in the warning log.
    const normalizedWarnings = (data._source?.warnings ?? []).map((w) =>
      typeof w === 'string' ? { message: w, pageIndex: null, fields: [] } : w
    )
    const warningsByPage = {}
    for (const w of normalizedWarnings) {
      if (w.pageIndex == null) continue
      ;(warningsByPage[w.pageIndex] ??= []).push(w)
    }

    pages.value = data.pages.map((p, pageIdx) => {
      const assets = (p.assets || []).map((a) => ({
        ...blankAsset,
        ...a,
        originalSrc: a.src ?? null
      }))
      // Every page gets a Cross Section slot, not just ones a source already provided
      // one for - migrate.py's output only ever has Technical Drawing/Day/Night, so
      // without this every CRM-fetched proposal would silently have nowhere for an
      // auto-matched diagram to go.
      let crossSection = assets.find((a) => a.label === 'Cross Section')
      if (!crossSection) {
        crossSection = { ...blankAsset, style: 'drawing', label: 'Cross Section' }
        assets.push(crossSection)
      }
      if (!crossSection.src) {
        const matched = matchCrossSection(p.signType ?? pageDefaults.signType, p.illuminated ?? pageDefaults.illuminated)
        if (matched) crossSection.src = matched
      }
      const pageWarnings = warningsByPage[pageIdx] || []
      return {
        ...pageDefaults,
        ...p,
        assets,
        pricing: p.pricing && p.pricing.length
          ? p.pricing
          : [{ size: 'Small', dim: '', cost: '0', quantity: 1 }],
        // Consumed by the page templates to badge the exact flagged field/image instead
        // of only listing the warning text in the sidebar's log.
        warningFields: [...new Set(pageWarnings.flatMap((w) => w.fields || []))]
      }
    })

    activeLeadMeta.value = {
      crmRecordId: data._source?.crmRecordId ?? null,
      dbLeadId: meta.dbLeadId ?? null,
      latestVersion: meta.version ?? null
    }

    const draftRestored = restoreDraftIfMatching(activeLeadMeta.value.dbLeadId, activeLeadMeta.value.latestVersion)

    return {
      draftRestored,
      pageCount: pages.value.length,
      revisionUsed: data._source?.revisionUsed ?? null,
      specsFrom: data._source?.specsFrom ?? null,
      warnings: normalizedWarnings
    }
  }

  // Build the payload shape Save/import expect from the current live editor state.
  const exportCurrentProposal = () => ({
    clientName: clientName.value,
    contactEmail: contactEmail.value,
    pages: pages.value,
    _source: { crmRecordId: activeLeadMeta.value.crmRecordId }
  })

  // Batch review queue (see the lead-import script's --batch-file / --since).
  // Each entry holds a full proposal payload (same shape importProposal accepts) plus
  // review status, so a whole sheet of clients can be reviewed/sent one at a time.
  const proposalQueue = ref([])
  const activeQueueIndex = ref(-1)

  const mapToQueueEntry = (data, saved = null, createdAt = null, emailSentAt = null, emailSentBy = null) => ({
    clientName: data.clientName || 'Unnamed Client',
    contactEmail: data.contactEmail || '',
    data,
    // Persisted server-side (leads.email_sent_at/_by) — not per-session state, so this is
    // correct for every employee on every device the moment the queue loads, not just
    // whoever's browser actually sent it. Confirmed as the real gap: the status dot
    // existed before, but nothing populated it from the DB on a fresh load.
    status: emailSentAt ? 'sent' : 'pending', // pending | reviewed | sent
    revisionUsed: data._source?.revisionUsed ?? null,
    specsFrom: data._source?.specsFrom ?? null,
    warnings: data._source?.warnings ?? [],
    crmSourceAlias: data._source?.crmSourceAlias ?? null,
    dbLeadId: saved?.leadId ?? null,
    dbVersion: saved?.version ?? null,
    emailSentAt,
    emailSentBy,
    // When this lead was actually fetched — shown in the queue so a Saturday/Sunday
    // auto-fetch (nobody emails clients those days) doesn't just silently blend into
    // Monday's fresh batch; the reviewer can see it's been sitting since the weekend.
    fetchedAt: createdAt || new Date().toISOString()
  })

  // A batch pulled from /api/leads/batches/:id/queue-preview has no images in it on
  // purpose — a real automated run can be 50+ leads with several MB of embedded images
  // each, and the queue only needs to show who's in it, not render every mockup at once.
  // This detects that "text only" shape so loadFromQueue knows to fetch the real thing.
  const pageMissingImages = (page) => (page.assets || []).some((a) => !a.src)
  const isImageless = (data) => (data.pages || []).some(pageMissingImages)

  // Accepts either plain proposal objects (a local batch.json import already has full
  // images) or { leadId, version, data } entries (a queue-preview batch — no images yet,
  // dbLeadId/dbVersion recorded so loadFromQueue can fetch the real thing on demand).
  const importBatch = (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Invalid batch: expected a non-empty array of proposals.')
    }
    proposalQueue.value = entries.map((e) =>
      e && typeof e === 'object' && e.data
        ? mapToQueueEntry(e.data, e.leadId != null ? { leadId: e.leadId, version: e.version } : null, e.createdAt || null, e.emailSentAt || null, e.emailSentBy || null)
        : mapToQueueEntry(e)
    )
    activeQueueIndex.value = -1
    return { count: proposalQueue.value.length }
  }

  // Append one client as it streams in from a live fetch (see EditorSidebar's
  // handleFetchLead), rather than replacing the whole queue at once.
  // `saved` is the server's auto-save result ({ leadId, version }), if the fetch also
  // persisted this client to the local DB (it does by default — see server.js).
  const pushToQueue = (data, saved = null) => {
    proposalQueue.value.push(mapToQueueEntry(data, saved))
    return proposalQueue.value.length - 1
  }

  // Shared across EditorSidebar (per-row spinner) and ProposalEditor (canvas overlay) —
  // the actual delay a reviewer notices is the on-demand image fetch below, which can
  // take a couple seconds for a multi-sign proposal; without a visible state there was no
  // indication anything was happening between the click and the canvas updating.
  const isLoadingQueueEntry = ref(false)

  const loadFromQueue = async (index) => {
    const entry = proposalQueue.value[index]
    if (!entry) return null
    isLoadingQueueEntry.value = true
    try {
      let data = entry.data
      if (isImageless(data) && entry.dbLeadId != null && entry.dbVersion != null) {
        const response = await fetch(`/api/leads?id=${entry.dbLeadId}&action=version&version=${entry.dbVersion}`)
        const result = await response.json().catch(() => null)
        if (response.ok && result?.data) {
          data = result.data
          entry.data = data // cache — re-opening this same entry won't need to fetch again
        }
        // On failure, fall through and import what we have (text/pricing only, no images)
        // rather than blocking the reviewer entirely.
      }
      const result = importProposal(data, { dbLeadId: entry.dbLeadId, version: entry.dbVersion })
      activeQueueIndex.value = index
      if (entry.status === 'pending') entry.status = 'reviewed'
      return result
    } finally {
      isLoadingQueueEntry.value = false
    }
  }

  const markQueueStatus = (index, status) => {
    const entry = proposalQueue.value[index]
    if (!entry) return
    entry.status = status
    // Optimistic local stamp so THIS session sees "sent" immediately, without waiting on
    // a reload — server.js records the real device label at send time; a page refresh
    // picks that up and replaces "You" with it. Matches the queue's existing pattern of
    // marking status on click rather than waiting for the send to actually finish.
    if (status === 'sent' && !entry.emailSentAt) {
      entry.emailSentAt = new Date().toISOString()
      entry.emailSentBy = 'You (this device)'
    }
  }

  const clearQueue = () => {
    proposalQueue.value = []
    activeQueueIndex.value = -1
  }

  // AI Model Actions
  const setAIModel = (modelKey) => {
    if (aiSettings.value.models[modelKey]) {
      aiSettings.value.currentModel = modelKey
    }
  }

  const getCurrentModelConfig = () => {
    return aiSettings.value.models[aiSettings.value.currentModel]
  }

  // Page size action
  const setPageSize = (size) => {
    if (['letter', 'legal', 'a4', 'a3'].includes(size)) {
      pageSize.value = size
    }
  }

  // Switch active company and update settings
  const switchCompany = (companyId) => {
    const company = companies.value.find(c => c.id === companyId)
    if (company) {
      activeCompanyId.value = companyId
      settings.value = {
        ...settings.value,
        companyName: company.name,
        companyTagline: company.tagline,
        contactEmail: company.email,
        copyrightText: company.copyrightText,
        // Apply company-specific theme colors if defined
        ...(company.theme.themeBg       && { themeBg:       company.theme.themeBg }),
        ...(company.theme.themeText     && { themeText:     company.theme.themeText }),
        ...(company.theme.accentColor   && { accentColor:   company.theme.accentColor }),
        ...(company.theme.glowColor     && { glowColor:     company.theme.glowColor }),
        ...(company.theme.glowIntensity !== undefined && { glowIntensity: company.theme.glowIntensity })
      }
      // Apply company theme
      currentTheme.value = `theme-${company.id}`
    }
  }

  // Update company name (editable)
  const updateCompanyName = (companyId, newName) => {
    const company = companies.value.find(c => c.id === companyId)
    if (company) {
      company.name = newName
      if (activeCompanyId.value === companyId) {
        settings.value.companyName = newName
      }
    }
  }

  // Get active company
  const getActiveCompany = () => {
    return companies.value.find(c => c.id === activeCompanyId.value)
  }

  return {
    // State
    sidebarOpen,
    currentTheme,
    pageSize,
    settings,
    clientName,
    contactEmail,
    footer,
    pages,
    aiSettings,
    companies,
    activeCompanyId,

    // Actions
    addPage,
    removePage,
    addAsset,
    removeAsset,
    setAssetImage,
    setAssetRegenerating,
    updateSettings,
    importProposal,
    exportCurrentProposal,
    clearDraft,
    activeLeadMeta,
    proposalQueue,
    activeQueueIndex,
    isLoadingQueueEntry,
    importBatch,
    pushToQueue,
    loadFromQueue,
    markQueueStatus,
    clearQueue,
    setAIModel,
    getCurrentModelConfig,
    setPageSize,
    switchCompany,
    updateCompanyName,
    getActiveCompany
  }
})
