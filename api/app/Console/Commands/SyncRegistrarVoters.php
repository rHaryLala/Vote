<?php

namespace App\Console\Commands;

use App\Models\Election;
use App\Services\RegistrarAutoSync;
use Illuminate\Console\Command;

class SyncRegistrarVoters extends Command
{
    protected $signature = 'elections:sync-registrar';

    protected $description = 'Synchronise la liste électorale des scrutins en brouillon dont la synchronisation automatique est activée';

    public function handle(RegistrarAutoSync $auto): int
    {
        $failed = false;

        Election::query()
            ->where('status', Election::STATUS_DRAFT)
            ->where('registrar_auto_sync', true)
            ->whereNotNull('registrar_session_id')
            ->each(function (Election $election) use ($auto, &$failed) {
                $r = $auto->run($election);
                if ($r['status'] === 'synced') {
                    $this->info("Scrutin #{$election->id} : +{$r['added']} / −{$r['removed']}.");
                } elseif ($r['status'] === 'unchanged') {
                    $this->line("Scrutin #{$election->id} : à jour.");
                } elseif ($r['status'] === 'error') {
                    $this->error("Scrutin #{$election->id} : {$r['message']}");
                    $failed = true;
                }
            });

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
