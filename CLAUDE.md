# Lifelog — asystent diety i treningu

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
npm test             # 384 testy
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

### Gałęzie

**Na produkcję i na GitHuba jedzie wyłącznie `master`.** Pilnuje tego zapora
w `wyslij.sh` — skrypt pakuje HEAD katalogu, z którego go uruchomiono, więc
odpalony z gałęzi roboczej wysłałby kod spoza historii master i wersje by się
rozjechały (raz się to zdarzyło; wyszło dobrze tylko dlatego, że różnica była
czystym przewinięciem).

Praca bieżąca idzie na gałęziach roboczych — Claude Code zakłada je we własnych
worktree w `.claude/worktrees/`. Gotową pracę scala się do master przewinięciem
(`git merge --ff-only`), a gałąź po scaleniu usuwa. Jedna gałąź robocza naraz;
zaległe gałęzie wskazujące na scalone commity to szum, nie kopia zapasowa.

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

**Migracje biegną z wyłączonym kluczem obcym, a po nich stoi
`foreign_key_check`.** Zdjęcie w SQLite więzu `UNIQUE` zadeklarowanego przy
kolumnie wymaga przepisania tabeli (nowa obok, kopia, `DROP`, `RENAME`), a `DROP`
na tabeli-rodzicu przerywa na naruszeniu więzów. `PRAGMA foreign_keys` jest
bezczynne wewnątrz transakcji, więc przełącznik stoi wokół całej pętli
w `uruchomMigracje`, nie w pliku `.sql`. Kontrola po migracjach jest tu
najważniejsza — bez niej przebudowa mogłaby po cichu osierocić sesje, a błąd
wyszedłby tygodnie później.

**Kod dnia jest unikalny w obrębie planu, nie globalnie.** Zbierając szablony
nie da się uniknąć dwóch dni „A". Dlatego aplikacja startuje trening po `dzien_id`,
a czat po kodzie szukanym w planie domyślnym. Harmonogram tygodniowy też czyta
wyłącznie plan domyślny — inaczej szablon z ustawionym dniem tygodnia przejąłby
poniedziałek.

**Nadpisanie planu gasi dni, nie kasuje ich.** `zapiszPlan` ustawia `aktywny = 0`
dniom nieobecnym w nowej wersji. Usuwanie wywróciłoby się na kluczu obcym
dokładnie wtedy, kiedy najbardziej boli — gdy dzień ma za sobą miesiące sesji.
Wygaszony dzień wraca do życia, jeśli wróci do planu.

**Kafelki timera podają całkowity czas przerwy, nie dokładkę.** Stan liczy się
od `startPrzerwy`, a kafelek zmienia `celPrzerwy` — po 90 sekundach stuknięcie
w 120 daje pozostałe 30, a nie kolejne dwie minuty. Krok, którego czas już
minął, znika, bo nie ma czego zaoferować. Arytmetyka siedzi w `public/przerwa.js`
i jako jedyna część timera jest objęta testami (`test/przerwa.test.ts`);
odliczanie po dojściu do zera nie gaśnie od razu — kafelki nadal się
przeterminowują, więc interwał stoi dopiero wtedy, gdy nie został żaden.

**Blokada podwójnego zapisu obejmuje formularze i przyciski osobno.**
Formularz wysyła się też klawiszem „Gotowe" z klawiatury telefonu, a ta droga
omija wyłączony przycisk — stąd znacznik `dataset.zapisuje` na formularzu,
nie sama blokada przycisku. Przycisk odhaczania serii to trzecia droga do
zapisu i ma własne opakowanie (`akcjaPrzycisku`). Przy słabym zasięgu żądanie
odrzuca się po kilku sekundach i bez blokady wpis zapisywał się dwa razy.

**Formularz edycji posiłku wysyła tylko pola zmienione** (porównanie
z `defaultValue`). Prefill kcal wysłany przy każdej poprawce byłby wartością
jawną, a jawna wygrywa z auto-sumą — przeliczanie nagłówka z pozycji nigdy
nie uruchomiłoby się z aplikacji. Z tego samego powodu nietknięty edytor
składników nie wysyła klucza `pozycje`: zastąpienie identyczną listą też
uruchamia auto-sumę.

**Atrybuty `data-*` na formularzach nie mogą kolidować z delegowanymi
handlerami na `#widok`.** `data-dzien` na formularzu edycji łapał handler
paska dat i każde stuknięcie w pole rzucało `RangeError` z `przesunDate` —
stąd `data-dzien-wpisu`.

**Rekord liczy się z sesji wcześniejszych niż bieżąca.** Inaczej pierwsza
dzisiejsza seria sama ustanawiałaby rekord, a każda następna już tylko
wyrównywała — oznaczenie traciłoby sens dokładnie w dniu, w którym ma działać.
Stąd `repo.serieCwiczeniaPrzedSesja`, a nie zwykła historia ćwiczenia.

