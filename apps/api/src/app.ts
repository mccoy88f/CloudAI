import { createNodeWebSocket } from "@hono/node-ws"
import type { EngineKind, HealthReport, PublicUser, SessionSocketEvent, SetupState, SetupStep } from "@cloudai/shared"
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
import { disableEngine, insertEngine, isUniqueName, listEngines, probeOpenAI, reconnectEngine, beginCliLogin, cliLoginState, sendCliLogin } from "./engines.js"
import {
  addMember,
  createProject,
  deleteProject,
  listMembers,
  listProjects,
  projectRole,
  projectSummary,
  removeMember,
  renameProject,
  updateIndent,
  updateMemberRole,
} from "./projects.js"
import { bindProjectSession } from "./session.js"
import {
  addProjectPackage,
  listProjectPackages,
  projectBranch,
  projectCommitAndPush,
  projectGit,
  projectPullRequest,
  removeProjectPackage,
} from "./gitops.js"
import {
  createProjectPreview,
  deleteProjectPreview,
  listProjectPreviews,
  startProjectPreview,
  stopProjectPreview,
} from "./previews.js"

const COOKIE = "cloudai_session"
const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

type AppVariables = { user: PublicUser }
type AppContext = Context<{ Variables: AppVariables }>

const app = new Hono<{ Variables: AppVariables }>()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

export function createApp() {
  return { app, injectWebSocket }
}

function fail(c: AppContext, status: 400 | 401 | 403 | 404 | 409 | 410, error: string) {
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

app.get("/api/engines", requireUser, async (c) => {
  const engines = await listEngines()
  if (c.get("user").role === "admin") return c.json(engines)
  return c.json(engines.filter((engine) => engine.status === "connected"))
})

app.post("/api/engines", requireUser, requireAdmin, async (c) => {
  const setup = await readSetup()
  if (!setup.completed) return fail(c, 409, "Concludi la configurazione prima di aggiungere un motore")
  const body = await c.req.json().catch(() => null)
  const parsed = readEngineInput(body)
  if (!parsed) return fail(c, 400, "Nome o tipo non validi")
  if (parsed.kind === "openai") {
    if (!parsed.secret) return fail(c, 400, "Nome o tipo non validi")
    const reachable = await probeOpenAI(parsed.baseUrl ?? "", parsed.secret).catch(() => false)
    if (!reachable) return fail(c, 400, "L'endpoint OpenAI non risponde con questa chiave")
  }
  try {
    const engine = await insertEngine(parsed)
    return c.json(engine, 201)
  } catch (error) {
    if (isUniqueName(error)) return fail(c, 409, "Esiste già un motore con questo nome")
    return fail(c, 400, error instanceof Error ? error.message : "Motore non creato")
  }
})

app.post("/api/engines/:id/reconnect", requireUser, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null)
  const secret = readSecret(body?.apiKey)
  if (!secret) return fail(c, 400, "Serve la credenziale, almeno 8 caratteri")
  const baseUrl = body?.baseUrl == null || body.baseUrl === "" ? null : readPublicUrl(body.baseUrl)
  const model = body?.model == null || body.model === "" ? null : readModel(body.model)
  if (body?.baseUrl && !baseUrl) return fail(c, 400, "URL non valido")
  if (typeof body?.model === "string" && body.model !== "" && !model) return fail(c, 400, "Modello non valido")
  if (baseUrl) {
    const reachable = await probeOpenAI(baseUrl, secret).catch(() => false)
    if (!reachable) return fail(c, 400, "L'endpoint OpenAI non risponde con questa chiave")
  }
  try {
    const engine = await reconnectEngine(c.req.param("id"), { secret, baseUrl, model })
    if (!engine) return fail(c, 404, "Motore assente")
    return c.json(engine)
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : "Motore non ricollegato")
  }
})

