<?php

use App\Models\AuditLog;
use App\Models\Ballot;
use App\Models\Election;
use App\Models\Voter;
use App\Services\GoogleIdentity;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

function bulkDelete(string $token, array $ids, ?string $confirmation = null)
{
    return test()->withToken($token)->postJson('/api/admin/elections/bulk-delete', array_filter([
        'ids' => $ids,
        'confirmation' => $confirmation,
    ], fn ($v) => $v !== null));
}

/** Scrutin ouvert avec 2 électeurs, dont 1 a voté (1 bulletin). */
function openWithVotes(array $overrides = []): Election
{
    $e = draftElection($overrides + ['opens_at' => now()->subHour()]);
    $a = $e->voters()->create(['email' => 'a@zurcher.edu.mg', 'has_voted' => true]);
    $e->voters()->create(['email' => 'b@zurcher.edu.mg']);
    $e->start();
    Ballot::create(['id' => bin2hex(random_bytes(16)), 'election_id' => $e->id, 'choice' => 'yes', 'receipt_hash' => hash('sha256', 'recu-'.$a->id.$e->id)]);

    return $e->fresh();
}

/** Scrutin d'un passé lointain, clos et dont les résultats sont publiés (créé tel quel : start() refuserait ses dates). */
function oldPublishedElection(string $title, int $daysAgo): Election
{
    return draftElection([
        'title' => $title,
        'status' => Election::STATUS_CLOSED,
        'results_published' => true,
        'opens_at' => now()->subDays($daysAgo),
        'closes_at' => now()->subDays($daysAgo - 1),
    ]);
}

function closedElection(bool $published, array $overrides = []): Election
{
    $e = openWithVotes($overrides);
    $e->finish();
    if ($published) {
        $e->fresh()->publishResults();
    }

    return $e->fresh();
}

// --- Suppression -------------------------------------------------------------------------------

it('supprime un brouillon sans confirmation supplémentaire, avec sa liste électorale et sa photo', function () {
    Storage::fake('public');
    Storage::disk('public')->put('candidates/photo.jpg', 'x');
    $e = draftElection(['candidate_photo' => 'candidates/photo.jpg']);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);

    bulkDelete(adminToken(), [$e->id])->assertOk()->assertJsonPath('data.deleted', 1);

    expect(Election::find($e->id))->toBeNull()
        ->and(Voter::count())->toBe(0);
    Storage::disk('public')->assertMissing('candidates/photo.jpg');
});

it('exige de taper SUPPRIMER pour un scrutin ouvert, et efface alors ses bulletins', function () {
    $e = openWithVotes();
    $token = adminToken();

    bulkDelete($token, [$e->id])->assertStatus(422)->assertJsonValidationErrors('confirmation');
    bulkDelete($token, [$e->id], 'supprimer')->assertStatus(422);
    bulkDelete($token, [$e->id], 'oui')->assertStatus(422);
    expect(Election::find($e->id))->not->toBeNull()->and(Ballot::count())->toBe(1);

    bulkDelete($token, [$e->id], 'SUPPRIMER')->assertOk()->assertJsonPath('data.deleted', 1)->assertJsonPath('data.ballots', 1);

    expect(Election::find($e->id))->toBeNull()
        ->and(Ballot::count())->toBe(0)
        ->and(Voter::count())->toBe(0);
});

it('supprime aussi un scrutin clos, publié ou non', function () {
    $a = closedElection(published: true);
    $b = closedElection(false, ['title' => 'Autre']);

    bulkDelete(adminToken(), [$a->id, $b->id], 'SUPPRIMER')->assertOk()->assertJsonPath('data.deleted', 2);
    expect(Election::count())->toBe(0);
});

it('supprime plusieurs scrutins en une fois, brouillons et ouverts mêlés', function () {
    $draft = draftElection(['title' => 'Brouillon']);
    $open = openWithVotes(['title' => 'En cours']);
    $token = adminToken();

    // Un seul scrutin non brouillon dans le lot suffit à exiger la confirmation.
    bulkDelete($token, [$draft->id, $open->id])->assertStatus(422);
    expect(Election::count())->toBe(2);

    bulkDelete($token, [$draft->id, $open->id], 'SUPPRIMER')->assertOk()->assertJsonPath('data.deleted', 2);
    expect(Election::count())->toBe(0);
});

