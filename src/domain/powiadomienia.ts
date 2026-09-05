/**
 * Powiadomienia push: co, komu i kiedy wysłać.
 *
 * Cała reguła siedzi w jednej czystej funkcji — bez sieci, bez zegara, bez
 * wiedzy o subskrypcjach. Chwila przychodzi parametrem, tak samo jak przy
 * `trendWagi` i `czestePosilki`, bo test zależny od dzisiejszej daty zaczyna
 * padać sam z siebie po kilku miesiącach.
 *
 * Stan czytamy WYŁĄCZNIE przez funkcje domenowe (`planNaDzis`, `podsumowanieDnia`,
 * `aktywnaSesja`, `ostatniaWaga`, `raport`), nigdy przez `repo` — to te same
 * funkcje, którymi odpowiada aplikacja i czat. Drugie miejsce liczące „czy dziś
 * był trening" rozjechałoby się z ekranem Trening przy pierwszej poprawce.
 * Wszystkie są czystymi odczytami; nic tutaj nie zapisuje.
 *
 * Zasada, której nie wolno tu złamać: powiadomienie MILKNIE, gdy warunek znika.
 * Odhaczony trening gasi wieczorne przypomnienie, dopisana kolacja gasi to
 * o 18:00. Bezwarunkowe powiadomienie o stałej porze zostaje w telefonie
 * wyciszone w ciągu dwóch tygodni — i zabiera ze sobą pozostałe.
 */

import type { Baza } from "../db/index.js";
import {
  dataLokalna,
  godzinaLokalna,
  przesunDate,
  zakresDat,
  STREFA_DOMYSLNA,
} from "../lib/time.js";
import { podsumowanieDnia } from "./diet.js";
import { ostatniaWaga } from "./metrics.js";
import { raport } from "./raporty.js";
import { aktywnaSesja, planNaDzis } from "./workouts.js";

/** Rodzaje z własnym przełącznikiem na ekranie Konto. */
export type RodzajPrzelaczalny = "trening_rano" | "trening_wieczor" | "kalorie";

/**
 * Rodzaje bez przełącznika — gasi je wyłącznie główny wyłącznik powiadomień.
 *
 * Wspólne mają to, że odzywają się RZADKO i nie są ponagleniem: dwa pierwsze
 * łapią błąd albo niosą treść, trzeci mówi, że przestała napływać jedyna liczba
 * mierząca skutek. Osobne checkboxy byłyby zaproszeniem do wyłączenia dokładnie
 * tego, co ma działać zawsze.
 */
export type RodzajZawsze = "sesja_wisi" | "raport" | "waga_cisza";

export type RodzajPowiadomienia = RodzajPrzelaczalny | RodzajZawsze;

/**
 * Jedyna lista rodzajów w tym pliku — celowo obejmuje TYLKO przełączalne.
 *
 * Tylko te nazwy trafiają do kolumny `uzytkownicy.powiadomienia` i tylko ich
 * dotyczy walidacja `POST /powiadomienia`: kolumna opisuje wyłącznie to, co
 * użytkownik odhacza. Listy rodzajów stałych nie ma, bo nie miałaby odbiorcy —
 * pilnuje ich typ, nie tablica.
 */
export const RODZAJE_PRZELACZALNE: readonly RodzajPrzelaczalny[] = [
  "trening_rano",
  "trening_wieczor",
  "kalorie",
];

/**
 * Godziny lokalne, od których powiadomienie może pójść.
 *
 * Rano ma GÓRNĄ granicę i to nie jest ozdobnik: bez niej telefon włączony
 * pierwszy raz o 20:05 w niezrobiony dzień treningowy spełniałby oba warunki
 * i dostałby dwa powiadomienia naraz — dokładnie ten szum, który kończy się
 * wyciszeniem kanału.
 */
export const GODZINA_RANO = 8;
export const GODZINA_KALORII = 18;
export const GODZINA_WIECZOR = 20;

/**
 * Po tej godzinie alarm o wiszącej sesji czeka do rana.
 *
 * Bez górnej granicy sesja otwarta o 21:00 dzwoniłaby o północy, a otwarta
 * o 23:00 — o drugiej. Zwłoka nic nie kosztuje: wisząca sesja boli dopiero
 * wtedy, gdy blokuje NASTĘPNY trening, a ten i tak nie zacznie się w nocy.
 */
