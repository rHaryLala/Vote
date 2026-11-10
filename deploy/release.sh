#!/usr/bin/env bash
#
# Vote SA — envoi d'une version vers le VPS, depuis le POSTE DE DÉVELOPPEMENT (Git Bash). N'exige PAS root.
#
#   bash deploy/release.sh              # hôte SSH : « registrar-vps » (alias de ~/.ssh/config)
#   DEPLOY_HOST=autre-alias bash deploy/release.sh
#
# Ce script :
#   1. construit le site (web/dist) ;
#   2. envoie le code dans ~/sa-release sur le serveur — un dossier de TON compte, que nginx ne sert pas : rien de secret
#      ni de non terminé n'est jamais accessible depuis Internet pendant l'envoi ;
#   3. installe les dépendances PHP sur le serveur (composer, sans les outils de développement).
# L'installation finale (nginx, base de données, droits) est faite par deploy/server-setup.sh, à lancer avec sudo.
set -euo pipefail

HOST="${DEPLOY_HOST:-registrar-vps}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR='$HOME/sa-release'

echo "==> Construction du site"
(cd "$ROOT/web" && npm run build)
[ -f "$ROOT/web/dist/index.html" ] || { echo "web/dist/index.html absent : la construction a échoué." >&2; exit 1; }

CLIENT_ID="$(grep -E '^VITE_GOOGLE_CLIENT_ID=' "$ROOT/web/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
[ -n "$CLIENT_ID" ] || { echo "VITE_GOOGLE_CLIENT_ID est vide dans web/.env." >&2; exit 1; }

echo "==> Envoi vers $HOST:~/sa-release (hors de tout dossier servi par nginx)"
# Jamais envoyés : secrets (.env), dépendances locales (réinstallées sur le serveur), tests, état de développement
# (journaux, caches, photos de test, bases SQLite) et le lien symbolique public/storage (créé sur le serveur).
tar -C "$ROOT" -czf - \
  --exclude='api/.env' --exclude='api/vendor' --exclude='api/node_modules' --exclude='api/tests' \
  --exclude='api/storage/logs/*' --exclude='api/storage/framework/*/*' --exclude='api/storage/app/*' \
  --exclude='api/public/storage' --exclude='api/public/hot' --exclude='api/database/*.sqlite' \
  --exclude='api/phpunit.xml' --exclude='api/CLAUDE.md' --exclude='api/AGENTS.md' --exclude='api/README.md' \
  --exclude='api/package.json' --exclude='api/vite.config.js' --exclude='api/.phpunit.cache' \
  api web/dist deploy \
  | ssh -o BatchMode=yes "$HOST" "rm -rf $REMOTE_DIR.new && mkdir -p $REMOTE_DIR.new && tar -xzf - -C $REMOTE_DIR.new"

# Les scripts et configurations écrits sous Windows ont des fins de ligne CRLF, fatales pour bash sous Linux : on normalise.
ssh -o BatchMode=yes "$HOST" "find $REMOTE_DIR.new/deploy -type f \( -name '*.sh' -o -name '*.conf' -o -name 'cron.d-*' \) -exec sed -i 's/\r$//' {} +"

# Valeur publique (identifiant du client Google) lue par server-setup.sh pour écrire le .env de production.
ssh -o BatchMode=yes "$HOST" "printf 'GOOGLE_CLIENT_ID=%s\n' '$CLIENT_ID' > $REMOTE_DIR.new/release.conf"

echo "==> Installation des dépendances PHP sur le serveur (composer, sans dev)"
ssh -o BatchMode=yes "$HOST" "cd $REMOTE_DIR.new/api \
  && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
  && APP_KEY=base64:\$(openssl rand -base64 32) composer install --no-dev --optimize-autoloader --no-interaction --no-progress 2>&1 | tail -4 \
  && test -f vendor/autoload.php"

echo "==> Mise en place de ~/sa-release"
ssh -o BatchMode=yes "$HOST" "rm -rf $REMOTE_DIR.old; [ -d $REMOTE_DIR ] && mv $REMOTE_DIR $REMOTE_DIR.old; mv $REMOTE_DIR.new $REMOTE_DIR; rm -rf $REMOTE_DIR.old"

cat <<DONE

Version envoyée. Étape suivante (une seule commande, avec ton mot de passe sudo) :

  ssh $HOST
  sudo bash ~/sa-release/deploy/server-setup.sh

DONE
