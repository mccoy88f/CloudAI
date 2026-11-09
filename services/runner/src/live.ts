import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import type { EngineKind, RunnerEvent } from "@cloudai/shared"
import { commandFor, createClaudeParser, createCursorParser, createGeminiParser, modelPrompt } from "./parse.js"

export type SessionSpec = {
  projectId: string
  engineId: string
  kind: EngineKind
  secret: string
  baseUrl: string | null
  model: string | null
  prompt: string
  context: string | null
  resumeId: string | null
}

type Listener = (event: RunnerEvent) => void

type Live = {
  projectId: string
  engineId: string
  kind: EngineKind
  secret: string
  baseUrl: string | null
  model: string | null
  resumeId: string | null
  cwd: string
  home: string
  child: ChildProcess | null
  abort: AbortController | null
  acceptsInput: boolean
  busy: boolean
  listeners: Set<Listener>
  permissionInput: Map<string, unknown>
}

const lives = new Map<string, Live>()
const workspacesDir = process.env.WORKSPACES_DIR ?? "/workspaces"
const enginesDir = process.env.ENGINES_DIR ?? "/engines"

export function subscribe(projectId: string, listener: Listener): () => void {
  const live = ensure(projectId)
  live.listeners.add(listener)
  return () => live.listeners.delete(listener)
}

export function submit(spec: SessionSpec): { accepted: "stdin" | "busy" | "started" } {
  const live = ensure(spec.projectId)
  live.secret = spec.secret
  live.baseUrl = spec.baseUrl
  live.model = spec.model
  live.resumeId = spec.resumeId
  if (live.busy && live.engineId !== spec.engineId) stop(spec.projectId, false)
  const current = ensure(spec.projectId)
  if (
    current.child?.stdin?.writable &&
    current.acceptsInput &&
    current.engineId === spec.engineId &&
    current.kind === "claude"
  ) {
    current.busy = true
    writeUser(current.child, spec.prompt)
    return { accepted: "stdin" }
  }
  if (current.busy) return { accepted: "busy" }
  current.engineId = spec.engineId
  current.kind = spec.kind
  current.busy = true
  emit(current, { type: "status", text: "In esecuzione" })
  if (spec.kind === "openai") {
    void runOpenAI(current, spec).catch((error: unknown) => {
      emit(current, { type: "error", text: error instanceof Error ? error.message : "Errore del motore" })
      finish(current)
    })
  } else {
    startCli(current, spec)
  }
  return { accepted: "started" }
}

export function permission(projectId: string, requestId: string, allow: boolean): boolean {
  const live = lives.get(projectId)
  const child = live?.child
  if (!live || !child?.stdin?.writable) return false
  const input = live.permissionInput.get(requestId) ?? {}
  const response = allow
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "Rifiutato dall'utente" }
  child.stdin.write(
    `${JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response },
    })}\n`,
  )
  live.permissionInput.delete(requestId)
  return true
}

export function stop(projectId: string, user: boolean): void {
  const live = lives.get(projectId)
  if (!live) return
  live.busy = false
  live.acceptsInput = false
  live.abort?.abort()
  live.abort = null
  const child = live.child
  live.child = null
  if (child) {
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 2000).unref()
  }
  if (!user) return
  emit(live, { type: "status", text: "Interrotto" })
  emit(live, { type: "idle" })
}

function ensure(projectId: string): Live {
  const existing = lives.get(projectId)
  if (existing) return existing
  const live: Live = {
    projectId,
    engineId: "",
    kind: "openai",
    secret: "",
    baseUrl: null,
    model: null,
    resumeId: null,
    cwd: `${workspacesDir}/${projectId}`,
    home: enginesDir,
    child: null,
    abort: null,
    acceptsInput: false,
    busy: false,
    listeners: new Set(),
    permissionInput: new Map(),
  }
  lives.set(projectId, live)
  return live
}

