/** Erreur renvoyée par l'API (statut HTTP + code applicatif). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Le réseau est indisponible : ce n'est pas une réponse du serveur. */
export class NetworkError extends Error {
  constructor() {
    super('Réseau indisponible')
  }
}

interface Options {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: string | null
}

export async function api<T>(path: string, { method = 'GET', body, token }: Options = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new NetworkError()
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data?.code === 'string' ? data.code : 'error',
      typeof data?.message === 'string' ? data.message : 'Une erreur est survenue.',
    )
  }
  return data as T
}
