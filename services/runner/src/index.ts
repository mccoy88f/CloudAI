import { serve } from "@hono/node-server"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"

const port = Number(process.env.PORT ?? 4000)
const workspacesDir = process.env.WORKSPACES_DIR ?? "/workspaces"
const enginesDir = process.env.ENGINES_DIR ?? "/engines"

const app = new Hono()

app.get("/health", async (c) => {
  const workspaces = await exists(workspacesDir)
  const engines = await exists(enginesDir)
  const ok = workspaces && engines
  return c.json({ ok, workspaces, engines }, ok ? 200 : 503)
})

app.post("/engines/:id", async (c) => {
  const id = c.req.param("id")
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "Identificativo non valido" }, 400)
  }
  const home = path.join(enginesDir, id)
  await mkdir(home, { recursive: true, mode: 0o700 })
  return c.json({ ok: true, home })
})

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
