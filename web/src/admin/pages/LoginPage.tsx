import { Loader2, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminError, adminApi, setAdminSession, type AdminUser } from '../api'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await adminApi<{ token: string; expires_at: string | null; user: AdminUser }>('/login', {
        method: 'POST',
        body: { email, password },
      })
      setAdminSession({ token: res.token, expiresAt: res.expires_at, user: res.user })
    } catch (err) {
      setError(
        err instanceof AdminError && err.status === 429
          ? 'Trop de tentatives. Patientez une minute.'
          : err instanceof Error
            ? err.message
            : 'Connexion impossible.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/brand/sa-logo.svg" alt="Student Association" className="mx-auto mb-2 h-20 w-auto" />
          <CardTitle className="text-xl">Commission électorale</CardTitle>
          <CardDescription>Accès réservé à l'administration du scrutin.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
              Se connecter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
