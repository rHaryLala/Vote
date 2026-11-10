# Synchronisation de la liste électorale avec le registrar

L'application de vote reprend les étudiants inscrits **directement depuis le registrar**, par un export dédié :
lecture seule, protégé par un jeton, sans jamais utiliser un compte du registrar.

> Pourquoi pas `…/src/data.topdf?ptype=listeStd` ? Cette adresse est une **page d'impression** : elle exige une
> connexion interactive au registrar, des paramètres POST (`semestre`, `anneescolaire`…) et fabrique le PDF dans le
> navigateur. La lire automatiquement obligerait à stocker un mot de passe du registrar dans l'application de vote.
> L'export ci-dessous lit les **mêmes tables** (`t_2024_inscription_session` + `tbl_2024_etudiant`) sans cette contrainte.

## Ce que fait l'export

| Appel | Réponse |
|---|---|
| `GET …/electeurs-sa.api.php?action=sessions` | les 8 sessions les plus récentes, avec leur nombre d'inscrits |
| `GET …/electeurs-sa.api.php?action=voters&session_id=490` | les étudiants inscrits à la session : `email` + `student_id`, plus des compteurs |

- **Inscrit** = une ligne de `t_2024_inscription_session` non supprimée pour la session (même définition que la
  « Liste des étudiants » imprimable). La fiche de l'étudiant est la fiche active, comme partout dans le registrar.
- Seuls les étudiants ayant une adresse **@zurcher.edu.mg** sont renvoyés (sans elle, pas de connexion Google). Les
  autres sont **comptés** (`without_email`) pour que la commission les corrige dans le registrar.
- **La commission choisit la session** dans l'administration : le registrar n'a pas de notion unique de « session
  active » (le champ `selected` n'est pas fiable : il vaut 0 partout dans la copie locale).
- **Lecture seule imposée par MySQL** (`SET SESSION TRANSACTION READ ONLY` sur une connexion propre à l'export : une écriture
  échouerait, même par erreur de code future), aucun mot de passe, aucune donnée hors adresse et matricule.

## Installation rapide sur le VPS de l'UAZ (le registrar et le vote sont sur le même serveur)

```bash
ssh registrar-vps
bash ~/sa-release/deploy/registrar/install-on-vps.sh      # sans sudo
sudo bash ~/sa-release/deploy/server-setup.sh              # reconstruit les caches de l'application de vote
```

Le script fait les étapes 1 à 5 ci-dessous : il copie l'export dans `registrar/app/`, génère le jeton (jamais affiché),
ajoute son **empreinte** à `registrar/data/config.secret.php` (après sauvegarde), écrit URL + jeton dans `api/.env`, puis
teste l'export (sans jeton, mauvais jeton, bon jeton). Il s'arrête sans rien changer si un jeton existe déjà, et affiche
les commandes de retour arrière.

## Synchronisation automatique

Dans l'administration (scrutin en brouillon → **Liste électorale**), l'interrupteur **Synchronisation automatique** :

- reprend les inscrits de la session choisie **toutes les 15 minutes** (planificateur `elections:sync-registrar`, lancé par
  `/etc/cron.d/sa-vote`) tant que le scrutin est en brouillon, et **une dernière fois à l'ouverture** du scrutin ;
- conserve les électeurs ajoutés à la main ;
- n'écrit rien (ni entrée au journal d'audit) quand la liste est déjà à jour ; sinon, `voters_synced` est journalisé avec
  `trigger: auto` ;
- **garde-fous** : un export sans aucun électeur, ou qui retirerait plus de 20 % de la liste (et plus de 10 personnes), est
  refusé. La liste n'est alors pas touchée, l'erreur s'affiche dans l'administration, et la synchronisation manuelle (avec
  aperçu) permet de confirmer un changement voulu ;
- s'arrête d'elle-même à l'ouverture : la liste est ensuite figée.

## Niveaux (Licence / Master) et étudiants sans adresse

