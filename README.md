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
- [ ] **Etap 4** — wdrożenie (po wyborze hostingu)

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

### Claude Desktop — działa lokalnie, bez hostingu

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

### Telefon — dopiero po wdrożeniu

Aplikacja mobilna Claude korzysta z konektorów dodanych na claude.ai, a te
wymagają publicznego HTTPS. To Etap 4. Na próbę można wystawić lokalny serwer
tymczasowym tunelem (`cloudflared tunnel --url http://localhost:3000`) i dodać
otrzymany adres jako konektor — ale adres znika po zamknięciu tunelu.

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
