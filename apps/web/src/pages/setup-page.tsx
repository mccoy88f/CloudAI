import type { PublicUser, SetupState, SetupStep } from "@cloudai/shared"
import { useState, type ReactNode } from "react"
import { AuthCard, FormError } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, api } from "@/lib/api"

const steps: { id: Exclude<SetupStep, "done">; label: string }[] = [
  { id: "admin", label: "Account" },
  { id: "github", label: "GitHub" },
  { id: "folder", label: "Cartella" },
  { id: "url", label: "URL" },
  { id: "preview", label: "Preview" },
]

export function SetupPage({
  setup,
  user,
  onChanged,
}: {
  setup: SetupState
  user: PublicUser | null
  onChanged: () => Promise<void>
}) {
  const step = setup.step === "done" ? "preview" : setup.step
  const index = Math.max(steps.findIndex((item) => item.id === step), 0)

  return (
    <AuthCard
      title="Configurazione"
      description="Si fa una volta. Poi la workspace resta aperta per tutti gli utenti."
    >
      <ol className="mb-6 flex gap-2">
        {steps.map((item, itemIndex) => (
          <li
            key={item.id}
            className={`h-1 flex-1 rounded-full ${itemIndex <= index ? "bg-foreground" : "bg-border"}`}
          >
            <span className="sr-only">
              {item.label}
              {itemIndex === index ? ", passo corrente" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-4 text-xs text-muted-foreground">
        Passo {index + 1} di {steps.length} · {steps[index]?.label}
      </p>
      {step === "admin" ? <AdminStep onChanged={onChanged} /> : null}
      {step === "github" && user ? <GithubStep onChanged={onChanged} setup={setup} /> : null}
      {step === "folder" && user ? <FolderStep onChanged={onChanged} setup={setup} /> : null}
      {step === "url" && user ? <UrlStep onChanged={onChanged} setup={setup} /> : null}
      {step === "preview" && user ? <PreviewStep onChanged={onChanged} setup={setup} /> : null}
      {step !== "admin" && !user ? (
        <p className="text-sm text-muted-foreground">Entra con l'account amministratore per continuare.</p>
      ) : null}
    </AuthCard>
  )
}

function AdminStep({ onChanged }: { onChanged: () => Promise<void> }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (password !== confirm) {
          setError("Le password non coincidono")
          return
        }
        await submit(setPending, setError, onChanged, () =>
          api("/api/setup/admin", { method: "POST", body: JSON.stringify({ email, password }) }),
        )
      }}
    >
      <Field label="Email" id="admin-email">
        <Input id="admin-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field label="Password" id="admin-password">
        <Input id="admin-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      <Field label="Ripeti la password" id="admin-confirm">
        <Input id="admin-confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={pending}>Crea amministratore</Button>
    </form>
  )
}

function GithubStep({ setup, onChanged }: { setup: SetupState; onChanged: () => Promise<void> }) {
  const [appId, setAppId] = useState(setup.github.appId)
  const [organization, setOrganization] = useState(setup.github.organization)
  const [privateKey, setPrivateKey] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        await submit(setPending, setError, onChanged, () =>
          api("/api/setup/github", {
            method: "POST",
            body: JSON.stringify({ appId, organization, privateKey, webhookSecret }),
          }),
        )
      }}
    >
      <Field label="App ID" id="github-app">
        <Input id="github-app" inputMode="numeric" required value={appId} onChange={(event) => setAppId(event.target.value)} />
      </Field>
      <Field label="Organizzazione" id="github-org">
        <Input id="github-org" required value={organization} onChange={(event) => setOrganization(event.target.value)} />
      </Field>
      <Field label="Chiave privata" id="github-key">
        <Textarea id="github-key" required value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
      </Field>
      <Field label="Webhook secret" id="github-secret">
        <Input id="github-secret" type="password" required minLength={8} value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={pending}>Salva GitHub</Button>
    </form>
  )
}

function FolderStep({ setup, onChanged }: { setup: SetupState; onChanged: () => Promise<void> }) {
  const [path, setPath] = useState(setup.workspacesDir || "/workspaces")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        await submit(setPending, setError, onChanged, () =>
          api("/api/setup/folder", { method: "POST", body: JSON.stringify({ path }) }),
        )
      }}
    >
      <Field label="Cartella dei progetti" id="folder-path">
        <Input id="folder-path" required value={path} onChange={(event) => setPath(event.target.value)} />
      </Field>
      <p className="text-sm text-muted-foreground">
        Nel container il volume è montato su /workspaces. I progetti di tutti gli utenti stanno lì.
      </p>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={pending}>Continua</Button>
    </form>
  )
}

function UrlStep({ setup, onChanged }: { setup: SetupState; onChanged: () => Promise<void> }) {
  const [publicUrl, setPublicUrl] = useState(setup.publicUrl || window.location.origin)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        await submit(setPending, setError, onChanged, () =>
          api("/api/setup/url", { method: "POST", body: JSON.stringify({ publicUrl }) }),
        )
      }}
    >
      <Field label="URL pubblico" id="public-url">
        <Input id="public-url" type="url" required value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={pending}>Continua</Button>
    </form>
  )
}

function PreviewStep({ setup, onChanged }: { setup: SetupState; onChanged: () => Promise<void> }) {
  const [previewDomain, setPreviewDomain] = useState(setup.previewDomain)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        await submit(setPending, setError, onChanged, () =>
          api("/api/setup/preview", { method: "POST", body: JSON.stringify({ previewDomain }) }),
        )
      }}
    >
      <Field label="Dominio delle preview" id="preview-domain">
        <Input
          id="preview-domain"
          required
          placeholder="preview.tuodominio.it"
          value={previewDomain}
          onChange={(event) => setPreviewDomain(event.target.value)}
        />
      </Field>
      <p className="text-sm text-muted-foreground">
        Ogni progetto risponderà su un nome di questo dominio, per esempio app.preview.tuodominio.it.
        Il certificato wildcard si configura sul proxy, non qui.
      </p>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={pending}>Apri la workspace</Button>
    </form>
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

async function submit(
  setPending: (value: boolean) => void,
  setError: (value: string | null) => void,
  onChanged: () => Promise<void>,
  run: () => Promise<unknown>,
) {
  setPending(true)
  setError(null)
  try {
    await run()
    await onChanged()
  } catch (error) {
    setError(error instanceof ApiError ? error.message : "Richiesta non riuscita")
  } finally {
    setPending(false)
  }
}
