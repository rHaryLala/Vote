import { describe, expect, it } from 'vitest'
import { fromInput, toInput } from './time'

describe('heures de Madagascar (UTC+3)', () => {
  it("convertit l'UTC de l'API en heure locale pour le champ de saisie", () => {
    expect(toInput('2030-06-01T05:00:00Z')).toBe('2030-06-01T08:00')
    // passage de minuit : 22:30 UTC = 01:30 le lendemain à Madagascar
    expect(toInput('2030-06-01T22:30:00Z')).toBe('2030-06-02T01:30')
  })

  it('envoie la saisie avec le fuseau explicite', () => {
    expect(fromInput('2030-06-01T08:00')).toBe('2030-06-01T08:00:00+03:00')
    expect(Date.parse(fromInput('2030-06-01T08:00'))).toBe(Date.parse('2030-06-01T05:00:00Z'))
  })

  it('aller-retour sans dérive', () => {
    const iso = '2031-01-15T13:45:00Z'
    expect(Date.parse(fromInput(toInput(iso)))).toBe(Date.parse(iso))
  })
})