- **Niveaux concernés** : Licence et Master, Licence seulement, ou Master seulement (aperçu, synchronisation manuelle et
  synchronisation automatique). Le niveau vient de l'**année d'étude** de la fiche de l'étudiant dans le registrar
  (`annee_etude` : 4 et plus = Master ; 1 à 3 = Licence ; 0 = remise à niveau, **comptée avec la Licence**). L'aperçu détaille
  toujours Licence et Master pour la session entière.
- **Étudiants sans adresse @zurcher.edu.mg** : l'aperçu les liste (matricule, nom, niveau, problème), avec un export CSV pour
  les transmettre au registrar. Seul le motif est renvoyé (aucune adresse / adresse hors domaine) : jamais une adresse personnelle.
- Ces deux fonctions exigent la **dernière version** de `electeurs-sa.api.php` : relancer `install-on-vps.sh` met l'export à jour
  (sans toucher au jeton). Avec un ancien export, tout le monde est compté en Licence et la liste des noms est absente.

## Installation dans le registrar, étape par étape (à relire avant de déployer)

1. **Copier** `electeurs-sa.api.php` dans `registrar/app/` sur le serveur (même dossier que `adresses-google.api.php`).
   Vérifier qu'il est joignable : `curl -i https://registrar.zurcher.edu.mg/app/electeurs-sa.api.php` doit répondre
   **503** « pas activé » (c'est normal : l'export est désactivé tant que le jeton n'est pas défini).

2. **Générer un jeton** (long et aléatoire) et son empreinte SHA-256 :

   ```bash
   TOKEN=$(openssl rand -hex 32)
   echo "Jeton (pour l'application de vote) : $TOKEN"
   echo "Empreinte (pour le registrar)      : $(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)"
   ```

3. **Registrar** : ajouter l'**empreinte** (jamais le jeton) dans `registrar/data/config.secret.php` :

   ```php
   define('SA_VOTE_EXPORT_TOKEN_SHA256', '<empreinte>');
   // Facultatif — n'autoriser que le serveur de vote (défense en profondeur) :
   // define('SA_VOTE_EXPORT_ALLOWED_IPS', ['203.0.113.10']);
   ```

4. **Application de vote** : ajouter le **jeton** dans `api/.env` (jamais dans Git), puis `php artisan config:cache` :

   ```
   REGISTRAR_EXPORT_URL=https://registrar.zurcher.edu.mg/app/electeurs-sa.api.php
   REGISTRAR_EXPORT_TOKEN=<jeton>
   ```

5. **Tester** depuis le serveur de vote :

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" "https://registrar.zurcher.edu.mg/app/electeurs-sa.api.php?action=sessions"
   ```

6. Dans l'administration : scrutin en brouillon → **Liste électorale** → choisir la session → **Aperçu** → **Synchroniser**.

## Sécurité

- **Désactivé par défaut** : sans `SA_VOTE_EXPORT_TOKEN_SHA256`, l'endpoint répond 503 et n'ouvre pas la base.
- Le jeton est comparé par **empreinte** (`hash_equals`) **avant** toute requête SQL ; seule l'empreinte est stockée dans le
  registrar, donc une fuite de sa configuration ne révèle pas le jeton. Chaque échec est ralenti de 0,3 s.
- **HTTPS obligatoire** côté application de vote (sauf `localhost` en développement), et **aucune redirection suivie** : le
  jeton ne peut pas être envoyé vers un autre hôte.
- Le jeton n'apparaît dans aucune réponse, aucun journal et aucune erreur affichée.
- Les adresses d'étudiants circulent sur le réseau : limiter l'accès par IP (ci-dessus) et par nginx si possible, et
  **changer le jeton** (étapes 2 à 4) si l'on soupçonne une fuite.
- Un export réussi est consigné dans le journal d'audit de l'application de vote (`voters_synced` : session source et
  compteurs, **jamais** d'adresses).

## Après l'ouverture du scrutin

La liste électorale est **figée** à l'ouverture (équité : le corps électoral ne change pas pendant le vote). La
synchronisation n'est donc possible qu'en brouillon. Un étudiant inscrit **après** l'ouverture ne peut pas voter : à
décider en amont par la commission (ouvrir le scrutin après la fin des inscriptions tardives, ou prévoir un ajout
manuel journalisé).