it("est « tout ou rien » : un identifiant inconnu n'en supprime aucun", function () {
    $a = draftElection(['title' => 'A']);
    $b = draftElection(['title' => 'B']);

    bulkDelete(adminToken(), [$a->id, $b->id, 99999])->assertStatus(404)->assertJsonPath('code', 'not_found');

    expect(Election::count())->toBe(2);
});

it('valide la demande : liste obligatoire, bornée, sans doublon', function () {
    $e = draftElection();
    $token = adminToken();

    test()->withToken($token)->postJson('/api/admin/elections/bulk-delete', [])->assertStatus(422)->assertJsonValidationErrors('ids');
    test()->withToken($token)->postJson('/api/admin/elections/bulk-delete', ['ids' => []])->assertStatus(422);
    test()->withToken($token)->postJson('/api/admin/elections/bulk-delete', ['ids' => [$e->id, $e->id]])->assertStatus(422);
    test()->withToken($token)->postJson('/api/admin/elections/bulk-delete', ['ids' => range(1, 51)])->assertStatus(422);
    test()->withToken($token)->postJson('/api/admin/elections/bulk-delete', ['ids' => ['abc']])->assertStatus(422);

    expect(Election::count())->toBe(1);
});

it("journalise la suppression (compteurs, jamais d'adresse) et le journal survit à la suppression", function () {
    $e = openWithVotes(['title' => 'Scrutin de test']);
    $id = $e->id;

    bulkDelete(adminToken(), [$id], 'SUPPRIMER')->assertOk();

    $log = AuditLog::where('event', 'election_deleted')->firstOrFail();
    expect($log->election_id)->toBe($id) // le journal garde l'identifiant du scrutin supprimé
        ->and($log->payload)->toMatchArray(['election_id' => $id, 'title' => 'Scrutin de test', 'status' => 'open', 'registered' => 2, 'voted' => 1, 'ballots' => 1])
        ->and($log->payload)->toHaveKey('user_id')
        ->and(json_encode($log->payload))->not->toContain('zurcher.edu.mg')
        ->and(AuditLog::verifyChain())->toBeNull();
    // Les anciennes entrées du scrutin (ouverture…) restent INTACTES : même identifiant, donc même empreinte.
    expect(AuditLog::where('event', 'election_opened')->firstOrFail()->election_id)->toBe($id);
});

it('révoque les sessions de vote des électeurs du scrutin supprimé', function () {
    $e = openWithVotes();
    $session = $e->voters()->where('email', 'b@zurcher.edu.mg')->first()->createToken('vote', ['vote'])->plainTextToken;
    $this->withToken($session)->getJson('/api/me')->assertOk();
    app('auth')->forgetGuards();

    bulkDelete(adminToken(), [$e->id], 'SUPPRIMER')->assertOk();

    expect(DB::table('personal_access_tokens')->where('tokenable_type', Voter::class)->count())->toBe(0);
    app('auth')->forgetGuards();
    $this->flushHeaders();
    $this->withToken($session)->getJson('/api/me')->assertUnauthorized();
});

it('ne supprime rien sans être de la commission', function () {
    $e = draftElection();
    $voterToken = openWithVotes()->voters()->first()->createToken('vote', ['vote'])->plainTextToken;

    $this->postJson('/api/admin/elections/bulk-delete', ['ids' => [$e->id]])->assertUnauthorized();
    $this->withToken($voterToken)->postJson('/api/admin/elections/bulk-delete', ['ids' => [$e->id]])->assertForbidden();
    expect(Election::count())->toBe(2);
});

it("n'offre plus de suppression unitaire par DELETE (une seule voie, avec confirmation)", function () {
    $e = draftElection();

    $this->withToken(adminToken())->deleteJson("/api/admin/elections/{$e->id}")->assertStatus(405);
    expect(Election::find($e->id))->not->toBeNull();
});

