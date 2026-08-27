/**
 * Poprawianie i usuwanie wpisów.
 *
 * Jedna implementacja obsługuje oba wejścia: czat („popraw ten obiad na 800 kcal")
 * i aplikację webową (przycisk edycji przy pozycji). Gdyby każde wejście miało
 * własną, prędzej czy później zaczęłyby się różnić.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import { dataLokalna, parsujCzas, STREFA_DOMYSLNA } from "../lib/time.js";
import { sprawdzWartosci } from "./aktywnosci.js";
import { BladDomeny } from "./bledy.js";
import { przytnijTytul, sprawdzKategorie, sprawdzTresc } from "./notatki.js";
import {
  PEWNOSCI,
  PORY,
  type KategoriaNotatki,
  type NowaPozycja,
  type Pewnosc,
  type Pora,
} from "./typy.js";

export type TypWpisu = "posilek" | "seria" | "waga" | "aktywnosc" | "sesja" | "notatka";
export type AkcjaWpisu = "popraw" | "usun";

export const TYPY_WPISOW: readonly TypWpisu[] = [
  "posilek",
  "seria",
  "waga",
  "aktywnosc",
  "sesja",
  "notatka",
];

export type ZmianyPosilku = {
  opis?: string;
  kcal?: number;
  bialko_g?: number;
  wegle_g?: number;
  tluszcz_g?: number;
  pora?: Pora;
  pewnosc?: Pewnosc;
  /** "HH:MM" zostaje w dniu wpisu; "YYYY-MM-DD HH:MM" albo ISO przenosi między dniami. */
  czas?: string;
  /** Pełna nowa lista — zastępuje rozbicie w całości. [] czyści. Pominięte = nie ruszaj. */
  pozycje?: NowaPozycja[];
};

export type ZmianySerii = {
  powtorzenia?: number | null;
  ciezar_kg?: number | null;
  czas_s?: number | null;
  dystans_m?: number | null;
  rpe?: number | null;
};

export type ZmianyWagi = {
  kg?: number;
  notatka?: string | null;
};

export type ZmianyAktywnosci = {
  dyscyplina?: string;
  dystans_m?: number | null;
  czas_s?: number | null;
  rpe?: number | null;
  notatka?: string | null;
  /** Jak przy posiłku: "HH:MM" zostaje w dniu wpisu, pełna data go przenosi. */
  czas?: string;
};

/**
 * Poprawka notatki nie ma pola `surowe_wejscie` i to jest cała jej istota:
 * oczyszczona treść jest interpretacją modelu i wolno ją prostować, ale
 * transkrypcja jest zapisem prawdy i zostaje nietknięta na zawsze.
 */
export type ZmianyNotatki = {
  tresc?: string;
  kategoria?: KategoriaNotatki;
  tytul?: string | null;
  /** Jak przy posiłku: "HH:MM" zostaje w dniu wpisu, pełna data go przenosi. */
  czas?: string;
};

export type ZadanieZmiany = {
  typ: TypWpisu;
  id: number;
  akcja: AkcjaWpisu;
  dane?: ZmianyPosilku | ZmianySerii | ZmianyWagi | ZmianyAktywnosci | ZmianyNotatki;
};

export type WynikZmiany = {
  typ: TypWpisu;
  id: number;
  akcja: AkcjaWpisu;
  opis: string;
};

/** Zostawia tylko klucze, które faktycznie podano — reszta kolumn zostaje nietknięta. */
function tylkoPodane<T extends object>(dane: T, dozwolone: readonly (keyof T)[]): Partial<T> {
  const wynik: Partial<T> = {};
  for (const klucz of dozwolone) {
    if (dane[klucz] !== undefined) wynik[klucz] = dane[klucz];
  }
  return wynik;
}

function brakWpisu(typ: TypWpisu, id: number): never {
  throw new BladDomeny(`Nie znaleziono wpisu typu "${typ}" o id ${id}`, "nieznany_wpis");
}

/** „1 serią", „3 seriami" — komunikat po usunięciu treningu ma brzmieć po polsku. */
const odmianaSerii = (ile: number): string => (ile === 1 ? "serią" : "seriami");

const POLA_MAKRO = ["kcal", "bialko_g", "wegle_g", "tluszcz_g"] as const;

/**
 * Nowy znacznik czasu wpisu wraz z datą lokalną.
 *
 * Parsowanie względem dnia WPISU, nie dzisiaj — goła godzina puszczona przez
 * `parsujCzas` przeniosłaby wczorajszy obiad na dzisiejszą dobę. Pełna data
 * przenosi wpis świadomie i to jest jedyny sposób, żeby go przełożyć.
 */
