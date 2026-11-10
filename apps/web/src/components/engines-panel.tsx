import type { EngineKind, EngineSummary } from "@cloudai/shared"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { ApiError, api } from "@/lib/api"

const kinds: { id: EngineKind; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini" },
  { id: "openai", label: "OpenAI" },
]

export function EnginesButton({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [engines, setEngines] = useState<EngineSummary[]>([])
  const [name, setName] = useState("")
  const [kind, setKind] = useState<EngineKind>("claude")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1")
  const [model, setModel] = useState("gpt-4.1")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function reload() {
    setEngines(await api<EngineSummary[]>("/api/engines"))
  }

  useEffect(() => {
    if (open) void reload().catch(() => setEngines([]))
  }, [open])

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Motori
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" title="Motori" className="w-[min(100%,24rem)]">
          <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
            <ul className="flex flex-col gap-2">
              {engines.length === 0 ? (
                <li className="text-sm text-muted-foreground">Nessun motore</li>
              ) : (
                engines.map((engine) => (
                  <EngineRow
                    key={engine.id}
                    engine={engine}
                    onChanged={async () => {
                      await reload()
                      onChanged()
                    }}
                  />
                ))
              )}
            </ul>
            <form
              className="flex flex-col gap-3 border-t border-border pt-4"
              onSubmit={async (event) => {
                event.preventDefault()
                setPending(true)
                setError(null)
                try {
                  await api("/api/engines", {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      kind,
                      apiKey,
                      baseUrl: kind === "openai" ? baseUrl : undefined,
                      model: kind === "openai" ? model : undefined,
                    }),
                  })
                  setName("")
                  setApiKey("")
                  await reload()
                  onChanged()
                } catch (caught) {
                  setError(caught instanceof ApiError ? caught.message : "Motore non aggiunto")
                } finally {
                  setPending(false)
                }
              }}
            >
              <Field label="Nome" id="engine-name">
                <Input id="engine-name" required value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Tipo" id="engine-kind">
                <select
                  id="engine-kind"
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as EngineKind)}
                >
                  {kinds.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              {kind === "openai" ? (
                <>
                  <Field label="Base URL" id="engine-url">
                    <Input id="engine-url" type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                  </Field>
                  <Field label="Modello" id="engine-model">
                    <Input id="engine-model" required value={model} onChange={(event) => setModel(event.target.value)} />
                  </Field>
                </>
              ) : null}
              {kind === "openai" ? null : (
                <p className="text-xs text-muted-foreground">
                  Dopo l’aggiunta la CLI mostra un indirizzo. Aprilo, accedi e incolla qui il codice.
                </p>
              )}
              {kind === "openai" ? (
                <Field label="API key" id="engine-key">
                  <Input
                    id="engine-key"
                    type="password"
                    required
                    minLength={8}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </Field>
              ) : null}
              {error ? <p className="text-sm text-red-400">{error}</p> : null}
              <Button type="submit" disabled={pending}>
                Aggiungi
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function EngineRow({ engine, onChanged }: { engine: EngineSummary; onChanged: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const label = kinds.find((item) => item.id === engine.kind)?.label ?? engine.kind
  const cli = engine.kind !== "openai"
  const status = engine.status === "connected" ? "collegato" : engine.status === "login" ? "in attesa di accesso" : "disattivato"

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{engine.name}</p>
          <p className="text-xs text-muted-foreground">
            {label}
            {engine.model ? ` · ${engine.model}` : ""} · {status}
          </p>
        </div>
        {engine.status === "connected" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api(`/api/engines/${engine.id}/disable`, { method: "POST" })
              await onChanged()
            }}
          >
            Disattiva
          </Button>
        ) : null}
      </div>
      {cli && engine.status === "login" ? <CliLogin engineId={engine.id} onChanged={onChanged} /> : null}
      {cli && engine.status !== "login" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={async () => {
            setError(null)
            try {
              await api(`/api/engines/${engine.id}/login`, { method: "POST" })
              await onChanged()
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Accesso non avviato")
            }
          }}
        >
          Accedi
        </Button>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      {cli ? null : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            try {
              await api(`/api/engines/${engine.id}/reconnect`, {
                method: "POST",
                body: JSON.stringify({
                  apiKey,
                  baseUrl: engine.baseUrl,
                  model: engine.model,
                }),
              })
              setApiKey("")
              await onChanged()
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Ricollegamento non riuscito")
            }
          }}
        >
          <Input
            type="password"
            minLength={8}
            required
            placeholder="Nuova credenziale"
            aria-label={`Nuova credenziale per ${engine.name}`}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary">
            Ricollega
          </Button>
        </form>
      )}
    </li>
  )
}

function CliLogin({ engineId, onChanged }: { engineId: string; onChanged: () => Promise<void> }) {
  const [output, setOutput] = useState("")
  const [url, setUrl] = useState<string | null>(null)
  const [running, setRunning] = useState(true)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  const changed = useRef(onChanged)
  changed.current = onChanged

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const state = await api<{ output: string; url: string | null; running: boolean; exitCode: number | null }>(
          `/api/engines/${engineId}/login`,
        )
        if (stop) return
        setOutput(state.output)
        setUrl(state.url)
        setRunning(state.running)
        if (state.exitCode === 0) {
          await changed.current()
          return
        }
        if (state.exitCode !== null) {
          setRunning(false)
          return
        }
      } catch (caught) {
        if (!stop) setError(caught instanceof ApiError ? caught.message : "Accesso non disponibile")
      }
      timer = setTimeout(() => void poll(), 1500)
    }
    void api(`/api/engines/${engineId}/login`, { method: "POST" })
      .then(() => poll())
      .catch((caught: unknown) => {
        if (!stop) setError(caught instanceof ApiError ? caught.message : "Accesso non avviato")
      })
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
  }, [engineId])

  async function send(text: string) {
    setError(null)
    try {
      const state = await api<{ output: string; url: string | null; running: boolean; exitCode: number | null }>(
        `/api/engines/${engineId}/login/input`,
        { method: "POST", body: JSON.stringify({ text }) },
      )
      setOutput(state.output)
      setUrl(state.url)
      setRunning(state.running)
      setCode("")
      if (state.exitCode === 0) await onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Codice non inviato")
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Apri l’indirizzo, accedi e incolla il codice che compare nel browser.</p>
      {url ? (
        <a className="break-all text-sm text-sky-400 underline" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">{running ? "In attesa dell’indirizzo…" : "Accesso fermo"}</p>
      )}
      {output ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs">{output}</pre> : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send(code)
        }}
      >
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Codice"
          aria-label="Codice di accesso"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={code.trim().length === 0}>
            Invia codice
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void send("\n")}>
            Invio
          </Button>
        </div>
      </form>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
