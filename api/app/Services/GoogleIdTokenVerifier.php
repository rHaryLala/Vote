<?php

namespace App\Services;

use Google\Auth\Cache\FileSystemCacheItemPool;
use Google\Client;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Vérification locale du jeton d'identité Google : la signature est contrôlée avec les clés publiques
 * de Google (mises en cache), sans appeler l'endpoint de débogage « tokeninfo ».
 */
class GoogleIdTokenVerifier implements GoogleIdentity
{
    public function verify(string $idToken): ?array
    {
        $clientId = config('vote.google.client_id');
        if (! $clientId) {
            Log::error('GOOGLE_CLIENT_ID non configuré : connexion Google impossible.');

            return null;
        }

        try {
            $client = new Client(['client_id' => $clientId]);
            // Cache sur disque : les clés publiques de Google ne sont pas retéléchargées à chaque connexion.
            $client->setCache(new FileSystemCacheItemPool(storage_path('framework/cache/google')));
            $payload = $client->verifyIdToken($idToken);
        } catch (Throwable $e) {
            Log::warning('Jeton Google rejeté : '.$e->getMessage());

            return null;
        }

        if (! is_array($payload) || empty($payload['email'])) {
            return null;
        }

        $domain = strtolower((string) config('vote.google.allowed_domain'));
        $email = strtolower(trim($payload['email']));

        // L'e-mail doit être vérifié, appartenir au domaine institutionnel (claim hd ET suffixe de l'adresse).
        if (empty($payload['email_verified'])
            || strtolower((string) ($payload['hd'] ?? '')) !== $domain
            || ! str_ends_with($email, '@'.$domain)) {
            return null;
        }

        return [
            'email' => $email,
            'name' => $payload['name'] ?? null,
            'picture' => $payload['picture'] ?? null,
        ];
    }
}