app.post("/api/engines/:id/disable", requireUser, requireAdmin, async (c) => {
  const engine = await disableEngine(c.req.param("id"))
  if (!engine) return fail(c, 404, "Motore assente")
  return c.json(engine)
})

app.post("/api/engines/:id/login", requireUser, requireAdmin, async (c) => {
  try {
    return c.json(await beginCliLogin(c.req.param("id")))
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : "Accesso non avviato")
  }
})

app.get("/api/engines/:id/login", requireUser, requireAdmin, async (c) => {
  try {
    return c.json(await cliLoginState(c.req.param("id")))
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : "Accesso non disponibile")
  }
})

app.post("/api/engines/:id/login/input", requireUser, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = readLoginText(body?.text)
  if (!text) return fail(c, 400, "Manca il codice")
  try {
    return c.json(await sendCliLogin(c.req.param("id"), text))
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : "Codice non inviato")
  }
})

app.get("/api/projects", requireUser, async (c) => {
  return c.json(await listProjects(c.get("user").id))
})

app.post("/api/projects", requireUser, async (c) => {
  const setup = await readSetup()
  if (!setup.completed) return fail(c, 409, "Concludi la configurazione prima di creare un progetto")
  const body = await c.req.json().catch(() => null)
  const name = readProjectName(body?.name)
  const repo = typeof body?.repo === "string" && body.repo.trim() ? body.repo.trim() : null
  if (!name) return fail(c, 400, "Serve un nome, fino a 80 caratteri")
  try {
    return c.json(await createProject(c.get("user").id, name, repo), 201)
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : "Progetto non creato")
  }
})

app.patch("/api/projects/:id", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const projectId = c.req.param("id")
  if (!projectId) return fail(c, 404, "Progetto assente")
  const body = await c.req.json().catch(() => null)
  const hasName = body !== null && typeof body === "object" && "name" in body
  const hasIndent = body !== null && typeof body === "object" && ("indentSize" in body || "indentWith" in body)
  const name = hasName ? readProjectName(body?.name) : null
  if (hasName && !name) return fail(c, 400, "Serve un nome, fino a 80 caratteri")
  if (!name && !hasIndent) return fail(c, 400, "Nessuna modifica")
  if (hasIndent) {
    const indentSize = Number(body?.indentSize)
    const indentWith = body?.indentWith === "tab" ? "tab" : body?.indentWith === "space" ? "space" : null
    if (!Number.isInteger(indentSize) || indentSize < 1 || indentSize > 8 || !indentWith) {
      return fail(c, 400, "Indentazione non valida")
    }
    const updated = await updateIndent(projectId, indentSize, indentWith)
    if (!updated) return fail(c, 404, "Progetto assente")
  }
  if (name) {
    const renamed = await renameProject(projectId, name)
    if (!renamed) return fail(c, 404, "Progetto assente")
  }
  const project = await projectSummary(projectId, c.get("user").id)
  if (!project) return fail(c, 404, "Progetto assente")
  return c.json(project)
})

app.delete("/api/projects/:id", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  if (access.role !== "owner") return fail(c, 403, "Solo il proprietario può eliminare il progetto")
  const removed = await deleteProject(c.req.param("id"))
  if (!removed) return fail(c, 404, "Progetto assente")
  return c.json({ ok: true })
})

app.get("/api/projects/:id/members", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  return c.json(await listMembers(c.req.param("id")))
})

app.post("/api/projects/:id/members", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  if (access.role !== "owner") return fail(c, 403, "Solo il proprietario può condividere il progetto")
  const body = await c.req.json().catch(() => null)
  const email = readEmail(body?.email)
  const role = readMemberRole(body?.role)
  if (!email || !role) return fail(c, 400, "Email e ruolo non validi")
  const member = await addMember(c.req.param("id"), email, role)
  if (member === "missing") return fail(c, 404, "Questa persona non ha ancora un account")
  if (member === "exists") return fail(c, 409, "Fa già parte del progetto")
  return c.json(member, 201)
})

