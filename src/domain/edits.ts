/**
 * Poprawianie i usuwanie wpisów.
 *
 * Jedna implementacja obsługuje oba wejścia: czat („popraw ten obiad na 800 kcal")
 * i aplikację webową (przycisk edycji przy pozycji). Gdyby każde wejście miało
 * własną, prędzej czy później zaczęłyby się różnić.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import { BladDomeny } from "./bledy.js";
import { PORY, type Pewnosc, type Pora } from "./typy.js";

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

function poprawPosilek(db: Baza, id: number, dane: ZmianyPosilku): string {
  const istniejacy = repo.posilekPoId(db, id);
  if (!istniejacy) brakWpisu("posilek", id);

  if (dane.pora !== undefined && !PORY.includes(dane.pora)) {
    throw new BladDomeny(`Nieznana pora posiłku: "${dane.pora}"`, "zla_pora");
  }

  const zmiany = tylkoPodane(dane, [
    "opis",
    "kcal",
    "bialko_g",
    "wegle_g",
    "tluszcz_g",
    "pora",
    "pewnosc",
  ]);

  if (Object.keys(zmiany).length === 0) {
    throw new BladDomeny("Nie podano żadnych zmian", "brak_zmian");
  }

  repo.aktualizujPosilek(db, id, zmiany);
  return `Poprawiono posiłek „${istniejacy.opis}"`;
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

export function zmienWpis(db: Baza, zadanie: ZadanieZmiany): WynikZmiany {
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
      ? poprawPosilek(db, id, dane as ZmianyPosilku)
      : typ === "seria"
        ? poprawSerie(db, id, dane as ZmianySerii)
        : poprawWage(db, id, dane as ZmianyWagi);

  return { typ, id, akcja, opis };
}
