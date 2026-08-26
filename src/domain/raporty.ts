/**
 * Tydzień: raport zamkniętego tygodnia i podgląd tygodnia w toku.
 *
 * Tydzień biegnie od niedzieli do soboty, a raport za niego powstaje w kolejną
 * niedzielę o 9:00 czasu lokalnego. Granica przesunięta wobec tygodnia ISO jest
 * celowa — w niedzielę rano tydzień poniedziałek–niedziela jeszcze trwa, więc
 * raport z niego byłby albo niepełny, albo o tydzień spóźniony.
 *
 * Raport jest MIGAWKĄ: liczby zapisujemy raz i nigdy nie przeliczamy. Poprawka
 * posiłku sprzed miesiąca nie może zmienić raportu, który użytkownik już
 * przeczytał i skomentował. Podgląd tygodnia w toku jest odwrotnością — liczy
 * się przy każdym wejściu i niczego nie zapisuje. Obie ścieżki dzielą
 * `policzWycinek` i różnią się wyłącznie tym, co robią z wynikiem.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import {
  dataLokalna,
  godzinaLokalna,
  przesunDate,
  terazUtc,
  tydzienRaportu,
  zakresDat,
  STREFA_DOMYSLNA,
} from "../lib/time.js";
import { BladDomeny } from "./bledy.js";
import { celeNaDzien } from "./diet.js";
import { trendWagi } from "./metrics.js";
import { dodajMakro, odejmijMakro, MAKRO_ZERO, type Makro } from "./typy.js";
import { planTreningowy } from "./workouts.js";

export type Opcje = { strefa?: string; teraz?: string };

const DNI_TYGODNIA = 7;

/**
 * Pasmo wokół celu, w którym dzień i prognoza uchodzą za trafione.
 *
 * Jedyna liczba w tym pliku, którą warto podkręcić po kilku tygodniach
 * używania — reszta wynika z kalendarza.
 */
export const PASMO_CELU = 0.05;

/** Godzina lokalna, o której publikujemy raport za miniony tydzień. */
const GODZINA_RAPORTU = "09:00";

/** Ile tygodni wstecz wolno dogenerować przy pierwszym uruchomieniu. */
const MAKS_TYGODNI_WSTECZ = 26;

/** Okno średniej kroczącej wagi — musi zgadzać się z `trendWagi`. */
const OKNO_WAGI_DNI = 7;

// === Kształty wyników ===================================================

export type StatDiety = {
  /** Dni z jakimkolwiek posiłkiem. Średnia dzieli się właśnie przez to. */
  dni_z_zapisem: number;
  srednie: Makro;
  cel_dzienny: Makro | null;
  dni_w_celu: number;
  /** Wpisy oparte na szacunku — wszystko poza `dokladne`. */
  ile_szacowanych: number;
  /** Podzbiór szacowanych z najniższą pewnością. Starsze migawki raportów
   *  tego pola nie mają — migawek nie przeliczamy. */
  ile_niepewnych?: number;
};

export type StatWagi = {
  start: number | null;
  koniec: number | null;
  zmiana_kg: number | null;
};

export type StatTreningu = {
  sesje: number;
  /** Ile dni treningowych ma tygodniowy harmonogram — mianownik dla `sesje`. */
  sesje_w_planie: number;
  serie: number;
  objetosc_kg: number;
  cwiczenia: { nazwa: string; serie: number; objetosc_kg: number }[];
};

export type WycinekTygodnia = {
  od: string;
  do: string;
  dni: number;
  dieta: StatDiety;
  waga: StatWagi;
  trening: StatTreningu;
};

export type Zmiana = {
  kcal_dziennie: number;
  dni_w_celu: number;
  serie: number;
  objetosc_kg: number;
  waga_kg: number | null;
  /** Skrótowy werdykt — patrz `ocenZmiane`. */
  ocena: "lepiej" | "gorzej" | "podobnie";
};

export type RaportTygodniowy = {
  tydzien_od: string;
  tydzien_do: string;
  utworzono: string;
  dieta: StatDiety;
  waga: StatWagi;
  trening: StatTreningu;
  zmiana: Zmiana | null;
  komentarz: string | null;
  komentarz_ts: string | null;
};

