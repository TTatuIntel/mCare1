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
import { spawn } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
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

/* ─── The backend ───────────────────────────────────────────────────── */
/**
 * @param {{ port?: number, host?: string, dataDir?: string, quiet?: boolean, confirmEmail?: boolean, jobs?: boolean, exposeTestAuth?: boolean, onStop?: () => void }} [options]
 *   dataDir 'memory' keeps nothing on disk (used by the tests). onStop: called when `npm run backend:stop` asks.
 */
export async function startBackend(options = {}) {
  const port = options.port ?? Number(process.env.MCARE_BACKEND_PORT || 54321)
  const host = options.host ?? process.env.MCARE_BACKEND_HOST ?? '127.0.0.1'
  const dataDir = options.dataDir ?? process.env.MCARE_DATA_DIR ?? join(HERE, '..', '.data')
  const memory = dataDir === 'memory'
  const confirmEmail = options.confirmEmail ?? process.env.MCARE_CONFIRM_EMAIL === '1'
  const exposeTestAuth = options.exposeTestAuth ?? (process.env.NODE_ENV !== 'production')
  const say = options.quiet ? () => {} : (...a) => console.log(...a)

  /* the folder: claimed before anything opens it, so a second backend can never write into it */
  let opened = { how: memory ? 'new' : 'existing' }
  const lockFile = folders(dataDir).lock
  const release = () => { try { if (fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.rmSync(lockFile) } catch {} }
  if (!memory) {
    claimFolder(dataDir)
    try {
      await portFree(port, host)
      opened = await prepareFolder(dataDir)
    } catch (e) { release(); throw e }
  }

  /* keys: made once per data directory, never committed */
  let keys
  if (memory) keys = { jwtSecret: crypto.randomBytes(32).toString('hex') }
  else {
    const file = join(dataDir, 'keys.json')
    keys = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { jwtSecret: crypto.randomBytes(32).toString('hex') }
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(keys, null, 2))
  }
  const secret = keys.jwtSecret
  const anonKey = signJwt({ iss: 'mcare-local', role: 'anon' }, secret)
  const serviceKey = signJwt({ iss: 'mcare-local', role: 'service_role' }, secret)

  /* database */
  const db = memory ? new PGlite() : new PGlite(join(dataDir, 'pg'))
  // prepareFolder has checked a folder left by a killed run; this is for one that fails anyway. It now
  // carries postmaster.pid, so the next start checks it in a separate process and recovers.
  try { await db.waitReady } catch {
    release()
    throw new Error(`The local database in ${join(dataDir, 'pg')} could not be opened.\n`
      + `  Run "npm run backend" again: it will set the damaged folder aside and bring back the copy kept when the backend last stopped.`)
  }
  /** A start that fails once the database is open closes it first: an engine left open is what damages the folder. */
  const abandon = async e => { await db.close().catch(() => {}); release(); throw e }
  try { await db.exec(`set timezone = 'UTC'`) } catch (e) { await abandon(e) }
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
  await migrate().catch(abandon)

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

  async function sendCode(user, kind) {
    const code = String(crypto.randomInt(100000, 1000000))
    await q(`insert into auth.one_time_tokens (user_id, kind, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))
             on conflict (user_id, kind) do update set token_hash = excluded.token_hash, attempts = 0, expires_at = excluded.expires_at`,
      [user.id, kind, sha256(code + user.id), CODE_TTL_MIN[kind]])
    outbox.unshift({ to: user.email, kind, code, at: Date.now() })
    outbox.length = Math.min(outbox.length, 50)
    say(`  ✉  ${user.email}: your mCare ${kind === 'signup' ? 'confirmation' : 'password reset'} code is ${code}  (local backend: no email is sent)`)
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
      return send(res, 200, userJson(await userById(user.id)))
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
      const user = await userByEmail(body.email)
      if (user) await sendCode(user, 'recovery')   // the same answer either way, so emails cannot be looked up
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
        return send(res, 200, { code: message?.code ?? null }, { 'Cache-Control': 'no-store' })
      }
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
      // npm run backend:stop: a clean stop for a backend started where Ctrl+C cannot reach it. Service key only.
      if (url.pathname === '/__dev/stop' && req.method === 'POST') {
        if (!options.onStop) return send(res, 404, { message: 'Not found' })
        if (claimsOf(req).role !== 'service_role') return send(res, 403, { message: 'Only this machine can stop the backend' })
        send(res, 202, { stopping: true })
        return setImmediate(options.onStop)
      }
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
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, done) }).catch(e => abandon(e.code === 'EADDRINUSE'
    ? new Error(`Port ${port} is already in use: another mCare backend is probably running in another terminal.`) : e))
  const actualPort = server.address().port

  /* scheduled jobs: what pg_cron runs on a hosted project */
  /* the sender: what supabase/functions/deliver does on a hosted project. Here every email, text message and push is printed, not sent. */
  async function deliverQueued() {
    let sent = 0
    // Until the queue is empty, a batch at a time.
    for (;;) {
      const { rows } = await q(`select * from public.claim_deliveries(20)`)
      for (const d of rows) {
        outbox.unshift({ to: d.to_address, kind: d.notification_id ? 'notification' : 'invitation', channel: d.channel, subject: d.subject, body: d.body, at: Date.now() })
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
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`, port: actualPort, anonKey, serviceKey, outbox, db, dataDir, opened,
    /** Runs SQL as the database owner. For tests and scripts only. */
    sql: (text, params) => q(text, params),
    /** Sends what is waiting in the email queue now (the job does this every 10 s). Resolves with how many. */
    deliver: deliverQueued,
    /** Stops cleanly and, on disk, keeps a copy of the database to come back to after a crash. */
    close: async () => {
      timers.forEach(clearInterval)
      await new Promise(done => { server.close(() => done()); server.closeAllConnections() })
      await exclusive(() => db.close())
      if (memory) return
      try { keepCopy(dataDir) } catch (e) { console.error(`  could not keep a copy of the database: ${e.message}`) }
      release()
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

/** --check <folder>: exits 0 when the database there opens and closes cleanly. Used by prepareFolder. */
async function checkFolder(dir) {
  try { const db = new PGlite(dir); await db.waitReady; await db.close(); process.exit(0) } catch { process.exit(1) }
}

/** --reset: deletes the local database and its copies, never under a running backend. */
function reset() {
  const dataDir = process.env.MCARE_DATA_DIR ?? join(HERE, '..', '.data')
  const other = runningBackend(dataDir)
  if (other) {
    console.error(`\n  The backend (process ${other}) is still running on this database. Stop it with Ctrl+C in its terminal, then run "npm run backend:reset" again.\n`)
    process.exit(1)
  }
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) if (/^pg($|-backup|-unreadable-)/.test(f)) fs.rmSync(join(dataDir, f), { recursive: true, force: true })
  }
  console.log('Local database removed. Run "npm run backend": it creates a new one with the test accounts.')
}

/** --stop: asks the running backend to stop cleanly (for one started in a background or closed terminal). */
async function stopRunning() {
  const dataDir = process.env.MCARE_DATA_DIR ?? join(HERE, '..', '.data')
  const pid = runningBackend(dataDir)
  if (!pid) { console.log('No mCare backend is running.'); return }
  const key = readLocalKeys(dataDir)?.serviceKey
  const port = process.env.MCARE_BACKEND_PORT || 54321
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__dev/stop`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) throw new Error(`it answered ${res.status}`)
  } catch (e) {
    console.error(`Could not ask the backend (process ${pid}) to stop: ${e.cause?.message ?? e.message}. Stop it with Ctrl+C in its terminal.`)
    process.exit(1)
  }
  for (let i = 0; i < 120 && runningBackend(dataDir); i++) await new Promise(r => setTimeout(r, 250))
  if (runningBackend(dataDir)) { console.error('The backend is still stopping; check its terminal.'); process.exit(1) }
  console.log('Backend stopped cleanly.')
}

