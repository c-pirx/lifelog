#!/usr/bin/env bash
#
# Kopia zapasowa bazy. Uruchamiana codziennie przez systemd (asystent-kopia.timer).
#
# Używamy `sqlite3 .backup`, a NIE zwykłego kopiowania pliku. Baza działa
# w trybie WAL, w którym część zapisanych danych siedzi w osobnym pliku -wal.
# Skopiowanie samego .db w trakcie zapisu dałoby kopię niespójną albo
# niekompletną — i dowiedzielibyśmy się o tym dopiero przy odtwarzaniu.

set -euo pipefail

BAZA=/var/lib/asystent/asystent.db
KATALOG_KOPII=/var/backups/asystent
ILE_TRZYMAC=14

mkdir -p "$KATALOG_KOPII"

if [ ! -f "$BAZA" ]; then
  echo "Brak bazy $BAZA — nic do zrobienia."
  exit 0
fi

DATA=$(date +%Y-%m-%d)
PLIK="$KATALOG_KOPII/asystent-$DATA.db"

sqlite3 "$BAZA" ".backup '$PLIK'"
gzip -f "$PLIK"

# Kopia zawiera dane zdrowotne — odczyt tylko dla właściciela.
chmod 600 "$PLIK.gz"

# Rotacja: zostawiamy ostatnie N dni, resztę kasujemy.
find "$KATALOG_KOPII" -name 'asystent-*.db.gz' -type f -printf '%T@ %p\n' \
  | sort -rn | tail -n +$((ILE_TRZYMAC + 1)) | cut -d' ' -f2- \
  | xargs -r rm -f

echo "Kopia: $PLIK.gz ($(du -h "$PLIK.gz" | cut -f1)), w katalogu $(find "$KATALOG_KOPII" -name '*.db.gz' | wc -l) plików"
