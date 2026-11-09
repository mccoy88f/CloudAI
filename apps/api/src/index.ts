import { serve } from "@hono/node-server"
import { createNodeWebSocket } from "@hono/node-ws"
import type { HealthReport, SessionSocketEvent } from "@cloudai/shared"
import { Hono } from "hono"
import { ensureSchema, readCreatedAt, sql } from "./db.js"

const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"
const port = Number(process.env.PORT ?? 3000)

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

async function healthReport(): Promise<HealthReport> {
  let db: HealthReport["db"] = "down"
  let createdAt: string | null = null
  try {
    await sql`select 1`
    createdAt = await readCreatedAt()
    db = "up"
  } catch {
    db = "down"
  }

  let runner: HealthReport["runner"] = "down"
  try {
    const response = await fetch(`${runnerUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    runner = response.ok ? "up" : "down"
  } catch {
    runner = "down"
  }

  return { ok: db === "up" && runner === "up", db, runner, createdAt }
}

app.get("/api/health", async (c) => {
  const report = await healthReport()
  return c.json(report, report.ok ? 200 : 503)
})

app.get(
  "/api/ws",
  upgradeWebSocket(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    return {
      onOpen(_event, ws) {
        const ready: SessionSocketEvent = { type: "ready" }
        ws.send(JSON.stringify(ready))
        timer = setInterval(() => {
          const ping: SessionSocketEvent = { type: "ping", at: new Date().toISOString() }
          ws.send(JSON.stringify(ping))
        }, 20_000)
      },
      onClose() {
        if (timer) clearInterval(timer)
      },
    }
  }),
)

await ensureSchema()

const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
console.log(`api listening on ${port}`)
