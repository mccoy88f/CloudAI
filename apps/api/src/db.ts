import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

export const sql = postgres(databaseUrl, { max: 10 })

export async function ensureSchema(): Promise<void> {
  await sql`
    create table if not exists instance_state (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    )
  `
  await sql`
    insert into instance_state (key, value)
    values ('created_at', now()::text)
    on conflict (key) do nothing
  `
  await sql`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      password_hash text not null,
      role text not null check (role in ('admin', 'member')),
      created_at timestamptz not null default now()
    )
  `
  await sql`
    create table if not exists sessions (
      token_hash text primary key,
      user_id uuid not null references users (id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `
  await sql`
    create table if not exists invites (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      token_hash text not null unique,
      created_by uuid not null references users (id),
      expires_at timestamptz not null,
      accepted_at timestamptz,
      created_at timestamptz not null default now()
    )
  `
  await sql`
    create table if not exists engines (
      id uuid primary key,
      name text not null,
      kind text not null check (kind in ('claude', 'cursor', 'gemini', 'openai')),
      status text not null check (status in ('connected', 'disabled')),
      secret_enc text not null,
      base_url text,
      model text,
      created_at timestamptz not null default now()
    )
  `
  await sql`
    create unique index if not exists engines_name_lower on engines (lower(name))
  `
  await sql`
    create table if not exists projects (
      id uuid primary key,
      name text not null,
      slug text not null unique,
      created_by uuid not null references users (id),
      created_at timestamptz not null default now()
    )
  `
  await sql`
    alter table projects add column if not exists indent_size integer not null default 2
  `
  await sql`
    alter table projects add column if not exists indent_with text not null default 'space'
  `
  await sql`
    create table if not exists memberships (
      project_id uuid not null references projects (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      role text not null check (role in ('owner', 'editor', 'viewer')),
      primary key (project_id, user_id)
    )
  `
  await sql`
    create table if not exists journal_events (
      id uuid primary key,
      project_id uuid not null references projects (id) on delete cascade,
      engine_id uuid references engines (id) on delete set null,
      author_id uuid references users (id) on delete set null,
      kind text not null check (kind in ('user', 'assistant', 'tool', 'diff', 'permission', 'status', 'error')),
      text text not null default '',
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `
  await sql`
    create index if not exists journal_project_created on journal_events (project_id, created_at)
  `
  await sql`
    create table if not exists engine_bindings (
      project_id uuid not null references projects (id) on delete cascade,
      engine_id uuid not null references engines (id) on delete cascade,
      native_session_id text,
      primary key (project_id, engine_id)
    )
  `
}

export async function readState(key: string): Promise<string | null> {
  const rows = await sql<{ value: string }[]>`
    select value from instance_state where key = ${key}
  `
  return rows[0]?.value ?? null
}

export async function writeState(key: string, value: string): Promise<void> {
  await sql`
    insert into instance_state (key, value)
    values (${key}, ${value})
    on conflict (key) do update
    set value = excluded.value, updated_at = now()
  `
}

export async function readCreatedAt(): Promise<string | null> {
  const rows = await sql<{ value: string }[]>`
    select value from instance_state where key = 'created_at'
  `
  return rows[0]?.value ?? null
}