export const GODZINA_NOCNA = 22;

/**
 * Ile godzin otwarta sesja musi wisieć, żeby to znaczyło „zapomniał zamknąć".
 * Realny trening z rozgrzewką i przerwami mieści się w dwóch.
 */
export const GODZIN_WISZACEJ_SESJI = 3;

/**
 * Godzina sygnału o ciszy na wadze — wieczorem, bo waga mierzy się rano
 * na czczo. O dziewiątej byłoby już po, a przypomnienie „na jutro" trafia
 * dokładnie w moment planowania następnego dnia.
 */
export const GODZINA_WAGI = 19;

/**
 * Co ile dni ciszy odzywa się sygnał o wadze — i to samo „co ile", nie tylko
 * „po ilu". Warunek „minęło 10 dni" jest prawdziwy KAŻDEGO kolejnego dnia,
 * a ślad chroni tylko dobę, więc bez reszty z dzielenia byłoby to codzienne
 * powiadomienie o stałej porze — czyli dokładnie to, co kończy się wyciszeniem
 * całego kanału. Tak odzywa się w 10., 20. i 30. dniu.
 */
export const DNI_CISZY_WAGI = 10;

/**
 * Progi jako UŁAMEK celu dziennego, nie sztywne kalorie.
 *
 * Przy celu 3500 kcal alarm od 1500 nie przyszedłby nigdy, a przy celu 1600 —
 * codziennie. Dolny próg jest skalibrowany na realny przypadek: 1500 z 2800 to
 * 53,6 %, czyli tuż pod 55 %.
 */
export const PROG_ZA_MALO = 0.55;
export const PROG_ZA_DUZO = 0.85;

export type DoWyslania = {
  rodzaj: RodzajPowiadomienia;
  tytul: string;
  tresc: string;
  /**
   * Zakładka do otwarcia po stuknięciu. Adres składa service worker; wszystkie
   * te nazwy stoją już w `EKRANY` w `public/app.js`.
   */
  ekran: "dzis" | "trening" | "postepy" | "raporty";
};

export type OpcjePowiadomien = {
  /** Chwila w UTC ISO — podawana, nie czytana z zegara. */
  teraz: string;
  strefa?: string;
  /** Rodzaje włączone przez użytkownika. Pusta lista = cisza. */
  wlaczone: readonly RodzajPowiadomienia[];
  /**
   * Rodzaje już wysłane tego dnia lokalnego. Zwykłe napisy, bo ślad w rejestrze
   * może pamiętać rodzaj usunięty z kodu — do sprawdzenia zawierania to bez
   * różnicy, a przepuszczanie takiego zapisu przez walidację nic nie wnosi.
   */
  juzWyslane: readonly string[];
};

/** „utrzymanie" pilnuje obu stron; masa tylko dolnej, redukcja tylko górnej. */
const PROGI_TRYBU = {
  masa: { zaMalo: true, zaDuzo: false },
  redukcja: { zaMalo: false, zaDuzo: true },
  utrzymanie: { zaMalo: true, zaDuzo: true },
} as const;

const kcal = (x: number): string => String(Math.round(x));

