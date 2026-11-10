<?php

namespace App\Services;

use App\Models\Election;
use App\Models\Voter;
use InvalidArgumentException;

/**
 * Synchronisation AUTOMATIQUE de la liste électorale avec le registrar, tant que le scrutin est en brouillon.
 *
 * Elle est lancée par le planificateur (elections:sync-registrar) et une dernière fois à l'ouverture du scrutin.
 * Contrairement à la synchronisation manuelle (où la commission voit un aperçu), personne ne regarde : deux garde-fous
 * empêchent donc qu'une erreur du registrar vide ou massacre la liste. Dans ces cas, la liste n'est PAS touchée,
 * l'erreur est affichée à la commission, et la synchronisation manuelle (avec aperçu) reste possible.
 *
 *  1. un export sans aucun électeur est refusé ;
 *  2. un retrait de plus de 20 % de la liste (et de plus de 10 personnes) est refusé.
 *
 * Aucune écriture, ni entrée au journal d'audit, quand rien ne change : pas de bruit toutes les 15 minutes.
 */
class RegistrarAutoSync
{
    public const MAX_REMOVED_RATIO = 0.2;

    public const MIN_REMOVED_ALLOWED = 10;

    public function __construct(private RegistrarClient $registrar, private VoterImporter $importer) {}

    /**
     * @param  bool  $force  Première reprise voulue par la commission (après aperçu) : sans garde-fou de variation
     * @return array{status: 'skipped'|'unchanged'|'synced'|'error', message: string|null, added: int, removed: int}
     */
    public function run(Election $election, bool $force = false): array
    {
        $none = ['added' => 0, 'removed' => 0];

        if ($election->status !== Election::STATUS_DRAFT || ! $election->registrar_auto_sync || ! $election->registrar_session_id) {
            return ['status' => 'skipped', 'message' => null] + $none;
        }

        try {
            $export = RegistrarClient::forLevels(
                $this->registrar->voters((int) $election->registrar_session_id),
                $election->registrar_levels ?: 'all',
            );

            // Simulation d'abord : on regarde ce que ça changerait avant de toucher à la liste.
            $preview = $this->importer->syncFromRows($election, $export['voters'], $export['session'], dryRun: true);
            $incoming = $preview['total'] - $preview['manual'];
            if ($incoming <= 0) {
                throw new InvalidArgumentException("Le registrar ne renvoie aucun électeur pour cette session : la liste n'a pas été modifiée.");
            }

            $current = $election->voters()->where('source', '!=', Voter::SOURCE_MANUAL)->count();
            $allowed = max(self::MIN_REMOVED_ALLOWED, (int) ceil($current * self::MAX_REMOVED_RATIO));
            if (! $force && $preview['removed'] > $allowed) {
                throw new InvalidArgumentException(
                    "Le registrar retirerait {$preview['removed']} électeurs sur {$current} : variation inhabituelle, la liste n'a pas été modifiée. ".
                    'Vérifiez la session choisie, puis utilisez « Synchroniser » (avec aperçu) pour confirmer.',
                );
            }

            $changed = $preview['added'] > 0 || $preview['removed'] > 0;
            if ($changed) {
                $this->importer->syncFromRows($election, $export['voters'], $export['session'], auditExtra: ['trigger' => 'auto', 'levels' => $election->registrar_levels ?: 'all']);
            }

            $election->forceFill(['registrar_synced_at' => now(), 'registrar_sync_error' => null])->save();

            return [
                'status' => $changed ? 'synced' : 'unchanged',
                'message' => null,
                'added' => $preview['added'],
                'removed' => $preview['removed'],
            ];
        } catch (RegistrarException|InvalidArgumentException $e) {
            $message = mb_substr($e->getMessage(), 0, 500);
            $election->forceFill(['registrar_sync_error' => $message])->save();

            return ['status' => 'error', 'message' => $message] + $none;
        }
    }
}
