const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** Secret du reçu : 128 bits aléatoires, générés sur l'appareil et jamais envoyés au serveur. */
export function newSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)))
}

/** SHA-256 en hexadécimal : seul ce hachage part vers le serveur, avec le bulletin. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return hex(new Uint8Array(digest))
}

/** Affichage lisible : 4A3F-92C1-… */
export function formatSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join('-').toUpperCase()
}

/** Normalise un code saisi par l'utilisateur (tirets, espaces, casse). */
export function normalizeSecret(input: string): string {
  return input.replace(/[^0-9a-f]/gi, '').toLowerCase()
}