export function powiadomieniaNaTeraz(db: Baza, opcje: OpcjePowiadomien): DoWyslania[] {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const godzina = Number(godzinaLokalna(opcje.teraz, strefa).slice(0, 2));

  // Ślad wysyłki obowiązuje WSZYSTKIE rodzaje — raz dziennie znaczy raz dziennie.
  const nieBylo = (rodzaj: RodzajPowiadomienia): boolean =>
    !opcje.juzWyslane.includes(rodzaj);

  // Przełącznik dotyczy wyłącznie rodzajów, które go mają. Zawężenie parametru
  // do `RodzajPrzelaczalny` nie jest ozdobnikiem: dzięki niemu przepuszczenie
  // rodzaju stałego przez listę `wlaczone` jest błędem kompilacji, a nie
  // regułą zapisaną w komentarzu, którą ktoś kiedyś przeoczy.
  const dozwolony = (rodzaj: RodzajPrzelaczalny): boolean =>
    opcje.wlaczone.includes(rodzaj) && nieBylo(rodzaj);

  const wynik: DoWyslania[] = [];

  // Wisząca sesja idzie PRZED przypomnieniami treningowymi i je wyklucza.
  // Otwarta sesja bez ani jednej serii nie gasi dzisiejszego zadania (tak ma
  // być — pusta sesja to ślad po pomyłce), więc bez tego wykluczenia sesja
  // wisząca od wczoraj plus dzisiejszy dzień planu dałyby o ósmej dwa
  // powiadomienia o tym samym treningu.
  const wisi = nieBylo("sesja_wisi") ? trescWiszacejSesji(db, opcje.teraz, strefa, godzina) : null;
  if (wisi) wynik.push(wisi);

  const poraTreningu =
    godzina >= GODZINA_WIECZOR
      ? "trening_wieczor"
      : godzina >= GODZINA_RANO
        ? "trening_rano"
        : null;

  if (!wisi && poraTreningu !== null && dozwolony(poraTreningu)) {
    const trening = trescTreningu(db, poraTreningu, opcje.teraz, strefa);
    if (trening) wynik.push(trening);
  }

  if (godzina >= GODZINA_KALORII && dozwolony("kalorie")) {
    const kalorie = trescKalorii(db, opcje.teraz, strefa);
    if (kalorie) wynik.push(kalorie);
  }

  if (nieBylo("raport")) {
    const gotowy = trescRaportu(db, opcje.teraz, strefa);
    if (gotowy) wynik.push(gotowy);
  }

  if (godzina >= GODZINA_WAGI && nieBylo("waga_cisza")) {
    const cisza = trescCiszyWagi(db, opcje.teraz, strefa);
    if (cisza) wynik.push(cisza);
  }

  return wynik;
}

/**
 * Dzień z harmonogramu, którego jeszcze nie zrobiono.
 *
 * Zrealizowany dzień gasi oba przypomnienia — to jest to milknięcie. Dzień wolny
 * też, bo nie ma o czym przypominać.
 */
function trescTreningu(
  db: Baza,
  rodzaj: "trening_rano" | "trening_wieczor",
  teraz: string,
  strefa: string,
): DoWyslania | null {
  const plan = planNaDzis(db, { ts: teraz, strefa });
  if (!plan.dzien || plan.zrealizowany) return null;

  const opis = `Dzień ${plan.dzien.kod} — ${plan.dzien.nazwa}`;

  return rodzaj === "trening_rano"
    ? { rodzaj, tytul: "Dziś dzień treningowy", tresc: opis, ekran: "trening" }
    : {
        rodzaj,
        tytul: "Ostatnia szansa na trening",
        tresc: `${opis}. Dzień się kończy.`,
        ekran: "trening",
      };
}

/**
 * Otwarta sesja treningowa, która wisi od godzin.
 *
 * To jedyne powiadomienie łapiące BŁĄD, a nie przypominające o zamiarze:
 * `idx_sesja_aktywna` dopuszcza jedną otwartą sesję naraz, więc zapomniana
 * blokuje następny trening, a historia dostaje sesję trwającą kilkanaście
 * godzin. Gaśnie w chwili zamknięcia treningu.
 *
 * Ślad wysyłki jest per doba lokalna, więc sesja wisząca przez dwa dni odezwie
 * się dwa razy — i tak ma być: drugiego dnia blokada zdążyła już kosztować
 * trening.
 */
