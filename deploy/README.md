# Déploiement — VPS Ubuntu + nginx

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
- [ ] `php artisan schedule:list` montre `elections:close-expired` ; le cron tourne.
- [ ] Journal d'audit : bouton « Vérifier l'intégrité » dans l'administration.

## 5. Mises à jour

`./deploy/deploy.sh` — refuse de tourner si un scrutin est ouvert (`FORCE_DURING_VOTE=1` pour passer outre).
Côté électeurs, une nouvelle version propose « Mettre à jour » sans jamais recharger la page en plein vote.

## Sauvegarde (exemple)

```bash
mysqldump --single-transaction sa_vote | gzip | gpg -c --batch --passphrase-file /root/.sa-backup-pass > sa_vote-$(date +%F).sql.gz.gpg
```