**Migawka raportu nie ma pól dodanych po jej zapisaniu.** Raportu raz zapisanego
nigdy nie przeliczamy, więc tygodnie sprzed wdrożenia aktywności mają w kolumnie
`dane` JSON bez klucza `aktywnosci` — i będą go mieć zawsze. `zbudujRaport`
czyta go przez `?? BRAK_AKTYWNOSCI`; bez tego archiwum wywróciłoby się przy
pierwszym otwarciu po wdrożeniu. Ten sam chwyt stoi już przy `ile_niepewnych`.
Każde następne pole w migawce musi być opcjonalne z domyślną wartością.

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
Aktywności poza planem: bieg, rower, spacer — dystans i czas, bez kalorii,
poza realizacją planu.
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
  stanu z serwera: dodania, usunięcia i poprawki posiłków (znacznik „⏳ zmiana";
  `czas` i `pozycje` z poprawki świadomie ignorowane — przenoszenie wpisu
  między dniami to robota domeny). **Nie liczą niczego domenowego**: nie
  oceniają słabszej serii, nie wnioskują pory posiłku. To jedyny kawałek
  offline'u objęty testami (`test/offline.test.ts`) — reszta wymaga przeglądarki.

Tą samą zasadą rządzą się `public/raporty.js` (panel tygodnia i archiwum),
`public/dieta.js` i `public/posilek.js` (zakładka Dieta i wspólny renderer wpisu
posiłku) oraz `public/aktywnosci.js` (zakładka Aktywności razem z rendererem
wpisu — jeden plik, bo `aktywnosc.js` obok `aktywnosci.js` prosiłoby się
o pomyłkę przy imporcie) wsparta `public/seria.js` (jak seria czyta się
w tekście — wspólne z ekranem Trening, bo dwie kopie tej samej funkcji
rozjechałyby się przy pierwszej poprawce): renderują, ale nie oceniają — werdykty „na kursie"
i „idzie lepiej" przychodzą gotowe z serwera. Testy leżą obok,
w `test/offline.test.ts`.

Każdy zapis z aplikacji niesie `czas` powstania wpisu. Bez tego seria wpisana
o 18:05 i wysłana o 19:30 wylądowałaby w historii pod złą godziną.

## Odhaczanie serii

