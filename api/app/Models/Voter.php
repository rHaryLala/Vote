<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Un électeur inscrit sur la liste d'un scrutin.
 * Ce modèle sait SI l'électeur a voté, jamais POUR QUOI il a voté.
 */
class Voter extends Authenticatable
{
    use HasApiTokens;

    public const SOURCE_CSV = 'csv';

    public const SOURCE_REGISTRAR = 'registrar';

    public const SOURCE_MANUAL = 'manual';

    protected $guarded = [];

    protected $hidden = ['student_id'];

    protected function casts(): array
    {
        return ['has_voted' => 'boolean'];
    }

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    /**
     * La commission peut-elle retirer cet électeur ?
     * - brouillon : n'importe lequel ;
     * - vote ouvert : seulement un ajout MANUEL qui n'a pas encore voté (annuler une erreur) — jamais un électeur
     *   venu du registrar ou d'un CSV, ni quelqu'un qui a déjà voté (le décompte des inscrits doit rester cohérent) ;
     * - scrutin clos : personne.
     */
    public function canBeRemoved(Election $election): bool
    {
        return match ($election->status) {
            Election::STATUS_DRAFT => true,
            Election::STATUS_OPEN => $this->source === self::SOURCE_MANUAL && ! $this->has_voted,
            default => false,
        };
    }
}
