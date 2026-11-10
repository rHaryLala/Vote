<?php

namespace App\Console\Commands;

use App\Models\Election;
use App\Services\VoterImporter;
use Illuminate\Console\Command;
use InvalidArgumentException;

class ImportVoters extends Command
{
    protected $signature = 'voters:import {election : Identifiant du scrutin} {file : CSV exporté du registrar (email,student_id)}
                            {--dry-run : Compte sans rien écrire}';

    protected $description = 'Importe la liste électorale (étudiants inscrits à la session active) depuis un CSV du registrar';

    public function handle(VoterImporter $importer): int
    {
        $election = Election::find($this->argument('election'));
        if (! $election) {
            $this->error('Scrutin introuvable.');

            return self::FAILURE;
        }

        try {
            $result = $importer->import($election, $this->argument('file'), (bool) $this->option('dry-run'));
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->info("{$result['valid']} électeurs valides, {$result['invalid']} ignorés (adresse invalide ou hors domaine), {$result['duplicate']} doublons.");
        $this->comment($this->option('dry-run') ? "Simulation : rien n'a été écrit." : 'Liste électorale importée.');

        return self::SUCCESS;
    }
}
