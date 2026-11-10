<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Textes du site modifiés par la commission (les défauts sont dans resources/content/pages.json).
        Schema::create('site_contents', function (Blueprint $table) {
            $table->string('page', 32)->primary();
            $table->text('data');
            $table->timestamp('updated_at')->nullable();
        });

        // La présentation de la SA devient un texte du site (modifiable à tout moment), plus un champ du scrutin.
        if (Schema::hasColumn('elections', 'sa_about')) {
            Schema::table('elections', fn (Blueprint $table) => $table->dropColumn('sa_about'));
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('site_contents');
        Schema::table('elections', fn (Blueprint $table) => $table->text('sa_about')->nullable()->after('question'));
    }
};
