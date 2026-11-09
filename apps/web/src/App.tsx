import { Files, FolderClosed, Globe, Menu, Package, PanelRight } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlatformStatus, type LinkState } from "@/lib/platform"

export function App() {
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const status = usePlatformStatus()

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
          <StatusBadge label="Sessione" state={status.socket} />
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

      <div className="hidden min-h-0 flex-1 md:grid md:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <ProjectColumn />
        <SessionColumn />
        <ContextColumn />
      </div>

      <div className="min-h-0 flex-1 md:hidden">
        <SessionColumn />
      </div>

      <Sheet open={projectsOpen} onOpenChange={setProjectsOpen}>
        <SheetContent side="left" title="Progetti">
          <ProjectColumn />
        </SheetContent>
      </Sheet>
      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent side="right" title="File, pacchetti e domini" className="w-[min(100%,24rem)]">
          <ContextColumn />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ProjectColumn() {
  return (
    <aside className="flex h-full min-h-0 flex-col border-border md:border-r">
      <div className="flex h-12 items-center justify-between px-4">
        <h1 className="text-sm font-medium">Progetti</h1>
        <Button size="sm" variant="outline" disabled>
          Nuovo
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-4">
          <ProjectGroup title="I miei" />
          <ProjectGroup title="Condivisi con me" />
        </div>
      </ScrollArea>
    </aside>
  )
}

function ProjectGroup({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderClosed className="size-4" />
        Nessun progetto
      </p>
    </section>
  )
}

function SessionColumn() {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <label className="text-xs text-muted-foreground" htmlFor="engine">
          Motore
        </label>
        <select
          id="engine"
          disabled
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-muted-foreground"
        >
          <option>Nessun motore</option>
        </select>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Seleziona un progetto per aprire la sessione. I messaggi del motore compariranno qui.
        </p>
      </div>
      <form className="border-t border-border p-3" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor="composer">
          Messaggio
        </label>
        <textarea
          id="composer"
          disabled
          rows={3}
          placeholder="Scrivi al motore quando una sessione è aperta"
          className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />
      </form>
    </main>
  )
}

function ContextColumn() {
  return (
    <aside className="flex h-full min-h-0 flex-col border-border md:border-l">
      <Tabs defaultValue="files" className="h-full">
        <TabsList>
          <TabsTrigger value="files">File</TabsTrigger>
          <TabsTrigger value="packages">Pacchetti</TabsTrigger>
          <TabsTrigger value="domains">Domini</TabsTrigger>
        </TabsList>
        <TabsContent value="files">
          <EmptyPanel icon={<Files className="size-4" />} text="Nessun file" />
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

function StatusBadge({ label, state }: { label: string; state: LinkState }) {
  const copy = state === "up" ? "attivo" : state === "down" ? "assente" : "…"
  const dot = state === "up" ? "bg-emerald-400" : state === "down" ? "bg-red-400" : "bg-zinc-500"
  return (
    <Badge>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label} {copy}
    </Badge>
  )
}
