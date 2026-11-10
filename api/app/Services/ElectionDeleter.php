<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Voter;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Suppression définitive de scrutins : le scrutin, sa liste électorale, ses bulletins et les sessions de vote ouvertes.
 *
 * C'est irréversible : le journal d'audit en garde la trace (compteurs, jamais d'adresse ni de choix) et survit à la
 * suppression. Tout se fait dans UNE transaction : ou bien tous les scrutins demandés sont supprimés, ou aucun.
 */
class ElectionDeleter
{
    /**
     * @param  Collection<int, Election>  $elections
     * @return list<array<string, mixed>> Un résumé par scrutin supprimé
     */
    public function delete(Collection $elections, int $userId): array
    {
        $summaries = [];
        $photos = [];

        DB::transaction(function () use ($elections, $userId, &$summaries, &$photos) {
            foreach ($elections as $election) {
                $voterIds = $election->voters()->pluck('id');

                $summary = [
                    'election_id' => $election->id,
                    'title' => $election->title,
                    'status' => $election->status,
                    'registered' => $voterIds->count(),
                    'voted' => $election->voters()->where('has_voted', true)->count(),
                    'ballots' => $election->ballots()->count(),
                    'user_id' => $userId,
                ];

                // Les sessions de vote ouvertes par ces électeurs ne doivent plus rien ouvrir.
                foreach ($voterIds->chunk(1000) as $chunk) {
                    DB::table('personal_access_tokens')
                        ->where('tokenable_type', Voter::class)
                        ->whereIn('tokenable_id', $chunk->all())
                        ->delete();
                }

                if ($election->candidate_photo) {
                    $photos[] = $election->candidate_photo;
                }

                $election->delete(); // supprime en cascade la liste électorale et les bulletins

                // Le journal n'a aucune clé étrangère vers les scrutins (voir la migration detach_audit_logs) : cette entrée,
                // comme toutes les anciennes du même scrutin, garde son identifiant et la chaîne d'empreintes reste intacte.
                AuditLog::record('election_deleted', $election->id, $summary);
                $summaries[] = $summary;
            }
        });

        // Les fichiers ne sont effacés qu'une fois la transaction validée.
        foreach ($photos as $photo) {
            Storage::disk('public')->delete($photo);
        }

        return $summaries;
    }
}
