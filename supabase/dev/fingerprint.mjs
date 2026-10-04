/**
 * Prints everything a set of migrations creates, in a stable order, so two
 * migration histories can be compared: the schema they build must be the same.
 *
 *   node supabase/dev/fingerprint.mjs [migrations-dir] > schema.txt
 *
 * Covers: enum types, tables (columns, defaults, identity, row-level security,
 * grants), constraints, indexes, policies, functions (definition and grants),
 * triggers, comments, and the rows the migrations insert.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(process.argv[2] ?? join(here, '..', 'migrations'))
const db = new PGlite()
await db.exec(readFileSync(join(here, 'bootstrap.sql'), 'utf8'))
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(dir, f), 'utf8')) }
  catch (e) { console.error(`${f}: ${e.message}`); process.exit(1) }
}

const rows = async sql => (await db.query(sql)).rows
const out = []
const section = (name, lines) => { out.push(`### ${name}`, ...lines.sort(), '') }

section('enums', (await rows(`
  select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname`)).map(r => `${r.typname}: ${r.labels}`))

section('tables', (await rows(`
  select c.relname, c.relrowsecurity, c.relforcerowsecurity, coalesce(c.relacl::text, '') acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`))
  .map(r => `${r.relname} rls=${r.relrowsecurity} force=${r.relforcerowsecurity} acl=${r.acl}`))

section('columns', (await rows(`
  select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull, a.attidentity, a.attgenerated,
         pg_get_expr(d.adbin, d.adrelid) def
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`))
  .map(r => `${r.relname}.${r.attname} ${r.typ}${r.attnotnull ? ' not null' : ''}${r.attidentity ? ` identity:${r.attidentity}` : ''}${r.attgenerated ? ` generated:${r.attgenerated}` : ''}${r.def ? ` default ${r.def}` : ''}`))

section('constraints', (await rows(`
  select c.relname, k.conname, pg_get_constraintdef(k.oid) def
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'`)).map(r => `${r.relname}: ${r.conname} ${r.def}`))

section('indexes', (await rows(`select indexdef from pg_indexes where schemaname = 'public'`)).map(r => r.indexdef))

section('policies', (await rows(`select * from pg_policies where schemaname = 'public'`))
  .map(r => `${r.tablename}: ${r.policyname} ${r.permissive} ${r.roles} ${r.cmd} using(${r.qual ?? ''}) check(${r.with_check ?? ''})`))

section('functions', (await rows(`
  select p.oid::regprocedure::text sig, pg_get_functiondef(p.oid) def, coalesce(p.proacl::text, '') acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')`))
  .map(r => `${r.sig} acl=${r.acl}\n${r.def.trim()}\n`))

section('triggers', (await rows(`
  select pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`)).map(r => r.def))

section('views', (await rows(`select viewname, definition from pg_views where schemaname = 'public'`)).map(r => `${r.viewname}: ${r.definition}`))

section('comments', (await rows(`
  select d.objoid::regclass::text obj, d.objsubid, d.description from pg_description d
  join pg_class c on c.oid = d.objoid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`))
  .map(r => `${r.obj}.${r.objsubid}: ${r.description}`))

// The rows the migrations themselves insert (reference data).
const tables = (await rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r'`)).map(r => r.relname)
const data = []
for (const t of tables) {
  const r = await rows(`select * from public."${t}"`)
  // Times stamped by now() differ run to run.
  for (const row of r) data.push(`${t}: ${JSON.stringify(row).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>')}`)
}
section('data', data)

process.stdout.write(out.join('\n') + '\n')
