import { serve } from "@hono/node-server"
import { createApp } from "./app.js"
import { ensureSchema } from "./db.js"

const port = Number(process.env.PORT ?? 3000)

await ensureSchema()
const { app, injectWebSocket } = createApp()
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
console.log(`api listening on ${port}`)
