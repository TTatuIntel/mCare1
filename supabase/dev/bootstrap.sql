-- What a Supabase project provides before any mCare migration runs: the
-- three API roles, the `auth` schema with its users, and the default grants.
-- The local backend (server.mjs) creates this once in a new database, so the
-- migrations in ../migrations run on it unchanged.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb not null default '{"provider":"email","providers":["email"]}',
  raw_user_meta_data jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz
);

-- One row per signed-in device. Signing out removes it, which ends that device's access.
-- aal: 'aal1' after a password or code, 'aal2' once the second step (two-step sign-in) is passed.
create table auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  aal        text not null default 'aal1'
);

-- Two-step sign-in (Supabase Auth MFA): each person's authenticator apps (TOTP) and the
-- challenges they answer. The secret is the server's only; the database reads the status.
create table auth.mfa_factors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type   text not null default 'totp',
  status        text not null default 'unverified' check (status in ('unverified', 'verified')),
  secret        text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table auth.mfa_challenges (
  id          uuid primary key default gen_random_uuid(),
  factor_id   uuid not null references auth.mfa_factors (id) on delete cascade,
  created_at  timestamptz not null default now(),
  verified_at timestamptz
);

create table auth.refresh_tokens (
  token      text primary key,       -- a hash; the token itself is only ever held by the browser
  session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Emailed codes (confirm sign-up, reset password). Only a hash is kept.
create table auth.one_time_tokens (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('signup', 'recovery')),
  token_hash text not null,
  attempts   int not null default 0,
  expires_at timestamptz not null,
  primary key (user_id, kind)
);

create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

-- The API roles may call auth.uid() and friends; the tables in `auth` stay private to the server.
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's defaults: every new table and function in `public` is reachable by the API roles,
-- and row-level security then decides which rows.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
