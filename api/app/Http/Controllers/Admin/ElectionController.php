<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Election;
use App\Services\ElectionDeleter;
use App\Services\RegistrarAutoSync;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

class ElectionController extends Controller
{
    public function index(): JsonResponse
    {
        $elections = Election::query()
            ->withCount(['voters', 'voters as voted_count' => fn ($q) => $q->where('has_voted', true)])
            ->orderByDesc('opens_at')
            ->get()
            ->map(fn (Election $e) => [
                'id' => $e->id,
                'title' => $e->title,
                'candidate_name' => $e->candidate_name,
                'status' => $e->status,
                'is_open' => $e->isOpen(),
                'opens_at' => $e->opens_at->toIso8601ZuluString(),
                'closes_at' => $e->closes_at->toIso8601ZuluString(),
                'results_published' => $e->results_published,
                'public_visible' => $e->isVisible(),
                'voters_count' => $e->voters_count,
                'voted_count' => $e->voted_count,
            ]);

        return response()->json(['data' => $elections]);
    }

    public function show(Election $election): JsonResponse
    {
        return response()->json(['data' => self::present($election)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, creating: true);
        $election = Election::create($data + ['status' => Election::STATUS_DRAFT]);
        AuditLog::record('election_created', $election->id, ['user_id' => $request->user()->id]);

        return response()->json(['data' => self::present($election)], 201);
    }

    public function update(Request $request, Election $election): JsonResponse
    {
        $data = $this->validated($request, creating: false);

        return $this->guard(function () use ($election, $data) {
            $election->fill($data)->save();

            return response()->json(['data' => self::present($election->fresh())]);
        });
    }

    /**
     * Suppression d'un ou de plusieurs scrutins, quel que soit leur statut. IRRÉVERSIBLE : la liste électorale et les
     * bulletins sont effacés. Dès qu'un scrutin n'est plus un brouillon, la commission doit taper « SUPPRIMER ».
     * Tout ou rien : si un identifiant n'existe plus, rien n'est supprimé.
     */
    public function bulkDestroy(Request $request, ElectionDeleter $deleter): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:50'],
            'ids.*' => ['integer', 'distinct'],
            'confirmation' => ['nullable', 'string', 'max:50'],
        ]);

        $elections = Election::query()->whereIn('id', $data['ids'])->get();
        if ($elections->count() !== count($data['ids'])) {
            return response()->json(['code' => 'not_found', 'message' => "Un des scrutins n'existe plus : actualisez la liste. Rien n'a été supprimé."], 404);
        }

        if ($elections->contains(fn (Election $e) => $e->status !== Election::STATUS_DRAFT)
            && trim((string) ($data['confirmation'] ?? '')) !== 'SUPPRIMER') {
            return response()->json([
                'message' => 'Tapez SUPPRIMER pour confirmer : un scrutin ouvert ou clos, avec ses bulletins, sera effacé définitivement.',
                'errors' => ['confirmation' => ['Tapez SUPPRIMER pour confirmer.']],
            ], 422);
        }

        $summaries = $deleter->delete($elections, $request->user()->id);

        return response()->json(['data' => [
            'deleted' => count($summaries),
            'ballots' => array_sum(array_column($summaries, 'ballots')),
        ]]);
    }

    public function photo(Request $request, Election $election): JsonResponse
    {
        $request->validate(['photo' => ['required', 'image', 'max:4096']]);

        return $this->guard(function () use ($request, $election) {
            $old = $election->candidate_photo;
            $path = $request->file('photo')->store('candidates', 'public');
            try {
                $election->update(['candidate_photo' => $path]);
            } catch (DomainException $e) {
                Storage::disk('public')->delete($path);
                throw $e;
            }
            if ($old) {
                Storage::disk('public')->delete($old);
            }

            return response()->json(['data' => self::present($election->fresh())]);
        });
    }

    public function open(Election $election, RegistrarAutoSync $auto): JsonResponse
    {
        return $this->guard(function () use ($election, $auto) {
            // La liste se fige à l'ouverture : dernière reprise automatique du registrar juste avant (si activée).
            // Une erreur n'empêche pas d'ouvrir (la commission en est avertie), la liste reste celle de la dernière synchronisation.
            $sync = $auto->run($election);
            $election->start();

            return response()->json(['data' => self::present($election->fresh()), 'sync' => $sync]);
        });
    }

    public function close(Election $election): JsonResponse
    {
        return $this->guard(function () use ($election) {
            $election->finish();

            return response()->json(['data' => self::present($election->fresh())]);
        });
    }

    public function publish(Election $election): JsonResponse
    {
        return $this->guard(function () use ($election) {
            $election->publishResults();

            return response()->json(['data' => self::present($election->fresh())]);
        });
    }

    /** Les règles métier (verrouillage, transitions) lèvent DomainException : on la renvoie en 409 lisible. */
    private function guard(callable $action): JsonResponse
    {
        try {
            return $action();
        } catch (DomainException $e) {
            return response()->json(['code' => 'locked', 'message' => $e->getMessage()], 409);
        }
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'title' => [$req, 'string', 'max:255'],
            'question' => [$req, 'string', 'max:2000'],
            'candidate_name' => [$req, 'string', 'max:255'],
            'candidate_title' => ['sometimes', 'nullable', 'string', 'max:255'],
            'candidate_bio' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'candidate_program' => ['sometimes', 'nullable', 'string', 'max:5000'],
            // Dates ISO 8601 AVEC fuseau (le front envoie l'heure de Madagascar, « +03:00 ») : stockées en UTC.
            'opens_at' => [$req, 'date'],
            'closes_at' => [$req, 'date'],
            'blank_counts_as_expressed' => ['sometimes', 'boolean'],
            'quorum_percent' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        foreach (['opens_at', 'closes_at'] as $field) {
            if (isset($data[$field])) {
                $data[$field] = Carbon::parse($data[$field])->utc();
            }
        }
        $opens = $data['opens_at'] ?? $request->route('election')?->opens_at;
        $closes = $data['closes_at'] ?? $request->route('election')?->closes_at;
        if ($opens && $closes && $closes->lessThanOrEqualTo($opens)) {
            abort(response()->json([
                'message' => "La clôture doit être postérieure à l'ouverture.",
                'errors' => ['closes_at' => ["La clôture doit être postérieure à l'ouverture."]],
            ], 422));
        }

        return $data;
    }

    /** @return array<string, mixed> */
    public static function present(Election $election): array
    {
        $registered = $election->voters()->count();
        $voted = $election->voters()->where('has_voted', true)->count();

        return [
            'id' => $election->id,
            'title' => $election->title,
            'question' => $election->question,
            'candidate_name' => $election->candidate_name,
            'candidate_title' => $election->candidate_title,
            'candidate_bio' => $election->candidate_bio,
            'candidate_program' => $election->candidate_program,
            'candidate_photo_url' => $election->candidatePhotoUrl(),
            'opens_at' => $election->opens_at->toIso8601ZuluString(),
            'closes_at' => $election->closes_at->toIso8601ZuluString(),
            'status' => $election->status,
            'is_open' => $election->isOpen(),
            'blank_counts_as_expressed' => $election->blank_counts_as_expressed,
            'quorum_percent' => $election->quorum_percent,
            'results_published' => $election->results_published,
            'public_visible' => $election->isVisible(),
            'registrar' => [
                'auto_sync' => (bool) $election->registrar_auto_sync,
                'session_id' => $election->registrar_session_id,
                'levels' => $election->registrar_levels ?: 'all',
                'synced_at' => $election->registrar_synced_at?->toIso8601ZuluString(),
                'error' => $election->registrar_sync_error,
            ],
            'stats' => [
                'registered' => $registered,
                'voted' => $voted,
                'turnout_percent' => $registered > 0 ? round($voted / $registered * 100, 1) : 0,
            ],
            // Le décompte n'existe pour la commission qu'une fois le scrutin clos : aucune tendance pendant le vote.
            'tally' => $election->status === Election::STATUS_CLOSED ? $election->tally() : null,
            'locks' => [
                'content' => $election->status !== Election::STATUS_DRAFT,
                'dates' => $election->status === Election::STATUS_CLOSED,
                'voters' => $election->status !== Election::STATUS_DRAFT,
                // Ajout / retrait manuel d'un électeur : possible jusqu'à la clôture (journalisé).
                'voters_manual' => $election->status !== Election::STATUS_CLOSED,
            ],
        ];
    }
}
