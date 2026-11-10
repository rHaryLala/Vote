import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, Download, Eye, Loader2, RefreshCw, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminApi, type AdminElection } from '../api'
import { fmt } from '../time'
import { ConfirmButton } from './ConfirmButton'

interface RegistrarSession {
  id: number
  name: string
  year: string
  semester: number
  selected: boolean
  enrolled: number
}

type Levels = 'all' | 'licence' | 'master'

const LEVEL_LABEL: Record<Levels, string> = { all: 'Licence et Master', licence: 'Licence seulement', master: 'Master seulement' }

interface MissingEmail {
  student_id: string
  name: string
  reason: 'missing' | 'other_domain'
  level: 'licence' | 'master'
}

interface SyncResult {
  valid: number
  invalid: number
  duplicate: number
  added: number
  removed: number
  unchanged: number
  manual: number
  total: number
  without_email: number
  without_email_list: MissingEmail[]
  levels: Levels
  by_level: Record<'licence' | 'master', { eligible: number; without_email: number }>
  enrolled: number
  dry_run: boolean
  session: { id: number; name: string; year: string; semester: number }
}

const label = (s: RegistrarSession) =>
  `${s.year} · ${s.name} — ${s.enrolled} inscrit${s.enrolled > 1 ? 's' : ''}${s.selected ? ' (session active)' : ''}`

function Figure({ title, value, tone }: { title: string; value: number; tone?: 'add' | 'remove' }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div
        className={
          'text-2xl font-semibold tabular-nums ' + (value === 0 ? '' : tone === 'add' ? 'text-success' : tone === 'remove' ? 'text-destructive' : '')
        }
      >
        {tone === 'add' && value > 0 ? '+' : tone === 'remove' && value > 0 ? '−' : ''}
        {value.toLocaleString('fr-FR')}
      </div>
    </div>
  )
}

const REASON: Record<MissingEmail['reason'], string> = { missing: 'Aucune adresse', other_domain: 'Adresse hors @zurcher.edu.mg' }
const LEVEL_NAME = { licence: 'Licence', master: 'Master' } as const

