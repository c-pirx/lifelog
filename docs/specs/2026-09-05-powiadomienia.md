# Powiadomienia push — trzy przypomnienia z serwera

Data: 2026-09-05

## Problem

Aplikacja wie o dzisiejszym dniu wszystko, czego trzeba, żeby w porę zapytać:
`planNaDzis` mówi, czy dziś jest trening i czy został zrobiony, `podsumowanieDnia`
mówi, ile kalorii już zjedzono wobec celu. Nie mówi tego **nikomu**, dopóki
użytkownik sam nie otworzy aplikacji — a otwiera ją wtedy, gdy już pamięta.

Trzy chwile, w których przypomnienie zmienia dzień:

1. **Rano w dzień treningowy** — żeby spakować torbę przed wyjściem.
2. **20:00 w niezrobiony dzień treningowy** — ostatnia szansa, zanim dzień
   przepadnie.
3. **18:00 przy zaległych kaloriach** — zostaje jeszcze kolacja, żeby nadrobić.

Wszystkie trzy zależą od stanu, którego telefon sam nie zna. Kanał musi więc iść
z serwera; lokalne powiadomienie z service workera odpada z definicji.

## Rozwiązanie w jednym zdaniu

Nowa dziedzina `src/domain/powiadomienia.ts` — jedna czysta funkcja mówiąca,
co należy wysłać w danej chwili — plus transport web push, subskrypcje w rejestrze
i tik co pięć minut, który dopisuje brakujące wysyłki tak samo idempotentnie,
jak `zapewnijRaporty` dopisuje zaległe raporty.

## Trzy powiadomienia i ich warunki

| Rodzaj | Kiedy (strefa użytkownika) | Warunek | Treść |
|---|---|---|---|
| `trening_rano` | od 8:00 | `planNaDzis().dzien` istnieje i `zrealizowany === false` | „Dziś dzień A — Klata i barki" |
| `trening_wieczor` | od 20:00 | to samo | „Ostatnia szansa na dzisiejszy trening — dzień A" |
| `kalorie` | od 18:00 | zależnie od trybu, niżej | „1500 z 2800 kcal. Zostało 1300 — zdążysz zjeść?" |

Wszystkie **milkną, gdy warunek znika**: trening odhaczony o 17:00 kasuje
wieczorne przypomnienie, kolacja wpisana o 17:50 kasuje to o 18:00. Bezwarunkowe
powiadomienie o stałej porze zostaje wyciszone w systemie w ciągu dwóch tygodni
i zabiera ze sobą pozostałe dwa — to jedyna rzecz, której tu naprawdę nie wolno
zepsuć.

Warunek treningowy czyta **wyłącznie `planNaDzis`**. Ta funkcja już rozstrzyga
trzy stany i już porównuje po `dzien_id`, a nie po kodzie dnia; drugie miejsce
liczące „czy dziś był trening" natychmiast rozjechałoby się z ekranem Trening.

## Tryb: skąd system ma wiedzieć, w którą stronę mówić

Dotąd nie wiedział i było to **świadome**: „ocena bierze się z trafień w cel
i liczby serii, nigdy z kalorii ani wagi, bo przy redukcji zjedzenie mniej jest
dobre, przy budowaniu masy złe, a system nie zna zamiaru użytkownika"
(CLAUDE.md). Powiadomienie o 18:00 wymaga dokładnie tej wiedzy, więc ją dodajemy —
ale **wąsko**, wyłącznie dla powiadomień.

Nowa kolumna w tabeli `cele`:

```sql
ALTER TABLE cele ADD COLUMN tryb TEXT NOT NULL DEFAULT 'utrzymanie';
```

Trzy wartości: `redukcja`, `utrzymanie`, `masa`. Lista mieszka w
`src/domain/typy.ts` obok `KATEGORIE_NOTATEK` i **bez więzu `CHECK`** — z tego
samego powodu co tam: `CHECK` na kolumnie unieruchomiłby listę do czasu
przepisania tabeli (pułapka migracji 0005).

**Dlaczego w `cele`, a nie w planie treningowym ani na koncie.** Tryb zmienia się
dokładnie wtedy, kiedy zmieniają się kalorie — przejście na redukcję to jedno
i to samo zdarzenie. Tabela `cele` ma już `obowiazuje_od`, więc zmiana trybu nie
fałszuje historii, dokładnie jak zmiana kcal. Na planie treningowym tryb gasłby
przy każdej zmianie splitu, choć to dwie niezależne decyzje.

