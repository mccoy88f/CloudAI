import { serve } from "@hono/node-server"
import { existsSync } from "node:fs"
import { Hono } from "hono"

const port = Number(process.env.PORT ?? 4000)
const workspacesDir = process.env.WORKSPACES_DIR ?? "/workspaces"
const enginesDir = process.env.ENGINES_DIR ?? "/engines"

const app = new Hono()

app.get("/health", (c) => {
  const workspaces = existsSync(workspacesDir)
  const engines = existsSync(enginesDir)
  const ok = workspaces && engines
  return c.json({ ok, workspaces, engines }, ok ? 200 : 503)
})

serve({ fetch: app.fetch, port })
console.log(`runner listening on ${port}`)
