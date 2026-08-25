#!/usr/bin/env bash
#
# nginx jako reverse proxy + certyfikat Let's Encrypt.
# Uruchamiać na serwerze:  bash 03-https.sh asystent.twojadomena.pl
#
# Kolejność jest celowa: najpierw sam HTTP, żeby zdobyć certyfikat, dopiero
# potem pełna konfiguracja z HTTPS. Certbot nie przepisuje wtedy naszego
# pliku konfiguracyjnego, więc mamy nad nim pełną kontrolę.

set -euo pipefail

DOMENA="${1:?Podaj domenę, np. asystent.twojadomena.pl}"
ZRODLO_KONFIGURACJI="$(dirname "$0")/nginx-asystent.conf"

echo "==> Instalacja nginx i certbota"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx

echo "==> Sprawdzenie, czy domena wskazuje na ten serwer"
MOJE_IP=$(curl -sS --max-time 10 https://api.ipify.org || echo "?")
IP_DOMENY=$(getent ahostsv4 "$DOMENA" | awk 'NR==1 {print $1}' || echo "?")
echo "    ten serwer: $MOJE_IP"
echo "    $DOMENA:    $IP_DOMENY"
if [ "$MOJE_IP" != "$IP_DOMENY" ]; then
  echo "PRZERWANO: domena nie wskazuje na ten serwer. Popraw rekord A i poczekaj na propagację."
  exit 1
fi

echo "==> Tymczasowa konfiguracja HTTP (do weryfikacji certyfikatu)"
sudo mkdir -p /var/www/certbot
sudo tee /etc/nginx/sites-available/asystent >/dev/null <<KONIEC
server {
    listen 80;
    listen [::]:80;
    server_name $DOMENA;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
KONIEC
sudo ln -sf /etc/nginx/sites-available/asystent /etc/nginx/sites-enabled/asystent
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> Próba na sucho (limit to 5 certyfikatów na tydzień — nie marnujemy prób)"
sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMENA" \
  --non-interactive --agree-tos --register-unsafely-without-email --dry-run

echo "==> Wystawianie właściwego certyfikatu"
sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMENA" \
  --non-interactive --agree-tos --register-unsafely-without-email

echo "==> Docelowa konfiguracja z HTTPS"
sudo sed "s/DOMENA_TUTAJ/$DOMENA/g" "$ZRODLO_KONFIGURACJI" \
  | sudo tee /etc/nginx/sites-available/asystent >/dev/null
sudo nginx -t
sudo systemctl reload nginx

echo "==> Automatyczne odnawianie"
sudo systemctl enable --now certbot.timer >/dev/null 2>&1 || true
sudo certbot renew --dry-run 2>&1 | tail -3

echo
echo "==> Gotowe. Sprawdzenie z zewnątrz:"
curl -sS --max-time 10 "https://$DOMENA/zdrowie" && echo
