import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPending, loadReceipt, queueVote, submitPending } from './outbox'
import { formatSecret, normalizeSecret, sha256Hex } from './receipt'

type Reply = { status: number; body: unknown } | 'network-error'

/** Simule le serveur : une réponse par appel, dans l'ordre. */
function mockServer(...replies: Reply[]) {
  const calls: { url: string; body: unknown }[] = []
  const queue = [...replies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      const reply = queue.shift()
      if (!reply || reply === 'network-error') throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return calls
}

const jean = 'jean@zurcher.edu.mg'
const marie = 'marie@zurcher.edu.mg'

beforeEach(async () => {
  // IndexedDB vierge entre les tests.
  const { clear } = await import('idb-keyval')
  await clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('reçu', () => {
  it('calcule un SHA-256 conforme (vecteur de test connu)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('formate et normalise un code saisi à la main', () => {
    const secret = '0123456789abcdef0123456789abcdef'
    expect(formatSecret(secret)).toBe('0123-4567-89AB-CDEF-0123-4567-89AB-CDEF')
    expect(normalizeSecret(' 0123-4567-89ab-cdef 0123-4567-89AB-CDEF ')).toBe(secret)
  })
})

describe("file d'attente du bulletin", () => {
  it("écrit le bulletin sur l'appareil avant tout envoi, avec un reçu haché", async () => {
    const p = await queueVote(jean, 'yes', 1)
    expect(await loadPending(jean)).toEqual(p)
    expect(p.receiptHash).toBe(await sha256Hex(p.secret))
    expect(p.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('ne remplace jamais un bulletin déjà en attente (pas de changement de choix par re-clic)', async () => {
    const first = await queueVote(jean, 'yes', 1)
    const second = await queueVote(jean, 'no', 1)
    expect(second).toEqual(first)
    expect((await loadPending(jean))?.choice).toBe('yes')
  })

  it("isole les données de chaque électeur sur un appareil partagé", async () => {
    await queueVote(jean, 'yes', 1)
    expect(await loadPending(marie)).toBeUndefined()
    expect(await loadReceipt(marie)).toBeUndefined()
  })

  it("garde le bulletin quand le réseau est coupé, puis l'envoie au retour du réseau", async () => {
    const p = await queueVote(jean, 'yes', 1)

    mockServer('network-error')
    expect(await submitPending(jean, 'tok')).toEqual({ status: 'offline' })
    expect(await loadPending(jean)).toEqual(p)

    const calls = mockServer({ status: 201, body: { status: 'recorded' } })
    const result = await submitPending(jean, 'tok')
    expect(result.status).toBe('recorded')
    expect(await loadPending(jean)).toBeUndefined()
    expect((await loadReceipt(jean))?.secret).toBe(p.secret)
    // Seul le hachage du reçu part vers le serveur, jamais le secret.
    expect(JSON.stringify(calls[0].body)).not.toContain(p.secret)
    expect(calls[0].body).toEqual({ choice: 'yes', receipt_hash: p.receiptHash })
  })

  it('« déjà voté » après un renvoi : conserve le reçu si le bulletin est bien dans l\'urne', async () => {
    const p = await queueVote(jean, 'yes', 1)
    mockServer({ status: 200, body: { status: 'already_voted' } }, { status: 200, body: { found: true } })

    expect((await submitPending(jean, 'tok')).status).toBe('recorded')
    expect((await loadReceipt(jean))?.secret).toBe(p.secret)
  })

  it("« déjà voté » depuis un autre appareil : ne garde pas un faux reçu", async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 200, body: { status: 'already_voted' } }, { status: 200, body: { found: false } })

    const result = await submitPending(jean, 'tok')
    expect(result).toEqual({ status: 'recorded', receipt: null })
    expect(await loadReceipt(jean)).toBeUndefined()
    expect(await loadPending(jean)).toBeUndefined()
  })

  it('scrutin clos (409) : abandonne le bulletin et prévient', async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 409, body: { code: 'election_not_open', message: "Le scrutin n'est pas ouvert." } })

    expect(await submitPending(jean, 'tok')).toEqual({ status: 'rejected', message: "Le scrutin n'est pas ouvert." })
    expect(await loadPending(jean)).toBeUndefined()
  })

  it('jeton expiré (401) : garde le bulletin pour après la reconnexion', async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 401, body: { message: 'Unauthenticated.' } })

    expect(await submitPending(jean, 'tok')).toEqual({ status: 'unauthorized' })
    expect(await loadPending(jean)).toBeDefined()
  })

  it('erreur serveur temporaire (500) : garde le bulletin et réessaiera', async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 500, body: { message: 'Server error' } })

    expect(await submitPending(jean, 'tok')).toEqual({ status: 'offline' })
    expect(await loadPending(jean)).toBeDefined()
  })

  it("ne fait rien s'il n'y a aucun bulletin en attente", async () => {
    const calls = mockServer()
    expect(await submitPending(jean, 'tok')).toEqual({ status: 'none' })
    expect(calls).toHaveLength(0)
  })
})
