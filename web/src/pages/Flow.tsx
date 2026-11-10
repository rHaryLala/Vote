import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useContent } from '../lib/content'
import { useElection, useMe } from '../lib/queries'
import { setSession, useSession } from '../lib/session'
import { useVote } from '../lib/vote-context'
import { Countdown } from '../components/Countdown'
import { DoneScreen } from './DoneScreen'
import { ResultsView } from './ResultsView'
import { VoteScreen } from './VoteScreen'
import { Welcome } from './Welcome'

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <span className="marker" aria-hidden="true" />
      <h1 className="mt-4 font-display text-3xl uppercase md:text-5xl">{title}</h1>
      <div className="mx-auto mt-4 max-w-md text-dim">{children}</div>
    </section>
  )
}

/** Choisit l'écran selon l'état : scrutin, connexion, bulletin en attente, vote, résultats. */
export function Flow() {
  const t = useContent()
  const { election, clockOffset, isPending, isError } = useElection()
  const session = useSession()
  const { pending, receipt } = useVote()
  const me = useMe(session?.token ?? null)

  // Jeton refusé par le serveur : la session est terminée.
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) setSession(null)
  }, [me.error])

  if (isPending && !election) return <p className="label p-10 text-center text-dim">Chargement…</p>
  if (!election) {
    return (
      <Message title={t.text('status', 'none_title')}>
        {isError ? 'Impossible de joindre le serveur. Réessayez quand vous êtes connecté(e).' : t.text('status', 'none_text')}
      </Message>
    )
  }

  const resultsPublic = election.status === 'closed' && election.results_published
  if (resultsPublic) return <ResultsView />

  if (!session) return <Welcome election={election} clockOffset={clockOffset} />

  const hasVoted = session.voter.has_voted || me.data?.voter.has_voted || receipt !== null
  if (hasVoted || pending) return <DoneScreen />

  if (election.is_open) return <VoteScreen election={election} clockOffset={clockOffset} />

  if (election.status === 'closed' || Date.parse(election.closes_at) < Date.now() + clockOffset) {
    return (
      <Message title={t.text('status', 'closed_title')}>
        {t.text('status', 'closed_text')}{' '}
        <Link to="/verification" className="text-brand-deep underline underline-offset-4">
          Vérifier mon reçu
        </Link>
      </Message>
    )
  }

  return (
    <Message title={t.text('status', 'notopen_title')}>
      <p className="mb-5">{t.text('status', 'notopen_text')}</p>
      <Countdown target={election.opens_at} clockOffset={clockOffset} />
    </Message>
  )
}
