<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;

/** Journal d'audit en lecture seule : aucune route ne permet d'y écrire, de modifier ou de supprimer. */
class AuditController extends Controller
{
    public function index(): JsonResponse
    {
        $page = AuditLog::query()->orderByDesc('id')->paginate(50);

        return response()->json([
            'data' => collect($page->items())->map(fn (AuditLog $l) => [
                'id' => $l->id,
                'event' => $l->event,
                'election_id' => $l->election_id,
                'payload' => $l->payload,
                'hash' => $l->hash,
                'created_at' => $l->created_at->toIso8601ZuluString(),
            ]),
            'meta' => ['page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function verify(): JsonResponse
    {
        $broken = AuditLog::verifyChain();

        return response()->json(['intact' => $broken === null, 'broken_at' => $broken]);
    }
}
