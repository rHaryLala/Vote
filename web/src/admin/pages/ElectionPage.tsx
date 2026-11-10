import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ImageUp,
  Loader2,
  Lock,
  Megaphone,
  Play,
  Save,
  Search,
  Square,
  Trash2,
  Upload,
  UserMinus,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AdminError, adminApi, type AdminElection, type Paginated } from '../api'
import { ConfirmButton } from '../components/ConfirmButton'
import { ManualVoter } from '../components/ManualVoter'
import { RegistrarSync } from '../components/RegistrarSync'
import { StatusBadge } from '../components/StatusBadge'
import { fmt, fromInput, toInput } from '../time'

/* ------------------------------------------------------------------ Formulaire */

interface FormState {
  title: string
  question: string
  candidate_name: string
  candidate_title: string
  candidate_bio: string
  candidate_program: string
  opens_at: string
  closes_at: string
  blank_counts_as_expressed: boolean
  quorum_percent: string
}

const EMPTY: FormState = {
  title: 'Élection du Président de la SA',
  question: 'Acceptez-vous ce candidat comme Président de la SA ?',
  candidate_name: '',
  candidate_title: '',
  candidate_bio: '',
  candidate_program: '',
  opens_at: '',
  closes_at: '',
  blank_counts_as_expressed: false,
  quorum_percent: '',
}

