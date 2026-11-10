<?php

use App\Models\AuditLog;
use App\Models\Ballot;
use App\Models\Election;
use App\Models\Voter;
use App\Services\GoogleIdentity;
use App\Services\VoterImporter;
use Illuminate\Support\Facades\Http;

/** Élection ouverte avec un électeur du registrar. */
function openElectionWithRoll(): Election
{
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'registre@zurcher.edu.mg', 'source' => Voter::SOURCE_REGISTRAR]);
    $e->start();

    return $e->fresh();
}

function addVoter(string $token, Election $e, array $data)
{
    return test()->withToken($token)->postJson("/api/admin/elections/{$e->id}/voters", $data);
}

// --- Ajout ------------------------------------------------------------------------------------

it('ajoute un électeur à la main, adresse normalisée, et le marque comme manuel', function () {
    $e = draftElection();
    $token = adminToken();

    addVoter($token, $e, ['email' => '  Marie.Rakoto@Zurcher.edu.mg ', 'name' => "  Marie   RAKOTO\t", 'student_id' => ' S42 '])
        ->assertCreated()
        ->assertJsonPath('data.email', 'marie.rakoto@zurcher.edu.mg')
        ->assertJsonPath('data.name', 'Marie RAKOTO')
        ->assertJsonPath('data.source', 'manual')
        ->assertJsonPath('data.removable', true);

    $v = $e->voters()->firstOrFail();
    expect($v->student_id)->toBe('S42')->and($v->has_voted)->toBeFalse();

    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}/voters")
        ->assertJsonPath('data.0.name', 'Marie RAKOTO')->assertJsonPath('data.0.source', 'manual');
    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}/voters?search=rakoto")->assertJsonCount(1, 'data');
});

it("journalise l'ajout sans jamais écrire l'adresse en clair", function () {
    $e = draftElection();
    addVoter(adminToken(), $e, ['email' => 'secret.nom@zurcher.edu.mg', 'name' => 'Nom Secret'])->assertCreated();

    $log = AuditLog::where('event', 'voter_added')->firstOrFail();
    expect($log->payload)->toHaveKeys(['voter_id', 'user_id', 'email_sha256', 'during_vote'])
        ->and($log->payload['during_vote'])->toBeFalse()
        ->and($log->payload['email_sha256'])->toBe(substr(hash('sha256', 'secret.nom@zurcher.edu.mg'), 0, 16))
        ->and(json_encode($log->payload))->not->toContain('secret')->not->toContain('Nom Secret')
        ->and(AuditLog::verifyChain())->toBeNull();
});

it('refuse une adresse hors domaine, invalide ou en double, et un nom manquant', function () {
    $e = draftElection();
    $e->voters()->create(['email' => 'deja@zurcher.edu.mg']);
    $token = adminToken();

    addVoter($token, $e, ['email' => 'intrus@gmail.com', 'name' => 'Intrus'])->assertStatus(422)->assertJsonValidationErrors('email');
    addVoter($token, $e, ['email' => "n'importe quoi", 'name' => 'X'])->assertStatus(422)->assertJsonValidationErrors('email');
    addVoter($token, $e, ['email' => 'DEJA@zurcher.edu.mg', 'name' => 'Doublon'])
        ->assertStatus(422)->assertJsonPath('errors.email.0', 'Cette adresse figure déjà sur la liste électorale.');
    addVoter($token, $e, ['email' => 'nouveau@zurcher.edu.mg'])->assertStatus(422)->assertJsonValidationErrors('name');
    addVoter($token, $e, ['email' => 'nouveau@zurcher.edu.mg', 'name' => '   '])->assertStatus(422);

    expect($e->voters()->count())->toBe(1);
});

it('refuse un domaine voisin qui finit par le bon texte', function () {
    $e = draftElection();

    $token = adminToken();
    addVoter($token, $e, ['email' => 'x@evil-zurcher.edu.mg', 'name' => 'X'])->assertStatus(422);
    addVoter($token, $e, ['email' => 'x@zurcher.edu.mg.evil.com', 'name' => 'X'])->assertStatus(422);
    expect($e->voters()->count())->toBe(0);
});

// --- Pendant le vote ----------------------------------------------------------------------------

