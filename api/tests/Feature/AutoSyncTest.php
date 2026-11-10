<?php

use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Voter;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Http;

function autoRegistrarOn(array $emails, int $status = 200): void
{
    config(['vote.registrar.url' => 'https://registrar.test/app/electeurs-sa.api.php', 'vote.registrar.token' => 'jeton-secret-tres-long-123']);
    $voters = array_map(fn ($e) => ['email' => $e, 'student_id' => null], $emails);
    // Http::fake() s'ajoute aux simulations précédentes (la première l'emporte) : on repart d'un client neuf.
    Http::swap(new Factory);
    Http::fake(fn () => $status !== 200
        ? Http::response(['message' => 'Erreur'], $status)
        : Http::response([
            'session' => ['id' => 490, 'name' => 'Premier semestre', 'year' => '2026 - 2027', 'semester' => 1],
            'counts' => ['enrolled' => count($voters), 'eligible' => count($voters), 'without_email' => 0],
            'voters' => $voters,
        ]));
}

function autoElection(array $overrides = []): Election
{
    return draftElection(['registrar_auto_sync' => true, 'registrar_session_id' => 490] + $overrides);
}

function emails(int $n, string $prefix = 'etu'): array
{
    return array_map(fn ($i) => "{$prefix}{$i}@zurcher.edu.mg", range(1, $n));
}

it('active la synchronisation automatique : première reprise immédiate, session mémorisée, journal « auto »', function () {
    autoRegistrarOn(['a@zurcher.edu.mg', 'b@zurcher.edu.mg']);
    $e = draftElection();

    $res = $this->withToken(adminToken())->putJson("/api/admin/elections/{$e->id}/registrar/auto", ['enabled' => true, 'session_id' => 490])
        ->assertOk()
        ->assertJsonPath('sync.status', 'synced')
        ->assertJsonPath('data.registrar.auto_sync', true)
        ->assertJsonPath('data.registrar.session_id', 490)
        ->assertJsonPath('data.stats.registered', 2);

    expect($res->json('data.registrar.synced_at'))->not->toBeNull();
    $log = AuditLog::query()->where('event', 'voters_synced')->firstOrFail();
    expect($log->payload['trigger'])->toBe('auto');
});

it('exige la session pour activer, et refuse hors brouillon', function () {
    autoRegistrarOn(['a@zurcher.edu.mg']);
    $e = draftElection();
    $token = adminToken();

    $this->withToken($token)->putJson("/api/admin/elections/{$e->id}/registrar/auto", ['enabled' => true])
        ->assertUnprocessable()->assertJsonValidationErrors('session_id');

    $open = draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);
    $this->putJson("/api/admin/elections/{$open->id}/registrar/auto", ['enabled' => true, 'session_id' => 490])->assertStatus(409);
    expect($open->fresh()->registrar_auto_sync)->toBeFalse();
});

it('la commande ne traite que les brouillons dont la synchronisation automatique est activée', function () {
    autoRegistrarOn(['a@zurcher.edu.mg']);
    $on = autoElection();
    $off = draftElection();
    $open = autoElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);

    $this->artisan('elections:sync-registrar')->assertSuccessful();

    expect($on->voters()->count())->toBe(1);
    expect($off->voters()->count())->toBe(0);
    expect($open->voters()->count())->toBe(0);
});

it("n'écrit rien et ne journalise rien quand la liste est déjà à jour, mais note l'heure de contrôle", function () {
    autoRegistrarOn(['a@zurcher.edu.mg', 'b@zurcher.edu.mg']);
    $e = autoElection();
    $this->artisan('elections:sync-registrar')->assertSuccessful();
    $before = AuditLog::query()->where('event', 'voters_synced')->count();
    $e->forceFill(['registrar_synced_at' => now()->subHour()])->save();

    $this->artisan('elections:sync-registrar')->assertSuccessful();

    expect(AuditLog::query()->where('event', 'voters_synced')->count())->toBe($before);
    expect($e->fresh()->registrar_synced_at->isAfter(now()->subMinute()))->toBeTrue();
});