Zakładka Treningi ma trzy poziomy: wybór dnia → lista ćwiczeń → pojedyncze
ćwiczenie z historią. Na liście każda karta ma przycisk, który **mówi wprost,
co zapisze** („Odhacz serię 3 — 8 × 60 kg"), bo jedno stuknięcie zapisuje bez
potwierdzenia. Formularz pełnego wyniku zostaje pod „inny wynik".

Skąd biorą się te liczby, rozstrzyga jedna czysta funkcja — `propozycjaSerii`
w `src/domain/workouts.ts`. Kolejność źródeł, ta sama dla wszystkich pól:

1. **ostatnia seria tej sesji** — podbicie ciężaru w trzeciej serii jest faktem,
   plan tylko zamiarem sprzed tygodnia
2. **cel z planu** — `ciezar_cel_kg` oraz `powt_cel`, o ile czyta się jako
   pojedyncza liczba; zakres „8-12" nie daje liczby i spada niżej, bo
   zgadywanie granicy byłoby narzucaniem progresji
3. **poprzedni trening**
4. **brak** — przycisku nie ma, otwiera się formularz

Pola brane są pojedynczo, więc plan podający same powtórzenia dostaje ciężar
z poprzedniego treningu. Zwracane `zrodlo` dojeżdża aż do napisu na przycisku
(„wg planu", „jak ostatnio").

**Ile serii dopisze „odhacz całe ćwiczenie", liczy serwer.** Trasa
`POST /trening/cwiczenie/odhacz` nie przyjmuje liczb wyniku, a `odhaczCwiczenie`
idzie przez `zapiszSerie`, żeby numeracja i wykrywanie słabszej serii zostały
w jednym miejscu. Gdyby liczyła aplikacja, czat i telefon umiałyby zapisać za
ten sam trening co innego. Nakładka offline pokazuje wtedy **jeden znacznik**
„⏳ całe ćwiczenie", a nie zgadnięte serie.

W czacie to samo robi parametr `ile_serii` narzędzia `zapisz_serie` — nowe
możliwości idą przez parametry, nie przez kolejne pozycje w limicie 12.

## Aktywności poza planem

Bieg, rower, spacer, basen — wysiłek, o którym użytkownik mówi po fakcie
(„przejechałem 5 km"). Zapis jest **jednostrzałowy**: nic się nie otwiera i nic
nie zamyka. W czacie robi to `zapisz_serie` z `aktywnosc: true` (nazwa dyscypliny
idzie w polu `cwiczenie`), w aplikacji zakładka **Aktywności** w szufladzie oraz
sekcja „Ruch" na ekranie Dziś. Poprawki i usuwanie jak wszędzie — `zmien_wpis`
z `typ='aktywnosc'` i trasa `POST /wpis`.

**Zakładka scala dwa byty, baza ich nie scala.** Historia ruchu (`historiaRuchu`)
pokazuje obok siebie odbyte treningi z wynikami i aktywności poza planem —
patrzący wstecz chce jednej listy „co robiłem", a nie dwóch ekranów do
zestawiania w głowie. Scalanie jest **wyłącznie w odczycie**: tabele, raport
i ocena tygodnia dalej trzymają rozdział. Do historii wchodzą tylko sesje
**zakończone i mające choć jedną serię** — pusta sesja to ślad po otwarciu
i zamknięciu treningu, w historii nic nie znaczy. Ekran Dziś i `podsumowanie_dnia`
pokazują to samo, żeby pytanie „co dziś robiłem" nie dawało dwóch odpowiedzi.

**Usunięcie treningu idzie przez `zmien_wpis` z `typ='sesja'`** (tylko `usun`;
poprawianie odmawia i kieruje do `typ='seria'`). Serie znikają **kaskadą ze
schematu**, nie ręcznym kasowaniem. Cofnięcia nie ma — odtworzenie sesji razem
z seriami byłoby osobną ścieżką zapisu — dlatego aplikacja pyta `confirm()`
przed wysłaniem. To drugie i ostatnie miejsce, które o cokolwiek pyta.

**Osobna tabela `aktywnosci`, a nie sesja z jedną serią.** Trzy powody, każdy
sam w sobie wystarczający: `idx_sesja_aktywna` dopuszcza jedną otwartą sesję,
więc niedomknięta przejażdżka zablokowałaby wieczorny trening; raport zestawia
`sesje` z `sesje_w_planie` i liczy serie, więc spacer podbiłby realizację planu
siłowego; „słabsza niż poprzednio" i „rekord" nie mają sensu dla losowego wyjazdu.

**Parametr, nie dwunaste narzędzie.** Limit MCP to 12, stoimy na 11 i to miejsce
zostaje wolne. Opis `zapisz_serie` rozstrzyga jedyną realną pomyłkę: bieżnia
**w trakcie** trwającej sesji to seria, samodzielny wyjazd to aktywność.
Pola siłowe podane razem z `aktywnosc` są błędem, a nie czymś do zignorowania —
cicha akceptacja zgubiłaby połowę tego, co model podał.

**Spalonych kalorii świadomie nie ma.** Szacowanie wydatku jest niedokładne,
a liczba raz pokazana zaczyna żyć własnym życiem — tym bardziej gdyby miała
podnosić dzienny limit jedzenia.

**Do oceny tygodnia nie wchodzą.** Werdykt „lepiej / gorzej" mierzy realizację
planu treningowego; niedzielny spacer podbijałby go tak samo, jak opuszczony
trening go obniża. Raport pokazuje aktywności osobną linijką — użytkownik sam
widzi, czy tydzień był ruchliwy.

Dyscyplina to wolny tekst; grupowanie w statystyce idzie `COLLATE NOCASE`,
więc „Rower" z czatu i „rower" z aplikacji to jedna pozycja.

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
wypełniają formularz, ale go nie wysyłają — tygodniowy raport z podglądem
tempa na ekranie Postępy, odhaczanie serii wraz z widokiem pojedynczego
ćwiczenia, a także zakładka Dieta (historia dni pod `GET /dieta`,
`historiaDiety`), edycja pozycji składowych posiłku i godziny wpisu
(`zmien_wpis` / `POST /wpis`, auto-suma nagłówka per pole), trzeci
poziom pewności estymacji (`niepewne`), aktywności poza planem
(zakładka Aktywności, `GET/POST /aktywnosci`, `zapisz_serie` z `aktywnosc`)
oraz historia odbytych treningów w tej samej zakładce wraz z usuwaniem całej
sesji (`historiaSesji`, `zmien_wpis` z `typ='sesja'`).

Z listy odłożonych spadło przez to „lista ostatnich sesji"; **poprawianie serii
wstecz nadal czeka** — zakładka pokazuje wyniki, ale ich nie edytuje.

Odłożone świadomie przy odhaczaniu: podsumowanie po zakończeniu treningu,
poprawianie serii wstecz, edycja planu w aplikacji,
podpowiedzi nazw przy ćwiczeniu spoza planu (dziś literówka rozdziela historię
ćwiczenia — `repo.wszystkieCwiczenia` czeka nietknięte), supersety.
