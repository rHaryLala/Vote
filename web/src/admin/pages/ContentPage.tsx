import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { ContentField, ContentItem, ContentPage as Page } from '@/lib/content'
import { AdminError, adminApi } from '../api'

type Value = string | string[] | ContentItem[]
interface EditorPage extends Page {
  values: Record<string, Value>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Éditeur d'une liste de { titre, texte } (étapes, garanties, questions…). */
function ItemsEditor({ value, onChange }: { value: ContentItem[]; onChange: (v: ContentItem[]) => void }) {
  const update = (i: number, patch: Partial<ContentItem>) => onChange(value.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  return (
    <div className="grid gap-3">
      {value.map((item, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
            <Input value={item.title} placeholder="Titre" onChange={(e) => update(i, { title: e.target.value })} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Supprimer cet élément"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <Textarea rows={2} value={item.text} placeholder="Texte" onChange={(e) => update(i, { text: e.target.value })} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...value, { title: '', text: '' }])}>
        <Plus /> Ajouter un élément
      </Button>
    </div>
  )
}

function FieldEditor({
  field,
  value,
  onChange,
  error,
}: {
  field: ContentField
  value: Value
  onChange: (v: Value) => void
  error?: string
}) {
  const modified = !same(value, field.default)
  const id = `f-${field.key}`
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="flex items-center gap-2">
          {field.label}
          {modified && <Badge variant="secondary">Modifié</Badge>}
        </Label>
        {modified && (
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(field.default)}>
            <RotateCcw /> Texte par défaut
          </Button>
        )}
      </div>

      {field.type === 'text' && <Input id={id} value={value as string} onChange={(e) => onChange(e.target.value)} />}
      {field.type === 'textarea' && <Textarea id={id} rows={3} value={value as string} onChange={(e) => onChange(e.target.value)} />}
      {field.type === 'lines' && (
        <Textarea id={id} rows={4} value={(value as string[]).join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />
      )}
      {field.type === 'items' && <ItemsEditor value={value as ContentItem[]} onChange={onChange} />}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        (field.help || field.type === 'lines') && (
          <p className="text-xs text-muted-foreground">{field.help ?? 'Une entrée par ligne.'}</p>
        )
      )}
    </div>
  )
}

function PageEditor({ page }: { page: EditorPage }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, Value>>(page.values)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => setDraft(page.values), [page.values])

  const dirty = !same(draft, page.values)

  const save = useMutation({
    mutationFn: () => {
      // On n'envoie que les champs changés ; un champ remis au texte par défaut est effacé côté serveur.
      const body = Object.fromEntries(
        page.fields
          .filter((f) => !same(draft[f.key], page.values[f.key]))
          .map((f) => [f.key, same(draft[f.key], f.default) ? null : draft[f.key]]),
      )
      return adminApi<{ values: Record<string, Value> }>(`/content/${page.key}`, { method: 'PUT', body })
    },
    onSuccess: () => {
      setErrors({})
      toast.success(`« ${page.label} » enregistré`, { description: 'Le site public affiche déjà les nouveaux textes.' })
      void qc.invalidateQueries({ queryKey: ['admin', 'content'] })
      void qc.invalidateQueries({ queryKey: ['content'] })
    },
    onError: (err) => {
      if (err instanceof AdminError) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
      toast.error(err.message)
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{page.label}</CardTitle>
        {page.description && <CardDescription>{page.description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {page.fields.map((f) => (
          <FieldEditor
            key={f.key}
            field={f}
            value={draft[f.key]}
            error={errors[f.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
          />
        ))}
      </CardContent>
      <CardFooter className="sticky bottom-0 justify-end gap-2 border-t bg-card/95 backdrop-blur">
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(page.values)}>
            Annuler les changements
          </Button>
        )}
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
        </Button>
      </CardFooter>
    </Card>
  )
}

export function ContentPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'content'],
    queryFn: () => adminApi<{ pages: EditorPage[] }>('/content'),
  })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contenu des pages</h1>
        <p className="text-sm text-muted-foreground">
          Tous les textes du site, page par page. Un champ remis à son texte par défaut suit les mises à jour du site.
        </p>
      </div>
      {isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <p className="text-destructive">{error.message}</p>
      ) : (
        <Tabs defaultValue={data.pages[1]?.key ?? data.pages[0].key}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              {data.pages.map((p) => (
                <TabsTrigger key={p.key} value={p.key}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {data.pages.map((p) => (
            <TabsContent key={p.key} value={p.key} className="mt-4">
              <PageEditor page={p} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}
