#!/usr/bin/env bash
# Primer arranque: consigue el certificado HTTPS de Let's Encrypt y levanta todo el sitio.
# Uso (en el VPS, dentro de la carpeta del proyecto):  ./deploy/init-ssl.sh
# Para probar sin gastar intentos de Let's Encrypt:      STAGING=1 ./deploy/init-ssl.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Falta el archivo .env. Copia .env.example como .env y rellénalo."; exit 1; }
set -a; . ./.env; set +a
: "${DOMAIN:?Falta DOMAIN en .env}"
: "${LETSENCRYPT_EMAIL:?Falta LETSENCRYPT_EMAIL en .env}"
: "${POSTGRES_PASSWORD:?Falta POSTGRES_PASSWORD en .env}"

echo "1/5 Construyendo la aplicación…"
docker compose build app

echo "2/5 Creando un certificado provisional para que Nginx pueda arrancar…"
docker compose run --rm --no-deps --entrypoint sh certbot -c "
  mkdir -p /etc/letsencrypt/live/$DOMAIN &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=localhost \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem 2>/dev/null"

echo "3/5 Arrancando base de datos, aplicación y Nginx…"
docker compose up -d db app nginx

echo "4/5 Pidiendo el certificado real a Let's Encrypt…"
docker compose run --rm --no-deps --entrypoint sh certbot -c "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"
STAGE_ARG=""; [ "${STAGING:-0}" = "1" ] && STAGE_ARG="--staging"
docker compose run --rm --no-deps --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email $STAGE_ARG

echo "5/5 Recargando Nginx y activando la renovación automática…"
docker compose exec nginx nginx -s reload
docker compose up -d certbot

echo
echo "Listo: https://$DOMAIN"
echo "Siguiente paso: crea la cuenta de la artista con"
echo "  docker compose exec app npm run create-artist -- --email TU_CORREO --name Zaber --handle zaber"
