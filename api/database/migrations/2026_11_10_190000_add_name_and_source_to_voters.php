<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('voters', function (Blueprint $table) {
            // Nom affiché dans l'administration (saisi à la main ou fourni par un CSV) : aide à dépanner un étudiant.
            $table->string('name')->nullable()->after('email');
            // D'où vient l'électeur : csv, registrar ou manual. Un électeur « manual » survit aux imports et
            // synchronisations, qui ne remplacent que les autres.
            $table->string('source', 16)->default('csv')->after('student_id');
        });
    }

    public function down(): void
    {
        Schema::table('voters', function (Blueprint $table) {
            $table->dropColumn(['name', 'source']);
        });
    }
};
