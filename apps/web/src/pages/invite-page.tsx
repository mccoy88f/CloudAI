import { useState } from "react"
import { AuthCard, FormError } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"

export function InvitePage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? ""
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <AuthCard title="Primo accesso" description="Scegli la password per questo invito. Il link funziona una sola volta.">
      {token ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (password !== confirm) {
              setError("Le password non coincidono")
              return
            }
            setPending(true)
            setError(null)
            try {
              await api("/api/invites/accept", {
                method: "POST",
                body: JSON.stringify({ token, password }),
              })
              window.location.assign("/")
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Invito non accettato")
              setPending(false)
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-password">Password</Label>
            <Input id="invite-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-confirm">Ripeti la password</Label>
            <Input id="invite-confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </div>
          <FormError>{error}</FormError>
          <Button type="submit" disabled={pending}>Crea l'account</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Questo link non contiene un invito.</p>
      )}
    </AuthCard>
  )
}
