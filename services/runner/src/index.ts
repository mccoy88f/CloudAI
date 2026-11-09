import { serve } from "@hono/node-server"
import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"

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
