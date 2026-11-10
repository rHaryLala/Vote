<?php

use App\Models\AuditLog;
use App\Models\Ballot;
use App\Models\Election;
use App\Models\User;
use App\Services\VoterImporter;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

// --- Authentification et cloisonnement ---------------------------------------------------------

it('connecte la commission et refuse un mauvais mot de passe', function () {
    User::factory()->create(['email' => 'c@zurcher.edu.mg', 'password' => 'mot-de-passe-solide']);

    $this->postJson('/api/admin/login', ['email' => 'c@zurcher.edu.mg', 'password' => 'faux'])
        ->assertStatus(422)->assertJsonPath('code', 'invalid_credentials');
    $this->postJson('/api/admin/login', ['email' => 'c@zurcher.edu.mg', 'password' => 'mot-de-passe-solide'])
        ->assertOk()->assertJsonStructure(['token', 'user' => ['name', 'email']]);
});

it("refuse l'administration sans jeton, et avec un jeton d'électeur", function () {
    $this->getJson('/api/admin/elections')->assertUnauthorized();

    $election = draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);
    $voterToken = $election->voters()->create(['email' => 'e@zurcher.edu.mg'])->createToken('vote', ['vote'])->plainTextToken;
    $this->withToken($voterToken)->getJson('/api/admin/elections')->assertForbidden();
});

it('un jeton de la commission ne permet pas de voter', function () {
    draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);

    $this->withToken(adminToken())->postJson('/api/vote', ['choice' => 'yes', 'receipt_hash' => str_repeat('a', 64)])
        ->assertForbidden();
    expect(Ballot::count())->toBe(0);
});

// --- Scrutins ----------------------------------------------------------------------------------

it('crée un scrutin avec des heures de Madagascar, stockées en UTC', function () {
    $this->withToken(adminToken())->postJson('/api/admin/elections', [
        'title' => 'Référendum SA 2030',
        'question' => 'Acceptez-vous ce candidat ?',
        'candidate_name' => 'Candidat Unique',
        'opens_at' => '2030-06-01T08:00:00+03:00',
        'closes_at' => '2030-06-01T18:00:00+03:00',
    ])->assertCreated()
        ->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.opens_at', '2030-06-01T05:00:00Z');

    $e = Election::firstOrFail();
    expect($e->getRawOriginal('opens_at'))->toBe('2030-06-01 05:00:00')
        ->and($e->getRawOriginal('closes_at'))->toBe('2030-06-01 15:00:00');
});

it("refuse une clôture antérieure à l'ouverture", function () {
    $this->withToken(adminToken())->postJson('/api/admin/elections', [
        'title' => 'T', 'question' => 'Q', 'candidate_name' => 'C',
        'opens_at' => '2030-06-01T18:00:00+03:00', 'closes_at' => '2030-06-01T08:00:00+03:00',
    ])->assertStatus(422)->assertJsonValidationErrors('closes_at');
});

it("modifie tout le scrutin tant qu'il est en brouillon", function () {
    $e = draftElection();
    $this->withToken(adminToken())->putJson("/api/admin/elections/{$e->id}", [
        'candidate_name' => 'Nouveau nom', 'candidate_program' => "Un\nDeux", 'quorum_percent' => 30,
    ])->assertOk()->assertJsonPath('data.candidate_name', 'Nouveau nom')->assertJsonPath('data.quorum_percent', 30);
});

it("fige le candidat et la règle après l'ouverture, mais laisse modifier les dates (journalisé)", function () {
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $e->start();
    $token = adminToken();

    $this->withToken($token)->putJson("/api/admin/elections/{$e->id}", ['candidate_name' => 'Autre'])
        ->assertStatus(409)->assertJsonPath('code', 'locked');
    $this->withToken($token)->putJson("/api/admin/elections/{$e->id}", ['quorum_percent' => 10])->assertStatus(409);

    // Prolonger le vote : autorisé, et inscrit au journal avec l'ancienne et la nouvelle heure.
    $newClose = now()->addDays(3)->startOfMinute();
    $this->withToken($token)->putJson("/api/admin/elections/{$e->id}", ['closes_at' => $newClose->toIso8601String()])
        ->assertOk();
    expect($e->fresh()->closes_at->equalTo($newClose))->toBeTrue();

    $log = AuditLog::where('event', 'election_dates_changed')->firstOrFail();
    expect($log->payload['closes_at'])->toHaveKeys(['avant', 'après'])
        ->and(AuditLog::verifyChain())->toBeNull();
});

