import { spawn, type ChildProcess } from "node:child_process"
import { request, type IncomingMessage, type ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import path from "node:path"
import { splitCommand } from "@cloudai/shared"

type LivePreview = {
  projectId: string
  host: string
  port: number
  command: string
  child: ChildProcess | null
  error: string | null
}

const lives = new Map<string, LivePreview>()

export function matchPreview(header: string | string[] | undefined): LivePreview | null {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return null
  const host = raw.split(",")[0]?.trim().toLowerCase().split(":")[0] ?? ""
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return null
  const live = lives.get(host)
  if (!live?.child || live.child.exitCode !== null) return null
  return live
}

export async function startPreview(input: {
  projectId: string
  projectDir: string
  host: string
  port: number
  command: string
}): Promise<{ running: boolean; error: string | null }> {
  const parts = splitCommand(input.command)
  if (!parts || !isHost(input.host)) throw new Error("Comando o host non valido")
  stopPreview(input.host)
  let stderr = ""
  const command = parts[0]
  if (!command) throw new Error("Comando non valido")
  const child = spawn(command, parts.slice(1), {
    cwd: input.projectDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(input.port),
      HOST: "0.0.0.0",
      PATH: `${input.projectDir}/.cloudai/venv/bin${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-2000)
  })
  const live: LivePreview = {
    projectId: input.projectId,
    host: input.host,
    port: input.port,
    command: input.command,
    child,
    error: null,
  }
  lives.set(input.host, live)
  let failed: string | null = null
  child.on("error", () => {
    failed = `Il comando ${command} non è installato nel runner`
    live.child = null
    live.error = failed
  })
  child.on("exit", (code) => {
    if (live.child !== child) return
    live.child = null
    if (code) live.error = lastLine(stderr) || "Il comando si è chiuso"
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (failed || child.exitCode !== null) {
    live.child = null
    live.error = failed ?? (lastLine(stderr) || "Il comando si è chiuso subito")
    return { running: false, error: live.error }
  }
  return { running: true, error: null }
}

export function stopPreview(host: string): void {
  const live = lives.get(host)
  const pid = live?.child?.pid
  if (!live || !pid) return
  live.child = null
  live.error = null
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Il processo è già uscito.
    }
  }
}

export function forgetPreview(host: string): void {
  stopPreview(host)
  lives.delete(host)
}

export function stopProject(projectId: string): void {
  for (const host of [...lives.keys()]) {
    if (lives.get(host)?.projectId === projectId) forgetPreview(host)
  }
}

export function stopAllPreviews(): void {
  for (const host of [...lives.keys()]) stopPreview(host)
}

export function previewStates(): { host: string; running: boolean; error: string | null }[] {
  return [...lives.values()].map((live) => ({
    host: live.host,
    running: live.child !== null && live.child.exitCode === null,
    error: live.error,
  }))
}

export function handlePreviewHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const live = matchPreview(req.headers["x-forwarded-host"] ?? req.headers.host)
  if (!live) return false
  const proxy = request(
    {
      hostname: "127.0.0.1",
      port: live.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${live.port}` },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers)
      upstream.pipe(res)
    },
  )
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
    res.end("Il server del progetto non risponde")
  })
  req.pipe(proxy)
  return true
}

export function handlePreviewUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const live = matchPreview(req.headers["x-forwarded-host"] ?? req.headers.host)
  if (!live) return false
  const proxy = request({
    hostname: "127.0.0.1",
    port: live.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  })
  proxy.on("upgrade", (upstream, proxySocket, proxyHead) => {
    const lines = [`HTTP/1.1 ${upstream.statusCode ?? 101} ${upstream.statusMessage ?? "Switching Protocols"}`]
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${item}`)
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`)
    if (proxyHead.length > 0) socket.write(proxyHead)
    if (head.length > 0) proxySocket.write(head)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
  })
  proxy.on("response", () => socket.destroy())
  proxy.on("error", () => socket.destroy())
  proxy.end()
  return true
}

function isHost(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)
}

function lastLine(text: string): string {
  return text.trim().split("\n").map((line) => line.trim()).filter(Boolean).at(-1)?.slice(0, 240) ?? ""
}
