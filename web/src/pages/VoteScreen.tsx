import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Countdown } from '../components/Countdown'
import { MobileActionBar, initials } from '../components/site'
import { useContent } from '../lib/content'
import { useSession } from '../lib/session'
import type { Choice, ElectionInfo } from '../lib/types'
import { useVote } from '../lib/vote-context'

const ICONS: Record<Choice, ReactNode> = {
  yes: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  no: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  blank: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6">
      <rect x="5" y="5" width="14" height="14" />
    </svg>
  ),
}

const CHOICES: Choice[] = ['yes', 'no', 'blank']

function ConfirmSheet({
  label,
  busy,
  onConfirm,
  onCancel,
}: {
  label: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useContent()
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" initial="hidden" animate="show" exit="hidden">
      <motion.div
        className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
        variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
        onClick={busy ? undefined : onCancel}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="pb-safe relative w-full max-w-lg border-t-4 border-brand bg-panel md:border md:border-t-4"
        variants={{ hidden: { y: '100%' }, show: { y: 0 } }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-3">
          <span className="marker" aria-hidden="true" />
          <span className="label text-dim">Confirmation</span>
        </div>
        <div className="p-6">
          <h2 id="confirm-title" className="font-display text-3xl uppercase leading-none">
            Voter <span className="bg-brand px-2 text-white">{label}</span> ?
          </h2>
          <p className="mt-4 whitespace-pre-line text-dim">{t.text('vote', 'confirm_text')}</p>
          <div className="mt-6 grid gap-3">
            <button ref={confirmRef} disabled={busy} onClick={onConfirm} className="btn w-full">
              {busy ? 'Envoi du bulletin…' : t.text('vote', 'confirm_button')}
            </button>
            <button disabled={busy} onClick={onCancel} className="btn-ghost w-full disabled:opacity-50">
              {t.text('vote', 'cancel_button')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function VoteScreen({ election, clockOffset }: { election: ElectionInfo; clockOffset: number }) {
  const t = useContent()
  const session = useSession()
  const { cast, phase, rejection } = useVote()
  const [selected, setSelected] = useState<Choice | null>(null)
  const [confirming, setConfirming] = useState(false)
  const busy = phase === 'sending'

  const options = CHOICES.map((key) => ({ key, label: t.text('vote', `${key}_label`), hint: t.text('vote', `${key}_hint`) }))
  const selectedLabel = options.find((o) => o.key === selected)?.label ?? ''

  async function confirm() {
    if (!selected) return
    await cast(selected, election.id)
    // Quand le bulletin est enregistré, l'écran bascule seul vers le reçu.
    setConfirming(false)
  }

  const continueButton = (
    <button disabled={!selected} onClick={() => setConfirming(true)} className="btn w-full">
      {t.text('vote', 'continue')}
    </button>
  )

  return (
    <section className="grid flex-1 md:grid-cols-[1fr_1.2fr]">
      {/* Colonne gauche : question, candidat, délai */}
      <div className="flex flex-col md:border-r md:border-line">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="border-b border-line p-4 md:p-8">
          <p className="label flex items-center gap-2 text-dim">
            <span className="marker" aria-hidden="true" />
            {session?.voter.name ? `Bonjour ${session.voter.name.split(' ')[0]}` : 'Référendum'}
          </p>
          <h1 className="mt-4 text-balance font-display text-2xl uppercase leading-tight md:text-4xl">{election.question}</h1>
        </motion.div>

        <div className="flex items-center gap-4 border-b border-line p-4 md:px-8">
          {election.candidate.photo ? (
            <img src={election.candidate.photo} alt="" className="h-16 w-16 object-cover" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-night font-display text-2xl text-brand-bright">
              {initials(election.candidate.name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="label text-dim">Candidat</p>
            <p className="font-display text-xl uppercase leading-tight">{election.candidate.name}</p>
            {election.candidate.title && <p className="label mt-1 text-brand-deep">{election.candidate.title}</p>}
          </div>
        </div>

        {election.candidate.bio && (
          <details className="border-b border-line p-4 md:px-8">
            <summary className="label cursor-pointer text-ink">Présentation du candidat</summary>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-dim">{election.candidate.bio}</p>
          </details>
        )}

        <div className="mt-auto hidden border-t border-line md:block">
          <p className="label px-8 pt-4 text-dim">Clôture dans</p>
          <div className="px-6 pb-2">
            <Countdown target={election.closes_at} clockOffset={clockOffset} />
          </div>
        </div>
      </div>

      {/* Colonne droite : les choix */}
      <div className="flex flex-col">
        <p className="label border-b border-line px-4 py-3 text-dim md:px-8">Votre choix</p>
        <div role="radiogroup" aria-label="Votre choix" className="flex flex-col">
          {options.map((o, i) => {
            const active = selected === o.key
            return (
              <motion.button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(o.key)}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                whileTap={{ scale: 0.99 }}
                className={`flex min-h-24 items-center gap-5 border-b border-line px-4 text-left transition-colors md:px-8 ${
                  active ? 'bg-brand text-white' : 'hover:bg-panel'
                }`}
              >
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center ${active ? 'bg-white text-brand' : 'border border-ink text-ink'}`}
                >
                  {ICONS[o.key]}
                </span>
                <span className="flex-1">
                  <span className="block font-display text-2xl uppercase leading-none">{o.label}</span>
                  <span className={`label mt-2 block ${active ? 'text-white/80' : 'text-dim'}`}>{o.hint}</span>
                </span>
                <span className="label hidden opacity-60 sm:block">0{i + 1}</span>
              </motion.button>
            )
          })}
        </div>

        {rejection && (
          <p role="alert" className="m-4 border border-danger/40 bg-danger/5 p-3 text-sm text-danger md:mx-8">
            {rejection}
          </p>
        )}

        <div className="hidden p-8 md:block">{continueButton}</div>

        <div className="border-t border-line md:hidden">
          <p className="label px-4 pt-4 text-dim">Clôture dans</p>
          <div className="px-2 pb-2">
            <Countdown target={election.closes_at} clockOffset={clockOffset} />
          </div>
        </div>
      </div>

      <MobileActionBar>{continueButton}</MobileActionBar>

      <AnimatePresence>
        {confirming && selected && (
          <ConfirmSheet
            label={selectedLabel}
            busy={busy}
            onConfirm={() => void confirm()}
            onCancel={() => setConfirming(false)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
