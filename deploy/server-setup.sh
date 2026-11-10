#!/usr/bin/env bash
#
# Vote SA — installation sur le VPS : PARTIE PRIVILÉGIÉE (première installation, puis chaque mise à jour).
#
#   sudo bash ~/sa-release/deploy/server-setup.sh                         # compte commission par défaut
#   sudo bash ~/sa-release/deploy/server-setup.sh prenom.nom@zurcher.edu.mg   # ou un autre compte
#
# Prérequis : « deploy/release.sh » (lancé depuis le poste de développement) a déjà envoyé la version dans ~/sa-release
# et installé les dépendances PHP. Ce script, lui, ne fait que ce qui exige root :
#   - base de données dédiée (première fois seulement) et fichier .env de production ;
#   - fichiers dans /var/www/sa, droits, migrations, caches ;
#   - site nginx (le certificat Let's Encrypt EXISTANT est conservé) ;
#   - tâche planifiée (clôture automatique des scrutins), compte de la commission ;
#   - vérifications finales.
#
# Garde-fous : ne touche à AUCUN autre site du serveur ; sauvegarde l'ancienne configuration nginx et la restaure si
# `nginx -t` échoue ; refuse d'écraser une base de données non vide ; ne reconfigure jamais un .env existant.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "À lancer avec sudo (ou en root)." >&2; exit 1; }

DOMAIN=sa.zurcher.edu.mg
DEST=/var/www/sa
OWNER="${SUDO_USER:-rabenamana}"        # propriétaire des fichiers : le compte qui déploie sans root
GROUP=www-data                          # groupe de PHP-FPM et de nginx
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME=sa_vote
DB_USER=sa_vote
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
NGINX_SITE="/etc/nginx/sites-available/$DOMAIN"
COMMISSION_EMAIL="${1:-hary.rab@zurcher.edu.mg}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERREUR : %s\033[0m\n' "$*" >&2; exit 1; }
artisan() { runuser -u www-data -- php "$DEST/api/artisan" "$@"; }

# ------------------------------------------------------------------------------------------------ vérifications
say "Vérifications préalables"
[ -f "$SRC/web/dist/index.html" ]     || die "web/dist absent de $SRC : lancez deploy/release.sh depuis le poste de développement."
[ -f "$SRC/api/vendor/autoload.php" ] || die "api/vendor absent de $SRC : les dépendances PHP ne sont pas installées (deploy/release.sh)."
[ -f "$SRC/release.conf" ]            || die "release.conf absent de $SRC (deploy/release.sh)."
# shellcheck disable=SC1091
. "$SRC/release.conf"
[ -n "${GOOGLE_CLIENT_ID:-}" ]        || die "GOOGLE_CLIENT_ID est vide dans release.conf."
[ -f "$CERT_DIR/fullchain.pem" ]      || die "Certificat introuvable ($CERT_DIR) : le site $DOMAIN n'a pas de certificat Let's Encrypt."
[ -f "$NGINX_SITE" ]                  || die "Site nginx introuvable ($NGINX_SITE)."
command -v mysql >/dev/null           || die "Client mysql introuvable."
command -v runuser >/dev/null         || die "runuser introuvable."
nginx -t >/dev/null 2>&1              || die "La configuration nginx ACTUELLE est déjà invalide : corrigez-la d'abord (nginx -t)."

DNS_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}')"
echo "  DNS : $DOMAIN -> ${DNS_IP:-introuvable}"
[ -n "$DNS_IP" ] || echo "  (attention : le nom ne se résout pas encore depuis ce serveur ; le site marchera dès que le DNS sera propagé)"

FIRST_INSTALL=0
[ -f "$DEST/api/.env" ] || FIRST_INSTALL=1
if [ "$FIRST_INSTALL" = 1 ]; then echo "  Première installation."; else echo "  Mise à jour (le .env existant est conservé)."; fi

