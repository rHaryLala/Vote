import { motion } from 'motion/react'
import { useState } from 'react'
import { Countdown } from '../components/Countdown'
import { GoogleButton } from '../components/GoogleButton'
import { HeroScene, SceneFrame } from '../components/SceneFrame'
import { initials } from '../components/site'
import { api, ApiError, NetworkError } from '../lib/api'
import { useContent } from '../lib/content'
import { setSession } from '../lib/session'
import type { ElectionInfo, VoterInfo } from '../lib/types'

interface LoginResponse {
  token: string
  expires_at: string | null
  voter: VoterInfo
}

export function Welcome({ election, clockOffset }: { election: ElectionInfo; clockOffset: number }) {
  const t = useContent()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const notYetOpen = Date.parse(election.opens_at) > Date.now() + clockOffset

  async function login(credential: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await api<LoginResponse>('/auth/google', { method: 'POST', body: { credential } })
      setSession({ token: res.token, expiresAt: res.expires_at, voter: res.voter })
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Réseau indisponible. Réessayez dès que vous êtes connecté(e).'
          : e instanceof ApiError
            ? e.message
            : 'Connexion impossible.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="grid flex-1 md:grid-cols-2">
      <SceneFrame className="grid-paper h-64 border-b border-line md:order-2 md:h-auto md:border-b-0 md:border-l">
        <HeroScene />
      </SceneFrame>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="flex flex-col"
      >
        <div className="border-b border-line p-4 md:p-8">
          <p className="label flex items-center gap-2 text-dim">
            <span className="marker" aria-hidden="true" />
            Référendum · {election.title}
          </p>
          <h1 className="mt-4 font-display text-3xl uppercase leading-[0.95] md:text-5xl">{t.text('login', 'title')}</h1>
          <p className="mt-4 font-mono text-[15px] leading-relaxed">{election.question}</p>
        </div>

        <div className="flex items-center gap-4 border-b border-line p-4 md:px-8">
          {election.candidate.photo ? (
            <img src={election.candidate.photo} alt="" className="h-14 w-14 shrink-0 object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-night font-display text-xl text-brand-bright">
              {initials(election.candidate.name)}
            </div>
          )}
          <div>
            <p className="label text-dim">Candidat</p>
            <p className="font-display text-xl uppercase">{election.candidate.name}</p>
          </div>
        </div>

        {notYetOpen && (
          <div className="border-b border-line">
            <p className="label px-4 pt-4 text-dim md:px-8">Ouverture du vote dans</p>
            <div className="px-2 pb-2 md:px-6">
              <Countdown target={election.opens_at} clockOffset={clockOffset} />
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 md:p-8">
          <GoogleButton onCredential={(c) => void login(c)} />
          {busy && <p className="label text-dim">Vérification de votre compte…</p>}
          {error && (
            <p role="alert" className="w-full max-w-sm border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              {error}
            </p>
          )}
          <p className="max-w-sm whitespace-pre-line text-center text-sm text-dim">{t.text('login', 'note')}</p>
        </div>
      </motion.div>
    </section>
  )
}