function trescWiszacejSesji(
  db: Baza,
  teraz: string,
  strefa: string,
  godzina: number,
): DoWyslania | null {
  if (godzina < GODZINA_RANO || godzina >= GODZINA_NOCNA) return null;

  const sesja = aktywnaSesja(db);
  if (!sesja) return null;

  const godzin = (Date.parse(teraz) - Date.parse(sesja.start_ts)) / 3_600_000;
  if (godzin < GODZIN_WISZACEJ_SESJI) return null;

  // Sesja otwarta „bez planu" nie ma kodu ani nazwy dnia — wtedy mówimy o niej
  // tym, czym jest, zamiast wstawiać puste miejsce po nazwie.
  const co =
    sesja.dzien_kod !== null
      ? `Dzień ${sesja.dzien_kod}${sesja.dzien_nazwa ? ` — ${sesja.dzien_nazwa}` : ""}`
      : "Trening bez planu";

  return {
    rodzaj: "sesja_wisi",
    tytul: "Trening wciąż otwarty",
    tresc:
      `${co}, start ${godzinaLokalna(sesja.start_ts, strefa)} — ` +
      `trwa ${Math.floor(godzin)} godz. Otwarta sesja blokuje kolejny trening.`,
    ekran: "trening",
  };
}

/** Polska odmiana po liczbie: 1 trening, 2–4 treningi, 5+ treningów. */
function odmien(ile: number, jeden: string, kilka: string, wiele: string): string {
  const dziesiatki = ile % 100;
  if (ile === 1) return `${ile} ${jeden}`;
  const jednosci = ile % 10;
  if (jednosci >= 2 && jednosci <= 4 && (dziesiatki < 12 || dziesiatki > 14)) {
    return `${ile} ${kilka}`;
  }
  return `${ile} ${wiele}`;
}

/**
 * Raport zamkniętego tygodnia, dokładnie w dniu jego publikacji.
 *
 * Ani dnia tygodnia, ani godziny nie sprawdzamy tu wprost — oba warunki są już
 * zaszyte w tym, że wiersz raportu w ogóle istnieje. Tydzień biegnie niedziela–
 * sobota, więc `tydzien_do + 1` JEST niedzielą publikacji, a przed 9:00
 * `zapewnijRaporty` tego wiersza nie tworzy. Duplikowanie tych progów tutaj
 * dałoby dwa miejsca, które trzeba by zmieniać razem.
 *
 * To jedyne z sześciu powiadomień, którego użytkownik nie zgasi działaniem —
 * raport nie przestaje istnieć w ciągu dnia. Uzasadnia to częstotliwość (raz na
 * tydzień) i to, że niesie treść, a nie ponaglenie.
 *
 * Po dłuższym przestoju serwera raport dogeneruje się z opóźnieniem i wtedy
 * powiadomienie nie pójdzie — data się nie zgodzi. Świadomie: raport odzyskany
 * po fakcie czeka w archiwum i nie jest pilny.
 */
function trescRaportu(db: Baza, teraz: string, strefa: string): DoWyslania | null {
  const najnowszy = raport(db);
  if (!najnowszy) return null;
  if (dataLokalna(teraz, strefa) !== przesunDate(najnowszy.tydzien_do, 1)) return null;

  const czesci = [
    odmien(najnowszy.trening.sesje, "trening", "treningi", "treningów"),
    odmien(najnowszy.trening.serie, "seria", "serie", "serii"),
    // Bez ustawionych celów nie ma czego trafiać — człon znika zamiast pokazywać
    // „0 z 7", które wyglądałoby na porażkę, a jest brakiem odniesienia.
    najnowszy.dieta.cel_dzienny ? `${najnowszy.dieta.dni_w_celu} z 7 dni w celu` : null,
  ].filter((c): c is string => c !== null);

  return {
    rodzaj: "raport",
    tytul: "Raport tygodnia gotowy",
    // Bez werdyktu „lepiej / gorzej" — to jedyne pole raportu, które ocenia,
    // a powiadomienie ma pokazywać. Od interpretacji jest komentarz w raporcie.
    tresc: `${najnowszy.tydzien_od} – ${najnowszy.tydzien_do}: ${czesci.join(", ")}.`,
    ekran: "raporty",
  };
}

/**
 * Cisza na wadze — jedyna liczba mierząca skutek przestała napływać.
 *
 * To NIE jest „zważ się codziennie": taki wariant został odrzucony jako
 * najbardziej irytujący z rozważanych. Chodzi o rzadki sygnał, że nawyk się
 * urwał — przy budowaniu masy bez wagi je się w ciemno.
 *
 * Konto, które nigdy nie zapisało wagi, MILCZY. Bez ani jednego pomiaru nie ma
 * ciszy do przerwania, jest brak nawyku — a powiadomienie byłoby wtedy
 * bezwarunkowe, bo nic poza pierwszym ważeniem by go nie zgasiło. Zachęta do
 * zaczęcia to robota rozmowy z Claude'em, nie push-a.
 */
