import type { ProjectPackage, ProjectSummary } from "@cloudai/shared"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"

export function PackagesPanel({ project, formId }: { project: ProjectSummary | null; formId: string }) {
  const [items, setItems] = useState<ProjectPackage[]>([])
  const [manager, setManager] = useState<"npm" | "pip">("npm")
  const [spec, setSpec] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!project) return
    let active = true
    setItems([])
    setError(null)
    api<ProjectPackage[]>(`/api/projects/${project.id}/packages`)
      .then((rows) => {
        if (active) setItems(rows)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Pacchetti non disponibili")
      })
    return () => {
      active = false
    }
  }, [project])

  if (!project) return <p className="p-4 text-sm text-muted-foreground">Seleziona un progetto.</p>
  const projectId = project.id

  const installed = items.filter((item) => item.installed)
  const pendingItems = items.filter((item) => !item.installed)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-3 text-xs text-muted-foreground">Restano nella cartella del progetto, per tutti i membri.</p>
        <PackageGroup title="Installati" items={installed} canWrite={project.canWrite} onRemove={remove} />
        <PackageGroup title="Da installare" items={pendingItems} canWrite={project.canWrite} onRemove={remove} />
        {error ? <p className="px-1 text-sm text-red-400">{error}</p> : null}
      </div>
      {project.canWrite ? (
        <form
          className="flex flex-col gap-2 border-t border-border p-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setError(null)
            try {
              setItems(await api<ProjectPackage[]>(`/api/projects/${project.id}/packages`, {
                method: "POST",
                body: JSON.stringify({ manager, spec }),
              }))
              setSpec("")
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Pacchetto non installato")
            } finally {
              setPending(false)
            }
          }}
        >
          <Label htmlFor={`${formId}-spec`}>Pacchetto</Label>
          <div className="flex gap-2">
            <select
              aria-label="Gestore"
              value={manager}
              onChange={(event) => setManager(event.target.value === "pip" ? "pip" : "npm")}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="npm">npm</option>
              <option value="pip">pip</option>
            </select>
            <Input
              id={`${formId}-spec`}
              required
              value={spec}
              placeholder="zod oppure requests"
              onChange={(event) => setSpec(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Installa
          </Button>
        </form>
      ) : null}
    </div>
  )

  async function remove(item: ProjectPackage) {
    setError(null)
    try {
      setItems(await api<ProjectPackage[]>(`/api/projects/${projectId}/packages`, {
        method: "DELETE",
        body: JSON.stringify({ manager: item.manager, name: item.name }),
      }))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Pacchetto non rimosso")
    }
  }
}

function PackageGroup({
  title,
  items,
  canWrite,
  onRemove,
}: {
  title: string
  items: ProjectPackage[]
  canWrite: boolean
  onRemove: (item: ProjectPackage) => Promise<void>
}) {
  return (
    <section className="mb-4">
      <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {items.length === 0 ? <p className="px-1 py-2 text-sm text-muted-foreground">Nessuno</p> : null}
      <ul className="mt-1 flex flex-col">
        {items.map((item) => (
          <li key={`${item.manager}:${item.name}`} className="flex items-start justify-between gap-2 px-1 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs">{item.spec}</span>
              <span className="text-xs text-muted-foreground">{item.manager}</span>
              {item.error ? <span className="block text-xs text-red-400">{item.error}</span> : null}
            </span>
            {canWrite ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => void onRemove(item)}>
                Rimuovi
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