it('refuse de mettre une clôture déjà passée sur un scrutin ouvert', function () {
    $e = draftElection(['opens_at' => now()->subHours(2)]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $e->start();

    $this->withToken(adminToken())->putJson("/api/admin/elections/{$e->id}", ['closes_at' => now()->subMinute()->toIso8601String()])
        ->assertStatus(409);
});

it('fige les dates une fois le scrutin clos', function () {
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $e->start();
    $e->fresh()->finish();

    $this->withToken(adminToken())->putJson("/api/admin/elections/{$e->id}", ['closes_at' => now()->addWeek()->toIso8601String()])
        ->assertStatus(409);
});

it("ouvre, clôt puis publie par l'API, et seulement avec une liste électorale", function () {
    $e = draftElection(['opens_at' => now()->subHour()]);
    $token = adminToken();

    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/open")->assertStatus(409);

    $this->withToken($token)->post("/api/admin/elections/{$e->id}/voters/import", [
        'file' => UploadedFile::fake()->createWithContent('liste.csv', "email;student_id\na@zurcher.edu.mg;1\nb@zurcher.edu.mg;2\n"),
    ], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.valid', 2);

    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/open")->assertOk()->assertJsonPath('data.status', 'open');
    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/publish")->assertStatus(409);
    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/close")->assertOk()->assertJsonPath('data.status', 'closed');
    $this->withToken($token)->postJson("/api/admin/elections/{$e->id}/publish")->assertOk()->assertJsonPath('data.results_published', true);

    expect(AuditLog::pluck('event')->all())->toContain('voters_imported', 'election_opened', 'election_closed', 'results_published');
});

it('ne montre aucun décompte à la commission avant la clôture', function () {
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg', 'has_voted' => true]);
    $e->start();
    Ballot::create(['id' => bin2hex(random_bytes(16)), 'election_id' => $e->id, 'choice' => 'yes', 'receipt_hash' => hash('sha256', 'x')]);
    $token = adminToken();

    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}")
        ->assertOk()->assertJsonPath('data.tally', null)->assertJsonPath('data.stats.voted', 1);

    $e->fresh()->finish();
    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}")->assertJsonPath('data.tally.yes', 1);
});

it("ne supprime qu'un scrutin en brouillon", function () {
    $token = adminToken();
    $open = draftElection(['opens_at' => now()->subHour()]);
    $open->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $open->start();
    $this->withToken($token)->deleteJson("/api/admin/elections/{$open->id}")->assertStatus(409);

    $draft = draftElection();
    $this->withToken($token)->deleteJson("/api/admin/elections/{$draft->id}")->assertOk();
    expect(Election::find($draft->id))->toBeNull();
});

it('liste les électeurs avec recherche et filtre « a voté »', function () {
    $e = draftElection();
    $e->voters()->create(['email' => 'jean@zurcher.edu.mg', 'student_id' => 'S1', 'has_voted' => true]);
    $e->voters()->create(['email' => 'marie@zurcher.edu.mg', 'student_id' => 'S2']);
    $token = adminToken();

    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}/voters?search=mar")
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'marie@zurcher.edu.mg');
    $this->withToken($token)->getJson("/api/admin/elections/{$e->id}/voters?voted=yes")
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'jean@zurcher.edu.mg');
});

// --- Import de la liste électorale -------------------------------------------------------------

