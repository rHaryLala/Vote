<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Ballot;
use App\Models\Voter;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class VoteController extends Controller
{
    /**
     * Dépose un bulletin.
     *
     * - Idempotent : si l'électeur a déjà voté, on répond « déjà enregistré » sans rien écrire. Un renvoi
     *   après coupure réseau (file d'attente hors ligne) ne crée donc jamais de doublon.
     * - Anonyme : la même transaction marque l'électeur comme « a voté » et insère le bulletin, mais le
     *   bulletin ne contient aucune référence à l'électeur ni aucun horodatage.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'choice' => ['required', 'string', Rule::in(config('vote.choices'))],
            // SHA-256 d'un secret généré sur l'appareil de l'électeur (64 caractères hexadécimaux).
            'receipt_hash' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/'],
        ]);

        /** @var Voter $authenticated */
        $authenticated = $request->user();
        $election = $authenticated->election;

        if (! $election->isOpen()) {
            return response()->json([
                'code' => 'election_not_open',
                'message' => "Le scrutin n'est pas ouvert : votre vote n'a pas été enregistré.",
            ], 409);
        }

        try {
            $alreadyVoted = DB::transaction(function () use ($authenticated, $election, $data) {
                // Verrou sur la ligne de l'électeur : deux requêtes simultanées ne peuvent pas voter deux fois.
                $voter = Voter::query()->whereKey($authenticated->getKey())->lockForUpdate()->firstOrFail();

                if ($voter->has_voted) {
                    return true;
                }

                Ballot::query()->create([
                    'id' => bin2hex(random_bytes(16)),
                    'election_id' => $election->id,
                    'choice' => $data['choice'],
                    'receipt_hash' => $data['receipt_hash'],
                ]);

                $voter->forceFill(['has_voted' => true])->save();

                // Participation seulement : ni le choix, ni l'identifiant du bulletin.
                AuditLog::record('vote_cast', $election->id, ['voter_id' => $voter->id]);

                return false;
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json([
                'code' => 'receipt_conflict',
                'message' => 'Reçu déjà utilisé. Réessayez le vote.',
            ], 409);
        }

        return response()->json(
            ['status' => $alreadyVoted ? 'already_voted' : 'recorded'],
            $alreadyVoted ? 200 : 201
        );
    }
}