export type Prognoza = {
  /** Średnia z dni zamkniętych rozciągnięta na cały tydzień. */
  na_koniec: Makro;
  cel_tygodnia: Makro | null;
  roznica: Makro | null;
  na_kursie: boolean | null;
  /** Dzień w toku, pokazywany osobno — do prognozy nie wchodzi. */
  dzis: Makro;
};

export type PostepTygodnia = {
  tydzien_od: string;
  tydzien_do: string;
  dni_zamkniete: number;
  dieta: StatDiety;
  waga: StatWagi;
  trening: StatTreningu;
  prognoza: Prognoza | null;
  zmiana: Zmiana | null;
};

// === Pomocnicze rachunki ================================================

const zaokr = (n: number, miejsca = 1): number => {
  const mnoznik = 10 ** miejsca;
  return Math.round(n * mnoznik) / mnoznik;
};

function podzielMakro(m: Makro, przez: number): Makro {
  if (przez <= 0) return MAKRO_ZERO;
  return {
    kcal: zaokr(m.kcal / przez),
    bialko_g: zaokr(m.bialko_g / przez),
    wegle_g: zaokr(m.wegle_g / przez),
    tluszcz_g: zaokr(m.tluszcz_g / przez),
  };
}

function pomnozMakro(m: Makro, razy: number): Makro {
  return {
    kcal: zaokr(m.kcal * razy),
    bialko_g: zaokr(m.bialko_g * razy),
    wegle_g: zaokr(m.wegle_g * razy),
    tluszcz_g: zaokr(m.tluszcz_g * razy),
  };
}

const tylkoMakro = (m: Makro): Makro => ({
  kcal: m.kcal,
  bialko_g: m.bialko_g,
  wegle_g: m.wegle_g,
  tluszcz_g: m.tluszcz_g,
});

/** Wycinek bez jednego wpisu — nie ma go po co z niczym porównywać. */
function czyPusty(w: WycinekTygodnia): boolean {
  return w.dieta.dni_z_zapisem === 0 && w.trening.serie === 0 && w.waga.koniec === null;
}

/** Suma celów dzień po dniu — cele mają datę wejścia i mogą zmienić się w środku tygodnia. */
function sumaCelow(db: Baza, od: string, doDaty: string): Makro | null {
  let suma = MAKRO_ZERO;
  let znaleziono = false;

  for (const dzien of zakresDat(od, doDaty)) {
    const cel = celeNaDzien(db, dzien);
    if (!cel) continue;
    znaleziono = true;
    suma = dodajMakro(suma, tylkoMakro(cel));
  }

  return znaleziono ? suma : null;
}

function statDiety(db: Baza, od: string, doDaty: string): StatDiety {
  const sumy = repo.sumyDzienne(db, od, doDaty);

  let suma = MAKRO_ZERO;
  let wCelu = 0;

  for (const dzien of sumy) {
    suma = dodajMakro(suma, tylkoMakro(dzien));

    const cel = celeNaDzien(db, dzien.data_lokalna);
    if (cel && cel.kcal > 0 && Math.abs(dzien.kcal - cel.kcal) <= cel.kcal * PASMO_CELU) {
      wCelu += 1;
    }
  }

  const cel = celeNaDzien(db, doDaty);
  const posilki = repo.posilkiZZakresu(db, od, doDaty);

  return {
    dni_z_zapisem: sumy.length,
    srednie: podzielMakro(suma, sumy.length),
    cel_dzienny: cel ? tylkoMakro(cel) : null,
    dni_w_celu: wCelu,
    ile_szacowanych: posilki.filter((p) => p.pewnosc !== "dokladne").length,
    ile_niepewnych: posilki.filter((p) => p.pewnosc === "niepewne").length,
  };
}

/**
 * Waga liczona ze średniej kroczącej, nie z surowego pomiaru — dzienne wahania
 * wody potrafią przykryć cały tygodniowy trend.
 *
 * Okres pobieramy szerszy o okno średniej, żeby pierwsze dni wycinka miały
 * pełne okno zamiast obciętego.
 */
