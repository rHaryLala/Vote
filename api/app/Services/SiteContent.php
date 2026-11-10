<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Textes modifiables du site.
 *
 * Le schéma (pages, champs, types, textes par défaut) vit dans resources/content/pages.json, fichier partagé
 * avec le front. La table site_contents ne garde que ce que la commission a modifié : effacer un champ
 * (ou le remettre à l'identique) revient au texte par défaut.
 */
class SiteContent
{
    private const LIMITS = ['text' => 255, 'textarea' => 5000, 'item_title' => 255, 'item_text' => 2000, 'list' => 20];

    /** @var array<int, array<string, mixed>>|null */
    private ?array $schema = null;

    /** @return array<int, array<string, mixed>> */
    public function schema(): array
    {
        return $this->schema ??= json_decode(
            (string) file_get_contents(resource_path('content/pages.json')),
            true,
            flags: JSON_THROW_ON_ERROR,
        )['pages'];
    }

    /** @return array<string, array<string, mixed>> Textes en vigueur : défaut, remplacé par les modifications enregistrées. */
    public function values(): array
    {
        $overrides = $this->overrides();
        $values = [];
        foreach ($this->schema() as $page) {
            foreach ($page['fields'] as $field) {
                $values[$page['key']][$field['key']] = $overrides[$page['key']][$field['key']] ?? $field['default'];
            }
        }

        return $values;
    }

    /**
     * Enregistre les textes d'une page. Un champ absent n'est pas touché ; un champ à null, vide ou identique
     * au texte par défaut revient au défaut.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed> Les textes en vigueur pour cette page
     */
    public function update(string $pageKey, array $data): array
    {
        $page = collect($this->schema())->firstWhere('key', $pageKey);
        if (! $page) {
            throw ValidationException::withMessages(['page' => 'Page inconnue.']);
        }

        $current = $this->overrides()[$pageKey] ?? [];
        $errors = [];

        foreach ($page['fields'] as $field) {
            if (! array_key_exists($field['key'], $data)) {
                continue;
            }
            $value = $this->normalize($field, $data[$field['key']], $errors);
            if ($value === null || $value === $field['default']) {
                unset($current[$field['key']]);
            } else {
                $current[$field['key']] = $value;
            }
        }

        $unknown = array_diff(array_keys($data), array_column($page['fields'], 'key'));
        foreach ($unknown as $key) {
            $errors[$key] = 'Champ inconnu.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        DB::transaction(function () use ($pageKey, $current) {
            DB::table('site_contents')->updateOrInsert(
                ['page' => $pageKey],
                ['data' => json_encode($current, JSON_UNESCAPED_UNICODE), 'updated_at' => now()],
            );
            AuditLog::record('content_updated', null, ['page' => $pageKey]);
        });

        return $this->values()[$pageKey];
    }

    /**
     * @param  array<string, mixed>  $field
     * @param  array<string, string>  $errors
     */
    private function normalize(array $field, mixed $value, array &$errors): mixed
    {
        $key = $field['key'];
        if ($value === null) {
            return null;
        }

        switch ($field['type']) {
            case 'text':
            case 'textarea':
                if (! is_string($value)) {
                    $errors[$key] = 'Texte attendu.';

                    return null;
                }
                $value = str_replace("\r\n", "\n", trim($value));
                if (mb_strlen($value) > self::LIMITS[$field['type']]) {
                    $errors[$key] = 'Texte trop long ('.self::LIMITS[$field['type']].' caractères au plus).';
                }

                return $value === '' ? null : $value;

            case 'lines':
                if (! is_array($value) || count($value) > self::LIMITS['list']) {
                    $errors[$key] = 'Liste invalide ('.self::LIMITS['list'].' lignes au plus).';

                    return null;
                }
                $lines = array_values(array_filter(array_map(fn ($l) => is_string($l) ? trim($l) : '', $value), fn ($l) => $l !== ''));
                foreach ($lines as $l) {
                    if (mb_strlen($l) > self::LIMITS['text']) {
                        $errors[$key] = 'Ligne trop longue.';
                    }
                }

                return $lines === [] ? null : $lines;

            case 'items':
                if (! is_array($value) || count($value) > self::LIMITS['list']) {
                    $errors[$key] = 'Liste invalide ('.self::LIMITS['list'].' éléments au plus).';

                    return null;
                }
                $items = [];
                foreach ($value as $item) {
                    $title = is_array($item) && is_string($item['title'] ?? null) ? trim($item['title']) : '';
                    $text = is_array($item) && is_string($item['text'] ?? null) ? trim(str_replace("\r\n", "\n", $item['text'])) : '';
                    if ($title === '' && $text === '') {
                        continue;
                    }
                    if (mb_strlen($title) > self::LIMITS['item_title'] || mb_strlen($text) > self::LIMITS['item_text']) {
                        $errors[$key] = 'Élément trop long.';
                    }
                    $items[] = ['title' => $title, 'text' => $text];
                }

                return $items === [] ? null : $items;
        }

        $errors[$key] = 'Type de champ inconnu.';

        return null;
    }

    /** @return array<string, array<string, mixed>> */
    private function overrides(): array
    {
        return DB::table('site_contents')->pluck('data', 'page')
            ->map(fn ($json) => json_decode((string) $json, true) ?: [])
            ->all();
    }
}
