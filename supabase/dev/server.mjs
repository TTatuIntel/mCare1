#!/usr/bin/env node
/**
 * The local mCare backend.
 *
 *   npm run backend          (needs once: npm i --no-save @electric-sql/pglite)
 *
 * It runs the migrations in ../migrations on a real Postgres engine (PGlite,
 * kept on disk in ../.data) and serves it the way a Supabase project does:
 *
 *   /auth/v1     sign-up, sign-in, sessions, password reset      (Supabase Auth)
<<<<<<< Updated upstream
=======
 *                by code or link, two-step sign-in (TOTP factors,
 *                with a QR code), and in test builds a stand-in
 *                for Google and Apple sign-in (/authorize)
>>>>>>> Stashed changes
 *   /rest/v1     tables and functions, as the signed-in person   (PostgREST)
 *   /storage/v1  document files                                  (Supabase Storage)
 *
 * The app talks to it through the same supabase-js client it uses for a
 * hosted project, so nothing in src/ knows the difference. Every request runs
 * as the caller's database role with their id set, which is what makes the
 * row-level rules in the migrations apply. There is no second copy of the
 * access rules here.
 *
 * This is for development and testing on your own machine and network. For
 * production, apply the same migrations to a hosted Supabase project.
 */
import { PGlite } from '@electric-sql/pglite'
import http from 'node:http'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { qrSvg } from './qr.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MIGRATIONS = join(HERE, '..', 'migrations')

const ACCESS_TTL = 3600                 // seconds an access token lasts; the browser refreshes it
const MAX_BODY = 25 * 1024 * 1024
const MAX_FILE = 20 * 1024 * 1024
const MIN_PASSWORD = 5                  // mCare policy: short but still requires uppercase + number
const CODE_TTL_MIN = { signup: 60, recovery: 10 }
const MAX_CODE_ATTEMPTS = 5
const MAX_SIGN_IN_FAILURES = 10         // per email, per 5 minutes
const validPassword = pw => typeof pw === 'string' && pw.length >= MIN_PASSWORD && /[A-Z]/.test(pw) && /\d/.test(pw)

/* ─── Small helpers ─────────────────────────────────────────────────── */
const b64url = v => Buffer.from(v).toString('base64url')
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex')
const iso = v => (v instanceof Date ? v.toISOString() : v ?? null)

class HttpError extends Error {
  constructor(status, body) { super(body.message ?? body.msg ?? 'Error'); this.status = status; this.body = body }
}
const restError = (status, code, message, details = null, hint = null) => new HttpError(status, { code, message, details, hint })
const authError = (status, error_code, msg) => new HttpError(status, { code: status, error_code, msg })
const storageError = (status, error, message) => new HttpError(status, { statusCode: String(status), error, message })