/** CSV lisible par Excel en français (séparateur « ; », BOM UTF-8) pour transmettre la liste à corriger au registrar. */
function downloadCsv(rows: MissingEmail[]) {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [['Matricule', 'Nom', 'Niveau', 'Problème'].map(q).join(';')]
  for (const r of rows) lines.push([r.student_id, r.name, LEVEL_NAME[r.level], REASON[r.reason]].map(q).join(';'))
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'etudiants-sans-adresse-zurcher.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function WithoutEmail({ rows, count, levels }: { rows: MissingEmail[]; count: number; levels: Levels }) {
  return (
    <Alert>
      <AlertTriangle />
      <AlertTitle>
        {count} étudiant{count > 1 ? 's' : ''} inscrit{count > 1 ? 's' : ''} sans adresse @zurcher.edu.mg
        {levels !== 'all' && ` (${LEVEL_NAME[levels]})`}
      </AlertTitle>
      <AlertDescription className="grid gap-3">
        <span>
          Ils ne pourront pas se connecter avec Google, donc pas voter. Corrigez leur fiche dans le registrar, puis relancez la
          synchronisation avant l'ouverture.
        </span>
        {rows.length > 0 ? (
          <>
            <div className="max-h-64 overflow-auto rounded-md border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matricule</TableHead>
                    <TableHead>Nom</TableHead>
                    <TableHead>Niveau</TableHead>
                    <TableHead className="hidden sm:table-cell">Problème</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.student_id}>
                      <TableCell className="font-mono text-xs">{r.student_id}</TableCell>
                      <TableCell className="font-medium">{r.name || '—'}</TableCell>
                      <TableCell>{LEVEL_NAME[r.level]}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{REASON[r.reason]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => downloadCsv(rows)}>
              <Download /> Télécharger la liste (CSV)
            </Button>
          </>
        ) : (
          <span className="text-xs">
            Le détail (noms) n'est pas fourni par le registrar : mettez à jour l'export (<code>install-on-vps.sh</code>).
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Synchronisation de la liste électorale avec le registrar. La commission choisit la session (le registrar n'a pas
 * de notion unique de « session active »), prévisualise ce qui changerait, puis confirme.
 */
export function RegistrarSync({ e }: { e: AdminElection }) {
  const qc = useQueryClient()
  const sessions = useQuery({
    queryKey: ['admin', 'registrar', 'sessions'],
    queryFn: () => adminApi<{ configured: boolean; sessions: RegistrarSession[] }>('/registrar/sessions'),
    retry: false,
    staleTime: 60_000,
  })
  const [sessionId, setSessionId] = useState('')
  const [preview, setPreview] = useState<SyncResult | null>(null)
  const [levels, setLevels] = useState<Levels>(e.registrar.levels ?? 'all')

  // Par défaut : la session marquée active, sinon la plus récente qui a des inscrits.
  useEffect(() => {
    const list = sessions.data?.sessions
    if (sessionId || !list?.length) return
    if (e.registrar.session_id && list.some((x) => x.id === e.registrar.session_id)) {
      setSessionId(String(e.registrar.session_id))
      return
    }
    const def = list.find((s) => s.selected && s.enrolled > 0) ?? list.find((s) => s.enrolled > 0) ?? list[0]
    setSessionId(String(def.id))
  }, [sessions.data, sessionId, e.registrar.session_id])

  const sync = useMutation({
    mutationFn: (dryRun: boolean) =>
      adminApi<{ data: SyncResult }>(`/elections/${e.id}/voters/sync`, {
        method: 'POST',
        body: { session_id: Number(sessionId), dry_run: dryRun, levels },
      }),
    onSuccess: ({ data }) => {
      if (data.dry_run) {
        setPreview(data)
        return
      }
      setPreview(null)
      toast.success('Liste électorale synchronisée', {
        description: `${data.valid} électeurs · ${data.added} ajoutés · ${data.removed} retirés`,
      })
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const auto = useMutation({
    mutationFn: (enabled: boolean) =>
      adminApi<{ sync: { status: string; message: string | null; added: number; removed: number } }>(`/elections/${e.id}/registrar/auto`, {
        method: 'PUT',
        body: { enabled, session_id: enabled ? Number(sessionId) : null, levels },
      }),
    onSuccess: (res, enabled) => {
      if (!enabled) toast.success('Synchronisation automatique désactivée')
      else if (res.sync.status === 'error') toast.error('Activée, mais la première synchronisation a échoué', { description: res.sync.message ?? undefined })
      else toast.success('Synchronisation automatique activée', { description: `Première reprise faite : +${res.sync.added} / −${res.sync.removed}.` })
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (err) => toast.error(err.message),
  })

  if (sessions.isPending) return <Skeleton className="h-40 w-full" />

  if (sessions.data && !sessions.data.configured) {
    return (
      <Alert>
        <DatabaseZap />
        <AlertTitle>Synchronisation avec le registrar non configurée</AlertTitle>
        <AlertDescription>
          Renseignez <code>REGISTRAR_EXPORT_URL</code> et <code>REGISTRAR_EXPORT_TOKEN</code> dans l'API (voir{' '}
          <code>deploy/registrar/README.md</code>), ou utilisez l'import CSV ci-dessous.
        </AlertDescription>
      </Alert>
    )
  }

  if (sessions.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Registrar inaccessible</AlertTitle>
        <AlertDescription className="grid gap-3">
          <span>{sessions.error.message}</span>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => void sessions.refetch()}>
            <RefreshCw /> Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const list = sessions.data?.sessions ?? []
  const chosen = list.find((s) => String(s.id) === sessionId)
  // La synchronisation exige un aperçu de CETTE session : on ne remplace jamais la liste à l'aveugle.
  const previewed = preview !== null && String(preview.session.id) === sessionId && preview.levels === levels

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZap className="size-4" /> Synchroniser avec le registrar
        </CardTitle>
        <CardDescription>
          Reprend les étudiants inscrits à la session choisie (une inscription non supprimée suffit). La liste actuelle est remplacée.
          Possible tant que le scrutin est en brouillon.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid max-w-xl gap-2">
          <Label htmlFor="session">Session du registrar</Label>
          <Select
            value={sessionId}
            disabled={e.registrar.auto_sync}
            onValueChange={(v) => {
              setSessionId(v)
              setPreview(null)
            }}
          >
            <SelectTrigger id="session" className="w-full">
              <SelectValue placeholder="Choisir une session" />
            </SelectTrigger>
            <SelectContent>
              {list.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid max-w-xl gap-2">
          <Label htmlFor="levels">Niveaux concernés</Label>
          <Select
            value={levels}
            disabled={e.registrar.auto_sync}
            onValueChange={(v) => {
              setLevels(v as Levels)
              setPreview(null)
            }}
          >
            <SelectTrigger id="levels" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LEVEL_LABEL) as Levels[]).map((l) => (
                <SelectItem key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Un étudiant est en Master à partir de la 4e année d'étude de sa fiche ; la remise à niveau est comptée avec la Licence.
            {e.registrar.auto_sync && ' Désactivez la synchronisation automatique pour changer la session ou les niveaux.'}
          </p>
        </div>

        <div className="grid gap-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="auto-sync" className="flex items-center gap-2">
                <Timer className="size-4" /> Synchronisation automatique
              </Label>
              <p className="text-sm text-muted-foreground">
                Reprend les inscrits de la session choisie toutes les 15 minutes, tant que le scrutin est en brouillon, puis une dernière fois
                à l'ouverture. Les électeurs ajoutés à la main sont conservés. Une erreur du registrar (liste vide, retrait massif) ne touche jamais
                la liste.
              </p>
            </div>
            <Switch
              id="auto-sync"
              checked={e.registrar.auto_sync}
              disabled={auto.isPending || (!e.registrar.auto_sync && !previewed)}
              onCheckedChange={(v) => auto.mutate(v)}
            />
          </div>
          {e.registrar.auto_sync && (
            <p className="text-xs text-muted-foreground">
              Suit : {LEVEL_LABEL[e.registrar.levels ?? 'all']}.{' '}
              {e.registrar.synced_at ? <>Dernier contrôle : {fmt(e.registrar.synced_at, true)}.</> : 'Premier contrôle en attente.'}
            </p>
          )}
          {e.registrar.error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Dernière synchronisation automatique refusée</AlertTitle>
              <AlertDescription>{e.registrar.error}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!sessionId || sync.isPending} onClick={() => sync.mutate(true)}>
            {sync.isPending && sync.variables === true ? <Loader2 className="animate-spin" /> : <Eye />} Aperçu
          </Button>
          <ConfirmButton
            title="Remplacer la liste électorale ?"
            description={
              <>
                La liste actuelle ({e.stats.registered.toLocaleString('fr-FR')} électeurs) sera remplacée par les{' '}
                {preview ? (preview.total - preview.manual).toLocaleString('fr-FR') : ''} étudiants inscrits à «{' '}
                {chosen ? `${chosen.year} · ${chosen.name}` : ''} » ({LEVEL_LABEL[levels]})
                {preview && preview.manual > 0 ? ` (les ${preview.manual} électeur(s) ajouté(s) manuellement sont conservés)` : ''}. Après
                l'ouverture du scrutin, l'import et la synchronisation ne seront plus possibles.
              </>
            }
            confirmLabel="Synchroniser"
            disabled={!previewed || sync.isPending}
            onConfirm={async () => {
              try {
                await sync.mutateAsync(false)
              } catch {
                // L'erreur est déjà affichée (toast) par la mutation.
              }
            }}
          >
            <RefreshCw /> Synchroniser
          </ConfirmButton>
          {!previewed && <span className="self-center text-xs text-muted-foreground">Faites d'abord un aperçu.</span>}
        </div>

        {preview && previewed && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure title="Électeurs après synchronisation" value={preview.total} />
              <Figure title="Ajoutés" value={preview.added} tone="add" />
              <Figure title="Retirés" value={preview.removed} tone="remove" />
              <Figure title="Inchangés" value={preview.unchanged} />
            </div>
            <p className="text-xs text-muted-foreground">
              Toute la session : <strong>Licence {preview.by_level.licence.eligible.toLocaleString('fr-FR')}</strong> électeurs
              {preview.by_level.licence.without_email > 0 && ` (+${preview.by_level.licence.without_email} sans adresse)`} ·{' '}
              <strong>Master {preview.by_level.master.eligible.toLocaleString('fr-FR')}</strong> électeurs
              {preview.by_level.master.without_email > 0 && ` (+${preview.by_level.master.without_email} sans adresse)`}.
            </p>
            {preview.without_email > 0 && (
              <WithoutEmail rows={preview.without_email_list} count={preview.without_email} levels={preview.levels} />
            )}
            {preview.manual > 0 && (
              <p className="text-xs text-muted-foreground">
                Dont {preview.manual} électeur{preview.manual > 1 ? 's' : ''} ajouté{preview.manual > 1 ? 's' : ''} manuellement,
                conservé{preview.manual > 1 ? 's' : ''}.
              </p>
            )}
            {preview.invalid + preview.duplicate > 0 && (
              <p className="text-xs text-muted-foreground">
                Écartés : {preview.invalid} adresse(s) invalide(s) ou hors domaine, {preview.duplicate} doublon(s).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
