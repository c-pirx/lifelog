#!/usr/bin/env bash
#
# Kopia zapasowa baz. Uruchamiana codziennie przez systemd (asystent-kopia.timer)
# oraz przez 02-aplikacja.sh przed każdym restartem usługi.
#
# Używamy `sqlite3 .backup`, a NIE zwykłego kopiowania plików. Bazy działają
# w trybie WAL, w którym część zapisanych danych siedzi w osobnym pliku -wal.
# Skopiowanie samego .db w trakcie zapisu dałoby kopię niespójną albo
# niekompletną — i dowiedzielibyśmy się o tym dopiero przy odtwarzaniu.
#
# Od wielodostępu baz jest wiele: rejestr kont plus dziennik na użytkownika.
# Jedna kopia to jeden katalog z datą, spakowany w całości — odtworzenie
# zawsze przywraca KOMPLET z tej samej chwili, nie zlepek różnych godzin.

set -euo pipefail

KATALOG_DANYCH=/var/lib/asystent
KATALOG_KOPII=/var/backups/asystent
ILE_TRZYMAC=14

mkdir -p "$KATALOG_KOPII"

DATA=$(date +%Y-%m-%d)
ROBOCZY=$(mktemp -d)
trap 'rm -rf "$ROBOCZY"' EXIT

ILE=0
for BAZA in "$KATALOG_DANYCH"/rejestr.db "$KATALOG_DANYCH"/asystent.db "$KATALOG_DANYCH"/uzytkownicy/*.db; do
  [ -f "$BAZA" ] || continue
  NAZWA=$(basename "$BAZA")
  sqlite3 "$BAZA" ".backup '$ROBOCZY/$NAZWA'"
  ILE=$((ILE + 1))
done

if [ "$ILE" -eq 0 ]; then
  echo "Brak baz w $KATALOG_DANYCH — nic do zrobienia."
  exit 0
fi

PLIK="$KATALOG_KOPII/asystent-$DATA.tar.gz"
tar -czf "$PLIK" -C "$ROBOCZY" .

# Kopia zawiera dane zdrowotne — odczyt tylko dla właściciela.
chmod 600 "$PLIK"

# Rotacja: zostawiamy ostatnie N dni, resztę kasujemy. Stary wzorzec nazw
# (asystent-*.db.gz) sprzątany razem z nowym, żeby przejście na archiwum
# tar nie zostawiło wiecznych plików sprzed zmiany.
find "$KATALOG_KOPII" \( -name 'asystent-*.tar.gz' -o -name 'asystent-*.db.gz' \) -type f -printf '%T@ %p\n' \
  | sort -rn | tail -n +$((ILE_TRZYMAC + 1)) | cut -d' ' -f2- \
  | xargs -r rm -f

echo "Kopia: $PLIK ($(du -h "$PLIK" | cut -f1), baz: $ILE), w katalogu $(find "$KATALOG_KOPII" -name 'asystent-*' -type f | wc -l) plików"
