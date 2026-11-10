<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Voter;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Constitue la liste électorale d'un scrutin en brouillon, depuis un CSV du registrar (import) ou directement
 * depuis le registrar (synchronisation). Les deux voies partagent les MÊMES règles de validation.
 *
 * Les électeurs ajoutés MANUELLEMENT par la commission sont toujours conservés : un import ou une synchronisation
 * ne remplace que les électeurs venus d'un CSV ou du registrar.
 */
class VoterImporter
{
    /**
     * Import d'un CSV (colonnes : email, et facultativement student_id et name).
     *
     * @return array{valid: int, invalid: int, duplicate: int, added: int, removed: int, unchanged: int, manual: int, total: int}
     *
     * @throws InvalidArgumentException si le scrutin n'est pas en brouillon ou si le fichier est inexploitable
     */
    public function import(Election $election, string $path, bool $dryRun = false): array
    {
        $this->assertDraft($election);
        if (! is_readable($path)) {
            throw new InvalidArgumentException("Fichier illisible : {$path}");
        }

        $handle = fopen($path, 'rb');
        $first = (string) fgets($handle);
        rewind($handle);
        $delimiter = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';

        $header = fgetcsv($handle, 0, $delimiter) ?: [];
        $header = array_map(fn ($h) => strtolower(trim((string) preg_replace('/^\xEF\xBB\xBF/', '', (string) $h))), $header);
        $emailCol = array_search('email', $header, true);
        $idCol = array_search('student_id', $header, true);
        $nameCol = array_search('name', $header, true);
        if ($emailCol === false) {
            fclose($handle);
            throw new InvalidArgumentException("Colonne « email » absente de l'en-tête du CSV.");
        }

        $lines = [];
        while (($line = fgetcsv($handle, 0, $delimiter)) !== false) {
            $lines[] = [
                'email' => (string) ($line[$emailCol] ?? ''),
                'student_id' => $idCol !== false ? (string) ($line[$idCol] ?? '') : null,
                'name' => $nameCol !== false ? (string) ($line[$nameCol] ?? '') : null,
            ];
        }
        fclose($handle);

        return $this->apply($election, $lines, $dryRun, Voter::SOURCE_CSV, 'voters_imported', []);
    }

    /**
     * Synchronisation depuis le registrar : mêmes règles que l'import CSV.
     *
     * @param  iterable<array{email: mixed, student_id?: mixed, name?: mixed}>  $voters
     * @param  array<string, mixed>  $source  Session du registrar (consignée au journal d'audit)
     * @return array{valid: int, invalid: int, duplicate: int, added: int, removed: int, unchanged: int, manual: int, total: int}
     */
    public function syncFromRows(Election $election, iterable $voters, array $source, bool $dryRun = false, array $auditExtra = []): array
    {
        $this->assertDraft($election);

        return $this->apply($election, $voters, $dryRun, Voter::SOURCE_REGISTRAR, 'voters_synced', ['source' => 'registrar', 'session' => $source] + $auditExtra);
    }

    private function assertDraft(Election $election): void
    {
        if ($election->status !== Election::STATUS_DRAFT) {
            throw new InvalidArgumentException("La liste électorale ne peut être modifiée que pour un scrutin en brouillon (statut actuel : {$election->status}).");
        }
    }

    /**
     * @param  iterable<array{email: mixed, student_id?: mixed, name?: mixed}>  $lines
     * @param  array<string, mixed>  $auditContext
     * @return array{valid: int, invalid: int, duplicate: int, added: int, removed: int, unchanged: int, manual: int, total: int}
     */
    private function apply(Election $election, iterable $lines, bool $dryRun, string $source, string $auditEvent, array $auditContext): array
    {
        $domain = strtolower((string) config('vote.google.allowed_domain'));
        $rows = [];
        $invalid = 0;
        $duplicate = 0;

        foreach ($lines as $line) {
            $email = strtolower(trim((string) ($line['email'] ?? '')));
            if (! filter_var($email, FILTER_VALIDATE_EMAIL) || ! str_ends_with($email, '@'.$domain)) {
                $invalid++;

                continue;
            }
            if (isset($rows[$email])) {
                $duplicate++;

                continue;
            }
            $rows[$email] = [
                'election_id' => $election->id,
                'email' => $email,
                'name' => mb_substr(trim((string) ($line['name'] ?? '')), 0, 255) ?: null,
                'student_id' => trim((string) ($line['student_id'] ?? '')) ?: null,
                'source' => $source,
                'has_voted' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        // Les ajouts manuels sont intouchables : une adresse déjà ajoutée à la main n'est ni remplacée ni dupliquée.
        $manual = $election->voters()->where('source', Voter::SOURCE_MANUAL)->pluck('email')->all();
        $toInsert = array_diff_key($rows, array_flip($manual));

        // Ce que l'opération ajoute, retire ou laisse tel quel — parmi les électeurs NON manuels seulement.
        $current = $election->voters()->where('source', '!=', Voter::SOURCE_MANUAL)->pluck('email')->all();
        $incoming = array_keys($toInsert);
        $added = count(array_diff($incoming, $current));
        $removed = count(array_diff($current, $incoming));

        if (! $dryRun) {
            DB::transaction(function () use ($election, $toInsert, $auditEvent, $auditContext, $added, $removed, $manual) {
                $election->voters()->where('source', '!=', Voter::SOURCE_MANUAL)->delete();
                foreach (array_chunk(array_values($toInsert), 500) as $chunk) {
                    DB::table('voters')->insert($chunk);
                }
                AuditLog::record($auditEvent, $election->id, $auditContext + [
                    'count' => count($toInsert), 'added' => $added, 'removed' => $removed, 'manual_kept' => count($manual),
                ]);
            });
        }

        return [
            'valid' => count($rows),
            'invalid' => $invalid,
            'duplicate' => $duplicate,
            'added' => $added,
            'removed' => $removed,
            'unchanged' => count($toInsert) - $added,
            'manual' => count($manual),
            'total' => count($toInsert) + count($manual),
        ];
    }
}
