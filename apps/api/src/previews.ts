import type { ProjectPreview } from "@cloudai/shared"
import { randomUUID } from "node:crypto"
import { readPort, readSubdomain, splitCommand } from "@cloudai/shared"
import { readState, sql } from "./db.js"
import { callRunner } from "./runner.js"

type PreviewRow = { id: string; subdomain: string; port: number; command: string }
type RunnerState = { host: string; running: boolean; error: string | null }

export async function listProjectPreviews(projectId: string): Promise<ProjectPreview[]> {
  const domain = await previewDomain()
  const rows = await sql<PreviewRow[]>`
    select id, subdomain, port, command from previews
    where project_id = ${projectId}
    order by subdomain
  `
  const states = await callRunner<RunnerState[]>("/previews").catch(() => [])
  return rows.map((row) => toPreview(row, domain, states))
}

export async function createProjectPreview(
  projectId: string,
  input: { subdomain: unknown; port: unknown; command: unknown },
): Promise<ProjectPreview> {
  const domain = await previewDomain()
  const subdomain = readSubdomain(input.subdomain)
  const port = readPort(input.port)
  const command = typeof input.command === "string" ? input.command.trim() : ""
  if (!subdomain || !port || !splitCommand(command)) throw new Error("Sottodominio, porta o comando non validi")
  const id = randomUUID()
  try {
    await sql`
      insert into previews (id, project_id, subdomain, port, command)
      values (${id}, ${projectId}, ${subdomain}, ${port}, ${command})
    `
  } catch (error) {
    const constraint = uniqueConstraint(error)
    if (constraint?.includes("subdomain")) throw new Error("Questo sottodominio è già in uso")
    if (constraint?.includes("port")) throw new Error("Questa porta è già in uso")
    throw error
  }
  return { id, subdomain, host: `${subdomain}.${domain}`, port, command, running: false, error: null }
}

export async function startProjectPreview(projectId: string, previewId: string): Promise<ProjectPreview> {
  const row = await findPreview(projectId, previewId)
  if (!row) throw new Error("Preview assente")
  const domain = await previewDomain()
  const host = `${row.subdomain}.${domain}`
  const started = await callRunner<{ running: boolean; error: string | null }>("/previews/start", {
    method: "POST",
    body: JSON.stringify({ projectId, host, port: row.port, command: row.command }),
  })
  return { ...row, host, running: started.running, error: started.error }
}

export async function stopProjectPreview(projectId: string, previewId: string): Promise<ProjectPreview> {
  const row = await findPreview(projectId, previewId)
  if (!row) throw new Error("Preview assente")
  const domain = await previewDomain()
  const host = `${row.subdomain}.${domain}`
  await callRunner("/previews/stop", { method: "POST", body: JSON.stringify({ host }) })
  return { ...row, host, running: false, error: null }
}

export async function deleteProjectPreview(projectId: string, previewId: string): Promise<boolean> {
  const row = await findPreview(projectId, previewId)
  if (!row) return false
  const domain = await previewDomain()
  await callRunner("/previews", {
    method: "DELETE",
    body: JSON.stringify({ host: `${row.subdomain}.${domain}` }),
  }).catch(() => undefined)
  const rows = await sql<{ id: string }[]>`
    delete from previews where id = ${previewId} and project_id = ${projectId} returning id
  `
  return Boolean(rows[0])
}

async function findPreview(projectId: string, previewId: string): Promise<PreviewRow | null> {
  const rows = await sql<PreviewRow[]>`
    select id, subdomain, port, command from previews
    where id = ${previewId} and project_id = ${projectId}
  `
  return rows[0] ?? null
}

async function previewDomain(): Promise<string> {
  const domain = await readState("preview_domain")
  if (!domain) throw new Error("Configura il dominio delle preview")
  return domain
}

function toPreview(row: PreviewRow, domain: string, states: RunnerState[]): ProjectPreview {
  const host = `${row.subdomain}.${domain}`
  const state = states.find((item) => item.host === host)
  return {
    id: row.id,
    subdomain: row.subdomain,
    host,
    port: row.port,
    command: row.command,
    running: state?.running ?? false,
    error: state?.error ?? null,
  }
}

function uniqueConstraint(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505" && "constraint_name" in error) {
    return String(error.constraint_name)
  }
  return null
}
