# Odhaczanie serii — przebudowa zakładki Treningi

Data: 2026-08-25

## Problem

Zapisanie serii kosztuje dziś: „+ Seria" → formularz → „Zapisz serię". Formularz
jest wstępnie wypełniony poprzednim wynikiem, więc to stuknięcie plus ewentualna
korekta ciężaru. Przy większości serii **nic się jednak nie zmienia** — robisz
zaplanowane 3×10 i za każdym razem otwierasz formularz tylko po to, żeby
potwierdzić liczby, które już w nim stoją.

Drugi brak: kto wykonał wszystkie serie ćwiczenia i dopiero potem sięga po
telefon, musi wyklikać je pojedynczo.

Trzeci: `GET /historia/:cwiczenie` istnieje w API, `historia_cwiczenia` istnieje
w MCP, a aplikacja nie woła ani jednego z nich. Na siłowni widzisz wyłącznie
jedną poprzednią sesję w linii „Poprzednio".

## Rozwiązanie w jednym zdaniu

Ekran treningu dostaje przycisk „odhacz serię", który **mówi wprost, co zapisze**,
przycisk „odhacz całe ćwiczenie" dopisujący brakujące serie do celu z planu,
oraz trzeci poziom widoku — ekran pojedynczego ćwiczenia z historią i rekordami.

## Skąd biorą się liczby

To jest sedno i zarazem jedyna nietrywialna decyzja.

Plan dnia mówi ile serii i ile powtórzeń, ale **nie mówi ilu kilogramów** —
tabela `cwiczenia_w_dniu` nie ma takiej kolumny. Odhaczenie musi skądś wziąć
liczbę, bo bez niej nie policzymy tonażu ani nie oznaczymy słabszej serii.

Dokładamy więc do planu `ciezar_cel_kg` (kolumna nullowalna, migracja `0003`),
a całą regułę zamykamy w jednej czystej funkcji:

```ts
propozycjaSerii(typ, cel, serieTejSesji, poprzednio) → Propozycja
```

Kolejność źródeł, ta sama dla wszystkich liczb:

1. **ostatnia seria tej sesji** — podbiłeś w trzeciej serii na 62,5 kg, czwarta
   proponuje 62,5, a nie 60 z planu. Fakt z dzisiaj bije zamiar sprzed tygodnia.
2. **cel z planu** — `ciezar_cel_kg`, `powt_cel` gdy czyta się jako pojedyncza
   liczba, `czas_cel_s`, `dystans_cel_m`. Zakres „8-12" nie daje jednej liczby
   i spada niżej; zgadywanie, czy chodziło o 8 czy o 12, byłoby narzucaniem
   progresji.
3. **poprzedni trening** — ostatnia seria z `poprzednio`.
4. **brak** — przycisk odhaczania się nie pokazuje, otwiera się formularz.

