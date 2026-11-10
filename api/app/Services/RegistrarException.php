<?php

namespace App\Services;

use RuntimeException;

/** Échec de la lecture du registrar. Le message est destiné à la commission : clair, sans secret. */
class RegistrarException extends RuntimeException {}
