/**
 * Pomiary ciała.
 *
 * Waga dzienna waha się o kilogram z powodu wody i glikogenu, więc obok
 * surowego pomiaru liczymy średnią kroczącą z 7 dni — dopiero ona pokazuje,
 * czy przyjęty deficyt lub nadwyżka faktycznie działa.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import { dataLokalna, dzisiaj, przesunDate, terazUtc, STREFA_DOMYSLNA } from "../lib/time.js";
import { BladDomeny } from "./bledy.js";
import type { PunktTrendu, Waga } from "./typy.js";

export type Opcje = { strefa?: string };

export function zapiszWage(
  db: Baza,
  kg: number,
  opcje: Opcje & { ts?: string; notatka?: string } = {},
): Waga {
  if (!Number.isFinite(kg) || kg <= 0 || kg > 500) {
    throw new BladDomeny(`Waga poza sensownym zakresem: ${kg} kg`, "zla_waga");
  }

  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const ts = opcje.ts ?? terazUtc();
  const data = dataLokalna(ts, strefa);

  repo.zapiszWage(db, { ts, data_lokalna: data, kg, notatka: opcje.notatka ?? null });

  const zapisana = repo.wagaZZakresu(db, data, data)[0];
  if (!zapisana) throw new Error(`Nie udało się odczytać zapisanej wagi z ${data}`);
  return zapisana;
}

export function ostatniaWaga(db: Baza): Waga | null {
  return repo.ostatniaWaga(db) ?? null;
}

const OKNO_SREDNIEJ_DNI = 7;

/**
 * Trend wagi za `dni` dni wstecz od `do` (domyślnie od dzisiaj). Zwraca tylko
 * dni z pomiarem — brakujące nie są zmyślane, ale średnia krocząca patrzy na
 * okno kalendarzowe, więc pojedyncze przerwy jej nie psują.
 */
export function trendWagi(
  db: Baza,
  dni = 90,
  opcje: Opcje & { do?: string } = {},
): PunktTrendu[] {
  const koniec = opcje.do ?? dzisiaj(opcje.strefa ?? STREFA_DOMYSLNA);
  const od = przesunDate(koniec, -(dni - 1));
  const pomiary = repo.wagaZZakresu(db, od, koniec);

  return pomiary.map((pomiar) => {
    const poczatekOkna = przesunDate(pomiar.data_lokalna, -(OKNO_SREDNIEJ_DNI - 1));
    const wOknie = pomiary.filter(
      (p) => p.data_lokalna >= poczatekOkna && p.data_lokalna <= pomiar.data_lokalna,
    );
    const suma = wOknie.reduce((s, p) => s + p.kg, 0);

    return {
      data: pomiar.data_lokalna,
      kg: pomiar.kg,
      srednia_7d: Math.round((suma / wOknie.length) * 100) / 100,
    };
  });
}