it("permet d'ajouter un électeur pendant le vote, journalisé, et il peut voter aussitôt", function () {
    $e = openElectionWithRoll();
    $token = adminToken();

    addVoter($token, $e, ['email' => 'tardif@zurcher.edu.mg', 'name' => 'Inscrit Tardif'])->assertCreated();

    expect(AuditLog::where('event', 'voter_added')->firstOrFail()->payload['during_vote'])->toBeTrue();
    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}")->assertJsonPath('data.stats.registered', 2);

    // Connexion Google (simulée) puis vote : l'électeur ajouté à la main est un électeur comme les autres.
    $this->flushHeaders();
    $this->app['auth']->forgetGuards();
    app()->bind(GoogleIdentity::class, fn () => new class implements GoogleIdentity
    {
        public function verify(string $idToken): ?array
        {
            return ['email' => substr($idToken, 3), 'name' => 'Inscrit Tardif', 'picture' => null];
        }
    });
    $voterToken = $this->postJson('/api/auth/google', ['credential' => 'ok:tardif@zurcher.edu.mg'])->assertOk()->json('token');
    $this->app['auth']->forgetGuards();
    $this->withToken($voterToken)->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => str_repeat('a', 64)])->assertCreated();

    expect(Voter::where('email', 'tardif@zurcher.edu.mg')->firstOrFail()->has_voted)->toBeTrue()
        ->and(Ballot::count())->toBe(1);
});

it('refuse tout ajout et tout retrait une fois le scrutin clos', function () {
    $e = openElectionWithRoll();
    $manual = $e->voters()->create(['email' => 'manuel@zurcher.edu.mg', 'name' => 'M', 'source' => Voter::SOURCE_MANUAL]);
    $e->fresh()->finish();
    $token = adminToken();

    addVoter($token, $e, ['email' => 'trop-tard@zurcher.edu.mg', 'name' => 'Trop Tard'])->assertStatus(409)->assertJsonPath('code', 'locked');
    $this->withToken($token)->deleteJson("/api/admin/elections/{$e->id}/voters/{$manual->id}")->assertStatus(409);

    expect($e->voters()->count())->toBe(2);
});

// --- Retrait ------------------------------------------------------------------------------------

it("retire n'importe quel électeur d'un brouillon", function () {
    $e = draftElection();
    $reg = $e->voters()->create(['email' => 'reg@zurcher.edu.mg', 'source' => Voter::SOURCE_REGISTRAR]);
    $man = $e->voters()->create(['email' => 'man@zurcher.edu.mg', 'source' => Voter::SOURCE_MANUAL]);
    $token = adminToken();

    $this->withToken($token)->deleteJson("/api/admin/elections/{$e->id}/voters/{$reg->id}")->assertOk();
    $this->withToken($token)->deleteJson("/api/admin/elections/{$e->id}/voters/{$man->id}")->assertOk();

    expect($e->voters()->count())->toBe(0);
    expect(AuditLog::where('event', 'voter_removed')->count())->toBe(2);
});

it("pendant le vote, ne retire qu'un ajout manuel qui n'a pas voté", function () {
    $e = openElectionWithRoll();
    $registrar = $e->voters()->where('source', Voter::SOURCE_REGISTRAR)->firstOrFail();
    $voted = $e->voters()->create(['email' => 'a-vote@zurcher.edu.mg', 'source' => Voter::SOURCE_MANUAL, 'has_voted' => true]);
    $idle = $e->voters()->create(['email' => 'inactif@zurcher.edu.mg', 'source' => Voter::SOURCE_MANUAL]);
    $token = adminToken();

    $this->withToken($token)->deleteJson("/api/admin/elections/{$e->id}/voters/{$registrar->id}")->assertStatus(409);
    $this->withToken($token)->deleteJson("/api/admin/elections/{$e->id}/voters/{$voted->id}")
        ->assertStatus(409)->assertJsonPath('message', 'Cet électeur a déjà voté : il ne peut plus être retiré.');
    $this->withToken($token)->deleteJson("/api/admin/elections/{$e->id}/voters/{$idle->id}")->assertOk();

    expect($e->voters()->pluck('email')->sort()->values()->all())->toBe(['a-vote@zurcher.edu.mg', 'registre@zurcher.edu.mg']);

    $list = $this->withToken($token)->getJson("/api/admin/elections/{$e->id}/voters")->json('data');
    expect(collect($list)->pluck('removable', 'email')->all())->toBe(['a-vote@zurcher.edu.mg' => false, 'registre@zurcher.edu.mg' => false]);
});

it("révoque la session d'un électeur retiré", function () {
    $e = openElectionWithRoll();
    $v = $e->voters()->create(['email' => 'parti@zurcher.edu.mg', 'source' => Voter::SOURCE_MANUAL]);
    $session = $v->createToken('vote', ['vote'])->plainTextToken;
    $this->withToken($session)->getJson('/api/me')->assertOk();
    $this->app['auth']->forgetGuards();

    $this->withToken(adminToken())->deleteJson("/api/admin/elections/{$e->id}/voters/{$v->id}")->assertOk();

    $this->app['auth']->forgetGuards();
    $this->withToken($session)->getJson('/api/me')->assertUnauthorized();
});

it("ne retire pas un électeur d'un autre scrutin", function () {
    $a = draftElection();
    $b = draftElection(['title' => 'Autre scrutin']);
    $v = $b->voters()->create(['email' => 'autre@zurcher.edu.mg']);

    $this->withToken(adminToken())->deleteJson("/api/admin/elections/{$a->id}/voters/{$v->id}")->assertNotFound();
    expect($b->voters()->count())->toBe(1);
});

