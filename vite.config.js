// Proxy timeout bump for the streaming /api/migrate-lead route: Author Burhan.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // /api/migrate-lead streams progress over a long-lived connection (one client can take
        // 20-90s with no bytes in between) — the default proxy timeout closes that mid-stream.
        timeout: 10 * 60 * 1000,
        proxyTimeout: 10 * 60 * 1000
      }
    }
  },
  build: {
    outDir: 'dist',
    // Production builds are served publicly (Express serves the whole dist/ folder
    // statically) - a source map turns the minified bundle back into fully readable
    // original source, comments included, for anyone with browser DevTools open.
    // Confirmed live: 12 .map files were being served at HTTP 200 with the internal
    // pipeline's logic, matching heuristics, and schema design fully exposed.
    sourcemap: false
  }
})
