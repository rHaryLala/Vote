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
    expect(await loadPending(jean, 1)).toEqual(p)
    expect(p.receiptHash).toBe(await sha256Hex(p.secret))
    expect(p.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('ne remplace jamais un bulletin déjà en attente (pas de changement de choix par re-clic)', async () => {
    const first = await queueVote(jean, 'yes', 1)
    const second = await queueVote(jean, 'no', 1)
    expect(second).toEqual(first)
    expect((await loadPending(jean, 1))?.choice).toBe('yes')
  })

  it("isole les données de chaque électeur sur un appareil partagé", async () => {
    await queueVote(jean, 'yes', 1)
    expect(await loadPending(marie, 1)).toBeUndefined()
    expect(await loadReceipt(marie, 1)).toBeUndefined()
  })

  it("garde le bulletin quand le réseau est coupé, puis l'envoie au retour du réseau", async () => {
    const p = await queueVote(jean, 'yes', 1)

    mockServer('network-error')
    expect(await submitPending(jean, 'tok', 1)).toEqual({ status: 'offline' })
    expect(await loadPending(jean, 1)).toEqual(p)

    const calls = mockServer({ status: 201, body: { status: 'recorded' } })
    const result = await submitPending(jean, 'tok', 1)
    expect(result.status).toBe('recorded')
    expect(await loadPending(jean, 1)).toBeUndefined()
    expect((await loadReceipt(jean, 1))?.secret).toBe(p.secret)
    // Seul le hachage du reçu part vers le serveur, jamais le secret.
    expect(JSON.stringify(calls[0].body)).not.toContain(p.secret)
    expect(calls[0].body).toEqual({ choice: 'yes', receipt_hash: p.receiptHash })
  })

  it('« déjà voté » après un renvoi : conserve le reçu si le bulletin est bien dans l\'urne', async () => {
    const p = await queueVote(jean, 'yes', 1)
    mockServer({ status: 200, body: { status: 'already_voted' } }, { status: 200, body: { found: true } })

    expect((await submitPending(jean, 'tok', 1)).status).toBe('recorded')
    expect((await loadReceipt(jean, 1))?.secret).toBe(p.secret)
  })

  it("« déjà voté » depuis un autre appareil : ne garde pas un faux reçu", async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 200, body: { status: 'already_voted' } }, { status: 200, body: { found: false } })

    const result = await submitPending(jean, 'tok', 1)
    expect(result).toEqual({ status: 'recorded', receipt: null })
    expect(await loadReceipt(jean, 1)).toBeUndefined()
    expect(await loadPending(jean, 1)).toBeUndefined()
  })

  it('scrutin clos (409) : abandonne le bulletin et prévient', async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 409, body: { code: 'election_not_open', message: "Le scrutin n'est pas ouvert." } })

    expect(await submitPending(jean, 'tok', 1)).toEqual({ status: 'rejected', message: "Le scrutin n'est pas ouvert." })
    expect(await loadPending(jean, 1)).toBeUndefined()
  })

  it('jeton expiré (401) : garde le bulletin pour après la reconnexion', async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 401, body: { message: 'Unauthenticated.' } })

    expect(await submitPending(jean, 'tok', 1)).toEqual({ status: 'unauthorized' })
    expect(await loadPending(jean, 1)).toBeDefined()
  })

  it('erreur serveur temporaire (500) : garde le bulletin et réessaiera', async () => {
    await queueVote(jean, 'yes', 1)
    mockServer({ status: 500, body: { message: 'Server error' } })

    expect(await submitPending(jean, 'tok', 1)).toEqual({ status: 'offline' })
    expect(await loadPending(jean, 1)).toBeDefined()
  })

  it("ne fait rien s'il n'y a aucun bulletin en attente", async () => {
    const calls = mockServer()
    expect(await submitPending(jean, 'tok', 1)).toEqual({ status: 'none' })
    expect(calls).toHaveLength(0)
  })
})

describe('plusieurs scrutins pour la même adresse sur le même appareil', () => {
  it("le reçu d'un scrutin passé n'est pas pris pour celui du scrutin en cours", async () => {
    const first = await queueVote(jean, 'yes', 1)
    mockServer({ status: 201, body: { status: 'recorded' } })
    await submitPending(jean, 'tok', 1)
    expect((await loadReceipt(jean, 1))?.secret).toBe(first.secret)

    // Nouveau scrutin (n° 2) : aucun reçu, aucun bulletin en attente → l'électeur peut voter.
    expect(await loadReceipt(jean, 2)).toBeUndefined()
    expect(await loadPending(jean, 2)).toBeUndefined()
  })

  it("voter dans le scrutin suivant conserve le reçu du premier", async () => {
    const first = await queueVote(jean, 'yes', 1)
    mockServer({ status: 201, body: { status: 'recorded' } })
    await submitPending(jean, 'tok', 1)

    const second = await queueVote(jean, 'no', 2)
    expect(second.secret).not.toBe(first.secret)
    mockServer({ status: 201, body: { status: 'recorded' } })
    await submitPending(jean, 'tok', 2)

    expect((await loadReceipt(jean, 1))?.secret).toBe(first.secret)
    expect((await loadReceipt(jean, 2))?.secret).toBe(second.secret)
  })

  it("un bulletin en attente pour un scrutin ne bloque pas le vote dans un autre", async () => {
    const a = await queueVote(jean, 'yes', 1)
    const b = await queueVote(jean, 'no', 2)
    expect(b.electionId).toBe(2)
    expect((await loadPending(jean, 1))?.secret).toBe(a.secret)
    expect((await loadPending(jean, 2))?.secret).toBe(b.secret)
  })

  it("lit les anciennes données (une seule place par adresse) seulement pour le scrutin qu'elles concernent", async () => {
    const { set } = await import('idb-keyval')
    await set(`sa.receipt:${jean}`, { secret: 'ancien-secret', electionId: 1 })
    await set(`sa.pending:${jean}`, { choice: 'yes', secret: 's', receiptHash: 'h', electionId: 1, createdAt: 1 })

    expect((await loadReceipt(jean, 1))?.secret).toBe('ancien-secret')
    expect(await loadReceipt(jean, 2)).toBeUndefined()         // l'ancien reçu ne vaut pas pour le scrutin 2
    expect((await loadPending(jean, 1))?.secret).toBe('s')
    expect(await loadPending(jean, 2)).toBeUndefined()
  })
})
