# Vote SA — Université Adventiste Zurcher

Référendum en ligne sur le candidat unique à la présidence de la SA : **Oui / Non / Vote blanc**, un seul tour,
vote **anonyme**, connexion avec le compte Google `@zurcher.edu.mg`.

Prévu pour `https://sa.zurcher.edu.mg`.

```
sa/
├── api/      Laravel 13 : API du vote, connexion Google, API d’administration de la commission
├── web/      React 19 + TypeScript + Vite : SPA / PWA hors ligne, animations, 3D (Three.js)
└── deploy/   nginx, cron, scripts de provisionnement et de déploiement (VPS Ubuntu)
```

## Règles du scrutin

- **Électeurs** : étudiants inscrits pour le semestre dans la session active du `registrar`
  (`t_2023_session.selected = 1` + une ligne de `t_2024_inscription_session` non supprimée). La liste est
  **exportée en CSV** (colonnes `email`, `student_id`) puis importée ici : l'application de vote n'a aucun accès au registrar.
- **Acceptation** : les Oui dépassent 50 % des suffrages exprimés. Par défaut les blancs ne sont **pas** des suffrages
  exprimés et il n'y a pas de quorum ; les deux sont réglables par scrutin (verrouillés à l'ouverture).
- **Cycle de vie** : brouillon → ouvert → clos → résultats publiés. Dès l'ouverture, plus rien ne change (liste, dates,
  règles, candidat). La clôture est automatique à l'heure prévue (planificateur). La publication est manuelle et irréversible.

## Anonymat — comment c'est garanti

- `voters` sait **si** quelqu'un a voté ; `ballots` sait **ce qui** a été voté. Aucun lien entre les deux : pas d'identifiant
  d'électeur, pas d'horodatage, clé primaire aléatoire. Les deux écritures se font dans une même transaction avec verrou.
- Reçu vérifiable : l'appareil génère un secret et n'envoie que son SHA-256. L'électeur prouve que son bulletin est dans
  l'urne sans que le serveur sache à qui il appartient, et sans révéler son choix.
- Journal d'audit chaîné par hachage : participation et actes administratifs, jamais un choix ni un identifiant de bulletin.
- nginx ne journalise pas `/api/vote`.

## Développement local

Prérequis : **PHP 8.3** (celui de Laragon : `C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe` — le PHP du PATH
peut être une 8.5 sans `pdo_mysql`), MySQL, Node 22+.

```powershell
# API  (le port 8000 est souvent pris par uaz-website : on utilise 8010)
cd api
composer install
cp .env.example .env        # puis DB_*, GOOGLE_CLIENT_ID ; php artisan key:generate
php artisan migrate
php artisan commission:user prenom.nom@zurcher.edu.mg --name="Nom"   # compte de la commission (mot de passe généré)
php artisan serve --port=8010

# Front
cd web
npm install
$env:API_TARGET="http://127.0.0.1:8010"; npm run dev        # http://localhost:5173
```

Tests : `cd api && vendor/bin/pest` (base `sa_vote_test` MySQL requise) · `cd web && npm test`.

Import d'une liste électorale en ligne de commande : `php artisan voters:import {id} fichier.csv [--dry-run]`.

## Page d'accueil et logo de la SA

`/` est une page publique : présentation de la SA, candidat (photo, parcours, engagements), dates (heure de Madagascar),
mode d'emploi du vote. **Tout le contenu est saisi par la commission** dans `/admin` (champs « Présentation de la SA »,
« Parcours », « Présentation du candidat », « Engagements » — un par ligne) ; rien n'est écrit en dur sauf une phrase
par défaut. Le parcours de vote est sur `/voter`.

## Administration (`/admin`)

SPA React construit avec **shadcn/ui** (Radix + Tailwind), chargé à part : les étudiants ne téléchargent jamais
ce code. Accès par e-mail + mot de passe des membres de la commission (`php artisan commission:user …`) ; jeton
d'API à capacité « admin », gardé dans `sessionStorage` (effacé à la fermeture de l'onglet), valable 8 h.
Un jeton d'électeur ne donne jamais accès à l'administration, et un jeton de la commission ne permet pas de voter.

- **Scrutins** : création, photo du candidat, import CSV de la liste électorale (avec simulation), ouverture,
  clôture, publication des résultats, statistiques de participation en direct, liste des électeurs.
