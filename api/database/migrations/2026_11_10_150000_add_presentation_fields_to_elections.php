<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            // Contenu de la page d'accueil, rédigé par la commission (rien n'est écrit en dur dans l'application).
            $table->text('sa_about')->nullable()->after('question');
            $table->string('candidate_title')->nullable()->after('candidate_name');   // ex. « Étudiant en 3e année de … »
            $table->text('candidate_program')->nullable()->after('candidate_bio');    // un engagement par ligne
        });
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn(['sa_about', 'candidate_title', 'candidate_program']);
        });
    }
};
