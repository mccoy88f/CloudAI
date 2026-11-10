import type { EngineKind, EngineStatus, EngineSummary } from "@cloudai/shared"
import { randomUUID } from "node:crypto"
import { decryptSecret, encryptSecret } from "./crypto.js"
import { sql } from "./db.js"
import { callRunner } from "./runner.js"

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
  secret: string | null
  baseUrl: string | null
  model: string | null
}): Promise<EngineSummary> {
  const id = randomUUID()
  if (input.kind !== "openai") await ensureEngineHome(id)
  const status = input.kind === "openai" ? "connected" : "login"
  const rows = await sql<EngineRow[]>`
    insert into engines (id, name, kind, status, secret_enc, base_url, model)
    values (
      ${id},
      ${input.name},
      ${input.kind},
      ${status},
      ${input.secret ? encryptSecret(input.secret) : null},
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
  if (kind !== "openai") throw new Error("Usa l'accesso della CLI")
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

export async function beginCliLogin(id: string): Promise<LoginState> {
  const kind = await engineKind(id)
  if (kind !== "claude" && kind !== "cursor" && kind !== "gemini") throw new Error("Questo motore non usa l'accesso della CLI")
  await ensureEngineHome(id)
  await sql`update engines set status = 'login', secret_enc = null where id = ${id}`
  const state = await callRunner<LoginState>(`/engines/${id}/login`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  })
  return settleLogin(id, state)
}

export async function cliLoginState(id: string): Promise<LoginState> {
  const state = await callRunner<LoginState>(`/engines/${id}/login`)
  return settleLogin(id, state)
}

export async function sendCliLogin(id: string, text: string): Promise<LoginState> {
  const state = await callRunner<LoginState>(`/engines/${id}/login/input`, {
    method: "POST",
    body: JSON.stringify({ text }),
  })
  return settleLogin(id, state)
}

async function settleLogin(id: string, state: LoginState): Promise<LoginState> {
  if (state.exitCode === 0) {
    await sql`update engines set status = 'connected', secret_enc = null where id = ${id}`
  }
  return state
}

async function engineKind(id: string): Promise<EngineKind | null> {
  const rows = await sql<{ kind: EngineKind }[]>`select kind from engines where id = ${id}`
  return rows[0]?.kind ?? null
}

type LoginState = {
  output: string
  url: string | null
  running: boolean
  exitCode: number | null
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
  secret: string | null
} | null> {
  const rows = await sql<
    {
      id: string
      name: string
      kind: EngineKind
      status: EngineStatus
      baseUrl: string | null
      model: string | null
      secretEnc: string | null
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
    secret: row.secretEnc ? decryptSecret(row.secretEnc) : null,
  }
}

export function isUniqueName(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
}