function statWagi(db: Baza, od: string, doDaty: string): StatWagi {
  const dni = zakresDat(od, doDaty).length;
  const trend = trendWagi(db, dni + OKNO_WAGI_DNI - 1, { do: doDaty }).filter((p) => p.data >= od);

  const start = trend[0]?.srednia_7d ?? null;
  const koniec = trend[trend.length - 1]?.srednia_7d ?? null;

  return {
    start,
    koniec,
    zmiana_kg: start !== null && koniec !== null ? zaokr(koniec - start, 2) : null,
  };
}

function statTreningu(db: Baza, od: string, doDaty: string): StatTreningu {
  const agregat = repo.agregatSerii(db, od, doDaty);

  return {
    sesje: repo.ileSesjiZakonczonych(db, od, doDaty),
    sesje_w_planie: planTreningowy(db).filter((d) => d.aktywny && d.dzien_tygodnia !== null).length,
    serie: agregat.reduce((s, c) => s + c.serie, 0),
    objetosc_kg: zaokr(
      agregat.reduce((s, c) => s + c.objetosc_kg, 0),
      2,
    ),
    cwiczenia: agregat.map((c) => ({
      nazwa: c.nazwa,
      serie: c.serie,
      objetosc_kg: zaokr(c.objetosc_kg, 2),
    })),
  };
}

/** Liczy dowolny zakres dat. Niczego nie zapisuje. */
export function policzWycinek(db: Baza, od: string, doDaty: string): WycinekTygodnia {
  return {
    od,
    do: doDaty,
    dni: zakresDat(od, doDaty).length,
    dieta: statDiety(db, od, doDaty),
    waga: statWagi(db, od, doDaty),
    trening: statTreningu(db, od, doDaty),
  };
}

/**
 * Werdykt „idzie lepiej czy gorzej" — świadomie oparty tylko na tym, co ma
 * jednoznaczny kierunek.
 *
 * Trafienia w cel i liczba serii mówią wprost: więcej znaczy lepiej. Kalorie
 * i waga nie — przy redukcji zjedzenie mniej jest dobre, przy budowaniu masy
 * złe, a system nie zna zamiaru użytkownika. Dlatego wchodzą do raportu jako
 * liczby ze znakiem, ale nie do oceny.
 */
function ocenZmiane(dniWCelu: number, serie: number): Zmiana["ocena"] {
  const punkty = Math.sign(dniWCelu) + Math.sign(serie);
  if (punkty > 0) return "lepiej";
  if (punkty < 0) return "gorzej";
  return "podobnie";
}

function policzZmiane(teraz: WycinekTygodnia, wczesniej: WycinekTygodnia): Zmiana {
  const waga =
    teraz.waga.koniec !== null && wczesniej.waga.koniec !== null
      ? zaokr(teraz.waga.koniec - wczesniej.waga.koniec, 2)
      : null;

  const dniWCelu = teraz.dieta.dni_w_celu - wczesniej.dieta.dni_w_celu;
  const serie = teraz.trening.serie - wczesniej.trening.serie;

  return {
    kcal_dziennie: zaokr(teraz.dieta.srednie.kcal - wczesniej.dieta.srednie.kcal),
    dni_w_celu: dniWCelu,
    serie,
    objetosc_kg: zaokr(teraz.trening.objetosc_kg - wczesniej.trening.objetosc_kg, 2),
    waga_kg: waga,
    ocena: ocenZmiane(dniWCelu, serie),
  };
}

// === Raporty zamkniętych tygodni ========================================

function zbudujRaport(wiersz: repo.WierszRaportu): RaportTygodniowy {
  const dane = JSON.parse(wiersz.dane) as {
    dieta: StatDiety;
    waga: StatWagi;
    trening: StatTreningu;
    zmiana: Zmiana | null;
  };

  return {
    tydzien_od: wiersz.tydzien_od,
    tydzien_do: wiersz.tydzien_do,
    utworzono: wiersz.utworzono,
    dieta: dane.dieta,
    waga: dane.waga,
    trening: dane.trening,
    zmiana: dane.zmiana,
    komentarz: wiersz.komentarz,
    komentarz_ts: wiersz.komentarz_ts,
  };
}

/**
 * Dogenerowuje raporty za wszystkie zamknięte tygodnie, których jeszcze nie ma.
 *
 * Wołane przy starcie procesu, z tiku harmonogramu i przy każdym odczycie —
 * dzięki temu raport istnieje dokładnie wtedy, gdy ktoś po niego sięga, i wraca
 * po przestoju serwera bez ręcznego zabiegu. Idempotencji pilnuje UNIQUE
 * w bazie, więc równoległe wywołania niczego nie zdublują.
 */
