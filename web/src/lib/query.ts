import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { del, get, set } from 'idb-keyval'
import { ApiError } from './api'

/**
 * Offline-first : les requêtes ne sont pas bloquées par l'absence de réseau, et le cache est persisté
 * dans IndexedDB. L'application rouverte hors ligne affiche donc le dernier état connu du scrutin.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
})

export const persister = createAsyncStoragePersister({
  key: 'sa.query-cache',
  throttleTime: 1000,
  storage: {
    getItem: async (key) => (await get<string>(key)) ?? null,
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
})

/** À la déconnexion : on efface le cache des données d'électeur. */
export async function clearCache(): Promise<void> {
  queryClient.clear()
  await persister.removeClient()
}
