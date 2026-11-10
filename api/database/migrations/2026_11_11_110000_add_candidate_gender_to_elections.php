<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            // « m » ou « f » : sert à accorder le verdict (« élu » / « élue »). Les scrutins existants restent au masculin.
            $table->string('candidate_gender', 1)->default('m')->after('candidate_name');
        });
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('candidate_gender');
        });
    }
};
