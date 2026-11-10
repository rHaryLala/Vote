#!/usr/bin/env bash
# Déploiement de Vote SA sur le VPS (Ubuntu + nginx + PHP-FPM 8.3).
# À lancer depuis la racine du dépôt (ex. /var/www/sa) par l'utilisateur de déploiement :  ./deploy/deploy.sh
#
# NON TESTÉ sur le VPS réel : à relire et à essayer une première fois HORS période de vote.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Garde-fou : on ne redéploie pas en plein scrutin sans le vouloir.
if [ -f api/.env ] && php api/artisan tinker --execute='echo App\Models\Election::where("status","open")->exists() ? "OPEN" : "ok";' 2>/dev/null | grep -q OPEN; then
  if [ "${FORCE_DURING_VOTE:-0}" != "1" ]; then
    echo "Un scrutin est OUVERT. Redéployer maintenant risque de perturber les électeurs."
    echo "Relancez avec FORCE_DURING_VOTE=1 si c'est vraiment voulu."
    exit 1
  fi
fi

echo "==> Code"
git pull --ff-only

echo "==> API (Laravel)"
cd api
composer install --no-dev --optimize-autoloader --no-interaction
php artisan down --retry=10 || true
php artisan migrate --force
php artisan storage:link 2>/dev/null || true
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache
php artisan up
cd ..

echo "==> Front (React)"
cd web
npm ci
npm run build
cd ..

echo "==> Services"
sudo systemctl reload php8.3-fpm
sudo systemctl reload nginx

echo "Déploiement terminé. Vérifier : curl -fsS https://sa.zurcher.edu.mg/up && curl -fsS https://sa.zurcher.edu.mg/api/election"
