<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            // Niveaux repris du registrar : « all » (Licence et Master), « licence » ou « master ».
            $table->string('registrar_levels', 10)->default('all')->after('registrar_session_id');
        });
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('registrar_levels');
        });
    }
};
