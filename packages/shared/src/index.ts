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

export type EngineStatus = "connected" | "disabled"

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
