import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Countdown } from '../components/Countdown'
import { SaLogo } from '../components/SaLogo'
import { HeroScene, SceneFrame } from '../components/SceneFrame'
import { Block, Marquee, MobileActionBar, StatusTag, initials } from '../components/site'
import { useContent } from '../lib/content'
import { useElection } from '../lib/queries'
import { useSession } from '../lib/session'
import type { ElectionInfo } from '../lib/types'

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Indian/Antananarivo' })

/** Grille de cases séparées par des filets d'un pixel, quel que soit le nombre de cases. */
const GRID = 'grid gap-px border-y border-line bg-line'

function Candidate({ election }: { election: ElectionInfo }) {
  const t = useContent()
  const c = election.candidate
  return (
    <Block index="02" eyebrow={t.text('home', 'candidate_eyebrow')} id="candidat">
      <div className="grid md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="bg-night md:border-r md:border-line">
          {c.photo ? (
            <img src={c.photo} alt={`Photo de ${c.name}`} className="aspect-square w-full object-cover" />
          ) : (
            <div className="brackets flex aspect-square w-full items-center justify-center text-white">
              <span className="font-display text-8xl text-brand-bright">{initials(c.name)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="border-b border-line p-4 md:p-6">
            <p className="label text-dim">{t.text('home', 'candidate_badge')}</p>
            <h2 className="mt-2 font-display text-3xl uppercase leading-none md:text-5xl">{c.name}</h2>
            {c.title && <p className="label mt-3 text-brand-deep">{c.title}</p>}
          </div>

          {c.bio && <p className="whitespace-pre-line border-b border-line p-4 leading-relaxed md:p-6">{c.bio}</p>}

          {c.program.length > 0 && (
            <div>
              <p className="label border-b border-line px-4 py-3 text-dim md:px-6">{t.text('home', 'candidate_program_title')}</p>
              <ol>
                {c.program.map((p, i) => (
                  <li key={`${i}-${p}`} className="flex gap-4 border-b border-line px-4 py-3 last:border-b-0 md:px-6">
                    <span className="label pt-0.5 text-brand-deep">{String(i + 1).padStart(2, '0')}</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!c.bio && c.program.length === 0 && <p className="p-4 text-dim md:p-6">{t.text('home', 'candidate_empty')}</p>}
        </div>
      </div>
    </Block>
  )
}

export function HomePage() {
  const t = useContent()
  const { election, clockOffset } = useElection()
  const session = useSession()

  const year = election ? new Date(election.opens_at).getFullYear() : new Date().getFullYear()
  const upcoming = election ? election.status === 'draft' || Date.parse(election.opens_at) > Date.now() + clockOffset : false

  const status: { label: string; tone: 'ok' | 'accent' | 'muted' } | null = !election
    ? null
    : election.results_published
      ? { label: 'Résultats publiés', tone: 'accent' }
      : election.status === 'closed'
        ? { label: 'Vote clos', tone: 'muted' }
        : election.is_open
          ? { label: 'Vote ouvert', tone: 'ok' }
          : { label: 'Bientôt ouvert', tone: 'accent' }

  const cta = !election
    ? null
    : election.results_published
      ? 'Voir les résultats'
      : election.is_open
        ? session
          ? 'Voter maintenant'
          : 'Je vote'
        : election.status === 'closed'
          ? 'Voir le scrutin'
          : election.status === 'draft'
            ? 'Voir le candidat'
            : 'Accéder au vote'

  const facts = t.items('home', 'facts')
  const steps = t.items('home', 'steps')
  const guarantees = t.items('home', 'guarantees')

  return (
    <div>
      <Marquee text={t.text('home', 'marquee').replace('{année}', String(year))} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-3 md:px-6">
        {t.lines('home', 'tags').map((tag) => (
          <span key={tag} className="label flex items-center gap-2 text-dim">
            <span className="marker" aria-hidden="true" />
            {tag}
          </span>
        ))}
      </div>

      {/* --- Héros : texte | objet 3D | carte noire */}
      <section className="grid border-b border-line md:grid-cols-[1fr_1.35fr_1fr]">
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col justify-between gap-6 p-4 md:border-r md:border-line md:p-6"
        >
          <div>
            <p className="label text-dim">{t.text('home', 'hero_eyebrow')}</p>
            <h1 className="mt-3 whitespace-pre-line font-display text-4xl uppercase leading-[0.95] md:text-5xl">
              {t.text('home', 'hero_title')}
            </h1>
            <p className="mt-4 max-w-sm font-mono text-[15px] leading-relaxed">
              {election ? election.question : t.text('status', 'none_text')}
            </p>
          </div>
          {cta && (
            <div className="hidden flex-wrap gap-3 md:flex">
              <Link to="/voter" className="btn">
                {cta}
              </Link>
              <a href="#candidat" className="btn-ghost">
                {t.text('home', 'hero_cta_secondary')}
              </a>
            </div>
          )}
        </motion.div>

        <SceneFrame className="grid-paper relative h-80 border-y border-line md:h-[440px] md:border-y-0">
          <HeroScene />
        </SceneFrame>

        <div className="flex flex-col md:border-l md:border-line">
          <div className="brackets flex flex-1 flex-col justify-center gap-4 bg-night p-6 text-white">
            <p className="label text-white/60">
              {!election
                ? t.text('status', 'none_title')
                : election.status === 'closed'
                  ? 'Scrutin terminé'
                  : upcoming
                    ? 'Ouverture du vote dans'
                    : 'Clôture du vote dans'}
            </p>
            {election && election.status !== 'closed' ? (
              <Countdown target={upcoming ? election.opens_at : election.closes_at} clockOffset={clockOffset} dark />
            ) : (
              <p className="font-display text-3xl uppercase">{election?.results_published ? 'Résultats en ligne' : 'Merci'}</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line p-4">
            <span className="label text-dim">Statut</span>
            {status && <StatusTag tone={status.tone}>{status.label}</StatusTag>}
          </div>
        </div>
      </section>

      {/* --- Chiffres clés */}
      {facts.length > 0 && (
        <section className={`${GRID} -mt-px grid-cols-2 md:grid-cols-4`} aria-label="En bref">
          {facts.map((f, i) => (
            <div key={i} className="flex flex-col gap-1 bg-paper p-4 md:p-6">
              <span className="label text-dim">{f.title}</span>
              <span className="font-display text-lg uppercase md:text-xl">{f.text}</span>
            </div>
          ))}
        </section>
      )}

      {/* --- 01 La SA */}
      <Block index="01" eyebrow={t.text('home', 'about_eyebrow')} title={t.text('home', 'about_title')}>
        <div className="grid gap-6 p-4 md:grid-cols-[1fr_2fr] md:p-6">
          <div className="cell flex items-center justify-center p-6">
            <SaLogo variant="full" className="h-40 w-auto md:h-48" />
          </div>
          <p className="whitespace-pre-line text-lg leading-relaxed">{t.text('home', 'about_text')}</p>
        </div>
      </Block>

      {/* --- 02 Le candidat */}
      {election && <Candidate election={election} />}

      {/* --- 03 Calendrier */}
      {election && (
        <Block index="03" eyebrow={t.text('home', 'calendar_eyebrow')}>
          <dl className="grid md:grid-cols-2">
            <div className="p-4 md:border-r md:border-line md:p-6">
              <dt className="label text-dim">Ouverture</dt>
              <dd className="mt-2 font-display text-xl capitalize">{when(election.opens_at)}</dd>
            </div>
            <div className="border-t border-line p-4 md:border-t-0 md:p-6">
              <dt className="label text-dim">Clôture</dt>
              <dd className="mt-2 font-display text-xl capitalize">{when(election.closes_at)}</dd>
            </div>
          </dl>
          <p className="label border-t border-line px-4 py-3 text-dim md:px-6">{t.text('home', 'calendar_note')}</p>
        </Block>
      )}

      {/* --- 04 Comment voter */}
      <Block index="04" eyebrow={t.text('home', 'steps_eyebrow')} title={t.text('home', 'steps_title')}>
        <ol className={`${GRID} mt-6 border-b-0 sm:grid-cols-2 lg:grid-cols-4`}>
          {steps.map((s, i) => (
            <li key={i} className="flex flex-col gap-3 bg-paper p-4 md:p-6">
              <span className="font-display text-5xl leading-none">{String(i + 1).padStart(2, '0')}</span>
              <span className="label flex items-center gap-2">
                <span className="marker" aria-hidden="true" />
                {s.title}
              </span>
              <p className="whitespace-pre-line text-dim">{s.text}</p>
            </li>
          ))}
        </ol>
      </Block>

      {/* --- 05 Garanties */}
      <Block index="05" eyebrow={t.text('home', 'guarantees_eyebrow')} title={t.text('home', 'guarantees_title')}>
        <div className={`${GRID} mt-6 md:grid-cols-3`}>
          {guarantees.map((g, i) => (
            <div key={i} className="bg-paper p-4 md:p-6">
              <p className="font-display text-2xl uppercase">{g.title}</p>
              <p className="mt-2 whitespace-pre-line text-dim">{g.text}</p>
            </div>
          ))}
        </div>
        <div className="px-4 py-4 md:px-6">
          <Link to="/confidentialite" className="label text-brand-deep underline underline-offset-4">
            {t.text('home', 'guarantees_link')}
          </Link>
        </div>
      </Block>

      {cta && (
        <MobileActionBar>
          <Link to="/voter" className="btn w-full">
            {cta}
          </Link>
        </MobileActionBar>
      )}
    </div>
  )
}
