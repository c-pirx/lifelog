# Asystent diety i treningu

Osobisty dziennik posiłków i treningów jednego użytkownika. Dwa wejścia do
jednej bazy: **Claude** (przez MCP — dyktowanie zdaniem) oraz **aplikacja
webowa PWA** (na siłowni, gdzie rozmowa jest za wolna).

Interfejs, komentarze, komunikaty i commity **po polsku**.

## Dwie zasady, których nie wolno złamać

1. **Logika mieszka w `src/domain/`.** `src/mcp/` i `src/api/` to wyłącznie
   cienkie adaptery. Funkcja dopisana tylko po jednej stronie to błąd — czat
   i aplikacja pokażą wtedy różne dane.
2. **Cały SQL siedzi w `src/db/repo.ts`.** To granica, dzięki której wymiana
   bazy jest przepisaniem jednego pliku.

Trzecia, prawie tak samo ważna: **konwersje czasu tylko przez `src/lib/time.ts`**.
Doba użytkownika liczona jest w `Europe/Warsaw`, serwer stoi w UTC. Nigdy
`getDate()` ani arytmetyka stref w SQL — kolumny `data_lokalna` przechowują
gotowe `YYYY-MM-DD`.

## Polecenia

```bash
npm run dev          # serwer deweloperski (port 3000)
npm test             # 203 testy
npm run typecheck    # kontrola typów, obejmuje też katalog test/
npm run build        # kompilacja do dist/
npm run demo         # dane poglądowe do pracy nad wyglądem (przy działającym dev)
npm run reset -- --tak   # czyszczenie lokalnej bazy
npm run rozszerzenie # paczka .mcpb dla Claude Desktop
```

Przed każdym commitem: `npm run typecheck && npm test`.

## Serwer produkcyjny

Repozytorium jest **publiczne**, więc w plikach śledzonych nie ma adresów ani
sekretów — wszędzie stoją placeholdery. Prawdziwe dane wdrożenia (domena, IP,
hasło do aplikacji, adres konektora, procedura wymiany tokenu) leżą w
**`MOJE.md`** w katalogu projektu, poza repozytorium.

Ogólnie: OVH VPS, Ubuntu 26.04.

```bash
ssh asystent          # wpis w ~/.ssh/config, logowanie kluczem
```

Wdrożenie zmiany:

```bash
git commit -am "opis"
bash wdrozenie/wyslij.sh
ssh asystent 'bash /opt/asystent/wdrozenie/02-aplikacja.sh'
```

`wyslij.sh` wysyła `git archive` z **ostatniego commita**, nie katalog roboczy
— niezacommitowane zmiany nie pojadą. To celowe: chroni przed wysłaniem
lokalnego `.env`.

Szczegóły, układ katalogów i odtwarzanie bazy z kopii: [wdrozenie/README.md](wdrozenie/README.md).

Sekrety produkcyjne: `/etc/asystent/env` na serwerze. **Nie ma ich w kopiach
zapasowych** — kopiowana jest tylko baza.

## Pułapki, na które już wpadliśmy

Każda z nich kosztowała czas. Nie cofaj tych rozwiązań bez potrzeby.

**Końce linii.** `.gitattributes` wymusza LF dla `*.sh`, `*.mjs`, `*.service`.
Bez tego git na Windowsie robi CRLF, a bash na serwerze przerywa na
`$'\r': command not found` — błąd wyglądający jak literówka w skrypcie.

**Token MCP w logach nginx.** Token jest częścią ścieżki URL, a nginx
domyślnie zapisuje pełne ścieżki. Mapowanie w `wdrozenie/nginx-asystent.conf`
podmienia go na `[token-ukryty]`. Nie usuwaj przy edycji konfiguracji.

**Testy plików w skryptach wdrożeniowych idą przez `sudo test -f`.** Skrypty
uruchamiamy jako `ubuntu`, a `/etc/asystent` ma prawa `750 root:root`. Zwykłe
`[ -f /etc/asystent/env ]` nie potrafi wejść do katalogu i odpowiada „pliku
nie ma" — przez co `02-aplikacja.sh` uznawał serwer za świeży i przy **każdym**
wdrożeniu generował nowy token konektora, hasło i klucz sesji. Objaw: po
wdrożeniu konektor na claude.ai przestaje działać, a hasło do aplikacji jest
nieaktualne. Baza pozostaje nietknięta, ale dostęp trzeba konfigurować od nowa.

