import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Plus, Trash2, Vote } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminApi, type ElectionRow } from '../api'
import { DeleteElections } from '../components/DeleteElections'
import { StatusBadge } from '../components/StatusBadge'
import { fmt } from '../time'

/** Pourquoi un scrutin n'est pas affiché au public. */
const hiddenReason = (e: ElectionRow) => (e.status === 'draft' ? 'brouillon' : 'clos, résultats non publiés')

export function ElectionsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'elections'],
    queryFn: () => adminApi<{ data: ElectionRow[] }>('/elections'),
  })
  const rows = useMemo(() => data?.data ?? [], [data])

  // Sélection multiple : on ne garde que des scrutins qui existent encore (après une suppression, la liste se rafraîchit).
  const [selected, setSelected] = useState<Set<number>>(new Set())
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(rows.map((r) => r.id))
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [rows])

  const chosen = rows.filter((r) => selected.has(r.id))
  const allChecked = rows.length > 0 && chosen.length === rows.length
  const someChecked = chosen.length > 0 && !allChecked

  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scrutins</h1>
          <p className="text-sm text-muted-foreground">Créez le scrutin, importez la liste électorale, puis ouvrez le vote.</p>
        </div>
        <Button asChild>
          <Link to="/admin/scrutins/nouveau">
            <Plus /> Nouveau scrutin
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tous les scrutins</CardTitle>
          <CardDescription>
            Cochez un ou plusieurs scrutins pour les supprimer. Le site public n'affiche qu'un scrutin en cours, ou clos dont les résultats
            sont publiés.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {chosen.length > 0 && (
            <div
              role="region"
              aria-label="Actions sur la sélection"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3"
            >
              <span className="text-sm font-medium">
                {chosen.length} scrutin{chosen.length > 1 ? 's' : ''} sélectionné{chosen.length > 1 ? 's' : ''}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Tout désélectionner
                </Button>
                <DeleteElections
                  items={chosen}
                  onDeleted={async () => {
                    setSelected(new Set())
                    await qc.invalidateQueries({ queryKey: ['admin'] })
                  }}
                  trigger={
                    <Button variant="destructive" size="sm">
                      <Trash2 /> Supprimer ({chosen.length})
                    </Button>
                  }
                />
              </div>
            </div>
          )}

          {isPending ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Vote className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Aucun scrutin pour l'instant.</p>
              <Button asChild variant="outline">
                <Link to="/admin/scrutins/nouveau">
                  <Plus /> Créer le premier scrutin
                </Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Tout sélectionner"
                      checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                      onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Scrutin</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Site public</TableHead>
                  <TableHead className="hidden md:table-cell">Ouverture</TableHead>
                  <TableHead className="hidden md:table-cell">Clôture</TableHead>
                  <TableHead className="text-right">Participation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow
                    key={e.id}
                    data-state={selected.has(e.id) ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/scrutins/${e.id}`)}
                  >
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox
                        aria-label={`Sélectionner ${e.title}`}
                        checked={selected.has(e.id)}
                        onCheckedChange={(v) => toggle(e.id, v === true)}
                      />
                    </TableCell>
                    <TableCell>
                      <Link to={`/admin/scrutins/${e.id}`} className="font-medium hover:underline" onClick={(ev) => ev.stopPropagation()}>
                        {e.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{e.candidate_name}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} isOpen={e.is_open} published={e.results_published} />
                    </TableCell>
                    <TableCell>
                      {e.public_visible ? (
                        <Badge variant="outline" className="gap-1 border-success text-success">
                          <Eye className="size-3" /> Visible
                        </Badge>
                      ) : (
                        <div>
                          <Badge variant="secondary" className="gap-1">
                            <EyeOff className="size-3" /> Masqué
                          </Badge>
                          <div className="mt-0.5 text-xs text-muted-foreground">{hiddenReason(e)}</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{fmt(e.opens_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">{fmt(e.closes_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.voted_count} / {e.voters_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
