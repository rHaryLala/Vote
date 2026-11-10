<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Réserve une route aux membres de la commission : jeton d'un User (jamais d'un électeur) portant la capacité « admin ».
 */
class EnsureCommission
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user instanceof User || ! $user->tokenCan('admin')) {
            return response()->json(['code' => 'forbidden', 'message' => 'Accès réservé à la commission électorale.'], 403);
        }

        return $next($request);
    }
}