# ------------------------------------------------------------------------------------------------ base de données
if [ "$FIRST_INSTALL" = 1 ]; then
  say "Base de données $DB_NAME (première installation)"
  EXISTING="$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME'")"
  [ "$EXISTING" = "0" ] || die "La base $DB_NAME existe déjà et contient $EXISTING table(s), mais il n'y a pas de .env : je ne l'écrase pas. Supprimez-la vous-même si c'est voulu."
  DB_PASS="$(openssl rand -hex 24)"
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
  echo "  Base et utilisateur « $DB_USER » créés (mot de passe aléatoire, écrit seulement dans $DEST/api/.env)."
fi

# ------------------------------------------------------------------------------------------------ fichiers
say "Fichiers -> $DEST"
mkdir -p "$DEST/api" "$DEST/web"
# On remplace le CODE, jamais l'état : .env et storage/ ne sont pas touchés.
rm -rf "$DEST/api/app" "$DEST/api/bootstrap" "$DEST/api/config" "$DEST/api/database" "$DEST/api/public" \
       "$DEST/api/resources" "$DEST/api/routes" "$DEST/api/vendor" "$DEST/web/dist"
tar -C "$SRC" -cf - api web/dist | tar -C "$DEST" -xf -
mkdir -p "$DEST/api/storage/app/public/candidates" "$DEST/api/storage/framework/cache/data" \
         "$DEST/api/storage/framework/sessions" "$DEST/api/storage/framework/views" \
         "$DEST/api/storage/logs" "$DEST/api/bootstrap/cache"

if [ "$FIRST_INSTALL" = 1 ]; then
  say "Fichier .env de production"
  cat > "$DEST/api/.env" <<ENV
APP_NAME="Vote SA"
APP_ENV=production
APP_KEY=base64:$(openssl rand -base64 32)
APP_DEBUG=false
APP_URL=https://$DOMAIN
APP_LOCALE=fr
APP_FALLBACK_LOCALE=fr

LOG_CHANNEL=daily
LOG_LEVEL=warning

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=$DB_NAME
DB_USERNAME=$DB_USER
DB_PASSWORD=$DB_PASS

SESSION_DRIVER=database
CACHE_STORE=database
QUEUE_CONNECTION=database

GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_ALLOWED_DOMAIN=zurcher.edu.mg
VOTE_TIMEZONE=Indian/Antananarivo
VOTER_TOKEN_TTL=240

# Synchronisation avec le registrar (facultatif) : voir deploy/registrar/README.md
REGISTRAR_EXPORT_URL=
REGISTRAR_EXPORT_TOKEN=
ENV
fi

say "Droits"
chown -R "$OWNER:$GROUP" "$DEST"
find "$DEST" -type d -exec chmod 750 {} +
find "$DEST" -type f -exec chmod 640 {} +
# L'état écrit par PHP-FPM (utilisateur www-data) : journaux, caches, sessions, photos envoyées.
chmod -R g+w "$DEST/api/storage" "$DEST/api/bootstrap/cache"
find "$DEST/api/storage" "$DEST/api/bootstrap/cache" -type d -exec chmod 2770 {} +
ln -sfn ../storage/app/public "$DEST/api/public/storage"
chown -h "$OWNER:$GROUP" "$DEST/api/public/storage"

# ------------------------------------------------------------------------------------------------ Laravel
say "Migrations et caches"
artisan migrate --force
artisan config:cache
artisan route:cache
artisan view:cache
artisan event:cache

# ------------------------------------------------------------------------------------------------ nginx
say "Site nginx"
install -m 644 "$SRC/deploy/nginx/sa-security-headers.conf" /etc/nginx/snippets/sa-security-headers.conf
cp -a "$NGINX_SITE" "$NGINX_SITE.bak-$STAMP"
install -m 644 "$SRC/deploy/nginx/sa.zurcher.edu.mg.prod.conf" "$NGINX_SITE"
if ! nginx -t; then
  cp -a "$NGINX_SITE.bak-$STAMP" "$NGINX_SITE"
  die "Configuration nginx invalide : l'ancienne a été restaurée, rien n'a été rechargé. Les fichiers de l'application sont en place."
