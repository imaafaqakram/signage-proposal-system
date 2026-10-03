<template>
  <div class="hm-bg" @click.self="$emit('close')" @keydown.esc="$emit('close')">
    <div class="hm" role="dialog" aria-modal="true" :aria-label="`History — ${title}`" tabindex="-1" ref="dialog">
      <div class="hm-head">
        <div>
          <h3>History</h3>
          <p class="hm-sub">{{ title }}</p>
        </div>
        <button class="hm-x" type="button" aria-label="Close" @click="$emit('close')"><i class="fas fa-xmark"></i></button>
      </div>

      <div v-if="loading" class="hm-state"><i class="fas fa-circle-notch fa-spin"></i> Loading history…</div>
      <div v-else-if="error" class="hm-state hm-err">{{ error }}</div>
      <div v-else-if="pending" class="hm-state">History isn't switched on yet — the activity log table hasn't been created.</div>
      <div v-else-if="!entries.length" class="hm-state">
        No history recorded for this yet. Changes made from now on will appear here with the name of the person who made them.
      </div>

      <ol v-else class="hm-list">
        <li v-for="(e, i) in entries" :key="i" class="hm-item">
          <div class="hm-avatar" :class="{ shared: e.via !== 'personal' }" aria-hidden="true">{{ initials(e.employee_name) }}</div>
          <div class="hm-body">
            <div class="hm-line">
              <strong>{{ e.employee_name || 'Unknown user' }}</strong>
              <span class="hm-verb">{{ describeAction(e) }}</span>
              <span v-if="e.via !== 'personal' && e.employee_name" class="hm-tag" title="Signed in with the shared password, so this name is whatever they typed at sign-in and isn't verified">unverified name</span>
            </div>
            <div class="hm-time" :title="fullTime(e.created_at)">{{ relTime(e.created_at) }} · {{ fullTime(e.created_at) }}</div>

            <div v-if="e.detail" class="hm-detail">{{ e.detail }}</div>
            <ul v-if="e.changes.length" class="hm-changes">
              <li v-for="c in e.changes" :key="c.label">
                <span class="hm-field">{{ c.label }}</span>
                <span class="hm-from">{{ c.from }}</span>
                <i class="fas fa-arrow-right-long"></i>
                <span class="hm-to">{{ c.to }}</span>
              </li>
            </ul>
            <ul v-else-if="e.snapshot.length" class="hm-snap">
              <li v-for="s in e.snapshot" :key="s.label"><span class="hm-field">{{ s.label }}</span> {{ s.value }}</li>
            </ul>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { crmJson } from '@/services/crmApi'
import { initials } from '@/composables/useCrmUser'
import { describeAction, summarizeMeta, relTime, fullTime } from '@/services/crmHistory'

// entityType/entityId identify the record; `admin` picks the admin-tier session for money
// records (expenses, orders, materials, vendors, purchase orders — the server only lets
// admins read those timelines).
const props = defineProps({
  entityType: { type: String, required: true },
  entityId: { type: [String, Number], required: true },
  title: { type: String, default: '' },
  admin: { type: Boolean, default: false }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref('')
const pending = ref(false)
const entries = ref([])
const dialog = ref(null)

onMounted(async () => {
  nextTick(() => dialog.value?.focus())
  try {
    const q = new URLSearchParams({ entity_type: props.entityType, entity_id: String(props.entityId) })
    const res = await crmJson(`/history?${q}`, { admin: props.admin })
    pending.value = !!res.migrationPending
    entries.value = (res.rows || []).map((r) => ({ ...r, ...summarizeMeta(r) }))
  } catch (e) {
    error.value = e.status === 403 ? 'Only admins can view the history of money records.' : (e.message || 'Could not load the history.')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.hm-bg { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: flex; align-items: center; justify-content: center; z-index: 80; padding: 20px; }
.hm { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 14px; width: 560px; max-width: 100%; max-height: 86vh; display: flex; flex-direction: column; outline: none; color: var(--crm-text); }
.hm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 20px 24px 14px; border-bottom: 1px solid var(--crm-border); }
.hm-head h3 { font-family: 'Syne', sans-serif; font-size: 18px; margin: 0 0 3px; }
.hm-sub { margin: 0; font-size: 12.5px; color: var(--crm-text-muted); overflow-wrap: anywhere; }
.hm-x { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 30px; height: 30px; border-radius: 6px; cursor: pointer; flex: none; }
.hm-x:hover { border-color: var(--crm-accent); color: var(--crm-text); }
.hm-state { padding: 34px 24px; text-align: center; font-size: 12.5px; color: var(--crm-text-muted); line-height: 1.6; }
.hm-err { color: var(--crm-danger); }
.hm-list { list-style: none; margin: 0; padding: 8px 24px 22px; overflow-y: auto; display: flex; flex-direction: column; }
.hm-item { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--crm-row-border); }
.hm-item:last-child { border-bottom: 0; }
.hm-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--crm-accent-soft-bg); color: var(--crm-accent); border: 1px solid var(--crm-accent); font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex: none; }
.hm-avatar.shared { background: var(--crm-hover-bg); color: var(--crm-text-muted); border-color: var(--crm-border-strong); }
.hm-body { min-width: 0; flex: 1; }
.hm-line { font-size: 13px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.hm-verb { color: var(--crm-text-secondary); }
.hm-tag { font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: var(--crm-warn-bg); color: var(--crm-warn); cursor: help; }
.hm-time { font-size: 11px; color: var(--crm-text-dim); margin-top: 2px; }
.hm-detail { font-size: 12.5px; color: var(--crm-text-secondary); margin-top: 6px; }
.hm-changes, .hm-snap { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.hm-changes li { font-size: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; }
.hm-changes i { font-size: 10px; color: var(--crm-text-dim); }
.hm-field { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--crm-text-muted); min-width: 92px; display: inline-block; }
.hm-from { color: var(--crm-text-muted); text-decoration: line-through; text-decoration-color: var(--crm-border-strong); overflow-wrap: anywhere; }
.hm-to { color: var(--crm-text); font-weight: 600; overflow-wrap: anywhere; }
.hm-snap li { font-size: 12px; color: var(--crm-text-secondary); overflow-wrap: anywhere; }
</style>
