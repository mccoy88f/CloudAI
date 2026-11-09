import { getRequestListener } from "@hono/node-server"
import { mkdir, rm, stat } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { streamSSE } from "hono/streaming"
import { Hono } from "hono"
import type { EngineKind } from "@cloudai/shared"
import { readBranchName, readPort, splitCommand } from "@cloudai/shared"
import { permission, stop, submit, subscribe, type SessionSpec } from "./live.js"
import { listFiles, readBytes, readDocument, writeDocument } from "./files.js"
import { checkoutBranch, cloneRepo, commitAll, gitSnapshot, pushHead } from "./git.js"
import { appendArchive, ensureProjectKnowledge, projectMemory } from "./knowledge.js"
import { addPackage, listPackages, removePackage } from "./packages.js"
import { forgetPreview, handlePreviewHttp, handlePreviewUpgrade, previewStates, startPreview, stopAllPreviews, stopPreview, stopProject } from "./previews.js"

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

app.post("/projects/:id/knowledge", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  await ensureProjectKnowledge(dir)
  return c.json({ ok: true })
})

app.delete("/projects/:id", async (c) => {
  const id = c.req.param("id")
  const dir = inside(workspacesDir, id)
  if (!dir || !id) return c.json({ error: "Identificativo non valido" }, 400)
  stopProject(id)
  await rm(dir, { recursive: true, force: true })
  return c.json({ ok: true })
})

app.get("/projects/:id/files", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  if (!(await exists(dir))) return c.json({ error: "Progetto assente" }, 404)
  await ensureProjectKnowledge(dir).catch(() => undefined)
  const listing = await listFiles(dir, c.req.query("path") ?? "")
  if (!listing) return c.json({ error: "Cartella assente" }, 404)
  return c.json(listing)
})

app.get("/projects/:id/file", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  const rel = c.req.query("path") ?? ""
  if (!dir || !rel) return c.json({ error: "Percorso non valido" }, 400)
  const document = await readDocument(dir, rel)
  if (document === "invalid") return c.json({ error: "Percorso non valido" }, 400)
  if (document === "missing") return c.json({ error: "File assente" }, 404)
  return c.json(document)
})

app.put("/projects/:id/file", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const rel = typeof body?.path === "string" ? body.path : ""
  const text = typeof body?.text === "string" ? body.text : null
  if (!rel || text === null) return c.json({ error: "Percorso non valido" }, 400)
  const result = await writeDocument(dir, rel, text)
  if (result === "large") return c.json({ error: "File troppo grande" }, 400)
  if (result !== "ok") return c.json({ error: "Percorso non valido" }, 400)
  return c.json({ ok: true })
})

app.get("/projects/:id/raw", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  const rel = c.req.query("path") ?? ""
  if (!dir || !rel) return c.json({ error: "Percorso non valido" }, 400)
  const file = await readBytes(dir, rel)
  if (!file) return c.json({ error: "File assente" }, 404)
  return c.body(new Uint8Array(file.bytes), 200, {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  })
})

app.post("/projects/:id/archive", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const who = typeof body?.who === "string" ? body.who : ""
  const text = typeof body?.text === "string" ? body.text : ""
  const at = typeof body?.at === "string" ? body.at : new Date().toISOString()
  if (!who.trim() || !text.trim()) return c.json({ error: "Voce vuota" }, 400)
  await appendArchive(dir, { at, who, text })
  return c.json({ ok: true })
})

app.get("/projects/:id/memory", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  return c.json({ text: await projectMemory(dir) })
})

app.get("/projects/:id/packages", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  if (!(await exists(dir))) return c.json({ error: "Progetto assente" }, 404)
  return c.json(await listPackages(dir))
})

app.post("/projects/:id/packages", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const manager = typeof body?.manager === "string" ? body.manager : ""
  const spec = typeof body?.spec === "string" ? body.spec : ""
  try {
    return c.json(await addPackage(dir, manager, spec))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Pacchetto non installato" }, 400)
  }
})

app.delete("/projects/:id/packages", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const manager = typeof body?.manager === "string" ? body.manager : ""
  const name = typeof body?.name === "string" ? body.name : ""
  try {
    return c.json(await removePackage(dir, manager, name))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Pacchetto non rimosso" }, 400)
  }
})

app.get("/projects/:id/git", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  try {
    return c.json(await gitSnapshot(dir))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Stato git assente" }, 400)
  }
})

app.post("/projects/:id/git/clone", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const remote = typeof body?.remote === "string" ? body.remote : ""
  const token = typeof body?.token === "string" ? body.token : ""
  try {
    return c.json({ branch: await cloneRepo(dir, remote, token) })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Clone non riuscito" }, 400)
  }
})

app.post("/projects/:id/git/branch", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name : ""
  if (!readBranchName(name)) return c.json({ error: "Nome branch non valido" }, 400)
  try {
    return c.json({ branch: await checkoutBranch(dir, name) })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Branch non creato" }, 400)
  }
})

app.post("/projects/:id/git/commit", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const message = typeof body?.message === "string" ? body.message : ""
  const authorName = typeof body?.authorName === "string" ? body.authorName : ""
  const authorEmail = typeof body?.authorEmail === "string" ? body.authorEmail : ""
  try {
    await commitAll(dir, message, authorName, authorEmail)
    return c.json({ ok: true, branch: (await gitSnapshot(dir)).branch })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Commit non riuscito" }, 400)
  }
})

app.post("/projects/:id/git/push", async (c) => {
  const dir = inside(workspacesDir, c.req.param("id"))
  if (!dir) return c.json({ error: "Identificativo non valido" }, 400)
  const body = await c.req.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token : ""
  try {
    await pushHead(dir, token)
    return c.json({ ok: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Push non riuscito" }, 400)
  }
})

app.get("/previews", (c) => c.json(previewStates()))

app.post("/previews/start", async (c) => {
  const body = await c.req.json().catch(() => null)
  const projectId = typeof body?.projectId === "string" ? body.projectId : ""
  const dir = inside(workspacesDir, projectId)
  const host = typeof body?.host === "string" ? body.host.trim().toLowerCase() : ""
  const portNumber = readPort(body?.port)
  const command = typeof body?.command === "string" ? body.command : ""
  if (!dir || !portNumber || !splitCommand(command)) return c.json({ error: "Preview non valida" }, 400)
  if (!(await exists(dir))) return c.json({ error: "Progetto assente" }, 404)
  try {
    return c.json(await startPreview({ projectId, projectDir: dir, host, port: portNumber, command }))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Preview non avviata" }, 400)
  }
})

app.post("/previews/stop", async (c) => {
  const body = await c.req.json().catch(() => null)
  const host = typeof body?.host === "string" ? body.host.trim().toLowerCase() : ""
  if (!host) return c.json({ error: "Host assente" }, 400)
  stopPreview(host)
  return c.json({ ok: true })
})

app.delete("/previews", async (c) => {
  const body = await c.req.json().catch(() => null)
  const host = typeof body?.host === "string" ? body.host.trim().toLowerCase() : ""
  if (!host) return c.json({ error: "Host assente" }, 400)
  forgetPreview(host)
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

const listener = getRequestListener(app.fetch)
const server = createServer((req, res) => {
  if (handlePreviewHttp(req, res)) return
  void listener(req, res)
})
server.on("upgrade", (req, socket, head) => {
  if (handlePreviewUpgrade(req, socket, head)) return
  socket.destroy()
})
server.listen(port, () => {
  console.log(`runner listening on ${port}`)
})
process.on("SIGTERM", () => {
  stopAllPreviews()
  server.close()
})
