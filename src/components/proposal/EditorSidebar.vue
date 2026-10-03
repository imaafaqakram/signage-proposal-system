<!-- Import/Fetch/Clients-queue additions: Author Burhan. -->
<template>
  <aside
    class="sidebar-transition flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen sticky top-0 z-40"
    :class="open ? 'w-full md:w-96' : 'w-0 overflow-hidden'"
  >
    <!-- FIXED COMPACT HEADER -->
    <div class="p-3 border-b border-gray-800 bg-gray-900 flex-shrink-0 relative">
      <!-- Title Bar -->
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-base font-bold text-white">Signage Crafting <span class="text-teal-400 text-[10px]">PRO</span></h2>
        <div class="flex items-center gap-2.5">
          <button @click="toggleWarningLog" class="relative text-gray-400 hover:text-amber-400 transition-colors text-sm" title="Extraction warnings log">
            <i class="fas fa-bell"></i>
            <span v-if="unreadWarningCount > 0"
                  class="absolute -top-1.5 -right-1.5 bg-amber-500 text-gray-900 text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
              {{ unreadWarningCount > 9 ? '9+' : unreadWarningCount }}
            </span>
          </button>
          <button @click="handleLogout" class="text-gray-400 hover:text-red-400 transition-colors text-sm" title="Log out">
            <i class="fas fa-right-from-bracket"></i>
          </button>
          <button @click="$emit('update:open', false)" class="text-gray-400 hover:text-white text-sm">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <!-- WARNING LOG — replaces the old per-warning full-width toasts, which could stack
           several giant banners over the whole screen for one multi-sign lead. -->
      <div v-if="showWarningLog" class="absolute right-3 top-11 z-50 w-80 max-w-[calc(100vw-24px)] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/60">
          <span class="text-[11px] font-bold text-gray-200 uppercase tracking-wider">Warnings ({{ warningLog.length }})</span>
          <div class="flex items-center gap-3">
            <button v-if="warningLog.length" @click="clearWarningLog" class="text-[10px] text-gray-400 hover:text-red-400">Clear all</button>
            <button @click="showWarningLog = false" class="text-gray-400 hover:text-white text-xs"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div v-if="warningLog.length === 0" class="px-3 py-6 text-center text-[11px] text-gray-500">
          No warnings — extraction has been clean.
        </div>
        <div v-else class="max-h-80 overflow-y-auto divide-y divide-gray-800">
          <div
            v-for="entry in warningLog" :key="entry.id"
            class="px-3 py-2.5"
            :class="entry.pageIndex != null ? 'hover:bg-gray-800/40 cursor-pointer' : ''"
            @click="jumpToWarning(entry)"
          >
            <div class="flex items-start gap-2">
              <i class="fas fa-triangle-exclamation text-amber-400 text-[10px] mt-0.5 flex-shrink-0"></i>
              <div class="min-w-0">
                <div class="text-[10px] font-bold text-gray-300 flex items-center gap-1.5">
                  {{ entry.clientLabel }}
                  <span v-if="entry.pageIndex != null" class="text-teal-400 normal-case font-normal">— page {{ entry.pageIndex + 1 }}, click to view</span>
                </div>
                <div class="text-[11px] text-gray-400 leading-snug mt-0.5">{{ entry.message }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Page Nav + Quick Actions Row -->
      <div class="flex items-center gap-2 mb-2 bg-gray-800 p-2 rounded border border-gray-700">
        <span class="text-teal-400 text-[10px] font-bold flex-shrink-0">
          <i class="fas fa-file mr-1"></i>{{ currentPageIndex + 1 }}/{{ pages.length }}
        </span>
        <div class="flex gap-1 flex-1 overflow-x-auto scrollbar-thin">
          <button v-for="(page, idx) in pages" :key="idx" @click="scrollToPage(idx)" 
            class="page-mini-tab" :class="{ 'active': currentPageIndex === idx }">
            {{ idx + 1 }}
          </button>
        </div>
        <button @click="addPage" class="text-teal-400 hover:text-teal-300 text-xs px-1.5 flex-shrink-0">
          <i class="fas fa-plus"></i>
        </button>
      </div>

      <!-- Theme Buttons (Presets) — data-driven so each swatch preview is the theme's
           actual bg/accent color, not a hand-picked Tailwind color that happened to be
           close (previously Navy's preview used cyan, Onyx's used blue, Pro's used
           purple — none matched what the preset actually applied). -->
      <div class="grid grid-cols-4 gap-1 mb-2">
        <button v-for="t in THEME_PRESETS" :key="t.id" @click="applyThemePreset(t.id)" class="theme-compact"
                :style="{ background: t.bg, color: currentTheme === t.id ? t.accent : t.mutedText, borderColor: currentTheme === t.id ? t.accent : 'rgba(255,255,255,0.12)' }"
                :class="{ 'theme-active': currentTheme === t.id }">
          {{ t.label }}
        </button>
      </div>

      <!-- Page Size + Action Buttons Row -->
      <div class="grid grid-cols-4 gap-1">
        <select v-model="pageSize" @change="proposalStore.setPageSize(pageSize)" class="page-size-select col-span-1" title="PDF Page Size">
          <option value="letter">Letter</option>
          <option value="legal">Legal</option>
          <option value="a4">A4</option>
          <option value="a3">A3</option>
        </select>
        <button @click="showBulkActions = true" class="action-mini bg-slate-700 hover:bg-slate-600">
          <i class="fas fa-magic text-xs"></i><span class="text-[10px]">Quick</span>
        </button>
        <button @click="handlePayClick" class="action-mini bg-slate-700 hover:bg-slate-600">
          <i class="fas" :class="hasClickedPay ? 'fa-check text-teal-400' : 'fa-link'"></i>
          <span class="text-[10px]">Pay</span>
        </button>
        <button @click="handleEmailClick" class="action-mini bg-slate-700 hover:bg-slate-600">
          <i class="fas" :class="hasClickedEmail ? 'fa-check text-teal-400' : 'fa-envelope'"></i>
          <span class="text-[10px]">Email</span>
        </button>
        <button @click="handlePDFClick" class="action-mini bg-slate-700 hover:bg-slate-600">
          <i class="fas" :class="hasClickedPDF ? 'fa-check text-teal-400' : 'fa-file-pdf'"></i>
          <span class="text-[10px]">PDF</span>
        </button>
        <button @click="importInput?.click()" class="action-mini bg-slate-700 hover:bg-slate-600"
                title="Load a migrated proposal JSON">
          <i class="fas fa-file-import text-xs"></i><span class="text-[10px]">Import</span>
        </button>
        <button @click="toggleFetchPanel" class="action-mini bg-teal-600 hover:bg-teal-500 ring-1 ring-teal-400/40"
                title="Fetch a lead straight from your CRM — no terminal needed">
          <i class="fas fa-cloud-arrow-down text-xs"></i><span class="text-[10px]">Fetch</span>
        </button>
        <button @click="handleSaveLead" :disabled="savingLead" class="action-mini bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
                title="Save this proposal to the local database">
          <i class="fas" :class="savingLead ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i>
          <span class="text-[10px]">Save</span>
        </button>
        <button @click="openSavedLeadsPanel" class="action-mini bg-slate-700 hover:bg-slate-600"
                title="Browse previously saved leads — no CRM call needed">
          <i class="fas fa-database text-xs"></i><span class="text-[10px]">Leads</span>
        </button>
        <input ref="importInput" type="file" accept=".json,application/json"
               class="hidden" @change="handleImportFile" />
      </div>
      <button @click="handleApplyCrossSections" class="w-full mt-1.5 action-mini bg-slate-700 hover:bg-slate-600 !flex-row gap-1.5"
              title="Match each page's sign type against the cross-section diagram library and apply it — fetched proposals already get this automatically; use this to re-apply after changing a sign type, or for proposals loaded before this existed">
        <i class="fas fa-layer-group text-xs text-teal-400"></i><span class="text-[10px]">Apply Cross Sections</span>
      </button>
      <!-- Dashboard link removed from the UI on request — the /dashboard route itself
           still works, reached by URL directly rather than a visible entry point here. -->
    </div>

    <!-- SCROLL REGION — everything below the fixed header lives in one scroll container.
         Previously the Fetch/Saved-Leads/Queue panels were separate flex siblings above
         the old scrollable div; a flex item's default min-height:auto means it refuses to
         shrink below its own content, so a long Fetch results list (176 leads) pushed the
         whole sidebar taller than the viewport with no way to scroll to it. One shared
         min-h-0 + overflow-y-auto wrapper fixes that regardless of how tall any panel gets. -->
    <div class="flex-1 min-h-0 overflow-y-auto">

    <!-- FETCH FROM CRM — direct pull, no script/terminal/manual file needed -->
    <div v-if="showFetchPanel" class="px-3 py-2.5 border-b border-gray-700 bg-gray-800/60">
      <label class="text-[10px] uppercase tracking-wider text-gray-400 font-bold block mb-1.5">
        Fetch from CRM
      </label>

      <select v-if="crmSources.length > 1 && !(fetchMode === 'date' && fetchAllCompanies)" v-model="fetchSource" :disabled="fetchLoading"
              class="w-full text-[11px] bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 mb-1.5">
        <option v-for="s in crmSources" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <label v-if="crmSources.length > 1 && fetchMode === 'date' && !dateLookupDone"
             class="flex items-center gap-1.5 text-[10px] text-gray-300 mb-1.5 cursor-pointer">
        <input type="checkbox" v-model="fetchAllCompanies" :disabled="fetchLoading" class="accent-cyan-600" />
        <span>🌐 All companies (looks up every source for this date)</span>
      </label>

      <div class="flex gap-1 mb-1.5 text-[10px]">
        <button @click="fetchMode = 'name'; dateLookupDone = false" :disabled="fetchLoading"
                class="flex-1 py-1 rounded"
                :class="fetchMode === 'name' ? 'bg-cyan-700 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'">
          By Name
        </button>
        <button @click="fetchMode = 'date'" :disabled="fetchLoading"
                class="flex-1 py-1 rounded"
                :class="fetchMode === 'date' ? 'bg-cyan-700 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'">
          By Date
        </button>
      </div>

      <template v-if="!fetchLoading">
        <textarea
          v-if="fetchMode === 'name'"
          v-model="fetchNamesInput"
          placeholder="One client per line — name, company name, or CRM record ID"
          rows="3"
          class="w-full text-[11px] bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-500 resize-none"
        ></textarea>

        <!-- By Date: look up first (free — one Airtable call, no AI cost), then choose
             exactly which leads to actually fetch. Never auto-fetches everyone found. -->
        <template v-else>
          <input v-if="!dateLookupDone" v-model="fetchDateInput" type="date"
                 class="w-full text-[11px] bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200" />
          <p v-if="!dateLookupDone" class="text-[9px] text-gray-500 mt-1">
            Look Up is free — it only lists who was created that day. Nothing is fetched (no AI cost) until you pick specific names below.
          </p>

          <div v-else>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] text-gray-400">{{ dateLookupResults.length }} found on {{ fetchDateInput }}</span>
              <div class="flex gap-2 text-[9px]">
                <button @click="setAllDateLeadsSelected(true)" class="text-cyan-400 hover:text-cyan-300">All</button>
                <button @click="setAllDateLeadsSelected(false)" class="text-gray-400 hover:text-gray-200">None</button>
                <button @click="dateLookupDone = false" class="text-gray-400 hover:text-gray-200">Change date</button>
              </div>
            </div>
            <div v-if="dateLookupResults.length === 0" class="text-[10px] text-gray-500">No leads found for that date.</div>
            <div v-else class="max-h-36 overflow-y-auto space-y-0.5 bg-gray-900 rounded p-1.5">
              <label v-for="lead in dateLookupResults" :key="lead.recordId"
                     class="flex items-center gap-1.5 text-[10px] text-gray-200 px-1 py-0.5 rounded hover:bg-gray-800 cursor-pointer">
                <input type="checkbox" v-model="lead.selected" class="accent-cyan-600" />
                <span v-if="fetchAllCompanies" class="text-[9px] px-1 rounded bg-gray-700 text-gray-300 flex-shrink-0">{{ lead.sourceLabel }}</span>
                <span class="truncate">{{ lead.label }}</span>
              </label>
            </div>
            <label class="flex items-center gap-1.5 text-[9px] text-amber-400/80 mt-1.5 cursor-pointer" title="Beta: skips re-looking up each selected lead, since Look Up already fetched their full data. Saves ~1 CRM API call per lead. Off by default.">
              <input type="checkbox" v-model="useCachedRecordsForFetch" class="accent-amber-500" />
              <span>⚡ Skip redundant re-lookup (beta — saves ~1 API call per lead)</span>
            </label>
          </div>
        </template>

        <div class="flex gap-1.5 mt-1.5">
          <button
            v-if="fetchMode === 'name'"
            @click="handleFetchLead"
            :disabled="!fetchNamesInput.trim()"
            class="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] py-1.5 rounded"
          >
            Fetch
          </button>
          <button
            v-else-if="!dateLookupDone"
            @click="handleDateLookup"
            :disabled="!fetchDateInput || dateLookupLoading"
            class="flex-1 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] py-1.5 rounded"
          >
            {{ dateLookupLoading ? 'Looking up…' : 'Look Up' }}
          </button>
          <button
            v-else
            @click="handleFetchLead"
            :disabled="!dateLookupResults.some((l) => l.selected)"
            class="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] py-1.5 rounded"
          >
            Fetch Selected ({{ dateLookupResults.filter((l) => l.selected).length }})
          </button>
          <button @click="showFetchPanel = false; fetchNamesInput = ''; fetchDateInput = ''; dateLookupDone = false"
                  class="px-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-[11px] rounded">
            Cancel
          </button>
        </div>
      </template>

      <!-- LIVE PROGRESS — one row per client, updates as each one finishes -->
      <template v-else>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] text-gray-400">
            {{ fetchListingMsg || `${fetchDoneCount} / ${fetchProgress.length || '?'} processed` }}
          </span>
          <button @click="handleCancelFetch"
                  class="text-[9px] px-2 py-0.5 rounded text-white"
                  :class="fetchRunning ? 'bg-red-700 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'">
            {{ fetchRunning ? 'Stop' : 'Close' }}
          </button>
        </div>
        <div v-if="fetchProgress.length" class="max-h-48 overflow-y-auto space-y-1 bg-gray-900 rounded p-1.5">
          <div v-for="(row, idx) in fetchProgress" :key="idx"
               class="flex items-center gap-1.5 text-[10px] px-1 py-0.5">
            <i v-if="row.status === 'pending'" class="fas fa-circle text-[6px] text-gray-600"></i>
            <i v-else-if="row.status === 'processing'" class="fas fa-spinner fa-spin text-cyan-400"></i>
            <i v-else-if="row.status === 'done'" class="fas fa-check text-green-400"></i>
            <i v-else-if="row.status === 'duplicate'" class="fas fa-clock-rotate-left text-amber-400"></i>
            <i v-else class="fas fa-xmark text-red-400"></i>
            <span class="flex-1 truncate" :class="row.status === 'pending' ? 'text-gray-600' : 'text-gray-200'">
              {{ row.label }}
            </span>
            <span v-if="row.status === 'failed'" class="text-red-400 text-[9px] truncate max-w-[100px]" :title="row.reason">
              {{ row.reason }}
            </span>
            <span v-else-if="row.status === 'duplicate'" class="text-amber-400 text-[9px] truncate max-w-[160px]"
                  :title="`Fetched ${formatDate(row.fetchedAt)} — today is ${formatDate(todayStr)}`">
              Already fetched {{ formatDate(row.fetchedAt) }} — {{ row.emailSent ? `email sent ${formatDate(row.emailSentAt)}` : 'email not sent yet' }}
            </span>
          </div>
        </div>
        <p class="text-[9px] text-gray-500 mt-1">
          ~20–90s per client, up to 150s before a slow one is auto-marked failed. Results already shown below are done — safe to close this panel or click Stop anytime; nothing already fetched is lost.
        </p>
      </template>
    </div>

    <!-- SAVED LEADS — local database (SQLite via db.js). Recall/edit any client that's
         ever been fetched without another CRM/Gemini call. Full version history:
         every Save creates a new version, all kept, any one can be reloaded. -->
    <div v-if="showSavedLeadsPanel" class="px-3 py-2.5 border-b border-gray-700 bg-gray-800/60">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
          Saved Leads ({{ savedLeadsQuery.trim() ? `${filteredSavedLeads.length} of ${savedLeads.length}` : savedLeads.length }})
        </span>
        <div class="flex items-center gap-2">
          <button @click="loadSavedLeadsList" :disabled="savedLeadsLoading" class="text-gray-400 hover:text-gray-200" title="Refresh">
            <i class="fas fa-rotate text-[10px]" :class="{ 'fa-spin': savedLeadsLoading }"></i>
          </button>
          <button @click="showSavedLeadsPanel = false" class="text-gray-500 hover:text-red-400">
            <i class="fas fa-times text-[10px]"></i>
          </button>
        </div>
      </div>

      <div v-if="savedLeads.length > 0" class="relative mb-1.5">
        <i class="fas fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-500"></i>
        <input
          v-model="savedLeadsQuery"
          type="text"
          placeholder="Search by name or email…"
          class="w-full bg-gray-900 border border-gray-700 rounded text-[10px] text-gray-200 placeholder-gray-500 pl-6 pr-6 py-1.5 focus:outline-none focus:border-cyan-500"
        />
        <button v-if="savedLeadsQuery" @click="savedLeadsQuery = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" title="Clear search">
          <i class="fas fa-times text-[9px]"></i>
        </button>
      </div>

      <p v-if="!savedLeadsLoading && savedLeads.length === 0" class="text-[10px] text-gray-500">
        Nothing saved yet — fetch a lead or click Save to start building this list.
      </p>
      <p v-else-if="!savedLeadsLoading && filteredSavedLeads.length === 0" class="text-[10px] text-gray-500">
        No saved leads match "{{ savedLeadsQuery }}".
      </p>

      <div v-else class="max-h-64 overflow-y-auto space-y-1">
        <div v-for="lead in filteredSavedLeads" :key="lead.id" class="bg-gray-900 rounded">
          <div class="flex items-center gap-2 px-2 py-1.5 text-[11px]">
            <button @click="handleLoadSavedLead(lead.id, 'latest')" class="flex-1 min-w-0 text-left text-gray-200 hover:text-white">
              <div class="truncate flex items-center gap-1.5">
                <span class="truncate">{{ lead.clientName }}<span v-if="lead.crmSourceAlias" class="text-gray-500"> ({{ lead.crmSourceAlias }})</span></span>
                <i v-if="lead.emailSentAt" class="fas fa-paper-plane text-[9px] text-emerald-400 flex-shrink-0" :title="sentTooltip({ emailSentAt: lead.emailSentAt, emailSentBy: lead.emailSentBy })"></i>
              </div>
              <div class="text-[9px] text-gray-500 truncate">{{ lead.contactEmail || 'no email' }} · v{{ lead.latestVersion }} · {{ formatSavedDate(lead.updatedAt) }}</div>
            </button>
            <button v-if="lead.versionCount > 1" @click="toggleVersionHistory(lead.id)"
                    class="text-gray-500 hover:text-cyan-400 text-[9px] px-1" title="Version history">
              <i class="fas fa-clock-rotate-left"></i> {{ lead.versionCount }}
            </button>
            <button @click="handleStopFollowUps(lead.id)" class="text-gray-500 hover:text-amber-400 px-1" title="Stop follow-up reminders for this client">
              <i class="fas fa-bell-slash text-[9px]"></i>
            </button>
            <button @click="handleDeleteSavedLead(lead.id)" class="text-gray-500 hover:text-red-400 px-1" title="Delete">
              <i class="fas fa-trash text-[9px]"></i>
            </button>
          </div>
          <div v-if="expandedLeadId === lead.id" class="px-2 pb-1.5 space-y-0.5">
            <button v-for="v in leadVersions" :key="v.version" @click="handleLoadSavedLead(lead.id, v.version)"
                    class="w-full flex items-center gap-1.5 text-[9px] text-left px-1.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400">
              <span class="text-cyan-400">v{{ v.version }}</span>
              <span class="flex-1 truncate">{{ v.label || v.source }}</span>
              <span>{{ formatSavedDate(v.createdAt) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- CLIENT QUEUE — visible after a batch import (migrate.py --batch-file / --since) -->
    <div v-if="proposalQueue.length" class="px-3 pt-2 pb-1 border-b border-gray-700">
      <div class="flex items-center justify-between mb-1.5 gap-2">
        <span class="text-[10px] uppercase tracking-wider text-gray-400 font-bold flex-shrink-0">
          Clients ({{ proposalQueue.length }})
        </span>
        <span
          class="text-[9px] font-bold tracking-wider flex-shrink-0"
          :class="queueSentCount === proposalQueue.length ? 'text-emerald-400' : 'text-gray-400'"
          :title="`${queueSentCount} emailed · ${proposalQueue.length - queueSentCount} still to send`"
        >
          {{ queueSentCount }} sent of {{ proposalQueue.length }}
        </span>
        <button @click="proposalStore.clearQueue()" class="text-[9px] text-gray-500 hover:text-red-400 flex-shrink-0" title="Clear batch">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="relative mb-1.5">
        <i class="fas fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-500 pointer-events-none"></i>
        <input
          v-model="queueSearch"
          type="text"
          placeholder="Search clients…"
          class="w-full bg-gray-800 border border-gray-700 rounded pl-6 pr-6 py-1 text-[11px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-teal-500"
        />
        <button
          v-if="queueSearch"
          @click="queueSearch = ''"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-500 hover:text-gray-200"
          title="Clear search"
        ><i class="fas fa-times"></i></button>
      </div>
      <div class="max-h-40 overflow-y-auto space-y-1">
        <button
          v-for="{ entry, idx } in filteredQueue"
          :key="idx"
          @click="selectQueueClient(idx)"
          :disabled="loadingQueueIndex !== -1"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[11px] transition-colors disabled:cursor-wait"
          :class="idx === activeQueueIndex ? 'bg-teal-700/40 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'"
        >
          <i v-if="loadingQueueIndex === idx" class="fas fa-circle-notch fa-spin text-teal-400 w-1.5 flex-shrink-0" title="Loading..."></i>
          <span
            v-else class="w-1.5 h-1.5 rounded-full flex-shrink-0" :class="queueStatusColor(entry.status)"
            :title="entry.status === 'sent' ? sentTooltip(entry) : entry.status"
          ></span>
          <span class="flex-1 truncate">{{ entry.clientName }}<span v-if="entry.crmSourceAlias" class="text-gray-500"> ({{ entry.crmSourceAlias }})</span></span>
          <span v-if="entry.status === 'sent'" class="text-emerald-400 flex-shrink-0" :title="sentTooltip(entry)">
            <i class="fas fa-paper-plane text-[9px]"></i>
          </span>
          <span
            v-if="queueEntryDateLabel(entry.fetchedAt)"
            class="text-[9px] flex-shrink-0"
            :class="isWeekendFetch(entry.fetchedAt) ? 'text-amber-400' : 'text-gray-500'"
            :title="isWeekendFetch(entry.fetchedAt) ? 'Fetched over the weekend — not yet emailed' : 'Fetch date'"
          >{{ queueEntryDateLabel(entry.fetchedAt) }}</span>
          <span v-if="entry.warnings.length" class="text-amber-400" title="Has warnings — verify before sending">
            <i class="fas fa-triangle-exclamation text-[9px]"></i>
          </span>
        </button>
        <p v-if="!filteredQueue.length" class="text-[10px] text-gray-500 text-center py-3">
          No clients match “{{ queueSearch }}”
        </p>
      </div>
    </div>

    <!-- Theme builder + field editors — part of the shared scroll region above now, this
         is just a padded content block, not its own scroll container. -->
    <div class="p-3">

      <!-- THEME BUILDER -->
      <div class="mb-4 rounded-lg border border-gray-700 overflow-hidden">
        <!-- Header -->
        <div class="bg-gradient-to-r from-gray-800 to-gray-900 px-3 py-2 flex items-center justify-between border-b border-gray-700">
          <h3 class="text-[10px] text-teal-400 font-bold uppercase flex items-center gap-1.5 tracking-wider">
            <i class="fas fa-palette"></i>Theme Builder
          </h3>
          <button @click="resetThemeColors" class="text-[8px] text-gray-500 hover:text-red-400 uppercase font-bold tracking-wider transition-colors flex items-center gap-1" title="Reset to default">
            <i class="fas fa-undo text-[7px]"></i>Reset
          </button>
        </div>

        <div class="p-2.5 bg-gray-800/50 space-y-3">
          <!-- Live Preview Swatch -->
          <div class="relative h-10 rounded-md overflow-hidden border border-gray-600/50 shadow-inner" :style="{ background: settings.themeBg }">
            <div class="absolute inset-0 flex items-center justify-center gap-3">
              <span class="text-[9px] font-bold tracking-wider" :style="{ color: settings.themeText }">TEXT</span>
              <span class="text-[9px] font-bold tracking-wider" :style="{ color: settings.accentColor }">ACCENT</span>
              <span class="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded" :style="{ color: settings.themeBg, backgroundColor: settings.accentColor }">BADGE</span>
            </div>
            <!-- Glow preview -->
            <div class="absolute inset-0 pointer-events-none" :style="{ boxShadow: `inset 0 0 30px ${glowPreviewColor}` }"></div>
          </div>

          <!-- Color Pickers 2x2 Grid -->
          <div class="grid grid-cols-2 gap-2">
            <!-- Background -->
            <div class="tb-color-cell">
              <label class="tb-label">Background</label>
              <div class="tb-swatch-wrap">
                <input type="color" v-model="settings.themeBg" class="tb-color-input" />
                <div class="tb-swatch" :style="{ backgroundColor: settings.themeBg }"></div>
              </div>
              <span class="tb-hex">{{ settings.themeBg }}</span>
            </div>
            <!-- Text -->
            <div class="tb-color-cell">
              <label class="tb-label">Text</label>
              <div class="tb-swatch-wrap">
                <input type="color" v-model="settings.themeText" class="tb-color-input" />
                <div class="tb-swatch" :style="{ backgroundColor: settings.themeText }"></div>
              </div>
              <span class="tb-hex">{{ settings.themeText }}</span>
            </div>
            <!-- Accent -->
            <div class="tb-color-cell">
              <label class="tb-label">Accent</label>
              <div class="tb-swatch-wrap">
                <input type="color" v-model="settings.accentColor" class="tb-color-input" />
                <div class="tb-swatch" :style="{ backgroundColor: settings.accentColor }"></div>
              </div>
              <span class="tb-hex">{{ settings.accentColor }}</span>
            </div>
            <!-- Glow -->
            <div class="tb-color-cell">
              <label class="tb-label">Glow</label>
              <div class="tb-swatch-wrap">
                <input type="color" v-model="settings.glowColor" class="tb-color-input" />
                <div class="tb-swatch" :style="{ backgroundColor: settings.glowColor, boxShadow: `0 0 8px ${settings.glowColor}` }"></div>
              </div>
              <span class="tb-hex">{{ settings.glowColor }}</span>
            </div>
          </div>

          <!-- Glow Intensity Slider -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="flex items-center gap-1.5 text-[8px] text-gray-400 uppercase font-bold tracking-wider cursor-pointer">
                <input type="checkbox" v-model="settings.glowEnabled" class="accent-teal-600" />
                Glow Intensity
              </label>
              <span class="text-[9px] font-mono text-teal-400">{{ settings.glowEnabled ? Math.round(settings.glowIntensity * 100) + '%' : 'Off' }}</span>
            </div>
            <input type="range" v-model.number="settings.glowIntensity" min="0" max="1" step="0.05" class="tb-slider" :disabled="!settings.glowEnabled" :class="{ 'opacity-40': !settings.glowEnabled }" />
          </div>
        </div>
      </div>

      <!-- Global Fields -->
      <div class="mb-4">
        <label class="text-[10px] text-gray-400 uppercase font-bold mb-1 block">Client Name</label>
        <input v-model="clientName" class="input-compact" placeholder="Enter client name" />
      </div>

      <div class="mb-4">
        <label class="text-[10px] text-gray-400 uppercase font-bold mb-1 block">Contact Email</label>
        <input v-model="contactEmail" type="email" class="input-compact" placeholder="client@email.com" />
      </div>

      <div class="border-t border-gray-700 pt-3 mb-3"></div>

      <!-- Current Page Settings -->
      <transition name="fade" mode="out-in">
        <div :key="currentPageIndex">
          <!-- Page Header with Delete -->
          <div class="flex justify-between items-center mb-3">
            <h3 class="text-xs text-teal-400 font-bold uppercase flex items-center gap-1">
              <i class="fas fa-edit"></i>Page {{ currentPageIndex + 1 }} Details
            </h3>
            <button v-if="pages.length > 1" @click="removePage(currentPageIndex)" class="text-red-400 hover:text-red-300 text-[10px]">
              <i class="fas fa-trash mr-1"></i>Delete
            </button>
          </div>

          <!-- Sign Type with Copy -->
          <div class="mb-2">
            <label class="label-mini">Sign Type</label>
            <div class="flex gap-1">
              <input v-model="currentPage.signType" class="input-compact flex-1" placeholder="e.g. 3D Metal Backlit" />
              <button @click="copyField('signType')" class="copy-mini" title="Copy to all pages">
                <i class="fas fa-copy"></i>
              </button>
            </div>
          </div>

          <!-- 2-Column Grid -->
          <div class="grid grid-cols-2 gap-1 mb-2">
            <div>
              <label class="label-mini">Usage</label>
              <div class="flex gap-1">
                <input v-model="currentPage.usage" class="input-compact flex-1 text-xs" />
                <button @click="copyField('usage')" class="copy-micro"><i class="fas fa-copy text-[8px]"></i></button>
              </div>
            </div>
            <div>
              <label class="label-mini">Finish</label>
              <div class="flex gap-1">
                <input v-model="currentPage.finish" class="input-compact flex-1 text-xs" />
                <button @click="copyField('finish')" class="copy-micro"><i class="fas fa-copy text-[8px]"></i></button>
              </div>
            </div>
            <div>
              <label class="label-mini">Illuminated</label>
              <div class="flex gap-1">
                <input v-model="currentPage.illuminated" class="input-compact flex-1 text-xs" />
                <button @click="copyField('illuminated')" class="copy-micro"><i class="fas fa-copy text-[8px]"></i></button>
              </div>
            </div>
            <div>
              <label class="label-mini">UL Cert</label>
              <div class="flex gap-1">
                <input v-model="currentPage.ulCert" class="input-compact flex-1 text-xs" />
                <button @click="copyField('ulCert')" class="copy-micro"><i class="fas fa-copy text-[8px]"></i></button>
              </div>
            </div>
            <div>
              <label class="label-mini">Permit</label>
              <div class="flex gap-1">
                <input v-model="currentPage.permit" class="input-compact flex-1 text-xs" />
                <button @click="copyField('permit')" class="copy-micro"><i class="fas fa-copy text-[8px]"></i></button>
              </div>
            </div>
            <div>
              <label class="label-mini">Install</label>
              <div class="flex gap-1">
                <input v-model="currentPage.install" class="input-compact flex-1 text-xs" />
                <button @click="copyField('install')" class="copy-micro"><i class="fas fa-copy text-[8px]"></i></button>
              </div>
            </div>
          </div>

          <!-- Pricing -->
          <div class="mb-3">
            <div class="flex justify-between items-center mb-1">
              <label class="label-mini mb-0">Pricing</label>
              <button @click="copyPricing" class="copy-mini"><i class="fas fa-copy"></i></button>
            </div>
            <div v-for="(p, pIdx) in currentPage.pricing" :key="pIdx" class="flex gap-1 mb-1">
              <input v-model="p.size" class="input-compact text-xs w-1/5" placeholder="Lg" />
              <input v-model="p.dim" class="input-compact text-xs w-2/5" placeholder="60x30" />
              <input v-model="p.cost" class="input-compact text-xs w-1/5 text-right" placeholder="$" />
              <input v-model.number="p.quantity" type="number" min="1" class="input-compact text-xs w-1/5 text-right" placeholder="Qty" title="Quantity" />
            </div>
          </div>

          <!-- Payment Link -->
          <div class="mb-3">
            <label class="label-mini">Payment Link</label>
            <input
              v-model="currentPage.paymentLink"
              class="input-compact text-xs w-full"
              placeholder="Paste your Stripe/payment link here"
            />
            <p class="text-[9px] text-gray-500 mt-0.5">Pasted here, not generated — this becomes the clickable price and the "Pay Now" button in the exported/emailed PDF. Leave blank to keep the PDF non-clickable.</p>
          </div>

          <!-- Visual Settings -->
          <div class="grid grid-cols-2 gap-1 mb-3">
            <div>
              <label class="label-mini">Layout Mode</label>
              <select v-model="currentPage.layoutMode" class="input-compact text-xs">
                <option value="standard">Standard</option>
                <option value="wide">Wide Images</option>
              </select>
            </div>
            <div>
              <label class="label-mini">Glow Color</label>
              <input type="color" v-model="currentPage.glowColor" class="w-full h-[26px] bg-gray-700 border border-gray-600 rounded cursor-pointer" />
            </div>
          </div>

          <!-- Images -->
          <div class="mb-3">
            <div class="flex justify-between items-center mb-1">
              <label class="label-mini mb-0 text-teal-300">Images</label>
              <button @click="copyAssets" class="copy-mini"><i class="fas fa-copy"></i></button>
            </div>
            
            <div v-for="(asset, aIdx) in currentPage.assets" :key="aIdx" class="bg-gray-800 border border-gray-700 rounded p-2 mb-1">
              <div class="flex justify-between items-center mb-1">
                <span class="text-[9px] text-gray-500">#{{ aIdx + 1 }}</span>
                <button @click="removeAsset(currentPageIndex, aIdx)" class="text-red-400 hover:text-red-200 text-[9px]">Remove</button>
              </div>
              <div class="grid grid-cols-2 gap-1 mb-1">
                <select v-model="asset.style" class="input-compact text-[10px]">
                  <option value="drawing">Drawing</option>
                  <option value="mockup">Mockup</option>
                </select>
                <input v-model="asset.label" class="input-compact text-[10px]" placeholder="Label" />
              </div>
              <input type="file" accept="image/*,video/*" @change="(e) => handleUpload(e, currentPageIndex, aIdx)" class="file-input-compact" />
            </div>

            <button @click="addAsset(currentPageIndex)" class="w-full bg-gray-800 border border-dashed border-gray-600 text-teal-400 py-1.5 rounded text-[10px] hover:border-teal-500 transition-colors">
              <i class="fas fa-plus mr-1"></i>Add Image
            </button>
          </div>

          <!-- Page Actions -->
          <button @click="duplicatePage" class="w-full bg-gray-700 hover:bg-gray-600 text-white py-1.5 rounded text-[10px] transition-colors">
            <i class="fas fa-clone mr-1"></i>Duplicate Page
          </button>
        </div>
      </transition>

      <div class="border-t border-gray-700 my-3"></div>

      <!-- Footer Text -->
      <div class="mb-3">
        <label class="label-mini text-gray-400">Instructions</label>
        <input v-model="footer.instruction1" class="input-compact text-[10px] mb-1" placeholder="Instruction 1" />
        <input v-model="footer.instruction2" class="input-compact text-[10px] mb-1" placeholder="Instruction 2" />
        <input v-model="footer.instruction3" class="input-compact text-[10px] mb-1" placeholder="Instruction 3" />
      </div>

      <div class="mb-3">
        <label class="label-mini">Delivery</label>
        <input v-model="footer.delivery" class="input-compact text-xs" placeholder="e.g. 10-14 business days" />
      </div>

      <div class="mb-3">
        <label class="label-mini">Note</label>
      <textarea v-model="footer.note" class="input-compact text-xs h-12 resize-none" placeholder="Additional notes..."></textarea>
      </div>

      <div class="border-t border-gray-700 my-3"></div>

      <!-- Company Selector -->
      <CompanySelector />

    </div>
    </div>
    <!-- /scroll region -->

    <!-- Bulk Actions Menu -->
    <BulkActionsMenu :is-open="showBulkActions" @close="showBulkActions = false" @action="handleBulkAction" />

  </aside>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useProposalStore } from '@/stores/proposalStore'
import { useAuthStore } from '@/stores/authStore'
import { usePageSync } from '@/composables/usePageSync'
import { useCopyToAll } from '@/composables/useCopyToAll'
import { showToast, confirmAction } from '@/utils/toast'
import { matchCrossSection } from '@/utils/crossSectionMatcher'
import BulkActionsMenu from './BulkActionsMenu.vue'
import CompanySelector from './CompanySelector.vue'

const props = defineProps({
  open: { type: Boolean, default: true }
})

const emit = defineEmits(['update:open', 'save-pdf', 'create-payment', 'send-email', 'update:theme'])

const proposalStore = useProposalStore()
const authStore = useAuthStore()
const router = useRouter()
const { pages, settings, clientName, contactEmail, footer, currentTheme, pageSize, proposalQueue, activeQueueIndex } = storeToRefs(proposalStore)

const handleLogout = async () => {
  await authStore.signOut()
  router.push({ name: 'login' })
}

// If today's automated fetch already ran and nothing's in the review queue yet (a fresh
// Extraction-quality warnings (low-confidence image matches, specs guessed from a
// mockup filename, etc.) used to fire one full-text toast each — with several warnings
// on one client that meant multiple giant banners stacking up and covering the screen.
// They're logged here instead; a single short toast just points at the log.
let warningLogId = 0
const warningLog = ref([]) // [{ id, clientLabel, message, ts }]
const showWarningLog = ref(false)
const unreadWarningCount = ref(0)
const logWarnings = (clientLabel, warnings) => {
  if (!warnings || warnings.length === 0) return
  warnings.forEach((w) => {
    // importProposal already normalizes to {message, pageIndex, fields}, but this also
    // gets called with raw pre-normalized arrays from a couple of older call sites below
    // (import-file, batch-fetch stream) — handled the same way here rather than requiring
    // every caller to normalize first.
    const message = typeof w === 'string' ? w : w.message
    const pageIndex = typeof w === 'object' ? (w.pageIndex ?? null) : null
    warningLog.value.unshift({ id: ++warningLogId, clientLabel, message, pageIndex, ts: Date.now() })
  })
  unreadWarningCount.value += warnings.length
  showToast(`${warnings.length} warning${warnings.length > 1 ? 's' : ''} for ${clientLabel} — check the log`, 'warning', 6000)
}
const jumpToWarning = (entry) => {
  if (entry.pageIndex == null) return
  scrollToPage(entry.pageIndex)
  showWarningLog.value = false
}
const clearWarningLog = () => {
  warningLog.value = []
  unreadWarningCount.value = 0
}
const toggleWarningLog = () => {
  showWarningLog.value = !showWarningLog.value
  if (showWarningLog.value) unreadWarningCount.value = 0
}

// session — don't clobber an employee's in-progress work if the queue already has
// something in it), load it automatically so opening the app means "review and send",
// not "go find the Dashboard and click Load."
onMounted(async () => {
  if (proposalQueue.value.length > 0) return
  try {
    // Confirmed live as a real gap: inferring "the relevant date" from which batch_id most
    // recently appeared in the DB silently breaks the moment a run finds only
    // already-fetched/no-PDF leads — a completely normal outcome, not a failure — since
    // that saves zero new rows and so never creates a batch_id at all. /api/last-fetch-date
    // reads the status file written after EVERY run regardless of how many leads were
    // saved, so it's the one reliable source for "what date did the system just look at."
    // Falls back to the old batch-inference only if that file has never been written at
    // all (a fresh install with no automated run yet).
    let targetDate = await fetch('/api/last-fetch-date').then((r) => r.json()).then((d) => d.date).catch(() => null)
    let latestBatchCreatedAt = null

    if (!targetDate) {
      const response = await fetch('/api/leads/batches')
      const result = await response.json()
      if (!response.ok) return
      const latestBatch = result.batches?.find((b) => b.isAutomated)
      if (!latestBatch) return
      targetDate = latestBatch.batchId.match(/^daily-(\d{4}-\d{2}-\d{2})-/)?.[1] || null
      latestBatchCreatedAt = latestBatch.createdAt
      if (!targetDate) {
        // No parseable date anywhere — last resort, load this one specific batch directly.
        const previewRes = await fetch(`/api/leads/batches/${encodeURIComponent(latestBatch.batchId)}/queue-preview`)
        const previewResult = await previewRes.json()
        if (!previewRes.ok) return
        proposalStore.importBatch(previewResult.leads)
        showToast(`The latest automated fetch is ready — ${previewResult.leads.length} client(s) to review`, 'success', 6000)
        return
      }
    }

    // A target date can span more than one batch run — the original automated fetch plus
    // any later manual/recovery re-run for the same date (e.g. a source that failed the
    // first time and got re-pulled, or today's run finding nothing new but confirming
    // everything already fetched). Loading by DATE instead of by one batchId means every
    // one of those runs shows up together automatically.
    const previewRes = await fetch(`/api/leads/by-date/${targetDate}/queue-preview`)
    const previewResult = await previewRes.json()
    if (!previewRes.ok) return
    proposalStore.importBatch(previewResult.leads)
    const referenceDate = latestBatchCreatedAt ? new Date(latestBatchCreatedAt) : new Date(`${targetDate}T12:00:00`)
    const isToday = referenceDate.toDateString() === new Date().toDateString()
    const when = isToday ? "Today's" : targetDate
    showToast(`${when} automated fetch is ready — ${previewResult.leads.length} client(s) to review`, 'success', 6000)
  } catch {
    // Best-effort — a failed auto-load just means the employee uses Fetch/Dashboard manually, same as today.
  }
})

const { currentPageIndex, currentPage, scrollToPage } = usePageSync(pages)
const { copyFieldToAll, copyPricingToAll, copyAssetsToAll } = useCopyToAll(pages, currentPageIndex)

const showBulkActions = ref(false)

// Button Click States
const hasClickedPay = ref(false)
const hasClickedEmail = ref(false)
const hasClickedPDF = ref(false)

// Import a migrated proposal JSON (produced by the lead-import script)
const importInput = ref(null)

const handleImportFile = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())

    if (Array.isArray(parsed)) {
      // A batch file from migrate.py --batch-file / --since: load into the review queue
      // and open the first client rather than dumping every client into the editor at once.
      const { count } = proposalStore.importBatch(parsed)
      showToast(`Loaded batch of ${count} client(s) — click a name below to review`, 'success', 6000)
      if (count > 0) {
        await proposalStore.loadFromQueue(0)
        scrollToPage(0)
      }
    } else {
      const result = proposalStore.importProposal(parsed)
      scrollToPage(0)
      const bits = [`Imported ${result.pageCount} page(s)`]
      if (result.revisionUsed !== null) bits.push(`revision ${result.revisionUsed}`)
      if (result.specsFrom) bits.push(`specs: ${result.specsFrom}`)
      showToast(bits.join(' — '), 'success', 5000)
      logWarnings(parsed.clientName || 'Imported client', result.warnings)
    }
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error', 6000)
  } finally {
    event.target.value = ''
  }
}

