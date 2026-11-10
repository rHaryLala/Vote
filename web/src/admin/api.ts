import { useSyncExternalStore } from 'react'
import type { Tally } from '@/lib/types'

/* ------------------------------------------------------------------ Session de la commission
 * Gardée dans sessionStorage (et non localStorage) : elle disparaît à la fermeture de l'onglet, ce qui limite
 * le risque sur un ordinateur partagé. Le jeton expire de toute façon côté serveur au bout de 8 heures. */

export interface AdminUser {
  id: number
  name: string
  email: string
}
export interface AdminSession {
  token: string
  expiresAt: string | null
  user: AdminUser
}

const KEY = 'sa.admin'
const listeners = new Set<() => void>()

function read(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AdminSession
    return s.expiresAt && Date.parse(s.expiresAt) < Date.now() ? null : s
  } catch {
    return null
  }
}

let current = read()

export function setAdminSession(s: AdminSession | null): void {
  current = s
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s))
    else sessionStorage.removeItem(KEY)
  } catch {
    // Stockage indisponible : la session vit en mémoire seulement.
  }
  listeners.forEach((l) => l())
}

export function useAdminSession(): AdminSession | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/* ------------------------------------------------------------------ Appels à l'API d'administration */

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors: Record<string, string[]> = {},
  ) {
    super(message)
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  form?: FormData
}

export async function adminApi<T>(path: string, { method = 'GET', body, form }: Options = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(current ? { Authorization: `Bearer ${current.token}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new AdminError(0, 'Réseau indisponible. Vérifiez la connexion.')
  }

  if (res.status === 401 && path !== '/login') {
    setAdminSession(null)
    throw new AdminError(401, 'Session expirée : reconnectez-vous.')
  }
  const data = (await res.json().catch(() => null)) as { message?: string; errors?: Record<string, string[]> } | null
  if (!res.ok) {
    throw new AdminError(res.status, data?.message ?? 'Une erreur est survenue.', data?.errors ?? {})
  }
  return data as T
}

/* ------------------------------------------------------------------ Types */

export type Status = 'draft' | 'open' | 'closed'

export interface AdminElection {
  id: number
  title: string
  question: string
  candidate_name: string
  candidate_title: string | null
  candidate_bio: string | null
  candidate_program: string | null
  candidate_photo_url: string | null
  opens_at: string
  closes_at: string
  status: Status
  is_open: boolean
  blank_counts_as_expressed: boolean
  quorum_percent: number | null
  results_published: boolean
  public_visible: boolean
  registrar: { auto_sync: boolean; session_id: number | null; synced_at: string | null; error: string | null }
  stats: { registered: number; voted: number; turnout_percent: number }
  tally: Tally | null
  locks: { content: boolean; dates: boolean; voters: boolean; voters_manual: boolean }
}

export interface ElectionRow {
  id: number
  title: string
  candidate_name: string
  status: Status
  is_open: boolean
  opens_at: string
  closes_at: string
  results_published: boolean
  public_visible: boolean
  voters_count: number
  voted_count: number
}

export interface Paginated<T> {
  data: T[]
  meta: { page: number; last_page: number; total: number }
}

export const STATUS_LABEL: Record<Status, string> = { draft: 'Brouillon', open: 'Ouvert', closed: 'Clos' }
