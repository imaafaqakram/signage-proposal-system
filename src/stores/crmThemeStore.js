import { defineStore } from 'pinia'
import { ref } from 'vue'

// Two CRM UI themes: 'pro' (the existing dark/cyan look, default — keeps every
// current user's experience unchanged) and 'light'. Persisted in localStorage (a
// display preference, not a credential) and applied as a class on <html> so the
// --crm-* tokens in style.css resolve correctly before any CRM view even mounts —
// set from the router guard (src/router/index.js), the same place that already
// sets document.title on every CRM navigation.
const KEY = 'crm_theme'

export const useCrmThemeStore = defineStore('crmTheme', () => {
  const theme = ref('pro')

  function apply(t) {
    theme.value = t === 'light' ? 'light' : 'pro'
    document.documentElement.classList.remove('theme-pro', 'theme-light')
    document.documentElement.classList.add(`theme-${theme.value}`)
  }

  function init() {
    let stored = 'pro'
    try {
      stored = localStorage.getItem(KEY) || 'pro'
    } catch {
      // Private browsing / storage blocked — just use the default.
    }
    apply(stored)
  }

  function toggle() {
    const next = theme.value === 'pro' ? 'light' : 'pro'
    apply(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Non-fatal — the toggle still works for this page load, just won't persist.
    }
  }

  return { theme, init, toggle }
})