- **Ajout manuel d'un électeur** (adresse @zurcher.edu.mg + nom, matricule facultatif) : possible jusqu'à la clôture. Il
  survit aux imports et synchronisations (qui ne remplacent que les électeurs venus d'un CSV ou du registrar). Pendant le
  vote, l'ajout demande une confirmation et est inscrit au journal d'audit (heure, compte de la commission, empreinte de
  l'adresse — jamais l'adresse ni le nom en clair). On ne peut retirer qu'un ajout manuel qui n'a pas voté (ou n'importe
  quel électeur tant que le scrutin est en brouillon) ; le retrait révoque sa session.
- **Ouverture et clôture automatiques** : il faut d'abord **armer** le scrutin avec « Ouvrir le scrutin » (étape volontaire, avec
  confirmation). Une fois armé, le vote s'ouvre **tout seul à l'heure d'ouverture** et refuse tout bulletin à l'heure de
  clôture (le serveur compare l'heure à chaque bulletin ; l'écran des étudiants se met à jour à la seconde, sans recharger).
  Un scrutin laissé en **brouillon** ne s'ouvre jamais de lui-même. Le statut « clos » est ensuite posé par le planificateur
  (cron, `deploy/cron.d-sa-vote`), mais le vote est déjà refusé sans lui.
- **Dates** : modifiables tant que le scrutin n'est pas clos (ex. prolonger le vote). Chaque changement sur un scrutin
  ouvert est inscrit au journal d'audit (avant / après). Une heure de clôture déjà passée est refusée (utiliser
  « Clore le scrutin »). La question, le candidat et la règle d'acceptation restent figés dès l'ouverture.
- **Contenu des pages** : tous les textes du site (accueil, connexion, bulletin, reçu, résultats, vérification,
  confidentialité, en-tête et pied de page). Les textes par défaut et la liste des champs sont dans **un seul
  fichier**, `api/resources/content/pages.json`, lu par l'API (validation) et par le front (affichage immédiat, même
  hors ligne). La base ne garde que les textes modifiés ; « Texte par défaut » annule une modification.
- **Journal d'audit** : consultation et vérification de l'intégrité de la chaîne.

## Synchronisation de la liste électorale avec le registrar

Dans l'administration (scrutin en brouillon → « Liste électorale ») : choisir la **session** du registrar, **Aperçu**
(ajoutés / retirés / inchangés, étudiants inscrits sans adresse @zurcher.edu.mg), puis **Synchroniser**. L'import CSV
reste disponible. La synchronisation passe par un export dédié du registrar, **en lecture seule et protégé par jeton**
(`deploy/registrar/electeurs-sa.api.php`) : l'application de vote n'a aucun accès à la base ni aux comptes du registrar.
Installation et sécurité : `deploy/registrar/README.md`. La liste est figée à l'ouverture du scrutin.

## Direction artistique

« Grille technique » : fond gris clair `#E8E8E6`, filets de grille visibles, grands titres carrés (**Tektur**),
étiquettes en chasse fixe (**JetBrains Mono**), paragraphes en **Space Grotesk**, accent : le **bleu de la SA** `#28476A`
(boutons à coins coupés, petits carrés repères), texte blanc dessus, bleu clair `#7AA7E0` sur fond noir. Objets 3D en plastique blanc avec
lueur bleue. Jetons et composants : `web/src/styles.css` et `web/src/components/ui.tsx`.

Logo de la SA, vectorisé depuis le logo officiel (`web/scripts/vectorize-sa-logo.cjs`) :
`web/public/brand/sa-logo.svg` (complet), `sa-mark.svg` (monogramme, sert aussi à la 3D) et `sa-logo.png`
(2048 px, fond transparent). Les icônes de la PWA se régénèrent avec `node scripts/make-icons.mjs`.

## Connexion Google

Le Client ID est dans `api/.env` (`GOOGLE_CLIENT_ID`) **et** `web/.env` (`VITE_GOOGLE_CLIENT_ID`). Origines JavaScript
autorisées dans la console : `https://sa.zurcher.edu.mg`, `http://localhost`, `http://localhost:5173`.
Le secret client n'est **pas** utilisé et ne doit figurer nulle part.

## Hors ligne

L'application est une PWA : elle s'installe, s'ouvre sans réseau et conserve le dernier état du scrutin. Un bulletin est
écrit sur l'appareil **avant** l'envoi, renvoyé automatiquement au retour du réseau, et n'est compté qu'une fois reçu
par le serveur (l'écran le dit clairement). La première connexion exige internet (Google).

## Ce qui reste à faire / à valider

- Test de charge (k6) avant un vrai scrutin : le verrou anti double vote n'a pas été éprouvé en parallèle réel.
- Le déploiement VPS (`deploy/`) est écrit et relu, **pas exécuté** sur le vrai serveur.
- Content-Security-Policy à définir et valider avec le vrai bouton Google.
- Connexion Google de bout en bout non testée automatiquement (nécessite un vrai compte du domaine).
- Page de conditions d'utilisation ; version anglaise (le site UAZ est bilingue).
- Politique de conservation des données après le scrutin, à fixer par la commission.
#   V o t e  
 