function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
/** The claims, or null when the token is not ours or has been altered. Expiry is checked by the caller. */
function readJwt(token, secret) {
  const [head, body, sig] = String(token).split('.')
  if (!head || !body || !sig) return null
  const want = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest()
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()) } catch { return null }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`
}
function passwordMatches(password, stored) {
  const [, salt, hash] = String(stored ?? '').split('$')
  if (!salt || !hash) return false
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(password, salt, 64)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** A name from the request, safe to put in SQL as an identifier. */
function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw restError(400, 'PGRST100', `"${name}" is not a valid name`)
  return `"${name}"`
}
/** A JS list as a Postgres array literal, for `= any ($1)`. */
const pgArray = list => `{${list.map(v => (v === null ? 'NULL' : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)).join(',')}}`

/** Splits "a,b,(c,d),"e,f"" on the commas that are not inside brackets or quotes. */
function splitTop(text) {
  const out = []; let depth = 0, quoted = false, cur = ''
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '(') depth++
    if (!quoted && ch === ')') depth--
    if (ch === ',' && !quoted && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur !== '') out.push(cur)
  return out
}
const unquote = v => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v)

const COMPARE = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

/** One PostgREST filter, e.g. status=eq.open or id=in.(a,b), as SQL with its value bound as a parameter. */
function condition(column, expr, params) {
  let negate = false
  if (expr.startsWith('not.')) { negate = true; expr = expr.slice(4) }
  const dot = expr.indexOf('.')
  const op = dot < 0 ? expr : expr.slice(0, dot)
  const value = dot < 0 ? '' : expr.slice(dot + 1)
  const col = ident(column)
  let sql
  if (COMPARE[op]) { params.push(value); sql = `${col} ${COMPARE[op]} $${params.length}` }
  else if (op === 'like' || op === 'ilike') { params.push(value.replace(/\*/g, '%')); sql = `${col} ${op} $${params.length}` }
  else if (op === 'is') {
    if (!['null', 'true', 'false'].includes(value)) throw restError(400, 'PGRST100', `"is.${value}" is not supported`)
    sql = `${col} is ${value}`
  }
  else if (op === 'in') {
    if (!value.startsWith('(') || !value.endsWith(')')) throw restError(400, 'PGRST100', 'Use in.(a,b,c)')
    params.push(pgArray(splitTop(value.slice(1, -1)).map(unquote)))
    sql = `${col} = any ($${params.length})`
  }
  else throw restError(400, 'PGRST100', `The "${op}" filter is not supported by the local backend`)
  return negate ? `not (${sql})` : sql
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function whereOf(search, params) {
  const parts = []
  for (const [key, value] of search) {
    if (RESERVED.has(key)) continue
    if (key === 'or' || key === 'and') {
      const items = splitTop(value.replace(/^\(|\)$/g, '')).map(item => {
        const dot = item.indexOf('.')
        return condition(item.slice(0, dot), item.slice(dot + 1), params)
      })
      parts.push(`(${items.join(key === 'or' ? ' or ' : ' and ')})`)
    } else parts.push(condition(key, value, params))
  }
  return parts
}

function columnsOf(select) {
  if (!select || select === '*') return '*'
  if (/[(:]/.test(select)) throw restError(400, 'PGRST100', 'Embedded resources, aliases and casts are not supported by the local backend')
  return select.split(',').map(c => (c.trim() === '*' ? '*' : ident(c.trim()))).join(', ')
}

function orderOf(order) {
  if (!order) return ''
  return ' order by ' + order.split(',').map(part => {
    const [col, ...mods] = part.split('.')
    return ident(col) + (mods.includes('desc') ? ' desc' : ' asc') + (mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '')
  }).join(', ')
}

/** Postgres error → the status and body PostgREST would answer with. */
function fromDatabase(e, signedIn) {
  const code = e.code ?? 'XX000'
  const status = code === '42501' ? (signedIn ? 403 : 401)
    : code === '23505' || code === '23503' ? 409
    : code === '42P01' || code === '42883' ? 404
    : /^(22|23|P0|42)/.test(code) ? 400 : 500
  return new HttpError(status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null })
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address)
}

/** The keys of a local backend that has been started at least once, for scripts such as seed.mjs. */
export function readLocalKeys(dataDir = process.env.MCARE_DATA_DIR ?? join(HERE, '..', '.data')) {
  const file = join(dataDir, 'keys.json')
  if (!fs.existsSync(file)) return null
  const { jwtSecret } = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    anonKey: signJwt({ iss: 'mcare-local', role: 'anon' }, jwtSecret),
    serviceKey: signJwt({ iss: 'mcare-local', role: 'service_role' }, jwtSecret),
  }
}

<<<<<<< Updated upstream
/* ─── The backend ───────────────────────────────────────────────────── */
/**
 * @param {{ port?: number, host?: string, dataDir?: string, quiet?: boolean, confirmEmail?: boolean, jobs?: boolean, exposeTestAuth?: boolean }} [options]
 *   dataDir 'memory' keeps nothing on disk (used by the tests).
=======
/* ─── The database folder: one backend at a time, and a way back after a crash ─ */
// PGlite cannot always reopen a folder after its process was killed (terminal closed, two backends on
// one folder, the folder deleted underneath it). So the backend owns its folder while it runs, keeps a
// copy each time it stops cleanly, and on start puts a damaged folder aside and brings that copy back.
const folders = dataDir => ({
  pg: join(dataDir, 'pg'), backup: join(dataDir, 'pg-backup'), lock: join(dataDir, 'backend.pid'),
})

/** The process id of a backend that is running on this data folder now, or null. */
export function runningBackend(dataDir) {
  let pid
  try { pid = Number(fs.readFileSync(folders(dataDir).lock, 'utf8')) } catch { return null }
  if (!pid || pid === process.pid) return null
  try { process.kill(pid, 0); return pid } catch (e) { return e.code === 'EPERM' ? pid : null }
}

/**
 * Takes the data folder for this process, or fails with what to do. The lock file is created exclusively, so of
 * two backends started at the same moment exactly one gets the folder, and the other stops before opening it.
 */
function claimFolder(dataDir) {
  const { lock } = folders(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return } catch (e) { if (e.code !== 'EEXIST') throw e }
    let text
    try { text = fs.readFileSync(lock, 'utf8').trim() } catch { continue }   // released meanwhile: try again
    const pid = Number(text)
    let alive = !pid   // empty: another backend is writing it this very moment
    if (pid) { try { process.kill(pid, 0); alive = true } catch (e) { alive = e.code === 'EPERM' } }
    if (alive) {
      throw new Error(`Another mCare backend${pid ? ` (process ${pid})` : ''} is already using ${dataDir}.\n`
        + `  Use that one, or stop it (Ctrl+C in its terminal, or "npm run backend:stop") and run "npm run backend" again.\n`
        + `  No backend running at all? Delete ${lock} and start again.`)
    }
    try { fs.rmSync(lock) } catch {}   // left by a backend that was killed
  }
  throw new Error(`Could not take ${dataDir}: another backend keeps starting there. Use that one.`)
}

/** Fails, with what to do, when the port is taken: checked before the database is touched. */
async function portFree(port, host) {
  if (!port) return
  await new Promise((done, fail) => {
    const probe = http.createServer()
    probe.once('error', e => fail(e.code === 'EADDRINUSE'
      ? new Error(`Port ${port} is already in use: another mCare backend is probably running in another terminal.\n`
        + `  Use that one, or stop it there with Ctrl+C and run "npm run backend" again.`)
      : e))
    probe.listen(port, host, () => probe.close(done))
  })
}

/** Opens the folder in a separate process (a failed open keeps its files locked in this one). */
function opensCleanly(dir) {
  return new Promise(done => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--check', dir], { stdio: 'ignore', timeout: 120_000 })
    child.on('exit', code => done(code === 0))
    child.on('error', () => done(false))
  })
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/:/g, '-')

/** Moves a damaged folder aside (keeping the two newest) and returns where it went. */
function setAside(dataDir, dir) {
  const aside = join(dataDir, `pg-unreadable-${stamp()}`)
  fs.rmSync(aside, { recursive: true, force: true })
  fs.renameSync(dir, aside)
  const old = fs.readdirSync(dataDir).filter(f => f.startsWith('pg-unreadable-')).sort().slice(0, -2)
  for (const f of old) fs.rmSync(join(dataDir, f), { recursive: true, force: true })
  return aside
}

/** Copies a cleanly closed database folder to pg-backup. The old copy is replaced only once the new one is complete. */
function keepCopy(dataDir) {
  const { pg, backup } = folders(dataDir)
  if (!fs.existsSync(join(pg, 'PG_VERSION')) || fs.existsSync(join(pg, 'postmaster.pid'))) return false
  const tmp = `${backup}.tmp`
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.cpSync(pg, tmp, { recursive: true })
  fs.rmSync(backup, { recursive: true, force: true })
  fs.renameSync(tmp, backup)
  return true
}

/**
 * Makes the pg folder safe to open. Returns how: 'existing', 'new', 'recovered' (the last run was killed
 * but the database came back), or 'restored' (it could not be opened, so the copy kept at the last
 * clean stop replaced it).
 */
async function prepareFolder(dataDir) {
  const { pg, backup } = folders(dataDir)
  if (fs.existsSync(pg) && !fs.existsSync(join(pg, 'PG_VERSION'))) fs.rmSync(pg, { recursive: true, force: true })  // half-created
  if (!fs.existsSync(pg)) return { how: 'new' }
  if (!fs.existsSync(join(pg, 'postmaster.pid'))) return { how: 'existing' }   // closed cleanly last time
  if (await opensCleanly(pg)) return { how: 'recovered' }
  const aside = setAside(dataDir, pg)
  if (!fs.existsSync(join(backup, 'PG_VERSION'))) return { how: 'new', aside }
  fs.cpSync(backup, pg, { recursive: true })
  return { how: 'restored', aside, savedAt: fs.statSync(backup).mtime }
}

/** Idempotent: the parts of Supabase Auth's schema added to bootstrap.sql since a local database may have been created. */
const AUTH_UPGRADES = `
  alter table auth.sessions add column if not exists aal text not null default 'aal1';
  create table if not exists auth.mfa_factors (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    friendly_name text, factor_type text not null default 'totp',
    status text not null default 'unverified' check (status in ('unverified', 'verified')),
    secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table if not exists auth.mfa_challenges (
    id uuid primary key default gen_random_uuid(), factor_id uuid not null references auth.mfa_factors (id) on delete cascade,
    created_at timestamptz not null default now(), verified_at timestamptz);
  alter table auth.one_time_tokens add column if not exists link_hash text;
`

/* ─── The backend ───────────────────────────────────────────────────── */
/**
 * Real Google sign-in on the local backend: the OAuth client downloaded from Google Cloud (the "Download JSON"
 * of a Web application client), saved as supabase/.data/google-oauth.json, or MCARE_GOOGLE_CLIENT_ID and
 * MCARE_GOOGLE_CLIENT_SECRET. The return address Google sends people to is the client's first redirect URI ending
 * in /auth/v1/callback, MCARE_GOOGLE_REDIRECT_URI, or http://localhost:8443/auth/v1/callback. Null when not set up.
 */
export function readGoogleClient(dataDir) {
  let clientId = process.env.MCARE_GOOGLE_CLIENT_ID, clientSecret = process.env.MCARE_GOOGLE_CLIENT_SECRET, uris = []
  const file = dataDir && dataDir !== 'memory' ? join(dataDir, 'google-oauth.json') : null
  if (!clientId && file && fs.existsSync(file)) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      const c = json.web ?? json.installed ?? json
      ;({ client_id: clientId, client_secret: clientSecret } = c)
      uris = c.redirect_uris ?? []
    } catch (e) {
      console.error(`  ${file} could not be read (${e.message}): Google sign-in uses the local stand-in.`)
      return null
    }
  }
  if (!clientId || !clientSecret) return null
  const redirectUri = process.env.MCARE_GOOGLE_REDIRECT_URI ?? uris.find(u => u.endsWith('/auth/v1/callback')) ?? 'http://localhost:8443/auth/v1/callback'
  return { clientId, clientSecret, redirectUri }
}

/**
 * @param {{ port?: number, host?: string, dataDir?: string, quiet?: boolean, confirmEmail?: boolean, jobs?: boolean, exposeTestAuth?: boolean, google?: { clientId: string, clientSecret: string, redirectUri: string, authUrl?: string, tokenUrl?: string } | null, onStop?: () => void }} [options]
 *   dataDir 'memory' keeps nothing on disk (used by the tests). onStop: called when `npm run backend:stop` asks.
 *   google: the real Google OAuth client (default: readGoogleClient); authUrl / tokenUrl only for tests.
>>>>>>> Stashed changes
 */
export async function startBackend(options = {}) {
  const port = options.port ?? Number(process.env.MCARE_BACKEND_PORT || 54321)
  const host = options.host ?? process.env.MCARE_BACKEND_HOST ?? '127.0.0.1'
  const dataDir = options.dataDir ?? process.env.MCARE_DATA_DIR ?? join(HERE, '..', '.data')
  const memory = dataDir === 'memory'
  const confirmEmail = options.confirmEmail ?? process.env.MCARE_CONFIRM_EMAIL === '1'
  const exposeTestAuth = options.exposeTestAuth ?? (process.env.NODE_ENV !== 'production')
  const google = options.google !== undefined ? options.google : readGoogleClient(dataDir)
  const say = options.quiet ? () => {} : (...a) => console.log(...a)

  /* keys: made once per data directory, never committed */
  let keys
  if (memory) keys = { jwtSecret: crypto.randomBytes(32).toString('hex') }
  else {
    fs.mkdirSync(dataDir, { recursive: true })
    const file = join(dataDir, 'keys.json')
    keys = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { jwtSecret: crypto.randomBytes(32).toString('hex') }
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(keys, null, 2))
  }
  const secret = keys.jwtSecret
  const anonKey = signJwt({ iss: 'mcare-local', role: 'anon' }, secret)
  const serviceKey = signJwt({ iss: 'mcare-local', role: 'service_role' }, secret)

  /* database */
  const db = memory ? new PGlite() : new PGlite(join(dataDir, 'pg'))
  // The engine aborts if the folder was left half-written (the backend was killed, not stopped with Ctrl+C).
  try { await db.waitReady } catch {
    throw new Error(`The local database in ${join(dataDir, 'pg')} cannot be opened: it was not shut down cleanly.\n`
      + `  Rename or delete that folder, then run "npm run backend" and "npm run backend:seed" to start with a new one.`)
  }
  await db.exec(`set timezone = 'UTC'`)
  const fresh = (await db.query(`select 1 from pg_namespace where nspname = 'supabase_migrations'`)).rows.length === 0
  if (fresh) await db.exec(fs.readFileSync(join(HERE, 'bootstrap.sql'), 'utf8'))
  const applied = new Set((await db.query(`select version from supabase_migrations.schema_migrations`)).rows.map(r => r.version))
  /** Applies the migrations this database has not had yet, in order. Returns how many. */
  async function migrate() {
    let count = 0
    const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    // Built from migrations that no longer exist (the history was consolidated): the new files cannot run over it.
    const unknown = [...applied].filter(v => !files.includes(v))
    if (unknown.length) {
      throw new Error(`The local database in ${join(dataDir, 'pg')} was built from an older migration history (${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ', …' : ''}).\n`
        + `  Start a new one: stop the backend, run "npm run backend:reset", then "npm run backend" and "npm run backend:seed".`)
    }
    for (const file of files) {
      if (applied.has(file)) continue
      try {
        await db.exec(`begin;\n${fs.readFileSync(join(MIGRATIONS, file), 'utf8')}\n;insert into supabase_migrations.schema_migrations (version) values ('${file}'); commit;`)
        applied.add(file); count++
        say(`  applied migration ${file}`)
      } catch (e) {
        await db.exec('rollback').catch(() => {})
        throw new Error(`Migration ${file} failed: ${e.message}`)
      }
    }
    return count
  }
  await migrate()

  // One query at a time: PGlite is a single connection, and a request's role must never leak into another's.
  let chain = Promise.resolve()
  const exclusive = work => { const run = chain.then(work, work); chain = run.catch(() => {}); return run }
  const q = (sql, params) => exclusive(() => db.query(sql, params))

  /**
   * A migration added while the backend is running. The app asking for a table, column or function
   * the database does not have is the sign of one, so it is applied then, without a restart.
   */
  const MISSING = new Set(['42P01', '42883', '42703', 'PGRST202'])
  const catchUp = () => exclusive(migrate).catch(e => { console.error(`  ${e.message}`); return 0 })

  /** Runs `work` as the caller. Their role and id are set for this transaction only, so the row rules decide what they reach. */
  const asCaller = (claims, work) => exclusive(() => db.transaction(async tx => {
    const signedIn = claims.role === 'authenticated'
    await tx.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)`,
      [signedIn ? claims.sub : '', claims.role, JSON.stringify(claims)])
    if (claims.role !== 'service_role') await tx.query(`set local role ${signedIn ? 'authenticated' : 'anon'}`)
    return work(tx)
  }))

  const sessions = new Set((await db.query(`select id from auth.sessions`)).rows.map(r => r.id))
  /** Codes and links "emailed" by this backend. There is no mail server locally: they are printed here instead. */
  const outbox = []
  const signInFailures = new Map()

  /* ─── Auth ────────────────────────────────────────────────────────── */
  const userJson = u => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
    email_confirmed_at: iso(u.email_confirmed_at), confirmed_at: iso(u.email_confirmed_at), last_sign_in_at: iso(u.last_sign_in_at),
    app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data,
    identities: [{
      identity_id: u.id, id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id },
      created_at: iso(u.created_at), updated_at: iso(u.updated_at), last_sign_in_at: iso(u.last_sign_in_at), email: u.email,
    }],
    created_at: iso(u.created_at), updated_at: iso(u.updated_at), is_anonymous: false,
  })

  async function tokensFor(user, sessionId) {
    const refresh = crypto.randomBytes(24).toString('base64url')
    await q(`insert into auth.refresh_tokens (token, session_id) values ($1, $2)`, [sha256(refresh), sessionId])
    const now = Math.floor(Date.now() / 1000)
    const access = signJwt({
      iss: 'mcare-local', aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email, session_id: sessionId,
      iat: now, exp: now + ACCESS_TTL, app_metadata: user.raw_app_meta_data, user_metadata: user.raw_user_meta_data,
    }, secret)
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token: refresh, user: userJson(user) }
  }
  async function newSession(user) {
    const id = (await q(`insert into auth.sessions (user_id) values ($1) returning id`, [user.id])).rows[0].id
    sessions.add(id)
    const row = (await q(`update auth.users set last_sign_in_at = now() where id = $1 returning *`, [user.id])).rows[0]
    return tokensFor(row, id)
  }
  const userByEmail = async email => (await q(`select * from auth.users where email = $1`, [String(email ?? '').trim().toLowerCase()])).rows[0]
  const userById = async id => (await q(`select * from auth.users where id = $1`, [id])).rows[0]

  /**
   * "Emails" a one-time code. With `redirectTo` (a password reset from the app) the email also carries a link:
   * a separate long random token, which opens /auth/v1/verify and lands back in the app signed in. The code and
   * the link share one expiry, and using either spends both.
   */
  async function sendCode(user, kind, redirectTo = null) {
    const code = String(crypto.randomInt(100000, 1000000))
    const linkToken = redirectTo ? crypto.randomBytes(32).toString('base64url') : null
    await q(`insert into auth.one_time_tokens (user_id, kind, token_hash, link_hash, expires_at) values ($1, $2, $3, $4, now() + make_interval(mins => $5))
             on conflict (user_id, kind) do update set token_hash = excluded.token_hash, link_hash = excluded.link_hash, attempts = 0, expires_at = excluded.expires_at`,
      [user.id, kind, sha256(code + user.id), linkToken && sha256(linkToken), CODE_TTL_MIN[kind]])
    const link = linkToken
      ? `${new URL(redirectTo).origin}/auth/v1/verify?${new URLSearchParams({ token: linkToken, type: kind, redirect_to: redirectTo })}`
      : null
    outbox.unshift({ to: user.email, kind, code, link, at: Date.now() })
    outbox.length = Math.min(outbox.length, 50)
    say(`  ✉  ${user.email}: your mCare ${kind === 'signup' ? 'confirmation' : 'password reset'} code is ${code}  (local backend: no email is sent)`)
    if (link) say(`     reset link: ${link}`)
  }
  async function useCode(user, kind, code) {
    const row = (await q(`select * from auth.one_time_tokens where user_id = $1 and kind = $2`, [user.id, kind])).rows[0]
    if (!row || row.expires_at < new Date() || row.attempts >= MAX_CODE_ATTEMPTS) return false
    if (row.token_hash !== sha256(String(code).trim() + user.id)) {
      await q(`update auth.one_time_tokens set attempts = attempts + 1 where user_id = $1 and kind = $2`, [user.id, kind])
      return false
    }
    await q(`delete from auth.one_time_tokens where user_id = $1 and kind = $2`, [user.id, kind])
    return true
  }

  async function createUser({ email, password, data, confirmed }) {
    const address = String(email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw authError(400, 'validation_failed', 'Unable to validate email address: invalid format')
    if (!validPassword(password)) throw authError(422, 'weak_password', `Password must be at least ${MIN_PASSWORD} characters and include an uppercase letter and a number.`)
    if (await userByEmail(address)) throw authError(422, 'user_already_exists', 'User already registered')
    try {
      // The mCare profile is created by the database (handle_new_user), in the same statement.
      return (await q(`insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, $4) returning *`,
        [address, hashPassword(password), JSON.stringify(data ?? {}), confirmed ? new Date().toISOString() : null])).rows[0]
    } catch (e) {
      throw authError(e.code === '23505' ? 422 : 500, e.code === '23505' ? 'user_already_exists' : 'unexpected_failure', e.code === '23505' ? 'User already registered' : `Database error saving new user: ${e.message}`)
    }
  }

  /* ─── Links and pages a browser opens itself (no API key), as Supabase Auth serves them ─ */

  /** A return address the local backend will send a browser to: the app on this machine or the local network, nowhere else. */
  function appRedirect(target) {
    let u
    try { u = new URL(String(target ?? '')) } catch { return null }
    if (!/^https?:$/.test(u.protocol)) return null
    if (!/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname)) return null
    u.hash = ''
    return u.href
  }
  const redirect = (res, to) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end() }
  /** Back to the app with a new session in the fragment, the way supabase-js reads it (detectSessionInUrl). */
  const backWithSession = (res, to, t, extra = {}) => redirect(res, `${to}#${new URLSearchParams({
    access_token: t.access_token, expires_at: String(t.expires_at), expires_in: String(t.expires_in), refresh_token: t.refresh_token, token_type: 'bearer', ...extra,
  })}`)
  const backWithError = (res, to, description) => redirect(res, `${to}#${new URLSearchParams({ error: 'access_denied', error_description: description })}`)

  /** Google and Apple, played by a page of this backend: there is no real provider to go to locally. Test builds only. */
  const STAND_IN = { google: 'Google', apple: 'Apple' }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
  function standInPage(res, provider, to, problem = '', form = null) {
    const label = STAND_IN[provider]
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' })
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Continue with ${label} (local test)</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border-radius:16px;box-shadow:0 4px 24px #0001;padding:24px;width:min(360px,calc(100vw - 32px));box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{color:#4b5563;font-size:13px;line-height:1.5}.note{background:#fffbeb;border:1px solid #fde68a;color:#78350f;border-radius:8px;padding:8px 10px}
label{display:block;font-size:12px;font-weight:600;color:#374151;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px}
.err{color:#dc2626}button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:999px;font-weight:600;font-size:14px;cursor:pointer;background:#0f766e;color:#fff}
button.cancel{background:transparent;color:#374151;margin-top:8px}</style></head>
<body><main><h1>Continue with ${label}</h1>
<p class="note"><strong>Local testing only.</strong> This page stands in for ${label}'s sign-in on the local backend. Nothing is sent to ${label}: the email you enter is treated as one ${label} has verified.</p>
<form method="post" action="/auth/v1/authorize/local">
<input type="hidden" name="provider" value="${esc(provider)}"><input type="hidden" name="redirect_to" value="${esc(to)}">
<label for="email">${label} account email</label><input id="email" name="email" type="email" autocomplete="email" required autofocus value="${esc(form?.get('email'))}">
<label for="name">Name (new accounts)</label><input id="name" name="name" type="text" autocomplete="name" value="${esc(form?.get('name'))}">
${problem ? `<p class="err" role="alert">${esc(problem)}</p>` : ''}
<button type="submit">Continue</button><button class="cancel" type="submit" name="cancel" value="1" formnovalidate>Cancel</button>
</form></main></body></html>`)
  }

  async function browserAuth(req, res, url) {
    // The link in a password-reset email: spends the token and lands in the app signed in, asked for a new password.
    if (req.method === 'GET' && url.pathname === '/auth/v1/verify') {
      const to = appRedirect(url.searchParams.get('redirect_to'))
      if (!to) return send(res, 400, { message: 'This link points somewhere the local backend does not send people.' })
      const token = String(url.searchParams.get('token') ?? '')
      const row = url.searchParams.get('type') === 'recovery' && token && (await q(
        `delete from auth.one_time_tokens where kind = 'recovery' and link_hash = $1 and expires_at > now() and attempts < $2 returning user_id`,
        [sha256(token), MAX_CODE_ATTEMPTS])).rows[0]
      if (!row) return backWithError(res, to, 'This reset link is invalid, already used or expired. Ask for a new one.')
      return backWithSession(res, to, await newSession(await userById(row.user_id)), { type: 'recovery' })
    }
    // Real Google: off to Google, and back through /auth/v1/callback.
    if (google && req.method === 'GET' && url.pathname === '/auth/v1/authorize' && url.searchParams.get('provider') === 'google') {
      const to = appRedirect(url.searchParams.get('redirect_to'))
      if (!to) return send(res, 400, { message: 'Unknown return address' })
      if (url.searchParams.get('code_challenge')) return send(res, 400, { message: 'The local backend supports the implicit flow only' })
      for (const [k, v] of googleStates) if (Date.now() - v.at > STATE_TTL) googleStates.delete(k)
      if (googleStates.size >= 1000) return send(res, 429, { message: 'Too many sign-ins in progress. Try again in a few minutes.' })
      const state = crypto.randomBytes(24).toString('base64url'), nonce = crypto.randomBytes(24).toString('base64url')
      googleStates.set(state, { to, nonce, at: Date.now() })
      return redirect(res, `${google.authUrl ?? 'https://accounts.google.com/o/oauth2/v2/auth'}?${new URLSearchParams({
        client_id: google.clientId, redirect_uri: google.redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account',
      })}`)
    }
    if (req.method === 'GET' && url.pathname === '/auth/v1/callback') {
      const state = String(url.searchParams.get('state') ?? '')
      const pending = google && googleStates.get(state)
      if (!pending || Date.now() - pending.at > STATE_TTL) return send(res, 400, { message: 'This sign-in has expired or was not started here. Go back to mCare and try again.' })
      googleStates.delete(state)
      if (url.searchParams.get('error')) {
        return backWithError(res, pending.to, url.searchParams.get('error') === 'access_denied' ? 'Sign-in with Google was cancelled.' : 'Google could not sign you in. Try again.')
      }
      let identity
      try { identity = await googleIdentity(String(url.searchParams.get('code') ?? ''), pending.nonce) } catch (e) {
        if (!options.quiet) console.error(`  Google sign-in failed: ${e.message}`)
        return backWithError(res, pending.to, 'Google could not confirm who you are. Try again.')
      }
      if (!identity.email || identity.email_verified !== true) return backWithError(res, pending.to, 'This Google account has no verified email address, so mCare cannot use it.')
      const out = await providerAccount('google', String(identity.email).toLowerCase(), identity.name, { patientsOnly: false })
      return out.problem ? backWithError(res, pending.to, out.problem) : backWithSession(res, pending.to, await newSession(out.user))
    }
    if (!exposeTestAuth) return send(res, 404, { message: 'Sign-in providers are not available on the local backend' })
    if (req.method === 'GET' && url.pathname === '/auth/v1/authorize') {
      const provider = url.searchParams.get('provider')
      const to = appRedirect(url.searchParams.get('redirect_to'))
      if (!STAND_IN[provider] || !to) return send(res, 400, { message: 'Unknown provider or return address' })
      if (url.searchParams.get('code_challenge')) return send(res, 400, { message: 'The local backend supports the implicit flow only' })
      return standInPage(res, provider, to)
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/authorize/local') {
      const form = new URLSearchParams((await readBody(req)).toString('utf8'))
      const provider = form.get('provider')
      const to = appRedirect(form.get('redirect_to'))
      if (!STAND_IN[provider] || !to) return send(res, 400, { message: 'Unknown provider or return address' })
      if (form.get('cancel')) return backWithError(res, to, 'Sign-in was cancelled.')
      const email = String(form.get('email') ?? '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return standInPage(res, provider, to, 'Enter a valid email address.', form)
      // Anyone who can reach the dev server (the local network, with npm run dev) can type any email here, so the
      // stand-in proves nothing: it never opens a doctor's or a staff member's account, nor one awaiting confirmation.
      const out = await providerAccount(provider, email, form.get('name'), { patientsOnly: true })
      return out.problem ? backWithError(res, to, out.problem) : backWithSession(res, to, await newSession(out.user))
    }
    return send(res, 404, { message: 'Not found' })
  }

  /** Sign-ins sent to Google and not back yet: state → where to return and the nonce the ID token must carry. */
  const googleStates = new Map()
  const STATE_TTL = 10 * 60_000

  /** Trades Google's one-time code for the person's ID token and checks it is for this client and this sign-in. */
  async function googleIdentity(code, nonce) {
    const r = await fetch(google.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: google.redirectUri, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok || !body.id_token) throw new Error(`Google's token endpoint answered ${r.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim())
    // Received straight from Google over TLS, so its signature need not be checked (OpenID Connect Core 3.1.3.7); its claims are.
    const claims = JSON.parse(Buffer.from(String(body.id_token).split('.')[1] ?? '', 'base64url').toString('utf8'))
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new Error('the ID token is not from Google')
    if (claims.aud !== google.clientId) throw new Error('the ID token is for another client')
    if (!(claims.exp * 1000 > Date.now())) throw new Error('the ID token has expired')
    if (claims.nonce !== nonce) throw new Error('the ID token is not for this sign-in')
    return claims
  }

  /**
   * The account a provider vouches for, linked by email as Supabase does: a confirmed account is signed in, a new
   * email becomes a patient (handle_new_user). patientsOnly: the stand-in, which proves nothing about the address.
   */
  async function providerAccount(provider, email, name, { patientsOnly }) {
    const label = { google: 'Google', apple: 'Apple' }[provider]
    let user = await userByEmail(email)
    if (user && !user.email_confirmed_at) {
      if (patientsOnly) return { problem: `An mCare account with this email is waiting for its email to be confirmed. Confirm it from the email we sent, then continue with ${label}.` }
      // The provider has proven the address: it is confirmed, and the password whoever registered it chose is
      // taken away, so an account opened in someone else's name before they arrived cannot be kept by its maker.
      await q(`update auth.users set email_confirmed_at = now(), encrypted_password = $2 where id = $1`, [user.id, hashPassword(`Aa1-${crypto.randomBytes(18).toString('base64url')}`)])
      await q(`delete from auth.one_time_tokens where user_id = $1`, [user.id])
    }
    if (user && patientsOnly && (await q(`select role from public.profiles where id = $1`, [user.id])).rows[0]?.role !== 'patient') {
      return { problem: `On the local backend the ${label} stand-in signs in patients only. Sign in to this account with its password.` }
    }
    if (!user) {
      const full = String(name ?? '').trim().slice(0, 120)
      // The password is random and never used; the person can set one later with "Forgot password?".
      user = await createUser({ email, password: `Aa1-${crypto.randomBytes(18).toString('base64url')}`, data: full ? { full_name: full, name: full } : {}, confirmed: true })
    }
    const meta = (typeof user.raw_app_meta_data === 'string' ? JSON.parse(user.raw_app_meta_data) : user.raw_app_meta_data) ?? {}
    const providers = [...new Set([...(meta.providers ?? []), provider])]
    await q(`update auth.users set raw_app_meta_data = $2 where id = $1`, [user.id, JSON.stringify({ ...meta, provider: meta.provider ?? provider, providers })])
    return { user: await userById(user.id) }
  }

  async function auth(req, res, url, claims, body) {
    const route = `${req.method} ${url.pathname.replace('/auth/v1', '')}`
    const me = async () => {
      if (claims.role !== 'authenticated') throw authError(401, 'no_authorization', 'This endpoint requires a signed-in user')
      const u = await userById(claims.sub)
      if (!u) throw authError(403, 'user_not_found', 'User from sub claim in JWT does not exist')
      return u
    }

    if (route === 'POST /signup') {
      const user = await createUser({ email: body.email, password: body.password, data: body.data, confirmed: !confirmEmail })
      if (!confirmEmail) return send(res, 200, await newSession(user))
      await sendCode(user, 'signup')
      return send(res, 200, { ...userJson(user), confirmation_sent_at: new Date().toISOString() })
    }

    if (route === 'POST /token') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const key = String(body.email ?? '').trim().toLowerCase()
        const recent = (signInFailures.get(key) ?? []).filter(t => Date.now() - t < 5 * 60_000)
        if (recent.length >= MAX_SIGN_IN_FAILURES) throw authError(429, 'over_request_rate_limit', 'Too many attempts. Wait a few minutes and try again.')
        const user = await userByEmail(key)
        if (!user || !passwordMatches(String(body.password ?? ''), user.encrypted_password)) {
          signInFailures.set(key, [...recent, Date.now()])
          throw authError(400, 'invalid_credentials', 'Invalid login credentials')
        }
        if (!user.email_confirmed_at) throw authError(400, 'email_not_confirmed', 'Email not confirmed')
        signInFailures.delete(key)
        return send(res, 200, await newSession(user))
      }
      if (grant === 'refresh_token') {
        const row = (await q(`delete from auth.refresh_tokens where token = $1 returning session_id`, [sha256(String(body.refresh_token ?? ''))])).rows[0]
        const session = row && (await q(`select * from auth.sessions where id = $1`, [row.session_id])).rows[0]
        if (!session) throw authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
        return send(res, 200, await tokensFor(await userById(session.user_id), session.id))
      }
      throw authError(400, 'unsupported_grant_type', 'Only email and password sign-in is available on the local backend')
    }

    if (route === 'GET /user') return send(res, 200, userJson(await me()))

    if (route === 'PUT /user') {
      const user = await me()
      if (body.password !== undefined) {
        if (!validPassword(body.password)) throw authError(422, 'weak_password', `Password must be at least ${MIN_PASSWORD} characters and include an uppercase letter and a number.`)
        if (passwordMatches(body.password, user.encrypted_password)) throw authError(422, 'same_password', 'New password should be different from the old password.')
        await q(`update auth.users set encrypted_password = $2, updated_at = now() where id = $1`, [user.id, hashPassword(body.password)])
        // A new password ends every other device's session.
        const gone = (await q(`delete from auth.sessions where user_id = $1 and id <> $2 returning id`, [user.id, claims.session_id])).rows
        gone.forEach(r => sessions.delete(r.id))
      }
      if (body.data && typeof body.data === 'object')
        await q(`update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb, updated_at = now() where id = $1`, [user.id, JSON.stringify(body.data)])
<<<<<<< Updated upstream
      return send(res, 200, userJson(await userById(user.id)))
=======
      return send(res, 200, await userOut(await userById(user.id)))
    }

    /* two-step sign-in: what supabase.auth.mfa.enroll / challenge / verify / unenroll call */
    const sessionAal = async () => (await q(`select aal from auth.sessions where id = $1`, [claims.session_id])).rows[0]?.aal ?? 'aal1'
    if (route === 'POST /factors') {
      const user = await me()
      if ((body.factor_type ?? 'totp') !== 'totp') throw authError(422, 'mfa_factor_type_not_supported', 'Only authenticator apps (TOTP) are available on the local backend')
      const factors = await factorsOf(user.id)
      // Adding a second factor to an account that already has one needs a session that passed the first.
      if (factors.some(f => f.status === 'verified') && await sessionAal() !== 'aal2') throw authError(403, 'insufficient_aal', 'AAL2 required to enroll a new factor')
      const name = String(body.friendly_name ?? '').trim().slice(0, 60) || null
      if (name && factors.some(f => f.status === 'verified' && f.friendly_name === name)) throw authError(422, 'mfa_factor_name_conflict', `A factor with the friendly name "${name}" for this user already exists`)
      // An unfinished setup is replaced, not stacked.
      await q(`delete from auth.mfa_factors where user_id = $1 and status = 'unverified'`, [user.id])
      const key = toBase32(crypto.randomBytes(20))
      const id = (await q(`insert into auth.mfa_factors (user_id, friendly_name, factor_type, secret) values ($1, $2, 'totp', $3) returning id`, [user.id, name, key])).rows[0].id
      const issuer = String(body.issuer ?? 'mCare').replace(/[:?&#]/g, '').slice(0, 40) || 'mCare'
      const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${key}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
      // A QR code (SVG), as a hosted project returns, so the app shows one here too.
      return send(res, 200, { id, type: 'totp', friendly_name: name ?? undefined, totp: { qr_code: qrSvg(uri), secret: key, uri } })
    }
    const factorRoute = route.match(/^(POST|DELETE) \/factors\/([0-9a-f-]{36})(\/challenge|\/verify)?$/)
    if (factorRoute) {
      const user = await me()
      const factor = (await q(`select * from auth.mfa_factors where id = $1 and user_id = $2`, [factorRoute[2], user.id])).rows[0]
      if (!factor) throw authError(404, 'mfa_factor_not_found', 'Factor not found')
      if (factorRoute[1] === 'DELETE' && !factorRoute[3]) {
        if (factor.status === 'verified' && await sessionAal() !== 'aal2') throw authError(403, 'insufficient_aal', 'AAL2 required to unenroll verified factor')
        await q(`delete from auth.mfa_factors where id = $1`, [factor.id])
        return send(res, 200, { id: factor.id })
      }
      if (factorRoute[3] === '/challenge') {
        const c = (await q(`insert into auth.mfa_challenges (factor_id) values ($1) returning id, created_at`, [factor.id])).rows[0]
        return send(res, 200, { id: c.id, type: 'totp', expires_at: Math.floor(new Date(c.created_at).getTime() / 1000) + CHALLENGE_TTL_SEC })
      }
      if (factorRoute[3] === '/verify') {
        const recent = (mfaFailures.get(factor.id) ?? []).filter(t => Date.now() - t < 5 * 60_000)
        if (recent.length >= MAX_MFA_FAILURES) throw authError(429, 'over_request_rate_limit', 'Too many attempts. Wait a few minutes and try again.')
        const challengeId = /^[0-9a-f-]{36}$/.test(String(body.challenge_id ?? '')) ? String(body.challenge_id) : null
        const challenge = challengeId && (await q(`select * from auth.mfa_challenges where id = $1 and factor_id = $2`, [challengeId, factor.id])).rows[0]
        if (!challenge || challenge.verified_at || Date.now() - new Date(challenge.created_at).getTime() > CHALLENGE_TTL_SEC * 1000) {
          throw authError(422, 'mfa_challenge_expired', 'MFA challenge has expired, verify against another challenge or create a new challenge.')
        }
        if (!totpMatches(factor.secret, body.code)) {
          mfaFailures.set(factor.id, [...recent, Date.now()])
          throw authError(422, 'mfa_verification_failed', 'Invalid TOTP code entered')
        }
        mfaFailures.delete(factor.id)
        await q(`update auth.mfa_challenges set verified_at = now() where id = $1`, [challenge.id])
        await q(`update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1`, [factor.id])
        await q(`update auth.sessions set aal = 'aal2' where id = $1`, [claims.session_id])
        return send(res, 200, await tokensFor(user, claims.session_id))
      }
>>>>>>> Stashed changes
    }

    if (route === 'POST /logout') {
      if (claims.role !== 'authenticated') return send(res, 204)
      const scope = url.searchParams.get('scope') ?? 'global'
      const gone = (await q(
        scope === 'local' ? `delete from auth.sessions where id = $2 and user_id = $1 returning id`
        : scope === 'others' ? `delete from auth.sessions where user_id = $1 and id <> $2 returning id`
        : `delete from auth.sessions where user_id = $1 and $2::uuid is not null returning id`, [claims.sub, claims.session_id])).rows
      gone.forEach(r => sessions.delete(r.id))
      return send(res, 204)
    }

    if (route === 'POST /recover') {
      // Only to an address confirmed at registration. The same answer either way, so emails cannot be looked up.
      const user = await userByEmail(body.email)
      if (user?.email_confirmed_at) await sendCode(user, 'recovery', appRedirect(url.searchParams.get('redirect_to')))
      return send(res, 200, {})
    }

    if (route === 'POST /resend') {
      const user = await userByEmail(body.email)
      if (user && !user.email_confirmed_at) await sendCode(user, 'signup')
      return send(res, 200, {})
    }

    if (route === 'POST /verify') {
      const kind = body.type === 'recovery' ? 'recovery' : 'signup'
      const user = await userByEmail(body.email)
      if (!user || !(await useCode(user, kind, body.token))) throw authError(403, 'otp_expired', 'Token has expired or is invalid')
      if (!user.email_confirmed_at) await q(`update auth.users set email_confirmed_at = now() where id = $1`, [user.id])
      return send(res, 200, await newSession(await userById(user.id)))
    }

    /* admin: only the service key (server-side scripts such as seed.mjs) */
    if (url.pathname.startsWith('/auth/v1/admin/')) {
      if (claims.role !== 'service_role') throw authError(403, 'not_admin', 'User not allowed')
      if (route === 'POST /admin/users') {
        const user = await createUser({ email: body.email, password: body.password, data: body.user_metadata, confirmed: body.email_confirm !== false })
        return send(res, 200, userJson(user))
      }
      const updateUser = route.match(/^PUT \/admin\/users\/([^/]+)$/)
      if (updateUser) {
        if (!validPassword(body.password)) throw authError(422, 'weak_password', `Password must be at least ${MIN_PASSWORD} characters and include an uppercase letter and a number.`)
        const user = (await q(`update auth.users set encrypted_password = $2, updated_at = now() where id = $1 returning *`, [updateUser[1], hashPassword(body.password)])).rows[0]
        if (!user) throw authError(404, 'user_not_found', 'User not found')
        return send(res, 200, userJson(user))
      }
      if (route === 'GET /admin/users') {
        const rows = (await q(`select * from auth.users order by created_at`)).rows
        return send(res, 200, { users: rows.map(userJson), aud: 'authenticated' })
      }
    }

    throw authError(404, 'not_found', `${route} is not available on the local backend`)
  }

  /* ─── Tables and functions ────────────────────────────────────────── */
  const primaryKeys = new Map()
  async function primaryKeyOf(tx, table) {
    if (!primaryKeys.has(table)) {
      const rows = (await tx.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
         where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`, [table])).rows
      primaryKeys.set(table, rows.map(r => r.attname))
    }
    return primaryKeys.get(table)
  }

  async function rest(req, res, url, claims, body) {
    const signedIn = claims.role === 'authenticated'
    const prefer = String(req.headers.prefer ?? '')
    const wantObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
    const reply = (status, json, extra) => {
      if (wantObject) {
        const rows = JSON.parse(json)
        if (rows.length !== 1) throw restError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${rows.length} rows`)
        return send(res, status, JSON.stringify(rows[0]), extra)
      }
      return send(res, status, json, extra)
    }

    try {
      /* functions */
      const fn = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/)
      if (fn) {
        if (req.method !== 'POST') throw restError(405, 'PGRST101', 'Call functions with POST')
        return await asCaller(claims, async tx => {
          const f = (await tx.query(
            `select p.proretset, t.typtype, t.typname, p.pronargs, p.proargnames,
                    array(select format_type(u, null) from unnest(p.proargtypes::oid[]) u) as argtypes
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
             where n.nspname = 'public' and p.proname = $1 and t.typname <> 'trigger' order by p.pronargs desc limit 1`, [fn[1]])).rows[0]
          if (!f) throw restError(404, 'PGRST202', `Could not find the function public.${fn[1]} in the schema cache`)
          const names = (f.proargnames ?? []).slice(0, f.pronargs)
          const args = [], params = []
          for (const [name, value] of Object.entries(body ?? {})) {
            const i = names.indexOf(name)
            if (i < 0) throw restError(404, 'PGRST202', `public.${fn[1]} has no parameter "${name}"`)
            const type = f.argtypes[i]
            params.push(value === null || value === undefined ? null
              : /^jsonb?$/.test(type) ? JSON.stringify(value)
              : type.endsWith('[]') ? pgArray(value)
              : typeof value === 'object' ? JSON.stringify(value) : String(value))
            args.push(`${ident(name)} := $${params.length}::${type}`)
          }
          const call = `public.${ident(fn[1])}(${args.join(', ')})`
          if (f.typname === 'void') { await tx.query(`select ${call}`, params); return send(res, 204) }
          const scalar = f.typtype === 'b' || f.typtype === 'e' || f.typtype === 'd'
          const sql = !f.proretset ? `select to_json(${call})::text as body`
            : scalar ? `select coalesce(json_agg(x), '[]')::text as body from ${call} x`
            : `select coalesce(json_agg(t), '[]')::text as body from (select * from ${call}) t`
          return send(res, 200, (await tx.query(sql, params)).rows[0].body ?? 'null')
        })
      }

      /* tables */
      const m = url.pathname.match(/^\/rest\/v1\/([a-z_][a-z0-9_]*)$/)
      if (!m) throw restError(404, 'PGRST100', 'Not found')
      const table = `public.${ident(m[1])}`
      const cols = columnsOf(url.searchParams.get('select'))
      const returning = prefer.includes('return=representation')

      return await asCaller(claims, async tx => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const params = []
          const where = whereOf(url.searchParams, params)
          const filter = where.length ? ` where ${where.join(' and ')}` : ''
          const limit = url.searchParams.get('limit'), offset = url.searchParams.get('offset')
          const page = (limit ? ` limit ${Math.max(0, parseInt(limit, 10) || 0)}` : '') + (offset ? ` offset ${Math.max(0, parseInt(offset, 10) || 0)}` : '')
          const extra = {}
          if (prefer.includes('count=exact')) {
            const n = (await tx.query(`select count(*)::int as n from ${table}${filter}`, params)).rows[0].n
            extra['Content-Range'] = `${n ? `0-${n - 1}` : '*'}/${n}`
          }
          if (req.method === 'HEAD') return send(res, 200, '', extra)
          const sql = `select ${cols} from ${table}${filter}${orderOf(url.searchParams.get('order'))}${page}`
          return reply(200, (await tx.query(`select coalesce(json_agg(t), '[]')::text as body from (${sql}) t`, params)).rows[0].body, extra)
        }

        if (req.method === 'POST') {
          const rows = Array.isArray(body) ? body : [body ?? {}]
          const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]
          if (!keys.length) throw restError(400, 'PGRST102', 'Nothing to insert')
          const list = keys.map(ident).join(', ')
          let conflict = ''
          if (prefer.includes('resolution=')) {
            const on = (url.searchParams.get('on_conflict')?.split(',') ?? await primaryKeyOf(tx, m[1])).map(c => c.trim())
            const rest = keys.filter(k => !on.includes(k))
            conflict = ` on conflict (${on.map(ident).join(', ')}) ` + (prefer.includes('merge-duplicates') && rest.length
              ? `do update set ${rest.map(k => `${ident(k)} = excluded.${ident(k)}`).join(', ')}` : 'do nothing')
          }
          const sql = `with changed as (insert into ${table} (${list}) select ${list} from json_populate_recordset(null::${table}, $1::json)${conflict} returning *)
                       select coalesce(json_agg(t), '[]')::text as body from (select ${cols} from changed) t`
          const out = (await tx.query(sql, [JSON.stringify(rows)])).rows[0].body
          return returning ? reply(201, out) : send(res, 201)
        }

        if (req.method === 'PATCH' || req.method === 'DELETE') {
          const params = req.method === 'PATCH' ? [JSON.stringify(body ?? {})] : []
          const where = whereOf(url.searchParams, params)
          if (!where.length) throw restError(400, 'PGRST106', 'Refusing to change every row: add a filter')
          let action
          if (req.method === 'PATCH') {
            const keys = Object.keys(body ?? {})
            if (!keys.length) throw restError(400, 'PGRST102', 'Nothing to update')
            const list = keys.map(ident).join(', ')
            action = `update ${table} set (${list}) = (select ${list} from json_populate_record(null::${table}, $1::json)) where ${where.join(' and ')}`
          } else action = `delete from ${table} where ${where.join(' and ')}`
          const out = (await tx.query(`with changed as (${action} returning *) select coalesce(json_agg(t), '[]')::text as body from (select ${cols} from changed) t`, params)).rows[0].body
          return returning ? reply(200, out) : send(res, 204)
        }

        throw restError(405, 'PGRST101', 'Method not allowed')
      })
    } catch (e) {
      throw e instanceof HttpError ? e : fromDatabase(e, signedIn)
    }
  }

  /* ─── Document files ──────────────────────────────────────────────── */
  const memoryFiles = new Map()
  const storageRoot = memory ? null : join(dataDir, 'storage')
  /** bucket/patient-id/file: letters, digits, dot, dash and underscore only, so a path can never climb out of the folder. */
  function fileKey(bucket, objectPath) {
    const parts = objectPath.split('/')
    if (bucket !== 'documents' || parts.length < 2 || parts.some(p => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(p)))
      throw storageError(400, 'InvalidKey', 'Invalid file path')
    return parts.join('/')
  }
  const diskPath = key => {
    const full = resolve(storageRoot, 'documents', ...key.split('/'))
    if (!full.startsWith(resolve(storageRoot) + sep)) throw storageError(400, 'InvalidKey', 'Invalid file path')
    return full
  }

  async function storage(req, res, url, claims, raw) {
    const m = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([a-z0-9_-]+)\/(.+)$/)
    if (claims.role === 'anon') throw storageError(401, 'Unauthorized', 'Sign in to use document files')
    const service = claims.role === 'service_role'

    if (m && (req.method === 'POST' || req.method === 'PUT')) {
      const key = fileKey(m[1], decodeURIComponent(m[2]))
      if (!raw.length) throw storageError(400, 'InvalidRequest', 'The file is empty')
      if (raw.length > MAX_FILE) throw storageError(413, 'Payload too large', 'The file is too large (max 20 MB)')
      const owner = key.split('/')[0]
      // The same rule the hosted bucket uses: your own folder, or the folder of a patient you treat.
      const allowed = service || owner === claims.sub || (await asCaller(claims, async tx => {
        try { return (await tx.query(`select public.treats($1::uuid) as ok`, [owner])).rows[0].ok } catch { return false }
      }))
      if (!allowed) throw storageError(403, 'Unauthorized', 'new row violates row-level security policy')
      const meta = { contentType: String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0], size: raw.length }
      if (memory) {
        if (memoryFiles.has(key) && req.headers['x-upsert'] !== 'true' && req.method === 'POST') throw storageError(409, 'Duplicate', 'The resource already exists')
        memoryFiles.set(key, { raw, meta })
      } else {
        const file = diskPath(key)
        if (fs.existsSync(file) && req.headers['x-upsert'] !== 'true' && req.method === 'POST') throw storageError(409, 'Duplicate', 'The resource already exists')
        fs.mkdirSync(dirname(file), { recursive: true })
        fs.writeFileSync(file, raw)
        fs.writeFileSync(`${file}.meta`, JSON.stringify(meta))
      }
      return send(res, 200, { Key: `documents/${key}`, Id: sha256(key).slice(0, 32) })
    }

    if (m && req.method === 'GET') {
      const key = fileKey(m[1], decodeURIComponent(m[2]))
      // Readable only through a document row the caller may open: can_open_document decides, as it does for the row itself.
      const allowed = service || (await asCaller(claims, async tx =>
        (await tx.query(`select 1 from public.documents where file_path = $1 limit 1`, [key])).rows.length > 0))
      const stored = memory ? memoryFiles.get(key) : fs.existsSync(diskPath(key)) && {
        raw: fs.readFileSync(diskPath(key)), meta: JSON.parse(fs.readFileSync(`${diskPath(key)}.meta`, 'utf8')) }
      // One answer for "not there" and "not yours", so paths cannot be probed.
      if (!allowed || !stored) throw storageError(400, 'not_found', 'Object not found')
      res.writeHead(200, { ...CORS, 'Content-Type': stored.meta.contentType, 'Content-Length': stored.raw.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      return res.end(stored.raw)
    }

    throw storageError(404, 'not_found', 'Not available on the local backend')
  }

  /* ─── HTTP ────────────────────────────────────────────────────────── */
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-client-info, x-upsert, cache-control, x-supabase-api-version',
    'Access-Control-Expose-Headers': 'content-range',
    'Access-Control-Max-Age': '600',
  }
  function send(res, status, body, extra = {}) {
    if (body === undefined || status === 204) { res.writeHead(status === 204 ? 204 : status, { ...CORS, ...extra }); return res.end() }
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra })
    res.end(text)
  }
  const readBody = req => new Promise((done, fail) => {
    const chunks = []; let size = 0
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { fail(new HttpError(413, { message: 'Request too large' })); req.destroy() } else chunks.push(c) })
    req.on('end', () => done(Buffer.concat(chunks)))
    req.on('error', fail)
  })

  /** Who is asking: the signed-in person, a server-side script holding the service key, or nobody. */
  function claimsOf(req) {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String(req.headers.apikey ?? '')
    if (!bearer) throw new HttpError(401, { message: 'No API key found in request', hint: 'Send the anon key in the "apikey" header' })
    const claims = readJwt(bearer, secret)
    if (!claims) throw new HttpError(401, { code: 'PGRST301', message: 'Invalid JWT' })
    if (claims.role === 'authenticated') {
      if (!claims.exp || claims.exp < Date.now() / 1000) throw new HttpError(401, { code: 'PGRST301', message: 'JWT expired' })
      if (!sessions.has(claims.session_id)) throw new HttpError(401, { code: 'PGRST301', message: 'Session ended. Sign in again.' })
    }
    return claims
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204)
      const url = new URL(req.url, 'http://local')
      if (url.pathname === '/health') return send(res, 200, { ok: true, engine: 'PGlite (Postgres)', migrations: fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).length })
      if (url.pathname === '/__dev/auth-codes' && req.method === 'GET') {
        if (!exposeTestAuth) return send(res, 404, { message: 'Not found' })
        const email = (url.searchParams.get('email') ?? '').trim().toLowerCase()
        const kind = url.searchParams.get('kind')
        if (!email || !['signup', 'recovery'].includes(kind)) return send(res, 400, { message: 'Email and a supported code kind are required' })
        const message = outbox.find(item => item.to.toLowerCase() === email && item.kind === kind)
        return send(res, 200, { code: message?.code ?? null, link: message?.link ?? null }, { 'Cache-Control': 'no-store' })
      }
