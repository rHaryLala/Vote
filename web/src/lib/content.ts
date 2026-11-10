import schema from '@content'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface ContentItem {
  title: string
  text: string
}
export type FieldType = 'text' | 'textarea' | 'lines' | 'items'
export interface ContentField {
  key: string
  label: string
  type: FieldType
  default: string | string[] | ContentItem[]
  help?: string
}
export interface ContentPage {
  key: string
  label: string
  description?: string
  fields: ContentField[]
}

type Values = Record<string, Record<string, unknown>>

/** Textes par défaut, tirés du MÊME fichier que l'API (api/resources/content/pages.json). */
export const CONTENT_SCHEMA: ContentPage[] = (schema as { pages: ContentPage[] }).pages

const DEFAULTS: Values = Object.fromEntries(
  CONTENT_SCHEMA.map((p) => [p.key, Object.fromEntries(p.fields.map((f) => [f.key, f.default]))]),
)

/**
 * Textes du site : affichés tout de suite avec les valeurs par défaut (même hors ligne), puis remplacés par
 * ceux de la commission dès que l'API répond (cache persistant : ils restent disponibles hors ligne ensuite).
 */
export function useContent() {
  const { data } = useQuery({
    queryKey: ['content'],
    queryFn: () => api<{ pages: Values }>('/content'),
    staleTime: 60_000,
  })
  const pick = (page: string, key: string): unknown => data?.pages?.[page]?.[key] ?? DEFAULTS[page]?.[key]

  return {
    text: (page: string, key: string): string => {
      const v = pick(page, key)
      return typeof v === 'string' ? v : ''
    },
    lines: (page: string, key: string): string[] => {
      const v = pick(page, key)
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    },
    items: (page: string, key: string): ContentItem[] => {
      const v = pick(page, key)
      return Array.isArray(v) ? (v as ContentItem[]) : []
    },
  }
}