it('conserve les électeurs ajoutés à la main et applique les changements du registrar', function () {
    $e = autoElection();
    $e->voters()->create(['email' => 'manuel@zurcher.edu.mg', 'source' => Voter::SOURCE_MANUAL]);
    $e->voters()->create(['email' => 'ancien@zurcher.edu.mg', 'source' => Voter::SOURCE_REGISTRAR]);
    autoRegistrarOn(['ancien@zurcher.edu.mg', 'nouveau@zurcher.edu.mg']);

    $this->artisan('elections:sync-registrar')->assertSuccessful();

    expect($e->voters()->pluck('email')->sort()->values()->all())
        ->toBe(['ancien@zurcher.edu.mg', 'manuel@zurcher.edu.mg', 'nouveau@zurcher.edu.mg']);
});

it("garde-fou : un export vide ne vide pas la liste, l'erreur est affichée", function () {
    $e = autoElection();
    foreach (emails(30) as $m) {
        $e->voters()->create(['email' => $m, 'source' => Voter::SOURCE_REGISTRAR]);
    }
    autoRegistrarOn([]);

    $this->artisan('elections:sync-registrar')->assertFailed();

    expect($e->voters()->count())->toBe(30);
    expect($e->fresh()->registrar_sync_error)->toContain('aucun électeur');
});

it('garde-fou : un retrait massif est refusé, un petit retrait est accepté', function () {
    $e = autoElection();
    foreach (emails(100) as $m) {
        $e->voters()->create(['email' => $m, 'source' => Voter::SOURCE_REGISTRAR]);
    }

    autoRegistrarOn(emails(60));                       // −40 sur 100 : refusé
    $this->artisan('elections:sync-registrar')->assertFailed();
    expect($e->voters()->count())->toBe(100);
    expect($e->fresh()->registrar_sync_error)->toContain('variation inhabituelle');

    autoRegistrarOn(emails(85));                       // −15 sur 100 : accepté, et l'erreur disparaît
    $this->artisan('elections:sync-registrar')->assertSuccessful();
    expect($e->voters()->count())->toBe(85);
    expect($e->fresh()->registrar_sync_error)->toBeNull();
});

it('un registrar en panne laisse la liste intacte et affiche l’erreur', function () {
    $e = autoElection();
    $e->voters()->create(['email' => 'a@zurcher.edu.mg', 'source' => Voter::SOURCE_REGISTRAR]);
    autoRegistrarOn([], 503);

    $this->artisan('elections:sync-registrar')->assertFailed();

    expect($e->voters()->count())->toBe(1);
    expect($e->fresh()->registrar_sync_error)->not->toBeNull();
});

it("à l'ouverture : dernière reprise du registrar ; une panne n'empêche pas d'ouvrir mais est signalée", function () {
    autoRegistrarOn(['a@zurcher.edu.mg', 'b@zurcher.edu.mg']);
    $e = autoElection(['opens_at' => now()->subMinute(), 'closes_at' => now()->addDay()]);
    $token = adminToken();

    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/open")
        ->assertOk()->assertJsonPath('sync.status', 'synced')->assertJsonPath('data.status', 'open');
    expect($e->voters()->count())->toBe(2);

    $f = autoElection(['opens_at' => now()->subMinute(), 'closes_at' => now()->addDay()]);
    $f->voters()->create(['email' => 'seul@zurcher.edu.mg', 'source' => Voter::SOURCE_REGISTRAR]);
    autoRegistrarOn([], 503);

    $this->postJson("/api/admin/elections/{$f->id}/open")
        ->assertOk()->assertJsonPath('sync.status', 'error')->assertJsonPath('data.status', 'open');
    expect($f->voters()->count())->toBe(1);

    // Une fois ouvert, la liste est figée : la commande ne touche plus à rien.
    autoRegistrarOn(['x@zurcher.edu.mg']);
    $this->artisan('elections:sync-registrar')->assertSuccessful();
    expect($f->voters()->count())->toBe(1);
});

/* ---------------------------------------------------------------- Niveaux : Licence / Master / les deux */

function autoRegistrarLevels(array $voters, array $without = []): void
{
    config(['vote.registrar.url' => 'https://registrar.test/app/electeurs-sa.api.php', 'vote.registrar.token' => 'jeton-secret-tres-long-123']);
    Http::swap(new Factory);
    Http::fake(fn () => Http::response([
        'session' => ['id' => 490, 'name' => 'Premier semestre', 'year' => '2026 - 2027', 'semester' => 1],
        'counts' => ['enrolled' => count($voters) + count($without), 'eligible' => count($voters), 'without_email' => count($without)],
        'voters' => $voters,
        'without_email' => $without,
    ]));
}

