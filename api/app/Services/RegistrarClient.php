<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Lecture des étudiants inscrits dans le registrar, par son export dédié (lecture seule, protégé par jeton).
 * Voir deploy/registrar/README.md.
 */
class RegistrarClient
{
    public function isConfigured(): bool
    {
        return $this->url() !== '' && $this->token() !== '';
    }

    /**
     * Sessions récentes du registrar et leur nombre d'inscrits.
     *
     * @return list<array{id: int, name: string, year: string, semester: int, selected: bool, enrolled: int}>
     *
     * @throws RegistrarException
     */
    public function sessions(): array
    {
        $data = $this->get(['action' => 'sessions']);
        if (! is_array($data['sessions'] ?? null)) {
            throw new RegistrarException('Réponse du registrar inattendue (liste des sessions).');
        }

        return array_values(array_map(fn ($s) => [
            'id' => (int) ($s['id'] ?? 0),
            'name' => (string) ($s['name'] ?? ''),
            'year' => (string) ($s['year'] ?? ''),
            'semester' => (int) ($s['semester'] ?? 0),
            'selected' => (bool) ($s['selected'] ?? false),
            'enrolled' => (int) ($s['enrolled'] ?? 0),
        ], $data['sessions']));
    }

    /**
     * Étudiants inscrits à une session.
     *
     * @return array{session: array<string, mixed>, counts: array{enrolled: int, eligible: int, without_email: int}, voters: list<array{email: string, student_id: string|null}>}
     *
     * @throws RegistrarException
     */
    public function voters(int $sessionId): array
    {
        $data = $this->get(['action' => 'voters', 'session_id' => $sessionId]);
        if (! is_array($data['session'] ?? null) || ! is_array($data['voters'] ?? null) || ! is_array($data['counts'] ?? null)) {
            throw new RegistrarException('Réponse du registrar inattendue (liste des étudiants).');
        }

        return [
            'session' => [
                'id' => (int) ($data['session']['id'] ?? 0),
                'name' => (string) ($data['session']['name'] ?? ''),
                'year' => (string) ($data['session']['year'] ?? ''),
                'semester' => (int) ($data['session']['semester'] ?? 0),
            ],
            'counts' => [
                'enrolled' => (int) ($data['counts']['enrolled'] ?? 0),
                'eligible' => (int) ($data['counts']['eligible'] ?? 0),
                'without_email' => (int) ($data['counts']['without_email'] ?? 0),
            ],
            'voters' => array_values(array_map(fn ($v) => [
                'email' => (string) ($v['email'] ?? ''),
                'student_id' => isset($v['student_id']) ? (string) $v['student_id'] : null,
            ], array_filter($data['voters'], 'is_array'))),
        ];
    }

    /**
     * @param  array<string, scalar>  $query
     * @return array<string, mixed>
     *
     * @throws RegistrarException
     */
    private function get(array $query): array
    {
        if (! $this->isConfigured()) {
            throw new RegistrarException("La synchronisation avec le registrar n'est pas configurée (REGISTRAR_EXPORT_URL et REGISTRAR_EXPORT_TOKEN).");
        }
        $this->assertSecureUrl();

        try {
            $response = $this->request()->get($this->url(), $query);
        } catch (ConnectionException $e) {
            // Jamais le jeton ni l'URL complète dans les journaux.
            Log::warning('Registrar injoignable : '.class_basename($e));

            throw new RegistrarException('Le registrar est injoignable. Réessayez dans un instant.');
        }

        $status = $response->status();
        if ($status === 401 || $status === 403) {
            throw new RegistrarException("Le registrar a refusé l'accès : vérifiez le jeton (REGISTRAR_EXPORT_TOKEN).");
        }
        if ($status === 503) {
            throw new RegistrarException("L'export n'est pas activé côté registrar.");
        }
        if ($status === 404 || $status === 422) {
            throw new RegistrarException((string) ($response->json('message') ?? 'Session introuvable dans le registrar.'));
        }
        if (! $response->successful()) {
            Log::warning("Registrar : réponse HTTP {$status}");

            throw new RegistrarException("Le registrar a répondu par une erreur ({$status}).");
        }

        // Tolère un BOM UTF-8 résiduel devant le JSON.
        $data = json_decode(ltrim($response->body(), "\xEF\xBB\xBF \t\n\r"), true);
        if (! is_array($data)) {
            throw new RegistrarException('Réponse du registrar illisible (JSON attendu).');
        }

        return $data;
    }

    private function request(): PendingRequest
    {
        return Http::withToken($this->token())
            ->acceptJson()
            ->timeout((int) config('vote.registrar.timeout', 20))
            ->withoutRedirecting(); // un jeton ne doit jamais suivre une redirection vers un autre hôte
    }

    /** Les adresses d'étudiants circulent : HTTPS obligatoire, sauf boucle locale (développement). */
    private function assertSecureUrl(): void
    {
        $parts = parse_url($this->url());
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $local = in_array($host, ['localhost', '127.0.0.1', '::1'], true);

        if ($scheme !== 'https' && ! ($scheme === 'http' && $local)) {
            throw new RegistrarException("L'adresse du registrar doit être en HTTPS (REGISTRAR_EXPORT_URL).");
        }
    }

    private function url(): string
    {
        return trim((string) config('vote.registrar.url'));
    }

    private function token(): string
    {
        return trim((string) config('vote.registrar.token'));
    }
}
