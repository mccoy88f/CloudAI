import type { FileEntry, FileListing, ProjectSummary } from "@cloudai/shared"
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, api } from "@/lib/api"

export function FileTree({
  project,
  openPath,
  revision,
  onOpen,
  onCreated,
}: {
  project: ProjectSummary | null
  openPath: string | null
  revision: number
  onOpen: (path: string) => void
  onCreated: () => void
}) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!project) {
    return <p className="p-4 text-sm text-muted-foreground">Seleziona un progetto.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <FileLevel
          projectId={project.id}
          dir=""
          depth={0}
          openPath={openPath}
          revision={revision}
          onOpen={onOpen}
        />
      </div>
      {project.canWrite ? (
        <form
          className="flex gap-2 border-t border-border p-2"
          onSubmit={async (event) => {
            event.preventDefault()
            const path = draft.trim()
            if (!path) return
            setError(null)
            try {
              await api(`/api/projects/${project.id}/file`, {
                method: "PUT",
                body: JSON.stringify({ path, text: "" }),
              })
              setDraft("")
              onCreated()
              onOpen(path)
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "File non creato")
            }
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="percorso/file.ts"
            aria-label="Nuovo file"
          />
          <Button type="submit" size="sm" variant="secondary">
            Crea
          </Button>
        </form>
      ) : null}
      {error ? <p className="px-2 pb-2 text-xs text-red-300">{error}</p> : null}
    </div>
  )
}

function FileLevel({
  projectId,
  dir,
  depth,
  openPath,
  revision,
  onOpen,
}: {
  projectId: string
  dir: string
  depth: number
  openPath: string | null
  revision: number
  onOpen: (path: string) => void
}) {
  const [listing, setListing] = useState<FileListing | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    api<FileListing>(`/api/projects/${projectId}/files?path=${encodeURIComponent(dir)}`)
      .then((body) => {
        if (!cancel) setListing(body)
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof ApiError ? caught.message : "Cartella non leggibile")
      })
    return () => {
      cancel = true
    }
  }, [projectId, dir, revision])

  if (error) return <p className="px-3 py-2 text-xs text-red-300">{error}</p>
  if (!listing) return <p className="px-3 py-2 text-xs text-muted-foreground">…</p>
  if (listing.entries.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Nessun file</p>
  }

  return (
    <ul>
      {listing.entries.map((entry) => (
        <FileNode
          key={entry.path}
          entry={entry}
          projectId={projectId}
          depth={depth}
          openPath={openPath}
          revision={revision}
          onOpen={onOpen}
        />
      ))}
      {listing.truncated ? <li className="px-3 py-1 text-xs text-muted-foreground">Elenco troncato</li> : null}
    </ul>
  )
}

function FileNode({
  entry,
  projectId,
  depth,
  openPath,
  revision,
  onOpen,
}: {
  entry: FileEntry
  projectId: string
  depth: number
  openPath: string | null
  revision: number
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pad = { paddingLeft: `${depth * 12 + 8}px` }

  if (entry.kind === "dir") {
    return (
      <li>
        <button
          type="button"
          style={pad}
          className="flex h-8 w-full items-center gap-1 text-left text-sm hover:bg-accent"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Folder className="size-3.5 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
        </button>
        {open ? (
          <FileLevel
            projectId={projectId}
            dir={entry.path}
            depth={depth + 1}
            openPath={openPath}
            revision={revision}
            onOpen={onOpen}
          />
        ) : null}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        style={pad}
        className={`flex h-8 w-full items-center gap-1 text-left text-sm hover:bg-accent ${openPath === entry.path ? "bg-accent" : ""}`}
        onClick={() => onOpen(entry.path)}
      >
        <File className="ml-4 size-3.5 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
      </button>
    </li>
  )
}
