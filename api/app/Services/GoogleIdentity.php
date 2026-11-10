<?php

namespace App\Services;

/**
 * Résultat d'une vérification de jeton Google : l'identité confirmée, ou rien.
 */
interface GoogleIdentity
{
    /**
     * Vérifie un jeton d'identité Google (signature, expiration, émetteur, audience) puis
     * renvoie l'identité, ou null si le jeton est invalide ou n'appartient pas au domaine autorisé.
     *
     * @return array{email: string, name: ?string, picture: ?string}|null
     */
    public function verify(string $idToken): ?array;
}
