<?php

use App\Models\AuditLog;
use App\Models\Ballot;
use App\Models\Election;
use App\Models\Voter;
use App\Services\GoogleIdentity;
use Illuminate\Support\Facades\Schema;

/** Faux vérificateur Google : « token:adresse » est accepté pour l'adresse donnée. */
function fakeGoogle(): void
{
    app()->bind(GoogleIdentity::class, fn () => new class implements GoogleIdentity
    {
        public function verify(string $idToken): ?array
        {
            if (! str_starts_with($idToken, 'ok:')) {
                return null;
            }

            return ['email' => substr($idToken, 3), 'name' => 'Étudiant Test', 'picture' => null];
        }
    });
}

function openElection(array $overrides = []): Election
{
    return Election::create(array_merge([
        'title' => 'Référendum SA',
        'question' => 'Acceptez-vous ce candidat comme Président de la SA ?',
        'candidate_name' => 'Candidat Unique',
        'opens_at' => now()->subHour(),
        'closes_at' => now()->addHour(),
        'status' => Election::STATUS_OPEN,
    ], $overrides));
}

function voterOf(Election $election, string $email = 'jean@zurcher.edu.mg'): Voter
{
    return $election->voters()->create(['email' => $email, 'student_id' => 'S001']);
}

function login(string $email): string
{
    fakeGoogle();

    return test()->postJson('/api/auth/google', ['credential' => "ok:{$email}"])
        ->assertOk()->json('token');
}

function receipt(): string
{
    return hash('sha256', random_bytes(32));
}

it('refuse un jeton Google invalide', function () {
    fakeGoogle();
    openElection();

    $this->postJson('/api/auth/google', ['credential' => 'garbage'])
        ->assertStatus(401)->assertJsonPath('code', 'invalid_credential');
});

it("refuse un compte du domaine qui n'est pas sur la liste électorale", function () {
    fakeGoogle();
    openElection();

    $this->postJson('/api/auth/google', ['credential' => 'ok:prof@zurcher.edu.mg'])
        ->assertStatus(403)->assertJsonPath('code', 'not_eligible');
});

it("connecte un électeur inscrit et n'expose pas son matricule", function () {
    $election = openElection();
    voterOf($election);
    fakeGoogle();

    $this->postJson('/api/auth/google', ['credential' => 'ok:jean@zurcher.edu.mg'])
        ->assertOk()
        ->assertJsonPath('voter.email', 'jean@zurcher.edu.mg')
        ->assertJsonPath('voter.has_voted', false)
        ->assertJsonMissingPath('voter.student_id');
});

it('enregistre un vote et marque l\'électeur', function () {
    $election = openElection();
    $voter = voterOf($election);
    $token = login($voter->email);

    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => receipt()])
        ->assertCreated()->assertJsonPath('status', 'recorded');

    expect($voter->fresh()->has_voted)->toBeTrue()
        ->and(Ballot::count())->toBe(1);
});

it('est idempotent : un renvoi ne crée pas de second bulletin', function () {
    $election = openElection();
    $voter = voterOf($election);
    $token = login($voter->email);
    $hash = receipt();

    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => $hash])->assertCreated();
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => $hash])
        ->assertOk()->assertJsonPath('status', 'already_voted');
    // Même en changeant d'avis ou de reçu, le second envoi est ignoré.
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'no', 'receipt_hash' => receipt()])
        ->assertOk()->assertJsonPath('status', 'already_voted');

    expect(Ballot::count())->toBe(1)->and(Ballot::first()->choice)->toBe('yes');
});

it('rejette un choix ou un reçu invalide', function () {
    $election = openElection();
    $token = login(voterOf($election)->email);

    $this->withToken($token)->postJson('/api/vote', ['choice' => 'maybe', 'receipt_hash' => receipt()])->assertStatus(422);
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => 'abc'])->assertStatus(422);
    expect(Ballot::count())->toBe(0);
});

it('refuse de voter hors de la fenêtre du scrutin', function () {
    $election = openElection(['closes_at' => now()->addHour()]);
    $token = login(voterOf($election)->email);

    // Le scrutin est figé : c'est le temps qui passe, pas une modification, qui le ferme.
    $this->travel(2)->hours();

    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => receipt()])
        ->assertStatus(409)->assertJsonPath('code', 'election_not_open');
    expect(Ballot::count())->toBe(0);
});

it('exige une authentification pour voter', function () {
    openElection();

    $this->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => receipt()])->assertUnauthorized();
});

it('garantit l\'anonymat : rien dans le bulletin ne désigne l\'électeur', function () {
    expect(Schema::getColumnListing('ballots'))
        ->toEqualCanonicalizing(['id', 'election_id', 'choice', 'receipt_hash']);

    $election = openElection();
    $voter = voterOf($election);
    $this->withToken(login($voter->email))
        ->postJson('/api/vote', ['choice' => 'no', 'receipt_hash' => receipt()])->assertCreated();

    // Le journal d'audit enregistre la participation, jamais le choix ni l'identifiant du bulletin.
    $audit = AuditLog::where('event', 'vote_cast')->firstOrFail();
    expect(json_encode($audit->payload))->not->toContain('no')->not->toContain(Ballot::first()->id)
        ->and(strlen(Ballot::first()->id))->toBe(32);
});

