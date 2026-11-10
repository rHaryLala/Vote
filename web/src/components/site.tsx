import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/** Bloc de page numéroté : barre d'étiquette (« ■ 02 / LE CANDIDAT ») puis contenu. */
export function Block({
  index,
  eyebrow,
  title,
  children,
  id,
}: {
  index?: string
  eyebrow: string
  title?: string
  children: ReactNode
  id?: string
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="border-b border-line"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 md:px-6">
        <span className="marker" aria-hidden="true" />
        <span className="label text-dim">
          {index && <span className="text-ink">{index} / </span>}
          {eyebrow}
        </span>
      </div>
      {title && <h2 className="px-4 pt-6 font-display text-3xl uppercase leading-none md:px-6 md:text-5xl">{title}</h2>}
      {children}
    </motion.section>
  )
}

/** Bandeau de très grand texte qui défile (repris de la référence). */
export function Marquee({ text }: { text: string }) {
  const run = `${text} · `.repeat(3)
  return (
    <div className="relative overflow-hidden border-b border-line py-4" aria-hidden="true">
      <span className="marker absolute left-3 top-3" />
      <span className="marker absolute right-3 top-3" />
      <div className="marquee flex w-max whitespace-nowrap">
        {[0, 1].map((k) => (
          <span key={k} className="pr-8 font-display text-[clamp(4.5rem,15vw,11rem)] font-bold uppercase leading-[0.9]">
            {run}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Pastille d'état : petit carré coloré + étiquette. */
export function StatusTag({ tone, children }: { tone: 'ok' | 'accent' | 'muted'; children: ReactNode }) {
  const dot = tone === 'ok' ? 'bg-ok' : tone === 'accent' ? 'bg-brand' : 'bg-dim'
  return (
    <span className="label inline-flex items-center gap-2 border border-line bg-panel px-3 py-1.5 text-ink">
      <span className={`h-2 w-2 ${dot}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Barre d'action fixe en bas de l'écran (mobile). */
export function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 px-4 pt-3 backdrop-blur md:hidden">
      {children}
    </div>
  )
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}
