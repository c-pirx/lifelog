/**
 * Dieta: zapis posiłków, cele i podsumowanie doby.
 *
 * Suma z nagłówka posiłku jest źródłem prawdy dla podsumowań — także wtedy,
 * gdy posiłek ma rozbicie na pozycje. Dzięki temu posiłek podyktowany jednym
 * zdaniem i posiłek zeskanowany po składnikach liczą się identycznie.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import {
  dataLokalna,
  dzisiaj,
  godzinaLokalna,
  przesunDate,
  terazUtc,
  STREFA_DOMYSLNA,
} from "../lib/time.js";
import {
  MAKRO_ZERO,
  dodajMakro,
  odejmijMakro,
  type Cele,
  type Makro,
  type NowyPosilek,
  type PodsumowanieDnia,
  type Pora,
  type Posilek,
  type PozycjaPosilku,
} from "./typy.js";

export type Opcje = { strefa?: string };

/**
 * Pora dnia wnioskowana z godziny lokalnej. Dyktując posiłek rzadko podaje się
 * porę wprost („zjadłem kurczaka koło drugiej"), więc zgadujemy z zegara.
 */
export function wywnioskujPore(iso: string, strefa: string = STREFA_DOMYSLNA): Pora {
  const godzina = Number(godzinaLokalna(iso, strefa).slice(0, 2));

  if (godzina >= 5 && godzina < 11) return "sniadanie";
  if (godzina >= 11 && godzina < 16) return "obiad";
  if (godzina >= 16 && godzina < 21) return "kolacja";
  return "przekaska";
}

// === CELE ===============================================================

export type NoweCele = Makro & { obowiazuje_od?: string; opis?: string };

export function ustawCele(db: Baza, dane: NoweCele, opcje: Opcje = {}): Cele {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const obowiazujeOd = dane.obowiazuje_od ?? dzisiaj(strefa);

  const id = repo.wstawCele(db, {
    obowiazuje_od: obowiazujeOd,
    kcal: dane.kcal,
    bialko_g: dane.bialko_g,
    wegle_g: dane.wegle_g,
    tluszcz_g: dane.tluszcz_g,
    opis: dane.opis ?? null,
    utworzono: terazUtc(),
  });

  return {
    id,
    obowiazuje_od: obowiazujeOd,
    kcal: dane.kcal,
    bialko_g: dane.bialko_g,
    wegle_g: dane.wegle_g,
    tluszcz_g: dane.tluszcz_g,
    opis: dane.opis ?? null,
  };
}

export function celeNaDzien(db: Baza, data: string): Cele | null {
  return repo.celeNaDzien(db, data) ?? null;
}

// === POSIŁKI ============================================================

export function zapiszPosilek(db: Baza, dane: NowyPosilek, opcje: Opcje = {}): Posilek {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const ts = dane.ts ?? terazUtc();
  const pora = dane.pora ?? wywnioskujPore(ts, strefa);

  const id = db.transaction(() => {
    const posilekId = repo.wstawPosilek(db, {
      ts,
      data_lokalna: dataLokalna(ts, strefa),
      pora,
      opis: dane.opis,
      kcal: dane.kcal,
      bialko_g: dane.bialko_g ?? 0,
      wegle_g: dane.wegle_g ?? 0,
      tluszcz_g: dane.tluszcz_g ?? 0,
      zrodlo: dane.zrodlo ?? "czat",
      pewnosc: dane.pewnosc ?? "szacowane",
      surowe_wejscie: dane.surowe_wejscie ?? null,
      utworzono: terazUtc(),
    });

    repo.wstawPozycje(
      db,
      posilekId,
      (dane.pozycje ?? []).map((p) => ({
        nazwa: p.nazwa,
        ilosc_g: p.ilosc_g ?? null,
        kcal: p.kcal ?? null,
        bialko_g: p.bialko_g ?? null,
        wegle_g: p.wegle_g ?? null,
        tluszcz_g: p.tluszcz_g ?? null,
      })),
    );

    return posilekId;
  })();

  const zapisany = pobierzPosilek(db, id, opcje);
  if (!zapisany) throw new Error(`Nie udało się odczytać zapisanego posiłku o id ${id}`);
  return zapisany;
}

export function pobierzPosilek(db: Baza, id: number, opcje: Opcje = {}): Posilek | null {
  const wiersz = repo.posilekPoId(db, id);
  if (!wiersz) return null;
  return zbudujPosilek(wiersz, repo.pozycjeDlaPosilkow(db, [id]), opcje.strefa ?? STREFA_DOMYSLNA);
}

function zbudujPosilek(
  wiersz: repo.WierszPosilku,
  pozycje: repo.WierszPozycji[],
  strefa: string,
): Posilek {
  return {
    id: wiersz.id,
    ts: wiersz.ts,
    data_lokalna: wiersz.data_lokalna,
    godzina: godzinaLokalna(wiersz.ts, strefa),
    pora: wiersz.pora,
    opis: wiersz.opis,
    kcal: wiersz.kcal,
    bialko_g: wiersz.bialko_g,
    wegle_g: wiersz.wegle_g,
    tluszcz_g: wiersz.tluszcz_g,
    zrodlo: wiersz.zrodlo,
    pewnosc: wiersz.pewnosc,
    surowe_wejscie: wiersz.surowe_wejscie,
    pozycje: pozycje
      .filter((p) => p.posilek_id === wiersz.id)
      .map(
        ({ posilek_id: _pomijamy, ...reszta }): PozycjaPosilku => reszta,
      ),
  };
}