**Kolejność plików SSH.** Plik nazywa się `00-utwardzenie.conf`, nie `99-`:
w SSH wygrywa **pierwsze** wystąpienie ustawienia, a obraz Ubuntu ma
`50-cloud-init.conf` z włączonymi hasłami.

**`MemoryDenyWriteExecute=no`** w usłudze systemd jest konieczne — silnik
JavaScriptu kompiluje kod w locie i inaczej Node nie wystartuje.

**Nagłówki cache.** `index.html`, `app.js`, `style.css` mają `no-cache`,
inaczej telefon potrafi tygodniami serwować starą wersję i poprawki nie
docierają do użytkownika.

**Limit narzędzi MCP: 12.** Obecnie 11. Każde narzędzie zajmuje kontekst
w **każdej** rozmowie. Nowe możliwości dokładaj przez parametry istniejących
narzędzi (wzorzec: `zmien_wpis`), nie przez kolejne pozycje. Pilnuje tego test.

**Testy nie mogą zależeć od dzisiejszej daty.** `trendWagi` i `czestePosilki`
przyjmują datę odniesienia właśnie dlatego — wcześniejsza wersja testów
zaczęłaby padać po 90 dniach bez żadnej zmiany w kodzie.

**Testy nie mogą zależeć od katalogu roboczego.** `test/stdio.test.ts` sięga
po `tsx` przez `import.meta.resolve`, a nie po ścieżkę `node_modules/…`.
W git worktree zależności leżą piętro wyżej i dosłowna ścieżka nie istnieje —
proces potomny wstawał martwy, a vitest raportował mylące „Connection closed".

**Timer przerwy żyje poza `#widok`.** `odswiez()` podmienia całą zawartość
widoku, więc odliczanie umieszczone w środku ginęłoby przy każdej zapisanej
serii — czyli dokładnie wtedy, kiedy jest potrzebne.

**Blokada podwójnego zapisu siedzi na formularzu, nie na przycisku.**
Formularz wysyła się też klawiszem „Gotowe" z klawiatury telefonu, a ta droga
omija wyłączony przycisk. Przy słabym zasięgu żądanie odrzuca się po kilku
sekundach i bez blokady wpis zapisywał się dwa razy.

**Certyfikat pobierany przez `--webroot`, nie wtyczką `--nginx`**, żeby
certbot nie przepisywał naszej konfiguracji. Ustawienia TLS są wpisane wprost.
Port 80 musi zostać otwarty na stałe — odnowienia idą co 60 dni.

## Podłączenie MCP

| Gdzie | Jak |
|---|---|
| Claude Code | `claude mcp add --scope user asystent-diety -- node <ścieżka>/dist/mcp/stdio.js` |
| Claude Desktop | `npm run rozszerzenie`, potem Ustawienia → Extensions → Install Extension |
| claude.ai i telefon | konektor na adres `https://asystent.twojadomena.pl/mcp/<token>` |

Wejście **stdio** (`dist/mcp/stdio.js`) sięga prosto do bazy i nie wymaga
działającego serwera HTTP. Po zmianie kodu serwera trzeba `npm run build` —
Claude uruchamia wersję z `dist/`.

## Zakres ustalony z użytkownikiem

Dieta: kalorie + makro; posiłek ma sumę i **opcjonalne** pozycje składowe.
Cele: jeden zestaw dzienny z datą wejścia w życie (zmiana nie fałszuje historii).
Trening: stały plan tworzony przez Claude w rozmowie, harmonogram tygodniowy,
trzy typy ćwiczeń (siłowe / cardio / na czas). System **pokazuje** poprzednie
wyniki i oznacza słabsze serie, ale **nie narzuca** progresji.
Poprawki wpisów: dostępne i w czacie, i w aplikacji.

Poza zakresem: nawodnienie, suplementy, sen, samopoczucie.

**Zasada szacowania makro** żyje w opisie narzędzia `zapisz_posilek`: przy
konkretnym opisie zapis od razu, przy ogólniku dopytanie o porcję. To jedyny
element, którego nie da się dostroić testami — wymaga obserwacji w praktyce.

## Warstwa offline

