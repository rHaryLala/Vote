<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            // Synchronisation automatique de la liste électorale avec une session du registrar (brouillon seulement).
            $table->boolean('registrar_auto_sync')->default(false)->after('quorum_percent');
            $table->unsignedInteger('registrar_session_id')->nullable()->after('registrar_auto_sync');
            $table->timestamp('registrar_synced_at')->nullable()->after('registrar_session_id');
            $table->string('registrar_sync_error', 500)->nullable()->after('registrar_synced_at');
        });
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn(['registrar_auto_sync', 'registrar_session_id', 'registrar_synced_at', 'registrar_sync_error']);
        });
    }
};
