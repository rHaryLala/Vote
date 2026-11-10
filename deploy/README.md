# Déploiement — VPS Ubuntu + nginx

## Procédure réelle (VPS de l'UAZ, `sa.zurcher.edu.mg`) — sans Git, en deux temps

Le serveur (nginx 1.24, PHP 8.3-FPM, MariaDB 10.11, Certbot) héberge d'autres sites ; Vote SA n'en touche aucun.
Le DNS de `zurcher.edu.mg` est chez Hostinger (`*.dns-parking.com`) : l'enregistrement `A sa → 191.215.37.182` se crée là-bas,
pas sur le VPS. Le certificat Let's Encrypt de `sa.zurcher.edu.mg` existe déjà (renouvelé par `certbot.timer`).

**1. Depuis le poste de développement** (sans root) — construit le site, l'envoie dans `~/sa-release` du serveur, un dossier que
nginx ne sert PAS (jamais de secret ni de version inachevée accessible), et installe les dépendances PHP :

```bash
bash deploy/release.sh          # hôte SSH : alias « registrar-vps » (DEPLOY_HOST=… pour un autre)
```

**2. Sur le serveur** (root requis : base de données, nginx, droits, cron) :

```bash
ssh registrar-vps
sudo bash ~/sa-release/deploy/server-setup.sh [adresse-du-compte-commission]   # défaut : hary.rab@zurcher.edu.mg
```

`server-setup.sh` crée la base `sa_vote` et son utilisateur (mot de passe aléatoire, écrit seulement dans `/var/www/sa/api/.env`),
installe les fichiers dans `/var/www/sa`, lance les migrations, remplace le site nginx par
`deploy/nginx/sa.zurcher.edu.mg.prod.conf` (**en gardant le certificat existant**), installe le cron de clôture automatique,
crée le compte de la commission (mot de passe affiché une seule fois) et vérifie le résultat. Il sauvegarde l'ancienne config nginx
et la **restaure** si `nginx -t` échoue, refuse d'écraser une base non vide, et conserve le `.env` lors des mises à jour.
**Pour mettre à jour** : relancer les deux commandes (le `.env`, la base et les photos ne sont pas touchés).

Retour arrière nginx : `cp /etc/nginx/sites-available/sa.zurcher.edu.mg.bak-<date> /etc/nginx/sites-available/sa.zurcher.edu.mg && nginx -t && systemctl reload nginx`.

---

## Procédure générique (autre serveur, avec Git) — scripts `provision.sh` et `deploy.sh`

> Ces fichiers ont été **écrits et relus, pas exécutés** sur le VPS. La syntaxe nginx et le routage ont été validés
> en local (nginx 1.28, test de chaque route) ; le reste est à essayer une première fois **hors période de vote**.

## 1. Avant de toucher au serveur

1. **DNS** : enregistrement `A` (et `AAAA` si IPv6) `sa.zurcher.edu.mg` → IP du VPS.
2. **Google Cloud Console** : l'ID client doit avoir l'origine `https://sa.zurcher.edu.mg`.
3. Le dépôt accessible depuis le VPS (Git).

## 2. Préparer le serveur (une fois)

```bash
sudo bash deploy/provision.sh        # nginx, PHP 8.3-FPM, MySQL, Node 22, Certbot, ufw, fail2ban, OPcache
```

Base de données dédiée (mot de passe fort, jamais dans Git) :

```sql
CREATE DATABASE sa_vote CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sa_vote'@'localhost' IDENTIFIED BY '<mot-de-passe-fort>';
GRANT ALL ON sa_vote.* TO 'sa_vote'@'localhost';
```

## 3. Première installation

```bash
sudo mkdir -p /var/www/sa && sudo chown $USER:www-data /var/www/sa
git clone <dépôt> /var/www/sa && cd /var/www/sa
cp api/.env.example api/.env     # renseigner DB_*, GOOGLE_CLIENT_ID ; puis :  php api/artisan key:generate
cp web/.env.example web/.env     # VITE_GOOGLE_CLIENT_ID
sudo chgrp -R www-data api/storage api/bootstrap/cache && sudo chmod -R g+w api/storage api/bootstrap/cache
./deploy/deploy.sh
php api/artisan commission:user prenom.nom@zurcher.edu.mg --name="Nom"   # compte de la commission (mot de passe affiché une fois)
sudo cp deploy/cron.d-sa-vote /etc/cron.d/sa-vote       # clôture automatique des scrutins
```

nginx + HTTPS :

```bash
sudo cp deploy/nginx/sa-security-headers.conf /etc/nginx/snippets/
sudo cp deploy/nginx/sa.zurcher.edu.mg.conf   /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/sa.zurcher.edu.mg.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d sa.zurcher.edu.mg
```

### Synchronisation avec le registrar (facultatif)

Voir `deploy/registrar/README.md` : un fichier à copier dans le registrar, un jeton, deux variables dans `api/.env`.

## 4. Vérifications avant d'ouvrir un scrutin

- [ ] `curl -fsS https://sa.zurcher.edu.mg/up` et `/api/election` répondent.
- [ ] Connexion Google réelle avec un compte étudiant de test (inscrit sur la liste) ET avec un compte hors liste (refusé).
- [ ] Si la synchronisation est activée : aperçu puis synchronisation d'une session réelle ; vérifier le nombre d'« inscrits sans adresse ».
- [ ] `/admin` : création du scrutin, import CSV, ouverture ; vérifier que **les heures saisies sont celles de Madagascar**.
- [ ] Photo du candidat visible sur l'accueil (`/storage/candidates/…` répond 200 : nginx sert `api/storage/app/public` ; `php artisan storage:link` fait par deploy.sh).
- [ ] Vote complet depuis un téléphone, puis **hors ligne** (mode avion) : reprise automatique au retour du réseau.
- [ ] Installation de la PWA sur Android et iPhone.
- [ ] `/api/vote` **absent** de `/var/log/nginx/access.log` (anonymat).
- [ ] **Test de charge** (k6) : plusieurs centaines de votes simultanés, aucun doublon (`voters.has_voted` = nombre de `ballots`).
- [ ] Sauvegarde MySQL chiffrée, copiée **hors du VPS**, et **restauration testée**.
- [ ] **Scrutin armé** (« Ouvrir le scrutin » cliqué, statut « Ouvert · hors horaires ») AVANT l'heure d'ouverture : sinon rien ne s'ouvre.
- [ ] Avant un vrai scrutin : **supprimer les scrutins de test** (liste des scrutins → cocher → Supprimer) et vérifier que le site public n'affiche rien d'autre que le bon scrutin.
- [ ] `php artisan schedule:list` montre `elections:close-expired` ; le cron tourne.
- [ ] Journal d'audit : bouton « Vérifier l'intégrité » dans l'administration.

## 5. Mises à jour

`./deploy/deploy.sh` — refuse de tourner si un scrutin est ouvert (`FORCE_DURING_VOTE=1` pour passer outre).
Côté électeurs, une nouvelle version propose « Mettre à jour » sans jamais recharger la page en plein vote.

## Sauvegarde (exemple)

```bash
mysqldump --single-transaction sa_vote | gzip | gpg -c --batch --passphrase-file /root/.sa-backup-pass > sa_vote-$(date +%F).sql.gz.gpg
```
