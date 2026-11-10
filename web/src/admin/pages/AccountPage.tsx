import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Loader2, ShieldAlert, Trash2, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminError, adminApi, useAdminSession } from '../api'
import { ConfirmButton } from '../components/ConfirmButton'
import { fmt } from '../time'

interface CommissionUser {
  id: number
  name: string
  email: string
  created_at: string
  last_login_at: string | null
  is_self: boolean
}

/** Premier message d'erreur par champ, tel que renvoyé par Laravel. */
function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof AdminError ? Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])) : {}
}

/* ------------------------------------------------------------------ Mot de passe affiché une seule fois */

function SecretDialog({ secret, who, onClose }: { secret: string | null; who: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copie impossible : sélectionnez le mot de passe et copiez-le à la main.')
    }
  }

  return (
    <Dialog open={secret !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mot de passe de {who}</DialogTitle>
          <DialogDescription>
            À transmettre en main propre. Il n'est affiché <strong>qu'une seule fois</strong> : il n'est pas conservé en clair et ne
            pourra plus être relu.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all rounded-md border bg-muted px-3 py-2 text-center font-mono text-base tracking-wider break-all">
            {secret}
          </code>
          <Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Copier le mot de passe">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>J'ai noté le mot de passe</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Changer mon mot de passe */

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const change = useMutation({
    mutationFn: () =>
      adminApi('/account/password', {
        method: 'PUT',
        body: { current_password: current, password: next, password_confirmation: confirm },
      }),
    onSuccess: () => {
      toast.success('Mot de passe modifié', { description: 'Vos autres sessions ouvertes ont été fermées.' })
      setCurrent('')
      setNext('')
      setConfirm('')
      setErrors({})
    },
    onError: (err) => {
      setErrors(fieldErrors(err))
      toast.error(err.message)
    },
  })

  const mismatch = confirm !== '' && next !== confirm
  const ready = current !== '' && next.length >= 10 && next === confirm

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (ready) change.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Changer mon mot de passe
        </CardTitle>
        <CardDescription>
          10 caractères au moins, avec des lettres et des chiffres. Vos autres sessions ouvertes (autre appareil) seront fermées.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pw-current">Mot de passe actuel</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              aria-invalid={!!errors.current_password}
              onChange={(ev) => setCurrent(ev.target.value)}
            />
            {errors.current_password && <p className="text-xs text-destructive">{errors.current_password}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-new">Nouveau mot de passe</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              aria-invalid={!!errors.password}
              onChange={(ev) => setNext(ev.target.value)}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">Confirmer le nouveau mot de passe</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-invalid={mismatch}
              onChange={(ev) => setConfirm(ev.target.value)}
            />
            {mismatch && <p className="text-xs text-destructive">Les deux saisies ne sont pas identiques.</p>}
          </div>
          <div>
            <Button type="submit" disabled={!ready || change.isPending}>
              {change.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Changer le mot de passe
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ Comptes de la commission */

function CreateUser({ onCreated }: { onCreated: (name: string, password: string | null) => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const create = useMutation({
    mutationFn: () =>
      adminApi<{ user: CommissionUser; password: string | null }>('/users', {
        method: 'POST',
        body: { name, email, password: password || null },
      }),
    onSuccess: (res) => {
      toast.success('Compte créé', { description: res.user.email })
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      setOpen(false)
      setName('')
      setEmail('')
      setPassword('')
      setErrors({})
      onCreated(res.user.name, res.password)
    },
    onError: (err) => {
      setErrors(fieldErrors(err))
      toast.error(err.message)
    },
  })

  const ready = name.trim() !== '' && email.trim() !== '' && (password === '' || password.length >= 10)

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (ready) create.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setErrors({})
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Nouveau compte
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nouveau membre de la commission</DialogTitle>
            <DialogDescription>
              Ce compte aura accès à toute l'administration : scrutins, liste électorale, résultats et comptes. Réservez-le aux personnes
              de confiance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="nu-name">Nom complet</Label>
            <Input id="nu-name" autoComplete="off" value={name} aria-invalid={!!errors.name} onChange={(ev) => setName(ev.target.value)} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nu-email">Adresse e-mail</Label>
            <Input
              id="nu-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="prenom.nom@zurcher.edu.mg"
              value={email}
              aria-invalid={!!errors.email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nu-pw">Mot de passe (facultatif)</Label>
            <Input
              id="nu-pw"
              type="password"
              autoComplete="new-password"
              placeholder="Laisser vide pour en générer un"
              value={password}
              aria-invalid={!!errors.password}
              onChange={(ev) => setPassword(ev.target.value)}
            />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Généré automatiquement si vide, puis affiché une seule fois.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Créer le compte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Users() {
  const qc = useQueryClient()
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null)
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => adminApi<{ data: CommissionUser[] }>('/users'),
  })

  async function reset(u: CommissionUser) {
    try {
      const res = await adminApi<{ password: string }>(`/users/${u.id}/reset-password`, { method: 'POST' })
      setSecret({ who: u.name, password: res.password })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Réinitialisation impossible')
    }
  }

  async function remove(u: CommissionUser) {
    try {
      await adminApi(`/users/${u.id}`, { method: 'DELETE' })
      toast.success('Compte supprimé', { description: u.email })
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle>Comptes de la commission</CardTitle>
          <CardDescription>Les membres qui peuvent se connecter à cette administration.</CardDescription>
        </div>
        <CreateUser onCreated={(who, password) => password && setSecret({ who, password })} />
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead className="hidden md:table-cell">Dernière connexion</TableHead>
                <TableHead className="w-0 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {u.name}
                      {u.is_self && <Badge variant="secondary">Vous</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {u.last_login_at ? fmt(u.last_login_at) : 'Jamais'}
                  </TableCell>
                  <TableCell className="text-right">
                    {!u.is_self && (
                      <div className="flex justify-end gap-2">
                        <ConfirmButton
                          variant="outline"
                          size="sm"
                          title={`Réinitialiser le mot de passe de ${u.name} ?`}
                          description="Un nouveau mot de passe sera généré et affiché une seule fois. L'ancien cesse de fonctionner et ses sessions ouvertes sont fermées."
                          confirmLabel="Réinitialiser"
                          onConfirm={() => reset(u)}
                        >
                          <KeyRound /> <span className="hidden sm:inline">Réinitialiser</span>
                        </ConfirmButton>
                        <ConfirmButton
                          variant="destructive"
                          size="icon-sm"
                          ariaLabel={`Supprimer le compte de ${u.name}`}
                          title={`Supprimer le compte de ${u.name} ?`}
                          description={`${u.email} ne pourra plus se connecter à l'administration. Cette action est inscrite au journal d'audit et ne peut pas être annulée.`}
                          confirmLabel="Supprimer le compte"
                          onConfirm={() => remove(u)}
                        >
                          <Trash2 />
                        </ConfirmButton>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <SecretDialog secret={secret?.password ?? null} who={secret?.who ?? ''} onClose={() => setSecret(null)} />
    </Card>
  )
}

export function AccountPage() {
  const session = useAdminSession()!

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mon compte</h1>
        <p className="text-sm text-muted-foreground">
          Connecté en tant que <strong>{session.user.name}</strong> ({session.user.email}).
        </p>
      </div>

      <ChangePassword />

      <Users />

      <Alert>
        <ShieldAlert />
        <AlertTitle>Traçabilité</AlertTitle>
        <AlertDescription>
          La création d'un compte, la réinitialisation d'un mot de passe, sa modification et la suppression d'un compte sont inscrites au
          journal d'audit (identifiants des comptes concernés, jamais les mots de passe).
        </AlertDescription>
      </Alert>
    </div>
  )
}