function describeOpening({ how, aside, savedAt }) {
  if (how === 'recovered') console.log('  note       the backend was not stopped cleanly last time; the database recovered')
  if (aside) {
    console.log(`  note       the database was not stopped cleanly and could not be opened. It was set aside in\n`
      + `             ${aside}`)
    console.log(how === 'restored'
      ? `             and the copy kept when the backend last stopped (${savedAt.toLocaleString()}) was brought back.`
      : '             There was no earlier copy, so a new database was created.')
  }
}

/** Creates the test accounts in a new database, as "npm run backend:seed" does. */
function seed() {
  return new Promise(done => {
    console.log('  New database: creating the test accounts…')
    const child = spawn(process.execPath, [join(HERE, 'seed.mjs')], { stdio: 'inherit' })
    child.on('exit', done)
    child.on('error', done)
  })
}

const cli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (cli && process.argv[2] === '--check') await checkFolder(process.argv[3])
else if (cli && process.argv[2] === '--reset') reset()
else if (cli && process.argv[2] === '--stop') await stopRunning()
else if (cli) {
  console.log('\nmCare local backend')
  let backend
  try { backend = await startBackend({ onStop: () => stop('asked by "npm run backend:stop" from another terminal') }) } catch (e) {
    console.error(`\n  ${e.message}\n`)
    process.exit(1)
  }
  const env = writeEnv(backend.anonKey)
  const appPort = process.env.PORT || 8443
  console.log(`  database   ${backend.dataDir === 'memory' ? 'in memory' : join(backend.dataDir, 'pg')}`)
  describeOpening(backend.opened)
  console.log(`  listening  ${backend.url}  (reached by the app through the dev server on port ${appPort})`)
  console.log(env === 'other' ? '  .env.local names another backend: left unchanged, so the app is NOT using this one'
    : `  .env.local ${env === 'ok' ? 'already points here' : `${env}: the app now runs in live mode`}`)
  console.log(`\n  Open the app   this laptop   http://localhost:${appPort}`)
  for (const ip of lanAddresses()) console.log(`                 phone / LAN   http://${ip}:${appPort}`)
  console.log('\n  Ctrl+C stops the backend (closing this terminal does too). The data stays in supabase/.data,')
  console.log('  and a copy is kept each time it stops, to come back to if it is ever killed.\n')
  // Every stop says why and when, so a backend that "just stopped" can be explained from its terminal.
  let stopping = false
  const stop = async (why, code = 0) => {
    if (stopping) return
    stopping = true
    console.log(`\n  ${new Date().toLocaleTimeString()}  Stopping the backend: ${why}…`)
    await backend.close().catch(e => console.error(`  ${e.message}`))
    console.log('  Stopped cleanly. Start it again with: npm run backend')
    process.exit(code)
  }
  const SIGNALS = { SIGINT: 'Ctrl+C', SIGBREAK: 'Ctrl+Break', SIGHUP: 'this terminal is closing', SIGTERM: 'asked to stop by the system (SIGTERM)' }
  for (const [signal, why] of Object.entries(SIGNALS)) process.on(signal, () => stop(why))
  // A bug must not leave the database open (that is what damages the folder): report it in full, then stop cleanly.
  const crashed = (kind, e) => {
    console.error(`\n  ${new Date().toLocaleTimeString()}  The backend hit an ${kind}. Please report this:\n`, e)
    stop(`after the ${kind} above`, 1)
  }
  process.on('uncaughtException', e => crashed('unexpected error', e))
  process.on('unhandledRejection', e => crashed('unhandled failure', e))
  if (backend.opened.how === 'new') await seed()
}
