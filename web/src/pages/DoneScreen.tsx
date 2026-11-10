import { motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SceneFrame, UrnScene } from '../components/SceneFrame'
import { StatusTag } from '../components/site'
import { useContent } from '../lib/content'
import { formatSecret } from '../lib/receipt'
import { useVote } from '../lib/vote-context'

export function DoneScreen() {
  const t = useContent()
  const { pending, receipt, justVoted, phase } = useVote()
  const [copied, setCopied] = useState(false)

  // Bulletin encore sur l'appareil : le serveur ne l'a pas encore reçu.
  const waiting = pending !== null
  const secret = receipt?.secret ?? pending?.secret ?? null
  const reveal = justVoted && !waiting ? 2.2 : 0

  async function copy() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(formatSecret(secret))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Presse-papiers indisponible : le code reste affiché, l'utilisateur peut le recopier.
    }
  }

  return (
    <section className="grid flex-1 md:grid-cols-2">
      <SceneFrame className="grid-paper h-72 border-b border-line md:h-auto md:border-b-0 md:border-r">
        <UrnScene phase={justVoted && !waiting ? 'drop' : 'done'} />
      </SceneFrame>

      <div className="flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reveal }}
          className="border-b border-line p-4 md:p-8"
          role="status"
        >
          {waiting ? (
            <>
              <StatusTag tone="accent">{phase === 'offline' ? 'En attente de réseau' : 'Envoi en cours'}</StatusTag>
              <h1 className="mt-5 font-display text-3xl uppercase leading-[0.95] md:text-4xl">{t.text('done', 'pending_title')}</h1>
              <p className="mt-4 whitespace-pre-line leading-relaxed text-dim">{t.text('done', 'pending_text')}</p>
            </>
          ) : (
            <>
              <StatusTag tone="ok">Vote enregistré</StatusTag>
              <h1 className="mt-5 font-display text-3xl uppercase leading-[0.95] md:text-4xl">{t.text('done', 'recorded_title')}</h1>
              <p className="mt-4 whitespace-pre-line leading-relaxed text-dim">{t.text('done', 'recorded_text')}</p>
            </>
          )}
        </motion.div>

        {secret ? (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reveal + 0.3 }}
            className="brackets m-4 bg-night p-6 text-white md:m-8"
          >
            <p className="label text-white/60">Votre code de reçu</p>
            {/* Retour à la ligne uniquement ENTRE les groupes de 4 : un groupe coupé se recopie mal. */}
            <p className="mt-3 font-mono text-lg tracking-wider text-brand-bright" aria-label="Code de reçu">
              {formatSecret(secret)
                .split('-')
                .map((group, i) => (
                  <span key={i} className="inline-block whitespace-nowrap">
                    {i > 0 && '-'}
                    {group}
                  </span>
                ))}
            </p>
            <button onClick={() => void copy()} className="btn mt-5 min-h-11">
              {copied ? 'Copié ✓' : 'Copier le code'}
            </button>
            <p className="mt-5 text-sm leading-relaxed text-white/70">
              {t.text('done', 'receipt_note')}{' '}
              <Link to="/verification" className="text-brand-bright underline underline-offset-4">
                Vérifier maintenant
              </Link>
            </p>
          </motion.div>
        ) : (
          !waiting && (
            <p className="cell m-4 p-4 text-sm text-dim md:m-8">
              Vous avez déjà voté depuis un autre appareil. Le code de reçu se trouve sur cet appareil-là.
            </p>
          )
        )}
      </div>
    </section>
  )
}