export function posilkiZDnia(db: Baza, data: string, opcje: Opcje = {}): Posilek[] {
  const wiersze = repo.posilkiZDnia(db, data);
  const pozycje = repo.pozycjeDlaPosilkow(
    db,
    wiersze.map((w) => w.id),
  );
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  return wiersze.map((w) => zbudujPosilek(w, pozycje, strefa));
}

function zsumujMakro(posilki: Posilek[]): Makro {
  return posilki.reduce<Makro>((suma, p) => dodajMakro(suma, p), MAKRO_ZERO);
}

export type SumaDnia = Makro & { data: string; cel_kcal: number | null };

/**
 * Sumy dzienne za okres — do wykresów. Zwraca tylko dni z jakimkolwiek
 * posiłkiem; puste dni nie są zmyślane, żeby wykres nie sugerował głodówki
 * tam, gdzie po prostu nic nie zapisano.
 */
export function sumyDzienne(db: Baza, od: string, doDaty: string): SumaDnia[] {
  return repo.sumyDzienne(db, od, doDaty).map((w) => ({
    data: w.data_lokalna,
    kcal: w.kcal,
    bialko_g: w.bialko_g,
    wegle_g: w.wegle_g,
    tluszcz_g: w.tluszcz_g,
    cel_kcal: repo.celeNaDzien(db, w.data_lokalna)?.kcal ?? null,
  }));
}

export type CzestyPosilek = Makro & {
  opis: string;
  /** Ile razy zapisany w badanym okresie. */
  ile: number;
};

/**
 * Powtarzalne posiłki do podpowiedzi w aplikacji.
 *
 * Stuknięcie w podpowiedź ma wypełnić formularz, a nie zapisać wpis od razu —
 * ta sama kanapka bywa raz większa, raz mniejsza, a cicha zgoda na stare makro
 * fałszowałaby bilans. Stąd zwracamy wartości do potwierdzenia, nie gotowy zapis.
 */
export function czestePosilki(
  db: Baza,
  opcje: Opcje & { dni?: number; limit?: number; do?: string } = {},
): CzestyPosilek[] {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const dni = opcje.dni ?? 30;
  // Data odniesienia jako parametr — inaczej testy zaczęłyby padać po upływie
  // okna, bez żadnej zmiany w kodzie. Ta sama pułapka co przy trendWagi.
  const od = przesunDate(opcje.do ?? dzisiaj(strefa), -(dni - 1));

  return repo.czestePosilki(db, od, opcje.limit ?? 8).map((w) => ({
    opis: w.opis,
    ile: w.ile,
    kcal: w.kcal,
    bialko_g: w.bialko_g,
    wegle_g: w.wegle_g,
    tluszcz_g: w.tluszcz_g,
  }));
}

export type DzienHistorii = {
  data: string;
  /** Suma nagłówków posiłków — ta sama zasada co w podsumowaniu dnia. */
  spozyte: Makro;
  /** Cel obowiązujący TEGO dnia — cele historyczne, nie dzisiejsze. */
  cel_kcal: number | null;
  ile_szacowanych: number;
  ile_niepewnych: number;
  posilki: Posilek[];
};

export type HistoriaDiety = { od: string; do: string; dni: DzienHistorii[] };

/**
 * Historia posiłków do zakładki Dieta: ostatnie dni z sumami i kompletem
 * posiłków (z pozycjami), najnowszy dzień pierwszy.
 *
 * Dni bez posiłków są pomijane — jak w `sumyDzienne`, żeby lista nie
 * sugerowała głodówki tam, gdzie nic nie zapisano. Zwracane `od` jest
 * kursorem paginacji: „pokaż starsze" woła ponownie z `przed = od`.
 */
export function historiaDiety(
  db: Baza,
  opcje: Opcje & { dni?: number; przed?: string } = {},
): HistoriaDiety {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const dni = opcje.dni ?? 14;
  const koniec = opcje.przed ? przesunDate(opcje.przed, -1) : dzisiaj(strefa);
  const od = przesunDate(koniec, -(dni - 1));

  const wiersze = repo.posilkiZZakresu(db, od, koniec);
  const pozycje = repo.pozycjeDlaPosilkow(
    db,
    wiersze.map((w) => w.id),
  );

  const poDniu = new Map<string, Posilek[]>();
  for (const w of wiersze) {
    const posilek = zbudujPosilek(w, pozycje, strefa);
    const lista = poDniu.get(w.data_lokalna);
    if (lista) lista.push(posilek);
    else poDniu.set(w.data_lokalna, [posilek]);
  }

  return {
    od,
    do: koniec,
    dni: [...poDniu.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([data, posilkiDnia]) => ({
        data,
        spozyte: zsumujMakro(posilkiDnia),
        cel_kcal: repo.celeNaDzien(db, data)?.kcal ?? null,
        ile_szacowanych: posilkiDnia.filter((p) => p.pewnosc !== "dokladne").length,
        ile_niepewnych: posilkiDnia.filter((p) => p.pewnosc === "niepewne").length,
        posilki: posilkiDnia,
      })),
  };
}

export function podsumowanieDnia(db: Baza, data?: string, opcje: Opcje = {}): PodsumowanieDnia {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const dzien = data ?? dzisiaj(strefa);

  const posilki = posilkiZDnia(db, dzien, opcje);
  const spozyte = zsumujMakro(posilki);
  const cele = celeNaDzien(db, dzien);

  return {
    data: dzien,
    cele,
    spozyte,
    pozostalo: cele ? odejmijMakro(cele, spozyte) : null,
    procent_kcal: cele && cele.kcal > 0 ? Math.round((spozyte.kcal / cele.kcal) * 100) : null,
    posilki,
    ile_szacowanych: posilki.filter((p) => p.pewnosc !== "dokladne").length,
    ile_niepewnych: posilki.filter((p) => p.pewnosc === "niepewne").length,
  };
}