function toForm(e: AdminElection): FormState {
  return {
    title: e.title,
    question: e.question,
    candidate_name: e.candidate_name,
    candidate_title: e.candidate_title ?? '',
    candidate_bio: e.candidate_bio ?? '',
    candidate_program: e.candidate_program ?? '',
    opens_at: toInput(e.opens_at),
    closes_at: toInput(e.closes_at),
    blank_counts_as_expressed: e.blank_counts_as_expressed,
    quorum_percent: e.quorum_percent?.toString() ?? '',
  }
}

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string
  label: string
  help?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && !error && <p className="text-xs text-muted-foreground">{help}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ElectionForm({ election }: { election?: AdminElection }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (election ? toForm(election) : EMPTY))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const lockedContent = election?.locks.content ?? false
  const lockedDates = election?.locks.dates ?? false

  // Données rechargées (ex. après ouverture) : on resynchronise le formulaire.
  useEffect(() => {
    if (election) setForm(toForm(election))
  }, [election])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => {
      const dates = { opens_at: fromInput(form.opens_at), closes_at: fromInput(form.closes_at) }
      // Scrutin ouvert : seules les dates sont modifiables (le reste est figé côté serveur).
      const body = lockedContent
        ? dates
        : {
            ...dates,
            title: form.title,
            question: form.question,
            candidate_name: form.candidate_name,
            candidate_title: form.candidate_title || null,
            candidate_bio: form.candidate_bio || null,
            candidate_program: form.candidate_program || null,
            blank_counts_as_expressed: form.blank_counts_as_expressed,
            quorum_percent: form.quorum_percent ? Number(form.quorum_percent) : null,
          }
      return election
        ? adminApi<{ data: AdminElection }>(`/elections/${election.id}`, { method: 'PUT', body })
        : adminApi<{ data: AdminElection }>('/elections', { method: 'POST', body })
    },
    onSuccess: (res) => {
      setErrors({})
      void qc.invalidateQueries({ queryKey: ['admin'] })
      toast.success(election ? 'Modifications enregistrées' : 'Scrutin créé')
      if (!election) navigate(`/admin/scrutins/${res.data.id}`, { replace: true })
    },
    onError: (err) => {
      if (err instanceof AdminError) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
      }
      toast.error(err.message)
    },
  })

  const photoInput = useRef<HTMLInputElement>(null)
  const photo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('photo', file)
      return adminApi<{ data: AdminElection }>(`/elections/${election!.id}/photo`, { method: 'POST', form: fd })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      toast.success('Photo mise à jour')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
    >
      {lockedContent && (
        <Alert>
          <Lock />
          <AlertTitle>{lockedDates ? 'Scrutin clos : plus rien ne peut être modifié.' : 'Le vote est ouvert.'}</AlertTitle>
          <AlertDescription>
            {lockedDates
              ? 'Les dates, la question, le candidat et la règle sont figés pour garantir le résultat.'
              : "La question, le candidat et la règle d'acceptation sont figés pour l'équité du vote. Les dates restent modifiables (par exemple pour prolonger le vote) ; chaque changement est inscrit au journal d'audit."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Scrutin</CardTitle>
            <CardDescription>Ce que les étudiants voient en premier.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field id="title" label="Titre" error={errors.title}>
              <Input id="title" value={form.title} disabled={lockedContent} required onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field id="question" label="Question posée aux électeurs" error={errors.question}>
              <Textarea
                id="question"
                rows={2}
                value={form.question}
                disabled={lockedContent}
                required
                onChange={(e) => set('question', e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4" /> Calendrier
            </CardTitle>
            <CardDescription>Heure de Madagascar (UTC+3), quel que soit le fuseau de cet ordinateur.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="opens_at" label="Ouverture du vote" error={errors.opens_at}>
              <Input
                id="opens_at"
                type="datetime-local"
                value={form.opens_at}
                disabled={lockedDates}
                required
                onChange={(e) => set('opens_at', e.target.value)}
              />
            </Field>
            <Field id="closes_at" label="Clôture du vote" error={errors.closes_at}>
              <Input
                id="closes_at"
                type="datetime-local"
                value={form.closes_at}
                disabled={lockedDates}
                required
                onChange={(e) => set('closes_at', e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidat</CardTitle>
          <CardDescription>Présenté sur la page d'accueil et sur le bulletin.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[180px_1fr]">
          <div className="grid content-start gap-3">
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {election?.candidate_photo_url ? (
                <img src={election.candidate_photo_url} alt="Photo du candidat" className="size-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">Pas de photo</span>
              )}
            </div>
            {election && (
              <>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) photo.mutate(f)
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={lockedContent || photo.isPending}
                  onClick={() => photoInput.current?.click()}
                >
                  {photo.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />} Changer la photo
                </Button>
              </>
            )}
            {!election && <p className="text-xs text-muted-foreground">La photo s'ajoute après la création du scrutin.</p>}
          </div>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="candidate_name" label="Nom du candidat" error={errors.candidate_name}>
                <Input
                  id="candidate_name"
                  value={form.candidate_name}
                  disabled={lockedContent}
                  required
                  onChange={(e) => set('candidate_name', e.target.value)}
                />
              </Field>
              <Field id="candidate_title" label="Parcours en une ligne" error={errors.candidate_title}>
                <Input
                  id="candidate_title"
                  placeholder="Ex. Étudiant en 3e année de …"
                  value={form.candidate_title}
                  disabled={lockedContent}
                  onChange={(e) => set('candidate_title', e.target.value)}
                />
              </Field>
            </div>
            <Field id="candidate_bio" label="Présentation" error={errors.candidate_bio}>
              <Textarea
                id="candidate_bio"
                rows={4}
                value={form.candidate_bio}
                disabled={lockedContent}
                onChange={(e) => set('candidate_bio', e.target.value)}
              />
            </Field>
            <Field id="candidate_program" label="Engagements" help="Un engagement par ligne." error={errors.candidate_program}>
              <Textarea
                id="candidate_program"
                rows={4}
                value={form.candidate_program}
                disabled={lockedContent}
                onChange={(e) => set('candidate_program', e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Règle d'acceptation</CardTitle>
          <CardDescription>
            Le candidat est accepté si les Oui dépassent 50 % des suffrages exprimés, et si le quorum éventuel est atteint.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="flex items-start gap-3">
            <Switch
              id="blank"
              checked={form.blank_counts_as_expressed}
              disabled={lockedContent}
              onCheckedChange={(v) => set('blank_counts_as_expressed', v)}
            />
            <div className="grid gap-1">
              <Label htmlFor="blank">Les votes blancs comptent comme suffrages exprimés</Label>
              <p className="text-xs text-muted-foreground">
                Désactivé (recommandé) : seuls les Oui et les Non comptent. Activé : un vote blanc pèse comme un Non.
              </p>
            </div>
          </div>
          <Field id="quorum" label="Quorum de participation (%)" help="Vide : pas de participation minimale." error={errors.quorum_percent}>
            <Input
              id="quorum"
              type="number"
              min={1}
              max={100}
              value={form.quorum_percent}
              disabled={lockedContent}
              onChange={(e) => set('quorum_percent', e.target.value)}
            />
          </Field>
        </CardContent>
        {!lockedDates && (
          <CardFooter className="justify-end border-t">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {election ? 'Enregistrer' : 'Créer le scrutin'}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}

/* ------------------------------------------------------------------ Statistiques */

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardDescription>{label}</CardDescription>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function Stats({ e }: { e: AdminElection }) {
  const t = e.tally
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={<Users className="size-4" />} label="Inscrits" value={e.stats.registered.toLocaleString('fr-FR')} hint="Sur la liste électorale" />
      <Stat icon={<Users className="size-4" />} label="Ont voté" value={e.stats.voted.toLocaleString('fr-FR')} hint={`${e.stats.turnout_percent} % de participation`} />
      <Stat icon={<CalendarClock className="size-4" />} label="Clôture" value={<span className="text-base">{fmt(e.closes_at)}</span>} hint="Heure de Madagascar" />
      <Stat
        icon={<BarChart3 className="size-4" />}
        label="Résultats"
        value={t ? `${t.yes} / ${t.no} / ${t.blank}` : 'Masqués'}
        hint={t ? (t.accepted ? 'Oui / Non / Blanc · candidat accepté' : 'Oui / Non / Blanc · candidat non accepté') : 'Visibles à la clôture du scrutin'}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ Liste électorale */

interface VoterRow {
  id: number
  email: string
  name: string | null
  student_id: string | null
  source: 'csv' | 'registrar' | 'manual'
  has_voted: boolean
  removable: boolean
}

const SOURCE_LABEL: Record<VoterRow['source'], string> = { csv: 'CSV', registrar: 'Registrar', manual: 'Manuel' }

function VotersTab({ e }: { e: AdminElection }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [voted, setVoted] = useState<'' | 'yes' | 'no'>('')
  const [page, setPage] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)

  const params = new URLSearchParams({ page: String(page), ...(search ? { search } : {}), ...(voted ? { voted } : {}) })
  const list = useQuery({
    queryKey: ['admin', 'voters', e.id, page, search, voted],
    queryFn: () => adminApi<Paginated<VoterRow>>(`/elections/${e.id}/voters?${params}`),
    placeholderData: (prev) => prev,
  })

  const importer = useMutation({
    mutationFn: (dryRun: boolean) => {
      const fd = new FormData()
      fd.append('file', file!)
      fd.append('dry_run', dryRun ? '1' : '0')
      return adminApi<{ data: { valid: number; invalid: number; duplicate: number; dry_run: boolean } }>(`/elections/${e.id}/voters/import`, {
        method: 'POST',
        form: fd,
      })
    },
    onSuccess: ({ data }) => {
      const msg = `${data.valid} électeurs valides · ${data.invalid} lignes ignorées · ${data.duplicate} doublons`
      if (data.dry_run) {
        toast.info('Simulation (rien n’a été enregistré)', { description: msg })
      } else {
        toast.success('Liste électorale importée', { description: msg })
        setFile(null)
        if (fileRef.current) fileRef.current.value = ''
        void qc.invalidateQueries({ queryKey: ['admin'] })
      }
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {!e.locks.voters ? (
        <>
        <RegistrarSync e={e} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="size-4" /> Ou importer un fichier CSV
            </CardTitle>
            <CardDescription>
              CSV avec la colonne <code>email</code> et, facultativement, <code>student_id</code> et <code>name</code> (séparateur « , » ou « ; »).
              Un nouvel import remplace la liste actuelle, sauf les électeurs ajoutés manuellement. Le fichier n'est pas conservé sur le serveur.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="max-w-sm"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
            />
            <Button variant="outline" disabled={!file || importer.isPending} onClick={() => importer.mutate(true)}>
              Simuler
            </Button>
            <Button disabled={!file || importer.isPending} onClick={() => importer.mutate(false)}>
              {importer.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Importer
            </Button>
          </CardContent>
        </Card>
        </>
      ) : (
        <Alert>
          <Lock />
          <AlertTitle>Liste électorale figée</AlertTitle>
          <AlertDescription>
            {e.locks.voters_manual
              ? "L'import et la synchronisation sont verrouillés depuis l'ouverture du scrutin. Vous pouvez encore ajouter un électeur manuellement : chaque ajout est inscrit au journal d'audit."
              : 'Le scrutin est clos : la liste électorale ne peut plus changer.'}
          </AlertDescription>
        </Alert>
      )}

      {e.locks.voters_manual && <ManualVoter e={e} />}

      <Card>
        <CardHeader>
          <CardTitle>Électeurs ({list.data?.meta.total ?? '…'})</CardTitle>
          <CardDescription>
            Indique si un étudiant a voté (utile pour le dépanner), jamais pour quoi : les bulletins ne sont liés à personne.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Adresse, nom ou matricule"
                className="pl-8"
                value={search}
                onChange={(ev) => {
                  setSearch(ev.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="flex gap-1">
              {(
                [
                  ['', 'Tous'],
                  ['yes', 'A voté'],
                  ['no', "N'a pas voté"],
                ] as const
              ).map(([v, l]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={voted === v ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setVoted(v)
                    setPage(1)
                  }}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Électeur</TableHead>
                <TableHead className="hidden sm:table-cell">Matricule</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead className="text-right">A voté</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium">{v.name ?? v.email}</div>
                    {v.name && <div className="text-xs text-muted-foreground">{v.email}</div>}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{v.student_id ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={v.source === 'manual' ? 'default' : 'outline'}>{SOURCE_LABEL[v.source]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {v.has_voted ? <Badge className="bg-success text-white">Oui</Badge> : <Badge variant="outline">Non</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {v.removable && (
                      <ConfirmButton
                        variant="ghost"
                        size="icon-sm"
                        ariaLabel={`Retirer ${v.name ?? v.email}`}
                        title="Retirer cet électeur ?"
                        description={
                          `${v.name ?? v.email} sera retiré de la liste électorale` +
                          (e.status === 'open' ? " (ajout manuel qui n'a pas encore voté). Le retrait est inscrit au journal d'audit." : '.')
                        }
                        confirmLabel="Retirer"
                        onConfirm={async () => {
                          try {
                            await adminApi(`/elections/${e.id}/voters/${v.id}`, { method: 'DELETE' })
                            toast.success('Électeur retiré')
                            await qc.invalidateQueries({ queryKey: ['admin'] })
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Retrait impossible')
                          }
                        }}
                      >
                        <UserMinus />
                      </ConfirmButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {list.data && list.data.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Aucun électeur.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {list.data && list.data.meta.last_page > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {list.data.meta.page} / {list.data.meta.last_page}
              </span>
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Page précédente">
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= list.data.meta.last_page}
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

/* ------------------------------------------------------------------ Résultats */

function ResultsTab({ e }: { e: AdminElection }) {
  const t = e.tally!
  const pct = (n: number) => (t.cast > 0 ? ((n / t.cast) * 100).toFixed(1) : '0.0')
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Dépouillement</CardTitle>
          <CardDescription>
            {e.results_published ? 'Résultats publiés : visibles par tous les étudiants.' : 'Pas encore publiés : visibles par la commission seulement.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Choix</TableHead>
                <TableHead className="text-right">Voix</TableHead>
                <TableHead className="text-right">Part des votants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                [
                  ['Oui', t.yes],
                  ['Non', t.no],
                  ['Blanc', t.blank],
                ] as const
              ).map(([l, n]) => (
                <TableRow key={l}>
                  <TableCell className="font-medium">{l}</TableCell>
                  <TableCell className="text-right tabular-nums">{n}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(n)} %</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">Suffrages exprimés</TableCell>
                <TableCell className="text-right tabular-nums">{t.expressed}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className={t.accepted ? 'border-success' : 'border-destructive'}>
        <CardHeader>
          <CardDescription>Décision</CardDescription>
          <CardTitle className="text-2xl">{t.accepted ? 'Candidat accepté' : 'Candidat non accepté'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm text-muted-foreground">
          <p>Majorité : {t.majority_reached ? 'atteinte' : 'non atteinte'}</p>
          <p>Quorum : {t.quorum_percent === null ? 'aucun' : `${t.quorum_percent} % — ${t.quorum_reached ? 'atteint' : 'non atteint'}`}</p>
          <p>
            Participation : {t.cast} / {t.registered} ({t.turnout_percent} %)
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ Explication du bouton « Ouvrir le scrutin » */

/** Ce que fait vraiment « Ouvrir le scrutin » : il ARME le scrutin ; ce n'est pas l'instant où le vote commence. */
function OpenExplanation({ e }: { e: AdminElection }) {
  const later = Date.parse(e.opens_at) > Date.now()
  const Line = ({ children }: { children: ReactNode }) => <span className="mt-2 block">• {children}</span>
  return (
    <>
      <span className="block font-medium text-foreground">
        {later ? <>Le vote s'ouvrira automatiquement le {fmt(e.opens_at)} (heure de Madagascar).</> : "L'heure d'ouverture est déjà passée : le vote s'ouvre immédiatement."}
      </span>
      <Line>Il se fermera automatiquement le {fmt(e.closes_at)}.</Line>
      <Line>
        Dès maintenant, le scrutin devient <strong>visible des étudiants</strong> (page d'accueil, compte à rebours) et ils peuvent se connecter ;
        aucun bulletin n'est accepté avant l'heure d'ouverture.
      </Line>
      <Line>
        Sont figés : la question, le candidat, la règle d'acceptation, l'import et la synchronisation de la liste. Restent possibles : modifier les
        dates et ajouter un électeur à la main (journalisé).
      </Line>
      <Line>Aucun e-mail n'est envoyé aux étudiants.</Line>
    </>
  )
}

/* ------------------------------------------------------------------ Page */

export function ElectionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id

  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'election', id],
    queryFn: () => adminApi<{ data: AdminElection }>(`/elections/${id}`),
    enabled: !isNew,
    // Pendant le vote, la participation se met à jour toute seule.
    refetchInterval: (q) => (q.state.data?.data.status === 'open' ? 10_000 : false),
  })
  const e = data?.data

  const action = (path: string, success: string) => async () => {
    try {
      await adminApi(`/elections/${id}/${path}`, { method: 'POST' })
      toast.success(success)
      await qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action impossible')
    }
  }

  const remove = async () => {
    try {
      await adminApi(`/elections/${id}`, { method: 'DELETE' })
      toast.success('Scrutin supprimé')
      await qc.invalidateQueries({ queryKey: ['admin', 'elections'] })
      navigate('/admin')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible')
    }
  }

  if (!isNew && isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (!isNew && (error || !e)) return <p className="text-destructive">{error?.message ?? 'Scrutin introuvable.'}</p>

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link to="/admin">
            <ArrowLeft /> Scrutins
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{e ? e.title : 'Nouveau scrutin'}</h1>
            {e && <StatusBadge status={e.status} isOpen={e.is_open} published={e.results_published} />}
          </div>
          {e && (
            <div className="flex flex-wrap gap-2">
              {e.status === 'draft' && (
                <>
                  <ConfirmButton
                    variant="outline"
                    title="Supprimer ce scrutin ?"
                    description="Le brouillon et sa liste électorale seront supprimés définitivement."
                    confirmLabel="Supprimer"
                    onConfirm={remove}
                  >
                    <Trash2 /> Supprimer
                  </ConfirmButton>
                  <ConfirmButton
                    title="Ouvrir le scrutin ?"
                    description={<OpenExplanation e={e} />}
                    confirmLabel="Ouvrir le scrutin"
                    onConfirm={action('open', 'Scrutin ouvert')}
                  >
                    <Play /> Ouvrir le scrutin
                  </ConfirmButton>
                </>
              )}
              {e.status === 'open' && (
                <ConfirmButton
                  variant="destructive"
                  title="Clore le scrutin maintenant ?"
                  description="Plus aucun bulletin ne sera accepté. Cette action est définitive."
                  confirmLabel="Clore le scrutin"
                  onConfirm={action('close', 'Scrutin clos')}
                >
                  <Square /> Clore le scrutin
                </ConfirmButton>
              )}
              {e.status === 'closed' && !e.results_published && (
                <ConfirmButton
                  title="Publier les résultats ?"
                  description="Les résultats deviennent visibles par tous les étudiants. Cette action est irréversible."
                  confirmLabel="Publier"
                  onConfirm={action('publish', 'Résultats publiés')}
                >
                  <Megaphone /> Publier les résultats
                </ConfirmButton>
              )}
            </div>
          )}
        </div>
      </div>

      {e && <Stats e={e} />}

      {e ? (
        <Tabs defaultValue="infos">
          <TabsList>
            <TabsTrigger value="infos">Informations</TabsTrigger>
            <TabsTrigger value="voters">Liste électorale</TabsTrigger>
            {e.tally && <TabsTrigger value="results">Résultats</TabsTrigger>}
          </TabsList>
          <TabsContent value="infos" className="mt-4">
            <ElectionForm election={e} />
          </TabsContent>
          <TabsContent value="voters" className="mt-4">
            <VotersTab e={e} />
          </TabsContent>
          {e.tally && (
            <TabsContent value="results" className="mt-4">
              <ResultsTab e={e} />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <ElectionForm />
      )}
    </div>
  )
}