// --- Import et synchronisation conservent les ajouts manuels -------------------------------------

it('une synchronisation conserve les ajouts manuels et ne les compte pas comme retirés', function () {
    config(['vote.registrar.url' => 'https://registrar.test/x.php', 'vote.registrar.token' => 'jeton-test']);
    $e = draftElection();
    $e->voters()->create(['email' => 'ancien@zurcher.edu.mg', 'source' => Voter::SOURCE_REGISTRAR]);
    $e->voters()->create(['email' => 'manuel@zurcher.edu.mg', 'name' => 'Manuel', 'source' => Voter::SOURCE_MANUAL]);
    Http::fake(['*' => Http::response([
        'session' => ['id' => 490, 'name' => 'S', 'year' => '2026 - 2027', 'semester' => 1],
        'counts' => ['enrolled' => 2, 'eligible' => 2, 'without_email' => 0],
        'voters' => [['email' => 'nouveau@zurcher.edu.mg', 'student_id' => 'S1']],
    ])]);

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])
        ->assertOk()
        ->assertJsonPath('data.added', 1)
        ->assertJsonPath('data.removed', 1)
        ->assertJsonPath('data.manual', 1)
        ->assertJsonPath('data.total', 2);

    expect($e->voters()->pluck('email')->sort()->values()->all())->toBe(['manuel@zurcher.edu.mg', 'nouveau@zurcher.edu.mg'])
        ->and($e->voters()->where('email', 'manuel@zurcher.edu.mg')->first())->name->toBe('Manuel')->source->toBe('manual')
        ->and(AuditLog::where('event', 'voters_synced')->firstOrFail()->payload['manual_kept'])->toBe(1);
});

it("n'écrase ni ne duplique un ajout manuel que le registrar contient aussi", function () {
    $e = draftElection();
    $e->voters()->create(['email' => 'both@zurcher.edu.mg', 'name' => 'Nom saisi', 'source' => Voter::SOURCE_MANUAL]);

    $r = app(VoterImporter::class)->syncFromRows($e, [['email' => 'both@zurcher.edu.mg', 'student_id' => 'S9'], ['email' => 'autre@zurcher.edu.mg']], ['id' => 1]);

    expect($r)->toMatchArray(['added' => 1, 'removed' => 0, 'manual' => 1, 'total' => 2]);
    expect($e->voters()->where('email', 'both@zurcher.edu.mg')->count())->toBe(1)
        ->and($e->voters()->where('email', 'both@zurcher.edu.mg')->first())->name->toBe('Nom saisi')->source->toBe('manual');
});

it("l'import CSV accepte une colonne « name » facultative et conserve aussi les ajouts manuels", function () {
    $e = draftElection();
    $e->voters()->create(['email' => 'manuel@zurcher.edu.mg', 'source' => Voter::SOURCE_MANUAL]);

    $r = app(VoterImporter::class)->import($e, csvFile("email;student_id;name\njean@zurcher.edu.mg;S1;Jean Dupont\nmarie@zurcher.edu.mg;S2;\n"));

    expect($r)->toMatchArray(['valid' => 2, 'added' => 2, 'manual' => 1, 'total' => 3]);
    expect($e->voters()->where('email', 'jean@zurcher.edu.mg')->first())->name->toBe('Jean Dupont')->source->toBe('csv')
        ->and($e->voters()->where('email', 'marie@zurcher.edu.mg')->value('name'))->toBeNull();
});

// --- Cloisonnement ------------------------------------------------------------------------------

it("réserve l'ajout et le retrait à la commission", function () {
    $e = openElectionWithRoll();
    $v = $e->voters()->first();
    $voterToken = $v->createToken('vote', ['vote'])->plainTextToken;

    $this->postJson("/api/admin/elections/{$e->id}/voters", ['email' => 'x@zurcher.edu.mg', 'name' => 'X'])->assertUnauthorized();
    $this->deleteJson("/api/admin/elections/{$e->id}/voters/{$v->id}")->assertUnauthorized();
    $this->withToken($voterToken)->postJson("/api/admin/elections/{$e->id}/voters", ['email' => 'x@zurcher.edu.mg', 'name' => 'X'])->assertForbidden();
    $this->withToken($voterToken)->deleteJson("/api/admin/elections/{$e->id}/voters/{$v->id}")->assertForbidden();

    expect($e->voters()->count())->toBe(1);
});

it("expose l'autorisation d'ajouter dans les verrous du scrutin", function () {
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $token = adminToken();

    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}")->assertJsonPath('data.locks.voters', false)->assertJsonPath('data.locks.voters_manual', true);
    $e->start();
    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}")->assertJsonPath('data.locks.voters', true)->assertJsonPath('data.locks.voters_manual', true);
    $e->fresh()->finish();
    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}")->assertJsonPath('data.locks.voters_manual', false);
});
