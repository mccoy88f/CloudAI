import type { EngineKind, EngineStatus, EngineSummary } from "@cloudai/shared"
import { randomUUID } from "node:crypto"
import { decryptSecret, encryptSecret } from "./crypto.js"
import { sql } from "./db.js"

const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

type EngineRow = {
  id: string
  name: string
  kind: EngineKind
  status: EngineStatus
  baseUrl: string | null
  model: string | null
}

export async function listEngines(): Promise<EngineSummary[]> {
  const rows = await sql<EngineRow[]>`
    select id, name, kind, status, base_url as "baseUrl", model
    from engines
    order by created_at
  `
  return rows
}

export async function insertEngine(input: {
  name: string
  kind: EngineKind
  secret: string
  baseUrl: string | null
  model: string | null
}): Promise<EngineSummary> {
  const id = randomUUID()
  if (input.kind !== "openai") await ensureEngineHome(id)
  const rows = await sql<EngineRow[]>`
    insert into engines (id, name, kind, status, secret_enc, base_url, model)
    values (
      ${id},
      ${input.name},
      ${input.kind},
      'connected',
      ${encryptSecret(input.secret)},
      ${input.baseUrl},
      ${input.model}
    )
    returning id, name, kind, status, base_url as "baseUrl", model
  `
  const engine = rows[0]
  if (!engine) throw new Error("engine insert failed")
  return engine
}

export async function reconnectEngine(
  id: string,
  input: { secret: string; baseUrl: string | null; model: string | null },
): Promise<EngineSummary | null> {
  const current = await sql<{ kind: EngineKind }[]>`select kind from engines where id = ${id}`
  const kind = current[0]?.kind
  if (!kind) return null
  if (kind !== "openai") await ensureEngineHome(id)
  const rows = await sql<EngineRow[]>`
    update engines
    set secret_enc = ${encryptSecret(input.secret)},
        base_url = coalesce(${input.baseUrl}, base_url),
        model = coalesce(${input.model}, model),
        status = 'connected'
    where id = ${id}
    returning id, name, kind, status, base_url as "baseUrl", model
  `
  return rows[0] ?? null
}

export async function disableEngine(id: string): Promise<EngineSummary | null> {
  const rows = await sql<EngineRow[]>`
    update engines
    set status = 'disabled'
    where id = ${id}
    returning id, name, kind, status, base_url as "baseUrl", model
  `
  return rows[0] ?? null
}

export async function probeOpenAI(baseUrl: string, apiKey: string): Promise<boolean> {
  const root = baseUrl.replace(/\/$/, "")
  const response = await fetch(`${root}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  })
  return response.ok
}

async function ensureEngineHome(id: string): Promise<void> {
  const response = await fetch(`${runnerUrl}/engines/${id}`, { method: "POST" })
  if (!response.ok) throw new Error("Il runner non ha preparato la home del motore")
}

export async function loadEngine(id: string): Promise<{
  id: string
  name: string
  kind: EngineKind
  baseUrl: string | null
  model: string | null
  secret: string
} | null> {
  const rows = await sql<
    {
      id: string
      name: string
      kind: EngineKind
      status: EngineStatus
      baseUrl: string | null
      model: string | null
      secretEnc: string
    }[]
  >`
    select id, name, kind, status, base_url as "baseUrl", model, secret_enc as "secretEnc"
    from engines
    where id = ${id}
  `
  const row = rows[0]
  if (!row || row.status !== "connected") return null
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    secret: decryptSecret(row.secretEnc),
  }
}

export function isUniqueName(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
}