function startCli(live: Live, spec: SessionSpec): void {
  const command = commandFor(spec.kind)
  const prompt = modelPrompt(spec.prompt, spec.context)
  const home = `${enginesDir}/${spec.engineId}`
  live.home = home
  const args = argsFor(spec, prompt)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: home,
    PATH: `${live.cwd}/.cloudai/venv/bin${path.delimiter}${process.env.PATH ?? ""}`,
  }
  if (spec.kind === "claude") env.ANTHROPIC_API_KEY = spec.secret
  if (spec.kind === "cursor") env.CURSOR_API_KEY = spec.secret
  if (spec.kind === "gemini") env.GEMINI_API_KEY = spec.secret
  const child = spawn(command, args, {
    cwd: live.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  live.child = child
  live.acceptsInput = spec.kind === "claude"
  const parser =
    spec.kind === "claude" ? createClaudeParser() : spec.kind === "cursor" ? createCursorParser() : createGeminiParser()
  let stdout = ""
  let stderr = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk
    const lines = stdout.split("\n")
    stdout = lines.pop() ?? ""
    for (const line of lines) publish(live, parser(line))
  })
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000)
  })
  child.on("error", (error: NodeJS.ErrnoException) => {
    const missing = error.code === "ENOENT"
    emit(live, {
      type: "error",
      text: missing ? `Il comando ${command} non è installato nel runner` : "Il motore non è partito",
    })
    finish(live)
  })
  child.on("exit", (code) => {
    if (live.child !== child) return
    if (stdout.trim()) publish(live, parser(stdout))
    live.child = null
    live.acceptsInput = false
    if (code && stderr.trim()) emit(live, { type: "error", text: stderr.trim().slice(-500) })
    finish(live)
  })
  if (spec.kind === "claude") writeUser(child, prompt)
}

function argsFor(spec: SessionSpec, prompt: string): string[] {
  if (spec.kind === "claude") {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
      "--permission-mode",
      "default",
    ]
    if (spec.resumeId) args.push("--resume", spec.resumeId)
    return args
  }
  if (spec.kind === "cursor") {
    const args = ["-p", "--output-format", "stream-json", "--stream-partial-output", "--trust", "--force", "--workspace", `${workspacesDir}/${spec.projectId}`]
    if (spec.resumeId) args.push("--resume", spec.resumeId)
    args.push(prompt)
    return args
  }
  const args = ["-p", "--output-format", "stream-json", prompt]
  return args
}

async function runOpenAI(live: Live, spec: SessionSpec): Promise<void> {
  const abort = new AbortController()
  live.abort = abort
  live.acceptsInput = false
  const base = (spec.baseUrl ?? "").replace(/\/$/, "")
  const messages: { role: "system" | "user"; content: string }[] = []
  const prompt = modelPrompt(spec.prompt, spec.context)
  messages.push({ role: "user", content: prompt })
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${spec.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: spec.model, stream: true, messages }),
    signal: abort.signal,
  })
  if (!response.ok || !response.body) {
    emit(live, { type: "error", text: "L'endpoint OpenAI ha rifiutato la richiesta" })
    finish(live)
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const payload = line.startsWith("data:") ? line.slice(5).trim() : ""
      if (!payload || payload === "[DONE]") continue
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === "string" && delta) {
          text += delta
          emit(live, { type: "delta", text: delta })
        }
      } catch {
        // una riga incompleta non è un evento
      }
    }
  }
  if (text) emit(live, { type: "assistant", text })
  emit(live, { type: "idle" })
  finish(live)
}

function writeUser(child: ChildProcess, prompt: string): void {
  child.stdin?.write(
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    })}\n`,
  )
}

function publish(live: Live, events: RunnerEvent[]): void {
  for (const event of events) {
    if (event.type === "permission") {
      try {
        live.permissionInput.set(event.requestId, JSON.parse(event.input) as unknown)
      } catch {
        live.permissionInput.set(event.requestId, event.input)
      }
    }
    if (event.type === "native" && event.sessionId) live.resumeId = event.sessionId
    if (event.type === "idle") live.busy = false
    emit(live, event)
  }
}

function finish(live: Live): void {
  live.busy = false
  live.acceptsInput = false
  live.abort = null
  emit(live, { type: "done" })
}

function emit(live: Live, event: RunnerEvent): void {
  for (const listener of live.listeners) listener(event)
}
