<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Election;
use App\Services\RegistrarAutoSync;
use App\Services\RegistrarClient;
use App\Services\RegistrarException;
use App\Services\VoterImporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
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

    /**
     * Active ou désactive la synchronisation automatique (toutes les 15 minutes, tant que le scrutin est en brouillon).
     * À l'activation, une première synchronisation est faite tout de suite, pour que la commission voie le résultat.
     */
    public function auto(Request $request, Election $election, RegistrarAutoSync $auto): JsonResponse
    {
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'session_id' => ['required_if:enabled,true', 'nullable', 'integer', 'min:1'],
            'levels' => ['sometimes', Rule::in(RegistrarClient::LEVELS)],
        ]);

        if ($election->status !== Election::STATUS_DRAFT) {
            return response()->json(['code' => 'locked', 'message' => 'La liste électorale est figée depuis l\'ouverture du scrutin.'], 409);
        }

        $enabled = (bool) $data['enabled'];
        $election->forceFill([
            'registrar_auto_sync' => $enabled,
            'registrar_session_id' => $enabled ? (int) $data['session_id'] : $election->registrar_session_id,
            'registrar_levels' => $enabled ? ($data['levels'] ?? 'all') : $election->registrar_levels,
            'registrar_sync_error' => null,
        ])->save();

        // Réglage choisi par la commission après un aperçu : le garde-fou de variation ne s'applique pas à cette première reprise.
        $result = $enabled ? $auto->run($election, force: true) : ['status' => 'skipped', 'message' => null, 'added' => 0, 'removed' => 0];

        return response()->json(['data' => ElectionController::present($election->fresh()), 'sync' => $result]);
    }

    public function sync(Request $request, Election $election, RegistrarClient $registrar, VoterImporter $importer): JsonResponse
    {
        $data = $request->validate([
            'session_id' => ['required', 'integer', 'min:1'],
            'dry_run' => ['sometimes', 'boolean'],
            'levels' => ['sometimes', Rule::in(RegistrarClient::LEVELS)],
        ]);
        $levels = $data['levels'] ?? 'all';
        $dryRun = (bool) ($data['dry_run'] ?? false);

        // Refus immédiat si le scrutin n'est plus un brouillon, avant même d'appeler le registrar.
        if ($election->status !== Election::STATUS_DRAFT) {
            return response()->json([
                'code' => 'locked',
                'message' => 'La liste électorale est figée depuis l\'ouverture du scrutin.',
            ], 409);
        }

        try {
            $export = RegistrarClient::forLevels($registrar->voters((int) $data['session_id']), $levels);
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
            'without_email_list' => $export['without_email'],
            'levels' => $levels,
            'by_level' => $export['by_level'],
            'enrolled' => $export['counts']['enrolled'],
        ]]);
    }
}
