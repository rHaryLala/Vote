<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Voter;
use App\Services\VoterImporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

/**
 * Liste électorale. Elle indique SI un étudiant a voté (pour le dépanner), jamais POUR QUOI.
 */
class VoterController extends Controller
{
    public function index(Request $request, Election $election): JsonResponse
    {
        $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'voted' => ['nullable', 'in:yes,no'],
        ]);

        $voters = $election->voters()
            ->when($request->string('search')->trim()->value(), function ($q, $s) {
                $q->where(fn ($w) => $w->where('email', 'like', "%{$s}%")
                    ->orWhere('name', 'like', "%{$s}%")
                    ->orWhere('student_id', 'like', "%{$s}%"));
            })
            ->when($request->input('voted'), fn ($q, $v) => $q->where('has_voted', $v === 'yes'))
            ->orderBy('email')
            ->paginate(25, ['id', 'email', 'name', 'student_id', 'source', 'has_voted']);

        return response()->json([
            'data' => collect($voters->items())->map(fn (Voter $v) => [
                'id' => $v->id,
                'email' => $v->email,
                'name' => $v->name,
                'student_id' => $v->student_id,
                'source' => $v->source,
                'has_voted' => (bool) $v->has_voted,
                'removable' => $v->canBeRemoved($election),
            ]),
            'meta' => ['page' => $voters->currentPage(), 'last_page' => $voters->lastPage(), 'total' => $voters->total()],
        ]);
    }

    /**
     * Ajout manuel d'un électeur (étudiant absent de la liste du registrar, inscription tardive…).
     * Possible tant que le scrutin n'est pas clos. Chaque ajout est inscrit au journal d'audit — jamais l'adresse
     * en clair, seulement une empreinte —, et l'électeur peut voter dès qu'il se connecte.
     */
    public function store(Request $request, Election $election): JsonResponse
    {
        if ($election->status === Election::STATUS_CLOSED) {
            return response()->json(['code' => 'locked', 'message' => 'Le scrutin est clos : la liste électorale ne peut plus changer.'], 409);
        }

        $data = $request->validate([
            'email' => ['required', 'string', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
            'student_id' => ['nullable', 'string', 'max:64'],
        ]);

        $email = strtolower(trim($data['email']));
        $domain = strtolower((string) config('vote.google.allowed_domain'));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || ! str_ends_with($email, '@'.$domain)) {
            return $this->invalid('email', "L'adresse doit être une adresse @{$domain} valide.");
        }
        $name = trim(preg_replace('/\s+/u', ' ', $data['name']) ?? '');
        if ($name === '') {
            return $this->invalid('name', 'Le nom est obligatoire.');
        }
        if ($election->voters()->where('email', $email)->exists()) {
            return $this->invalid('email', 'Cette adresse figure déjà sur la liste électorale.');
        }

        $voter = $election->voters()->create([
            'email' => $email,
            'name' => $name,
            'student_id' => trim((string) ($data['student_id'] ?? '')) ?: null,
            'source' => Voter::SOURCE_MANUAL,
            'has_voted' => false,
        ]);

        AuditLog::record('voter_added', $election->id, [
            'voter_id' => $voter->id,
            'user_id' => $request->user()->id,
            'email_sha256' => substr(hash('sha256', $email), 0, 16),
            'during_vote' => $election->status === Election::STATUS_OPEN,
        ]);

        return response()->json(['data' => $this->present($voter, $election)], 201);
    }

    /** Retrait d'un électeur : voir Voter::canBeRemoved pour les règles selon le statut du scrutin. */
    public function destroy(Request $request, Election $election, Voter $voter): JsonResponse
    {
        if ($voter->election_id !== $election->id) {
            abort(404);
        }
        if (! $voter->canBeRemoved($election)) {
            $message = match (true) {
                $election->status === Election::STATUS_CLOSED => 'Le scrutin est clos : la liste électorale ne peut plus changer.',
                $voter->has_voted => 'Cet électeur a déjà voté : il ne peut plus être retiré.',
                default => "Pendant le vote, seul un électeur ajouté manuellement (et qui n'a pas voté) peut être retiré.",
            };

            return response()->json(['code' => 'locked', 'message' => $message], 409);
        }

        $meta = [
            'voter_id' => $voter->id,
            'user_id' => $request->user()->id,
            'email_sha256' => substr(hash('sha256', $voter->email), 0, 16),
            'source' => $voter->source,
            'during_vote' => $election->status === Election::STATUS_OPEN,
        ];
        $voter->tokens()->delete(); // une session de vote ouverte par cet électeur ne doit plus fonctionner
        $voter->delete();
        AuditLog::record('voter_removed', $election->id, $meta);

        return response()->json(['status' => 'removed']);
    }

    public function import(Request $request, Election $election, VoterImporter $importer): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:5120', 'mimes:csv,txt'],
            'dry_run' => ['sometimes', 'boolean'],
        ]);

        // Le fichier contient des adresses d'étudiants : il n'est jamais conservé (fichier temporaire de la requête).
        try {
            $result = $importer->import($election, $request->file('file')->getRealPath(), $request->boolean('dry_run'));
        } catch (InvalidArgumentException $e) {
            return response()->json(['code' => 'import_refused', 'message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $result + ['dry_run' => $request->boolean('dry_run')]]);
    }

    /** @return array<string, mixed> */
    private function present(Voter $v, Election $election): array
    {
        return [
            'id' => $v->id,
            'email' => $v->email,
            'name' => $v->name,
            'student_id' => $v->student_id,
            'source' => $v->source,
            'has_voted' => (bool) $v->has_voted,
            'removable' => $v->canBeRemoved($election),
        ];
    }

    private function invalid(string $field, string $message): JsonResponse
    {
        return response()->json(['message' => $message, 'errors' => [$field => [$message]]], 422);
    }
}
