<?php

use App\Models\AuditLog;
use App\Models\Election;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

const REGISTRAR_URL = 'https://registrar.test/app/electeurs-sa.api.php';
const REGISTRAR_TOKEN = 'jeton-secret-tres-long-123';

function configureRegistrar(): void
{
    config(['vote.registrar.url' => REGISTRAR_URL, 'vote.registrar.token' => REGISTRAR_TOKEN]);
}

/** Simule l'export du registrar : sessions et liste d'étudiants. */
function fakeRegistrar(array $voters = [], array $counts = ['enrolled' => 0, 'eligible' => 0, 'without_email' => 0], int $status = 200, array $withoutEmail = []): void
{
    Http::fake(function (Request $request) use ($voters, $counts, $status, $withoutEmail) {
        if ($status !== 200) {
            return Http::response(['code' => 'x', 'message' => 'Erreur'], $status);
        }
        if (str_contains($request->url(), 'action=sessions')) {
            return Http::response(['sessions' => [
                ['id' => 490, 'name' => 'Premier semestre', 'year' => '2026 - 2027', 'semester' => 1, 'selected' => false, 'enrolled' => 9],
                ['id' => 489, 'name' => 'Semestre d\'hiver', 'year' => '2025 - 2026', 'semester' => 4, 'selected' => true, 'enrolled' => 2],
            ]]);
        }

        return Http::response([
            'session' => ['id' => 490, 'name' => 'Premier semestre', 'year' => '2026 - 2027', 'semester' => 1],
            'counts' => $counts,
            'voters' => $voters,
            'without_email' => $withoutEmail,
        ]);
    });
}

// --- Configuration et sessions -----------------------------------------------------------------

it("indique que la synchronisation n'est pas configurée", function () {
    config(['vote.registrar.url' => null, 'vote.registrar.token' => null]);
    Http::fake();

    $this->withToken(adminToken())->getJson('/api/admin/registrar/sessions')
        ->assertOk()->assertJson(['configured' => false, 'sessions' => []]);
    Http::assertNothingSent();
});

it('liste les sessions du registrar avec leur nombre d\'inscrits, en envoyant le jeton', function () {
    configureRegistrar();
    fakeRegistrar();

    $this->withToken(adminToken())->getJson('/api/admin/registrar/sessions')
        ->assertOk()
        ->assertJsonPath('configured', true)
        ->assertJsonPath('sessions.0.id', 490)
        ->assertJsonPath('sessions.0.enrolled', 9)
        ->assertJsonPath('sessions.1.selected', true);

    Http::assertSent(fn (Request $r) => $r->hasHeader('Authorization', 'Bearer '.REGISTRAR_TOKEN) && $r['action'] === 'sessions');
});

// --- Synchronisation ---------------------------------------------------------------------------

it('simule la synchronisation : montre ce qui change sans rien écrire', function () {
    configureRegistrar();
    $e = draftElection();
    $e->voters()->create(['email' => 'ancien@zurcher.edu.mg']);
    $e->voters()->create(['email' => 'reste@zurcher.edu.mg']);
    fakeRegistrar(
        [['email' => 'reste@zurcher.edu.mg', 'student_id' => 'S1'], ['email' => 'nouveau@zurcher.edu.mg', 'student_id' => 'S2']],
        ['enrolled' => 3, 'eligible' => 2, 'without_email' => 1],
        withoutEmail: [['student_id' => '30023MI', 'name' => 'Hary Lala RABENAMANA', 'reason' => 'missing', 'adresse_perso' => 'ne.doit.pas.sortir@gmail.com']],
    );

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490, 'dry_run' => true])
        ->assertOk()
        ->assertJsonPath('data.dry_run', true)
        ->assertJsonPath('data.valid', 2)
        ->assertJsonPath('data.added', 1)
        ->assertJsonPath('data.removed', 1)
        ->assertJsonPath('data.unchanged', 1)
        ->assertJsonPath('data.without_email', 1)
        ->assertJsonPath('data.without_email_list.0.student_id', '30023MI')
        ->assertJsonPath('data.without_email_list.0.name', 'Hary Lala RABENAMANA')
        ->assertJsonPath('data.without_email_list.0.reason', 'missing')
        ->assertJsonMissingPath('data.without_email_list.0.adresse_perso')
        ->assertJsonPath('data.enrolled', 3)
        ->assertJsonPath('data.session.year', '2026 - 2027');

    expect($e->voters()->pluck('email')->sort()->values()->all())->toBe(['ancien@zurcher.edu.mg', 'reste@zurcher.edu.mg']);
    expect(AuditLog::where('event', 'voters_synced')->count())->toBe(0);
});

it('synchronise : remplace la liste et journalise la session source, sans aucune adresse', function () {
    configureRegistrar();
    $e = draftElection();
    $e->voters()->create(['email' => 'ancien@zurcher.edu.mg']);
    fakeRegistrar([['email' => 'a@zurcher.edu.mg', 'student_id' => 'S1'], ['email' => 'b@zurcher.edu.mg', 'student_id' => 'S2']]);

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])->assertOk();

    expect($e->voters()->pluck('email')->sort()->values()->all())->toBe(['a@zurcher.edu.mg', 'b@zurcher.edu.mg'])
        ->and($e->voters()->where('email', 'a@zurcher.edu.mg')->value('student_id'))->toBe('S1');

    $log = AuditLog::where('event', 'voters_synced')->firstOrFail();
    expect($log->payload)->toMatchArray(['source' => 'registrar', 'count' => 2, 'added' => 2, 'removed' => 1])
        ->and($log->payload['session']['id'])->toBe(490)
        ->and(json_encode($log->payload))->not->toContain('zurcher.edu.mg')
        ->and(AuditLog::verifyChain())->toBeNull();
});