`ustawCele` dostaje opcjonalne pole `tryb`, narzędzie `ustaw_cele` — opcjonalny
parametr. **Żadnego nowego narzędzia MCP**; budżet 12 pozostaje wyczerpany, ale
nieprzekroczony.

### Progi

Dwa progi jako procent celu dziennego, stałe eksportowane z domeny:

```ts
export const PROG_ZA_MALO = 0.55;  // masa i utrzymanie
export const PROG_ZA_DUZO = 0.85;  // redukcja i utrzymanie
```

| Tryb | Aktywny próg | Przykład |
|---|---|---|
| `masa` | tylko dolny | 1500 z 2800 (53,6 %) → „Zostało 1300 — zdążysz zjeść?" |
| `redukcja` | tylko górny | 2400 z 2800 (85,7 %) → „Zostało 400 na kolację." |
| `utrzymanie` | oba | jak wyżej, zależnie od strony |

Procent, a nie sztywne 1500 kcal: przy celu 3500 kcal alarm przy 1600 nigdy by
nie przyszedł, a przy celu 1600 przychodziłby codziennie. Wartość, od której
wyszliśmy (1500 przy celu 2800), wypada tuż pod 55 % — próg jest kalibrowany na
realny przypadek, nie zgadnięty.

Brak ustawionych celów (`celeNaDzien` zwraca `null`) → powiadomienia `kalorie`
nie ma. Nie ma z czym porównać.

## Idempotencja zamiast punktualności

Tik chodzi **co pięć minut**, a nie o pełnych godzinach, i nie próbuje trafić
w minutę. Warunek brzmi „minęła 18:00 w strefie tego konta i dziś jeszcze nie
wysłano", a ślad wysyłki siedzi w rejestrze:

```sql
CREATE TABLE wyslane_powiadomienia (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uzytkownik_id  INTEGER NOT NULL REFERENCES uzytkownicy(id) ON DELETE CASCADE,
  data_lokalna   TEXT NOT NULL,   -- YYYY-MM-DD w strefie użytkownika
  rodzaj         TEXT NOT NULL,
  wyslano        TEXT NOT NULL,
  UNIQUE (uzytkownik_id, data_lokalna, rodzaj)
);
```

To ten sam chwyt, co `UNIQUE (tydzien_od)` w raportach, i z tego samego powodu:
tik przy stałym interwale od startu procesu **nie trafia w pełne godziny**.
Restart o 8:37 przesuwa go na 9:37, 10:37, 11:37 — i 18:00 nie wypada nigdy.
Przy warunku „już po 18:00 i dziś nie wysłano" restart, przestawienie zegara,
przerwa w prądzie i zmiana czasu letniego przestają cokolwiek znaczyć.

Godziny (`8`, `18`, `20`) czytane są przez `godzinaLokalna` ze strefy konta —
tik biegnie już dziś po wszystkich kontach w ich własnych strefach
(`harmonogram.ts`), więc struktura jest gotowa.

Skutek uboczny wart nazwania: telefon włączony dopiero o 21:00 dostanie
przypomnienie o 20:00 z opóźnieniem, a nie wcale. To zachowanie **pożądane** —
„zostały trzy godziny" traci sens, ale „dziś jeszcze nie trenowałeś" nie traci.
Wyjątek: powiadomienia starsze niż dzisiejsza data lokalna nie wychodzą nigdy,
bo `data_lokalna` w warunku jest zawsze dzisiejsza.

## Warstwy

```
src/domain/powiadomienia.ts   ← CAŁA logika: co, komu, kiedy. Czysta.
src/lib/push.ts               ← transport (web-push), wstrzykiwany, opcjonalny
src/db/rejestr.ts             ← SQL subskrypcji i śladów wysyłki
src/harmonogram.ts            ← tik co 5 minut, obok istniejącego godzinnego
src/api/routes.ts             ← 3 trasy, cienki adapter
public/app.js, public/sw.js   ← zgoda, przełączniki, odbiór
```

### Domena

```ts
export type DoWyslania = { rodzaj: Rodzaj; tytul: string; tresc: string; ekran: string };

export function powiadomieniaNaTeraz(
  db: Baza,
  opcje: { teraz: string; strefa: string; wlaczone: Rodzaj[]; juzWyslane: Rodzaj[] },
): DoWyslania[];
```

Zero I/O, zero `fetch`, zero `Date.now()` w środku — `teraz` przychodzi
parametrem. To ten sam wymóg co przy `trendWagi` i `czestePosilki`: test
z podanym „teraz" nie zacznie padać za trzy miesiące bez żadnej zmiany w kodzie.

