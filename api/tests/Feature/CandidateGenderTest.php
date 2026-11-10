<?php

use App\Models\Election;

function newElectionPayload(array $extra = []): array
{
    return [
        'title' => 'Élection du Président de la SA',
        'question' => 'Souhaitez-vous élire cette candidate ?',
        'candidate_name' => 'Mireille Test',
        'opens_at' => now()->addDay()->toIso8601String(),
        'closes_at' => now()->addDays(2)->toIso8601String(),
    ] + $extra;
}

it("enregistre le sexe du candidat à la création et l'expose à l'administration", function () {
    $this->withToken(adminToken())->postJson('/api/admin/elections', newElectionPayload(['candidate_gender' => 'f']))
        ->assertCreated()->assertJsonPath('data.candidate_gender', 'f');
});

it('garde le masculin par défaut (scrutins existants) et refuse une autre valeur', function () {
    $token = adminToken();

    $this->withToken($token)->postJson('/api/admin/elections', newElectionPayload())
        ->assertCreated()->assertJsonPath('data.candidate_gender', 'm');
    $this->postJson('/api/admin/elections', newElectionPayload(['candidate_gender' => 'x']))
        ->assertUnprocessable()->assertJsonValidationErrors('candidate_gender');
});

it("reste modifiable quand le scrutin est ouvert (il ne change que l'accord du verdict)", function () {
    $e = draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);

    $this->withToken(adminToken())->putJson("/api/admin/elections/{$e->id}", ['candidate_gender' => 'f'])
        ->assertOk()->assertJsonPath('data.candidate_gender', 'f');
    expect($e->fresh()->candidate_gender)->toBe('f');
});

it('expose le sexe du candidat sur la page publique', function () {
    draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour(), 'candidate_gender' => 'f']);

    $this->getJson('/api/election')->assertOk()->assertJsonPath('election.candidate.gender', 'f');
});
