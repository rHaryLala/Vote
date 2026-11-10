<?php

use App\Models\AuditLog;
use App\Models\Election;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

beforeEach(function () {
    $this->token = adminToken();
    $this->me = User::query()->where('email', 'commission@zurcher.edu.mg')->firstOrFail();
});

/* ---------------------------------------------------------------- Changer son mot de passe */

it('change son mot de passe, ferme les autres sessions et garde la session courante', function () {
    $other = $this->me->createToken('admin', ['admin'])->accessToken;

    $this->withToken($this->token)->putJson('/api/admin/account/password', [
        'current_password' => 'mot-de-passe-solide',
        'password' => 'Nouveau-mdp-2026',
        'password_confirmation' => 'Nouveau-mdp-2026',
    ])->assertOk();

    expect(Hash::check('Nouveau-mdp-2026', $this->me->fresh()->password))->toBeTrue();
    expect($this->me->tokens()->whereKey($other->id)->exists())->toBeFalse();   // autre session fermée
    $this->getJson('/api/admin/me')->assertOk();                                // session courante conservée

    $log = AuditLog::query()->where('event', 'admin_password_changed')->firstOrFail();
    expect($log->payload)->toBe(['user_id' => $this->me->id]);                  // jamais de mot de passe dans le journal
});

it('refuse un mauvais mot de passe actuel, une confirmation différente, un mot de passe faible ou inchangé', function () {
    $put = fn (array $b) => $this->withToken($this->token)->putJson('/api/admin/account/password', $b);

    $put(['current_password' => 'faux-mot-de-passe', 'password' => 'Nouveau-mdp-2026', 'password_confirmation' => 'Nouveau-mdp-2026'])
        ->assertUnprocessable()->assertJsonValidationErrors('current_password');
    $put(['current_password' => 'mot-de-passe-solide', 'password' => 'Nouveau-mdp-2026', 'password_confirmation' => 'Autre-mdp-2026x'])
        ->assertUnprocessable()->assertJsonValidationErrors('password');
    $put(['current_password' => 'mot-de-passe-solide', 'password' => 'court1', 'password_confirmation' => 'court1'])
        ->assertUnprocessable()->assertJsonValidationErrors('password');
    $put(['current_password' => 'mot-de-passe-solide', 'password' => 'uniquementdeslettres', 'password_confirmation' => 'uniquementdeslettres'])
        ->assertUnprocessable()->assertJsonValidationErrors('password');
    $put(['current_password' => 'mot-de-passe-solide', 'password' => 'mot-de-passe-solide', 'password_confirmation' => 'mot-de-passe-solide'])
        ->assertUnprocessable()->assertJsonValidationErrors('password');

    expect(Hash::check('mot-de-passe-solide', $this->me->fresh()->password))->toBeTrue();
    expect(AuditLog::query()->where('event', 'admin_password_changed')->exists())->toBeFalse();
});

it('exige une connexion pour changer de mot de passe', function () {
    $this->flushHeaders();
    app('auth')->forgetGuards();
    $this->putJson('/api/admin/account/password', [])->assertUnauthorized();
});

/* ---------------------------------------------------------------- Comptes de la commission */

it('liste les comptes de la commission et marque le sien', function () {
    User::factory()->create(['name' => 'Autre Membre', 'email' => 'autre@zurcher.edu.mg']);

    $rows = $this->withToken($this->token)->getJson('/api/admin/users')->assertOk()->json('data');

    expect($rows)->toHaveCount(2);
    expect(collect($rows)->firstWhere('email', 'commission@zurcher.edu.mg')['is_self'])->toBeTrue();
    expect(collect($rows)->firstWhere('email', 'autre@zurcher.edu.mg')['is_self'])->toBeFalse();
    expect(json_encode($rows))->not->toContain('password');
});

it('crée un compte avec un mot de passe généré, affiché une seule fois, et qui permet de se connecter', function () {
    $res = $this->withToken($this->token)->postJson('/api/admin/users', ['name' => 'Nouveau Membre', 'email' => '  Nouveau.Membre@Zurcher.edu.mg '])
        ->assertCreated();

    $password = $res->json('password');
    expect($password)->toBeString()->and(strlen($password))->toBeGreaterThanOrEqual(16);
    expect($res->json('user.email'))->toBe('nouveau.membre@zurcher.edu.mg');
    expect($res->json('user'))->not->toHaveKey('password');

    $this->flushHeaders();
    app('auth')->forgetGuards();
    $this->postJson('/api/admin/login', ['email' => 'nouveau.membre@zurcher.edu.mg', 'password' => $password])->assertOk();

    $new = User::query()->where('email', 'nouveau.membre@zurcher.edu.mg')->firstOrFail();
    $log = AuditLog::query()->where('event', 'admin_user_created')->firstOrFail();
    expect($log->payload)->toBe(['user_id' => $this->me->id, 'target_id' => $new->id]);
});

