<?php

namespace App\Console\Commands;

use App\Models\Election;
use Illuminate\Console\Command;

class CloseExpiredElections extends Command
{
    protected $signature = 'elections:close-expired';

    protected $description = "Clôt automatiquement les scrutins ouverts dont l'heure de clôture est passée";

    public function handle(): int
    {
        Election::query()
            ->where('status', Election::STATUS_OPEN)
            ->where('closes_at', '<=', now())
            ->each(function (Election $election) {
                $election->finish(automatic: true);
                $this->info("Scrutin #{$election->id} clos.");
            });

        return self::SUCCESS;
    }
}
