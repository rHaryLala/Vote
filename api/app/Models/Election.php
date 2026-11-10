<?php

namespace App\Models;

use DomainException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class Election extends Model
{
    public const STATUS_DRAFT = 'draft';

    public const STATUS_OPEN = 'open';

    public const STATUS_CLOSED = 'closed';

    protected $guarded = [];

    /** Champs figés dès que le scrutin n'est plus un brouillon : la question, le candidat et la règle ne changent pas en cours de vote. */
    private const FROZEN_AFTER_DRAFT = [
        'title', 'question', 'candidate_name', 'candidate_title', 'candidate_photo', 'candidate_bio',
        'candidate_program', 'blank_counts_as_expressed', 'quorum_percent',
    ];

    /**
     * Les dates restent modifiables tant que le scrutin n'est pas clos (ex. prolonger le vote) ; chaque changement
     * sur un scrutin ouvert est inscrit au journal d'audit. Une fois clos, elles sont figées : un scrutin clos
     * ne se rouvre pas.
     */
    private const DATES = ['opens_at', 'closes_at'];

    protected static function booted(): void
    {
        static::updating(function (Election $election) {
            $status = $election->getOriginal('status');

            if ($status !== self::STATUS_DRAFT && $election->isDirty(self::FROZEN_AFTER_DRAFT)) {
                throw new DomainException('Le scrutin est ouvert ou clos : la question, le candidat et la règle d\'acceptation ne peuvent plus être modifiés.');
            }

            if ($election->isDirty(self::DATES)) {
                if ($status === self::STATUS_CLOSED) {
                    throw new DomainException('Le scrutin est clos : ses dates ne peuvent plus être modifiées.');
                }
                if ($election->closes_at->lessThanOrEqualTo($election->opens_at)) {
                    throw new DomainException("La clôture doit être postérieure à l'ouverture.");
                }
                if ($status === self::STATUS_OPEN && $election->closes_at->isPast()) {
                    throw new DomainException('Cette heure de clôture est déjà passée. Pour arrêter le vote maintenant, utilisez « Clore le scrutin ».');
                }
            }
        });

        // Appelé avant la synchronisation des valeurs d'origine : getOriginal() donne encore les anciennes dates.
        static::updated(function (Election $election) {
            if ($election->getOriginal('status') === self::STATUS_OPEN && $election->wasChanged(self::DATES)) {
                $change = [];
                foreach (self::DATES as $field) {
                    if ($election->wasChanged($field)) {
                        $change[$field] = [
                            'avant' => $election->getOriginal($field)?->toIso8601String(),
                            'après' => $election->{$field}->toIso8601String(),
                        ];
                    }
                }
                AuditLog::record('election_dates_changed', $election->id, $change);
            }
        });
    }

    protected function casts(): array
    {
        return [
            'opens_at' => 'datetime',
            'closes_at' => 'datetime',
            'blank_counts_as_expressed' => 'boolean',
            'results_published' => 'boolean',
            'quorum_percent' => 'integer',
            'registrar_auto_sync' => 'boolean',
            'registrar_synced_at' => 'datetime',
        ];
    }

    /**
     * Adresse de la photo du candidat, RELATIVE à l'origine (« /storage/candidates/xxx.jpg »).
     *
     * Volontairement sans hôte : une adresse absolue dépendrait de APP_URL et casserait dès que l'API et le site
     * n'ont pas la même adresse (par exemple en développement, où le port de l'API n'est pas celui de l'écran).
     * En production, nginx sert /storage sur le même domaine que le site ; en développement, Vite relaie /storage.
     */
    public function candidatePhotoUrl(): ?string
    {
        if (! $this->candidate_photo) {
            return null;
        }

        return parse_url(Storage::disk('public')->url($this->candidate_photo), PHP_URL_PATH) ?: null;
    }

    public function voters(): HasMany
    {
        return $this->hasMany(Voter::class);
    }

    public function ballots(): HasMany
    {
        return $this->hasMany(Ballot::class);
    }

    /**
     * « Arme » le scrutin : brouillon -> ouvert. Ce n'est PAS l'instant où le vote commence : les bulletins ne sont acceptés
     * qu'entre opens_at et closes_at (voir isOpen), donc le vote s'ouvre tout seul à l'heure prévue, ou immédiatement si
     * elle est déjà passée. Effets : le scrutin devient public (current()), ses règles et son candidat sont figés, l'import
     * et la synchronisation de la liste sont verrouillés ; les dates et l'ajout manuel d'électeurs restent possibles (journalisés).
     *
     * @throws DomainException si le scrutin n'est pas prêt
     */
    public function start(): void
    {
        if ($this->status !== self::STATUS_DRAFT) {
            throw new DomainException('Seul un scrutin en brouillon peut être ouvert.');
        }
        if ($this->voters()->count() === 0) {
            throw new DomainException("La liste électorale est vide : importez-la avant d'ouvrir le scrutin.");
        }
        if ($this->closes_at->lessThanOrEqualTo($this->opens_at)) {
            throw new DomainException("La date de clôture doit être postérieure à la date d'ouverture.");
        }
        if ($this->closes_at->isPast()) {
            throw new DomainException('La date de clôture est déjà passée.');
        }

        DB::transaction(function () {
            $this->update(['status' => self::STATUS_OPEN]);
            AuditLog::record('election_opened', $this->id, ['registered' => $this->voters()->count()]);
        });
    }

    /** Clôt le scrutin (manuellement, ou automatiquement à l'heure de clôture). */
    public function finish(bool $automatic = false): void
    {
        if ($this->status !== self::STATUS_OPEN) {
            throw new DomainException('Seul un scrutin ouvert peut être clos.');
        }

        DB::transaction(function () use ($automatic) {
            $this->update(['status' => self::STATUS_CLOSED]);
            AuditLog::record('election_closed', $this->id, ['automatic' => $automatic]);
        });
    }

    /** Rend les résultats publics. Irréversible. */
    public function publishResults(): void
    {
        if ($this->status !== self::STATUS_CLOSED) {
            throw new DomainException('Les résultats ne peuvent être publiés qu\'après la clôture.');
        }

        DB::transaction(function () {
            $this->update(['results_published' => true]);
            AuditLog::record('results_published', $this->id, ['cast' => $this->ballots()->count()]);
        });
    }

    /** Le scrutin accepte-t-il des bulletins à cet instant ? */
    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN
            && now()->greaterThanOrEqualTo($this->opens_at)
            && now()->lessThan($this->closes_at);
    }

    /**
     * Visible du public (site, connexion, résultats) :
     *  - un scrutin OUVERT (armé par la commission : compte à rebours, vote) ;
     *  - un scrutin CLOS dont la commission a PUBLIÉ les résultats.
     * Jamais un brouillon, ni un scrutin clos dont les résultats ne sont pas publiés. Un scrutin supprimé n'existe plus.
     *
     * @param  Builder<self>  $query
     */
    public function scopeVisible($query): void
    {
        $query->where(function ($q) {
            $q->where('status', self::STATUS_OPEN)
                ->orWhere(fn ($closed) => $closed->where('status', self::STATUS_CLOSED)->where('results_published', true));
        });
    }

    public function isVisible(): bool
    {
        return $this->status === self::STATUS_OPEN
            || ($this->status === self::STATUS_CLOSED && $this->results_published);
    }

    /** Le scrutin « courant » du site public : un scrutin en cours d'abord, sinon le plus récent à résultats publiés. */
    public static function current(): ?self
    {
        return static::query()
            ->visible()
            ->orderByRaw("CASE WHEN status = 'open' THEN 0 ELSE 1 END")
            ->orderByDesc('opens_at')
            ->first();
    }

    /**
     * Dépouillement. Ne lit que l'urne (aucune donnée d'électeur n'intervient dans le décompte).
     *
     * @return array<string, mixed>
     */
    public function tally(): array
    {
        $counts = $this->ballots()
            ->selectRaw('choice, COUNT(*) as total')
            ->groupBy('choice')
            ->pluck('total', 'choice');

        $yes = (int) ($counts['yes'] ?? 0);
        $no = (int) ($counts['no'] ?? 0);
        $blank = (int) ($counts['blank'] ?? 0);

        $registered = $this->voters()->count();
        $cast = $yes + $no + $blank;
        $expressed = $yes + $no + ($this->blank_counts_as_expressed ? $blank : 0);

        $turnout = $registered > 0 ? round($cast / $registered * 100, 2) : 0.0;
        $quorumReached = $this->quorum_percent === null
            || ($registered > 0 && $cast * 100 >= $this->quorum_percent * $registered);

        // Acceptation : Oui strictement supérieur à la moitié des suffrages exprimés.
        $majority = $expressed > 0 && $yes * 2 > $expressed;

        return [
            'registered' => $registered,
            'cast' => $cast,
            'yes' => $yes,
            'no' => $no,
            'blank' => $blank,
            'expressed' => $expressed,
            'turnout_percent' => $turnout,
            'quorum_percent' => $this->quorum_percent,
            'quorum_reached' => $quorumReached,
            'majority_reached' => $majority,
            'accepted' => $quorumReached && $majority,
        ];
    }
}
