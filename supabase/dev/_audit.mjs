import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const db = new PGlite()
await db.exec(readFileSync('supabase/dev/bootstrap.sql', 'utf8'))
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(join('supabase/migrations', f), 'utf8'))
const q = async s => (await db.query(s)).rows
console.log('== triggers per table (timing event name)')
for (const r of await q(`select c.relname t, string_agg(
    case when t.tgtype & 2 = 2 then 'B' else 'A' end || ':' || t.tgname, ' ' order by t.tgname) trg
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal group by 1 order by 1`)) console.log(r.t.padEnd(24), r.trg)
console.log('\n== tables with patient_id but no zz_touch_patient')
console.log((await q(`select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id'
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_touch_patient') order by 1`)).map(r => r.relname).join(' '))
console.log('\n== updated_at columns and who sets them')
for (const r of await q(`select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' where c.relnamespace = 'public'::regnamespace and c.relkind='r'`)) console.log(' ', r.relname)
console.log('\n== tables with no write policy (written only by functions) vs with')
for (const r of await q(`select tablename, string_agg(distinct cmd, ',') cmds from pg_policies where schemaname='public' and permissive='PERMISSIVE' group by 1 order by 1`)) console.log(' ', r.tablename.padEnd(24), r.cmds)
console.log('\n== status-like columns')
for (const r of await q(`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema='public' and column_name in ('status','approval_status','upload_state','kind','visibility') order by 1`)) console.log(' ', r.table_name.padEnd(24), r.column_name, r.udt_name)
