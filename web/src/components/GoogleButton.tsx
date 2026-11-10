import { useEffect, useRef, useState } from 'react'
import { useOnline } from '../lib/device'

interface GoogleId {
  initialize(config: Record<string, unknown>): void
  renderButton(el: HTMLElement, options: Record<string, unknown>): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const SRC = 'https://accounts.google.com/gsi/client'

function loadGis(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      s.remove()
      reject(new Error('gis'))
    }
    document.head.appendChild(s)
  })
}

/** Bouton officiel « Se connecter avec Google » (Google Identity Services). */
export function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const callback = useRef(onCredential)
  callback.current = onCredential
  const online = useOnline()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!CLIENT_ID) {
      setState('error')
      return
    }
    let cancelled = false
    setState('loading')
    loadGis()
      .then(() => {
        if (cancelled || !host.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (r: { credential: string }) => callback.current(r.credential),
          ux_mode: 'popup',
          hd: 'zurcher.edu.mg',
          auto_select: false,
        })
        window.google.accounts.id.renderButton(host.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'signin_with',
          locale: 'fr',
          width: 300,
        })
        setState('ready')
      })
      .catch(() => !cancelled && setState('error'))
    return () => {
      cancelled = true
    }
    // Relance le chargement quand le réseau revient.
  }, [online])

  return (
    <div className="flex min-h-[44px] flex-col items-center gap-2">
      <div ref={host} className={state === 'ready' ? '' : 'hidden'} />
      {state === 'loading' && <p className="text-sm text-dim">Chargement de la connexion Google…</p>}
      {state === 'error' && (
        <p role="alert" className="max-w-xs text-center text-sm text-brand-deep">
          {online
            ? 'Impossible de charger la connexion Google. Rechargez la page.'
            : 'Une connexion internet est nécessaire pour vous identifier la première fois.'}
        </p>
      )}
    </div>
  )
}