`ekran` to ścieżka, którą otwiera stuknięcie w powiadomienie (`/app#trening`,
`/app#dzien`) — bez niego powiadomienie o treningu lądowałoby na ekranie Dziś.

### Transport

`src/lib/push.ts` na bibliotece **`web-push`** (pierwsza nowa zależność od czasu
poczty, świadoma: RFC 8291 to kryptografia, w której błąd bywa cichy). Interfejs
kopiuje `Poczta`:

```ts
export type Push = {
  wyslij(subskrypcja: Subskrypcja, ladunek: Ladunek): Promise<WynikWysylki>;
  readonly wlaczona: boolean;
};
```

**Wstrzykiwany do `utworzApp`**, nie importowany przez trasy — żeby testy
podstawiały atrapę i żaden nie dobijał się do internetu. I **opcjonalny**:
`VAPID_PUBLICZNY` + `VAPID_PRYWATNY` + `VAPID_KONTAKT` to komplet albo nic,
dokładnie jak zmienne poczty. Powód ten sam i już raz sprawdzony w boju: jedno
pole zapomniane w `/etc/asystent/env` nie może kłaść aplikacji przy wdrożeniu,
bo systemd restartowałby ją w pętli. Brak powiadomień jest kłopotem, brak
aplikacji awarią. Widać to w `/zdrowie` (`push: false`).

`web-push` jest paczką CommonJS — import domyślny w projekcie ESM
(`import webpush from "web-push"`), do sprawdzenia przy pierwszym `npm run build`.

**Wygasłe subskrypcje kasujemy.** Odpowiedź 404 lub 410 od push service znaczy,
że przeglądarka wyrzuciła subskrypcję (odinstalowana aplikacja, wyczyszczone
dane). Wiersz leci z bazy — inaczej tik do końca świata próbowałby wysyłać
w martwy adres. Każdy inny błąd ląduje w dzienniku i nie zatrzymuje pętli po
kontach; to ta sama zasada, co w istniejącym tiku raportów.

### Subskrypcje w rejestrze, nie w dzienniku

```sql
CREATE TABLE subskrypcje_push (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uzytkownik_id  INTEGER NOT NULL REFERENCES uzytkownicy(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL UNIQUE,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  utworzono      TEXT NOT NULL
);

ALTER TABLE uzytkownicy ADD COLUMN powiadomienia TEXT NOT NULL DEFAULT '';
```

Obie tabele w `migrations-rejestr/0003_powiadomienia.sql`; `tryb` w `cele`
osobno, w `migrations/0008_tryb_celow.sql`, bo to inna baza.

**Dlaczego rejestr.** Subskrypcja jest daną konta, nie daną dziennika, a dziennik
świadomie nie zna pojęcia użytkownika — kolumny `uzytkownik_id` nie ma tam ani
razu i nie może się pojawić. Tik i tak chodzi po rejestrze po listę kont.

`powiadomienia` to lista włączonych rodzajów po przecinku (`trening_rano,kalorie`),
pusta = wyłączone. Kolumna tekstowa zamiast trzech boolowskich: czwarty rodzaj
ma być jedną linią w TypeScripcie, nie migracją.

### Trasy

| Trasa | Rola |
|---|---|
| `GET /api/powiadomienia` | stan: włączone rodzaje, tryb celów, klucz publiczny VAPID, czy push w ogóle działa |
| `POST /api/powiadomienia/subskrypcja` | zapis subskrypcji z przeglądarki |
| `POST /api/powiadomienia` | przełączniki i tryb (tryb idzie przez `ustawCele`) |

Wszystkie za istniejącą bramą sesji, wszystkie cienkie — cała treść decyzji jest
w domenie.

Zmiana samego trybu zapisuje **nowy wiersz `cele`** z makro skopiowanym
z bieżących: liczy to domena, nie aplikacja, bo inaczej telefon musiałby odesłać
cztery liczby, których nie zmienia — a każda przekłamana po drodze fałszowałaby
cel. Gdy celów jeszcze nie ma, przełącznik trybu jest nieaktywny i mówi, że cele
ustawia się w rozmowie z Claude'em.

### W aplikacji

Nowa sekcja **„Powiadomienia"** na ekranie Konto, pod adresem konektora:

- przycisk „Włącz powiadomienia" → `Notification.requestPermission()` →
  `pushManager.subscribe()` → `POST /api/powiadomienia/subskrypcja`;