it('importe un CSV du registrar en filtrant les adresses hors domaine et les doublons', function () {
    $election = draftElection();
    $csv = csvFile("email;student_id\nJean@Zurcher.edu.mg;S1\nmarie@zurcher.edu.mg;S2\njean@zurcher.edu.mg;S1\nintrus@gmail.com;S3\nn'importe quoi;S4\n");

    expect(app(VoterImporter::class)->import($election, $csv))->toMatchArray(['valid' => 2, 'invalid' => 2, 'duplicate' => 1, 'added' => 2, 'removed' => 0])
        ->and($election->voters()->pluck('email')->sort()->values()->all())->toBe(['jean@zurcher.edu.mg', 'marie@zurcher.edu.mg']);
});

it('un import est rejouable et refusé une fois le scrutin ouvert', function () {
    $election = draftElection();
    app(VoterImporter::class)->import($election, csvFile("email\na@zurcher.edu.mg\nb@zurcher.edu.mg\n"));
    app(VoterImporter::class)->import($election, csvFile("email\nc@zurcher.edu.mg\n"));
    expect($election->voters()->pluck('email')->all())->toBe(['c@zurcher.edu.mg']);

    $election->start();
    expect(fn () => app(VoterImporter::class)->import($election->fresh(), csvFile("email\nd@zurcher.edu.mg\n")))
        ->toThrow(InvalidArgumentException::class, 'brouillon');
});

it("clôt automatiquement les scrutins dont l'heure est passée", function () {
    $election = draftElection(['opens_at' => now()->subDay(), 'closes_at' => now()->addMinute()]);
    $election->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $election->start();

    $this->travel(2)->minutes();
    $this->artisan('elections:close-expired')->assertSuccessful();

    expect($election->fresh()->status)->toBe(Election::STATUS_CLOSED);
});

// --- Journal d'audit ---------------------------------------------------------------------------

it("expose le journal d'audit et sa vérification", function () {
    $token = adminToken(); // la connexion est elle-même journalisée
    $this->withToken($token)->getJson('/api/admin/audit')->assertOk()->assertJsonPath('data.0.event', 'admin_login');
    $this->withToken($token)->getJson('/api/admin/audit/verify')->assertOk()->assertJson(['intact' => true]);
});

// --- Contenu des pages -------------------------------------------------------------------------

it('sert les textes par défaut, puis les textes modifiés par la commission', function () {
    $this->getJson('/api/content')->assertOk()
        ->assertJsonPath('pages.home.about_title', 'La SA')
        ->assertJsonPath('pages.vote.yes_label', 'Oui');

    $token = adminToken();
    $this->withToken($token)->putJson('/api/admin/content/home', [
        'about_title' => 'Notre association',
        'tags' => ['Un', '', 'Deux'],
        'steps' => [['title' => 'Étape', 'text' => 'Texte'], ['title' => '', 'text' => '']],
    ])->assertOk()->assertJsonPath('values.about_title', 'Notre association');

    $this->getJson('/api/content')
        ->assertJsonPath('pages.home.about_title', 'Notre association')
        ->assertJsonPath('pages.home.tags', ['Un', 'Deux'])
        ->assertJsonPath('pages.home.steps', [['title' => 'Étape', 'text' => 'Texte']])
        ->assertJsonPath('pages.home.hero_eyebrow', 'Élection présidentielle'); // champ non touché

    // Effacer un champ = revenir au texte par défaut.
    $this->withToken($token)->putJson('/api/admin/content/home', ['about_title' => null])->assertOk();
    $this->getJson('/api/content')->assertJsonPath('pages.home.about_title', 'La SA');

    expect(AuditLog::where('event', 'content_updated')->count())->toBe(2);
});

it('refuse un champ inconnu, une page inconnue ou un texte trop long', function () {
    $token = adminToken();
    $this->withToken($token)->putJson('/api/admin/content/home', ['nope' => 'x'])->assertStatus(422);
    $this->withToken($token)->putJson('/api/admin/content/inconnue', ['x' => 'y'])->assertStatus(422);
    $this->withToken($token)->putJson('/api/admin/content/home', ['about_title' => str_repeat('a', 300)])->assertStatus(422);
});

