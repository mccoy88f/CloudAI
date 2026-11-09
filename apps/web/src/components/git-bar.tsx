import type { GitSnapshot, ProjectSummary } from "@cloudai/shared"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, api } from "@/lib/api"

export function GitBar({ project, onChanged }: { project: ProjectSummary; onChanged: () => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>(null)
  const [branch, setBranch] = useState("")
  const [message, setMessage] = useState("")
  const [pullUrl, setPullUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    api<GitSnapshot>(`/api/projects/${project.id}/git`)
      .then((next) => {
        if (active) setSnapshot(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Git non disponibile")
      })
    return () => {
      active = false
    }
  }, [project.id])

  return (
    <section className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <a className="truncate underline" href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer">
          {project.repo}
        </a>
        <span className="font-mono text-muted-foreground">{snapshot?.branch ?? project.branch ?? "…"}</span>
        {snapshot?.dirty ? <span className="text-muted-foreground">{snapshot.files.length} file da salvare</span> : null}
      </div>
      {snapshot && snapshot.files.length > 0 ? (
        <p className="truncate font-mono text-xs text-muted-foreground">{snapshot.files.slice(0, 6).join("  ")}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Il commit è a tuo nome. Push e pull request li fa la GitHub App, anche se il repository è privato.
      </p>
      {project.canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Nuovo branch"
            value={branch}
            placeholder="feature/login"
            onChange={(event) => setBranch(event.target.value)}
            className="h-8 max-w-48"
          />
          <Button type="button" size="sm" variant="outline" disabled={pending || !branch.trim()} onClick={() => void run("branch")}>
            Crea branch
          </Button>
          <Input
            aria-label="Messaggio del commit"
            value={message}
            placeholder="Messaggio"
            onChange={(event) => setMessage(event.target.value)}
            className="h-8 min-w-40 flex-1"
          />
          <Button type="button" size="sm" disabled={pending || !message.trim()} onClick={() => void run("commit")}>
            Commit e push
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={pending || !message.trim()} onClick={() => void run("pull")}>
            Apri PR
          </Button>
        </div>
      ) : null}
      {pullUrl ? (
        <a className="truncate text-xs underline" href={pullUrl} target="_blank" rel="noreferrer">
          {pullUrl}
        </a>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </section>
  )

  async function run(action: "branch" | "commit" | "pull") {
    setPending(true)
    setError(null)
    try {
      if (action === "branch") {
        setSnapshot(await api<GitSnapshot>(`/api/projects/${project.id}/git/branch`, {
          method: "POST",
          body: JSON.stringify({ name: branch }),
        }))
        setBranch("")
      } else if (action === "commit") {
        setSnapshot(await api<GitSnapshot>(`/api/projects/${project.id}/git/commit`, {
          method: "POST",
          body: JSON.stringify({ message }),
        }))
        setMessage("")
      } else {
        const opened = await api<{ url: string }>(`/api/projects/${project.id}/git/pull`, {
          method: "POST",
          body: JSON.stringify({ title: message }),
        })
        setPullUrl(opened.url)
      }
      await onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Git non aggiornato")
    } finally {
      setPending(false)
    }
  }
}
