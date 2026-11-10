<?php

use App\Models\Election;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Feature');

// --- Utilitaires partagés par les tests de l'administration ---

function draftElection(array $overrides = []): Election
{
    return Election::create(array_merge([
        'title' => 'Référendum SA',
        'question' => 'Acceptez-vous ce candidat ?',
        'candidate_name' => 'Candidat Unique',
        'opens_at' => now()->addHour(),
        'closes_at' => now()->addDay(),
        'status' => Election::STATUS_DRAFT,
    ], $overrides));
}

function csvFile(string $content): string
{
    $path = tempnam(sys_get_temp_dir(), 'voters');
    file_put_contents($path, $content);

    return $path;
}

/** Connecte un membre de la commission et renvoie son jeton. */
function adminToken(): string
{
    // Dans un même test, un en-tête d'autorisation laissé par une requête précédente est lu par la limitation de
    // débit de la route de connexion, et le garde mémorise l'utilisateur : on repart d'un état propre. (En production,
    // chaque requête est indépendante.)
    test()->flushHeaders();
    app('auth')->forgetGuards();

    User::factory()->create(['email' => 'commission@zurcher.edu.mg', 'password' => 'mot-de-passe-solide']);

    $token = test()->postJson('/api/admin/login', ['email' => 'commission@zurcher.edu.mg', 'password' => 'mot-de-passe-solide'])
        ->assertOk()->json('token');
    app('auth')->forgetGuards();

    return $token;
}
