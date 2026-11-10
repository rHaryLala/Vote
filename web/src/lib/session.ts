import { useSyncExternalStore } from 'react'
import type { VoterInfo } from './types'

export interface Session {
  token: string
  expiresAt: string | null
  voter: VoterInfo
}

const KEY = 'sa.session'
const listeners = new Set<() => void>()

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return null
    return session
  } catch {
    return null
  }
}

let current: Session | null = read()

export function getSession(): Session | null {
  return current
}

export function setSession(session: Session | null): void {
  current = session
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // Stockage indisponible (navigation privée) : la session vit seulement en mémoire.
  }
  listeners.forEach((l) => l())
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
