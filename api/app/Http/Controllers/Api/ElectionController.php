<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Ballot;
use App\Models\Election;
use Illuminate\Http\JsonResponse;

class ElectionController extends Controller
{
    /** Informations publiques du scrutin courant, avec l'heure du serveur (pour corriger l'horloge d'un appareil). */
    public function current(): JsonResponse
    {
        $election = Election::current();
        if (! $election) {
            return response()->json(['election' => null, 'server_time' => now()->toIso8601String()]);
        }

        return response()->json([
            'election' => self::present($election),
            'server_time' => now()->toIso8601String(),
        ]);
    }

    /** Résultats : seulement une fois le scrutin clos ET publié par la commission. */
    public function results(): JsonResponse
    {
        $election = Election::current();
        if (! $election || $election->status !== Election::STATUS_CLOSED || ! $election->results_published) {
            return response()->json([
                'code' => 'results_unavailable',
                'message' => 'Les résultats ne sont pas encore publiés.',
            ], 404);
        }

        return response()->json([
            'election' => self::present($election),
            'results' => $election->tally(),
        ]);
    }

    /**
     * Vérifie qu'un reçu figure dans l'urne. Ne révèle JAMAIS le choix : un reçu ne doit pas
     * servir de preuve de vote (achat ou contrainte de vote).
     */
    public function receipt(string $hash): JsonResponse
    {
        // Pas de « scrutin courant » ici : un électeur doit pouvoir vérifier son bulletin même quand le scrutin est clos
        // et n'est plus affiché sur le site. Un scrutin supprimé emporte ses bulletins : le reçu n'est alors plus trouvé.
        $found = (bool) preg_match('/^[a-f0-9]{64}$/', $hash)
            && Ballot::query()->where('receipt_hash', $hash)->exists();

        return response()->json(['found' => $found]);
    }

    /** @return array<string, mixed> */
    public static function present(Election $election): array
    {
        return [
            'id' => $election->id,
            'title' => $election->title,
            'question' => $election->question,
            'candidate' => [
                'name' => $election->candidate_name,
                'title' => $election->candidate_title,
                'photo' => $election->candidatePhotoUrl(),
                'bio' => $election->candidate_bio,
                // Un engagement par ligne dans l'administration -> une liste pour l'application.
                'program' => collect(preg_split('/\R/u', (string) $election->candidate_program) ?: [])
                    ->map(fn ($line) => trim((string) preg_replace('/^[\s\-*•]+/u', '', $line)))
                    ->filter()->values()->all(),
            ],
            'status' => $election->status,
            'is_open' => $election->isOpen(),
            'opens_at' => $election->opens_at->toIso8601String(),
            'closes_at' => $election->closes_at->toIso8601String(),
            'results_published' => $election->results_published,
            'choices' => config('vote.choices'),
        ];
    }
}