it('applique les mêmes règles que l\'import CSV : adresses hors domaine, invalides et doublons écartés', function () {
    configureRegistrar();
    $e = draftElection();
    fakeRegistrar([
        ['email' => 'Jean@Zurcher.edu.mg', 'student_id' => 'S1'],
        ['email' => 'jean@zurcher.edu.mg', 'student_id' => 'S1'],
        ['email' => 'intrus@gmail.com', 'student_id' => 'S3'],
        ['email' => "n'importe quoi", 'student_id' => 'S4'],
    ]);

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])
        ->assertOk()->assertJsonPath('data.valid', 1)->assertJsonPath('data.invalid', 2)->assertJsonPath('data.duplicate', 1);
    expect($e->voters()->pluck('email')->all())->toBe(['jean@zurcher.edu.mg']);
});

it('refuse de synchroniser un scrutin ouvert, sans même appeler le registrar', function () {
    configureRegistrar();
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $e->start();
    fakeRegistrar([['email' => 'b@zurcher.edu.mg', 'student_id' => 'S1']]);

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])
        ->assertStatus(409)->assertJsonPath('code', 'locked');

    Http::assertNothingSent();
    expect($e->voters()->pluck('email')->all())->toBe(['a@zurcher.edu.mg']);
});

it('exige la session à synchroniser', function () {
    configureRegistrar();
    $e = draftElection();
    Http::fake();

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", [])->assertStatus(422)->assertJsonValidationErrors('session_id');
    Http::assertNothingSent();
});

// --- Erreurs du registrar ----------------------------------------------------------------------

it('traduit les erreurs du registrar en messages clairs, sans jamais exposer le jeton', function (int $status, string $contains) {
    configureRegistrar();
    $e = draftElection();
    fakeRegistrar(status: $status);
    Log::spy();

    $response = $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490]);

    $response->assertStatus(502)->assertJsonPath('code', 'registrar_error');
    expect($response->json('message'))->toContain($contains)->not->toContain(REGISTRAR_TOKEN)
        ->and($response->getContent())->not->toContain(REGISTRAR_TOKEN);
    expect($e->voters()->count())->toBe(0);
})->with([
    'jeton refusé' => [401, 'jeton'],
    'export désactivé' => [503, 'pas activé'],
    'erreur serveur' => [500, 'erreur'],
]);

it('gère un registrar injoignable', function () {
    configureRegistrar();
    $e = draftElection();
    Http::fake(fn () => throw new ConnectionException('cURL error 7 for '.REGISTRAR_URL));

    $response = $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490]);

    $response->assertStatus(502)->assertJsonPath('message', 'Le registrar est injoignable. Réessayez dans un instant.');
    expect($response->getContent())->not->toContain('registrar.test');
});

it('refuse une réponse mal formée', function () {
    configureRegistrar();
    $e = draftElection();
    $token = adminToken();

    Http::fake(['*' => Http::response(['voters' => 'pas une liste'])]);
    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])
        ->assertStatus(502);

    Http::fake(['*' => Http::response('<html>pas du json</html>', 200)]);
    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])
        ->assertStatus(502);
    expect($e->voters()->count())->toBe(0);
});

it('tolère un BOM UTF-8 devant le JSON du registrar', function () {
    configureRegistrar();
    $e = draftElection();
    $json = json_encode([
        'session' => ['id' => 490, 'name' => 'S', 'year' => '2026 - 2027', 'semester' => 1],
        'counts' => ['enrolled' => 1, 'eligible' => 1, 'without_email' => 0],
        'voters' => [['email' => 'a@zurcher.edu.mg', 'student_id' => 'S1']],
    ]);
    Http::fake(['*' => Http::response("\xEF\xBB\xBF".$json, 200)]);

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])
        ->assertOk()->assertJsonPath('data.valid', 1);
});

it('ne suit jamais une redirection avec le jeton', function () {
    configureRegistrar();
    $e = draftElection();
    Http::fake(['registrar.test/*' => Http::response('', 302, ['Location' => 'https://ailleurs.example/vole'])]);

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])->assertStatus(502);
    Http::assertSentCount(1);
});

// --- Adresse du registrar ----------------------------------------------------------------------

it('exige HTTPS, sauf pour la boucle locale (développement)', function () {
    $e = draftElection();
    config(['vote.registrar.token' => REGISTRAR_TOKEN]);
    Http::fake(['*' => Http::response(['sessions' => []])]);

    config(['vote.registrar.url' => 'http://registrar.zurcher.edu.mg/app/x.php']);
    $this->withToken(adminToken())->getJson('/api/admin/registrar/sessions')
        ->assertStatus(502)->assertJsonPath('message', "L'adresse du registrar doit être en HTTPS (REGISTRAR_EXPORT_URL).");
    Http::assertNothingSent();

    config(['vote.registrar.url' => 'http://127.0.0.1:8090/']);
    $this->getJson('/api/admin/registrar/sessions')->assertOk();
    expect($e)->toBeInstanceOf(Election::class);
});

// --- Cloisonnement -----------------------------------------------------------------------------

it('réserve la synchronisation à la commission', function () {
    configureRegistrar();
    $e = draftElection();
    Http::fake();

    $this->getJson('/api/admin/registrar/sessions')->assertUnauthorized();
    $this->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490])->assertUnauthorized();

    $open = draftElection(['opens_at' => now()->subHour()]);
    $open->voters()->create(['email' => 'v@zurcher.edu.mg']);
    $voterToken = $open->voters()->first()->createToken('vote', ['vote'])->plainTextToken;
    $this->withToken($voterToken)->getJson('/api/admin/registrar/sessions')->assertForbidden();
    Http::assertNothingSent();
});
