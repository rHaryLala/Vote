<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Election;
use App\Services\GoogleIdentity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    /**
     * Échange un jeton d'identité Google contre un jeton de session de vote.
     * Seuls les électeurs de la liste du scrutin courant obtiennent un jeton.
     */
    public function google(Request $request, GoogleIdentity $google): JsonResponse
    {
        $data = $request->validate(['credential' => ['required', 'string', 'max:4096']]);

        $identity = $google->verify($data['credential']);
        if (! $identity) {
            return response()->json([
                'code' => 'invalid_credential',
                'message' => 'Connexion Google refusée. Utilisez votre adresse @'.config('vote.google.allowed_domain').'.',
            ], 401);
        }

        $election = Election::current();
        if (! $election) {
            return response()->json([
                'code' => 'no_election',
                'message' => "Aucun scrutin n'est ouvert pour le moment.",
            ], 404);
        }

        // Un scrutin seulement « annoncé » (brouillon) n'est pas ouvert : la liste électorale peut encore changer.
        if ($election->status === Election::STATUS_DRAFT) {
            return response()->json([
                'code' => 'not_open_yet',
                'message' => "Le vote n'est pas encore ouvert. La connexion sera possible à l'ouverture du scrutin.",
            ], 409);
        }

        $voter = $election->voters()->where('email', $identity['email'])->first();
        if (! $voter) {
            AuditLog::record('login_refused', $election->id);

            return response()->json([
                'code' => 'not_eligible',
                'message' => 'Votre adresse ne figure pas sur la liste électorale. Seuls les étudiants inscrits pour la session en cours peuvent voter.',
            ], 403);
        }

        // Un seul jeton actif par électeur : une nouvelle connexion invalide les précédentes.
        $voter->tokens()->delete();
        $token = $voter->createToken('vote', ['vote'], now()->addMinutes(config('vote.token_ttl')));

        AuditLog::record('voter_login', $election->id, ['voter_id' => $voter->id]);

        return response()->json([
            'token' => $token->plainTextToken,
            'expires_at' => $token->accessToken->expires_at,
            'voter' => [
                'email' => $voter->email,
                'name' => $identity['name'],
                'picture' => $identity['picture'],
                'has_voted' => $voter->has_voted,
            ],
            'election' => ElectionController::present($election),
        ]);
    }

    /** État de la session courante (pour restaurer l'application après un rechargement). */
    public function me(Request $request): JsonResponse
    {
        $voter = $request->user();
        $voter->refresh();

        return response()->json([
            'voter' => ['email' => $voter->email, 'has_voted' => $voter->has_voted],
            'election' => ElectionController::present($voter->election),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['status' => 'logged_out']);
    }
}
