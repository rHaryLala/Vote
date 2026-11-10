<?php
/* =============================================================================
   Export de la liste électorale pour Vote SA (sa.zurcher.edu.mg) — LECTURE SEULE

   À copier dans le registrar :  registrar/app/electeurs-sa.api.php
   Voir deploy/registrar/README.md pour l'installation (jeton, test, nginx).

   Appelé de serveur à serveur par l'application de vote, jamais par un navigateur.
   Authentification : jeton secret (en-tête « Authorization: Bearer … » ou « X-Export-Token »),
   comparé par EMPREINTE SHA-256 : seule l'empreinte est stockée dans le registrar
   (SA_VOTE_EXPORT_TOKEN_SHA256 dans data/config.secret.php). Sans cette constante,
   l'export est DÉSACTIVÉ (503) : rien n'est exposé par défaut.

   GET ?action=sessions                  -> les sessions récentes et leur nombre d'inscrits
   GET ?action=voters&session_id=NNN     -> les étudiants inscrits à cette session

   « Inscrit » = une ligne de t_2024_inscription_session non supprimée pour la session
   (même définition que la liste imprimable « Liste des étudiants »). L'étudiant est
   identifié par sa fiche active (comme partout dans le registrar) et doit avoir une
   adresse @zurcher.edu.mg pour pouvoir se connecter avec Google : les autres sont
   comptés (« without_email ») mais jamais renvoyés.

   LECTURE SEULE IMPOSÉE PAR MYSQL (connexion « READ ONLY » : toute écriture échouerait), aucun mot de passe.
   Données renvoyées : e-mail + matricule des électeurs ; pour les inscrits SANS adresse institutionnelle seulement
   (à corriger dans le registrar) : matricule, nom et motif. Chaque étudiant porte son niveau (licence | master | remise) — jamais l'adresse personnelle.
   ========================================================================== */

// Racine du registrar : le dossier parent de app/ (surchargeable pour les tests).
$racine = defined('REGISTRAR_ROOT') ? REGISTRAR_ROOT : dirname(__DIR__);

// Les fichiers inclus du registrar peuvent émettre des octets parasites (BOM UTF-8, espaces) avant notre réponse :
// on met tout en tampon et on le jette, pour que le JSON soit toujours valide.
ob_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function exportRepondre(array $charge, int $code = 200): void
{
	while (ob_get_level() > 0) {
		ob_end_clean();
	}
	http_response_code($code);
	echo json_encode($charge, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
	header('Allow: GET');
	exportRepondre(['code' => 'method_not_allowed', 'message' => 'GET uniquement.'], 405);
}

// --- Configuration (sans toucher à la base : on authentifie AVANT toute requête) ---
if (!is_file($racine . '/data/config.php')) {
	// Fichier mal placé : réponse propre, jamais d'erreur PHP avec des chemins de fichiers.
	exportRepondre(['code' => 'misconfigured', 'message' => "Le fichier doit être placé dans registrar/app/."], 500);
}
require_once $racine . '/data/config.php';

if (!defined('SA_VOTE_EXPORT_TOKEN_SHA256') || !preg_match('/^[a-f0-9]{64}$/', (string) SA_VOTE_EXPORT_TOKEN_SHA256)) {
	exportRepondre(['code' => 'disabled', 'message' => "L'export pour Vote SA n'est pas activé."], 503);
}

// Liste blanche d'adresses IP (facultative) : défense en profondeur, en plus du jeton.
if (defined('SA_VOTE_EXPORT_ALLOWED_IPS') && is_array(SA_VOTE_EXPORT_ALLOWED_IPS) && SA_VOTE_EXPORT_ALLOWED_IPS) {
	if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', SA_VOTE_EXPORT_ALLOWED_IPS, true)) {
		exportRepondre(['code' => 'forbidden', 'message' => 'Adresse non autorisée.'], 403);
	}
}