const loadingQueueIndex = ref(-1)

// Client-queue search + "N sent of M" progress. filteredQueue keeps each entry's
// ORIGINAL index so selectQueueClient / activeQueueIndex still line up after filtering.
const queueSearch = ref('')
const queueSentCount = computed(() => proposalQueue.value.filter((e) => e.status === 'sent').length)
const filteredQueue = computed(() => {
  const withIdx = proposalQueue.value.map((entry, idx) => ({ entry, idx }))
  const q = queueSearch.value.trim().toLowerCase()
  if (!q) return withIdx
  return withIdx.filter(({ entry }) =>
    (entry.clientName || '').toLowerCase().includes(q) ||
    (entry.crmSourceAlias || '').toLowerCase().includes(q)
  )
})

const selectQueueClient = async (index) => {
  loadingQueueIndex.value = index
  try {
    const result = await proposalStore.loadFromQueue(index)
    if (!result) return
    hasClickedPay.value = false
    hasClickedEmail.value = proposalStore.proposalQueue[index].status === 'sent'
    hasClickedPDF.value = false
    scrollToPage(0)
    const bits = []
    if (result.revisionUsed !== null) bits.push(`revision ${result.revisionUsed}`)
    if (result.specsFrom) bits.push(`specs: ${result.specsFrom}`)
    showToast(`Loaded ${proposalStore.proposalQueue[index].clientName}${bits.length ? ' — ' + bits.join(' — ') : ''}`, 'success', 4000)
    logWarnings(proposalStore.proposalQueue[index].clientName, result.warnings)
  } finally {
    loadingQueueIndex.value = -1
  }
}

