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
- [ ] **Etap 3** — aplikacja webowa
- [ ] **Etap 4** — wdrożenie (po wyborze hostingu)

## Podłączenie do Claude

Serwer MCP działa pod `/mcp/<MCP_TOKEN>`. Token siedzi w ścieżce, bo konektor
Claude przyjmuje wyłącznie adres URL — uwierzytelnianie nagłówkiem jest po
stronie Anthropic wciąż w wersji beta.

Konektor wymaga publicznego adresu HTTPS (Claude łączy się z chmury Anthropic,
nie z telefonu), więc realne podłączenie następuje po wdrożeniu — Etap 4.
Do tego czasu narzędzia testujemy lokalnie:

```bash
npx @modelcontextprotocol/inspector
```

i wskazujemy `http://localhost:3000/mcp/<MCP_TOKEN>` jako serwer typu
Streamable HTTP. Ten sam przepływ pokrywa automatycznie `test/mcp.test.ts`.

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
