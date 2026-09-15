import { ref } from 'vue'

// Module-level (not per-component) refs — every page that needs the phone number or
// discount presets shares the same one fetch, rather than each component hitting the
// endpoint separately. Defaults here match what admin-settings.json ships with, so the
// proposal UI never breaks or flashes empty content if this fetch fails.
const proposalPhone = ref('+1 209 340 4633')
const discountPresets = ref([0, 5, 10, 15])
let loaded = false
let loadingPromise = null

export function usePublicSettings() {
  if (!loaded && !loadingPromise) {
    loadingPromise = fetch('/api/settings/public')
      .then((r) => r.json())
      .then((result) => {
        if (result.proposalPhone) proposalPhone.value = result.proposalPhone
        if (Array.isArray(result.discountPresets) && result.discountPresets.length) {
          discountPresets.value = result.discountPresets
        }
        loaded = true
      })
      .catch(() => {
        // Keep the defaults above — a failed settings fetch must never block or blank
        // out the proposal editor itself.
      })
  }
  return { proposalPhone, discountPresets }
}
