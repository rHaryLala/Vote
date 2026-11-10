<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('elections', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->text('question');
            $table->string('candidate_name');
            $table->string('candidate_photo')->nullable();
            $table->text('candidate_bio')->nullable();
            $table->dateTime('opens_at');
            $table->dateTime('closes_at');
            // draft -> open -> closed. L'ouverture réelle dépend aussi de la fenêtre opens_at/closes_at.
            $table->string('status', 16)->default('draft');
            // Règle d'acceptation : Oui > 50 % des suffrages exprimés.
            // Par défaut les votes blancs ne sont pas des suffrages exprimés.
            $table->boolean('blank_counts_as_expressed')->default(false);
            // Participation minimale (en % des inscrits) ; null = pas de quorum.
            $table->unsignedTinyInteger('quorum_percent')->nullable();
            $table->boolean('results_published')->default(false);
            $table->timestamps();
        });

        // Liste électorale : QUI peut voter, et s'il a déjà voté. Aucun lien avec le contenu du bulletin.
        Schema::create('voters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('election_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->string('student_id', 64)->nullable();
            $table->boolean('has_voted')->default(false);
            $table->timestamps();

            $table->unique(['election_id', 'email']);
        });

        // Urne : CE qui a été voté. Volontairement sans voter_id, sans created_at/updated_at
        // et avec une clé primaire aléatoire (non ordonnée) : rien ne permet de relier un bulletin
        // à un électeur, ni par l'identité, ni par l'ordre d'insertion, ni par l'heure.
        Schema::create('ballots', function (Blueprint $table) {
            $table->char('id', 32)->primary();
            $table->foreignId('election_id')->constrained()->cascadeOnDelete();
            $table->string('choice', 8);
            // Hachage SHA-256 d'un secret généré par l'appareil de l'électeur : preuve de vote vérifiable
            // sans que le serveur sache à qui appartient le bulletin.
            $table->char('receipt_hash', 64);

            $table->unique(['election_id', 'receipt_hash']);
            $table->index(['election_id', 'choice']);
        });

        // Journal d'audit chaîné par hachage (toute modification a posteriori casse la chaîne).
        // Il contient des événements administratifs et de participation, jamais le choix ni l'id du bulletin.
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('election_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event', 64);
            // text et non json : le type JSON de MySQL réordonne les clés et casserait le hachage.
            $table->text('payload')->nullable();
            $table->char('prev_hash', 64)->nullable();
            $table->char('hash', 64);
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('ballots');
        Schema::dropIfExists('voters');
        Schema::dropIfExists('elections');
    }
};