<<<<<<< Updated upstream
=======
      // npm run backend:seed: spreads seeded readings over the past days, which the API never allows (every reading
      // is stamped with the server's clock). Local backend, service key, test patients (@mcare.test) only.
      if (url.pathname === '/__dev/backdate-readings' && req.method === 'POST') {
        if (!exposeTestAuth) return send(res, 404, { message: 'Not found' })
        if (claimsOf(req).role !== 'service_role') return send(res, 403, { message: 'Only the seed script can do this' })
        let moves
        try { moves = JSON.parse((await readBody(req)).toString('utf8')) } catch { moves = null }
        if (!Array.isArray(moves) || moves.some(m => typeof m?.id !== 'string' || Number.isNaN(Date.parse(m?.at)))) {
          return send(res, 400, { message: 'Send a list of { id, at }' })
        }
        const moved = await exclusive(() => db.transaction(async tx => {
          await tx.query(`set local session_replication_role = replica`)   // the reading guards refuse any move
          let n = 0
          for (const m of moves) {
            n += (await tx.query(`update public.readings r set taken_at = $2 from public.profiles p
              where r.id = $1 and p.id = r.patient_id and p.email like '%@mcare.test'`, [m.id, new Date(m.at).toISOString()])).affectedRows ?? 0
          }
          return n
        }))
        return send(res, 200, { moved })
      }
      // The local stand-in for Realtime (see "Change notices"): answers as soon as anything was saved, or after 25 s.
      if (url.pathname === '/__dev/changes' && req.method === 'GET') {
        const who = claimsOf(req)
        if (who.role === 'anon') return send(res, 401, { message: 'Sign in first' })
        const since = Number(url.searchParams.get('since') ?? -1)
        if (since !== pulse) return send(res, 200, { pulse }, { 'Cache-Control': 'no-store' })
        return await new Promise(done => {
          const wake = () => { clearTimeout(timer); done(send(res, 200, { pulse }, { 'Cache-Control': 'no-store' })) }
          const timer = setTimeout(() => { waiters.delete(wake); done(send(res, 200, { pulse }, { 'Cache-Control': 'no-store' })) }, 25_000)
          waiters.add(wake)
          req.on('close', () => { clearTimeout(timer); waiters.delete(wake) })
        })
      }
      // npm run backend:stop: a clean stop for a backend started where Ctrl+C cannot reach it. Service key only.
      if (url.pathname === '/__dev/stop' && req.method === 'POST') {
        if (!options.onStop) return send(res, 404, { message: 'Not found' })
        if (claimsOf(req).role !== 'service_role') return send(res, 403, { message: 'Only this machine can stop the backend' })
        send(res, 202, { stopping: true })
        return setImmediate(options.onStop)
      }
      if ((req.method === 'GET' && (url.pathname === '/auth/v1/verify' || url.pathname === '/auth/v1/callback')) || url.pathname.startsWith('/auth/v1/authorize')) return await browserAuth(req, res, url)
