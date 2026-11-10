import { animate, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ResultsScene, SceneFrame } from '../components/SceneFrame'
import { Block } from '../components/site'
import { useContent } from '../lib/content'
import { useResults } from '../lib/queries'

function Counter({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const controls = animate(0, value, { duration: 1.4, ease: 'easeOut', onUpdate: setShown })
    return () => controls.stop()
  }, [value])
  return (
    <span className="tabular-nums">
      {shown.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  )
}

export function ResultsView() {
  const t = useContent()
  const { data, isPending, isError } = useResults(true)

  if (isPending) return <p className="label p-8 text-center text-dim">Chargement des résultats…</p>
  if (isError || !data) {
    return (
      <section className="p-6 md:p-10">
        <h1 className="font-display text-3xl uppercase">{t.text('results', 'unavailable_title')}</h1>
        <p className="mt-3 whitespace-pre-line text-dim">{t.text('results', 'unavailable_text')}</p>
      </section>
    )
  }

  const r = data.results
  const share = (n: number) => (r.cast > 0 ? n / r.cast : 0)
  const rows = [
    { label: 'Oui', value: r.yes, color: 'bg-brand' },
    { label: 'Non', value: r.no, color: 'bg-ink' },
    { label: 'Blancs', value: r.blank, color: 'bg-line' },
  ]

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 md:px-6">
        <span className="marker" aria-hidden="true" />
        <span className="label text-dim">{t.text('results', 'eyebrow')} · {data.election.title}</span>
      </div>

      <section className="grid border-b border-line md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className={`flex flex-col justify-center p-6 md:border-r md:border-line md:p-10 ${r.accepted ? 'bg-brand text-white' : 'brackets bg-night text-white'}`}
        >
          <p className={`label ${r.accepted ? 'text-white/70' : 'text-white/60'}`}>{t.text('results', 'verdict_label')}</p>
          <p className="mt-3 font-display text-3xl uppercase leading-[0.95] md:text-5xl">
            {data.election.candidate.name}
            <br />
            {t.text('results', (r.accepted ? 'accepted' : 'rejected') + (data.election.candidate.gender === 'f' ? '_f' : ''))}
          </p>
          {!r.quorum_reached && r.quorum_percent !== null && (
            <p className="mt-3 text-sm opacity-80">Le quorum de participation ({r.quorum_percent} %) n'est pas atteint.</p>
          )}
        </motion.div>

        <SceneFrame className="grid-paper h-64 border-t border-line md:h-auto md:border-t-0" fallback={<div className="h-2" />}>
          <ResultsScene yes={share(r.yes)} no={share(r.no)} blank={share(r.blank)} />
        </SceneFrame>
      </section>

      <Block eyebrow="Détail du dépouillement">
        <ul>
          {rows.map((r, i) => (
            <li key={r.label} className="border-b border-line p-4 last:border-b-0 md:px-6">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-display text-2xl uppercase">{r.label}</span>
                <span className="font-display text-2xl">
                  <Counter value={r.value} />
                  <span className="label ml-3 text-dim">
                    <Counter value={share(r.value) * 100} decimals={1} suffix=" %" />
                  </span>
                </span>
              </div>
              <div className="mt-3 h-3 bg-panel ring-1 ring-line">
                <motion.div
                  className={`h-full ${r.color}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${share(r.value) * 100}%` }}
                  transition={{ duration: 1.1, delay: 0.3 + i * 0.12, ease: 'easeOut' }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Block>

      <section className="grid grid-cols-3 border-b border-line">
        {[
          ['Votants', r.cast.toLocaleString('fr-FR')],
          ['Inscrits', r.registered.toLocaleString('fr-FR')],
          ['Participation', `${r.turnout_percent.toLocaleString('fr-FR')} %`],
        ].map(([k, v], i) => (
          <div key={k} className={`p-4 md:p-6 ${i > 0 ? 'border-l border-line' : ''}`}>
            <p className="label text-dim">{k}</p>
            <p className="mt-1 font-display text-xl md:text-3xl">{v}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