const queueStatusColor = (status) => ({
  pending: 'bg-gray-500',
  reviewed: 'bg-blue-400',
  sent: 'bg-green-400'
})[status] || 'bg-gray-500'

// Nobody emails clients on Saturday/Sunday, so a weekend auto-fetch just sits in the
// queue until Monday — this label (and the amber tint below) is what lets a reviewer
// spot those at a glance instead of them blending into the fresh Monday batch.
const queueEntryDateLabel = (fetchedAt) => {
  if (!fetchedAt) return ''
  const d = new Date(fetchedAt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const isWeekendFetch = (fetchedAt) => {
  if (!fetchedAt) return false
  const day = new Date(fetchedAt).getDay()
  return day === 0 || day === 6
}

// Everyone shares one login across separate devices, so "who sent this" only exists as
// a browser/OS label + timestamp (see server.js's friendlyDeviceLabel) — this is the one
// place that combines them into what a coworker actually needs to read at a glance.
const sentTooltip = (entry) => {
  if (!entry.emailSentAt) return 'Sent'
  const when = new Date(entry.emailSentAt).toLocaleString()
  return entry.emailSentBy ? `Sent by ${entry.emailSentBy} — ${when}` : `Sent — ${when}`
}

// Fetch directly from the CRM — no terminal, no manual file upload.
// Hits the local server, which runs migrate.py as a subprocess (one Gemini call per client).
const showFetchPanel = ref(false)
const fetchMode = ref('name') // 'name' | 'date'
const fetchNamesInput = ref('')
const fetchDateInput = ref('')

// By Date never auto-fetches everyone found — Look Up is a free, separate lookup
// (one Airtable call, zero AI cost); the operator then picks exactly who to fetch.
const dateLookupLoading = ref(false)
const dateLookupDone = ref(false)
const dateLookupResults = ref([]) // [{ label, recordId, selected, sourceId?, sourceLabel? }] — no raw record; see listRecordCache server-side
// Opt-in only, defaults off — see handleFetchLead. Flip this on to test the fast path;
// leave it off and every fetch behaves exactly as it does today.
const useCachedRecordsForFetch = ref(false)
// Opt-in — one merged Look Up across every configured CRM source instead of picking one.
// Airtable has no true single-call cross-base query, so this is N list-only calls (one
// per source, run concurrently server-side) presented as one unified result.
const fetchAllCompanies = ref(false)
const setAllDateLeadsSelected = (value) => {
  dateLookupResults.value.forEach((l) => { l.selected = value })
}
const handleDateLookup = async () => {
  dateLookupLoading.value = true
  try {
    const url = fetchAllCompanies.value
      ? `/api/crm-leads-for-date-all?date=${fetchDateInput.value}`
      : `/api/crm-leads-for-date?date=${fetchDateInput.value}&source=${fetchSource.value}`
    const response = await fetch(url)
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Look up failed')
    dateLookupResults.value = result.leads.map((l) => ({ ...l, selected: false }))
    dateLookupDone.value = true
  } catch (err) {
    showToast(`Look up failed: ${err.message}`, 'error', 6000)
  } finally {
    dateLookupLoading.value = false
  }
}

// Which CRM source to pull from (multiple brands, separate Airtable bases behind
// the scenes — see CRM_SOURCE_<n>_* in .env). Labels come from the server, which
// reads them from .env, so no brand name ever appears in this file.
const crmSources = ref([]) // [{ id, label }]
const fetchSource = ref('1')
const loadCrmSources = async () => {
  try {
    const response = await fetch('/api/crm-sources')
    const result = await response.json()
    if (response.ok && result.sources?.length) {
      crmSources.value = result.sources
      if (!result.sources.some((s) => s.id === fetchSource.value)) {
        fetchSource.value = result.sources[0].id
      }
    }
  } catch {
    // Silently keep single-source behavior if this fails — Fetch still works with the default.
  }
}
const toggleFetchPanel = () => {
  showFetchPanel.value = !showFetchPanel.value
  if (showFetchPanel.value && crmSources.value.length === 0) loadCrmSources()
}

// Live per-client progress while a fetch is streaming. fetchLoading controls which
// half of the panel shows (input form vs progress list); fetchRunning tracks whether
// the stream is still active (false once complete/failed/cancelled, but the results
// stay visible until the user dismisses the panel).
const fetchLoading = ref(false)
const fetchRunning = ref(false)
const fetchProgress = ref([]) // [{ label, status: pending|processing|done|failed|duplicate, reason }]
const fetchListingMsg = ref('')
const fetchDoneCount = computed(() => fetchProgress.value.filter((r) => r.status === 'done' || r.status === 'failed' || r.status === 'duplicate').length)
const fetchAbortController = ref(null)
const todayStr = new Date().toISOString().slice(0, 10)
const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

const handleCancelFetch = () => {
  if (fetchRunning.value) {
    fetchAbortController.value?.abort()
  } else {
    // Not running anymore (complete/failed) — this click just dismisses the panel.
    fetchLoading.value = false
    fetchProgress.value = []
  }
}

// Runs ONE /api/migrate-lead streaming request and folds its events into the shared
// fetchProgress list, offset by baseIndex — lets multiple source-groups (see
// handleFetchLead's "all companies" path) share one combined progress list instead of
// each group's stream overwriting the last. Returns { succeeded, failed, cancelled }.
const runFetchStream = async ({ names, useCache, source, controller, baseIndex, trustServerLabels, batchId, date }) => {
  let succeeded = 0
  let failed = 0
  let duplicate = 0
  let cancelled = false

  const response = await fetch('/api/migrate-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // useCache tells the server to reuse the record it already cached from Look Up
    // (keyed by recordId) instead of the browser echoing raw CRM data back — that raw
    // record carries real, unaliased brand info in its own fields, so it never round-trips.
    // batchId ties every lead from this one user action together (see server.js's
    // archiveAndStripImages / batch-history endpoints), even across the several requests
    // "Fetch All Companies" sends — one per source.
    body: JSON.stringify({ names, source, useCache: !!useCache, batchId, date }),
    signal: controller.signal
  })

  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result.details || result.error || `HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // last (possibly incomplete) line stays in the buffer

    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line)

      if (event.type === 'listing') {
        fetchListingMsg.value = event.message
      } else if (event.type === 'listed') {
        fetchListingMsg.value = ''
        // Single-group calls trust the server's labels wholesale; multi-group calls
        // already pre-populated fetchProgress from dateLookupResults, so skip this.
        if (trustServerLabels) {
          fetchProgress.value = event.labels.map((l) => ({ label: l, status: 'pending' }))
        }
      } else if (event.type === 'processing') {
        fetchListingMsg.value = ''
        if (fetchProgress.value[baseIndex + event.index]) fetchProgress.value[baseIndex + event.index].status = 'processing'
      } else if (event.type === 'done') {
        fetchProgress.value[baseIndex + event.index] = { label: event.label, status: 'done' }
        succeeded++
        const idx = proposalStore.pushToQueue(event.payload, event.saved)
        if (fetchFirstDoneQueueIndex.value === null) fetchFirstDoneQueueIndex.value = idx
        logWarnings(event.label, event.payload?._source?.warnings || [])
      } else if (event.type === 'failed') {
        fetchProgress.value[baseIndex + event.index] = { label: event.label, status: 'failed', reason: event.reason }
        failed++
      } else if (event.type === 'duplicate') {
        // Server already found this crmRecordId saved from an earlier fetch (e.g. the
        // date-gap window shifted and now covers a day it already covered before) and
        // skipped redoing the CRM+Gemini work — show what's already known about it
        // instead of a plain done/failed icon.
        fetchProgress.value[baseIndex + event.index] = {
          label: event.label,
          status: 'duplicate',
          fetchedAt: event.fetchedAt,
          emailSent: event.emailSent,
          emailSentAt: event.emailSentAt
        }
        duplicate++
      } else if (event.type === 'complete') {
        cancelled = !!event.cancelled
      } else if (event.type === 'fatal') {
        throw new Error(event.error)
      }
    }
  }

  return { succeeded, failed, duplicate, cancelled }
}

const fetchFirstDoneQueueIndex = ref(null)

const handleFetchLead = async () => {
  const isDateMode = fetchMode.value === 'date'
  // In date mode, only the leads the operator explicitly checked get fetched — never
  // "everyone found on that date." Fetching by name from here uses their record IDs.
  const selectedDateLeads = isDateMode ? dateLookupResults.value.filter((l) => l.selected) : []
  const names = isDateMode
    ? selectedDateLeads.map((l) => l.recordId)
    : fetchNamesInput.value.split('\n').map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) return

  // Opt-in fast path (By Date only): the list step already caused the server to cache
  // each lead's record, so tell it to reuse that instead of re-resolving via the CRM —
  // OFF by default so today's exact behavior is unaffected until this is toggled on.
  const useCache = isDateMode && useCachedRecordsForFetch.value
  // One id for every lead from this click, even when "All companies" splits it into
  // several requests — lets the batch-history view show them as one fetch, not several.
  const batchId = crypto.randomUUID()

  fetchLoading.value = true
  fetchRunning.value = true
  fetchProgress.value = isDateMode
    ? selectedDateLeads.map((l) => ({ label: l.label, status: 'pending' }))
    : names.map((n) => ({ label: n, status: 'pending' }))
  fetchListingMsg.value = ''
  fetchFirstDoneQueueIndex.value = null
  const controller = new AbortController()
  fetchAbortController.value = controller

  let succeeded = 0
  let failed = 0
  let duplicate = 0
  let cancelled = false

  try {
    // Mixed-source picks (from "All companies" Look Up) need one request PER source —
    // each Airtable base needs its own --source flag — run sequentially, sharing one
    // progress list via baseIndex offsets rather than each request resetting it.
    if (isDateMode && fetchAllCompanies.value) {
      const bySource = new Map()
      selectedDateLeads.forEach((l, i) => {
        const key = l.sourceId || fetchSource.value
        if (!bySource.has(key)) bySource.set(key, [])
        bySource.get(key).push({ lead: l, progressIndex: i })
      })
      let baseIndex = 0
      for (const [sourceId, group] of bySource) {
        if (cancelled) break
        const groupNames = group.map((g) => g.lead.recordId)
        const result = await runFetchStream({ names: groupNames, useCache, source: sourceId, controller, baseIndex, trustServerLabels: false, batchId, date: isDateMode ? fetchDateInput.value : undefined })
        succeeded += result.succeeded
        failed += result.failed
        duplicate += result.duplicate
        cancelled = result.cancelled
        baseIndex += group.length
      }
    } else {
      const result = await runFetchStream({ names, useCache, source: fetchSource.value, controller, baseIndex: 0, trustServerLabels: true, batchId, date: isDateMode ? fetchDateInput.value : undefined })
      succeeded = result.succeeded
      failed = result.failed
      duplicate = result.duplicate
      cancelled = result.cancelled
    }

    if (succeeded > 0 && fetchFirstDoneQueueIndex.value !== null) {
      selectQueueClient(fetchFirstDoneQueueIndex.value)
    }
    if (cancelled) {
      showToast(`Stopped — ${succeeded} client(s) fetched before cancelling`, 'success', 6000)
    } else if (succeeded === 0 && failed === 0 && duplicate === 0) {
      showToast('No leads found.', 'error', 6000)
    } else {
      showToast(`${succeeded} fetched${duplicate ? `, ${duplicate} already fetched before` : ''}${failed ? `, ${failed} failed — check the list for why` : ''}`,
                failed ? 'error' : 'success', 6000)
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast(`Stopped — ${succeeded} client(s) fetched before cancelling`, 'success', 6000)
    } else {
      showToast(`Fetch failed: ${err.message}`, 'error', 8000)
    }
  } finally {
    fetchRunning.value = false
    fetchAbortController.value = null
  }
}

const isPresetChanging = ref(false)

// Watch user arbitrary color changes to break out of CSS presets
watch(() => settings.value.themeBg, (newVal) => {
  if (isPresetChanging.value) return
  emit('update:theme', 'theme-custom')
})
watch(() => settings.value.themeText, (newVal) => {
  if (isPresetChanging.value) return
  emit('update:theme', 'theme-custom')
})

const hexToRgba = (hex, alpha) => {
  if (!hex) return 'transparent'
  const color = parseInt(hex.substring(1), 16)
  if (isNaN(color)) return 'transparent'
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const glowPreviewColor = computed(() => {
  return hexToRgba(settings.value.glowColor, settings.value.glowIntensity)
})

const resetThemeColors = () => {
  settings.value.themeBg = '#050505'
  settings.value.themeText = '#e2e8f0'
  settings.value.accentColor = '#00f3ff'
  settings.value.glowColor = '#00f3ff'
  settings.value.glowIntensity = 0.4
  applyThemePreset('theme-pro')
}

// Button preview colors — must match applyThemePreset's values exactly below (the swatch
// is a promise about what clicking it does; a mismatched preview is worse than none).
const THEME_PRESETS = [
  { id: 'theme-navy', label: 'Navy', bg: '#0f1a2e', accent: '#eab308', mutedText: '#64748b' },
  { id: 'theme-gray', label: 'Onyx', bg: '#0a0a0a', accent: '#34d399', mutedText: '#71717a' },
  { id: 'theme-light', label: 'Light', bg: '#fefdfb', accent: '#0d9488', mutedText: '#a8a29e' },
  { id: 'theme-pro', label: 'Pro', bg: '#050505', accent: '#00f3ff', mutedText: '#52525b' },
  { id: 'theme-graphite', label: 'Graphite', bg: '#1c1917', accent: '#f97316', mutedText: '#78716c' },
  { id: 'theme-emerald', label: 'Emerald', bg: '#0a1410', accent: '#10b981', mutedText: '#4b5f56' },
  { id: 'theme-burgundy', label: 'Burgundy', bg: '#fdf8f6', accent: '#9f1239', mutedText: '#b3a19e' }
]

// Seven palettes — the original four refined (Onyx's "accent" used to just be flat gray,
// which is why it looked unfinished — every theme now gets a real accent hue) plus three
// new options for different client positioning. Reviewed as a visual comparison before
// landing here — see the theme gallery artifact from that conversation.
const applyThemePreset = (themeName) => {
  isPresetChanging.value = true
  emit('update:theme', themeName)
  switch (themeName) {
    case 'theme-navy': // deep navy + gold
      settings.value.themeBg = '#0f1a2e'
      settings.value.themeText = '#f1f5f9'
      settings.value.accentColor = '#eab308'
      settings.value.glowColor = '#eab308'
      settings.value.glowIntensity = 0.35
      break
    case 'theme-gray': // Onyx — black + emerald
      settings.value.themeBg = '#0a0a0a'
      settings.value.themeText = '#f5f5f4'
      settings.value.accentColor = '#34d399'
      settings.value.glowColor = '#34d399'
      settings.value.glowIntensity = 0.3
      break
    case 'theme-light': // warm ivory + deep teal
      settings.value.themeBg = '#fefdfb'
      settings.value.themeText = '#1c1917'
      settings.value.accentColor = '#0d9488'
      settings.value.glowColor = '#0d9488'
      settings.value.glowIntensity = 0.12
      break
    case 'theme-pro': // signature near-black + cyan (unchanged — this is the app's own brand identity)
      settings.value.themeBg = '#050505'
      settings.value.themeText = '#e2e8f0'
      settings.value.accentColor = '#00f3ff'
      settings.value.glowColor = '#00f3ff'
      settings.value.glowIntensity = 0.4
      break
    case 'theme-graphite': // Graphite & Copper — industrial/modern
      settings.value.themeBg = '#1c1917'
      settings.value.themeText = '#fafaf9'
      settings.value.accentColor = '#f97316'
      settings.value.glowColor = '#f97316'
      settings.value.glowIntensity = 0.35
      break
    case 'theme-emerald': // Midnight Emerald — jewel-tone
      settings.value.themeBg = '#0a1410'
      settings.value.themeText = '#ecfdf5'
      settings.value.accentColor = '#10b981'
      settings.value.glowColor = '#10b981'
      settings.value.glowIntensity = 0.35
      break
    case 'theme-burgundy': // Ivory & Burgundy — upscale/boutique, light
      settings.value.themeBg = '#fdf8f6'
      settings.value.themeText = '#2d1b1a'
      settings.value.accentColor = '#9f1239'
      settings.value.glowColor = '#9f1239'
      settings.value.glowIntensity = 0.1
      break
  }
  setTimeout(() => isPresetChanging.value = false, 50)
}

const handlePayClick = () => {
  hasClickedPay.value = true
  emit('create-payment')
}

const handleEmailClick = () => {
  hasClickedEmail.value = true
  if (activeQueueIndex.value >= 0) {
    proposalStore.markQueueStatus(activeQueueIndex.value, 'sent')
  }
  emit('send-email')
}

const handlePDFClick = () => {
  hasClickedPDF.value = true
  emit('save-pdf', pageSize.value)
}

const addPage = () => {
  proposalStore.addPage()
  showToast('New page added!', 'success')
}

const removePage = async (index) => {
  if (pages.value.length === 1) {
    showToast('Cannot delete the last page', 'warning')
    return
  }
  const confirmed = await confirmAction(`Delete page ${index + 1}?`, 'Delete')
  if (confirmed) {
    proposalStore.removePage(index)
    showToast('Page deleted', 'success')
  }
}

const duplicatePage = async () => {
  const confirmed = await confirmAction(`Duplicate page ${currentPageIndex.value + 1}?`, 'Duplicate')
  if (confirmed) {
    const pageCopy = JSON.parse(JSON.stringify(currentPage.value))
    const insertAt = currentPageIndex.value + 1
    pages.value.splice(insertAt, 0, pageCopy)
    scrollToPage(insertAt)
    showToast('Page duplicated!', 'success')
  }
}

const addAsset = (pageIndex) => proposalStore.addAsset(pageIndex)
const removeAsset = (pageIndex, assetIndex) => proposalStore.removeAsset(pageIndex, assetIndex)

const handleUpload = (event, pageIndex, assetIndex) => {
  const file = event.target.files[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  const mediaType = file.type.startsWith('video/') ? 'video' : 'image'
  proposalStore.setAssetImage(pageIndex, assetIndex, url, mediaType)
  showToast('Image uploaded!', 'success')
}

const copyField = async (fieldName) => await copyFieldToAll(fieldName)
const copyPricing = async () => await copyPricingToAll()
const copyAssets = async () => await copyAssetsToAll()

const handleBulkAction = async (action) => {
  // Handle bulk actions
}

// SAVED LEADS — local database (db.js/SQLite). Recalling or editing a previously-fetched
// client comes from here, never from another CRM/Gemini round trip.
const savingLead = ref(false)
const showSavedLeadsPanel = ref(false)
const savedLeads = ref([])
const savedLeadsQuery = ref('')
const savedLeadsLoading = ref(false)
const expandedLeadId = ref(null)
const leadVersions = ref([])
const filteredSavedLeads = computed(() => {
  const q = savedLeadsQuery.value.trim().toLowerCase()
  if (!q) return savedLeads.value
  return savedLeads.value.filter((l) =>
    (l.clientName || '').toLowerCase().includes(q) ||
    (l.contactEmail || '').toLowerCase().includes(q) ||
    (l.crmSourceAlias || '').toLowerCase().includes(q)
  )
})

const formatSavedDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Fetched proposals already get a cross-section auto-applied on import (see
// proposalStore.importProposal), but only into an empty slot. This button force-
// reapplies to every page in the CURRENT proposal - for after manually changing a
// sign type, or for a proposal that was loaded before this feature existed.

const handleApplyCrossSections = () => {
  let applied = 0
  let noMatch = []
  for (const page of pages.value) {
    const matched = matchCrossSection(page.signType, page.illuminated)
    let crossSection = page.assets.find((a) => a.label === 'Cross Section')
    if (!crossSection) {
      crossSection = { style: 'drawing', src: null, mediaType: 'image', label: 'Cross Section',
        isRegenerating: false, originalSrc: null, isDragging: false, aspectRatio: 'auto',
        bgTransparent: false, zoom: 1, x: 0, y: 0 }
      page.assets.push(crossSection)
    }
    if (matched) {
      crossSection.src = matched
      applied++
    } else {
      noMatch.push(page.signType || 'Untitled')
    }
  }
  if (applied > 0) {
    showToast(`Cross section applied to ${applied} page${applied > 1 ? 's' : ''}`, 'success', 4000)
  }
  if (noMatch.length > 0) {
    showToast(`No confident match for: ${noMatch.join(', ')} — left as-is`, 'error', 7000)
  }
}

const handleSaveLead = async () => {
  savingLead.value = true
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: proposalStore.exportCurrentProposal(),
        label: 'Saved from editor',
        source: 'manual-edit'
      })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Save failed')
    proposalStore.activeLeadMeta.dbLeadId = result.leadId
    proposalStore.activeLeadMeta.latestVersion = result.version
    proposalStore.clearDraft()
    showToast(`Saved as version ${result.version}`, 'success', 4000)
    if (showSavedLeadsPanel.value) loadSavedLeadsList()
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error', 6000)
  } finally {
    savingLead.value = false
  }
}

const openSavedLeadsPanel = () => {
  showSavedLeadsPanel.value = !showSavedLeadsPanel.value
  if (showSavedLeadsPanel.value) loadSavedLeadsList()
}

const loadSavedLeadsList = async () => {
  savedLeadsLoading.value = true
  try {
    const response = await fetch('/api/leads')
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to load saved leads')
    savedLeads.value = result.leads
  } catch (err) {
    showToast(`Could not load saved leads: ${err.message}`, 'error', 6000)
  } finally {
    savedLeadsLoading.value = false
  }
}

const toggleVersionHistory = async (leadId) => {
  if (expandedLeadId.value === leadId) {
    expandedLeadId.value = null
    return
  }
  try {
    const response = await fetch(`/api/leads?id=${leadId}&action=versions`)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to load version history')
    leadVersions.value = result.versions
    expandedLeadId.value = leadId
  } catch (err) {
    showToast(`Could not load version history: ${err.message}`, 'error', 6000)
  }
}

const handleLoadSavedLead = async (leadId, version) => {
  try {
    const response = await fetch(`/api/leads?id=${leadId}&action=version&version=${version}`)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to load this version')
    const loadResult = proposalStore.importProposal(result.data, { dbLeadId: leadId, version: result.version })
    scrollToPage(0)
    if (loadResult.draftRestored) {
      showToast(`Restored your unsaved changes on ${result.data.clientName} from before the refresh`, 'success', 5000)
    } else {
      showToast(`Loaded ${result.data.clientName} — v${result.version} — no CRM call needed`, 'success', 4000)
    }
    logWarnings(result.data.clientName, loadResult.warnings)
  } catch (err) {
    showToast(`Load failed: ${err.message}`, 'error', 6000)
  }
}

const handleDeleteSavedLead = async (leadId) => {
  const confirmed = await confirmAction('Delete this saved lead and all its versions? This cannot be undone.', 'Delete')
  if (!confirmed) return
  try {
    const response = await fetch(`/api/leads?id=${leadId}`, { method: 'DELETE' })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.error || 'Delete failed')
    }
    savedLeads.value = savedLeads.value.filter((l) => l.id !== leadId)
    showToast('Deleted', 'success', 3000)
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error', 6000)
  }
}

const handleStopFollowUps = async (leadId) => {
  const confirmed = await confirmAction('Stop sending follow-up reminders to this client?', 'Stop Follow-Ups')
  if (!confirmed) return
  try {
    const response = await fetch(`/api/leads/${leadId}/stop-follow-ups`, { method: 'POST' })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.error || 'Failed to stop follow-ups')
    }
    showToast('Follow-up reminders stopped for this client', 'success', 4000)
  } catch (err) {
    showToast(`Failed to stop follow-ups: ${err.message}`, 'error', 6000)
  }
}
</script>

<style scoped>
/* Page Mini Tabs */
.page-mini-tab {
  @apply min-w-[28px] h-7 rounded-md border text-[10px] font-bold transition-all flex-shrink-0;
  @apply bg-gray-700 border-gray-600 text-gray-400;
}
.page-mini-tab.active {
  @apply bg-teal-600 border-teal-400 text-white;
}
.page-mini-tab:hover:not(.active) {
  @apply border-teal-500 text-teal-400;
}

/* Theme Buttons */
.theme-compact {
  @apply text-[10px] py-1 rounded-md border font-semibold transition-all;
}
.theme-compact.theme-active {
  @apply ring-1;
}

/* Action Mini Buttons */
.action-mini {
  @apply text-white py-1.5 rounded-lg shadow-sm transition-all duration-150 flex flex-col items-center justify-center gap-0.5;
  @apply hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-sm;
}

/* Page Size Select */
.page-size-select {
  @apply bg-gray-800 border border-gray-600 text-white text-[10px] rounded px-1 py-1;
  @apply focus:outline-none focus:border-teal-500 cursor-pointer;
}

/* Inputs */
.input-compact {
  @apply w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs;
  @apply focus:outline-none focus:border-teal-500 transition-colors;
}

/* Labels */
.label-mini {
  @apply text-[10px] text-gray-400 uppercase font-bold mb-0.5 block;
}

/* Copy Buttons */
.copy-mini {
  @apply w-7 h-7 flex-shrink-0 rounded bg-teal-600/20 border border-teal-500/30 text-teal-400;
  @apply flex items-center justify-center text-xs hover:bg-teal-600/30 transition-all;
}
.copy-micro {
  @apply w-5 h-5 flex-shrink-0 rounded bg-teal-600/20 border border-teal-500/30 text-teal-400;
  @apply flex items-center justify-center hover:bg-teal-600/30 transition-all;
}

/* File Input */
.file-input-compact {
  @apply text-[9px] text-gray-500 w-full;
}
.file-input-compact::file-selector-button {
  @apply bg-gray-700 text-white border-none rounded px-2 py-1 text-[9px] cursor-pointer mr-2;
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  @apply transition-opacity duration-200;
}
.fade-enter-from, .fade-leave-to {
  @apply opacity-0;
}

/* Scrollbar */
::-webkit-scrollbar {
  @apply w-1;
}
::-webkit-scrollbar-track {
  @apply bg-gray-800;
}
::-webkit-scrollbar-thumb {
  @apply bg-teal-600/30 rounded;
}
::-webkit-scrollbar-thumb:hover {
  @apply bg-teal-600/50;
}

/* ═══ Theme Builder ═══ */
.tb-color-cell {
  @apply flex flex-col items-center gap-1 bg-gray-900/50 rounded-md p-1.5 border border-gray-700/50;
  transition: border-color 0.2s;
}
.tb-color-cell:hover {
  @apply border-gray-600;
}
.tb-label {
  @apply text-[8px] text-gray-400 uppercase font-bold tracking-wider;
}
.tb-hex {
  @apply text-[8px] text-gray-500 font-mono uppercase;
}
.tb-swatch-wrap {
  @apply relative w-full h-7 rounded overflow-hidden border border-gray-600 cursor-pointer;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.4);
}
.tb-color-input {
  @apply absolute inset-0 cursor-pointer opacity-0 z-10;
  width: 200%; height: 200%; top: -50%; left: -50%;
}
.tb-swatch {
  @apply w-full h-full pointer-events-none transition-all;
}
.tb-swatch-wrap:hover .tb-swatch {
  filter: brightness(1.15);
}
.tb-slider {
  @apply w-full h-1.5 rounded-full appearance-none cursor-pointer;
  background: linear-gradient(to right, #1f2937, #14b8a6);
}
.tb-slider::-webkit-slider-thumb {
  @apply appearance-none w-3.5 h-3.5 rounded-full bg-teal-400 border-2 border-gray-900 cursor-pointer;
  box-shadow: 0 0 6px rgba(20,184,166,0.5);
}
.tb-slider::-moz-range-thumb {
  @apply w-3.5 h-3.5 rounded-full bg-teal-400 border-2 border-gray-900 cursor-pointer;
  box-shadow: 0 0 6px rgba(20,184,166,0.5);
}
</style>