- trzy przełączniki (domyślnie wszystkie włączone po pierwszej zgodzie);
- przełącznik **redukcja / utrzymanie / masa**.

To pierwsze miejsce w aplikacji, które w ogóle dotyka celów — dziś ekran Dzień
mówi „Cele nie są ustawione — poproś o to Claude'a" ([app.js:784](../../public/app.js)).
Przełącznik zapisuje nowy wiersz `cele` z **tym samym makro** i zmienionym trybem;
budowanie pełnego ekranu celów w aplikacji zostaje poza zakresem.

W `sw.js` dochodzą dwa zdarzenia — `push` (pokazuje) i `notificationclick`
(otwiera `ekran`, a jeśli aplikacja jest już otwarta, przełącza ją zamiast
otwierać drugie okno). Podbijamy `WERSJA` do `v17`.

**Na iPhone push działa wyłącznie po dodaniu aplikacji do ekranu głównego**
(iOS 16.4+). Sekcja mówi to wprost, zamiast pokazywać przycisk, który nic nie
robi.

## Testy

`test/powiadomienia.test.ts` — całość na czystej domenie, z podstawianym `teraz`:

- dzień treningowy niezrobiony o 8:00 → `trening_rano`; ten sam dzień zrobiony → cisza;
- 20:00, dzień z planu niezrobiony → `trening_wieczor`; dzień wolny → cisza;
- 18:00, tryb `masa`, 1500 z 2800 → jest; 1600 z 2800 (57 %) → cisza;
- 18:00, tryb `redukcja`, 2400 z 2800 → jest; 1500 z 2800 → cisza;
- 18:00, tryb `utrzymanie` → oba kierunki;
- brak celów → cisza;
- rodzaj obecny w `juzWyslane` → nie wraca po raz drugi;
- rodzaj wyłączony przełącznikiem → nie wraca w ogóle.

Test wymagający pustego dziennika zakłada **własne konto** — pula wyda mu osobny
plik (pułapka bazy współdzielonej w obrębie pliku testowego).

Do `test/izolacja.test.ts` dochodzi dowód, że subskrypcja jednego konta nie
dostaje powiadomienia policzonego z dziennika drugiego. Do `test/api.test.ts` —
trasy z atrapą pushu.

## Poza zakresem

- **Koniec przerwy między seriami.** Najwyższej wartości ze wszystkiego, co
  rozważaliśmy, ale technicznie niepewne: `setTimeout` w service workerze bywa
  ubijany, a Notification Triggers API nigdy nie wyszło poza flagę w Chrome.
  Wymaga własnego rozpoznania (kandydat: Screen Wake Lock zamiast powiadomienia).
- **Zatrzymana kolejka offline.** Realny cichy ubytek danych — 401 zatrzymuje
  kolejkę, a użytkownik myśli, że zapisał trening. Powiadomienie lokalne, nie
  wymaga niczego z tego specu.
- **Otwarta sesja treningowa wisząca od godzin.** Blokuje `idx_sesja_aktywna`.
- **Raport tygodniowy push-em.** Już przychodzi zadaniem cyklicznym Claude'a
  ([INSTRUKCJA.md](../../INSTRUKCJA.md)); dublowanie kanału nic nie wnosi.
- **Poranna waga, streaki, powiadomienia motywacyjne.** Pierwsze irytujące,
  reszta kłóci się z zasadą „pokazuj, nie oceniaj".
- **Ekran celów w aplikacji.** Przełącznik trybu to wyjątek uzasadniony tym,
  że bez niego powiadomienie o 18:00 nie ma jak działać.
- **Własne godziny powiadomień w ustawieniach.** 8:00 / 18:00 / 20:00 jako stałe
  w domenie; pole do wypełnienia, którego większość nigdy nie ruszy.

## Wdrożenie

Nowe zmienne w `/etc/asystent/env`: `VAPID_PUBLICZNY`, `VAPID_PRYWATNY`,
`VAPID_KONTAKT` (adres mailto). Klucze generuje `npx web-push generate-vapid-keys`,
jednorazowo — **wymiana kluczy unieważnia wszystkie subskrypcje**, więc mają
trafić do `/etc/asystent/env` raz i tam zostać. `02-aplikacja.sh` nie wymaga
zmian: brak zmiennych to działająca aplikacja bez powiadomień.

Migracje biegną przy starcie i są addytywne — poprzednia wersja kodu działa na
nowym schemacie, więc powrót po złym wdrożeniu pozostaje możliwy.