Aplikacja działa bez zasięgu i to nie jest dodatek — do siłowni wchodzi się
z zamkniętą aplikacją. Trzy pliki, każdy z osobnym zadaniem:

- **`public/sw.js`** — cache powłoki i ostatnich odpowiedzi GET. POST-y
  świadomie tędy **nie** przechodzą; umiałby najwyżej udać, że się udało.
- **`public/kolejka.js`** — zapisy odłożone w IndexedDB. Wysyłka **ściśle
  sekwencyjna**, bo numer serii nadaje serwer licząc dotychczasowe. 401
  zatrzymuje kolejkę, 400 wyrzuca wpis (inaczej jeden zły zapis blokuje ją
  na zawsze).
- **`public/nakladka.js`** — czyste funkcje pokazujące wpisy z kolejki na tle
  stanu z serwera. **Nie liczą niczego domenowego**: nie oceniają słabszej
  serii, nie wnioskują pory posiłku. To jedyny kawałek offline'u objęty
  testami (`test/offline.test.ts`) — reszta wymaga przeglądarki.

Tą samą zasadą rządzi się `public/raporty.js` (panel tygodnia i archiwum):
renderuje, ale nie ocenia — werdykty „na kursie" i „idzie lepiej" przychodzą
gotowe z serwera. Testy leżą obok, w `test/offline.test.ts`.

Każdy zapis z aplikacji niesie `czas` powstania wpisu. Bez tego seria wpisana
o 18:05 i wysłana o 19:30 wylądowałaby w historii pod złą godziną.

## Tydzień: raport i tempo

Tydzień biegnie **od niedzieli do soboty**, raport za niego powstaje w kolejną
niedzielę o 9:00. Cała logika w `src/domain/raporty.ts`, jedna funkcja licząca
(`policzWycinek`) obsługuje oba zastosowania — archiwum i podgląd na żywo.

**Raport jest migawką, nie widokiem.** Liczby zapisujemy raz, w kolumnie `dane`
jako JSON, i nigdy nie przeliczamy. Bez tego poprawka posiłku sprzed miesiąca
(`zmien_wpis` na to pozwala) po cichu zmieniłaby raport, który użytkownik już
przeczytał i skomentował.

**Generowanie siedzi w procesie aplikacji, nie w systemd.** `zapewnijRaporty`
jest idempotentne (UNIQUE na `tydzien_od`) i dogenerowuje wszystkie zaległe
tygodnie, więc wystarczy wołać je przy starcie, z tiku co godzinę
(`src/harmonogram.ts`) i **przy każdym odczycie** z API i MCP. Osobna jednostka
systemd oznaczałaby edycję `02-aplikacja.sh` — patrz pułapka wyżej.

**Porównanie obejmuje ten sam wycinek tygodnia.** Trzy dni bieżącego tygodnia
zestawione z siedmioma poprzedniego zawsze pokażą „gorzej", niezależnie od tego,
jak dobry jest tydzień.

**Prognoza i „dni w celu" liczą się z dni zamkniętych, bez dzisiaj.** Trening
i waga odwrotnie — dzisiejsze serie to fakt dokonany i mają być widoczne zaraz
po powrocie z siłowni. Ta asymetria jest celowa.

**Ocena „lepiej / gorzej" bierze się z trafień w cel i liczby serii**, nigdy
z kalorii ani wagi: przy redukcji zjedzenie mniej jest dobre, przy budowaniu
masy złe, a system nie zna zamiaru użytkownika. Werdykt powstaje w domenie
(`ocenZmiane`), żeby czat i aplikacja nie oceniły tego samego tygodnia inaczej.

Komentarz do raportu dopisuje Claude przez `podsumowanie_dnia` z parametrem
`komentarz` — serwer liczby ma, interpretacji nie. Zadanie cykliczne po stronie
claude.ai opisane jest w [INSTRUKCJA.md](INSTRUKCJA.md).

## Po MVP (kolejność wg wartości)

Szablony posiłków z własną tabelą → kody kreskowe (Open Food Facts, bez klucza
API) → eksport CSV.

Zrobione: wykresy (SVG wprost w `app.js`, bez biblioteki), tani wariant
szablonów — podpowiedzi z najczęstszych posiłków (`czestePosilki`), które
wypełniają formularz, ale go nie wysyłają — oraz tygodniowy raport z podglądem
tempa na ekranie Postępy.
