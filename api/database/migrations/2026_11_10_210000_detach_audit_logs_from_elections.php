<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Le journal d'audit est une PREUVE chaînée par empreintes : l'identifiant du scrutin fait partie de l'empreinte de
        // chaque entrée. Avec « ON DELETE SET NULL », supprimer un scrutin remettait ce champ à NULL dans les anciennes
        // entrées et CASSAIT la chaîne. On retire donc la contrainte : la colonne reste (indexée), l'entrée n'est jamais
        // modifiée, et peut désigner un scrutin qui n'existe plus (c'est voulu : « scrutin n° 3, supprimé »).
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropForeign(['election_id']);
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->foreign('election_id')->references('id')->on('elections')->nullOnDelete();
        });
    }
};