function nowyCzasWpisu(
  czas: unknown,
  dzienWpisu: string,
  strefa: string,
): { ts: string; data_lokalna: string } {
  if (typeof czas !== "string") {
    throw new BladDomeny(`Nie rozpoznano formatu czasu: "${String(czas)}"`, "zly_czas");
  }

  const godzina = /^(\d{1,2}):(\d{2})$/.exec(czas.trim());
  try {
    const ts = godzina
      ? parsujCzas(`${dzienWpisu} ${godzina[1]!.padStart(2, "0")}:${godzina[2]}`, strefa)
      : parsujCzas(czas, strefa);
    return { ts, data_lokalna: dataLokalna(ts, strefa) };
  } catch {
    throw new BladDomeny(`Nie rozpoznano formatu czasu: "${czas}"`, "zly_czas");
  }
}

/**
 * Walidacja pozycji siedzi w domenie, bo trasa /wpis przepuszcza `dane`
 * bez sprawdzania — dla aplikacji webowej to jedyna zapora przed śmieciami.
 */
function sprawdzPozycje(pozycje: unknown): asserts pozycje is NowaPozycja[] {
  if (!Array.isArray(pozycje)) {
    throw new BladDomeny("Pole pozycje musi być listą składników", "zla_pozycja");
  }

  for (const p of pozycje) {
    if (typeof p !== "object" || p === null || typeof p.nazwa !== "string" || !p.nazwa.trim()) {
      throw new BladDomeny("Każda pozycja posiłku musi mieć nazwę", "zla_pozycja");
    }
    for (const pole of ["ilosc_g", ...POLA_MAKRO] as const) {
      const wartosc = (p as NowaPozycja)[pole];
      if (wartosc != null && (typeof wartosc !== "number" || !Number.isFinite(wartosc) || wartosc < 0)) {
        throw new BladDomeny(`Pozycja „${p.nazwa}”: pole ${pole} poza zakresem`, "zla_pozycja");
      }
    }
  }
}

function poprawPosilek(db: Baza, id: number, dane: ZmianyPosilku, strefa: string): string {
  const istniejacy = repo.posilekPoId(db, id);
  if (!istniejacy) brakWpisu("posilek", id);

  if (dane.pora !== undefined && !PORY.includes(dane.pora)) {
    throw new BladDomeny(`Nieznana pora posiłku: "${dane.pora}"`, "zla_pora");
  }
  if (dane.pewnosc !== undefined && !PEWNOSCI.includes(dane.pewnosc)) {
    throw new BladDomeny(`Nieznana pewność: "${dane.pewnosc}"`, "zla_pewnosc");
  }

  const pozycje = dane.pozycje;
  if (pozycje !== undefined) sprawdzPozycje(pozycje);

  const zmiany: Partial<Omit<repo.WierszPosilku, "id">> = tylkoPodane(dane, [
    "opis",
    "kcal",
    "bialko_g",
    "wegle_g",
    "tluszcz_g",
    "pora",
    "pewnosc",
  ]);

  if (dane.czas !== undefined) {
    Object.assign(zmiany, nowyCzasWpisu(dane.czas, istniejacy.data_lokalna, strefa));
  }

  // Edycja samych pozycji jest pełnoprawną zmianą.
  if (Object.keys(zmiany).length === 0 && pozycje === undefined) {
    throw new BladDomeny("Nie podano żadnych zmian", "brak_zmian");
  }

  let przeliczono = false;

  db.transaction(() => {
    if (pozycje !== undefined) {
      repo.zastapPozycje(
        db,
        id,
        pozycje.map((p) => ({
          nazwa: p.nazwa,
          ilosc_g: p.ilosc_g ?? null,
          kcal: p.kcal ?? null,
          bialko_g: p.bialko_g ?? null,
          wegle_g: p.wegle_g ?? null,
          tluszcz_g: p.tluszcz_g ?? null,
        })),
      );

      // Auto-suma per pole: pole niepodane jawnie w tej poprawce, a znane
      // w każdej pozycji, dostaje sumę z pozycji. Pola jawne wygrywają, ale
      // tylko w obrębie tej jednej poprawki — następna edycja pozycji znów
      // przeliczy. Pusta lista niczego nie sumuje i nie tyka nagłówka.
      for (const pole of POLA_MAKRO) {
        if (zmiany[pole] !== undefined || pozycje.length === 0) continue;
        if (!pozycje.every((p) => p[pole] != null)) continue;
        zmiany[pole] = pozycje.reduce((suma, p) => suma + (p[pole] ?? 0), 0);
        przeliczono = true;
      }
    }

    if (Object.keys(zmiany).length > 0) repo.aktualizujPosilek(db, id, zmiany);
  })();

  const dopisek = przeliczono
    ? ` (nagłówek przeliczony z pozycji: ${zmiany.kcal ?? istniejacy.kcal} kcal)`
    : "";
  return `Poprawiono posiłek „${istniejacy.opis}"${dopisek}`;
}