export function zapewnijRaporty(db: Baza, opcje: Opcje = {}): RaportTygodniowy[] {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const teraz = opcje.teraz ?? terazUtc();
  const dzis = dataLokalna(teraz, strefa);
  const biezacy = tydzienRaportu(dzis);

  // Raport za miniony tydzień publikujemy w niedzielę o 9:00 — czyli pierwszego
  // dnia tygodnia bieżącego. Wcześniej tego dnia jeszcze go nie ma.
  if (dzis === biezacy.od && godzinaLokalna(teraz, strefa) < GODZINA_RAPORTU) return [];

  const najstarsza = repo.najwczesniejszaData(db);
  if (!najstarsza) return [];

  const ostatniOd = przesunDate(biezacy.od, -DNI_TYGODNIA);
  const granica = przesunDate(ostatniOd, -DNI_TYGODNIA * (MAKS_TYGODNI_WSTECZ - 1));
  const pierwszyOd = maksData(tydzienRaportu(najstarsza).od, granica);

  const istniejace = new Set(repo.tygodnieZRaportem(db, pierwszyOd, ostatniOd));
  const nowe: RaportTygodniowy[] = [];

  for (let od = pierwszyOd; od <= ostatniOd; od = przesunDate(od, DNI_TYGODNIA)) {
    if (istniejace.has(od)) continue;

    const doDaty = przesunDate(od, DNI_TYGODNIA - 1);
    // Tydzień bez jednego wpisu pomijamy — archiwum nie ma się zapełniać
    // pustymi tabelkami z urlopu.
    if (repo.ileWpisow(db, od, doDaty) === 0) continue;

    const wycinek = policzWycinek(db, od, doDaty);
    const poprzedni = policzWycinek(db, przesunDate(od, -DNI_TYGODNIA), przesunDate(od, -1));

    repo.wstawRaport(db, {
      tydzien_od: od,
      tydzien_do: doDaty,
      dane: JSON.stringify({
        dieta: wycinek.dieta,
        waga: wycinek.waga,
        trening: wycinek.trening,
        zmiana: czyPusty(poprzedni) ? null : policzZmiane(wycinek, poprzedni),
      }),
      utworzono: teraz,
    });

    const zapisany = repo.raportPoTygodniu(db, od);
    if (zapisany) nowe.push(zbudujRaport(zapisany));
  }

  return nowe;
}

const maksData = (a: string, b: string): string => (a >= b ? a : b);

/** Raport wskazanego tygodnia; bez argumentu — najnowszy. */
export function raport(db: Baza, dzienTygodnia?: string): RaportTygodniowy | null {
  const wiersz = dzienTygodnia
    ? repo.raportPoTygodniu(db, tydzienRaportu(dzienTygodnia).od)
    : repo.ostatnieRaporty(db, 1)[0];

  return wiersz ? zbudujRaport(wiersz) : null;
}

export function raporty(db: Baza, limit = 12): RaportTygodniowy[] {
  return repo.ostatnieRaporty(db, limit).map(zbudujRaport);
}

/**
 * Komentarz Claude do zapisanego raportu.
 *
 * Serwer liczy, ale nie interpretuje — zdanie „białko spadło w środku tygodnia"
 * może dopisać tylko model. Migawka liczb zostaje nietknięta.
 */
export function dopiszKomentarz(
  db: Baza,
  dzienTygodnia: string,
  komentarz: string,
  opcje: Opcje = {},
): RaportTygodniowy {
  const tekst = komentarz.trim();
  if (tekst === "") {
    throw new BladDomeny("Komentarz do raportu nie może być pusty", "pusty_komentarz");
  }

  const od = tydzienRaportu(dzienTygodnia).od;
  const zmienione = repo.ustawKomentarzRaportu(db, od, tekst, opcje.teraz ?? terazUtc());

  if (zmienione === 0) {
    throw new BladDomeny(`Nie ma raportu za tydzień od ${od}`, "brak_raportu");
  }

  const zapisany = repo.raportPoTygodniu(db, od);
  if (!zapisany) throw new Error(`Nie udało się odczytać raportu z tygodnia ${od}`);
  return zbudujRaport(zapisany);
}

