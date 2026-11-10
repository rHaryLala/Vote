<?php

return [

    /*
    | Connexion Google (Google Identity Services, jeton d'identité).
    | Le Client ID est propre à l'application de vote ; ne pas réutiliser celui du registrar.
    */
    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'allowed_domain' => env('GOOGLE_ALLOWED_DOMAIN', 'zurcher.edu.mg'),
    ],

    /*
    | Synchronisation de la liste électorale avec le registrar (export en lecture seule, protégé par jeton).
    | Voir deploy/registrar/README.md. Sans ces deux valeurs, seul l'import CSV est proposé.
    | Le jeton ne doit figurer que dans api/.env, jamais dans Git.
    */
    'registrar' => [
        'url' => env('REGISTRAR_EXPORT_URL'),   // ex. https://registrar.zurcher.edu.mg/app/electeurs-sa.api.php
        'token' => env('REGISTRAR_EXPORT_TOKEN'),
        'timeout' => (int) env('REGISTRAR_EXPORT_TIMEOUT', 20),
    ],

    /*
    | Fuseau d'affichage et de saisie des dates dans l'administration (Madagascar, UTC+3).
    | La base reste en UTC ; seul ce que voit la commission est converti.
    */
    'timezone' => env('VOTE_TIMEZONE', 'Indian/Antananarivo'),

    /* Durée de vie du jeton de session de vote, en minutes. */
    'token_ttl' => (int) env('VOTER_TOKEN_TTL', 240),

    /* Choix possibles d'un bulletin (référendum sur un candidat unique). */
    'choices' => ['yes', 'no', 'blank'],
];
