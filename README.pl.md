# Asystent diety i treningu

*[English version →](README.md)*

Samodzielnie hostowany dziennik posiłków i treningów dla **jednej osoby**.
Dwa wejścia, jedna baza:

- **Claude** — dyktujesz zdanie na telefonie („kurczak z ryżem, jakieś 700 kcal,
  koło drugiej") i wpis ląduje w bazie. Działa przez własny konektor MCP.
- **Aplikacja webowa (PWA)** — na siłownię, gdzie rozmowa jest za wolna.
  Odhaczasz serię stuknięciem, z ciężarami z poprzedniego razu już wpisanymi.

Oba wejścia wywołują ten sam kod domenowy, więc nie mogą pokazać różnych liczb.

## Po co to powstało

Asystenci czatowi zapominają. Ich pamięć to stratne streszczenie, nie rejestr —
wystarczy do „jestem na redukcji", nie wystarczy do „co jadłem czternastego".
Ten projekt daje Claude'owi prawdziwą bazę do zapisu, a Tobie aplikację na te
momenty, gdy wpisanie zdania trwa dłużej niż stuknięcie w przycisk.

## Co robi

**Dieta** — zapisuje posiłki z kaloriami i makro, opcjonalnie z rozbiciem na
składniki. Sumy dzienne wobec celów. Cele mają datę wejścia w życie, więc ich
zmiana nie przepisuje historii. Wpisy, które Claude musiał oszacować, są
oznaczone — widzisz, ile Twoich danych jest miękkich.

**Trening** — dyktujesz plan Claude'owi raz, on go zapisuje. W trakcie sesji
system pilnuje, co zrobione i co zostało, pokazuje wyniki z poprzedniego razu
i oznacza serie słabsze niż ostatnio. **Nie narzuca** progresji — ta decyzja
zostaje Twoja.

**Waga ciała** — ze średnią kroczącą z 7 dni, bo dzienne odczyty wahają się
za mocno, żeby czytać je wprost.

## Wymagania

- Node.js 20 lub nowszy
- Nic poza tym. Baza to jeden plik SQLite — bez serwera bazy danych.

Używanie tego jako konektora Claude na telefonie wymaga dodatkowo publicznego
adresu HTTPS, czyli w praktyce małego VPS-a i własnej domeny.

## Szybki start

```bash
git clone <twój-fork>
cd <repozytorium>
npm install
npm run setup      # tworzy .env ze świeżymi sekretami, pokazuje hasło do aplikacji
npm run dev
```

Wejdź na http://localhost:3000 i zaloguj się hasłem, które wypisał
`npm run setup`. `npm run demo` wypełni bazę danymi poglądowymi, jeśli chcesz
zobaczyć ekrany z zawartością.

## Podłączenie Claude'a

Do tej samej bazy prowadzą dwa wejścia MCP:

| Wejście | Plik | Dla kogo |
|---|---|---|
| **stdio** | `dist/mcp/stdio.js` | Claude Code, Claude Desktop |
| **HTTP** | `/mcp/<token>` | aplikacja webowa i telefon po wdrożeniu |

**Zacznij od stdio.** Claude sam uruchamia proces, kiedy go potrzebuje, i
zamyka po zakończeniu — nic nie musi działać w tle:

```bash
npm run build
claude mcp add --scope user asystent-diety -- node <ścieżka>/dist/mcp/stdio.js
```

`claude mcp list` powinno pokazać `✓ Connected`. Narzędzia pojawiają się
w **nowej** sesji — serwery MCP wczytują się przy jej starcie.

Dla **Claude Desktop** zbuduj rozszerzenie i zainstaluj przez
Ustawienia → Extensions → Advanced settings → Install Extension:

```bash
npm run build && npm run rozszerzenie
```

Dla **claude.ai i aplikacji mobilnej** potrzebne jest wejście HTTP pod
publicznym adresem HTTPS — patrz [wdrożenie](#wdrożenie). Claude łączy się
z chmury Anthropic, nie z Twojego telefonu, więc `localhost` tam nie zadziała.

## Wdrożenie

Katalog `wdrozenie/` zawiera skrypty, które doprowadzają świeżego VPS-a
z Ubuntu/Debianem do działającej usługi HTTPS: zapora, utwardzenie SSH,
automatyczne aktualizacje bezpieczeństwa, aplikacja jako ograniczona usługa
systemd, nginx z certyfikatem Let's Encrypt i codzienne kopie bazy.

```bash
ssh ty@twoj-serwer 'bash /opt/asystent/wdrozenie/01-zabezpiecz.sh'
bash wdrozenie/wyslij.sh twoj-serwer
ssh ty@twoj-serwer 'bash /opt/asystent/wdrozenie/02-aplikacja.sh'
ssh ty@twoj-serwer 'bash /opt/asystent/wdrozenie/03-https.sh twoja.domena'
ssh ty@twoj-serwer 'bash /opt/asystent/wdrozenie/04-kopie.sh'
```

Pełny opis, razem z odtwarzaniem bazy z kopii: [wdrozenie/README.md](wdrozenie/README.md).

## Bezpieczeństwo

Trzymamy tu dane zdrowotne, więc ustawienia są celowo ostre:

- Wejście MCP wymaga 256-bitowego tokenu **i** odpowiada wyłącznie na żądania
  z [opublikowanych zakresów adresów Anthropic](https://platform.claude.com/docs/en/api/ip-addresses).
  Wykradziony token jest bezużyteczny z jakiegokolwiek innego miejsca.
- Token jest częścią adresu URL, więc nginx maskuje go w logach dostępu. Bez
  tego sekret siedziałby czystym tekstem w plikach logów i ich archiwach.
- Limity tempa na konektorze i na logowaniu czynią zgadywanie hasła bezcelowym.
- Logowanie hasłem przez SSH jest wyłączone; aplikacja działa jako konto
  systemowe bez powłoki i bez prawa zapisu poza własnym katalogiem danych.

**Zrozum kompromis, zanim na tym polegniesz.** Token w adresie URL nie jest
metodą uwierzytelniania zalecaną przez specyfikację MCP — zalecany jest OAuth.
Użyto go, bo konektory na claude.ai przyjmują wyłącznie adres URL, a
uruchamianie serwera autoryzacji OAuth dla jednego użytkownika byłoby
nieproporcjonalne. To lista adresów czyni ten wybór obronnym. Jeśli
przechowujesz dane więcej niż jednej osoby — zaimplementuj OAuth.

## Architektura

```
migrations/     schemat bazy, stosowany automatycznie przy starcie
src/
  server.ts     punkt wejścia — montuje /mcp, /api i pliki statyczne
  db/repo.ts    jedyny plik zawierający SQL
  domain/       cała logika biznesowa
  mcp/          narzędzia MCP — cienki adapter nad domain/
  api/          REST dla aplikacji webowej — ten sam rodzaj adaptera
  lib/time.ts   strefy czasowe i granice doby
public/         aplikacja webowa (PWA)
wdrozenie/      skrypty przygotowujące serwer
```

Trzymają to dwie zasady:

1. **Logika mieszka w `domain/`.** `mcp/` i `api/` tylko ją wołają. Funkcja
   dopisana po jednej stronie to błąd — czat i aplikacja by się rozjechały.
2. **Cały SQL siedzi w `db/repo.ts`.** To granica, dzięki której wymiana
   SQLite na Postgres byłaby przepisaniem jednego pliku.

Trzecia, prawie tak samo ważna: **konwersje czasu wyłącznie przez
`lib/time.ts`**. Doba użytkownika liczona jest w jego strefie, serwer stoi
w UTC. Wiersze przechowują wyliczone `data_lokalna` (`YYYY-MM-DD`), więc
pytanie o dzień to porównanie tekstu, a nie arytmetyka stref w SQL.

## Testy

```bash
npm test         # 134 testy
npm run typecheck
```

Testy skupiają się tam, gdzie błąd jest kosztowny i cichy: granice doby przy
zmianie czasu, zmiana celów w środku historii, stan sesji treningowej i
poprawki wpisów wykonane z obu wejść. Warstwy MCP i REST pokrywają testy
integracyjne, które podnoszą prawdziwy serwer i rozmawiają z nim po HTTP.

## Licencja

MIT — patrz [LICENSE](LICENSE).