$jeton = '';
$entete = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (stripos($entete, 'Bearer ') === 0) {
	$jeton = trim(substr($entete, 7));
} elseif (!empty($_SERVER['HTTP_X_EXPORT_TOKEN'])) {
	$jeton = trim((string) $_SERVER['HTTP_X_EXPORT_TOKEN']);
}
if ($jeton === '' || !hash_equals((string) SA_VOTE_EXPORT_TOKEN_SHA256, hash('sha256', $jeton))) {
	usleep(300000); // ralentit les essais au hasard
	exportRepondre(['code' => 'unauthorized', 'message' => 'Jeton invalide.'], 401);
}

// --- À partir d'ici seulement : accès à la base ---
// Connexion PROPRE à cet export (pas data/backdb.php : on évite l'amorce du registrar et sa couche d'audit) et en
// LECTURE SEULE imposée par MySQL : toute écriture, même par erreur future, échouerait.
try {
	$dtb = new PDO(DB_DSN, DB_USER, DB_PASS, DB_OPTIONS);
	$dtb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
	$dtb->exec('SET SESSION TRANSACTION READ ONLY');
} catch (Throwable $e) {
	error_log('[export Vote SA] connexion : ' . $e->getMessage());
	exportRepondre(['code' => 'server_error', 'message' => 'Base du registrar indisponible.'], 500);
}

$domaine = defined('SA_VOTE_EXPORT_DOMAIN') ? (string) SA_VOTE_EXPORT_DOMAIN : 'zurcher.edu.mg';
$action = (string) ($_GET['action'] ?? 'voters');

/**
 * Niveau de l'étudiant, selon l'année d'étude de sa fiche (même convention que le registrar) :
 * 0 = remise à niveau, 1 à 3 = Licence, 4 et plus = Master.
 */
function exportNiveau($anneeEtude): string
{
	$n = (int) $anneeEtude;
	return $n >= 4 ? 'master' : ($n === 0 ? 'remise' : 'licence');
}

/** Nombre d'étudiants distincts inscrits à une session (lignes non supprimées). */
function exportInscrits(PDO $dtb, int $sessionId): int
{
	$q = $dtb->prepare('SELECT COUNT(DISTINCT student_id) FROM t_2024_inscription_session WHERE session_id = :s AND COALESCE(`remove`, 0) != 1');
	$q->execute(['s' => $sessionId]);

	return (int) $q->fetchColumn();
}

