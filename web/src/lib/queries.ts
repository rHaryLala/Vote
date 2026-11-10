import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './api'
import { msUntilNextBoundary } from './boundary'
import type { ElectionInfo, Tally, VoterInfo } from './types'

interface ElectionPayload {
  election: ElectionInfo | null
  server_time: string
}

/** Scrutin courant (public). L'écart avec l'horloge du serveur sert à afficher des comptes à rebours justes. */
export function useElection() {
  const query = useQuery({
    queryKey: ['election'],
    queryFn: () => api<ElectionPayload>('/election'),
    refetchInterval: 30_000,
  })
  const offset = query.data ? Date.parse(query.data.server_time) - query.dataUpdatedAt : 0
  const election = query.data?.election ?? null
  const { refetch } = query

  // L'ouverture et la clôture arrivent à l'heure prévue, sans action de personne : on interroge le serveur à cet instant
  // précis (puis une seconde fois, au cas où l'horloge du serveur aurait une demi-seconde de retard), plutôt que
  // d'attendre le contrôle périodique de 30 secondes.
  useEffect(() => {
    if (!election) return
    const delay = msUntilNextBoundary(election, Date.now(), offset)
    if (delay === null) return
    const timers = [window.setTimeout(() => void refetch(), delay + 300), window.setTimeout(() => void refetch(), delay + 2500)]
    return () => timers.forEach(window.clearTimeout)
  }, [election?.opens_at, election?.closes_at, offset, refetch]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...query, election, clockOffset: offset }
}

export function useResults(enabled: boolean) {
  return useQuery({
    queryKey: ['results'],
    queryFn: () => api<{ election: ElectionInfo; results: Tally }>('/results'),
    enabled,
    retry: false,
  })
}

export function useMe(token: string | null) {
  return useQuery({
    queryKey: ['me', token],
    queryFn: () => api<{ voter: VoterInfo; election: ElectionInfo }>('/me', { token }),
    enabled: !!token,
    retry: false,
  })
}
