<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Un bulletin dans l'urne. Aucune relation vers Voter, aucun horodatage, identifiant aléatoire.
 */
class Ballot extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = [];
}