Funkcja zwraca też `zrodlo`, które dojeżdża aż do napisu na przycisku („wg planu",
„jak ostatnio"). Użytkownik ma widzieć, skąd wzięła się liczba, **zanim** ją
zatwierdzi — inaczej jedno stuknięcie zapisuje coś, czego nie sprawdził.

Funkcja obsługuje wszystkie trzy typy ćwiczeń, więc przy okazji naprawia
dzisiejsze przemilczenie `czas_cel_s` i `dystans_cel_m`: zaplanowany bieg
„20 min" wyświetla się teraz jak ćwiczenie bez celu.

## Trzy poziomy widoku

**1. Wybór treningu** — bez zmian. Proponowany dzień z harmonogramu, pozostałe
dni, „Trening bez planu".

**2. Lista ćwiczeń sesji** — przebudowa `kartaCwiczenia`:

```
Wyciskanie sztangi                    ● ● ○ ○
4 × 8  ·  60 kg  ·  rekord 65 kg

    ┌──────────────────────────────────┐
    │   Odhacz serię 3 — 8 × 60 kg     │
    └──────────────────────────────────┘
        inny wynik  ·  odhacz całe ćwiczenie

  8×60 kg    8×60 kg
```

„Inny wynik" rozwija dotychczasowy formularz — droga na wypadek odstępstwa
zostaje nietknięta. Zapisane serie nadal otwierają się do poprawki stuknięciem.
Ukończone ćwiczenie zwija się do jednej linii, widok przewija do następnego.

**3. Widok ćwiczenia** — nowy, otwierany stuknięciem w nazwę. Serie tej sesji,
historia z pięciu ostatnich sesji, rekord ciężaru i powtórzeń, mini-wykres
rysowany wprost w SVG (wzorzec `wykresWagi`, bez biblioteki).

## Rekordy

`PostepCwiczenia` dostaje `rekordy: number[]` — symetrię do istniejącego
`slabsze_niz_poprzednio`. System nadal **pokazuje fakty i nie narzuca progresji**;
informacja „to był twój najlepszy wynik" jest faktem, nie zaleceniem.

Rekord liczy się **z wykluczeniem bieżącej sesji**. Bez tego pierwsza dzisiejsza
seria sama ustanawia rekord, a cała reszta go tylko wyrównuje — oznaczenie
straciłoby sens dokładnie w dniu, w którym ma działać.

## Odhaczanie całego ćwiczenia

```ts
odhaczCwiczenie(db, { cwiczenie, ile? }, opcje) → StanTreningu
```

Liczba serii to `serie_cel − serie_zrobione`. Przy ćwiczeniu spoza planu, które
nie ma celu serii, funkcja wymaga `ile` i inaczej rzuca `brak_celu_serii` —
aplikacja wtedy pyta.

Każda seria idzie przez istniejące `zapiszSerie`, żeby numeracja, walidacja pól
i wykrywanie słabszej serii zostały w jednym miejscu. Całość w transakcji:
ćwiczenie dopisane w połowie byłoby gorsze niż błąd.

**Ciało żądania `POST /trening/cwiczenie/odhacz` nie niesie liczb wyniku.** Ile
serii i z jakim obciążeniem — liczy serwer. Gdyby liczył klient, byłaby to logika
domenowa w aplikacji, czyli dokładnie to, czego zabrania zasada pierwsza:
czat i aplikacja pokazałyby wtedy różne dane.

## Zakres zmian

| Warstwa | Co dochodzi |
|---|---|
| `migrations/` | `0003_ciezar_docelowy.sql` — `ALTER TABLE cwiczenia_w_dniu ADD COLUMN ciezar_cel_kg REAL` |
| `src/db/repo.ts` | kolumna w zapisie i odczycie dnia planu; `rekordCwiczenia` |
| `src/domain/workouts.ts` | `propozycjaSerii`, `odhaczCwiczenie`, `rekordy` i `propozycja` w `PostepCwiczenia` |
| `src/api/routes.ts` | `POST /trening/cwiczenie/odhacz`; `ciezar_cel_kg` w schemacie planu |
| `src/mcp/tools.ts` | `ciezar_cel_kg` w `zarzadzaj_planem`, `ile_serii` w `zapisz_serie` |
| `public/app.js` | przebudowa `kartaCwiczenia`, widok ćwiczenia, obsługa nowej trasy |
| `public/nakladka.js` | znacznik oczekującego odhaczenia całego ćwiczenia |

**Żadnego nowego narzędzia MCP.** Limit to 12, obecnie 11 i tak zostaje — nowe
możliwości idą przez parametry istniejących narzędzi, wzorcem `zmien_wpis`.

## Offline

Odhaczenie pojedynczej serii to zwykły `POST /trening/seria`, więc kolejka działa
bez jednej linijki zmiany.

Odhaczenie całego ćwiczenia to jedno żądanie bez liczb, więc `nakladka.js`
pokazuje **jeden znacznik „⏳ całe ćwiczenie"**, a nie odgadnięte serie. Nakładka
renderuje i niczego nie liczy — ta zasada zostaje nienaruszona.

Kolejka pozostaje ściśle sekwencyjna: numer serii nadaje serwer, licząc
dotychczasowe.

## Pułapka do zapamiętania

**Blokada podwójnego zapisu musi objąć nowe przyciski.** Dziś siedzi na
formularzu, bo formularz wysyła się również klawiszem „Gotowe" z klawiatury
telefonu, a ta droga omija wyłączony przycisk. Przycisk odhaczania to trzecia
droga i potrzebuje własnej blokady — przy słabym zasięgu dwa stuknięcia
zapisałyby dwie serie.

## Poza zakresem

Świadomie odłożone; wracają osobno, gdy odhaczanie sprawdzi się w praktyce:

- podsumowanie po zakończeniu treningu (serie, tonaż, czas trwania)
- lista ostatnich sesji i poprawianie serii wstecz z aplikacji
- edycja planu w aplikacji
- podpowiedzi nazw przy ćwiczeniu spoza planu
- supersety

`czySlabsza` zostaje nietknięta.

## Weryfikacja

Dzień testowy „T — Test — masa własna": pompki, brzuszki, przysiady, każde 3×10,
bez obciążenia. Trzy ćwiczenia bez kilogramów sprawdzają ścieżkę, w której
`ciezar_kg` jest `null` przez cały czas — propozycję z `powt_cel`, `czySlabsza`
rozstrzygane liczbą powtórzeń i tonaż równy zeru.
