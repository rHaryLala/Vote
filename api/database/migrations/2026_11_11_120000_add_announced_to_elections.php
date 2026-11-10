<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            // Brouillon « annoncé » : le candidat et le compte à rebours sont visibles sur le site, sans que le vote soit ouvert.
            $table->boolean('announced')->default(false)->after('results_published');
        });
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('announced');
        });
    }
};