it('compte les résultats selon la règle : Oui > 50 % des suffrages exprimés, blancs exclus', function () {
    $election = openElection(['quorum_percent' => null]);
    foreach (['yes' => 3, 'no' => 2, 'blank' => 4] as $choice => $n) {
        for ($i = 0; $i < $n; $i++) {
            voterOf($election, "{$choice}{$i}@zurcher.edu.mg");
            Ballot::create(['id' => bin2hex(random_bytes(16)), 'election_id' => $election->id,
                'choice' => $choice, 'receipt_hash' => receipt()]);
        }
    }

    $tally = $election->tally();
    expect($tally['expressed'])->toBe(5)->and($tally['accepted'])->toBeTrue();

    // Si les blancs comptent comme suffrages exprimés, 3 Oui sur 9 ne suffisent plus.
    // (la règle d'un scrutin ouvert est figée : on simule l'autre règle en mémoire, sans l'enregistrer)
    $other = $election->fresh();
    $other->blank_counts_as_expressed = true;
    expect($other->tally()['accepted'])->toBeFalse();
});

it('applique le quorum de participation', function () {
    $election = openElection(['quorum_percent' => 50]);
    foreach (range(1, 4) as $i) {
        voterOf($election, "v{$i}@zurcher.edu.mg");
    }
    Ballot::create(['id' => bin2hex(random_bytes(16)), 'election_id' => $election->id, 'choice' => 'yes', 'receipt_hash' => receipt()]);

    $tally = $election->tally();
    expect($tally['quorum_reached'])->toBeFalse()->and($tally['accepted'])->toBeFalse();
});

it('ne publie les résultats que clos et publiés', function () {
    $election = openElection();
    $this->getJson('/api/results')->assertNotFound();

    $election->update(['status' => Election::STATUS_CLOSED]);
    $this->getJson('/api/results')->assertNotFound();

    $election->update(['results_published' => true]);
    $this->getJson('/api/results')->assertOk()->assertJsonPath('results.cast', 0);
});

it('vérifie un reçu sans révéler le choix', function () {
    $election = openElection();
    $token = login(voterOf($election)->email);
    $hash = receipt();
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => $hash])->assertCreated();

    $this->getJson("/api/receipts/{$hash}")->assertOk()->assertExactJson(['found' => true]);
    $this->getJson('/api/receipts/'.receipt())->assertOk()->assertExactJson(['found' => false]);
});

it('détecte toute altération du journal d\'audit', function () {
    AuditLog::record('a');
    AuditLog::record('b', null, ['x' => 1]);
    AuditLog::record('c');
    expect(AuditLog::verifyChain())->toBeNull();

    AuditLog::where('event', 'b')->update(['payload' => json_encode(['x' => 2])]);
    expect(AuditLog::verifyChain())->not->toBeNull();
});

// --- Ouverture et clôture à l'heure prévue ---------------------------------------------------------

it("un scrutin « ouvert » par la commission avant son heure n'accepte aucun bulletin, puis s'ouvre tout seul à l'heure prévue", function () {
    $election = openElection(['opens_at' => now()->addHour(), 'closes_at' => now()->addDay()]);
    $token = login(voterOf($election)->email);

    $this->getJson('/api/election')->assertJsonPath('election.status', 'open')->assertJsonPath('election.is_open', false);
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => receipt()])
        ->assertStatus(409)->assertJsonPath('code', 'election_not_open');
    expect(Ballot::count())->toBe(0);

    // L'heure d'ouverture arrive : aucune action de personne, le vote est ouvert.
    $this->travel(61)->minutes();
    $this->getJson('/api/election')->assertJsonPath('election.is_open', true);
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => receipt()])->assertCreated();
    expect(Ballot::count())->toBe(1);
});

it("un scrutin laissé en brouillon ne s'ouvre jamais de lui-même, même une fois l'heure passée", function () {
    $draft = draftElection(['opens_at' => now()->subHour(), 'closes_at' => now()->addDay()]);
    $draft->voters()->create(['email' => 'jean@zurcher.edu.mg']);
    fakeGoogle();

    $this->travel(2)->hours();
    $this->getJson('/api/election')->assertJsonPath('election', null);
    $this->postJson('/api/auth/google', ['credential' => 'ok:jean@zurcher.edu.mg'])->assertStatus(404)->assertJsonPath('code', 'no_election');
    expect($draft->fresh()->status)->toBe(Election::STATUS_DRAFT);
});

it("le vote est refusé dès l'heure de clôture, sans attendre le planificateur", function () {
    $election = openElection(['opens_at' => now()->subHour(), 'closes_at' => now()->addMinutes(30)]);
    $token = login(voterOf($election)->email);

    $this->travel(31)->minutes();
    $this->getJson('/api/election')->assertJsonPath('election.is_open', false);
    $this->withToken($token)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => receipt()])->assertStatus(409);
    expect($election->fresh()->status)->toBe(Election::STATUS_OPEN); // le statut « clos » est posé ensuite par le planificateur
});