app.patch("/api/projects/:id/members/:userId", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  if (access.role !== "owner") return fail(c, 403, "Solo il proprietario può cambiare i ruoli")
  const body = await c.req.json().catch(() => null)
  const role = readMemberRole(body?.role)
  if (!role) return fail(c, 400, "Ruolo non valido")
  const updated = await updateMemberRole(c.req.param("id"), c.req.param("userId"), role)
  if (!updated) return fail(c, 404, "Membro assente")
  return c.json({ ok: true })
})

app.delete("/api/projects/:id/members/:userId", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  if (access.role !== "owner") return fail(c, 403, "Solo il proprietario può rimuovere un membro")
  const removed = await removeMember(c.req.param("id"), c.req.param("userId"))
  if (!removed) return fail(c, 404, "Membro assente")
  return c.json({ ok: true })
})

app.get("/api/projects/:id/files", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  return proxyFile(c, "GET")
})

app.get("/api/projects/:id/file", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  return proxyFile(c, "GET")
})

app.put("/api/projects/:id/file", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  return proxyFile(c, "PUT")
})

app.get("/api/projects/:id/raw", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  const projectId = c.req.param("id")
  const rel = c.req.query("path") ?? ""
  if (!projectId || !rel) return fail(c, 400, "Percorso non valido")
  try {
    const response = await fetch(`${runnerUrl}/projects/${projectId}/raw?path=${encodeURIComponent(rel)}`)
    if (!response.ok || !response.body) return fail(c, response.status === 404 ? 404 : 400, "File assente")
    return c.body(response.body, 200, {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment",
    })
  } catch {
    return fail(c, 400, "Il runner non risponde")
  }
})

async function proxyFile(c: AppContext, method: "GET" | "PUT") {
  const projectId = c.req.param("id")
  if (!projectId) return fail(c, 404, "Progetto assente")
  const target = c.req.path.endsWith("/files") ? "files" : "file"
  const rel = c.req.query("path") ?? ""
  const query = target === "files" || rel ? `?path=${encodeURIComponent(rel)}` : ""
  try {
    const response = await fetch(`${runnerUrl}/projects/${projectId}/${target}${method === "GET" ? query : ""}`, {
      method,
      headers: method === "PUT" ? { "content-type": "application/json" } : undefined,
      body: method === "PUT" ? await c.req.raw.clone().text() : undefined,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = typeof body.error === "string" ? body.error : "File non disponibile"
      return fail(c, response.status === 404 ? 404 : 400, error)
    }
    return c.json(body)
  } catch {
    return fail(c, 400, "Il runner non risponde")
  }
}

app.get("/api/projects/:id/packages", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  return runJson(c, () => listProjectPackages(c.req.param("id")))
})

app.post("/api/projects/:id/packages", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const body = await c.req.json().catch(() => null)
  return runJson(c, () => addProjectPackage(c.req.param("id"), body?.manager, body?.spec))
})

app.delete("/api/projects/:id/packages", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const body = await c.req.json().catch(() => null)
  return runJson(c, () => removeProjectPackage(c.req.param("id"), body?.manager, body?.name))
})

app.get("/api/projects/:id/git", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  return runJson(c, () => projectGit(c.req.param("id")))
})

app.post("/api/projects/:id/git/branch", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const body = await c.req.json().catch(() => null)
  return runJson(c, () => projectBranch(c.req.param("id"), body?.name))
})

app.post("/api/projects/:id/git/commit", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const body = await c.req.json().catch(() => null)
  return runJson(c, () => projectCommitAndPush(c.req.param("id"), body?.message, c.get("user").email))
})

app.post("/api/projects/:id/git/pull", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const body = await c.req.json().catch(() => null)
  return runJson(c, () => projectPullRequest(c.req.param("id"), body?.title))
})

