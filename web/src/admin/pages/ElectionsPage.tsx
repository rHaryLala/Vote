import { useQuery } from '@tanstack/react-query'
import { Plus, Vote } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminApi, type ElectionRow } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { fmt } from '../time'

export function ElectionsPage() {
  const navigate = useNavigate()
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'elections'],
    queryFn: () => adminApi<{ data: ElectionRow[] }>('/elections'),
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
          <CardDescription>Le plus récent en premier. Cliquez sur une ligne pour le gérer.</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : data.data.length === 0 ? (
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
                  <TableHead>Scrutin</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden md:table-cell">Ouverture</TableHead>
                  <TableHead className="hidden md:table-cell">Clôture</TableHead>
                  <TableHead className="text-right">Participation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => navigate(`/admin/scrutins/${e.id}`)}>
                    <TableCell>
                      <Link to={`/admin/scrutins/${e.id}`} className="font-medium hover:underline" onClick={(ev) => ev.stopPropagation()}>
                        {e.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{e.candidate_name}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} isOpen={e.is_open} published={e.results_published} />
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
