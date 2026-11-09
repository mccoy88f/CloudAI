import type { EngineSummary, JournalEvent, ProjectSummary } from "@cloudai/shared"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

type SessionMessage =
  | { type: "history"; events: JournalEvent[] }
  | { type: "event"; event: JournalEvent }
  | { type: "delta"; id: string; text: string }
  | { type: "running"; running: boolean }
  | { type: "error"; error: string }

export function useProjectSession(project: ProjectSummary | null) {
  const [events, setEvents] = useState<JournalEvent[]>([])
  const [running, setRunning] = useState(false)
  const [draft, setDraft] = useState("")
  const [engineId, setEngineId] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!project) {
      setEvents([])
      setRunning(false)
      return
    }
    const protocol = window.location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/projects/${project.id}/session`)
    socket.current = ws
    ws.onmessage = (message) => {
      const body = JSON.parse(String(message.data)) as SessionMessage
      if (body.type === "history") setEvents(body.events)
      if (body.type === "event") {
        setEvents((current) => {
          const index = current.findIndex((item) => item.id === body.event.id)
          if (index === -1) return [...current, body.event]
          const next = current.slice()
          next[index] = body.event
          return next
        })
      }
      if (body.type === "delta") {
        setEvents((current) => current.map((item) => (item.id === body.id ? { ...item, text: body.text } : item)))
      }
      if (body.type === "running") setRunning(body.running)
      if (body.type === "error") setNotice(body.error)
    }
    return () => {
      ws.close()
      if (socket.current === ws) socket.current = null
    }
  }, [project?.id])

  function send() {
    const text = draft.trim()
    if (!text || !engineId || !project?.canWrite || socket.current?.readyState !== WebSocket.OPEN) return
    socket.current.send(JSON.stringify({ type: "send", text, engineId }))
    setDraft("")
    setNotice(null)
  }

  function stop() {
    socket.current?.send(JSON.stringify({ type: "stop" }))
  }

  function resolve(requestId: string, allow: boolean) {
    socket.current?.send(JSON.stringify({ type: "resolve", requestId, allow }))
  }

  return { events, running, draft, setDraft, engineId, setEngineId, notice, send, stop, resolve }
}

export function SessionPanel({
  project,
  engines,
  session,
  inputId,
}: {
  project: ProjectSummary | null
  engines: EngineSummary[]
  session: ReturnType<typeof useProjectSession>
  inputId: string
}) {
  const bottom = useRef<HTMLDivElement>(null)
  const { events, running, draft, setDraft, engineId, setEngineId, notice, send, stop, resolve } = session

  useEffect(() => {
    if (!engines.some((engine) => engine.id === engineId)) setEngineId(engines[0]?.id ?? "")
  }, [engines, engineId, setEngineId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [events])

  const canWrite = Boolean(project?.canWrite && engineId)

  return (
    <main className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <label className="text-xs text-muted-foreground" htmlFor={inputId}>
          Motore
        </label>
        <select
          id={inputId}
          disabled={engines.length === 0}
          value={engineId}
          onChange={(event) => setEngineId(event.target.value)}
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-sm disabled:text-muted-foreground"
        >
          {engines.length === 0 ? <option value="">Nessun motore</option> : null}
          {engines.map((engine) => (
            <option key={engine.id} value={engine.id}>
              {engine.name}
            </option>
          ))}
        </select>
        {running ? (
          <Button type="button" size="sm" variant="ghost" onClick={stop}>
            Ferma
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {events.length === 0 ? (
          <p className="mx-auto max-w-sm text-center text-sm text-muted-foreground">
            {project
              ? project.canWrite
                ? "Scrivi al motore. Lo storico di questo progetto resta qui, anche se cambi motore."
                : `${project.name} è in sola lettura.`
              : "Seleziona un progetto per aprire la sessione."}
          </p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} canWrite={Boolean(project?.canWrite)} onResolve={resolve} />
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <label className="sr-only" htmlFor={`${inputId}-composer`}>
          Messaggio
        </label>
        <textarea
          id={`${inputId}-composer`}
          rows={3}
          disabled={!canWrite}
          value={draft}
          placeholder={canWrite ? "Messaggio al motore. Resta attivo anche mentre lavora." : "Sola lettura"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{notice ?? (running ? "Il motore sta lavorando" : "")}</p>
          <Button type="submit" size="sm" disabled={!canWrite || !draft.trim()}>
            Invia
          </Button>
        </div>
      </form>
    </main>
  )
}

function EventCard({
  event,
  canWrite,
  onResolve,
}: {
  event: JournalEvent
  canWrite: boolean
  onResolve: (requestId: string, allow: boolean) => void
}) {
  if (event.kind === "user") {
    return (
      <article className="ml-10 rounded-md bg-accent px-3 py-2 text-sm">
        <p className="whitespace-pre-wrap">{event.text}</p>
      </article>
    )
  }
  if (event.kind === "status") {
    return <p className="text-center text-xs text-muted-foreground">{event.text}</p>
  }
  const title = event.engineName ? event.engineName : "Motore"
  return (
    <article
      className={`mr-10 rounded-md border px-3 py-2 text-sm ${event.kind === "error" ? "border-red-900 text-red-300" : "border-border bg-card"}`}
    >
      <p className="mb-1 text-xs text-muted-foreground">
        {title}
        {event.kind === "tool" ? " · tool" : ""}
        {event.kind === "diff" ? " · diff" : ""}
        {event.kind === "permission" ? " · conferma" : ""}
      </p>
      {event.kind === "diff" && typeof event.payload.path === "string" ? (
        <p className="mb-1 font-mono text-xs">{event.payload.path}</p>
      ) : null}
      {event.kind === "tool" && typeof event.payload.input === "string" ? (
        <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{event.payload.input}</pre>
      ) : (
        <p className="whitespace-pre-wrap">{event.text}</p>
      )}
      {event.kind === "permission" && event.payload.resolved == null && canWrite ? (
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" onClick={() => onResolve(String(event.payload.requestId ?? ""), true)}>
            Consenti
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onResolve(String(event.payload.requestId ?? ""), false)}
          >
            Rifiuta
          </Button>
        </div>
      ) : null}
      {event.kind === "permission" && event.payload.resolved != null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {event.payload.resolved === "allow" ? "Consentito" : "Rifiutato"}
        </p>
      ) : null}
    </article>
  )
}
