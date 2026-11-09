import type { ProjectMember, ProjectRole, ProjectSummary } from "@cloudai/shared"
import { FolderClosed } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { ApiError, api } from "@/lib/api"
import { cn } from "@/lib/utils"

const roleLabel: Record<ProjectRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
}

export function ProjectColumn({
  projects,
  selectedId,
  onSelect,
  onChanged,
  formId,
}: {
  projects: ProjectSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChanged: () => Promise<void>
  formId: string
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const selected = projects.find((project) => project.id === selectedId) ?? null
  const mine = projects.filter((project) => project.role === "owner")
  const shared = projects.filter((project) => project.role !== "owner")

  return (
    <aside className="flex h-full min-h-0 flex-col border-border md:border-r">
      <div className="flex h-12 items-center justify-between px-4">
        <h1 className="text-sm font-medium">Progetti</h1>
        <Button size="sm" variant="outline" onClick={() => setCreating((value) => !value)}>
          Nuovo
        </Button>
      </div>
      <Separator />
      {creating ? (
        <form
          className="flex flex-col gap-2 border-b border-border p-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setError(null)
            try {
              const project = await api<ProjectSummary>("/api/projects", {
                method: "POST",
                body: JSON.stringify({ name }),
              })
              setName("")
              setCreating(false)
              await onChanged()
              onSelect(project.id)
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Progetto non creato")
            } finally {
              setPending(false)
            }
          }}
        >
          <Label htmlFor={`${formId}-name`}>Nome</Label>
          <Input id={`${formId}-name`} required value={name} onChange={(event) => setName(event.target.value)} />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button type="submit" size="sm" disabled={pending}>
            Crea
          </Button>
        </form>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-4">
          <ProjectGroup title="I miei" projects={mine} selectedId={selectedId} onSelect={onSelect} />
          <ProjectGroup title="Condivisi con me" projects={shared} selectedId={selectedId} onSelect={onSelect} />
          {selected ? <Members project={selected} onChanged={onChanged} formId={formId} /> : null}
        </div>
      </ScrollArea>
    </aside>
  )
}

function ProjectGroup({
  title,
  projects,
  selectedId,
  onSelect,
}: {
  title: string
  projects: ProjectSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {projects.length === 0 ? (
        <p className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <FolderClosed className="size-4" />
          Nessun progetto
        </p>
      ) : (
        projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project.id)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
              project.id === selectedId ? "bg-accent" : "hover:bg-accent",
            )}
          >
            <span className="truncate">{project.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{roleLabel[project.role]}</span>
          </button>
        ))
      )}
    </section>
  )
}

function Members({
  project,
  onChanged,
  formId,
}: {
  project: ProjectSummary
  onChanged: () => Promise<void>
  formId: string
}) {
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"editor" | "viewer">("editor")
  const [name, setName] = useState(project.name)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setName(project.name)
    setConfirmDelete(false)
    let cancelled = false
    void api<ProjectMember[]>(`/api/projects/${project.id}/members`)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch(() => {
        if (!cancelled) setMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [project.id, project.name, project.role])

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Membri</h2>
      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-2 px-2">
            <span className="truncate text-sm">{member.email}</span>
            {project.role === "owner" && member.role !== "owner" ? (
              <span className="flex items-center gap-1">
                <select
                  aria-label={`Ruolo di ${member.email}`}
                  className="h-8 rounded-md border border-border bg-background px-1 text-xs"
                  value={member.role}
                  onChange={async (event) => {
                    const next = event.target.value === "viewer" ? "viewer" : "editor"
                    await api(`/api/projects/${project.id}/members/${member.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ role: next }),
                    })
                    setMembers(await api<ProjectMember[]>(`/api/projects/${project.id}/members`))
                  }}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/api/projects/${project.id}/members/${member.id}`, { method: "DELETE" })
                    setMembers(await api<ProjectMember[]>(`/api/projects/${project.id}/members`))
                    await onChanged()
                  }}
                >
                  Rimuovi
                </Button>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{roleLabel[member.role]}</span>
            )}
          </li>
        ))}
      </ul>
      {project.canWrite ? (
        <form
          className="flex flex-col gap-2 px-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            try {
              await api(`/api/projects/${project.id}`, {
                method: "PATCH",
                body: JSON.stringify({ name }),
              })
              await onChanged()
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Nome non aggiornato")
            }
          }}
        >
          <Label htmlFor={`${formId}-rename`}>Nome</Label>
          <Input id={`${formId}-rename`} required value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" size="sm" variant="secondary">
            Rinomina
          </Button>
        </form>
      ) : null}
      {project.role === "owner" ? (
        <form
          className="flex flex-col gap-2 px-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            try {
              await api(`/api/projects/${project.id}/members`, {
                method: "POST",
                body: JSON.stringify({ email, role }),
              })
              setEmail("")
              setMembers(await api<ProjectMember[]>(`/api/projects/${project.id}/members`))
              await onChanged()
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Condivisione non riuscita")
            }
          }}
        >
          <Label htmlFor={`${formId}-share`}>Condividi con</Label>
          <Input
            id={`${formId}-share`}
            type="email"
            required
            placeholder="email già registrata"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <select
            aria-label="Ruolo"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value === "viewer" ? "viewer" : "editor")}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <Button type="submit" size="sm">
            Aggiungi
          </Button>
        </form>
      ) : null}
      {project.role === "owner" ? (
        <div className="px-2">
          {confirmDelete ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api(`/api/projects/${project.id}`, { method: "DELETE" })
                await onChanged()
              }}
            >
              Conferma eliminazione
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Elimina
            </Button>
          )}
        </div>
      ) : null}
      {error ? <p className="px-2 text-sm text-red-400">{error}</p> : null}
    </section>
  )
}