>>>>>>> Stashed changes
      const area = url.pathname.split('/')[1]
      if (!['auth', 'rest', 'storage'].includes(area)) return send(res, 404, { message: 'Not found' })
      const claims = claimsOf(req)
      const raw = await readBody(req)
      if (area === 'storage') return await storage(req, res, url, claims, raw)
      let body
      try { body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined } catch { throw new HttpError(400, { code: 'PGRST102', message: 'The request body is not valid JSON' }) }
      if (area === 'auth') return await auth(req, res, url, claims, body ?? {})
      try { return await rest(req, res, url, claims, body) }
      catch (e) {
        if (!(e instanceof HttpError) || !MISSING.has(e.body.code) || !(await catchUp())) throw e
        primaryKeys.clear()
        return await rest(req, res, url, claims, body)
      }
    } catch (e) {
      if (res.headersSent) return res.end()
      if (e instanceof HttpError) return send(res, e.status, e.body)
      console.error(e)
      send(res, 500, { code: 'XX000', message: 'The local backend hit an unexpected error', details: String(e?.message ?? e) })
    }
  })
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, done) })
  const actualPort = server.address().port

  /* scheduled jobs: what pg_cron runs on a hosted project */
  /* the sender: what supabase/functions/deliver does on a hosted project. Here every email, text message and push is printed, not sent. */
  async function deliverQueued() {
    let sent = 0
    // Until the queue is empty, a batch at a time.
    for (;;) {
      const { rows } = await q(`select * from public.claim_deliveries(20)`)
      for (const d of rows) {
        outbox.unshift({ to: d.to_address, kind: d.notification_id || d.user_id ? 'notification' : 'invitation', channel: d.channel, subject: d.subject, body: d.body, at: Date.now() })
        outbox.length = Math.min(outbox.length, 50)
        const icon = d.channel === 'sms' ? '📱' : d.channel === 'push' ? '🔔' : '✉ '
        say(`  ${icon} ${d.channel} → ${d.channel === 'push' ? 'device' : d.to_address}: ${d.subject}${d.body ? ` · ${d.body}` : ''}  (local backend: nothing is sent)`)
        await q(`select public.finish_delivery($1, true)`, [d.id])
      }
      sent += rows.length
      if (rows.length < 20) return sent
    }
  }

  const timers = options.jobs === false ? [] : [
    setInterval(() => { deliverQueued().catch(e => console.error('delivery job:', e.message)) }, 10_000),
    setInterval(() => { q(`select public.escalate_stale_alerts()`).catch(e => console.error('escalation job:', e.message)) }, 60_000),
    setInterval(() => { q(`select public.purge_deleted_documents()`).catch(e => console.error('purge job:', e.message)) }, 6 * 3600_000),
    setInterval(() => { q(`select public.complete_ended_prescriptions()`).catch(e => console.error('prescription job:', e.message)) }, 3600_000),
  ]
  timers.forEach(t => t.unref())

  return {
<<<<<<< Updated upstream
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`, port: actualPort, anonKey, serviceKey, outbox, db, dataDir,
=======
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`, port: actualPort, anonKey, serviceKey, outbox, db, dataDir, opened,
    /** Where Google sends people back to, when real Google sign-in is set up; null when the stand-in plays it. */
    googleRedirect: google?.redirectUri ?? null,
>>>>>>> Stashed changes
    /** Runs SQL as the database owner. For tests and scripts only. */
    sql: (text, params) => q(text, params),
    /** Sends what is waiting in the email queue now (the job does this every 10 s). Resolves with how many. */
    deliver: deliverQueued,
    close: async () => {
      timers.forEach(clearInterval)
      await new Promise(done => server.close(done))
      await exclusive(() => db.close())
    },
  }
}

