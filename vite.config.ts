import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
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
// xfwd: the phone's own address reaches the backend (X-Forwarded-For), so the audit trail shows which device made a change.
const backendProxy = Object.fromEntries(['/auth/v1', '/rest/v1', '/storage/v1', '/__dev'].map(p => [p, { target: backendUrl, changeOrigin: false, xfwd: true }]))

/** Dev server and `npm run preview` listen on every interface, so a phone on the same network can open the app. */
const host = process.env.HOST || '0.0.0.0'
const port = parseInt(process.env.PORT || '8443')

/**
 * Production security headers, written to `dist/_headers` at build time (the file Netlify and Cloudflare Pages read;
 * another host takes the same values in its own configuration: see README.md → Hosting). The Content-Security-Policy
 * allows scripts from mCare itself plus the two inline scripts of index.html, by hash, so an injected script cannot run;
 * connections only to mCare and its Supabase project; and nobody may frame the app.
 */
function securityHeaders(supabaseUrl: string): Plugin {
  return {
    name: 'mcare-security-headers',
    apply: 'build',
    enforce: 'post',
    writeBundle(options) {
      const dir = options.dir ?? path.resolve(import.meta.dirname, 'dist')
      const html = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : ''
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)
      let backend = ''
      try { const u = new URL(supabaseUrl); backend = ` ${u.origin} ${u.origin.replace(/^http/, 'ws')}` } catch { /* "/" or empty: same origin */ }
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        `connect-src 'self'${backend}`,
        "frame-src 'self' blob: data:",
        "media-src 'self' blob:",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
      const lines = [
        '/*',
        `  Content-Security-Policy: ${csp}`,
        '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
        '  X-Content-Type-Options: nosniff',
        '  X-Frame-Options: DENY',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()',
        '  Cross-Origin-Opener-Policy: same-origin',
        '  X-Robots-Tag: noindex, nofollow',
        '/sw.js',
        '  Cache-Control: no-cache',
        '/index.html',
        '  Cache-Control: no-cache',
        '',
      ]
      fs.writeFileSync(path.join(dir, '_headers'), lines.join('\n'))
    },
  }
}

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // `vite build --mode development` gives a readable build with inline source maps, for debugging.
  const debugBuild = mode === 'development'

  return {
    base: process.env.BASE_URL || '/',
    // The app version shown on the welcome screen and in About.
    define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
    build: {
      sourcemap: debugBuild ? 'inline' : false,
      minify: !debugBuild,
      // React in its own file: it changes far less often than the app, so browsers keep it cached across releases,
      // and the app's entry stays under the 500 kB warning limit.
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] },
        },
      },
    },
    plugins: [react(), tailwindcss(), securityHeaders(env.VITE_SUPABASE_URL ?? '')],
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
