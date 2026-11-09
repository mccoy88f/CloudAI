import { createNodeWebSocket } from "@hono/node-ws"
import type { HealthReport, PublicUser, SessionSocketEvent, SetupState, SetupStep } from "@cloudai/shared"
import type { Context, MiddlewareHandler } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { Hono } from "hono"
import {
  acceptInvite,
  countUsers,
  createInvite,
  createSession,
  deleteSession,
  findUserByEmail,
  findUserBySession,
  insertUser,
} from "./accounts.js"
import { encryptSecret, hashPassword, verifyPassword } from "./crypto.js"
import { readCreatedAt, readState, sql, writeState } from "./db.js"

const COOKIE = "cloudai_session"
const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

type AppVariables = { user: PublicUser }
type AppContext = Context<{ Variables: AppVariables }>

const app = new Hono<{ Variables: AppVariables }>()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

export function createApp() {
  return { app, injectWebSocket }
}

function fail(c: AppContext, status: 400 | 401 | 403 | 409 | 410, error: string) {
  return c.json({ error }, status)
}

function writeSessionCookie(c: AppContext, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: c.req.header("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 30,
  })
}

const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const token = getCookie(c, COOKIE)
  if (!token) return fail(c, 401, "Accesso richiesto")
  const user = await findUserBySession(token)
  if (!user) return fail(c, 401, "Accesso richiesto")
  c.set("user", user)
  await next()
}

const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  if (c.get("user").role !== "admin") return fail(c, 403, "Solo l'amministratore può farlo")
  await next()
}

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
    const response = await fetch(`${runnerUrl}/health`, { signal: AbortSignal.timeout(2000) })
    runner = response.ok ? "up" : "down"
  } catch {
    runner = "down"
  }

  return { ok: db === "up" && runner === "up", db, runner, createdAt }
}

async function readSetup(): Promise<SetupState> {
  const hasAdmin = (await countUsers()) > 0
  const stored = (await readState("wizard_step")) as SetupStep | null
  const step: SetupStep = !hasAdmin ? "admin" : stored && stored !== "admin" ? stored : "github"
  const appId = (await readState("github_app_id")) ?? ""
  const organization = (await readState("github_organization")) ?? ""
  const privateKey = await readState("github_private_key")
  return {
    completed: step === "done",
    hasAdmin,
    step,
    github: { configured: Boolean(appId && organization && privateKey), appId, organization },
    workspacesDir: (await readState("workspaces_dir")) ?? "/workspaces",
    publicUrl: (await readState("public_url")) ?? "",
    previewDomain: (await readState("preview_domain")) ?? "",
  }
}

async function assertStep(c: AppContext, expected: SetupStep) {
  const setup = await readSetup()
  if (setup.completed) return fail(c, 409, "La configurazione è già conclusa")
  if (setup.step !== expected) return fail(c, 409, "Completa il passo precedente")
  return null
}

app.get("/api/health", async (c) => {
  const report = await healthReport()
  return c.json(report, report.ok ? 200 : 503)
})

app.get("/api/setup", async (c) => c.json(await readSetup()))

app.get("/api/me", requireUser, (c) => c.json(c.get("user")))

app.post("/api/login", async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = readEmail(body?.email)
  const password = typeof body?.password === "string" ? body.password : ""
  const user = email ? await findUserByEmail(email) : null
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return fail(c, 401, "Email o password non validi")
  }
  writeSessionCookie(c, await createSession(user.id))
  return c.json({ id: user.id, email: user.email, role: user.role } satisfies PublicUser)
})

app.post("/api/logout", async (c) => {
  const token = getCookie(c, COOKIE)
  if (token) await deleteSession(token)
  deleteCookie(c, COOKIE, { path: "/" })
  return c.json({ ok: true })
})

app.post("/api/setup/admin", async (c) => {
  if ((await countUsers()) > 0) return fail(c, 409, "L'amministratore esiste già")
  const body = await c.req.json().catch(() => null)
  const email = readEmail(body?.email)
  const password = readPassword(body?.password)
  if (!email || !password) return fail(c, 400, "Email e password di almeno 8 caratteri")
  const user = await insertUser(email, await hashPassword(password), "admin")
  await writeState("wizard_step", "github")
  writeSessionCookie(c, await createSession(user.id))
  return c.json(user, 201)
})

