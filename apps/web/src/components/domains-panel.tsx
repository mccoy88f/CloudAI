import type { ProjectPreview, ProjectSummary, SetupState } from "@cloudai/shared"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"

export function DomainsPanel({ project, formId }: { project: ProjectSummary | null; formId: string }) {
  const [items, setItems] = useState<ProjectPreview[]>([])
  const [domain, setDomain] = useState("")
  const [subdomain, setSubdomain] = useState("")
  const [port, setPort] = useState("3000")
  const [command, setCommand] = useState("npm run dev")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    api<SetupState>("/api/setup")
      .then((setup) => {
        if (active) setDomain(setup.previewDomain)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!project) return
    let active = true
    setItems([])
    setError(null)
    api<ProjectPreview[]>(`/api/projects/${project.id}/previews`)
      .then((rows) => {
        if (active) setItems(rows)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Domini non disponibili")
      })
    return () => {
      active = false
    }
  }, [project])

  if (!project) return <p className="p-4 text-sm text-muted-foreground">Seleziona un progetto.</p>
  const projectId = project.id

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-3 text-xs text-muted-foreground">
          {domain ? `Sotto ${domain}. Traefik inoltra l’host, il runner la porta.` : "Configura il dominio delle preview nel wizard."}
        </p>
        {items.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Nessun dominio</p> : null}
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-2">
              <a className="block truncate font-mono text-xs underline" href={`https://${item.host}`} target="_blank" rel="noreferrer">
                {item.host}
              </a>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                :{item.port} · {item.command}
              </p>
              <p className="text-xs text-muted-foreground">{item.running ? "In esecuzione" : "Fermo"}</p>
              {item.error ? <p className="text-xs text-red-400">{item.error}</p> : null}
              {project.canWrite ? (
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void toggle(item)}>
                    {item.running ? "Ferma" : "Avvia"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void remove(item)}>
                    Elimina
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      </div>
      {project.canWrite ? (
        <form
          className="flex flex-col gap-2 border-t border-border p-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setError(null)
            try {
              const created = await api<ProjectPreview>(`/api/projects/${project.id}/previews`, {
                method: "POST",
                body: JSON.stringify({ subdomain, port: Number(port), command }),
              })
              setItems((current) => [...current, created].sort((a, b) => a.subdomain.localeCompare(b.subdomain)))
              setSubdomain("")
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Dominio non creato")
            } finally {
              setPending(false)
            }
          }}
        >
          <Label htmlFor={`${formId}-sub`}>Sottodominio</Label>
          <Input id={`${formId}-sub`} required value={subdomain} placeholder="app" onChange={(event) => setSubdomain(event.target.value)} />
          <Label htmlFor={`${formId}-port`}>Porta</Label>
          <Input id={`${formId}-port`} required inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
          <Label htmlFor={`${formId}-command`}>Comando</Label>
          <Input id={`${formId}-command`} required value={command} onChange={(event) => setCommand(event.target.value)} />
          <Button type="submit" size="sm" disabled={pending}>
            Aggiungi
          </Button>
        </form>
      ) : null}
    </div>
  )

  async function toggle(item: ProjectPreview) {
    setError(null)
    try {
      const next = await api<ProjectPreview>(`/api/projects/${projectId}/previews/${item.id}/${item.running ? "stop" : "start"}`, {
        method: "POST",
      })
      setItems((current) => current.map((row) => (row.id === next.id ? next : row)))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Stato non aggiornato")
    }
  }

  async function remove(item: ProjectPreview) {
    setError(null)
    try {
      await api(`/api/projects/${projectId}/previews/${item.id}`, { method: "DELETE" })
      setItems((current) => current.filter((row) => row.id !== item.id))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Dominio non eliminato")
    }
  }
}
