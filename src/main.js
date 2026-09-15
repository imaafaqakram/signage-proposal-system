import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { useAuthStore } from './stores/authStore'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// Auth must resolve before the router's first navigation guard runs — that guard reads
// authStore.isAuthenticated synchronously, but initialize() is async now (it verifies
// the session token against the server instead of trusting a client-side flag). Without
// waiting here, the guard sees "not authenticated yet" on every page load and bounces
// even a valid session to /login before initialize() has a chance to finish.
;(async () => {
  const authStore = useAuthStore(pinia)
  await authStore.initialize()

  app.use(router)
  app.mount('#app')
})()
