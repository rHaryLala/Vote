<?php

use Illuminate\Support\Facades\Schedule;

// Le scrutin se clôt tout seul à l'heure prévue (le vote est de toute façon refusé dès cet instant).
Schedule::command('elections:close-expired')->everyMinute()->withoutOverlapping();
