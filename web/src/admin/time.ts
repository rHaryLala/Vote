/*
 * Les heures du scrutin sont saisies et affichées en heure de Madagascar (UTC+3, sans heure d'été), quel que soit
 * le fuseau de l'ordinateur de la commission. L'API reçoit une date ISO avec « +03:00 » et la stocke en UTC.
 */
const OFFSET_MS = 3 * 60 * 60 * 1000
export const TIMEZONE = 'Indian/Antananarivo'

/** ISO (UTC) -> valeur d'un champ <input type="datetime-local"> en heure de Madagascar (« 2026-11-12T08:00 »). */
export function toInput(iso: string): string {
  return new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 16)
}

/** Valeur du champ (heure de Madagascar) -> ISO avec fuseau, pour l'API. */
export function fromInput(value: string): string {
  return `${value}:00+03:00`
}

export function fmt(iso: string, withSeconds = false): string {
  return new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: withSeconds ? 'medium' : 'short',
    timeZone: TIMEZONE,
  })
}
