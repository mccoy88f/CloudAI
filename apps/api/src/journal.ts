import type { JournalEvent, JournalKind } from "@cloudai/shared"
import { randomUUID } from "node:crypto"
import type { JSONValue } from "postgres"
import { sql } from "./db.js"

type JournalRow = {
  id: string
  projectId: string
  engineId: string | null
  engineName: string | null
  authorId: string | null
  kind: JournalKind
  text: string
  payload: Record<string, unknown> | null
  createdAt: Date | string
}

export async function listJournal(projectId: string): Promise<JournalEvent[]> {
  const rows = await sql<JournalRow[]>`
    select * from (
      select
        j.id,
        j.project_id as "projectId",
        j.engine_id as "engineId",
        e.name as "engineName",
        j.author_id as "authorId",
        j.kind,
        j.text,
        j.payload,
        j.created_at as "createdAt"
      from journal_events j
      left join engines e on e.id = j.engine_id
      where j.project_id = ${projectId}
      order by j.created_at desc
      limit 200
    ) recent
    order by "createdAt" asc
  `
  return rows.map(mapJournal)
}

export async function appendJournal(input: {
  projectId: string
  engineId: string | null
  authorId: string | null
  kind: JournalKind
  text: string
  payload?: Record<string, unknown>
}): Promise<JournalEvent> {
  const id = randomUUID()
  const rows = await sql<JournalRow[]>`
    insert into journal_events (id, project_id, engine_id, author_id, kind, text, payload)
    values (
      ${id},
      ${input.projectId},
      ${input.engineId},
      ${input.authorId},
      ${input.kind},
      ${input.text},
      ${jsonValue(input.payload ?? {})}
    )
    returning
      id,
      project_id as "projectId",
      engine_id as "engineId",
      author_id as "authorId",
      kind,
      text,
      payload,
      created_at as "createdAt"
  `
  const row = rows[0]
  if (!row) throw new Error("journal insert failed")
  const name = input.engineId ? await lookupEngineName(input.engineId) : null
  return mapJournal({ ...row, engineName: name })
}

export async function updateJournalText(id: string, text: string): Promise<void> {
  await sql`update journal_events set text = ${text} where id = ${id}`
}

export async function resolvePermission(projectId: string, requestId: string, allow: boolean): Promise<JournalEvent | null> {
  const rows = await sql<JournalRow[]>`
    select
      j.id,
      j.project_id as "projectId",
      j.engine_id as "engineId",
      e.name as "engineName",
      j.author_id as "authorId",
      j.kind,
      j.text,
      j.payload,
      j.created_at as "createdAt"
    from journal_events j
    left join engines e on e.id = j.engine_id
    where j.project_id = ${projectId} and j.kind = 'permission'
    order by j.created_at desc
    limit 30
  `
  const row = rows.find((item) => item.payload?.requestId === requestId)
  if (!row) return null
  const payload = { ...(row.payload ?? {}), resolved: allow ? "allow" : "deny" }
  await sql`update journal_events set payload = ${jsonValue(payload)} where id = ${row.id}`
  return mapJournal({ ...row, payload })
}

export async function readBinding(projectId: string, engineId: string): Promise<string | null> {
  const rows = await sql<{ nativeSessionId: string | null }[]>`
    select native_session_id as "nativeSessionId"
    from engine_bindings
    where project_id = ${projectId} and engine_id = ${engineId}
  `
  return rows[0]?.nativeSessionId ?? null
}

export async function writeBinding(projectId: string, engineId: string, nativeSessionId: string): Promise<void> {
  await sql`
    insert into engine_bindings (project_id, engine_id, native_session_id)
    values (${projectId}, ${engineId}, ${nativeSessionId})
    on conflict (project_id, engine_id) do update
    set native_session_id = excluded.native_session_id
  `
}

export function summarize(events: JournalEvent[]): string | null {
  const lines = events
    .filter((event) => event.kind === "user" || event.kind === "assistant" || event.kind === "error")
    .slice(-16)
    .map((event) => {
      const who = event.kind === "user" ? "Utente" : event.kind === "assistant" ? "Assistente" : "Errore"
      return `${who}: ${event.text.replace(/\s+/g, " ").slice(0, 500)}`
    })
  if (lines.length === 0) return null
  return lines.join("\n").slice(-8000)
}

function jsonValue(value: Record<string, unknown>) {
  return sql.json(JSON.parse(JSON.stringify(value)) as JSONValue)
}

function mapJournal(row: JournalRow): JournalEvent {
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)
  return {
    id: row.id,
    projectId: row.projectId,
    engineId: row.engineId,
    engineName: row.engineName,
    authorId: row.authorId,
    kind: row.kind,
    text: row.text,
    payload: row.payload ?? {},
    createdAt,
  }
}

async function lookupEngineName(id: string): Promise<string | null> {
  const rows = await sql<{ name: string }[]>`select name from engines where id = ${id}`
  return rows[0]?.name ?? null
}
