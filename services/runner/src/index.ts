import { serve } from "@hono/node-server"
import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { streamSSE } from "hono/streaming"
import { Hono } from "hono"
import type { EngineKind } from "@cloudai/shared"
import { permission, stop, submit, subscribe, type SessionSpec } from "./live.js"

const port = Number(process.env.PORT ?? 4000)
const workspacesDir = process.env.WORKSPACES_DIR ?? "/workspaces"
const enginesDir = process.env.ENGINES_DIR ?? "/engines"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const app = new Hono()

app.get("/health", async (c) => {
  const workspaces = await exists(workspacesDir)
  const engines = await exists(enginesDir)
  const ok = workspaces && engines
  return c.json({ ok, workspaces, engines }, ok ? 200 : 503)
})

app.post("/engines/:id", async (c) => {
  const home = inside(enginesDir, c.req.param("id"))
  if (!home) return c.json({ error: "Identificativo non valido" }, 400)
  await mkdir(home, { recursive: true, mode: 0o700 })
  return c.json({ ok: true, home })
})

app.post("/projects/:id", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return c.json({ ok: true, dir })
})

app.delete("/projects/:id", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  await rm(dir, { recursive: true, force: true })
  return c.json({ ok: true })
})

app.get("/sessions/:projectId/events", (c) => {
  const projectId = c.req.param("projectId")
  if (!projectId || !uuid.test(projectId)) return c.json({ error: "Identificativo non valido" }, 400)
  return streamSSE(c, async (stream) => {
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe(projectId, (event) => {
        void stream.writeSSE({ data: JSON.stringify(event) })
      })
      stream.onAbort(() => {
        unsubscribe()
        resolve()
      })
    })
  })
})

app.post("/sessions/:projectId/message", async (c) => {
  const projectId = c.req.param("projectId")
  if (!projectId || !uuid.test(projectId)) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const spec = readSpec(projectId, body)
  if (!spec) return c.json({ error: "Richiesta non valida" }, 400)
  return c.json(submit(spec))
})

app.post("/sessions/:projectId/permission", async (c) => {
  const projectId = c.req.param("projectId")
  if (!projectId || !uuid.test(projectId)) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const requestId = typeof body?.requestId === "string" ? body.requestId : ""
  const allow = body?.allow === true
  if (!requestId) return c.json({ error: "Richiesta non valida" }, 400)
  return c.json({ ok: permission(projectId, requestId, allow) })
})

app.post("/sessions/:projectId/stop", (c) => {
  const projectId = c.req.param("projectId")
  if (!projectId || !uuid.test(projectId)) return c.json({ error: "Identificativo non valido" }, 400)
  stop(projectId, true)
  return c.json({ ok: true })
})

function readSpec(projectId: string, body: {
  engineId?: unknown
  kind?: unknown
  secret?: unknown
  baseUrl?: unknown
  model?: unknown
  prompt?: unknown
  context?: unknown
  resumeId?: unknown
} | null): SessionSpec | null {
  if (!body || typeof body.engineId !== "string" || !uuid.test(body.engineId)) return null
  if (!isKind(body.kind) || typeof body.secret !== "string" || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return null
  }
  return {
    projectId,
    engineId: body.engineId,
    kind: body.kind,
    secret: body.secret,
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : null,
    model: typeof body.model === "string" ? body.model : null,
    prompt: body.prompt,
    context: typeof body.context === "string" ? body.context : null,
    resumeId: typeof body.resumeId === "string" ? body.resumeId : null,
  }
}

function isKind(value: unknown): value is EngineKind {
  return value === "claude" || value === "cursor" || value === "gemini" || value === "openai"
}

function inside(root: string, id: string): string | null {
  if (!uuid.test(id)) return null
  const base = path.resolve(root)
  const dir = path.resolve(base, id)
  if (dir !== path.join(base, id)) return null
  return dir
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

serve({ fetch: app.fetch, port })
console.log(`runner listening on ${port}`)
