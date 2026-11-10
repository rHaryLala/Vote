import { useEffect, useState } from 'react'

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  }
}

/**
 * Compte à rebours calé sur l'horloge du serveur (clockOffset = serveur − appareil), pas sur celle du téléphone.
 * `dark` : pour la carte noire (chiffres blancs).
 */
export function Countdown({ target, clockOffset, dark = false }: { target: string; clockOffset: number; dark?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const { d, h, m, s } = parts(Date.parse(target) - (now + clockOffset))
  const cells: [number, string][] = [
    [d, 'jours'],
    [h, 'heures'],
    [m, 'min'],
    [s, 'sec'],
  ]
  return (
    <div className="grid grid-cols-4" role="timer" aria-live="off">
      {cells.map(([value, unit], i) => (
        <div
          key={unit}
          className={`px-2 py-2 text-center ${i > 0 ? (dark ? 'border-l border-white/15' : 'border-l border-line') : ''}`}
        >
          <div className={`font-display text-3xl tabular-nums ${dark ? 'text-white' : 'text-ink'}`}>
            {String(value).padStart(2, '0')}
          </div>
          <div className={`label mt-1 ${dark ? 'text-white/55' : 'text-dim'}`}>{unit}</div>
        </div>
      ))}
    </div>
  )
}