// === Tydzień w toku =====================================================

function policzPrognoze(
  db: Baza,
  zamkniete: WycinekTygodnia,
  tydzien: { od: string; do: string },
  dzis: string,
): Prognoza {
  const naKoniec = pomnozMakro(zamkniete.dieta.srednie, DNI_TYGODNIA);
  const celTygodnia = sumaCelow(db, tydzien.od, tydzien.do);
  const roznica = celTygodnia ? odejmijMakro(naKoniec, celTygodnia) : null;

  return {
    na_koniec: naKoniec,
    cel_tygodnia: celTygodnia,
    roznica,
    na_kursie:
      celTygodnia && roznica && celTygodnia.kcal > 0
        ? Math.abs(roznica.kcal) <= celTygodnia.kcal * PASMO_CELU
        : null,
    dzis: statDiety(db, dzis, dzis).srednie,
  };
}

/**
 * Bieżący tydzień: stan, prognoza i porównanie z poprzednim tygodniem.
 *
 * Dwie rzeczy, na których łatwo się przejechać:
 *
 * Prognoza liczy się z dni ZAMKNIĘTYCH, bez dzisiaj. Dzisiejsze spożycie
 * dopiero rośnie, więc wliczone jako fakt zaniżałoby wynik tym mocniej, im
 * wcześniej w ciągu dnia się patrzy.
 *
 * Porównanie obejmuje TEN SAM wycinek poprzedniego tygodnia. Trzy dni
 * bieżącego zestawione z siedmioma poprzedniego zawsze pokazałyby „gorzej",
 * niezależnie od tego, jak dobry jest tydzień.
 */
export function tydzienWToku(db: Baza, opcje: Opcje = {}): PostepTygodnia {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const dzis = dataLokalna(opcje.teraz ?? terazUtc(), strefa);
  const tydzien = tydzienRaportu(dzis);

  const dniZamkniete = zakresDat(tydzien.od, dzis).length - 1;
  const biezacy = policzWycinek(db, tydzien.od, dzis);

  const zamkniete =
    dniZamkniete > 0 ? policzWycinek(db, tydzien.od, przesunDate(dzis, -1)) : null;

  const poprzedniOd = przesunDate(tydzien.od, -DNI_TYGODNIA);
  const poprzedni =
    dniZamkniete > 0
      ? policzWycinek(db, poprzedniOd, przesunDate(poprzedniOd, dniZamkniete - 1))
      : null;

  /*
   * Dieta liczy się z dni ZAMKNIĘTYCH, trening i waga z całego tygodnia.
   *
   * Różnica nie jest przypadkowa. Średnia kalorii i „dni w celu" wymagają
   * pełnej doby: o dwunastej dzień z tysiącem kalorii wygląda jak nietrafiony
   * cel, choć do wieczora zostanie trafiony. Serie i pomiar wagi to fakty
   * dokonane — dzisiejszy trening ma się liczyć od razu, inaczej użytkownik
   * po powrocie z siłowni widziałby zero.
   */
  const dietaDniZamknietych: StatDiety = zamkniete
    ? zamkniete.dieta
    : {
        dni_z_zapisem: 0,
        srednie: MAKRO_ZERO,
        cel_dzienny: biezacy.dieta.cel_dzienny,
        dni_w_celu: 0,
        ile_szacowanych: 0,
        ile_niepewnych: 0,
      };

  return {
    tydzien_od: tydzien.od,
    tydzien_do: tydzien.do,
    dni_zamkniete: dniZamkniete,
    dieta: dietaDniZamknietych,
    waga: biezacy.waga,
    trening: biezacy.trening,
    // Bez ani jednego zapisu z dni zamkniętych prognoza wyszłaby zerowa i
    // ogłosiła, że celu nie dowieziesz — a to nie brak tempa, tylko brak danych.
    prognoza:
      zamkniete && zamkniete.dieta.dni_z_zapisem > 0
        ? policzPrognoze(db, zamkniete, tydzien, dzis)
        : null,
    zmiana:
      zamkniete && poprzedni && !czyPusty(poprzedni) ? policzZmiane(zamkniete, poprzedni) : null,
  };
}
