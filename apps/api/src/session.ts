import type { JournalEvent, PublicUser, RunnerEvent } from "@cloudai/shared"
import { projectRole } from "./projects.js"
import { loadEngine } from "./engines.js"
import {
  appendJournal,
  listJournal,
  readBinding,
  resolvePermission,
  summarize,
  updateJournalText,
  writeBinding,
} from "./journal.js"

type Socket = { send(data: string): void }

type Queued = { text: string; authorId: string; engineId: string }

type Run = {
  queue: Queued[]
  assistantId: string | null
  assistantText: string
  running: boolean
  draining: boolean
  engineId: string | null
  engineName: string | null
  pump: Promise<void> | null
}

const rooms = new Map<string, Set<Socket>>()
const runs = new Map<string, Run>()
const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

export function bindProjectSession(projectId: string, user: PublicUser) {
  let socket: Socket | null = null
  return {
    onOpen(_event: unknown, ws: Socket & { close(): void }) {
      socket = ws
      void join(projectId, user, ws)
    },
    onMessage(event: { data: unknown }) {
      if (!socket) return
      void handle(projectId, user, socket, String(event.data))
    },
    onClose() {
      if (!socket) return
      rooms.get(projectId)?.delete(socket)
    },
  }
}

async function join(projectId: string, user: PublicUser, socket: Socket): Promise<void> {
  const role = await projectRole(projectId, user.id)
  if (!role) {
    socket.send(JSON.stringify({ type: "error", error: "Progetto assente" }))
    return
  }
  let room = rooms.get(projectId)
  if (!room) {
    room = new Set()
    rooms.set(projectId, room)
  }
  room.add(socket)
  const events = await listJournal(projectId)
  socket.send(JSON.stringify({ type: "history", events }))
  socket.send(JSON.stringify({ type: "running", running: runFor(projectId).running }))
}

async function handle(projectId: string, user: PublicUser, socket: Socket, raw: string): Promise<void> {
  const role = await projectRole(projectId, user.id)
  if (!role) return
  let message: { type?: string; text?: string; engineId?: string; requestId?: string; allow?: boolean }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    return
  }
  if (role === "viewer") {
    socket.send(JSON.stringify({ type: "error", error: "Sola lettura" }))
    return
  }
  if (message.type === "stop") {
    runFor(projectId).queue.length = 0
    await fetch(`${runnerUrl}/sessions/${projectId}/stop`, { method: "POST" }).catch(() => undefined)
    return
  }
  if (message.type === "resolve" && message.requestId) {
    const updated = await resolvePermission(projectId, message.requestId, message.allow === true)
    if (updated) broadcast(projectId, { type: "event", event: updated })
    await fetch(`${runnerUrl}/sessions/${projectId}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: message.requestId, allow: message.allow === true }),
    }).catch(() => undefined)
    return
  }
  if (message.type !== "send" || typeof message.text !== "string" || typeof message.engineId !== "string") return
  const text = message.text.trim()
  if (!text || text.length > 100_000) return
  await deliver(projectId, { text, authorId: user.id, engineId: message.engineId }, true)
}

async function deliver(projectId: string, item: Queued, recordUser: boolean): Promise<void> {
  const engine = await loadEngine(item.engineId)
  if (!engine) {
    const event = await appendJournal({
      projectId,
      engineId: null,
      authorId: item.authorId,
      kind: "error",
      text: "Motore non disponibile",
    })
    broadcast(projectId, { type: "event", event })
    return
  }
  if (recordUser) {
    const event = await appendJournal({
      projectId,
      engineId: engine.id,
      authorId: item.authorId,
      kind: "user",
      text: item.text,
    })
    broadcast(projectId, { type: "event", event })
  }
  const history = await listJournal(projectId)
  const prior = history.at(-1)?.kind === "user" ? history.slice(0, -1) : history
  const lastEngine = [...prior].reverse().find((event) => event.engineId)?.engineId ?? null
  const resumeId = await readBinding(projectId, engine.id)
  const context = !resumeId || (lastEngine && lastEngine !== engine.id) ? summarize(prior) : null
  try {
    await ensurePump(projectId)
    const response = await fetch(`${runnerUrl}/sessions/${projectId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        engineId: engine.id,
        kind: engine.kind,
        secret: engine.secret,
        baseUrl: engine.baseUrl,
        model: engine.model,
        prompt: item.text,
        context,
        resumeId,
      }),
    })
    const body = (await response.json()) as { accepted?: string }
    const run = runFor(projectId)
    if (body.accepted === "busy") {
      run.queue.unshift(item)
      return
    }
    if (run.engineId && run.engineId !== engine.id) {
      run.assistantId = null
      run.assistantText = ""
    }
    run.engineId = engine.id
    run.engineName = engine.name
    run.running = true
    broadcast(projectId, { type: "running", running: true })
  } catch {
    const event = await appendJournal({
      projectId,
      engineId: engine.id,
      authorId: null,
      kind: "error",
      text: "Il runner non risponde",
    })
    broadcast(projectId, { type: "event", event })
  }
}

