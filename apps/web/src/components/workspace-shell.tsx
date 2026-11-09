import type { EngineSummary, ProjectSummary, PublicUser } from "@cloudai/shared"
import { Globe, Menu, Package, PanelRight } from "lucide-react"
import { useCallback, useEffect, useState, lazy, Suspense, type ReactNode } from "react"
import { EnginesButton } from "@/components/engines-panel"
import { FileTree } from "@/components/file-tree"
import { ProjectColumn } from "@/components/project-column"
import { SessionPanel, useProjectSession } from "@/components/session-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, api } from "@/lib/api"
import { usePlatformStatus, type LinkState } from "@/lib/platform"

const FileEditor = lazy(() => import("@/components/file-editor").then((mod) => ({ default: mod.FileEditor })))

export function WorkspaceShell({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [engines, setEngines] = useState<EngineSummary[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const status = usePlatformStatus()
  const selected = projects.find((project) => project.id === selectedId) ?? null
  const session = useProjectSession(selected)
  const desktop = useDesktop()
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [treeRevision, setTreeRevision] = useState(0)
  const reloadEngines = useCallback(async () => {
    const rows = await api<EngineSummary[]>("/api/engines")
    setEngines(rows.filter((engine) => engine.status === "connected"))
  }, [])
  const reloadProjects = useCallback(async () => {
    const rows = await api<ProjectSummary[]>("/api/projects")
    setProjects(rows)
    setSelectedId((current) => (current && rows.some((project) => project.id === current) ? current : null))
  }, [])

  useEffect(() => {
    void reloadEngines().catch(() => setEngines([]))
    void reloadProjects().catch(() => setProjects([]))
  }, [reloadEngines, reloadProjects])

  useEffect(() => {
    setOpenPath(null)
  }, [selected?.id])

  function openFile(path: string) {
    setOpenPath(path)
    setContextOpen(false)
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Apri progetti"
          onClick={() => setProjectsOpen(true)}
        >
          <Menu />
        </Button>
        <div className="flex items-center gap-2 px-1">
          <span className="font-medium tracking-tight">CloudAI</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge label="API" state={status.health?.ok ? "up" : status.health ? "down" : "connecting"} />
          <StatusBadge className="hidden sm:inline-flex" label="Sessione" state={status.socket} />
          {user.role === "admin" ? <EnginesButton onChanged={() => void reloadEngines()} /> : null}
          {user.role === "admin" ? <InviteButton /> : null}
          <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">{user.email}</span>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            Esci
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Apri file e pacchetti"
            onClick={() => setContextOpen(true)}
          >
            <PanelRight />
          </Button>
        </div>
      </header>

      {desktop ? (
        <div className="hidden min-h-0 flex-1 md:grid md:grid-cols-[16rem_minmax(0,1fr)_20rem]">
          <ProjectColumn
            projects={projects}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id)
              setProjectsOpen(false)
            }}
            onChanged={reloadProjects}
            formId="desk"
          />
          {selected && openPath ? (
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Apro l’editor…</p>}>
              <FileEditor
                project={selected}
                path={openPath}
                fullscreen={false}
                onClose={() => setOpenPath(null)}
                onSaved={() => setTreeRevision((value) => value + 1)}
                onProject={(project) =>
                  setProjects((current) => current.map((item) => (item.id === project.id ? project : item)))
                }
              />
            </Suspense>
          ) : (
            <SessionPanel engines={engines} project={selected} session={session} inputId="engine" />
          )}
          <ContextColumn
            project={selected}
            openPath={openPath}
            revision={treeRevision}
            onOpen={openFile}
            onCreated={() => setTreeRevision((value) => value + 1)}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 md:hidden">
          {selected && openPath ? (
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Apro l’editor…</p>}>
              <FileEditor
                project={selected}
                path={openPath}
                fullscreen
                onClose={() => setOpenPath(null)}
                onSaved={() => setTreeRevision((value) => value + 1)}
                onProject={(project) =>
                  setProjects((current) => current.map((item) => (item.id === project.id ? project : item)))
                }
              />
            </Suspense>
          ) : (
            <SessionPanel engines={engines} project={selected} session={session} inputId="engine-mobile" />
          )}
        </div>
      )}

      <Sheet open={projectsOpen} onOpenChange={setProjectsOpen}>
        <SheetContent side="left" title="Progetti">
          <ProjectColumn
            projects={projects}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id)
              setProjectsOpen(false)
            }}
            onChanged={reloadProjects}
            formId="mobile"
          />
        </SheetContent>
      </Sheet>
      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent side="right" title="File, pacchetti e domini" className="w-[min(100%,24rem)]">
          <ContextColumn
            project={selected}
            openPath={openPath}
            revision={treeRevision}
            onOpen={openFile}
            onCreated={() => setTreeRevision((value) => value + 1)}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function InviteButton() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Invita
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" title="Invita un utente">
          <form
            className="flex flex-col gap-4 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setPending(true)
              setError(null)
              try {
                const result = await api<{ path: string }>("/api/invites", {
                  method: "POST",
                  body: JSON.stringify({ email }),
                })
                setLink(`${window.location.origin}${result.path}`)
                setEmail("")
              } catch (caught) {
                setError(caught instanceof ApiError ? caught.message : "Invito non creato")
              } finally {
                setPending(false)
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              Crea il link
            </Button>
            {link ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Vale 7 giorni e si usa una sola volta. Condividilo con la persona invitata.
                </p>
                <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(link)}
                >
                  Copia
                </Button>
              </div>
            ) : null}
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}

function ContextColumn({
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
  return (
    <aside className="flex h-full min-h-0 flex-col border-border md:border-l">
      <Tabs defaultValue="files" className="h-full">
        <TabsList>
          <TabsTrigger value="files">File</TabsTrigger>
          <TabsTrigger value="packages">Pacchetti</TabsTrigger>
          <TabsTrigger value="domains">Domini</TabsTrigger>
        </TabsList>
        <TabsContent value="files">
          <FileTree project={project} openPath={openPath} revision={revision} onOpen={onOpen} onCreated={onCreated} />
        </TabsContent>
        <TabsContent value="packages">
          <EmptyPanel icon={<Package className="size-4" />} text="Nessun pacchetto" />
        </TabsContent>
        <TabsContent value="domains">
          <EmptyPanel icon={<Globe className="size-4" />} text="Nessun dominio" />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function EmptyPanel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      {icon}
      {text}
    </div>
  )
}

function useDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches)
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)")
    const update = () => setDesktop(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return desktop
}

function StatusBadge({ label, state, className }: { label: string; state: LinkState; className?: string }) {
  const copy = state === "up" ? "attivo" : state === "down" ? "assente" : "…"
  const dot = state === "up" ? "bg-emerald-400" : state === "down" ? "bg-red-400" : "bg-zinc-500"
  return (
    <Badge className={className}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label} {copy}
    </Badge>
  )
}