it('crée un compte avec le mot de passe choisi (non renvoyé)', function () {
    $res = $this->withToken($this->token)->postJson('/api/admin/users', [
        'name' => 'Membre Choisi', 'email' => 'choisi@zurcher.edu.mg', 'password' => 'Choisi-par-moi-1',
    ])->assertCreated();

    expect($res->json('password'))->toBeNull();
    expect(Hash::check('Choisi-par-moi-1', User::query()->where('email', 'choisi@zurcher.edu.mg')->value('password')))->toBeTrue();
});

it('refuse un doublon, une adresse hors domaine, un nom vide et un mot de passe faible', function () {
    $post = fn (array $b) => $this->withToken($this->token)->postJson('/api/admin/users', $b);

    $post(['name' => 'Doublon', 'email' => 'COMMISSION@zurcher.edu.mg'])->assertUnprocessable()->assertJsonValidationErrors('email');
    $post(['name' => 'Dehors', 'email' => 'quelquun@gmail.com'])->assertUnprocessable()->assertJsonValidationErrors('email');
    $post(['name' => 'Piège', 'email' => 'x@zurcher.edu.mg.evil.com'])->assertUnprocessable()->assertJsonValidationErrors('email');
    $post(['name' => '', 'email' => 'vide@zurcher.edu.mg'])->assertUnprocessable()->assertJsonValidationErrors('name');
    $post(['name' => 'Faible', 'email' => 'faible@zurcher.edu.mg', 'password' => 'abc'])->assertUnprocessable()->assertJsonValidationErrors('password');

    expect(User::query()->count())->toBe(1);
});

it("réinitialise le mot de passe d'un autre membre et ferme ses sessions, mais pas le sien", function () {
    $other = User::factory()->create(['email' => 'autre@zurcher.edu.mg', 'password' => 'ancien-mdp-12345']);
    $otherToken = $other->createToken('admin', ['admin'])->accessToken;

    $res = $this->withToken($this->token)->postJson("/api/admin/users/{$other->id}/reset-password")->assertOk();

    $new = $res->json('password');
    expect(Hash::check($new, $other->fresh()->password))->toBeTrue();
    expect(Hash::check('ancien-mdp-12345', $other->fresh()->password))->toBeFalse();
    expect($other->tokens()->whereKey($otherToken->id)->exists())->toBeFalse();
    expect(AuditLog::query()->where('event', 'admin_password_reset')->exists())->toBeTrue();

    $this->postJson("/api/admin/users/{$this->me->id}/reset-password")->assertUnprocessable();
});

it('supprime un autre membre, jamais soi-même', function () {
    $other = User::factory()->create(['email' => 'autre@zurcher.edu.mg']);
    $other->createToken('admin', ['admin']);

    $this->withToken($this->token)->deleteJson("/api/admin/users/{$other->id}")->assertOk();
    expect(User::query()->whereKey($other->id)->exists())->toBeFalse();
    expect($other->tokens()->count())->toBe(0);
    expect(AuditLog::query()->where('event', 'admin_user_deleted')->exists())->toBeTrue();

    $this->deleteJson("/api/admin/users/{$this->me->id}")->assertUnprocessable();
    expect(User::query()->whereKey($this->me->id)->exists())->toBeTrue();
});

it('interdit la gestion des comptes à un électeur ou sans jeton', function () {
    $election = draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);
    $voterToken = $election->voters()->create(['email' => 'e@zurcher.edu.mg'])->createToken('vote', ['vote'])->plainTextToken;

    $this->flushHeaders();
    app('auth')->forgetGuards();
    $this->getJson('/api/admin/users')->assertUnauthorized();

    $this->withToken($voterToken)->getJson('/api/admin/users')->assertForbidden();
    app('auth')->forgetGuards();
    $this->withToken($voterToken)->postJson('/api/admin/users', ['name' => 'X', 'email' => 'x@zurcher.edu.mg'])->assertForbidden();
});
