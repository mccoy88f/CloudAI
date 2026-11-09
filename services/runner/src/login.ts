import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { EngineKind } from "@cloudai/shared"

export type LoginView = {
  output: string
  url: string | null
  running: boolean
  exitCode: number | null
}

type Login = {
  child: ChildProcess
  output: string
  exitCode: number | null
}

const sessions = new Map<string, Login>()
const script = fileURLToPath(new URL("./login_pty.py", import.meta.url))

export function loginView(text: string): { output: string; url: string | null } {
  const output = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").slice(-4000)
  const url = /https:\/\/[^\s<>"']+/.exec(output)?.[0] ?? null
  return { output, url }
}

export function startLogin(id: string, home: string, kind: EngineKind): LoginView {
  const command = loginCommand(kind)
  if (!command) throw new Error("Questo motore non usa l'accesso della CLI")
  return openLogin(id, home, command.command, command.args, command.env)
}

export function openLogin(
  id: string,
  home: string,
  command: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
): LoginView {
  const current = sessions.get(id)
  if (current?.child.exitCode === null && current.exitCode === null) return view(current)
  current?.child.kill("SIGTERM")
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: home,
    TERM: "xterm-256color",
    NO_OPEN_BROWSER: "1",
    ...extra,
  }
  delete env.ANTHROPIC_API_KEY
  delete env.CURSOR_API_KEY
  delete env.GEMINI_API_KEY
  const child = spawn("python3", [script, command, ...args], {
    cwd: home,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const login: Login = { child, output: "", exitCode: null }
  sessions.set(id, login)
  const append = (chunk: string) => {
    login.output = `${login.output}${chunk}`.slice(-12000)
  }
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", append)
  child.stderr?.on("data", append)
  child.on("error", (error: NodeJS.ErrnoException) => {
    login.exitCode = 1
    login.output += error.code === "ENOENT" ? "\nPython non è installato nel runner" : "\nAccesso non avviato"
  })
  child.on("exit", (code) => {
    if (sessions.get(id)?.child !== child) return
    login.exitCode = code ?? 1
  })
  return view(login)
}

export function writeLogin(id: string, text: string): LoginView {
  const login = sessions.get(id)
  if (!login || login.exitCode !== null) throw new Error("Nessun accesso in corso")
  login.child.stdin?.write(text.endsWith("\n") ? text : `${text}\n`)
  return view(login)
}

export function readLogin(id: string): LoginView {
  const login = sessions.get(id)
  if (!login) return { output: "", url: null, running: false, exitCode: null }
  return view(login)
}

function view(login: Login): LoginView {
  const shown = loginView(login.output)
  return { ...shown, running: login.exitCode === null, exitCode: login.exitCode }
}

function loginCommand(kind: EngineKind): { command: string; args: string[]; env: NodeJS.ProcessEnv } | null {
  if (kind === "claude") return { command: "claude", args: ["auth", "login"], env: {} }
  if (kind === "cursor") return { command: "agent", args: ["login"], env: { NO_OPEN_BROWSER: "1" } }
  return null
}