it("réserve l'édition du contenu à la commission", function () {
    $this->putJson('/api/admin/content/home', ['about_title' => 'x'])->assertUnauthorized();
});

it("l'éditeur reçoit le schéma complet avec les valeurs en vigueur", function () {
    $this->withToken(adminToken())->getJson('/api/admin/content')->assertOk()
        ->assertJsonPath('pages.0.key', 'general')
        ->assertJsonStructure(['pages' => [['key', 'label', 'fields' => [['key', 'label', 'type', 'default']], 'values']]]);
});

// --- Photo du candidat ---------------------------------------------------------------------------

it('renvoie une adresse de photo relative, quel que soit APP_URL (même origine que le site)', function () {
    // APP_URL / disque « public » pointent ailleurs (ex. le port d'un autre serveur) : l'adresse ne doit pas en dépendre.
    config(['filesystems.disks.public.url' => 'http://localhost:8000/storage']);
    draftElection(['candidate_photo' => 'candidates/abc.jpg', 'status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);

    $this->getJson('/api/election')->assertOk()->assertJsonPath('election.candidate.photo', '/storage/candidates/abc.jpg');

    $id = Election::firstOrFail()->id;
    $this->withToken(adminToken())->getJson("/api/admin/elections/{$id}")->assertJsonPath('data.candidate_photo_url', '/storage/candidates/abc.jpg');
});

it("n'a pas d'adresse de photo quand il n'y en a pas", function () {
    draftElection(['status' => Election::STATUS_OPEN, 'opens_at' => now()->subHour()]);

    $this->getJson('/api/election')->assertJsonPath('election.candidate.photo', null);
});

it('enregistre la photo du candidat, remplace l\'ancienne et supprime son fichier', function () {
    Storage::fake('public');
    $e = draftElection();
    $token = adminToken();

    $first = $this->withToken($token)->post("/api/admin/elections/{$e->id}/photo", ['photo' => UploadedFile::fake()->image('a.jpg', 300, 300)], ['Accept' => 'application/json'])
        ->assertOk()->json('data.candidate_photo_url');
    expect($first)->toStartWith('/storage/candidates/');
    Storage::disk('public')->assertExists(ltrim(substr($first, strlen('/storage/')), '/'));

    $second = $this->withToken($token)->post("/api/admin/elections/{$e->id}/photo", ['photo' => UploadedFile::fake()->image('b.png', 300, 300)], ['Accept' => 'application/json'])
        ->assertOk()->json('data.candidate_photo_url');

    expect($second)->not->toBe($first);
    Storage::disk('public')->assertMissing(substr($first, strlen('/storage/')));
    Storage::disk('public')->assertExists(substr($second, strlen('/storage/')));
});

it("refuse une photo qui n'en est pas une, ou trop lourde", function () {
    Storage::fake('public');
    $e = draftElection();
    $token = adminToken();

    $this->withToken($token)->post("/api/admin/elections/{$e->id}/photo", ['photo' => UploadedFile::fake()->create('script.php', 10, 'text/x-php')], ['Accept' => 'application/json'])->assertStatus(422);
    $this->withToken($token)->post("/api/admin/elections/{$e->id}/photo", ['photo' => UploadedFile::fake()->image('enorme.jpg')->size(5000)], ['Accept' => 'application/json'])->assertStatus(422);

    expect(Storage::disk('public')->allFiles())->toBe([]);
});

it('refuse de changer la photo une fois le scrutin ouvert, sans laisser de fichier orphelin', function () {
    Storage::fake('public');
    $e = draftElection(['opens_at' => now()->subHour()]);
    $e->voters()->create(['email' => 'a@zurcher.edu.mg']);
    $e->start();

    $this->withToken(adminToken())->post("/api/admin/elections/{$e->id}/photo", ['photo' => UploadedFile::fake()->image('c.jpg')], ['Accept' => 'application/json'])
        ->assertStatus(409)->assertJsonPath('code', 'locked');

    expect(Storage::disk('public')->allFiles())->toBe([]);
});
