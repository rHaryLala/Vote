import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useContent } from '../lib/content'
import { useOnline } from '../lib/device'
import { useSession } from '../lib/session'
import { useVote } from '../lib/vote-context'
import { SaLogo } from './SaLogo'

function StatusChip() {
  const online = useOnline()
  const { pending } = useVote()
  const label = !online ? 'Hors ligne' : pending ? 'Envoi…' : 'En ligne'
  const dot = !online || pending ? 'bg-brand' : 'bg-ok'
  return (
    <span className="label inline-flex items-center gap-2 whitespace-nowrap text-ink" role="status">
      <span className={`h-2 w-2 ${dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="cell fixed inset-x-4 top-20 z-40 mx-auto flex max-w-md items-center justify-between gap-3 p-3 text-sm shadow-lg">
      <span>Une nouvelle version est disponible.</span>
      <button className="btn min-h-10 px-4" onClick={() => void updateServiceWorker(true)}>
        Mettre à jour
      </button>
    </div>
  )
}

const NAV = [
  { to: '/', label: 'Accueil' },
  { to: '/voter', label: 'Voter' },
  { to: '/verification', label: 'Vérifier' },
  { to: '/confidentialite', label: 'Confidentialité' },
]

export function Shell({ children }: { children: ReactNode }) {
  const t = useContent()
  const session = useSession()
  const { logout } = useVote()
  const location = useLocation()
  // Ces écrans ont un bouton fixe en bas sur mobile : on réserve sa place pour que le pied de page reste cliquable.
  const hasActionBar = location.pathname === '/' || location.pathname === '/voter'

  return (
    <div className="flex min-h-dvh flex-col">
      {/* En-tête en grille, comme la référence : cellules séparées par des filets. */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-stretch border-x border-line">
          <Link to="/" className="flex items-center gap-3 border-r border-line px-4" aria-label="Accueil — Vote SA">
            <SaLogo variant="mark" className="h-8 w-auto" />
            <span className="hidden leading-tight sm:block">
              <span className="label block text-ink">{t.text('general', 'header_title')}</span>
              <span className="label block text-dim">{t.text('general', 'header_subtitle')}</span>
            </span>
          </Link>

          <nav className="hidden flex-1 items-stretch justify-center md:flex" aria-label="Navigation principale">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end
                className={({ isActive }) =>
                  `label flex items-center px-4 transition-colors hover:text-brand-deep ${isActive ? 'text-ink underline decoration-brand decoration-2 underline-offset-8' : 'text-dim'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4 border-l border-line px-4 md:ml-0">
            <StatusChip />
            {session ? (
              <button className="label text-dim hover:text-ink" onClick={() => void logout()}>
                Quitter
              </button>
            ) : (
              <Link to="/voter" className="btn hidden min-h-10 px-4 md:inline-flex">
                Je vote
              </Link>
            )}
          </div>
        </div>
      </header>

      <UpdateBanner />

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col border-x border-line">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            className="flex flex-1 flex-col"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className={`relative z-10 border-t border-line ${hasActionBar ? 'mb-24 md:mb-0' : ''}`}>
        <div className="pb-safe mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-x border-line px-4 pt-4">
          <span className="label text-dim">{t.text('general', 'footer')}</span>
          <span className="flex gap-4">
            <Link to="/verification" className="label text-dim hover:text-ink">
              Vérifier mon reçu
            </Link>
            <Link to="/confidentialite" className="label text-dim hover:text-ink">
              Confidentialité
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
