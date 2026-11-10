<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class AuditLog extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['payload' => 'array', 'created_at' => 'datetime'];
    }

    /**
     * Ajoute un événement à la chaîne. Chaque entrée porte le hachage de la précédente :
     * modifier ou supprimer une ligne après coup rompt la chaîne (voir verifyChain).
     *
     * Ne jamais y mettre le choix d'un bulletin ni son identifiant.
     */
    public static function record(string $event, ?int $electionId = null, array $payload = []): self
    {
        return DB::transaction(function () use ($event, $electionId, $payload) {
            $previous = static::query()->orderByDesc('id')->lockForUpdate()->first();
            $createdAt = now();

            $entry = new static([
                'election_id' => $electionId,
                'event' => $event,
                'payload' => $payload ?: null,
                'prev_hash' => $previous?->hash,
            ]);
            $entry->created_at = $createdAt;
            $entry->hash = static::computeHash($entry);
            $entry->save();

            return $entry;
        });
    }

    public static function computeHash(self $entry): string
    {
        return hash('sha256', implode('|', [
            $entry->prev_hash ?? '',
            $entry->election_id ?? '',
            $entry->event,
            json_encode($entry->payload ?? null),
            $entry->created_at->format('Y-m-d H:i:s'),
        ]));
    }

    /** Vérifie toute la chaîne ; renvoie l'id de la première ligne incohérente, ou null si intègre. */
    public static function verifyChain(): ?int
    {
        $prevHash = null;
        foreach (static::query()->orderBy('id')->cursor() as $entry) {
            if ($entry->prev_hash !== $prevHash || $entry->hash !== static::computeHash($entry)) {
                return $entry->id;
            }
            $prevHash = $entry->hash;
        }

        return null;
    }
}
