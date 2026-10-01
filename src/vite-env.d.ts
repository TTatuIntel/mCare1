/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd1234.supabase.co. Leave unset to run in demo mode. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon (public) key. Safe in the browser — the database rules do the protecting. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }

/** The `version` in package.json, set at build time by vite.config.ts. */
declare const __APP_VERSION__: string