/* ─── Started from the command line ─────────────────────────────────── */
/** Points the app at this backend, unless .env.local already names another project. */
function writeEnv(anonKey) {
  const file = join(ROOT, '.env.local')
  const lines = [
    '# Written by `npm run backend` (supabase/dev/server.mjs). Points the app at the local mCare backend.',
    '# "/" means "the address the app was opened from": the dev server forwards /auth, /rest and /storage to the backend,',
    '# so the same setting works on this laptop and on a phone on the same network.',
    '# Delete this file to go back to demo mode (sample data kept in memory).',
    'VITE_SUPABASE_URL=/',
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    '',
  ].join('\n')
  if (!fs.existsSync(file)) { fs.writeFileSync(file, lines); return 'created' }
  const current = fs.readFileSync(file, 'utf8')
  const url = current.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim()
  if (url && url !== '/') return 'other'          // a hosted project: leave it alone
  if (current.includes(`VITE_SUPABASE_ANON_KEY=${anonKey}`) && url === '/') return 'ok'
  fs.writeFileSync(file, lines)
  return 'updated'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('\nmCare local backend')
  const backend = await startBackend()
  const env = writeEnv(backend.anonKey)
  const appPort = process.env.PORT || 8443
  console.log(`  database   ${backend.dataDir === 'memory' ? 'in memory' : join(backend.dataDir, 'pg')}`)
  console.log(`  listening  ${backend.url}  (reached by the app through the dev server on port ${appPort})`)
  console.log(env === 'other' ? '  .env.local names another backend: left unchanged, so the app is NOT using this one'
    : `  .env.local ${env === 'ok' ? 'already points here' : `${env}: the app now runs in live mode`}`)
  console.log(backend.googleRedirect
    ? `  Google     real sign-in; Google returns to ${backend.googleRedirect} (open the app at that address)`
    : '  Google     local stand-in page (real Google: save the OAuth client as supabase/.data/google-oauth.json; README)')
  console.log(`\n  Open the app   this laptop   http://localhost:${appPort}`)
  for (const ip of lanAddresses()) console.log(`                 phone / LAN   http://${ip}:${appPort}`)
  console.log('\n  First time?    npm run backend:seed   creates the labelled test accounts')
  console.log('  Ctrl+C stops the backend. The data stays in supabase/.data.\n')
  const stop = async () => { await backend.close().catch(() => {}); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
