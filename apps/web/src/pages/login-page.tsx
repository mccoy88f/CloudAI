import { useState } from "react"
import { AuthCard, FormError } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <AuthCard title="Entra" description="Usa l'account dell'istanza CloudAI.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setPending(true)
          setError(null)
          try {
            await api("/api/login", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            })
            onLoggedIn()
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : "Accesso non riuscito")
          } finally {
            setPending(false)
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input id="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <FormError>{error}</FormError>
        <Button type="submit" disabled={pending}>Entra</Button>
      </form>
    </AuthCard>
  )
}
