import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { adminApi, type Paginated } from '../api'
import { fmt } from '../time'

interface LogRow {
  id: number
  event: string
  election_id: number | null
  payload: Record<string, unknown> | null
  hash: string
  created_at: string
}

const EVENTS: Record<string, string> = {
  admin_login: 'Connexion commission',
  admin_login_failed: 'Échec de connexion commission',
  election_created: 'Scrutin créé',
  election_deleted: 'Scrutin supprimé',
  voters_imported: 'Liste électorale importée',
  voters_synced: 'Liste synchronisée (registrar)',
  voter_added: 'Électeur ajouté à la main',
  voter_removed: 'Électeur retiré',
  election_opened: 'Scrutin ouvert',
  election_dates_changed: 'Dates modifiées',
  election_closed: 'Scrutin clos',
  results_published: 'Résultats publiés',
  voter_login: 'Connexion électeur',
  login_refused: 'Connexion refusée (hors liste)',
  vote_cast: 'Bulletin déposé',
  content_updated: 'Contenu modifié',
  admin_password_changed: 'Mot de passe modifié (commission)',
  admin_password_reset: "Mot de passe d'un membre réinitialisé",
  admin_user_created: 'Compte de la commission créé',
  admin_user_deleted: 'Compte de la commission supprimé',
}

export function AuditPage() {
  const [page, setPage] = useState(1)
  const [checking, setChecking] = useState(false)
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => adminApi<Paginated<LogRow>>(`/audit?page=${page}`),
    placeholderData: (prev) => prev,
  })

  async function verify() {
    setChecking(true)
    try {
      const r = await adminApi<{ intact: boolean; broken_at: number | null }>('/audit/verify')
      if (r.intact) toast.success("Journal d'audit intègre", { description: 'Aucune entrée n’a été modifiée ni supprimée.' })
      else toast.error('Journal altéré', { description: `La chaîne est rompue à l'entrée n° ${r.broken_at}.`, duration: Infinity })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Vérification impossible')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal d'audit</h1>
          <p className="text-sm text-muted-foreground">
            Chaque opération, chaînée à la précédente par empreinte. Jamais le contenu d'un vote.
          </p>
        </div>
        <Button variant="outline" onClick={() => void verify()} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Vérifier l'intégrité
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entrées ({data?.meta.total ?? '…'})</CardTitle>
          <CardDescription>La plus récente en premier. Heure de Madagascar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : error ? (
            <p className="text-destructive">{error.message}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">N°</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Événement</TableHead>
                  <TableHead className="hidden lg:table-cell">Détail</TableHead>
                  <TableHead className="hidden md:table-cell">Empreinte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{l.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(l.created_at, true)}</TableCell>
                    <TableCell>
                      <Badge variant={l.event.includes('failed') || l.event.includes('refused') ? 'destructive' : 'secondary'}>
                        {EVENTS[l.event] ?? l.event}
                      </Badge>
                      {l.election_id && <span className="ml-2 text-xs text-muted-foreground">scrutin n° {l.election_id}</span>}
                    </TableCell>
                    <TableCell className="hidden max-w-80 truncate font-mono text-xs text-muted-foreground lg:table-cell">
                      {l.payload ? JSON.stringify(l.payload) : '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <code className="cursor-help text-xs">{l.hash.slice(0, 12)}…</code>
                        </TooltipTrigger>
                        <TooltipContent className="font-mono">{l.hash}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {data && data.meta.last_page > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {data.meta.page} / {data.meta.last_page}
              </span>
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Page précédente">
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= data.meta.last_page}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Page suivante"
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
