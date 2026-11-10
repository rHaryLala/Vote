import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminApi, STATUS_LABEL, type Status } from '../api'

export interface DeletableElection {
  id: number
  title: string
  status: Status
  voters_count: number
  voted_count: number
}

const CONFIRM_WORD = 'SUPPRIMER'

/**
 * Suppression définitive d'un ou de plusieurs scrutins. Un brouillon se supprime après une simple confirmation ; dès
 * qu'un scrutin est ouvert ou clos (liste électorale et bulletins), il faut taper « SUPPRIMER ».
 */
export function DeleteElections({
  items,
  trigger,
  onDeleted,
}: {
  items: DeletableElection[]
  trigger: ReactNode
  onDeleted: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  const many = items.length > 1
  const needsTyping = items.some((i) => i.status !== 'draft')
  const voters = items.reduce((n, i) => n + i.voters_count, 0)
  const voted = items.reduce((n, i) => n + i.voted_count, 0)
  const canConfirm = !busy && (!needsTyping || typed.trim() === CONFIRM_WORD)

  const reset = () => {
    setTyped('')
    setError(null)
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await adminApi('/elections/bulk-delete', {
        method: 'POST',
        body: { ids: items.map((i) => i.id), ...(needsTyping ? { confirmation: typed.trim() } : {}) },
      })
      toast.success(many ? `${items.length} scrutins supprimés` : 'Scrutin supprimé', {
        description: 'Ils ne sont plus affichés sur le site public.',
      })
      setOpen(false)
      reset()
      await onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        setOpen(o)
        if (!o) reset()
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{many ? `Supprimer ces ${items.length} scrutins ?` : 'Supprimer ce scrutin ?'}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-3 text-left">
              <ul className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 text-sm">
                {items.map((i) => (
                  <li key={i.id} className="flex items-baseline justify-between gap-3 py-0.5">
                    <span className="min-w-0 truncate font-medium text-foreground">{i.title}</span>
                    <span className="shrink-0 text-xs">
                      {STATUS_LABEL[i.status]} · {i.voters_count} inscrit{i.voters_count > 1 ? 's' : ''}
                      {i.voted_count > 0 ? ` · ${i.voted_count} ont voté` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <span>
                Ils disparaissent <strong className="text-foreground">immédiatement du site public</strong>, avec leur liste électorale
                {needsTyping ? ' et tous leurs bulletins' : ''}. La suppression est inscrite au journal d'audit.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsTyping && (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Irréversible</AlertTitle>
              <AlertDescription>
                {voters.toLocaleString('fr-FR')} électeur{voters > 1 ? 's' : ''} et {voted.toLocaleString('fr-FR')} vote{voted > 1 ? 's' : ''}{' '}
                déposé{voted > 1 ? 's' : ''} seront effacés définitivement. Rien ne pourra être récupéré.
              </AlertDescription>
            </Alert>
            <div className="grid gap-2">
              <Label htmlFor="confirm-word">
                Tapez <code className="rounded bg-muted px-1 font-semibold">{CONFIRM_WORD}</code> pour confirmer
              </Label>
              <Input
                id="confirm-word"
                autoComplete="off"
                autoCapitalize="characters"
                value={typed}
                onChange={(ev) => setTyped(ev.target.value)}
              />
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
          <Button variant="destructive" disabled={!canConfirm} onClick={() => void confirm()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {many ? `Supprimer ${items.length} scrutins` : 'Supprimer'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
