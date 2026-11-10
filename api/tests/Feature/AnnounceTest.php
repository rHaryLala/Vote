<?php

use App\Models\AuditLog;
use App\Models\Election;

it("n'affiche pas un brouillon sur le site tant que la commission ne l'a pas annoncé", function () {
    draftElection(['candidate_name' => 'Mireille Test']);

    $this->getJson('/api/election')->assertOk()->assertJsonPath('election', null);
});

it('annonce le candidat : visible sur le site, en brouillon, sans possibilité de voter', function () {
    $e = draftElection(['candidate_name' => 'Mireille Test', 'opens_at' => now()->addDays(2), 'closes_at' => now()->addDays(3)]);

    $this->withToken(adminToken())->putJson("/api/admin/elections/{$e->id}/announce", ['announced' => true])
        ->assertOk()->assertJsonPath('data.announced', true)->assertJsonPath('data.public_visible', true);

    $this->flushHeaders();
    app('auth')->forgetGuards();
    $this->getJson('/api/election')->assertOk()
        ->assertJsonPath('election.candidate.name', 'Mireille Test')
        ->assertJsonPath('election.status', 'draft')
        ->assertJsonPath('election.is_open', false);

    expect(AuditLog::query()->where('event', 'candidate_announced')->where('election_id', $e->id)->exists())->toBeTrue();
});

it("refuse la connexion d'un étudiant tant que le scrutin annoncé n'est pas ouvert", function () {
    fakeGoogle();
    $e = draftElection(['announced' => true]);
    $e->voters()->create(['email' => 'etudiant@zurcher.edu.mg']);

    $this->postJson('/api/auth/google', ['credential' => 'ok:etudiant@zurcher.edu.mg'])
        ->assertStatus(409)->assertJsonPath('code', 'not_open_yet');
});

it("retire l'annonce, sans doublon dans le journal quand rien ne change", function () {
    $e = draftElection(['announced' => true]);
    $token = adminToken();

    $this->withToken($token)->putJson("/api/admin/elections/{$e->id}/announce", ['announced' => true])->assertOk();
    expect(AuditLog::query()->where('event', 'candidate_announced')->count())->toBe(0);   // déjà annoncé : rien à journaliser

    $this->putJson("/api/admin/elections/{$e->id}/announce", ['announced' => false])->assertOk()->assertJsonPath('data.announced', false);
    expect(AuditLog::query()->where('event', 'candidate_unannounced')->count())->toBe(1);
    $this->getJson('/api/election')->assertOk()->assertJsonPath('election', null);
});

it("n'annonce que les brouillons", function () {
    $open = draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);
    $closed = draftElection(['status' => Election::STATUS_CLOSED]);
    $token = adminToken();

    $this->withToken($token)->putJson("/api/admin/elections/{$open->id}/announce", ['announced' => true])->assertStatus(409);
    $this->putJson("/api/admin/elections/{$closed->id}/announce", ['announced' => true])->assertStatus(409);
    $this->putJson("/api/admin/elections/{$open->id}/announce", [])->assertUnprocessable();
});

it('un scrutin ouvert passe avant un brouillon annoncé pour le site public', function () {
    draftElection(['title' => 'Prochain', 'announced' => true, 'opens_at' => now()->addDays(10), 'closes_at' => now()->addDays(11)]);
    draftElection(['title' => 'En cours', 'status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);

    $this->getJson('/api/election')->assertOk()->assertJsonPath('election.title', 'En cours');
});
