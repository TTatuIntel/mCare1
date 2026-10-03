import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

import packageJson from './package.json' with { type: 'json' }

/**
 * The local mCare backend (`npm run backend`, supabase/dev/server.mjs) listens on this machine only.
 * The app reaches it through these paths on the dev server, so `VITE_SUPABASE_URL=/` works
 * from the laptop and from a phone on the same network without the phone ever needing the backend's port.
 * Unused when VITE_SUPABASE_URL points at a hosted Supabase project.
 */
const backendUrl = process.env.MCARE_BACKEND_URL || `http://127.0.0.1:${process.env.MCARE_BACKEND_PORT || 54321}`
const backendProxy = Object.fromEntries(['/auth/v1', '/rest/v1', '/storage/v1', '/__dev'].map(p => [p, { target: backendUrl, changeOrigin: false }]))

/** Dev server and `npm run preview` listen on every interface, so a phone on the same network can open the app. */
const host = process.env.HOST || '0.0.0.0'
const port = parseInt(process.env.PORT || '8443')

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `vite build --mode development` gives a readable build with inline source maps, for debugging.
  const debugBuild = mode === 'development'

  return {
    base: process.env.BASE_URL || '/',
    // The app version shown on the welcome screen and in About.
    define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
    build: {
      sourcemap: debugBuild ? 'inline' : false,
      minify: !debugBuild,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host,
      port,
      strictPort: true,
      proxy: backendProxy,
      // The local database lives here; its files change on every write.
      watch: { ignored: ['**/supabase/.data/**'] },
    },
    preview: {
      host,
      port,
      proxy: backendProxy,
    },
  }
})