async function ensurePump(projectId: string): Promise<void> {
  const run = runFor(projectId)
  if (run.pump) return run.pump
  let resolveReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  run.pump = ready
  void readPump(projectId, resolveReady)
  return ready
}

async function readPump(projectId: string, ready: () => void): Promise<void> {
  const run = runFor(projectId)
  try {
    const response = await fetch(`${runnerUrl}/sessions/${projectId}/events`)
    if (!response.ok || !response.body) throw new Error("stream")
    ready()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split("\n\n")
      buffer = chunks.pop() ?? ""
      for (const chunk of chunks) {
        const data = chunk
          .split("\n")
          .filter((item) => item.startsWith("data:"))
          .map((item) => item.slice(5).replace(/^ /, ""))
          .join("\n")
        if (!data) continue
        try {
          await applyRunnerEvent(projectId, JSON.parse(data) as RunnerEvent)
        } catch {
          // una riga non valida non interrompe la sessione
        }
      }
    }
  } catch {
    ready()
  } finally {
    run.pump = null
  }
}

async function applyRunnerEvent(projectId: string, event: RunnerEvent): Promise<void> {
  const run = runFor(projectId)
  if (event.type === "native") {
    if (run.engineId) await writeBinding(projectId, run.engineId, event.sessionId)
    return
  }
  if (event.type === "delta") {
    run.assistantText += event.text
    if (!run.assistantId) {
      const row = await appendJournal({
        projectId,
        engineId: run.engineId,
        authorId: null,
        kind: "assistant",
        text: run.assistantText,
      })
      run.assistantId = row.id
      broadcast(projectId, { type: "event", event: row })
      return
    }
    await updateJournalText(run.assistantId, run.assistantText)
    broadcast(projectId, { type: "delta", id: run.assistantId, text: run.assistantText })
    return
  }
  if (event.type === "assistant") {
    if (run.assistantId) {
      run.assistantText = event.text
      await updateJournalText(run.assistantId, event.text)
      broadcast(projectId, { type: "delta", id: run.assistantId, text: event.text })
    } else if (event.text) {
      const row = await appendJournal({
        projectId,
        engineId: run.engineId,
        authorId: null,
        kind: "assistant",
        text: event.text,
      })
      broadcast(projectId, { type: "event", event: row })
    }
    run.assistantId = null
    run.assistantText = ""
    return
  }
  if (event.type === "tool") {
    await persist(projectId, "tool", event.name, { name: event.name, input: event.input })
    return
  }
  if (event.type === "diff") {
    await persist(projectId, "diff", event.patch, { path: event.path })
    return
  }
  if (event.type === "permission") {
    await persist(projectId, "permission", event.tool, {
      requestId: event.requestId,
      tool: event.tool,
      input: event.input,
      resolved: null,
    })
    return
  }
  if (event.type === "status") {
    await persist(projectId, "status", event.text, {})
    return
  }
  if (event.type === "error") {
    await persist(projectId, "error", event.text, {})
    return
  }
  if (event.type === "idle" || event.type === "done") {
    run.running = false
    run.assistantId = null
    run.assistantText = ""
    broadcast(projectId, { type: "running", running: false })
    if (run.draining) return
    const next = run.queue.shift()
    if (!next) return
    run.draining = true
    try {
      await deliver(projectId, next, false)
    } finally {
      run.draining = false
    }
  }
}

async function persist(
  projectId: string,
  kind: "tool" | "diff" | "permission" | "status" | "error",
  text: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const run = runFor(projectId)
  const event = await appendJournal({
    projectId,
    engineId: run.engineId,
    authorId: null,
    kind,
    text,
    payload,
  })
  broadcast(projectId, { type: "event", event })
}

function broadcast(projectId: string, message: unknown): void {
  const data = JSON.stringify(message)
  for (const socket of rooms.get(projectId) ?? []) {
    try {
      socket.send(data)
    } catch {
      rooms.get(projectId)?.delete(socket)
    }
  }
}

function runFor(projectId: string): Run {
  const existing = runs.get(projectId)
  if (existing) return existing
  const run: Run = {
    queue: [],
    assistantId: null,
    assistantText: "",
    running: false,
    draining: false,
    engineId: null,
    engineName: null,
    pump: null,
  }
  runs.set(projectId, run)
  return run
}
