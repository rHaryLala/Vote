import { motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { Block } from '../components/site'
import { api, NetworkError } from '../lib/api'
import { useContent } from '../lib/content'
import { normalizeSecret, sha256Hex } from '../lib/receipt'

type Result = 'found' | 'missing' | 'invalid' | 'offline' | null

export function VerifyPage() {
  const t = useContent()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<Result>(null)
  const [busy, setBusy] = useState(false)

  async function check(e: FormEvent) {
    e.preventDefault()
    const secret = normalizeSecret(code)
    if (secret.length !== 32) return setResult('invalid')
    setBusy(true)
    try {
      const { found } = await api<{ found: boolean }>(`/receipts/${await sha256Hex(secret)}`)
      setResult(found ? 'found' : 'missing')
    } catch (err) {
      setResult(err instanceof NetworkError ? 'offline' : 'missing')
    } finally {
      setBusy(false)
    }
  }

  const messages: Record<Exclude<Result, null>, { tone: string; text: string }> = {
    found: { tone: 'border-ok/40 bg-ok/5 text-ok', text: "✓ Votre bulletin figure bien dans l'urne." },
    missing: {
      tone: 'border-danger/40 bg-danger/5 text-danger',
      text: "Aucun bulletin ne correspond à ce code. Vérifiez la saisie, ou votre vote n'a pas encore été reçu par le serveur.",
    },
    invalid: { tone: 'border-brand bg-brand/10 text-ink', text: 'Le code doit comporter 32 caractères (chiffres et lettres A à F).' },
    offline: { tone: 'border-brand bg-brand/10 text-ink', text: 'Réseau indisponible : réessayez une fois connecté(e).' },
  }

  return (
    <Block eyebrow={t.text('verify', 'eyebrow')} title={t.text('verify', 'title')}>
      <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
        <p className="whitespace-pre-line leading-relaxed text-dim">{t.text('verify', 'intro')}</p>
        <form onSubmit={(e) => void check(e)} className="grid gap-3">
          <label htmlFor="code" className="label text-dim">
            Code de reçu
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setResult(null)
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            className="min-h-14 border border-ink bg-panel px-4 font-mono text-base tracking-wider placeholder:text-dim/60"
          />
          <button disabled={busy || !code.trim()} className="btn w-full">
            {busy ? 'Vérification…' : 'Vérifier'}
          </button>
          {result && (
            <motion.p
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`border p-4 text-sm ${messages[result].tone}`}
            >
              {messages[result].text}
            </motion.p>
          )}
        </form>
      </div>
    </Block>
  )
}
