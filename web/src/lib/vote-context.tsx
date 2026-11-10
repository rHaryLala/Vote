import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadPending, loadReceipt, queueVote, submitPending, type PendingVote, type StoredReceipt } from './outbox'
import { clearCache } from './query'
import { getSession, setSession, useSession } from './session'
import type { Choice } from './types'

type Phase = 'idle' | 'sending' | 'offline' | 'rejected'

interface VoteState {
  pending: PendingVote | null
  receipt: StoredReceipt | null
  phase: Phase
  rejection: string | null
  /** Vrai seulement juste après un vote enregistré dans cette session (déclenche l'animation de l'urne). */
  justVoted: boolean
  cast: (choice: Choice, electionId: number) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<VoteState | null>(null)

export function useVote(): VoteState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVote doit être utilisé dans <VoteProvider>')
  return ctx
}

export function VoteProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<PendingVote | null>(null)
  const [receipt, setReceipt] = useState<StoredReceipt | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [rejection, setRejection] = useState<string | null>(null)
  const [justVoted, setJustVoted] = useState(false)
  const flushing = useRef(false)

  const email = session?.voter.email ?? null

  const flush = useCallback(async () => {
    const current = getSession()
    if (!current || flushing.current) return
    flushing.current = true
    try {
      const result = await submitPending(current.voter.email, current.token)
      switch (result.status) {
        case 'recorded':
          setPending(null)
          if (result.receipt) setReceipt(result.receipt)
          setPhase('idle')
          setJustVoted(true)
          setSession({ ...current, voter: { ...current.voter, has_voted: true } })
          void queryClient.invalidateQueries({ queryKey: ['me'] })
          break
        case 'offline':
          setPhase('offline')
          break
        case 'unauthorized':
          // Jeton expiré : le bulletin reste en file, il partira après la reconnexion.
          setSession(null)
          break
        case 'rejected':
          setPending(null)
          setRejection(result.message)
          setPhase('rejected')
          break
        case 'none':
          break
      }
    } finally {
      flushing.current = false
    }
  }, [queryClient])

  // Chargement des données locales de l'électeur connecté, puis envoi d'un éventuel bulletin en attente.
  useEffect(() => {
    let cancelled = false
    setPending(null)
    setReceipt(null)
    setPhase('idle')
    setRejection(null)
    setJustVoted(false)
    if (!email) return
    void (async () => {
      const [p, r] = await Promise.all([loadPending(email), loadReceipt(email)])
      if (cancelled) return
      setPending(p ?? null)
      setReceipt(r ?? null)
      if (p) {
        setPhase('sending')
        void flush()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [email, flush])

  // Reprise automatique : retour du réseau, retour sur l'application, et relance périodique.
  useEffect(() => {
    if (!pending) return
    const retry = () => void flush()
    const onVisible = () => document.visibilityState === 'visible' && retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(retry, 20_000)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [pending, flush])

  const cast = useCallback(
    async (choice: Choice, electionId: number) => {
      if (!email) return
      setRejection(null)
      setPending(await queueVote(email, choice, electionId))
      setPhase('sending')
      await flush()
    },
    [email, flush],
  )

  const logout = useCallback(async () => {
    setSession(null)
    await clearCache()
  }, [])

  const value = useMemo<VoteState>(
    () => ({ pending, receipt, phase, rejection, justVoted, cast, logout }),
    [pending, receipt, phase, rejection, justVoted, cast, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