function poprawSerie(db: Baza, id: number, dane: ZmianySerii): string {
  const istniejaca = repo.seriaPoId(db, id);
  if (!istniejaca) brakWpisu("seria", id);

  const zmiany = tylkoPodane(dane, ["powtorzenia", "ciezar_kg", "czas_s", "dystans_m", "rpe"]);

  if (Object.keys(zmiany).length === 0) {
    throw new BladDomeny("Nie podano żadnych zmian", "brak_zmian");
  }

  repo.aktualizujSerie(db, id, zmiany);
  return `Poprawiono serię ${istniejaca.nr_serii} w ćwiczeniu „${istniejaca.nazwa}"`;
}

function poprawWage(db: Baza, id: number, dane: ZmianyWagi): string {
  const istniejaca = repo.wagaPoId(db, id);
  if (!istniejaca) brakWpisu("waga", id);

  if (dane.kg !== undefined && (!Number.isFinite(dane.kg) || dane.kg <= 0 || dane.kg > 500)) {
    throw new BladDomeny(`Waga poza sensownym zakresem: ${dane.kg} kg`, "zla_waga");
  }

  const zmiany = tylkoPodane(dane, ["kg", "notatka"]);

  if (Object.keys(zmiany).length === 0) {
    throw new BladDomeny("Nie podano żadnych zmian", "brak_zmian");
  }

  repo.aktualizujWage(db, id, zmiany);
  return `Poprawiono pomiar wagi z ${istniejaca.data_lokalna}`;
}

function poprawAktywnosc(db: Baza, id: number, dane: ZmianyAktywnosci, strefa: string): string {
  const istniejaca = repo.aktywnoscPoId(db, id);
  if (!istniejaca) brakWpisu("aktywnosc", id);

  if (dane.dyscyplina !== undefined && dane.dyscyplina.trim() === "") {
    throw new BladDomeny("Nazwa aktywności nie może być pusta", "pusta_dyscyplina");
  }
  sprawdzWartosci(dane);

  const zmiany: Partial<Omit<repo.WierszAktywnosci, "id" | "zrodlo">> = tylkoPodane(dane, [
    "dyscyplina",
    "dystans_m",
    "czas_s",
    "rpe",
    "notatka",
  ]);

  if (zmiany.dyscyplina !== undefined) zmiany.dyscyplina = zmiany.dyscyplina.trim();

  if (dane.czas !== undefined) {
    Object.assign(zmiany, nowyCzasWpisu(dane.czas, istniejaca.data_lokalna, strefa));
  }

  if (Object.keys(zmiany).length === 0) {
    throw new BladDomeny("Nie podano żadnych zmian", "brak_zmian");
  }

  // Wyzerowanie obu miar zostawiłoby wpis, z którego nic nie wynika — tę samą
  // zaporę stawia zapis, więc poprawka nie może jej obejść.
  const dystans = zmiany.dystans_m !== undefined ? zmiany.dystans_m : istniejaca.dystans_m;
  const czas = zmiany.czas_s !== undefined ? zmiany.czas_s : istniejaca.czas_s;
  if (dystans == null && czas == null) {
    throw new BladDomeny(
      "Aktywność musi zachować dystans albo czas — inaczej nic z niej nie wynika",
      "brak_czasu_i_dystansu",
    );
  }

  repo.aktualizujAktywnosc(db, id, zmiany);
  return `Poprawiono aktywność „${zmiany.dyscyplina ?? istniejaca.dyscyplina}" z ${zmiany.data_lokalna ?? istniejaca.data_lokalna}`;
}

/** Czym nazwać notatkę w komunikacie: tytułem, a bez niego początkiem treści. */
function nazwaNotatki(w: repo.WierszNotatki): string {
  if (w.tytul) return w.tytul;
  const skrot = w.tresc.slice(0, 40);
  return skrot.length < w.tresc.length ? `${skrot}…` : skrot;
}

function poprawNotatke(db: Baza, id: number, dane: ZmianyNotatki, strefa: string): string {
  const istniejaca = repo.notatkaPoId(db, id);
  if (!istniejaca) brakWpisu("notatka", id);

  const zmiany: Partial<Omit<repo.WierszNotatki, "id" | "zrodlo" | "surowe_wejscie">> = {};

  // Pole po polu, a nie przez `tylkoPodane`: każde ma własną walidację, tę samą
  // co przy zapisie. Poprawka nie może wpuścić tego, czego zapis by nie przyjął.
  if (dane.tresc !== undefined) zmiany.tresc = sprawdzTresc(dane.tresc);
  if (dane.kategoria !== undefined) zmiany.kategoria = sprawdzKategorie(dane.kategoria);
  if (dane.tytul !== undefined) zmiany.tytul = przytnijTytul(dane.tytul);

  if (dane.czas !== undefined) {
    Object.assign(zmiany, nowyCzasWpisu(dane.czas, istniejaca.data_lokalna, strefa));
  }

  if (Object.keys(zmiany).length === 0) {
    throw new BladDomeny("Nie podano żadnych zmian", "brak_zmian");
  }

  repo.aktualizujNotatke(db, id, zmiany);

  const nazwa = zmiany.tytul ?? nazwaNotatki({ ...istniejaca, ...zmiany });
  return `Poprawiono notatkę „${nazwa}" z ${zmiany.data_lokalna ?? istniejaca.data_lokalna}`;
}

