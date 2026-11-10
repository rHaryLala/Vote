import type { ElectionInfo } from './types'

/** setTimeout plafonne à ~24,8 jours : au-delà, on reprogrammera plus tard. */
const MAX_DELAY = 2 ** 31 - 1

/**
 * Délai (ms) avant le prochain changement d'état connu du scrutin — son ouverture, ou sa clôture —, mesuré sur
 * l'horloge du SERVEUR (`clockOffset` = serveur − appareil) et non sur celle du téléphone. `null` si tout est passé.
 */
export function msUntilNextBoundary(
  election: Pick<ElectionInfo, 'opens_at' | 'closes_at'>,
  now: number,
  clockOffset: number,
): number | null {
  const serverNow = now + clockOffset
  const next = [Date.parse(election.opens_at), Date.parse(election.closes_at)]
    .filter((t) => Number.isFinite(t) && t > serverNow)
    .sort((a, b) => a - b)[0]
  return next === undefined ? null : Math.min(next - serverNow, MAX_DELAY)
}
