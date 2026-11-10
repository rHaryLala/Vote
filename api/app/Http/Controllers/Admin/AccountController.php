<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

/** Compte du membre connecté : changement de son propre mot de passe. */
class AccountController extends Controller
{
    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'current_password' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255', 'confirmed', Password::min(10)->letters()->numbers()],
        ]);

        if (! Hash::check($data['current_password'], $user->password)) {
            return response()->json([
                'message' => 'Le mot de passe actuel est incorrect.',
                'errors' => ['current_password' => ['Le mot de passe actuel est incorrect.']],
            ], 422);
        }
        if (Hash::check($data['password'], $user->password)) {
            return response()->json([
                'message' => "Le nouveau mot de passe doit différer de l'actuel.",
                'errors' => ['password' => ["Le nouveau mot de passe doit différer de l'actuel."]],
            ], 422);
        }

        $user->forceFill(['password' => $data['password']])->save();

        // Les autres sessions ouvertes (autre appareil, jeton volé…) sont fermées ; celle-ci continue.
        $user->tokens()->where('id', '!=', $request->user()->currentAccessToken()->id)->delete();

        AuditLog::record('admin_password_changed', null, ['user_id' => $user->id]);

        return response()->json(['status' => 'password_changed']);
    }
}
