<?php

namespace App\Http\Controllers;

use App\Services\SiteContent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContentController extends Controller
{
    /** Public : textes en vigueur de toutes les pages. */
    public function index(SiteContent $content): JsonResponse
    {
        return response()->json(['pages' => $content->values()]);
    }

    /** Commission : schéma (libellés, types, textes par défaut) + textes en vigueur, pour l'éditeur. */
    public function editor(SiteContent $content): JsonResponse
    {
        $values = $content->values();

        return response()->json([
            'pages' => collect($content->schema())->map(fn (array $page) => $page + ['values' => $values[$page['key']]])->values(),
        ]);
    }

    public function update(Request $request, string $page, SiteContent $content): JsonResponse
    {
        return response()->json(['values' => $content->update($page, $request->all())]);
    }
}