app.get("/api/projects/:id/previews", requireUser, async (c) => {
  const access = await requireProject(c, false)
  if (access.error) return access.error
  return runJson(c, () => listProjectPreviews(c.req.param("id")))
})

app.post("/api/projects/:id/previews", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  const body = await c.req.json().catch(() => null)
  return runJson(c, () => createProjectPreview(c.req.param("id"), body ?? {}))
})

app.post("/api/projects/:id/previews/:previewId/start", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  return runJson(c, () => startProjectPreview(c.req.param("id"), c.req.param("previewId")))
})

app.post("/api/projects/:id/previews/:previewId/stop", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  return runJson(c, () => stopProjectPreview(c.req.param("id"), c.req.param("previewId")))
})

app.delete("/api/projects/:id/previews/:previewId", requireUser, async (c) => {
  const access = await requireProject(c, true)
  if (access.error) return access.error
  try {
    const removed = await deleteProjectPreview(c.req.param("id"), c.req.param("previewId"))
    if (!removed) return fail(c, 404, "Preview assente")
    return c.json({ ok: true })
  } catch (error) {
    return fail(c, 400, error instanceof Error ? error.message : "Preview non eliminata")
  }
})

async function runJson<T>(c: AppContext, job: () => Promise<T>) {
  if (!c.req.param("id")) return fail(c, 404, "Progetto assente")
  try {
    return c.json(await job())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operazione non riuscita"
    if (message === "Preview assente" || message === "Progetto assente") return fail(c, 404, message)
    return fail(c, 400, message)
  }
}

async function requireProject(c: AppContext, write: boolean) {
  const projectId = c.req.param("id")
  if (!projectId) return { error: fail(c, 404, "Progetto assente"), role: null }
  const role = await projectRole(projectId, c.get("user").id)
  if (!role) return { error: fail(c, 404, "Progetto assente"), role: null }
  if (write && role === "viewer") return { error: fail(c, 403, "Puoi solo leggere questo progetto"), role }
  return { error: null, role }
}

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
  "/api/projects/:id/session",
  requireUser,
  upgradeWebSocket((c) => {
    const projectId = c.req.param("id")
    const user = c.get("user")
    if (!projectId) {
      return {
        onOpen(_event: unknown, ws: { close(): void }) {
          ws.close()
        },
      }
    }
    return bindProjectSession(projectId, user)
  }),
)

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

function readProjectName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  return name.length >= 1 && name.length <= 80 ? name : null
}

function readMemberRole(value: unknown): "editor" | "viewer" | null {
  if (value === "editor" || value === "viewer") return value
  return null
}

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

function readLoginText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.replace(/\r/g, "")
  if (text === "\n") return text
  const trimmed = text.trim()
  return trimmed.length >= 1 && trimmed.length <= 400 ? trimmed : null
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

function readEngineInput(body: {
  name?: unknown
  kind?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  model?: unknown
} | null): { name: string; kind: EngineKind; secret: string | null; baseUrl: string | null; model: string | null } | null {
  if (!body) return null
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const kind = readEngineKind(body.kind)
  if (!kind || name.length < 1 || name.length > 80) return null
  if (kind === "claude" || kind === "cursor") return { name, kind, secret: null, baseUrl: null, model: null }
  const secret = readSecret(body.apiKey)
  if (!secret) return null
  if (kind === "openai") {
    const baseUrl = readPublicUrl(body.baseUrl)
    const model = readModel(body.model)
    if (!baseUrl || !model) return null
    return { name, kind, secret, baseUrl, model }
  }
  return { name, kind, secret, baseUrl: null, model: null }
}

function readEngineKind(value: unknown): EngineKind | null {
  if (value === "claude" || value === "cursor" || value === "gemini" || value === "openai") return value
  return null
}

function readModel(value: unknown): string | null {
  if (typeof value !== "string") return null
  const model = value.trim()
  return model.length >= 1 && model.length <= 100 ? model : null
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
