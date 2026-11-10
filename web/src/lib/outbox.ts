import { del, get, set } from 'idb-keyval'
import { api, ApiError, NetworkError } from './api'
import { newSecret, sha256Hex } from './receipt'
import type { Choice } from './types'

/**
 * File d'attente hors ligne du bulletin.
 *
 * Le bulletin est écrit sur l'appareil AVANT toute tentative d'envoi, puis renvoyé tant que le serveur
 * n'a pas répondu. L'envoi est idempotent côté serveur : renvoyer ne crée jamais de second vote.
 * Un seul bulletin peut être en attente (on n'écrase jamais un bulletin déjà mis en file).
 *
 * Les données sont rangées PAR ÉLECTEUR (adresse) ET PAR SCRUTIN : sur un appareil partagé, un étudiant ne voit
 * jamais le bulletin ni le reçu d'un autre ; et le reçu d'un scrutin passé n'est jamais pris pour celui du
 * scrutin en cours (« déjà voté » à tort), ni écrasé par lui : on garde un reçu par scrutin.
 */
export interface PendingVote {
  choice: Choice
  secret: string
  receiptHash: string
  electionId: number
  createdAt: number
}

/** Reçu conservé sur l'appareil une fois le vote enregistré par le serveur. */
export interface StoredReceipt {
  secret: string
  electionId: number
}

const pendingKey = (email: string, electionId: number) => `sa.pending:${email}:${electionId}`
const receiptKey = (email: string, electionId: number) => `sa.receipt:${email}:${electionId}`
// Anciennes clés (une seule place par adresse, avant la prise en compte du scrutin) : lues seulement si elles
// concernent bien ce scrutin, jamais réécrites.
const legacyPendingKey = (email: string) => `sa.pending:${email}`
const legacyReceiptKey = (email: string) => `sa.receipt:${email}`

export async function loadPending(email: string, electionId: number): Promise<PendingVote | undefined> {
  const current = await get<PendingVote>(pendingKey(email, electionId))
  if (current) return current
  const legacy = await get<PendingVote>(legacyPendingKey(email))
  return legacy?.electionId === electionId ? legacy : undefined
}

export async function loadReceipt(email: string, electionId: number): Promise<StoredReceipt | undefined> {
  const current = await get<StoredReceipt>(receiptKey(email, electionId))
  if (current) return current
  const legacy = await get<StoredReceipt>(legacyReceiptKey(email))
  return legacy?.electionId === electionId ? legacy : undefined
}

async function dropPending(email: string, electionId: number): Promise<void> {
  await del(pendingKey(email, electionId))
  const legacy = await get<PendingVote>(legacyPendingKey(email))
  if (legacy?.electionId === electionId) await del(legacyPendingKey(email))
}

export async function queueVote(email: string, choice: Choice, electionId: number): Promise<PendingVote> {
  const existing = await loadPending(email, electionId)
  if (existing) return existing

  const secret = newSecret()
  const pending: PendingVote = {
    choice,
    secret,
    receiptHash: await sha256Hex(secret),
    electionId,
    createdAt: Date.now(),
  }
  await set(pendingKey(email, electionId), pending)
  return pending
}

export type SubmitResult =
  | { status: 'none' }
  | { status: 'recorded'; receipt: StoredReceipt | null }
  | { status: 'offline' }
  | { status: 'unauthorized' }
  | { status: 'rejected'; message: string }

/** Envoie le bulletin en attente de cet électeur pour ce scrutin, s'il y en a un. */
export async function submitPending(email: string, token: string, electionId: number): Promise<SubmitResult> {
  const pending = await loadPending(email, electionId)
  if (!pending) return { status: 'none' }

  try {
    const res = await api<{ status: 'recorded' | 'already_voted' }>('/vote', {
      method: 'POST',
      token,
      body: { choice: pending.choice, receipt_hash: pending.receiptHash },
    })

    let ownsBallot = res.status === 'recorded'
    if (!ownsBallot) {
      // « Déjà voté » : soit c'est notre renvoi (réponse précédente perdue), soit un vote depuis un autre
      // appareil. Le reçu en témoigne : on ne garde le secret que si ce bulletin est bien dans l'urne.
      ownsBallot = (await api<{ found: boolean }>(`/receipts/${pending.receiptHash}`)).found
    }

    const receipt: StoredReceipt | null = ownsBallot
      ? { secret: pending.secret, electionId: pending.electionId }
      : null
    if (receipt) await set(receiptKey(email, electionId), receipt)
    await dropPending(email, electionId)
    return { status: 'recorded', receipt }
  } catch (e) {
    if (e instanceof NetworkError) return { status: 'offline' }
    if (e instanceof ApiError) {
      if (e.status === 401) return { status: 'unauthorized' }
      // Scrutin clos, choix refusé… : le renvoyer ne servirait à rien.
      if (e.status === 409 || e.status === 422) {
        await dropPending(email, electionId)
        return { status: 'rejected', message: e.message }
      }
    }
    // Erreur serveur temporaire (5xx, 429) : on garde le bulletin en attente et on réessaiera.
    return { status: 'offline' }
  }
}
