<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class CreateCommissionUser extends Command
{
    protected $signature = 'commission:user {email : Adresse de connexion} {--name= : Nom affiché} {--password= : Mot de passe (généré si absent)}';

    protected $description = "Crée (ou réinitialise) un compte de la commission électorale pour l'administration";

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Adresse invalide.');

            return self::FAILURE;
        }

        $password = (string) ($this->option('password') ?: Str::password(16, symbols: false));
        if (mb_strlen($password) < 10) {
            $this->error('Mot de passe trop court (10 caractères au moins).');

            return self::FAILURE;
        }

        $user = User::query()->updateOrCreate(
            ['email' => $email],
            ['name' => $this->option('name') ?: $email, 'password' => $password],
        );
        // Un mot de passe réinitialisé invalide les sessions ouvertes.
        $user->tokens()->delete();

        $this->info("Compte de la commission prêt : {$email}");
        if (! $this->option('password')) {
            $this->line("Mot de passe généré (à transmettre en main propre) : {$password}");
        }

        return self::SUCCESS;
    }
}
