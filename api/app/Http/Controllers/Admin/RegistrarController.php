<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Election;
use App\Services\RegistrarClient;
use App\Services\RegistrarException;
use App\Services\VoterImporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

/**
 * Synchronisation de la liste électorale avec le registrar. La commission choisit la session à synchroniser :
 * le registrar n'a pas de notion unique de « session active », donc on ne devine pas.
 */
class RegistrarController extends Controller
{
    public function sessions(RegistrarClient $registrar): JsonResponse
    {
        if (! $registrar->isConfigured()) {
            return response()->json(['configured' => false, 'sessions' => []]);
        }

        try {
            return response()->json(['configured' => true, 'sessions' => $registrar->sessions()]);
        } catch (RegistrarException $e) {
            return response()->json(['configured' => true, 'sessions' => [], 'code' => 'registrar_error', 'message' => $e->getMessage()], 502);
        }
    }

    public function sync(Request $request, Election $election, RegistrarClient $registrar, VoterImporter $importer): JsonResponse
    {
        $data = $request->validate([
            'session_id' => ['required', 'integer', 'min:1'],
            'dry_run' => ['sometimes', 'boolean'],
        ]);
        $dryRun = (bool) ($data['dry_run'] ?? false);

        // Refus immédiat si le scrutin n'est plus un brouillon, avant même d'appeler le registrar.
        if ($election->status !== Election::STATUS_DRAFT) {
            return response()->json([
                'code' => 'locked',
                'message' => 'La liste électorale est figée depuis l\'ouverture du scrutin.',
            ], 409);
        }

        try {
            $export = $registrar->voters((int) $data['session_id']);
            $result = $importer->syncFromRows($election, $export['voters'], $export['session'], $dryRun);
        } catch (RegistrarException $e) {
            return response()->json(['code' => 'registrar_error', 'message' => $e->getMessage()], 502);
        } catch (InvalidArgumentException $e) {
            return response()->json(['code' => 'sync_refused', 'message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $result + [
            'dry_run' => $dryRun,
            'session' => $export['session'],
            // Inscrits qui n'ont pas d'adresse @zurcher.edu.mg : ils ne pourront pas se connecter.
            'without_email' => $export['counts']['without_email'],
            'enrolled' => $export['counts']['enrolled'],
        ]]);
    }
}
