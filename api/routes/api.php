<?php

use App\Http\Controllers\Admin\AuditController;
use App\Http\Controllers\Admin\AuthController as AdminAuthController;
use App\Http\Controllers\Admin\ElectionController as AdminElectionController;
use App\Http\Controllers\Admin\RegistrarController;
use App\Http\Controllers\Admin\VoterController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ElectionController;
use App\Http\Controllers\Api\VoteController;
use App\Http\Controllers\ContentController;
use Illuminate\Support\Facades\Route;

// Public : informations du scrutin, résultats publiés, vérification d'un reçu, textes du site.
Route::get('/election', [ElectionController::class, 'current']);
Route::get('/results', [ElectionController::class, 'results']);
Route::get('/receipts/{hash}', [ElectionController::class, 'receipt'])->middleware('throttle:30,1');
Route::get('/content', [ContentController::class, 'index']);

// Connexion : le jeton Google est échangé contre un jeton de vote.
Route::post('/auth/google', [AuthController::class, 'google'])->middleware('throttle:20,1');

// Espace électeur (jeton Sanctum portant la capacité « vote »).
Route::middleware(['auth:sanctum', 'abilities:vote'])->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::post('/vote', [VoteController::class, 'store'])->middleware('throttle:30,1');
});

// Administration (commission électorale) : jeton d'un membre de la commission, capacité « admin ».
Route::prefix('admin')->group(function () {
    Route::post('/login', [AdminAuthController::class, 'login'])->middleware('throttle:5,1');

    Route::middleware(['auth:sanctum', 'commission'])->group(function () {
        Route::get('/me', [AdminAuthController::class, 'me']);
        Route::post('/logout', [AdminAuthController::class, 'logout']);

        Route::get('/elections', [AdminElectionController::class, 'index']);
        Route::post('/elections', [AdminElectionController::class, 'store']);
        Route::get('/elections/{election}', [AdminElectionController::class, 'show']);
        Route::put('/elections/{election}', [AdminElectionController::class, 'update']);
        Route::post('/elections/bulk-delete', [AdminElectionController::class, 'bulkDestroy'])->middleware('throttle:10,1');
        Route::post('/elections/{election}/photo', [AdminElectionController::class, 'photo']);
        Route::post('/elections/{election}/open', [AdminElectionController::class, 'open']);
        Route::post('/elections/{election}/close', [AdminElectionController::class, 'close']);
        Route::post('/elections/{election}/publish', [AdminElectionController::class, 'publish']);

        Route::get('/elections/{election}/voters', [VoterController::class, 'index']);
        Route::post('/elections/{election}/voters/import', [VoterController::class, 'import']);
        Route::post('/elections/{election}/voters', [VoterController::class, 'store'])->middleware('throttle:30,1');
        Route::delete('/elections/{election}/voters/{voter}', [VoterController::class, 'destroy']);
        Route::get('/registrar/sessions', [RegistrarController::class, 'sessions']);
        Route::post('/elections/{election}/voters/sync', [RegistrarController::class, 'sync'])->middleware('throttle:10,1');

        Route::get('/audit', [AuditController::class, 'index']);
        Route::get('/audit/verify', [AuditController::class, 'verify']);

        Route::get('/content', [ContentController::class, 'editor']);
        Route::put('/content/{page}', [ContentController::class, 'update']);
    });
});