function usun(db: Baza, typ: TypWpisu, id: number): string {
  switch (typ) {
    case "posilek": {
      const wpis = repo.posilekPoId(db, id);
      if (!wpis) brakWpisu(typ, id);
      // Pozycje znikają razem z posiłkiem dzięki kaskadzie w schemacie.
      repo.usunPosilek(db, id);
      return `Usunięto posiłek „${wpis.opis}" z ${wpis.data_lokalna}`;
    }
    case "seria": {
      const wpis = repo.seriaPoId(db, id);
      if (!wpis) brakWpisu(typ, id);
      repo.usunSerie(db, id);
      return `Usunięto serię ${wpis.nr_serii} w ćwiczeniu „${wpis.nazwa}"`;
    }
    case "waga": {
      const wpis = repo.wagaPoId(db, id);
      if (!wpis) brakWpisu(typ, id);
      repo.usunWage(db, id);
      return `Usunięto pomiar wagi z ${wpis.data_lokalna}`;
    }
    case "aktywnosc": {
      const wpis = repo.aktywnoscPoId(db, id);
      if (!wpis) brakWpisu(typ, id);
      repo.usunAktywnosc(db, id);
      return `Usunięto aktywność „${wpis.dyscyplina}" z ${wpis.data_lokalna}`;
    }
    case "notatka": {
      const wpis = repo.notatkaPoId(db, id);
      if (!wpis) brakWpisu(typ, id);
      repo.usunNotatke(db, id);
      // Razem z notatką znika też jej surowa transkrypcja — to jedyna droga,
      // żeby dyktowaną pomyłkę usunąć z bazy naprawdę.
      return `Usunięto notatkę „${nazwaNotatki(wpis)}" z ${wpis.data_lokalna}`;
    }
    case "sesja": {
      const wpis = repo.sesjaPoId(db, id);
      if (!wpis) brakWpisu(typ, id);

      // Liczymy PRZED skasowaniem — po kaskadzie nie będzie już czego policzyć,
      // a to jedyna informacja, jaką użytkownik dostanie: cofnięcia nie ma.
      const ile = repo.serieSesji(db, id).length;
      repo.usunSesje(db, id);

      const nazwa = wpis.dzien_kod ? `Trening ${wpis.dzien_kod}` : "Trening bez planu";
      return `Usunięto: ${nazwa} z ${wpis.data_lokalna} wraz z ${ile} ${odmianaSerii(ile)}`;
    }
  }
}

export function zmienWpis(
  db: Baza,
  zadanie: ZadanieZmiany,
  opcje: { strefa?: string } = {},
): WynikZmiany {
  const { typ, id, akcja } = zadanie;

  if (!TYPY_WPISOW.includes(typ)) {
    throw new BladDomeny(
      `Nieznany typ wpisu: "${typ}". Dozwolone: ${TYPY_WPISOW.join(", ")}`,
      "nieznany_typ",
    );
  }

  if (akcja === "usun") {
    return { typ, id, akcja, opis: usun(db, typ, id) };
  }

  // Sesja nie ma czego poprawiać poza notatką; udawanie, że ma, tylko myliłoby.
  // Wyniki poprawia się seria po serii — one mają własne identyfikatory.
  if (typ === "sesja") {
    throw new BladDomeny(
      "Treningu nie da się poprawić w całości — popraw pojedyncze serie (typ='seria') " +
        "albo usuń cały trening (akcja='usun').",
      "sesji_nie_poprawiamy",
    );
  }

  const dane = zadanie.dane ?? {};
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const opis =
    typ === "posilek"
      ? poprawPosilek(db, id, dane as ZmianyPosilku, strefa)
      : typ === "seria"
        ? poprawSerie(db, id, dane as ZmianySerii)
        : typ === "aktywnosc"
          ? poprawAktywnosc(db, id, dane as ZmianyAktywnosci, strefa)
          : typ === "notatka"
            ? poprawNotatke(db, id, dane as ZmianyNotatki, strefa)
            : poprawWage(db, id, dane as ZmianyWagi);

  return { typ, id, akcja, opis };
}
