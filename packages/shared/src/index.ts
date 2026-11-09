export type CheckStatus = "up" | "down"

export type HealthReport = {
  ok: boolean
  db: CheckStatus
  runner: CheckStatus
  createdAt: string | null
}

export type SessionSocketEvent =
  | { type: "ready" }
  | { type: "ping"; at: string }

export type UserRole = "admin" | "member"

export type PublicUser = {
  id: string
  email: string
  role: UserRole
}

export type EngineKind = "claude" | "cursor" | "gemini" | "openai"

export type EngineStatus = "connected" | "disabled" | "login"

export type EngineSummary = {
  id: string
  name: string
  kind: EngineKind
  status: EngineStatus
  baseUrl: string | null
  model: string | null
}

export type ProjectRole = "owner" | "editor" | "viewer"

export type IndentWith = "space" | "tab"

export type ProjectSummary = {
  id: string
  name: string
  role: ProjectRole
  canWrite: boolean
  indentSize: number
  indentWith: IndentWith
  repo: string | null
  branch: string | null
}

export type PackageManager = "npm" | "pip"

export type ProjectPackage = {
  manager: PackageManager
  name: string
  spec: string
  installed: boolean
  error: string | null
}

export type ProjectPreview = {
  id: string
  subdomain: string
  host: string
  port: number
  command: string
  running: boolean
  error: string | null
}

export type GitSnapshot = {
  repo: string
  branch: string
  dirty: boolean
  files: string[]
}

export type ProjectMember = {
  id: string
  email: string
  role: ProjectRole
}

export type SetupStep = "admin" | "github" | "folder" | "url" | "preview" | "done"

export type SetupState = {
  completed: boolean
  hasAdmin: boolean
  step: SetupStep
  github: {
    configured: boolean
    appId: string
    organization: string
  }
  workspacesDir: string
  publicUrl: string
  previewDomain: string
}

export type JournalKind = "user" | "assistant" | "tool" | "diff" | "permission" | "status" | "error"

export type JournalEvent = {
  id: string
  projectId: string
  engineId: string | null
  engineName: string | null
  authorId: string | null
  kind: JournalKind
  text: string
  payload: Record<string, unknown>
  createdAt: string
}

export type RunnerEvent =
  | { type: "delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; input: string }
  | { type: "diff"; path: string; patch: string }
  | { type: "permission"; requestId: string; tool: string; input: string }
  | { type: "status"; text: string }
  | { type: "error"; text: string }
  | { type: "native"; sessionId: string }
  | { type: "idle" }
  | { type: "done" }

export type FileEntry = {
  name: string
  path: string
  kind: "file" | "dir"
  size: number
}

export type FileListing = {
  entries: FileEntry[]
  truncated: boolean
}

export type FileDocument = {
  path: string
  size: number
  binary: boolean
  tooLarge: boolean
  text: string | null
}

const blockedCommands = new Set(["sh", "bash", "dash", "zsh", "cmd", "powershell", "pwsh"])

export function parseRepo(value: string, defaultOwner: string | null = null): { owner: string; name: string } | null {
  let text = value.trim().replace(/\.git$/, "").replace(/\/+$/, "")
  text = text.replace(/^https?:\/\/github\.com\//i, "")
  if (!text.includes("/") && defaultOwner) text = `${defaultOwner}/${text}`
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text)
  if (!match?.[1] || !match[2] || match[1] === "." || match[2] === "." || match[1] === ".." || match[2] === "..") {
    return null
  }
  return { owner: match[1], name: match[2] }
}

export function githubRemote(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`
}

export function parsePackageSpec(
  manager: string,
  spec: string,
): { manager: PackageManager; name: string; spec: string } | null {
  if (manager !== "npm" && manager !== "pip") return null
  const value = spec.trim()
  if (value.length < 1 || value.length > 120 || /[\s;&|$`\\\n\r]/.test(value)) return null
  if (manager === "npm") {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9._^*~<>=+-]+)?$/.test(value)) return null
    const name = value.startsWith("@") ? value.slice(0, versionAt(value)) : value.split("@")[0]
    if (!name) return null
    return { manager, name, spec: value }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,-]+\])?(?:(?:==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+-]+)?$/.test(value)) {
    return null
  }
  const name = value.split(/\[|(?:==|>=|<=|~=|!=|>|<)/)[0]
  if (!name) return null
  return { manager, name, spec: value }
}

export function readBranchName(value: string): string | null {
  const name = value.trim()
  if (name.length < 1 || name.length > 120 || name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) {
    return null
  }
  if (name.endsWith(".lock") || name.includes("..") || name.includes("@{") || name.includes("//") || name.includes("\\")) {
    return null
  }
  return /^[A-Za-z0-9._/-]+$/.test(name) ? name : null
}

export function readSubdomain(value: unknown): string | null {
  if (typeof value !== "string") return null
  const host = value.trim().toLowerCase()
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ? host : null
}

export function readPort(value: unknown): number | null {
  const port = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
}

export function splitCommand(input: string): string[] | null {
  const source = input.trim()
  if (!source || source.length > 240) return null
  const parts: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  for (const char of source) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === " " || char === "\t") {
      if (current) parts.push(current)
      current = ""
      continue
    }
    if (";|&$`<>\\\n\r".includes(char)) return null
    current += char
  }
  if (quote || current.length === 0 && parts.length === 0) return null
  if (current) parts.push(current)
  const command = parts[0]
  if (!command || parts.length > 12 || blockedCommands.has(command) || !/^[A-Za-z0-9._+-]+$/.test(command)) return null
  if (parts.some((part) => part.includes("..") || part.startsWith("/") || part.includes("\0"))) return null
  return parts
}

function versionAt(spec: string): number {
  const slash = spec.indexOf("/")
  const at = spec.indexOf("@", slash + 1)
  return at === -1 ? spec.length : at
}
