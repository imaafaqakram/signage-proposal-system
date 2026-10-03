<template>
  <div class="mi">
    <div class="mi-row">
      <input
        class="mi-field mi-amt"
        type="number"
        step="0.01"
        min="0"
        inputmode="decimal"
        placeholder="0.00"
        :value="modelValue"
        :disabled="disabled"
        @input="onAmount"
      />
      <select v-if="showPicker" v-model="currencyModel" class="mi-field mi-cur" :disabled="disabled" aria-label="Currency">
        <option v-if="!fx.enabled.value" value="USD">USD</option>
        <template v-else>
          <optgroup label="Common">
            <option v-for="c in fx.options.value.popular" :key="c.code" :value="c.code">{{ c.code }} — {{ c.name }}</option>
          </optgroup>
          <optgroup label="All currencies">
            <option v-for="c in fx.options.value.rest" :key="c.code" :value="c.code">{{ c.code }} — {{ c.name }}</option>
          </optgroup>
        </template>
      </select>
      <span v-else class="mi-badge">{{ currency }}</span>
    </div>

    <div v-if="showPicker && fx.ready.value && !fx.enabled.value" class="mi-note">
      Other currencies switch on after the multi-currency database update (migration 016) is run.
    </div>
    <div v-else-if="showPicker && fx.error.value && !fx.ready.value" class="mi-note mi-warn">
      Live exchange rates are unavailable right now — enter the amount in USD.
    </div>

    <div v-if="currency !== 'USD'" class="mi-preview">
      <template v-if="effectiveRate">
        <div class="mi-usd">
          <span v-if="usd !== null">≈ {{ usdText }} <span class="mi-usd-code">USD</span></span>
          <span v-else class="mi-dim">Enter an amount to see the USD value</span>
        </div>
        <div v-if="!compact" class="mi-rate">
          1 USD = {{ rateText }} {{ currency }} · {{ rateNote }}
        </div>
        <div v-if="showPicker && !compact" class="mi-actions">
          <template v-if="editing">
            <input
              v-model.number="draft"
              class="mi-field mi-draft"
              type="number"
              step="any"
              min="0"
              placeholder="units per 1 USD"
              @keydown.enter.prevent="applyDraft"
            />
            <button type="button" class="mi-link" @click="applyDraft">Apply</button>
            <button type="button" class="mi-link" @click="editing = false">Cancel</button>
          </template>
          <template v-else>
            <button type="button" class="mi-link" @click="startEdit">Use a different rate</button>
            <button v-if="fxRate" type="button" class="mi-link" @click="resetRate">Use today's rate</button>
          </template>
        </div>
      </template>
      <div v-else class="mi-note mi-warn">No exchange rate for {{ currency }} yet — pick another currency or enter USD.</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useFx, toUsd } from '@/composables/useFx'

const props = defineProps({
  modelValue: { type: [Number, String], default: null },
  currency: { type: String, default: 'USD' },
  fxRate: { type: Number, default: null },
  fxManual: { type: Boolean, default: false },
  showPicker: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'update:currency', 'update:fxRate', 'update:fxManual'])

const fx = useFx()
onMounted(() => { fx.load() })

const editing = ref(false)
const draft = ref(null)

const liveRate = computed(() => fx.rateFor(props.currency))
const effectiveRate = computed(() => (props.fxRate > 0 ? props.fxRate : liveRate.value))
const usd = computed(() => {
  if (props.modelValue === null || props.modelValue === '' || props.modelValue === undefined) return null
  return toUsd(props.modelValue, effectiveRate.value)
})
const usdText = computed(() => '$' + Number(usd.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const rateText = computed(() => {
  const r = effectiveRate.value
  return r >= 100 ? r.toLocaleString('en-US', { maximumFractionDigits: 2 }) : r.toLocaleString('en-US', { maximumFractionDigits: 4 })
})
const rateNote = computed(() => {
  if (props.fxRate > 0) return props.fxManual ? 'custom rate' : 'rate locked when this was saved'
  const when = fx.asOf.value ? new Date(fx.asOf.value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''
  return `today's rate${when ? ` (${when})` : ''}${fx.stale.value ? ', may be a few hours old' : ''}`
})

function onAmount(e) {
  const v = e.target.value
  emit('update:modelValue', v === '' ? null : Number(v))
}
// v-model (not a bare :value) so the select re-syncs when the currency list finishes
// loading after an existing foreign-currency record was opened.
const currencyModel = computed({
  get: () => props.currency,
  set: (code) => {
    emit('update:currency', code)
    // A new currency means the previously locked/custom rate no longer applies.
    emit('update:fxRate', null)
    emit('update:fxManual', false)
    editing.value = false
  }
})
function startEdit() { draft.value = effectiveRate.value; editing.value = true }
function applyDraft() {
  if (!(Number(draft.value) > 0)) return
  emit('update:fxRate', Number(draft.value))
  emit('update:fxManual', true)
  editing.value = false
}
function resetRate() {
  emit('update:fxRate', null)
  emit('update:fxManual', false)
}
</script>

<style scoped>
.mi { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mi-row { display: flex; gap: 6px; }
.mi-field { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; min-width: 0; }
.mi-field:focus { outline: none; border-color: var(--crm-accent); }
.mi-amt { flex: 1; width: 100%; }
.mi-cur { flex: none; width: 176px; }
.mi-badge { display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid var(--crm-border-strong); border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--crm-text-muted); background: var(--crm-hover-bg); }
.mi-preview { background: var(--crm-accent-soft-bg); border: 1px solid var(--crm-border); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 3px; }
.mi-usd { font-size: 14px; font-weight: 700; color: var(--crm-text); font-variant-numeric: tabular-nums; }
.mi-usd-code { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: var(--crm-text-muted); }
.mi-dim { font-size: 12px; font-weight: 500; color: var(--crm-text-muted); }
.mi-rate { font-size: 11px; color: var(--crm-text-muted); line-height: 1.4; }
.mi-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 2px; }
.mi-link { background: none; border: 0; padding: 0; font: inherit; font-size: 11px; font-weight: 600; color: var(--crm-accent); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.mi-link:hover { color: var(--crm-accent-hover); }
.mi-draft { width: 130px; padding: 4px 8px; font-size: 12px; }
.mi-note { font-size: 11px; color: var(--crm-text-muted); line-height: 1.4; }
.mi-warn { color: var(--crm-warn); }
</style>