try {
	if ($action === 'sessions') {
		$lignes = $dtb->query(
			'SELECT session_id, session_name, session_year, session_semester, selected
			   FROM t_2023_session
			  ORDER BY session_year DESC, session_semester DESC, session_id DESC
			  LIMIT 8'
		)->fetchAll(PDO::FETCH_ASSOC);

		$sessions = array_map(static fn(array $s): array => [
			'id' => (int) $s['session_id'],
			'name' => (string) $s['session_name'],
			'year' => (string) $s['session_year'],
			'semester' => (int) $s['session_semester'],
			'selected' => (int) $s['selected'] === 1,
			'enrolled' => exportInscrits($dtb, (int) $s['session_id']),
		], $lignes);

		exportRepondre(['sessions' => $sessions, 'generated_at' => gmdate('c')]);
	}

	if ($action !== 'voters') {
		exportRepondre(['code' => 'unknown_action', 'message' => 'Action inconnue.'], 400);
	}

	// Session demandée explicitement ; à défaut, celle marquée « selected » dans le registrar.
	$sessionId = (int) ($_GET['session_id'] ?? 0);
	if ($sessionId <= 0) {
		$sessionId = (int) $dtb->query('SELECT session_id FROM t_2023_session WHERE selected = 1 ORDER BY session_id DESC LIMIT 1')->fetchColumn();
	}
	if ($sessionId <= 0) {
		exportRepondre(['code' => 'session_required', 'message' => 'Précisez session_id : aucune session n\'est marquée active.'], 422);
	}

	$s = $dtb->prepare('SELECT session_id, session_name, session_year, session_semester FROM t_2023_session WHERE session_id = :s');
	$s->execute(['s' => $sessionId]);
	$session = $s->fetch(PDO::FETCH_ASSOC);
	if (!$session) {
		exportRepondre(['code' => 'session_not_found', 'message' => 'Session introuvable.'], 404);
	}

	// Fiche active de chaque étudiant (comme partout dans le registrar : non supprimée d'abord, puis la plus ancienne).
	// LEFT JOIN : une inscription sans fiche étudiante n'est pas ignorée en silence, elle est comptée « sans adresse ».
	$q = $dtb->prepare(
		'SELECT i.student_id, LOWER(TRIM(e.student_email)) AS email, e.annee_etude,
		        TRIM(CONCAT_WS(CHAR(32), e.student_prenom, e.student_nom)) AS full_name
		   FROM t_2024_inscription_session i
		   LEFT JOIN tbl_2024_etudiant e ON e.id = (
		        SELECT e2.id FROM tbl_2024_etudiant e2
		         WHERE e2.student_id = i.student_id
		         ORDER BY e2.`remove` ASC, e2.id ASC LIMIT 1)
		  WHERE i.session_id = :s AND COALESCE(i.`remove`, 0) != 1'
	);
	$q->execute(['s' => $sessionId]);

	$electeurs = [];      // email => [matricule, niveau] (dédoublonné : une même inscription peut exister en double)
	$etudiants = [];      // matricules distincts
	$sansAdresse = [];    // matricule => [nom, motif] pour ceux sans adresse institutionnelle valide
	$motif = "/^[a-z0-9._%+'-]+@" . preg_quote($domaine, '/') . '$/';

	foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
		$matricule = trim((string) $r['student_id']);
		$etudiants[$matricule] = true;
		$email = (string) $r['email'];
		if (preg_match($motif, $email) === 1) {
			$electeurs[$email] ??= [$matricule, exportNiveau($r['annee_etude'] ?? null)];
		} else {
			// Motif seulement (« aucune adresse » / « adresse hors domaine ») : on ne renvoie jamais l'adresse personnelle.
			$sansAdresse[$matricule] ??= [
				'student_id' => $matricule,
				'name' => trim((string) ($r['full_name'] ?? '')),
				'reason' => $email === '' ? 'missing' : 'other_domain',
				'level' => exportNiveau($r['annee_etude'] ?? null),
			];
		}
	}
	// Un étudiant dont une inscription a une adresse valide n'est pas « sans adresse ».
	$avecAdresse = array_flip(array_column($electeurs, 0));
	$sansAdresse = array_diff_key($sansAdresse, $avecAdresse);
	// Liste à corriger dans le registrar, par ordre alphabétique (plafonnée : le nombre exact reste dans counts).
	$aCorriger = array_values($sansAdresse);
	usort($aCorriger, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']) ?: strcmp($a['student_id'], $b['student_id']));
	$aCorriger = array_slice($aCorriger, 0, 2000);

	ksort($electeurs);
	$liste = [];
	foreach ($electeurs as $email => [$matricule, $niveau]) {
		$liste[] = ['email' => $email, 'student_id' => $matricule, 'level' => $niveau];
	}

	exportRepondre([
		'session' => [
			'id' => (int) $session['session_id'],
			'name' => (string) $session['session_name'],
			'year' => (string) $session['session_year'],
			'semester' => (int) $session['session_semester'],
		],
		'generated_at' => gmdate('c'),
		'counts' => [
			'enrolled' => count($etudiants),
			'eligible' => count($liste),
			'without_email' => count($sansAdresse),
		],
		'voters' => $liste,
		'without_email' => $aCorriger,
	]);
} catch (Throwable $e) {
	error_log('[export Vote SA] ' . $e->getMessage());
	exportRepondre(['code' => 'server_error', 'message' => "Erreur du registrar lors de l'export."], 500);
}
