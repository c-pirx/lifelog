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
| `/var/lib/asystent/rejestr.db` | konta i lista oczekujących: hasze haseł, hasze tokenów i kodów | asystent |
| `/var/lib/asystent/uzytkownicy/` | dziennik SQLite na użytkownika (`<id>.db`) | asystent |
| `/etc/asystent/env` | sekrety produkcyjne | root, odczyt dla grupy |
| `/var/backups/asystent` | kopie zapasowe, 14 dni wstecz | root |

### Przejście z instalacji jednoosobowej

Serwer z bazą `asystent.db` po wdrożeniu wersji wielodostępowej **odmówi
startu** z komunikatem wskazującym przeniesienie. To zapora, nie awaria:

```bash
ssh asystent
sudo systemctl stop asystent
cd /opt/asystent
sudo DANE_KATALOG=/var/lib/asystent node tools/przenies-do-wielu.mjs --login twoj-login --haslo twoje-nowe-haslo
sudo chown -R asystent:asystent /var/lib/asystent
sudo systemctl start asystent
```

Skrypt robi kopię (`asystent.db.przed-przeniesieniem`), zakłada konto nr 1
i przenosi dziennik pod `uzytkownicy/1.db`. Wypisany adres konektora wklej
na claude.ai — stary przestał działać. Drugie uruchomienie odmawia.

### Poczta wychodząca

Cztery zmienne w `/etc/asystent/env`: `RESEND_API_KEY`, `MAIL_OD`,
`MAIL_GOSPODARZ`, `PUBLICZNY_ADRES`. **Komplet albo żadna** — bez nich
aplikacja wstaje i zapisy na listę oczekujących działają, ale maile powitalne
i powiadomienia nie wychodzą. Sprawdzenie: `curl -s https://<domena>/zdrowie`
pokazuje `"poczta": true`.

`02-aplikacja.sh` wypisuje te zmienne do pliku env **wyłącznie przy pierwszej
instalacji** (potem plik zostaje nietknięty), więc na działającym serwerze
trzeba dopisać je ręcznie: `sudo nano /etc/asystent/env` i restart usługi.

### Powiadomienia push

Trzy zmienne w `/etc/asystent/env`: `VAPID_PUBLICZNY`, `VAPID_PRYWATNY`,
`VAPID_KONTAKT` (adres w formacie `mailto:`). **Komplet albo żadna** — bez nich
aplikacja działa w całości, tylko przypomnienia o treningu i kaloriach nie
wychodzą. Sprawdzenie: `curl -s https://<domena>/zdrowie` pokazuje `"push": true`.

Klucze generuje się **raz** i zostawia na zawsze:

```bash
npx web-push generate-vapid-keys
sudo nano /etc/asystent/env      # wklej trzy zmienne
sudo systemctl restart asystent
```

**Wymiana kluczy unieważnia wszystkie subskrypcje** — każdy użytkownik musiałby
włączyć powiadomienia od nowa, a wiersze w `subskrypcje_push` zostałyby martwe
do czasu, aż wysyłka dostanie na nie 410. To ta sama pułapka co przy kluczu
sesji: `02-aplikacja.sh` dopisuje zmienne wyłącznie do świeżego pliku env, więc
na działającym serwerze wdrożenie przejdzie bez słowa, a jedynym śladem braku
będzie `"push": false` w `/zdrowie`.

Powiadomienia wysyła tik w procesie aplikacji, co pięć minut — nie ma tu
osobnej jednostki systemd do skonfigurowania.

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
ssh asystent 'D=$(ls -t /var/backups/asystent/asystent-*.tar.gz | head -1); \
  rm -rf /tmp/proba && mkdir -p /tmp/proba && tar -xzf "$D" -C /tmp/proba && \
  echo "kopia: $D" && ls /tmp/proba && \
  for B in /tmp/proba/*.db; do echo "$B: $(sqlite3 "$B" "PRAGMA integrity_check;")"; done && \
  sqlite3 /tmp/proba/1.db "SELECT (SELECT COUNT(*) FROM posilki) AS posilki, (SELECT COUNT(*) FROM serie) AS serie, (SELECT MAX(data_lokalna) FROM posilki) AS ostatni_dzien;"; \
  rm -rf /tmp/proba'
```

Oczekiwany wynik: komplet plików (`rejestr.db` i dziennik na każde konto),
`ok` przy każdym, liczby porównywalne z produkcją i `ostatni_dzien` z wczoraj
albo z dzisiaj. Liczby z produkcji do porównania:

```bash
ssh asystent 'sudo -u asystent sqlite3 /var/lib/asystent/uzytkownicy/1.db "SELECT (SELECT COUNT(*) FROM posilki), (SELECT COUNT(*) FROM serie);"'
```

Jeżeli `ostatni_dzien` jest sprzed kilku dni, to nie jest problem z kopią, tylko
sygnał, że timer `asystent-kopia.timer` przestał chodzić — sprawdź
`systemctl list-timers asystent-kopia`.

## Odtworzenie baz z kopii

Kopia to jeden spójny komplet z tej samej chwili — odtwarzamy go w całości,
nie pojedyncze pliki, żeby rejestr i dzienniki do siebie pasowały.

```bash
ssh asystent
sudo systemctl stop asystent

# Bieżące bazy idą na bok, a nie do kosza — gdyby kopia okazała się gorsza
# niż to, co jest, bez tego kroku nie ma już do czego wrócić.
sudo mv /var/lib/asystent /var/lib/asystent.przed-odtworzeniem
sudo mkdir -p /var/lib/asystent/uzytkownicy

sudo tar -xzf /var/backups/asystent/asystent-RRRR-MM-DD.tar.gz -C /var/lib/asystent
# Dzienniki (pliki liczbowe) wracają do podkatalogu uzytkownicy/.
cd /var/lib/asystent && for B in [0-9]*.db; do sudo mv "$B" uzytkownicy/; done

sudo chown -R asystent:asystent /var/lib/asystent
sudo chmod 750 /var/lib/asystent
for B in /var/lib/asystent/rejestr.db /var/lib/asystent/uzytkownicy/*.db; do
  sudo -u asystent sqlite3 "$B" "PRAGMA integrity_check;"
done

sudo systemctl start asystent
```

Katalog `.przed-odtworzeniem` kasujemy dopiero po sprawdzeniu, że aplikacja
wstała i pokazuje spodziewane dane.

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
