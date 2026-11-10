<?php

use Illuminate\Support\Facades\Schedule;

// Le scrutin se clôt tout seul à l'heure prévue (le vote est de toute façon refusé dès cet instant).
Schedule::command('elections:close-expired')->everyMinute()->withoutOverlapping();

// Liste électorale : reprise automatique des inscrits du registrar tant que le scrutin est en brouillon
// (uniquement si la commission a activé l'option ; une dernière fois à l'ouverture du scrutin).
Schedule::command('elections:sync-registrar')->everyFifteenMinutes()->withoutOverlapping();
