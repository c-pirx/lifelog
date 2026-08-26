#!/usr/bin/env bash
#
# Wysyła kod na serwer i przebudowuje aplikację.
# Uruchamiać z katalogu projektu na maszynie deweloperskiej:
#
#   bash wdrozenie/wyslij.sh [nazwa-hosta-ssh]
#
# Domyślny host to "asystent" (wpis w ~/.ssh/config).
#
# Wysyłamy `git archive`, czyli dokładnie pliki śledzone przez git —
# bez node_modules, bez .env i bez bazy danych. To ważniejsze, niż wygodne:
# przypadkowe wysłanie lokalnego .env nadpisałoby sekrety produkcyjne.

set -euo pipefail

HOST="${1:-asystent}"
KATALOG_KODU=/opt/asystent

# Na produkcję jedzie wyłącznie master. Skrypt pakuje HEAD katalogu, z którego
# go uruchomiono — bez tej zapory wdrożenie z gałęzi roboczej albo z worktree
# wysłałoby kod, którego nie ma w historii master, i wersje by się rozjechały.
# Świadome odstępstwo: WYMUS_GALAZ=1 bash wdrozenie/wyslij.sh
GALAZ=$(git rev-parse --abbrev-ref HEAD)
if [ "$GALAZ" != "master" ] && [ "${WYMUS_GALAZ:-}" != "1" ]; then
  echo "STOP: wdrażamy wyłącznie z gałęzi master, a tu jest: $GALAZ"
  echo "Scal zmiany do master i uruchom ponownie."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "UWAGA: masz niezapisane zmiany. Wysyłam ostatni commit, nie katalog roboczy."
  echo
fi

echo "==> Pakowanie kodu z ostatniego commita ($(git rev-parse --short HEAD))"
git archive --format=tar HEAD | gzip > /tmp/asystent-kod.tar.gz
echo "    rozmiar: $(du -h /tmp/asystent-kod.tar.gz | cut -f1)"

echo "==> Wysyłanie na $HOST"
scp -q /tmp/asystent-kod.tar.gz "$HOST:/tmp/"

echo "==> Rozpakowywanie"
ssh "$HOST" "
  set -e
  sudo mkdir -p $KATALOG_KODU
  # --overwrite zamiast czyszczenia katalogu: zostawia node_modules,
  # dzięki czemu npm ci nie musi pobierać wszystkiego od zera.
  sudo tar -xzf /tmp/asystent-kod.tar.gz -C $KATALOG_KODU --overwrite
  rm -f /tmp/asystent-kod.tar.gz
"

rm -f /tmp/asystent-kod.tar.gz
echo "==> Kod na miejscu. Teraz na serwerze: bash $KATALOG_KODU/wdrozenie/02-aplikacja.sh"
