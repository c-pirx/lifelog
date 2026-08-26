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
import { BladDomeny } from "./bledy.js";
import { PEWNOSCI, PORY, type NowaPozycja, type Pewnosc, type Pora } from "./typy.js";

export type TypWpisu = "posilek" | "seria" | "waga";
export type AkcjaWpisu = "popraw" | "usun";

export const TYPY_WPISOW: readonly TypWpisu[] = ["posilek", "seria", "waga"];

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

export type ZadanieZmiany = {
  typ: TypWpisu;
  id: number;
  akcja: AkcjaWpisu;
  dane?: ZmianyPosilku | ZmianySerii | ZmianyWagi;
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

const POLA_MAKRO = ["kcal", "bialko_g", "wegle_g", "tluszcz_g"] as const;

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

  // Parsowanie czasu względem dnia WPISU, nie dzisiaj — goła godzina puszczona
  // przez parsujCzas przeniosłaby wczorajszy obiad na dzisiejszą dobę.
  if (dane.czas !== undefined) {
    if (typeof dane.czas !== "string") {
      throw new BladDomeny(`Nie rozpoznano formatu czasu: "${String(dane.czas)}"`, "zly_czas");
    }
    const godzina = /^(\d{1,2}):(\d{2})$/.exec(dane.czas.trim());
    try {
      const ts = godzina
        ? parsujCzas(`${istniejacy.data_lokalna} ${godzina[1]!.padStart(2, "0")}:${godzina[2]}`, strefa)
        : parsujCzas(dane.czas, strefa);
      zmiany.ts = ts;
      zmiany.data_lokalna = dataLokalna(ts, strefa);
    } catch {
      throw new BladDomeny(`Nie rozpoznano formatu czasu: "${dane.czas}"`, "zly_czas");
    }
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

  const dane = zadanie.dane ?? {};
  const opis =
    typ === "posilek"
      ? poprawPosilek(db, id, dane as ZmianyPosilku, opcje.strefa ?? STREFA_DOMYSLNA)
      : typ === "seria"
        ? poprawSerie(db, id, dane as ZmianySerii)
        : poprawWage(db, id, dane as ZmianyWagi);

  return { typ, id, akcja, opis };
}