// --- Visibilité publique -----------------------------------------------------------------------

it("n'affiche au public qu'un scrutin en cours, ou clos avec résultats publiés", function (string $kind, bool $visible) {
    match ($kind) {
        'draft' => draftElection(),
        'open' => openWithVotes(),
        'closed' => closedElection(published: false),
        'published' => closedElection(published: true),
    };

    $election = $this->getJson('/api/election')->assertOk()->json('election');
    expect($election !== null)->toBe($visible);
})->with([
    'brouillon' => ['draft', false],
    'en cours' => ['open', true],
    'clos, résultats non publiés' => ['closed', false],
    'clos, résultats publiés' => ['published', true],
]);

it('un scrutin clos et non publié disparaît du site : plus de connexion, plus de résultats', function () {
    closedElection(published: false);
    app()->bind(GoogleIdentity::class, fn () => new class implements GoogleIdentity
    {
        public function verify(string $idToken): ?array
        {
            return ['email' => 'a@zurcher.edu.mg', 'name' => 'A', 'picture' => null];
        }
    });

    $this->getJson('/api/election')->assertJsonPath('election', null);
    $this->getJson('/api/results')->assertNotFound();
    $this->postJson('/api/auth/google', ['credential' => 'ok:a@zurcher.edu.mg'])->assertStatus(404)->assertJsonPath('code', 'no_election');
});

it("publier les résultats d'un scrutin clos le rend à nouveau visible", function () {
    $e = closedElection(published: false);
    $this->getJson('/api/election')->assertJsonPath('election', null);

    $e->publishResults();

    $this->getJson('/api/election')->assertJsonPath('election.id', $e->id);
    $this->getJson('/api/results')->assertOk()->assertJsonPath('results.cast', 1);
});

it('un scrutin supprimé ne s\'affiche plus, et le site retombe sur le précédent visible', function () {
    $old = oldPublishedElection('Ancien scrutin', 30);
    $current = openWithVotes(['title' => 'Scrutin en cours']);
    $this->getJson('/api/election')->assertJsonPath('election.id', $current->id);

    $token = adminToken();
    bulkDelete($token, [$current->id], 'SUPPRIMER')->assertOk();

    $this->getJson('/api/election')->assertJsonPath('election.id', $old->id);

    bulkDelete($token, [$old->id], 'SUPPRIMER')->assertOk();
    $this->getJson('/api/election')->assertJsonPath('election', null);
});

it('préfère le scrutin en cours à un ancien scrutin dont les résultats sont publiés', function () {
    oldPublishedElection('Ancien', 60);
    $current = openWithVotes(['title' => 'En cours']);

    $this->getJson('/api/election')->assertJsonPath('election.id', $current->id);
});

it("garde un reçu vérifiable après la clôture même si le scrutin n'est plus affiché, mais plus après sa suppression", function () {
    $e = closedElection(published: false);
    $hash = Ballot::firstOrFail()->receipt_hash;

    $this->getJson('/api/election')->assertJsonPath('election', null);
    $this->getJson("/api/receipts/{$hash}")->assertOk()->assertExactJson(['found' => true]);

    bulkDelete(adminToken(), [$e->id], 'SUPPRIMER')->assertOk();
    $this->flushHeaders();
    $this->getJson("/api/receipts/{$hash}")->assertOk()->assertExactJson(['found' => false]);
});

it('indique à la commission quels scrutins sont visibles du public', function () {
    draftElection(['title' => 'Brouillon']);
    openWithVotes(['title' => 'En cours']);
    closedElection(false, ['title' => 'Clos non publié']);
    closedElection(true, ['title' => 'Clos publié']);

    $rows = collect($this->withToken(adminToken())->getJson('/api/admin/elections')->assertOk()->json('data'))->pluck('public_visible', 'title')->all();

    expect($rows)->toBe(['Brouillon' => false, 'En cours' => true, 'Clos non publié' => false, 'Clos publié' => true]);
});
