#!/usr/bin/env bash
#
# Instalacja aplikacji jako usługi systemowej.
# Uruchamiać na serwerze: bash 02-aplikacja.sh
#
# Zakłada, że kod został wcześniej wgrany do /opt/asystent
# (robi to skrypt wyslij.sh z maszyny deweloperskiej).
#
# Idempotentny: ponowne uruchomienie aktualizuje aplikację, ale NIE nadpisuje
# istniejących sekretów ani bazy danych.

set -euo pipefail

KATALOG_KODU=/opt/asystent
KATALOG_DANYCH=/var/lib/asystent
KATALOG_KONFIGURACJI=/etc/asystent
UZYTKOWNIK=asystent

echo "==> Instalacja Node.js"
if ! command -v node >/dev/null; then
  sudo apt-get update -qq
  # Ubuntu 26.04 ma w repozytorium Node 22 LTS — wystarczający i utrzymywany
  # razem z systemem, więc nie dokładamy zewnętrznego źródła pakietów.
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> Konto systemowe aplikacji"
# Konto bez powłoki i bez katalogu domowego: służy wyłącznie do uruchomienia
# procesu, nie da się na nie zalogować.
id -u "$UZYTKOWNIK" >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin "$UZYTKOWNIK"

echo "==> Katalogi"
sudo mkdir -p "$KATALOG_DANYCH" "$KATALOG_KONFIGURACJI"
sudo chown "$UZYTKOWNIK:$UZYTKOWNIK" "$KATALOG_DANYCH"
sudo chmod 750 "$KATALOG_DANYCH"
sudo chmod 750 "$KATALOG_KONFIGURACJI"

echo "==> Konfiguracja i sekrety"
# Test MUSI iść przez sudo. Katalog /etc/asystent ma prawa 750 root:root,
# a skrypt uruchamiamy jako zwykły użytkownik — bez sudo `[ -f ]` nie wejdzie
# do katalogu i odpowiada „pliku nie ma" nawet wtedy, gdy plik tam jest.
# Kosztowało to unieważnienie sekretów przy wdrożeniu: skrypt uznawał serwer
# za świeży i generował nowy token konektora oraz nowe hasło do aplikacji.
if sudo test -f "$KATALOG_KONFIGURACJI/env"; then
  echo "    plik env już istnieje — zostawiam bez zmian"
else
  # Sekrety produkcyjne generujemy na miejscu i nigdy nie przenosimy
  # z maszyny deweloperskiej — tamte służą wyłącznie do pracy lokalnej.
  # Tokeny konektorów żyją teraz w rejestrze użytkowników (per konto),
  # więc w env zostały tylko sekrety wspólne dla całej instancji.
  SESSION_SECRET=$(openssl rand -hex 32)
  REJESTRACJA_HASLO=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)

  sudo tee "$KATALOG_KONFIGURACJI/env" >/dev/null <<KONIEC
# Konfiguracja produkcyjna. Wygenerowana $(date -Iseconds).
NODE_ENV=production
PORT=3000
# Nasłuch wyłącznie lokalny — do internetu wystawia dopiero nginx.
HOST=127.0.0.1
# Katalog danych: rejestr.db i podkatalog uzytkownicy/ z dziennikami.
DANE_KATALOG=$KATALOG_DANYCH
TZ_APP=Europe/Warsaw
SESSION_SECRET=$SESSION_SECRET
REJESTRACJA_HASLO=$REJESTRACJA_HASLO
KONIEC
  echo
  echo "    !!! WYGENEROWANO NOWE SEKRETY !!!"
  echo "    Hasło bramy rejestracji i klucz sesji ZMIENIŁY SIĘ."
  echo "    Odczyt wartości: sudo cat $KATALOG_KONFIGURACJI/env"
  echo
fi

sudo chown root:"$UZYTKOWNIK" "$KATALOG_KONFIGURACJI/env"
sudo chmod 640 "$KATALOG_KONFIGURACJI/env"

echo "==> Zależności i budowanie"
cd "$KATALOG_KODU"
# Najpierw pełna instalacja (potrzebny TypeScript do budowania), potem
# usunięcie narzędzi deweloperskich — na serwerze zostaje samo wykonanie.
sudo npm ci --no-audit --no-fund
sudo npm run build
sudo npm prune --omit=dev --no-audit --no-fund

sudo chown -R root:root "$KATALOG_KODU"
# Kod jest tylko do odczytu dla konta aplikacji — proces nie może
# nadpisać własnych plików, nawet gdyby został przejęty.
sudo chmod -R a+rX "$KATALOG_KODU"

echo "==> Kopia zapasowa przed restartem"
# Kopia z timera powstaje o 3:30 — wdrożenie o czternastej miałoby
# zabezpieczenie sprzed jedenastu godzin. Przy cudzych danych to za mało.
if [ -x /usr/local/bin/asystent-kopia ]; then
  sudo /usr/local/bin/asystent-kopia
else
  echo "    (skrypt kopii jeszcze nie zainstalowany — pomijam; patrz 04-kopie.sh)"
fi

echo "==> Usługa systemd"
sudo cp "$KATALOG_KODU/wdrozenie/asystent.service" /etc/systemd/system/asystent.service
sudo systemctl daemon-reload
sudo systemctl enable asystent >/dev/null
sudo systemctl restart asystent

sleep 3
echo
echo "==> Stan usługi:"
sudo systemctl is-active asystent
sudo journalctl -u asystent -n 5 --no-pager | tail -5
echo
echo "==> Test lokalny:"
curl -sS --max-time 5 http://127.0.0.1:3000/zdrowie && echo