fi
systemctl reload nginx
echo "  nginx rechargé (sauvegarde de l'ancienne config : $NGINX_SITE.bak-$STAMP)."

# ------------------------------------------------------------------------------------------------ tâche planifiée
say "Tâche planifiée (clôture automatique des scrutins)"
cat > /etc/cron.d/sa-vote <<'CRON'
# Vote SA : planificateur Laravel (clôture automatique des scrutins à l'heure prévue)
* * * * * www-data cd /var/www/sa/api && /usr/bin/php artisan schedule:run >> /dev/null 2>&1
CRON
chmod 644 /etc/cron.d/sa-vote

# ------------------------------------------------------------------------------------------------ compte commission
if [ "$FIRST_INSTALL" = 1 ]; then
  say "Compte de la commission électorale"
  echo "  Le mot de passe ci-dessous n'est affiché QU'UNE FOIS : notez-le maintenant."
  artisan commission:user "$COMMISSION_EMAIL" --name="Commission électorale"
fi

# ------------------------------------------------------------------------------------------------ vérifications
say "Vérifications (depuis ce serveur, en HTTPS)"
FAIL=0
probe() { # nom, chemin, code attendu, [texte attendu dans la réponse]
  local code body
  body="$(curl -s --max-time 20 --resolve "$DOMAIN:443:127.0.0.1" -o /tmp/sa-probe.$$ -w '%{http_code}' "https://$DOMAIN$2" || true)"
  code="$body"
  if [ "$code" = "$3" ] && { [ -z "${4:-}" ] || grep -q "$4" /tmp/sa-probe.$$; }; then
    printf '  \033[32mOK\033[0m     %-46s %s\n' "$1" "$code"
  else
    printf '  \033[31mÉCHEC\033[0m  %-46s %s (attendu %s)\n' "$1" "$code" "$3"; FAIL=1
  fi
}
probe "santé de l'application (/up)"                     /up 200
probe "API : scrutin courant (/api/election)"            /api/election 200 '"election"'
probe "site (/) : le SPA est servi"                      / 200 'id="root"'
probe "administration (/admin) : le SPA est servi"       /admin 200 'id="root"'
probe "route d'application (/voter)"                     /voter 200 'id="root"'
probe "administration : refus sans connexion"            /api/admin/me 401
probe "fichiers cachés (/.env) interdits"                /.env 403
probe "textes du site (/api/content)"                    /api/content 200 '"pages"'
curl -s --max-time 20 --resolve "$DOMAIN:443:127.0.0.1" -I "https://$DOMAIN/" | grep -qi 'strict-transport-security' \
  && printf '  \033[32mOK\033[0m     %-46s présent\n' "en-tête HSTS" || { printf '  \033[31mÉCHEC\033[0m  en-tête HSTS absent\n'; FAIL=1; }
rm -f /tmp/sa-probe.$$

if [ "$FAIL" = 0 ]; then
  say "Déploiement terminé"
else
  printf '\n\033[33mDéploiement installé, mais certaines vérifications ont échoué. Journaux : %s/api/storage/logs/ et /var/log/nginx/error.log\033[0m\n' "$DEST"
fi
cat <<NEXT

Prochaines étapes :
  1. Google Cloud Console : ajouter l'origine  https://$DOMAIN  au client OAuth (« Origines JavaScript autorisées »).
  2. Administration : https://$DOMAIN/admin   (compte : $COMMISSION_EMAIL)
  3. Créer le scrutin, importer ou synchroniser la liste électorale, puis l'ARMER (« Ouvrir le scrutin ») la veille.
  4. Sauvegarde : mysqldump --single-transaction $DB_NAME | gzip > sa_vote-\$(date +%F).sql.gz  (à copier HORS du serveur).
  Retour arrière nginx : cp $NGINX_SITE.bak-$STAMP $NGINX_SITE && nginx -t && systemctl reload nginx
NEXT
exit "$FAIL"
