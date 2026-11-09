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
