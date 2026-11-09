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
}

export async function readCreatedAt(): Promise<string | null> {
  const rows = await sql<{ value: string }[]>`
    select value from instance_state where key = 'created_at'
  `
  return rows[0]?.value ?? null
}