app.post("/api/setup/github", requireUser, requireAdmin, async (c) => {
  const closed = await assertStep(c, "github")
  if (closed) return closed
  const body = await c.req.json().catch(() => null)
  const appId = readAppId(body?.appId)
  const organization = readOrganization(body?.organization)
  const privateKey = readPrivateKey(body?.privateKey)
  const webhookSecret = readSecret(body?.webhookSecret)
  if (!appId || !organization || !privateKey || !webhookSecret) {
    return fail(c, 400, "App ID, organizzazione, chiave privata e webhook secret sono obbligatori")
  }
  await writeState("github_app_id", appId)
  await writeState("github_organization", organization)
  await writeState("github_private_key", encryptSecret(privateKey))
  await writeState("github_webhook_secret", encryptSecret(webhookSecret))
  await writeState("wizard_step", "folder")
  return c.json(await readSetup())
})

app.post("/api/setup/folder", requireUser, requireAdmin, async (c) => {
  const closed = await assertStep(c, "folder")
  if (closed) return closed
  const body = await c.req.json().catch(() => null)
  const path = readAbsolutePath(body?.path)
  if (!path) return fail(c, 400, "Serve un percorso assoluto, senza ..")
  await writeState("workspaces_dir", path)
  await writeState("wizard_step", "url")
  return c.json(await readSetup())
})

app.post("/api/setup/url", requireUser, requireAdmin, async (c) => {
  const closed = await assertStep(c, "url")
  if (closed) return closed
  const body = await c.req.json().catch(() => null)
  const publicUrl = readPublicUrl(body?.publicUrl)
  if (!publicUrl) return fail(c, 400, "Serve un URL http o https")
  await writeState("public_url", publicUrl)
  await writeState("wizard_step", "preview")
  return c.json(await readSetup())
})

app.post("/api/setup/preview", requireUser, requireAdmin, async (c) => {
  const closed = await assertStep(c, "preview")
  if (closed) return closed
  const body = await c.req.json().catch(() => null)
  const previewDomain = readHostname(body?.previewDomain)
  if (!previewDomain) return fail(c, 400, "Serve un dominio, senza schema e senza asterisco")
  await writeState("preview_domain", previewDomain)
  await writeState("wizard_step", "done")
  return c.json(await readSetup())
})

app.post("/api/invites", requireUser, requireAdmin, async (c) => {
  const setup = await readSetup()
  if (!setup.completed) return fail(c, 409, "Concludi la configurazione prima di invitare")
  const body = await c.req.json().catch(() => null)
  const email = readEmail(body?.email)
  if (!email) return fail(c, 400, "Email non valida")
  if (await findUserByEmail(email)) return fail(c, 409, "Questa email ha già un account")
  const token = await createInvite(email, c.get("user").id)
  return c.json({ path: `/invito?token=${encodeURIComponent(token)}` }, 201)
})

app.post("/api/invites/accept", async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token : ""
  const password = readPassword(body?.password)
  if (!token || !password) return fail(c, 400, "Link e password di almeno 8 caratteri")
  const result = await acceptInvite(token, await hashPassword(password))
  if (result === "invalid") return fail(c, 410, "Invito assente, scaduto o già usato")
  if (result === "taken") return fail(c, 409, "Questa email ha già un account")
  writeSessionCookie(c, await createSession(result.id))
  return c.json(result)
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

function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function readPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) return null
  return value
}

function readAppId(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value.trim())) return null
  return value.trim()
}

function readOrganization(value: unknown): string | null {
  if (typeof value !== "string") return null
  const organization = value.trim()
  return /^[A-Za-z0-9-]{1,100}$/.test(organization) ? organization : null
}

function readPrivateKey(value: unknown): string | null {
  if (typeof value !== "string" || !value.includes("PRIVATE KEY")) return null
  return value.trim()
}

function readSecret(value: unknown): string | null {
  if (typeof value !== "string") return null
  const secret = value.trim()
  return secret.length >= 8 && secret.length <= 200 ? secret : null
}

function readAbsolutePath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const path = value.trim()
  if (!path.startsWith("/") || path.includes("..") || path.includes("\0")) return null
  return path
}

function readPublicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

function readHostname(value: unknown): string | null {
  if (typeof value !== "string") return null
  const host = value.trim().toLowerCase().replace(/\.$/, "")
  if (!host.includes(".") || host.includes("*") || host.includes("/") || host.includes(":")) return null
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
    return null
  }
  return host
}