function trescCiszyWagi(db: Baza, teraz: string, strefa: string): DoWyslania | null {
  const ostatnia = ostatniaWaga(db);
  if (!ostatnia) return null;

  // Odstęp liczony tak, jak liczy go `tydzienWToku` — nowej funkcji w `time.ts`
  // nie dodajemy. Ubocznie: `zakresDat` przerywa po 3650 dniach, więc pomiar
  // sprzed dekady da liczbę przybliżoną. Warunek dolny i tak trzyma.
  const dni = zakresDat(ostatnia.data_lokalna, dataLokalna(teraz, strefa)).length - 1;
  if (dni < DNI_CISZY_WAGI || dni % DNI_CISZY_WAGI !== 0) return null;

  return {
    rodzaj: "waga_cisza",
    tytul: `${dni} dni bez ważenia`,
    tresc: `Ostatni pomiar: ${ostatnia.kg} kg. Kolejny pokaże, co dał ten czas.`,
    ekran: "postepy",
  };
}

/**
 * Bilans dnia zestawiony z celem — w stronę, którą wskazuje tryb.
 *
 * Bez ustawionych celów nie ma z czym porównywać, więc nie ma powiadomienia.
 * Treść podaje LICZBY, nie ocenę: „zostało 1300 kcal" czyta się jako zachętę
 * przy budowaniu masy i jako ostrzeżenie przy redukcji, a system nie musi
 * wybierać za użytkownika.
 */
function trescKalorii(db: Baza, teraz: string, strefa: string): DoWyslania | null {
  const dzien = podsumowanieDnia(db, dataLokalna(teraz, strefa), { strefa });
  if (!dzien.cele || dzien.cele.kcal <= 0) return null;

  const zjedzone = dzien.spozyte.kcal;
  const cel = dzien.cele.kcal;
  const udzial = zjedzone / cel;
  const zostalo = cel - zjedzone;
  const progi = PROGI_TRYBU[dzien.cele.tryb];

  if (progi.zaMalo && udzial < PROG_ZA_MALO) {
    return {
      rodzaj: "kalorie",
      tytul: "Za mało jak na dziś",
      tresc: `${kcal(zjedzone)} z ${kcal(cel)} kcal. Zostało ${kcal(zostalo)} — zdążysz zjeść?`,
      ekran: "dzis",
    };
  }

  if (progi.zaDuzo && udzial > PROG_ZA_DUZO) {
    return {
      rodzaj: "kalorie",
      tytul: "Zostało mało na wieczór",
      tresc: `${kcal(zjedzone)} z ${kcal(cel)} kcal. Na resztę dnia zostało ${kcal(zostalo)}.`,
      ekran: "dzis",
    };
  }

  return null;
}

/**
 * Kolumna `powiadomienia` w rejestrze ↔ lista rodzajów PRZEŁĄCZALNYCH.
 *
 * Tekst po przecinku zamiast kolumn boolowskich: kolejny przełącznik ma być
 * jedną linią w TypeScripcie, nie migracją. Nieznane nazwy odpadają po cichu —
 * to jedyne miejsce, w którym stara wersja kodu spotyka nowy rodzaj.
 *
 * Kluczowych rodzajów tu NIE MA i mieć nie może: gdyby dało się je zapisać,
 * dałoby się je też skasować, a wtedy „bez przełącznika" znaczyłoby tylko tyle,
 * że wyłącznik jest schowany głębiej.
 */
export function odczytajRodzaje(zapis: string): RodzajPrzelaczalny[] {
  return zapis
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RodzajPrzelaczalny =>
      RODZAJE_PRZELACZALNE.includes(s as RodzajPrzelaczalny),
    );
}

export function zapiszRodzaje(rodzaje: readonly RodzajPrzelaczalny[]): string {
  return RODZAJE_PRZELACZALNE.filter((r) => rodzaje.includes(r)).join(",");
}
