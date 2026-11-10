#!/usr/bin/env bash
# Préparation d'un VPS Ubuntu 22.04/24.04 neuf pour Vote SA (nginx, PHP 8.3-FPM, MySQL, Node, Certbot, pare-feu).
# À lancer UNE fois, en root :  sudo bash deploy/provision.sh
#
# NON TESTÉ sur le VPS réel : à relire ligne par ligne avant de l'exécuter.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y software-properties-common curl git unzip ufw fail2ban nginx mysql-server certbot python3-certbot-nginx

# PHP 8.3 (dépôt Ondřej Surý pour les Ubuntu qui ne l'ont pas nativement)
add-apt-repository -y ppa:ondrej/php
apt-get update
apt-get install -y php8.3-fpm php8.3-cli php8.3-mysql php8.3-mbstring php8.3-xml php8.3-curl php8.3-zip php8.3-gd php8.3-intl php8.3-bcmath

# Composer
curl -fsS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Node.js 22 LTS (pour construire le front)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# OPcache : indispensable pour la réactivité de Laravel
cat >/etc/php/8.3/fpm/conf.d/90-sa-vote.ini <<'EOF'
opcache.enable=1
opcache.memory_consumption=192
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0   ; déploiement = reload de php-fpm (voir deploy.sh)
expose_php=0
EOF

# Pare-feu : SSH, HTTP, HTTPS seulement. MySQL n'est PAS exposé.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

systemctl enable --now nginx php8.3-fpm mysql fail2ban

cat <<'EOF'

Étapes manuelles restantes (voir deploy/README.md) :
  1. Base de données et utilisateur MySQL dédiés.
  2. Cloner le dépôt dans /var/www/sa, renseigner api/.env, déployer (deploy/deploy.sh).
  3. Installer le site nginx + certificat HTTPS (certbot).
  4. Créer le compte de la commission :  php artisan commission:user prenom.nom@zurcher.edu.mg
  5. Installer le cron du planificateur.
EOF
