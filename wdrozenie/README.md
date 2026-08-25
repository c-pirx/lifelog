# Wdrożenie

Serwer produkcyjny: **OVH VPS-1**, Ubuntu 26.04 LTS, Warszawa.
Adres: `asystent.twojadomena.pl` → `<IP-twojego-serwera>`

## Dostęp

```bash
ssh asystent
```

Wpis w `~/.ssh/config` na maszynie deweloperskiej wskazuje użytkownika,
adres i klucz. Logowanie hasłem jest wyłączone — awaryjnie zostaje konsola
KVM w panelu OVH, która działa niezależnie od SSH.

## Aktualizacja aplikacji

```bash
git commit -am "opis zmiany"
bash wdrozenie/wyslij.sh
ssh asystent 'bash /opt/asystent/wdrozenie/02-aplikacja.sh'
```

`wyslij.sh` wysyła `git archive` z ostatniego commita, więc lokalny `.env`
i baza nie mogą pojechać przypadkiem. Skrypt instalacyjny nie nadpisuje
istniejących sekretów ani danych.

## Układ na serwerze

| Ścieżka | Zawartość | Właściciel |
|---|---|---|
| `/opt/asystent` | kod, tylko do odczytu dla aplikacji | root |
| `/var/lib/asystent` | baza SQLite | asystent |
| `/etc/asystent/env` | sekrety produkcyjne | root, odczyt dla grupy |
| `/var/backups/asystent` | kopie zapasowe, 14 dni wstecz | root |

Aplikacja działa jako konto systemowe `asystent` bez powłoki. Nasłuchuje
wyłącznie na `127.0.0.1:3000`; do internetu wystawia ją nginx.

## Skrypty

| Skrypt | Kiedy |
|---|---|
| `01-zabezpiecz.sh` | raz, na świeżym serwerze |
| `02-aplikacja.sh` | przy każdej aktualizacji kodu |
| `03-https.sh <domena>` | raz, po ustawieniu rekordu DNS |
| `04-kopie.sh` | raz |

## Codzienne polecenia

```bash
ssh asystent 'systemctl status asystent'          # stan usługi
ssh asystent 'sudo journalctl -u asystent -n 50'  # dziennik aplikacji
ssh asystent 'sudo systemctl restart asystent'    # restart
ssh asystent 'sudo /usr/local/bin/asystent-kopia' # kopia na żądanie
```

## Sprawdzenie kopii bez ruszania produkcji

Warto powtarzać co jakiś czas — sprawdza **dzisiejszą** kopię, a nie to, że
procedura zadziałała kiedyś. Nie zatrzymuje usługi i nie dotyka żywej bazy.

```bash
ssh asystent 'D=$(ls -t /var/backups/asystent/*.db.gz | head -1); \
  gunzip -c "$D" > /tmp/proba.db && \
  echo "kopia: $D" && \
  sqlite3 /tmp/proba.db "PRAGMA integrity_check;" && \
  sqlite3 /tmp/proba.db "SELECT (SELECT COUNT(*) FROM posilki) AS posilki, (SELECT COUNT(*) FROM serie) AS serie, (SELECT MAX(data_lokalna) FROM posilki) AS ostatni_dzien;"; \
  rm -f /tmp/proba.db'
```

Oczekiwany wynik: `ok`, liczby porównywalne z produkcją i `ostatni_dzien`
z wczoraj albo z dzisiaj. Liczby z produkcji do porównania:

```bash
ssh asystent 'sudo -u asystent sqlite3 /var/lib/asystent/asystent.db "SELECT (SELECT COUNT(*) FROM posilki), (SELECT COUNT(*) FROM serie);"'
```

Jeżeli `ostatni_dzien` jest sprzed kilku dni, to nie jest problem z kopią, tylko
sygnał, że timer `asystent-kopia.timer` przestał chodzić — sprawdź
`systemctl list-timers asystent-kopia`.

## Odtworzenie bazy z kopii

```bash
ssh asystent
sudo systemctl stop asystent

# Bieżąca baza idzie na bok, a nie do kosza — gdyby kopia okazała się gorsza
# niż to, co jest, bez tego kroku nie ma już do czego wrócić.
sudo mv /var/lib/asystent/asystent.db /var/lib/asystent/asystent.db.przed-odtworzeniem

# Pliki WAL należą do STAREJ bazy. Zostawione obok nowej, SQLite spróbuje je
# do niej doczytać — usuwamy je razem z nią.
sudo rm -f /var/lib/asystent/asystent.db-wal /var/lib/asystent/asystent.db-shm

sudo gunzip -c /var/backups/asystent/asystent-RRRR-MM-DD.db.gz \
  | sudo tee /var/lib/asystent/asystent.db >/dev/null
sudo chown asystent:asystent /var/lib/asystent/asystent.db
sudo -u asystent sqlite3 /var/lib/asystent/asystent.db "PRAGMA integrity_check;"

sudo systemctl start asystent
```

Plik `.przed-odtworzeniem` kasujemy dopiero po sprawdzeniu, że aplikacja wstała
i pokazuje spodziewane dane.

Kopie powstają przez `sqlite3 .backup`, a nie przez kopiowanie pliku — baza
działa w trybie WAL, w którym część zapisów siedzi w osobnym pliku `-wal`,
więc zwykła kopia `.db` w trakcie zapisu bywa niespójna.

## Decyzje, które warto znać przed zmianami

**Token MCP jest maskowany w logach nginx.** Token jest częścią ścieżki URL,
a nginx domyślnie zapisuje pełne ścieżki — sekret trafiłby czystym tekstem do
`access.log` i jego archiwów. Mapowanie w `nginx-asystent.conf` podmienia go
na `[token-ukryty]`. Nie usuwaj tego przy edycji konfiguracji.

**Plik SSH nazywa się `00-utwardzenie.conf`, nie `99-`.** W SSH wygrywa
pierwsze wystąpienie ustawienia, a obraz chmurowy Ubuntu ma
`50-cloud-init.conf` z włączonymi hasłami. Wyższy numer zostałby przesłonięty.

**Certyfikat pobierany przez `--webroot`, nie przez wtyczkę `--nginx`.**
Dzięki temu certbot nie przepisuje naszej konfiguracji. Ustawienia TLS są
wpisane wprost, bo `options-ssl-nginx.conf` tworzy wyłącznie wtyczka `--nginx`.

**Port 80 musi zostać otwarty na stałe.** Let's Encrypt odnawia certyfikat
co 60 dni i za każdym razem sprawdza ścieżkę `/.well-known/acme-challenge/`.

**`MemoryDenyWriteExecute` musi zostać wyłączone** w usłudze systemd —
silnik JavaScriptu kompiluje kod w locie i bez prawa do zapisywalno-
wykonywalnej pamięci Node w ogóle nie wystartuje.

## Co zostało sprawdzone

- HTTPS z zewnątrz, certyfikat Let's Encrypt, przekierowanie z HTTP
- Konektor MCP: 11 narzędzi, zły token odrzucony (401)
- Token nieobecny w logach nginx (zero trafień w całym pliku)
- Logowanie hasłem i logowanie na root odrzucone
- Kopia zapasowa odtwarzalna, `PRAGMA integrity_check` = ok
- **Restart serwera**: wszystkie usługi wracają samoczynnie
