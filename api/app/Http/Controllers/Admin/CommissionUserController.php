<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

/**
 * Gestion des comptes de la commission électorale (les seuls accès à l'administration).
 * Chaque opération est inscrite au journal d'audit — par identifiant de compte, jamais par adresse ni mot de passe.
 */
class CommissionUserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $users = User::query()->withMax('tokens as last_login_at', 'created_at')->orderBy('name')->orderBy('id')->get();

        return response()->json(['data' => $users->map(fn (User $u) => $this->present($u, $request->user()))->all()]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->merge(['email' => strtolower(trim((string) $request->input('email')))]);

        $domain = config('vote.google.allowed_domain');
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email:rfc', 'max:255', 'unique:users,email', 'ends_with:@'.$domain],
            'password' => ['nullable', 'string', 'max:255', Password::min(10)->letters()->numbers()],
        ], [
            'email.unique' => 'Un compte existe déjà avec cette adresse.',
            'email.ends_with' => "L'adresse doit se terminer par @{$domain}.",
        ]);

        $generated = empty($data['password']);
        $password = $generated ? Str::password(16, symbols: false) : $data['password'];

        $user = User::query()->create(['name' => trim($data['name']), 'email' => $data['email'], 'password' => $password]);
        AuditLog::record('admin_user_created', null, ['user_id' => $request->user()->id, 'target_id' => $user->id]);

        return response()->json([
            'user' => $this->present($user, $request->user()),
            // Affiché une seule fois à la création, uniquement s'il a été généré ici.
            'password' => $generated ? $password : null,
        ], 201);
    }

    /** Nouveau mot de passe généré pour un autre membre (oubli) ; ses sessions ouvertes sont fermées. */
    public function resetPassword(Request $request, User $user): JsonResponse
    {
        if ($user->is($request->user())) {
            return response()->json(['message' => 'Pour votre propre compte, utilisez « Changer mon mot de passe ».'], 422);
        }

        $password = Str::password(16, symbols: false);
        $user->forceFill(['password' => $password])->save();
        $user->tokens()->delete();
        AuditLog::record('admin_password_reset', null, ['user_id' => $request->user()->id, 'target_id' => $user->id]);

        return response()->json(['password' => $password]);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        if ($user->is($request->user())) {
            return response()->json(['message' => 'Vous ne pouvez pas supprimer votre propre compte.'], 422);
        }

        $user->tokens()->delete();
        $user->delete();
        AuditLog::record('admin_user_deleted', null, ['user_id' => $request->user()->id, 'target_id' => $user->id]);

        return response()->json(['status' => 'deleted']);
    }

    /** @return array<string, mixed> */
    private function present(User $u, User $actor): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'email' => $u->email,
            'created_at' => $u->created_at,
            'last_login_at' => $u->last_login_at ? Carbon::parse($u->last_login_at)->toIso8601String() : null,
            'is_self' => $u->is($actor),
        ];
    }
}
