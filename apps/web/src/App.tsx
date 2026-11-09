import type { PublicUser, SetupState } from "@cloudai/shared"
import { useCallback, useEffect, useState } from "react"
import { WorkspaceShell } from "@/components/workspace-shell"
import { api } from "@/lib/api"
import { InvitePage } from "@/pages/invite-page"
import { LoginPage } from "@/pages/login-page"
import { SetupPage } from "@/pages/setup-page"

type Gate =
  | { kind: "loading" }
  | { kind: "invite" }
  | { kind: "login"; setup: SetupState }
  | { kind: "setup"; setup: SetupState; user: PublicUser | null }
  | { kind: "workspace"; user: PublicUser }

export function App() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" })

  const load = useCallback(async () => {
    if (window.location.pathname === "/invito") {
      setGate({ kind: "invite" })
      return
    }
    const setup = await api<SetupState>("/api/setup")
    const user = await readUser()
    if (!setup.completed) {
      if (user?.role === "admin" || !setup.hasAdmin) setGate({ kind: "setup", setup, user })
      else setGate({ kind: "login", setup })
      return
    }
    if (!user) setGate({ kind: "login", setup })
    else setGate({ kind: "workspace", user })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (gate.kind === "loading") {
    return <p className="p-6 text-sm text-muted-foreground">Caricamento…</p>
  }
  if (gate.kind === "invite") return <InvitePage />
  if (gate.kind === "login") {
    return (
      <LoginPage onLoggedIn={() => void load()} />
    )
  }
  if (gate.kind === "setup") return <SetupPage setup={gate.setup} user={gate.user} onChanged={load} />
  return (
    <WorkspaceShell
      user={gate.user}
      onLogout={async () => {
        await api("/api/logout", { method: "POST" })
        setGate({ kind: "login", setup: { ...(await api<SetupState>("/api/setup")) } })
      }}
    />
  )
}

async function readUser(): Promise<PublicUser | null> {
  const response = await fetch("/api/me", { credentials: "same-origin" })
  if (response.status === 401) return null
  if (!response.ok) return null
  return (await response.json()) as PublicUser
}
