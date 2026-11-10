import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminError, adminApi, type AdminElection } from '../api'
import { ConfirmButton } from './ConfirmButton'

/**
 * Ajout manuel d'un électeur : adresse + nom (+ matricule facultatif). Possible jusqu'à la clôture.
 * Pendant le vote, l'ajout demande une confirmation explicite et est inscrit au journal d'audit.
 */
export function ManualVoter({ e }: { e: AdminElection }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const duringVote = e.status === 'open'
  const ready = email.trim() !== '' && name.trim() !== ''

  const add = useMutation({
    mutationFn: () =>
      adminApi(`/elections/${e.id}/voters`, {
        method: 'POST',
        body: { email, name, student_id: studentId || null },
      }),
    onSuccess: () => {
      toast.success('Électeur ajouté', {
        description: duringVote ? `${name.trim()} peut voter dès sa connexion. L'ajout est inscrit au journal d'audit.` : name.trim(),
      })
      setEmail('')
      setName('')
      setStudentId('')
      setErrors({})
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (err) => {
      if (err instanceof AdminError) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
      toast.error(err.message)
    },
  })

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (ready && !duringVote) add.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-4" /> Ajouter un électeur manuellement
        </CardTitle>
        <CardDescription>
          Pour un étudiant absent de la liste du registrar (inscription tardive, fiche sans adresse…). Il garde sa place après une
          synchronisation ou un import.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {duringVote && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Le vote est ouvert</AlertTitle>
            <AlertDescription>
              L'électeur ajouté pourra voter dès qu'il se connectera. Chaque ajout est inscrit au journal d'audit (avec l'heure et votre
              compte), et change le nombre d'inscrits.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1.2fr_1fr_0.7fr_auto] md:items-start">
          <div className="grid gap-2">
            <Label htmlFor="mv-email">Adresse e-mail</Label>
            <Input
              id="mv-email"
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
            <Label htmlFor="mv-name">Nom complet</Label>
            <Input id="mv-name" autoComplete="off" value={name} aria-invalid={!!errors.name} onChange={(ev) => setName(ev.target.value)} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mv-id">Matricule (facultatif)</Label>
            <Input id="mv-id" autoComplete="off" value={studentId} onChange={(ev) => setStudentId(ev.target.value)} />
          </div>

          <div className="md:pt-[1.625rem]">
            {duringVote ? (
              <ConfirmButton
                disabled={!ready || add.isPending}
                title="Ajouter cet électeur pendant le vote ?"
                description={
                  <>
                    <strong>{name.trim() || '…'}</strong> ({email.trim() || '…'}) sera ajouté à la liste électorale d'un scrutin déjà ouvert et
                    pourra voter immédiatement. Cet ajout est inscrit au journal d'audit.
                  </>
                }
                confirmLabel="Ajouter l'électeur"
                onConfirm={async () => {
                  try {
                    await add.mutateAsync()
                  } catch {
                    // Erreur déjà affichée (toast et champs).
                  }
                }}
              >
                <UserPlus /> Ajouter
              </ConfirmButton>
            ) : (
              <Button type="submit" disabled={!ready || add.isPending}>
                {add.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Ajouter
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
