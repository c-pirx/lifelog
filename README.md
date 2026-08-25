# Asystent diety i treningu

Osobisty asystent do zapisywania posiłków i treningów. Dwa wejścia, jedna baza:

- **Claude na telefonie** — dyktujesz zdanie („obiad: kurczak z ryżem, ok. 700 kcal"),
  Claude wywołuje narzędzia serwera MCP i zapisuje.
- **Aplikacja webowa (PWA)** — na siłowni, gdzie rozmowa jest za wolna: odhaczasz serie
  jednym kliknięciem, z ciężarami z poprzedniego treningu pod ręką.

Oba wejścia wywołują ten sam kod z `src/domain/`, więc nie mogą pokazać różnych danych.

## Wymagania

- Node.js 20 lub nowszy
- Nic poza tym — baza to plik SQLite, bez osobnego serwera

## Uruchomienie lokalne

```bash
npm install
cp .env.example .env   # i uzupełnij sekrety
npm run dev
```

Sekrety wygenerujesz przez:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Sprawdzenie, czy działa:

```bash
curl http://localhost:3000/zdrowie
```

## Skrypty

| Komenda | Działanie |
|---|---|
| `npm run dev` | serwer deweloperski z przeładowaniem |
| `npm test` | testy jednostkowe i integracyjne |
| `npm run typecheck` | kontrola typów bez budowania |
| `npm run build` | kompilacja do `dist/` |
| `npm start` | uruchomienie skompilowanej wersji |

## Układ projektu

```
migrations/     schemat bazy; stosowany automatycznie przy starcie
src/
  server.ts     punkt wejścia — montuje /mcp, /api i pliki statyczne
  config.ts     konfiguracja ze zmiennych środowiskowych
  db/           połączenie i migracje; repo.ts to jedyne miejsce z SQL
  domain/       logika: dieta, treningi, pomiary, poprawki wpisów
  mcp/          narzędzia MCP — cienki adapter nad domain/
  api/          REST dla aplikacji webowej — ten sam adapter
  lib/time.ts   strefy czasowe i granice doby
public/         aplikacja webowa (PWA)
test/           testy
```

Dwie zasady, które warto znać przed zmianami:

1. **Logika mieszka w `domain/`.** `mcp/` i `api/` tylko ją wołają. Nowa funkcja
   dopisana tylko po jednej stronie to błąd — dane rozjadą się między czatem a apką.
2. **Cały SQL siedzi w `db/repo.ts`.** To granica, dzięki której zmiana SQLite na
   Postgres jest przepisaniem jednego pliku, a nie przebudową.

## Czas

Serwer może stać w dowolnej strefie; doba użytkownika liczona jest w `Europe/Warsaw`.
Kolumny `data_lokalna` przechowują YYYY-MM-DD wyliczone przy zapisie, więc pytanie
o dzień to porównanie tekstu, a nie arytmetyka stref w SQL. Konwersje wyłącznie
przez `src/lib/time.ts` — nigdy przez `getDate()` i podobne.

## Stan prac

- [x] **Etap 0** — szkielet: baza, migracje, konfiguracja, serwer, testy
- [x] **Etap 1** — rdzeń domenowy (dieta, treningi, pomiary, poprawki)
- [x] **Etap 2** — serwer MCP (11 narzędzi)
- [x] **Etap 3** — aplikacja webowa (PWA)
- [x] **Etap 4** — wdrożenie (OVH VPS, `asystent.twojadomena.pl`) — patrz [wdrozenie/README.md](wdrozenie/README.md)

## Aplikacja webowa

Trzy ekrany, nawigacja przy kciuku na dole, ciemny motyw:

- **Dziś** — paski makro wobec celów, lista posiłków z oznaczeniem szacunków, dodawanie i usuwanie
- **Trening** — start dnia proponowanego z harmonogramu; w trakcie sesji lista ćwiczeń
  z wynikami z poprzedniego razu, formularz serii wstępnie wypełniony ostatnim wynikiem
- **Postępy** — waga ze średnią kroczącą i kalorie z ostatnich dni

Instalacja na iPhonie: Safari → Udostępnij → „Do ekranu początkowego".

Dane poglądowe do pracy nad wyglądem:

```bash
node tools/dane-demo.mjs http://localhost:3000
```

Ikony PWA generuje `node tools/generuj-ikony.mjs` (własny enkoder PNG, bez
zależności graficznych — iOS wymaga PNG dla `apple-touch-icon`).

## Podłączenie do Claude

Serwer MCP działa pod `/mcp/<MCP_TOKEN>`. Token siedzi w ścieżce, bo konektor
Claude przyjmuje wyłącznie adres URL — uwierzytelnianie nagłówkiem jest po
stronie Anthropic wciąż w wersji beta.

Projekt ma **dwa wejścia MCP** do tej samej bazy:

| Wejście | Plik | Dla kogo |
|---|---|---|
| **stdio** (lokalny serwer) | `dist/mcp/stdio.js` | Claude Code, Claude Desktop |
| **HTTP** | `/mcp/<token>` w serwerze | aplikacja webowa, docelowo telefon |

**Domyślnie używaj stdio.** Claude uruchamia ten proces sam, kiedy go
potrzebuje, i zamyka po zakończeniu — nic nie musi działać w tle. Serwer HTTP
zostaje potrzebny tylko dla aplikacji webowej i dla dostępu z telefonu po
wdrożeniu. Oba mogą pracować równocześnie: baza działa w trybie WAL, który
dopuszcza czytanie w trakcie zapisu.

### Podłączenie

```bash
npm run build
claude mcp add --scope user asystent-diety -- node <ścieżka>/dist/mcp/stdio.js
```

Sprawdzenie: `claude mcp list` powinno pokazać `✓ Connected`. Narzędzia
pojawiają się w **nowej** sesji — serwery MCP wczytują się przy jej starcie.

Po każdej zmianie w kodzie serwera trzeba przebudować (`npm run build`),
bo Claude uruchamia skompilowaną wersję z `dist/`.

### Telefon i claude.ai — przez konektor

Tam Claude łączy się z chmury Anthropic, więc potrzebny jest publiczny adres
HTTPS. Serwer produkcyjny działa pod `asystent.twojadomena.pl`.

W claude.ai: **Customize → Connectors → + → Add custom connector**, adres
`https://asystent.twojadomena.pl/mcp/<MCP_TOKEN>` (token z pliku
`/etc/asystent/env` na serwerze). Dodaje się raz z przeglądarki; potem
narzędzia są dostępne także w aplikacji mobilnej.

### Claude Desktop (czat) — jako rozszerzenie

Panel **Ustawienia → Connectors** przyjmuje wyłącznie adresy publiczne, bo
konektory działają na poziomie konta i łączy się z nimi chmura Anthropic.
Lokalny serwer dodaje się inaczej — jako rozszerzenie:

```bash
npm run build && npm run rozszerzenie
```

Powstaje `asystent.mcpb`. Instalacja: **Ustawienia → Extensions → Advanced
settings → Extension Developer → Install Extension…** i wskazanie pliku.

Paczka nie zawiera serwera — tylko go uruchamia z katalogu projektu, którego
ścieżkę podaje się w polu konfiguracyjnym rozszerzenia. Powód: serwer używa
natywnego modułu SQLite i potrzebuje dostępu do pliku bazy, więc pakowanie go
w archiwum nic by nie dało.

Ta droga nie wymaga zamykania aplikacji i jest odporna na nadpisywanie pliku
konfiguracyjnego (patrz niżej).

### Claude Desktop — wariant przez plik konfiguracyjny

Konektory na claude.ai wymagają publicznego adresu HTTPS, bo Claude łączy się
z chmury Anthropic. **Claude Desktop to omija**: uruchamia most `mcp-remote`
jako lokalny proces, który sięga do `localhost`.

Podłączenie — kolejność ma znaczenie:

1. **Zamknij Claude Desktop całkowicie** (także ikona w zasobniku).
2. `npm run podlacz`
3. Uruchom Claude Desktop.
4. Serwer musi działać: `npm run dev`.

> **Dlaczego akurat w tej kolejności.** Claude Desktop nadpisuje
> `claude_desktop_config.json` z własnej pamięci w trakcie działania i przy
> zamykaniu. Wpis dodany przy włączonej aplikacji zostaje skasowany —
> sprawdzone dwukrotnie. Dlatego `npm run podlacz` odmawia pracy, gdy proces
> `Claude.exe` żyje, i robi kopię pliku przed zapisem.

Skrypt wskazuje `node.exe` i plik mostu wprost, zamiast `npx`: Claude Desktop
uruchamia komendę bez powłoki, więc `npx` na Windowsie bywa nieznajdowany —
to najczęstsza przyczyna „konektor się nie pojawia".

### Sprawdzenie narzędzi bez Claude'a

```bash
npx @modelcontextprotocol/inspector
```

Serwer typu Streamable HTTP, adres `http://localhost:3000/mcp/<MCP_TOKEN>`.
Ten sam przepływ pokrywa automatycznie `test/mcp.test.ts`.

### Narzędzia

| Narzędzie | Do czego |
|---|---|
| `zapisz_posilek` | zapis posiłku z makro; zawiera zasadę, kiedy dopytać o porcję |
| `podsumowanie_dnia` | bilans doby z identyfikatorami wpisów |
| `ustaw_cele` | cele obowiązujące od wskazanego dnia |
| `zarzadzaj_planem` | podgląd, zapis i usuwanie dni planu |
| `rozpocznij_trening` | otwarcie sesji; dzień z harmonogramu lub wskazany |
| `zapisz_serie` | dopisanie serii, z ostrzeżeniem o regresie |
| `stan_treningu` | co zrobione, co zostało, wyniki z poprzedniego razu |
| `zakoncz_trening` | zamknięcie sesji z podsumowaniem |
| `historia_cwiczenia` | progresja i rekord |
| `zapisz_wage` | pomiar ze średnią kroczącą |
| `zmien_wpis` | poprawka lub usunięcie posiłku, serii albo wagi |

Limit to 12 narzędzi — każde zajmuje kontekst w **każdej** rozmowie z Claude.
Nowe możliwości dokładamy przez parametry istniejących narzędzi (wzorzec:
`zmien_wpis`), a nie przez kolejne pozycje na liście. Pilnuje tego test.
