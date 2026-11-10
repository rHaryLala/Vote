#!/usr/bin/env bash
#
# Vote SA — branche l'application de vote sur le registrar (même serveur). À lancer SUR LE VPS, sans sudo :
#
#   bash ~/sa-release/deploy/registrar/install-on-vps.sh
#
# Ce que fait ce script (rien d'autre) :
#   1. copie electeurs-sa.api.php dans registrar/app/ (export en LECTURE SEULE, désactivé tant qu'il n'a pas de jeton) ;
#   2. génère un jeton aléatoire : son EMPREINTE SHA-256 est ajoutée à registrar/data/config.secret.php
#      (après sauvegarde de ce fichier), le jeton lui-même va dans /var/www/sa/api/.env — il n'est jamais affiché ;
#   3. renseigne REGISTRAR_EXPORT_URL et REGISTRAR_EXPORT_TOKEN dans /var/www/sa/api/.env (sauvegardé avant) ;
#   4. teste l'export (sans jeton, mauvais jeton, bon jeton) et affiche les sessions trouvées.
#
# Relançable : si le jeton existe déjà, seul le fichier d'export est mis à jour (le jeton et le .env ne sont pas touchés).
# Retour arrière : voir la fin du script.
set -euo pipefail

REGISTRAR=/var/www/registrar
SA_API=/var/www/sa/api
URL=https://registrar.zurcher.edu.mg/app/electeurs-sa.api.php
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/electeurs-sa.api.php"
STAMP=$(date +%Y%m%d-%H%M%S)

die() { echo "ERREUR : $*" >&2; exit 1; }

[ -f "$SRC" ] || die "electeurs-sa.api.php introuvable à côté du script ($SRC)."
[ -d "$REGISTRAR/app" ] && [ -f "$REGISTRAR/data/config.secret.php" ] || die "registrar introuvable dans $REGISTRAR."
[ -f "$SA_API/.env" ] || die "$SA_API/.env introuvable : lancez d'abord server-setup.sh."
[ -w "$REGISTRAR/app" ] && [ -w "$REGISTRAR/data/config.secret.php" ] && [ -w "$SA_API/.env" ] \
  || die "droits d'écriture insuffisants (ce script se lance avec votre compte, pas avec sudo)."

echo "==> 1/4 Export du registrar"
sed 's/\r$//' "$SRC" > "/tmp/electeurs-sa.$STAMP.php"
php -l "/tmp/electeurs-sa.$STAMP.php" >/dev/null
DEST="$REGISTRAR/app/electeurs-sa.api.php"
[ -f "$DEST" ] && cp -p "$DEST" "$DEST.bak-$STAMP"
install -m 664 -g www-data "/tmp/electeurs-sa.$STAMP.php" "$DEST"
rm -f "/tmp/electeurs-sa.$STAMP.php"

# Un jeton existe déjà : on met seulement l'export à jour (nouvelle version), sans toucher au jeton ni au .env.
if grep -q SA_VOTE_EXPORT_TOKEN_SHA256 "$REGISTRAR/data/config.secret.php"; then
  echo "    Export mis à jour (ancienne version : $DEST.bak-$STAMP)."
  echo "    Un jeton est déjà défini : il n'est pas modifié."
  EXISTING=$(grep -E '^REGISTRAR_EXPORT_TOKEN=' "$SA_API/.env" | cut -d= -f2- || true)
  if [ -n "$EXISTING" ]; then
    st=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $EXISTING" "$URL?action=sessions")
    echo "    test avec le jeton existant : HTTP $st  (200 attendu)"
  fi
  echo "Retour arrière : cp -p $DEST.bak-$STAMP $DEST"
  exit 0
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
echo "    sans jeton configuré : HTTP $code (503 attendu : export désactivé par défaut)"
[ "$code" = 503 ] || die "réponse inattendue ($code) : le fichier n'est pas servi par nginx comme prévu. Rien d'autre n'a été modifié."

echo "==> 2/4 Jeton (jamais affiché)"
TOKEN=$(openssl rand -hex 32)
HASH=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)
cp -p "$REGISTRAR/data/config.secret.php" "$REGISTRAR/data/config.secret.php.bak-$STAMP"
printf '\n// Export de la liste électorale pour Vote SA (sa.zurcher.edu.mg), lecture seule : empreinte SHA-256 du jeton.\nif (!defined("SA_VOTE_EXPORT_TOKEN_SHA256")) define("SA_VOTE_EXPORT_TOKEN_SHA256", "%s");\n' "$HASH" \
  >> "$REGISTRAR/data/config.secret.php"
php -l "$REGISTRAR/data/config.secret.php" >/dev/null || {
  cp -p "$REGISTRAR/data/config.secret.php.bak-$STAMP" "$REGISTRAR/data/config.secret.php"
  die "config.secret.php invalide après modification : restauré, rien n'a changé."
}

echo "==> 3/4 Application de vote (.env)"
cp -p "$SA_API/.env" "$SA_API/.env.bak-registrar-$STAMP"
set_env() { # clé valeur : remplace la ligne existante (même vide) ou l'ajoute
  if grep -q "^$1=" "$SA_API/.env"; then sed -i "s|^$1=.*|$1=$2|" "$SA_API/.env"; else printf '%s=%s\n' "$1" "$2" >> "$SA_API/.env"; fi
}
set_env REGISTRAR_EXPORT_URL "$URL"
set_env REGISTRAR_EXPORT_TOKEN "$TOKEN"
# Le cache de configuration de Laravel ne relit pas le .env : on l'invalide (server-setup.sh le reconstruit).
rm -f "$SA_API/bootstrap/cache/config.php"

echo "==> 4/4 Tests"
t() { curl -s -o /dev/null -w '%{http_code}' "$@" "$URL?action=sessions"; }
echo "    sans jeton    : HTTP $(t)  (401 attendu)"
echo "    mauvais jeton : HTTP $(t -H 'Authorization: Bearer 0000')  (401 attendu)"
ok=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$URL?action=sessions")
status=${ok##*$'\n'}
echo "    bon jeton     : HTTP $status  (200 attendu)"
if [ "$status" = 200 ]; then
  echo "    sessions renvoyées : $(printf '%s' "${ok%$'\n'*}" | grep -o '"session_id\|"id":' | wc -l)"
  printf '%s' "${ok%$'\n'*}" | grep -o '"name":"[^"]*","year":"[^"]*"' | head -3 | sed 's/^/      /'
else
  echo "    Le jeton n'est pas accepté : voir /var/log/nginx/error.log et $REGISTRAR/data/config.secret.php." >&2
fi

cat <<DONE

Terminé. Étape suivante : relancer l'installation pour prendre en compte la configuration (reconstruit les caches) :
  sudo bash ~/sa-release/deploy/server-setup.sh

Retour arrière (si besoin) :
  rm $REGISTRAR/app/electeurs-sa.api.php
  cp -p $REGISTRAR/data/config.secret.php.bak-$STAMP $REGISTRAR/data/config.secret.php
  cp -p $SA_API/.env.bak-registrar-$STAMP $SA_API/.env
DONE
