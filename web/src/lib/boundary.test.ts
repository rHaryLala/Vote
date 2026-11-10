import { describe, expect, it } from 'vitest'
import { msUntilNextBoundary } from './boundary'

const election = { opens_at: '2030-06-01T05:00:00Z', closes_at: '2030-06-01T15:00:00Z' }
const at = (iso: string) => Date.parse(iso)

describe('prochain changement d’état du scrutin', () => {
  it('avant l’ouverture : le délai jusqu’à l’ouverture', () => {
    expect(msUntilNextBoundary(election, at('2030-06-01T04:00:00Z'), 0)).toBe(3_600_000)
  })

  it('pendant le vote : le délai jusqu’à la clôture', () => {
    expect(msUntilNextBoundary(election, at('2030-06-01T14:30:00Z'), 0)).toBe(1_800_000)
  })

  it('après la clôture : plus rien à attendre', () => {
    expect(msUntilNextBoundary(election, at('2030-06-01T16:00:00Z'), 0)).toBeNull()
  })

  it('se règle sur l’horloge du serveur, pas sur celle du téléphone', () => {
    // Le téléphone retarde de 2 minutes (serveur − appareil = +120 s) : l'ouverture arrive 2 minutes plus tôt pour lui.
    expect(msUntilNextBoundary(election, at('2030-06-01T04:00:00Z'), 120_000)).toBe(3_600_000 - 120_000)
    // Le téléphone avance de 2 minutes : il doit attendre 2 minutes de plus.
    expect(msUntilNextBoundary(election, at('2030-06-01T04:00:00Z'), -120_000)).toBe(3_600_000 + 120_000)
  })

  it('plafonne le délai pour setTimeout (~24,8 jours)', () => {
    expect(msUntilNextBoundary(election, at('2029-01-01T00:00:00Z'), 0)).toBe(2 ** 31 - 1)
  })

  it('ignore une date illisible', () => {
    expect(msUntilNextBoundary({ opens_at: 'n’importe quoi', closes_at: election.closes_at }, at('2030-06-01T14:00:00Z'), 0)).toBe(3_600_000)
  })
})
