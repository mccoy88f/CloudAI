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