function levelRows(): array
{
    return [
        ['email' => 'l1@zurcher.edu.mg', 'student_id' => 'A1', 'level' => 'licence'],
        ['email' => 'l2@zurcher.edu.mg', 'student_id' => 'A2', 'level' => 'licence'],
        ['email' => 'l3@zurcher.edu.mg', 'student_id' => 'A3', 'level' => 'licence'],
        ['email' => 'm1@zurcher.edu.mg', 'student_id' => 'B1', 'level' => 'master'],
        ['email' => 'm2@zurcher.edu.mg', 'student_id' => 'B2', 'level' => 'master'],
        ['email' => 'inconnu@zurcher.edu.mg', 'student_id' => 'C1'],   // export plus ancien, sans niveau : compté en Licence
    ];
}

it("l'aperçu filtre par niveau, et détaille Licence / Master pour toute la session", function () {
    autoRegistrarLevels(levelRows(), [
        ['student_id' => 'X1', 'name' => 'Sans Adresse Licence', 'reason' => 'missing', 'level' => 'licence'],
        ['student_id' => 'X2', 'name' => 'Sans Adresse Master', 'reason' => 'other_domain', 'level' => 'master'],
    ]);
    $e = draftElection();
    $token = adminToken();
    $sync = fn (string $levels) => $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490, 'dry_run' => true, 'levels' => $levels]);

    $sync('all')->assertOk()->assertJsonPath('data.total', 6)->assertJsonPath('data.without_email', 2)
        ->assertJsonPath('data.by_level.licence.eligible', 4)->assertJsonPath('data.by_level.master.eligible', 2)
        ->assertJsonPath('data.by_level.master.without_email', 1);

    $r = $sync('master')->assertOk()->assertJsonPath('data.total', 2)->assertJsonPath('data.without_email', 1)
        ->assertJsonPath('data.levels', 'master')
        ->assertJsonPath('data.by_level.licence.eligible', 4);                       // le détail reste celui de toute la session
    expect(array_column($r->json('data.without_email_list'), 'student_id'))->toBe(['X2']);

    $sync('licence')->assertOk()->assertJsonPath('data.total', 4)->assertJsonPath('data.without_email', 1)
        ->assertJsonPath('data.without_email_list.0.student_id', 'X1');

    $this->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490, 'levels' => 'doctorat'])->assertUnprocessable();
});

it('la synchronisation manuelle applique le niveau choisi et le consigne au journal', function () {
    autoRegistrarLevels(levelRows());
    $e = draftElection();

    $this->withToken(adminToken())->postJson("/api/admin/elections/{$e->id}/voters/sync", ['session_id' => 490, 'levels' => 'master'])->assertOk();

    expect($e->voters()->pluck('email')->sort()->values()->all())->toBe(['m1@zurcher.edu.mg', 'm2@zurcher.edu.mg']);
    expect(AuditLog::query()->where('event', 'voters_synced')->firstOrFail()->payload['levels'])->toBe('master');
});

it('la synchronisation automatique respecte le niveau ; le premier réglage choisi par la commission passe le garde-fou de variation', function () {
    autoRegistrarLevels(levelRows());
    $e = draftElection();
    $token = adminToken();

    $this->withToken($token)->putJson("/api/admin/elections/{$e->id}/registrar/auto", ['enabled' => true, 'session_id' => 490, 'levels' => 'all'])
        ->assertOk()->assertJsonPath('data.registrar.levels', 'all')->assertJsonPath('data.stats.registered', 6);

    // Désactiver puis passer à « Master seulement » : −4 sur 6 dépasse le garde-fou (20 %), mais c'est un choix explicite.
    $this->putJson("/api/admin/elections/{$e->id}/registrar/auto", ['enabled' => false])->assertOk();
    $this->putJson("/api/admin/elections/{$e->id}/registrar/auto", ['enabled' => true, 'session_id' => 490, 'levels' => 'master'])
        ->assertOk()->assertJsonPath('sync.status', 'synced')->assertJsonPath('data.registrar.levels', 'master')->assertJsonPath('data.stats.registered', 2);

    // Les reprises suivantes (planificateur) gardent le niveau.
    $this->artisan('elections:sync-registrar')->assertSuccessful();
    expect($e->voters()->count())->toBe(2);
});
