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
npm test             # 134 testy
npm run typecheck    # kontrola typów, obejmuje też katalog test/
npm run build        # kompilacja do dist/
npm run demo         # dane poglądowe do pracy nad wyglądem
npm run reset -- --tak   # czyszczenie lokalnej bazy
npm run rozszerzenie # paczka .mcpb dla Claude Desktop
```

Przed każdym commitem: `npm run typecheck && npm test`.

## Serwer produkcyjny

**https://asystent.twojadomena.pl** — OVH VPS, Ubuntu 26.04, Warszawa.

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

**Testy nie mogą zależeć od dzisiejszej daty.** `trendWagi` przyjmuje datę
odniesienia właśnie dlatego — wcześniejsza wersja testów zaczęłaby padać po
90 dniach bez żadnej zmiany w kodzie.

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

## Po MVP (kolejność wg wartości)

Szablony posiłków → kody kreskowe (Open Food Facts, bez klucza API) → wykresy
→ tygodniowy raport z zadania cyklicznego → eksport CSV.
