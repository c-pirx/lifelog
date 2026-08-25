/**
 * Treningi: plan, sesje, serie i stan trwającego treningu.
 *
 * Stan sesji żyje w bazie, nie w rozmowie — dlatego Claude i aplikacja webowa
 * zawsze widzą to samo, niezależnie od tego, przez które wejście przyszła seria.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import { dataLokalna, dzienTygodnia, terazUtc, STREFA_DOMYSLNA } from "../lib/time.js";
import { BladDomeny } from "./bledy.js";
import type {
  Cwiczenie,
  CwiczenieWDniu,
  DzienPlanu,
  NowaSeria,
  PostepCwiczenia,
  Seria,
  Sesja,
  StanTreningu,
  TypCwiczenia,
} from "./typy.js";

export type Opcje = { strefa?: string; ts?: string };

// === ĆWICZENIA ==========================================================

/** Zwraca ćwiczenie o podanej nazwie, tworząc je, jeśli jeszcze nie istnieje. */
export function zapewnijCwiczenie(
  db: Baza,
  nazwa: string,
  typ: TypCwiczenia = "silowe",
  partia: string | null = null,
): Cwiczenie {
  const przycieta = nazwa.trim();
  if (przycieta === "") throw new BladDomeny("Nazwa ćwiczenia nie może być pusta", "pusta_nazwa");

  const istniejace = repo.cwiczeniePoNazwie(db, przycieta);
  if (istniejace) return istniejace;

  const id = repo.wstawCwiczenie(db, przycieta, typ, partia);
  return { id, nazwa: przycieta, typ, partia };
}

function znajdzCwiczenie(db: Baza, nazwa: string): Cwiczenie {
  const cwiczenie = repo.cwiczeniePoNazwie(db, nazwa.trim());
  if (!cwiczenie) {
    throw new BladDomeny(`Nie znaleziono ćwiczenia o nazwie "${nazwa}"`, "nieznane_cwiczenie");
  }
  return cwiczenie;
}

// === PLAN ===============================================================

export type NoweCwiczenieWPlanie = {
  nazwa: string;
  typ?: TypCwiczenia;
  partia?: string;
  serie_cel?: number;
  powt_cel?: string;
  czas_cel_s?: number;
  dystans_cel_m?: number;
};

export type NowyDzienPlanu = {
  kod: string;
  nazwa: string;
  dzien_tygodnia?: number | null;
  cwiczenia: NoweCwiczenieWPlanie[];
};

/**
 * Zapisuje dzień planu. Ponowne wywołanie z tym samym kodem nadpisuje dzień
 * w całości — plan jest dyktowany Claude'owi i łatwiej podać go od nowa,
 * niż opisywać różnicę.
 */
export function dodajDzienPlanu(db: Baza, dane: NowyDzienPlanu): DzienPlanu {
  const kod = dane.kod.trim();
  if (kod === "") throw new BladDomeny("Kod dnia planu nie może być pusty", "pusty_kod");

  const dzienTyg = dane.dzien_tygodnia ?? null;
  if (dzienTyg !== null && (dzienTyg < 1 || dzienTyg > 7)) {
    throw new BladDomeny(
      `Dzień tygodnia musi być w zakresie 1–7 (1 = poniedziałek), otrzymano: ${dzienTyg}`,
      "zly_dzien_tygodnia",
    );
  }

  const id = db.transaction(() => {
    const istniejacy = repo.dzienPlanuPoKodzie(db, kod);

    const dzienId = istniejacy
      ? (repo.aktualizujDzienPlanu(db, istniejacy.id, {
          kod,
          nazwa: dane.nazwa,
          dzien_tygodnia: dzienTyg,
        }),
        istniejacy.id)
      : repo.wstawDzienPlanu(db, kod, dane.nazwa, dzienTyg);

    repo.usunCwiczeniaWDniu(db, dzienId);

    dane.cwiczenia.forEach((c, indeks) => {
      const cwiczenie = zapewnijCwiczenie(db, c.nazwa, c.typ ?? "silowe", c.partia ?? null);
      repo.wstawCwiczenieWDniu(db, {
        dzien_id: dzienId,
        cwiczenie_id: cwiczenie.id,
        kolejnosc: indeks + 1,
        serie_cel: c.serie_cel ?? null,
        powt_cel: c.powt_cel ?? null,
        czas_cel_s: c.czas_cel_s ?? null,
        dystans_cel_m: c.dystans_cel_m ?? null,
      });
    });

    return dzienId;
  })();

  const zapisany = dzienPlanuPoId(db, id);
  if (!zapisany) throw new Error(`Nie udało się odczytać zapisanego dnia planu o id ${id}`);
  return zapisany;
}

function zbudujDzien(wiersz: repo.WierszDniaPlanu, cwiczenia: repo.WierszCwiczeniaWDniu[]): DzienPlanu {
  return {
    id: wiersz.id,
    kod: wiersz.kod,
    nazwa: wiersz.nazwa,
    dzien_tygodnia: wiersz.dzien_tygodnia,
    aktywny: wiersz.aktywny === 1,
    cwiczenia: cwiczenia.map(
      ({ dzien_id: _pomijamy, ...reszta }): CwiczenieWDniu => reszta,
    ),
  };
}

function dzienPlanuPoId(db: Baza, id: number): DzienPlanu | null {
  const wiersz = repo.dzienPlanuPoId(db, id);
  if (!wiersz) return null;
  return zbudujDzien(wiersz, repo.cwiczeniaWDniu(db, id));
}

export function dzienPlanu(db: Baza, kod: string): DzienPlanu | null {
  const wiersz = repo.dzienPlanuPoKodzie(db, kod);
  if (!wiersz) return null;
  return zbudujDzien(wiersz, repo.cwiczeniaWDniu(db, wiersz.id));
}

export function planTreningowy(db: Baza): DzienPlanu[] {
  return repo.dniPlanu(db).map((w) => zbudujDzien(w, repo.cwiczeniaWDniu(db, w.id)));
}

export function usunDzienPlanu(db: Baza, kod: string): boolean {
  const wiersz = repo.dzienPlanuPoKodzie(db, kod);
  if (!wiersz) return false;
  return repo.usunDzienPlanu(db, wiersz.id) > 0;
}

// === SESJE ==============================================================

function zbudujSesje(wiersz: repo.WierszSesji): Sesja {
  return wiersz;
}

export function aktywnaSesja(db: Baza): Sesja | null {
  const wiersz = repo.aktywnaSesja(db);
  return wiersz ? zbudujSesje(wiersz) : null;
}

export type OpcjeStartu = Opcje & {
  kod?: string;
  /**
   * Sesja bez dnia planu — świadomie, a nie z braku kodu. Samo pominięcie
   * `kod` sięga do harmonogramu, więc w poniedziałek otworzyłoby dzień A
   * zamiast pustego treningu.
   */
  bez_planu?: boolean;
};

export function rozpocznijTrening(db: Baza, opcje: OpcjeStartu = {}): Sesja {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const ts = opcje.ts ?? terazUtc();

  const otwarta = repo.aktywnaSesja(db);
  if (otwarta) {
    throw new BladDomeny(
      `Masz już aktywną sesję rozpoczętą ${otwarta.data_lokalna}` +
        `${otwarta.dzien_kod ? ` (dzień ${otwarta.dzien_kod})` : ""}. ` +
        "Zakończ ją, zanim zaczniesz nową.",
      "sesja_juz_aktywna",
    );
  }

  // Jawnie wskazany dzień ma pierwszeństwo; harmonogram jest tylko podpowiedzią,
  // a bez_planu bije jedno i drugie.
  const dzien = opcje.bez_planu
    ? undefined
    : opcje.kod
      ? (repo.dzienPlanuPoKodzie(db, opcje.kod) ??
        (() => {
          throw new BladDomeny(
            `Nie znaleziono dnia planu o kodzie "${opcje.kod}"`,
            "nieznany_dzien",
          );
        })())
      : repo.dzienPlanuNaDzienTygodnia(db, dzienTygodnia(ts, strefa));

  const id = repo.wstawSesje(db, {
    dzien_id: dzien?.id ?? null,
    start_ts: ts,
    data_lokalna: dataLokalna(ts, strefa),
  });

  const sesja = repo.sesjaPoId(db, id);
  if (!sesja) throw new Error(`Nie udało się odczytać rozpoczętej sesji o id ${id}`);
  return zbudujSesje(sesja);
}

export type OpcjeKonca = Opcje & { notatki?: string; status?: "zakonczona" | "porzucona" };

export function zakonczTrening(db: Baza, opcje: OpcjeKonca = {}): Sesja {
  const otwarta = repo.aktywnaSesja(db);
  if (!otwarta) {
    throw new BladDomeny("Nie ma otwartej sesji treningowej do zakończenia", "brak_sesji");
  }

  repo.zamknijSesje(
    db,
    otwarta.id,
    opcje.status ?? "zakonczona",
    opcje.ts ?? terazUtc(),
    opcje.notatki ?? null,
  );

  const zamknieta = repo.sesjaPoId(db, otwarta.id);
  if (!zamknieta) throw new Error(`Nie udało się odczytać zamkniętej sesji o id ${otwarta.id}`);
  return zbudujSesje(zamknieta);
}

// === SERIE ==============================================================

function sprawdzPolaSerii(typ: TypCwiczenia, dane: NowaSeria, nazwa: string): void {
  if (typ === "silowe" && (dane.powtorzenia == null || dane.powtorzenia <= 0)) {
    throw new BladDomeny(
      `Ćwiczenie "${nazwa}" jest siłowe — podaj liczbę powtórzeń`,
      "brak_powtorzen",
    );
  }

  if (typ === "cardio" && dane.czas_s == null && dane.dystans_m == null) {
    throw new BladDomeny(
      `Ćwiczenie "${nazwa}" to cardio — podaj czas lub dystans`,
      "brak_czasu_i_dystansu",
    );
  }

  if (typ === "na_czas" && dane.czas_s == null) {
    throw new BladDomeny(`Ćwiczenie "${nazwa}" jest na czas — podaj czas w sekundach`, "brak_czasu");
  }
}

export function zapiszSerie(db: Baza, dane: NowaSeria, opcje: Opcje = {}): Seria {
  const sesja = repo.aktywnaSesja(db);
  if (!sesja) {
    throw new BladDomeny(
      "Nie ma otwartej sesji treningowej — zacznij trening przed zapisaniem serii",
      "brak_sesji",
    );
  }

  const cwiczenie = zapewnijCwiczenie(db, dane.cwiczenie, dane.typ ?? "silowe");
  sprawdzPolaSerii(cwiczenie.typ, dane, cwiczenie.nazwa);

  // Pola nienależące do typu ćwiczenia zostają puste, żeby historia się nie mieszała.
  const silowe = cwiczenie.typ === "silowe";
  const id = repo.wstawSerie(db, {
    sesja_id: sesja.id,
    cwiczenie_id: cwiczenie.id,
    nr_serii: dane.nr_serii ?? repo.ileSerii(db, sesja.id, cwiczenie.id) + 1,
    powtorzenia: silowe ? (dane.powtorzenia ?? null) : null,
    ciezar_kg: silowe ? (dane.ciezar_kg ?? null) : null,
    czas_s: silowe ? null : (dane.czas_s ?? null),
    dystans_m: cwiczenie.typ === "cardio" ? (dane.dystans_m ?? null) : null,
    rpe: dane.rpe ?? null,
    ts: dane.ts ?? opcje.ts ?? terazUtc(),
  });

  const seria = repo.seriaPoId(db, id);
  if (!seria) throw new Error(`Nie udało się odczytać zapisanej serii o id ${id}`);
  return seria;
}

// === STAN TRENINGU ======================================================

/**
 * Czy seria wypadła słabiej niż najlepsza seria z poprzedniego razu.
 * Świadomie prosta reguła — system pokazuje fakty, decyzję o progresji
 * podejmuje użytkownik.
 */
function czySlabsza(seria: Seria, poprzednie: Seria[], typ: TypCwiczenia): boolean {
  if (poprzednie.length === 0) return false;

  const maks = (wartosci: (number | null)[]): number =>
    wartosci.reduce<number>((n, w) => Math.max(n, w ?? 0), 0);

  if (typ === "silowe") {
    const najwiekszyCiezar = maks(poprzednie.map((s) => s.ciezar_kg));
    const ciezar = seria.ciezar_kg ?? 0;

    if (ciezar < najwiekszyCiezar) return true;
    if (ciezar > najwiekszyCiezar) return false;

    // Ten sam ciężar — rozstrzyga liczba powtórzeń.
    const najwiecejPowtorzen = maks(
      poprzednie.filter((s) => (s.ciezar_kg ?? 0) === najwiekszyCiezar).map((s) => s.powtorzenia),
    );
    return (seria.powtorzenia ?? 0) < najwiecejPowtorzen;
  }

  if (typ === "cardio") {
    const najdalej = maks(poprzednie.map((s) => s.dystans_m));
    if (najdalej > 0) return (seria.dystans_m ?? 0) < najdalej;
  }

  return (seria.czas_s ?? 0) < maks(poprzednie.map((s) => s.czas_s));
}

function zbudujPostep(
  db: Baza,
  cwiczenie: { id: number; nazwa: string; typ: TypCwiczenia },
  cel: { serie_cel: number | null; powt_cel: string | null },
  serieSesji: Seria[],
  sesjaId: number,
): PostepCwiczenia {
  const serie = serieSesji.filter((s) => s.cwiczenie_id === cwiczenie.id);
  const poprzednio = repo.serieZPoprzedniegoRazu(db, cwiczenie.id, sesjaId);

  return {
    cwiczenie_id: cwiczenie.id,
    nazwa: cwiczenie.nazwa,
    typ: cwiczenie.typ,
    serie_cel: cel.serie_cel,
    powt_cel: cel.powt_cel,
    serie_zrobione: serie.length,
    serie,
    poprzednio,
    slabsze_niz_poprzednio: serie
      .filter((s) => czySlabsza(s, poprzednio, cwiczenie.typ))
      .map((s) => s.nr_serii),
    ukonczone: cel.serie_cel ? serie.length >= cel.serie_cel : serie.length > 0,
  };
}

const PUSTY_STAN: StanTreningu = {
  sesja: null,
  wg_planu: [],
  poza_planem: [],
  ukonczone_cwiczen: 0,
  wszystkich_cwiczen: 0,
  pozostalo: [],
};

export function stanTreningu(db: Baza): StanTreningu {
  const wiersz = repo.aktywnaSesja(db);
  if (!wiersz) return PUSTY_STAN;

  const sesja = zbudujSesje(wiersz);
  const serie = repo.serieSesji(db, sesja.id);
  const plan = sesja.dzien_id ? repo.cwiczeniaWDniu(db, sesja.dzien_id) : [];

  const wgPlanu = plan.map((c) =>
    zbudujPostep(
      db,
      { id: c.cwiczenie_id, nazwa: c.nazwa, typ: c.typ },
      { serie_cel: c.serie_cel, powt_cel: c.powt_cel },
      serie,
      sesja.id,
    ),
  );

  const wPlanie = new Set(plan.map((c) => c.cwiczenie_id));
  const dodatkowe = new Map<number, Seria>();
  for (const s of serie) {
    if (!wPlanie.has(s.cwiczenie_id) && !dodatkowe.has(s.cwiczenie_id)) {
      dodatkowe.set(s.cwiczenie_id, s);
    }
  }

  const pozaPlanem = [...dodatkowe.values()].map((s) =>
    zbudujPostep(
      db,
      { id: s.cwiczenie_id, nazwa: s.nazwa, typ: s.typ },
      { serie_cel: null, powt_cel: null },
      serie,
      sesja.id,
    ),
  );

  return {
    sesja,
    wg_planu: wgPlanu,
    poza_planem: pozaPlanem,
    ukonczone_cwiczen: wgPlanu.filter((c) => c.ukonczone).length,
    wszystkich_cwiczen: wgPlanu.length,
    pozostalo: wgPlanu.filter((c) => !c.ukonczone).map((c) => c.nazwa),
  };
}

// === HISTORIA ===========================================================

export type HistoriaCwiczenia = {
  nazwa: string;
  typ: TypCwiczenia;
  serie: Seria[];
  sesje: { data: string; serie: Seria[] }[];
  rekord_ciezar: number | null;
  rekord_powtorzenia: number | null;
};

export function historiaCwiczenia(db: Baza, nazwa: string, limitSesji = 10): HistoriaCwiczenia {
  const cwiczenie = znajdzCwiczenie(db, nazwa);
  const wiersze = repo.historiaCwiczenia(db, cwiczenie.id, limitSesji);

  const wgSesji = new Map<string, Seria[]>();
  for (const { data_lokalna, ...seria } of wiersze) {
    const lista = wgSesji.get(data_lokalna) ?? [];
    lista.push(seria);
    wgSesji.set(data_lokalna, lista);
  }

  const ciezary = wiersze.map((w) => w.ciezar_kg).filter((c): c is number => c != null);
  const powtorzenia = wiersze.map((w) => w.powtorzenia).filter((p): p is number => p != null);

  return {
    nazwa: cwiczenie.nazwa,
    typ: cwiczenie.typ,
    serie: wiersze.map(({ data_lokalna: _pomijamy, ...seria }) => seria),
    sesje: [...wgSesji.entries()].map(([data, serie]) => ({ data, serie })),
    rekord_ciezar: ciezary.length > 0 ? Math.max(...ciezary) : null,
    rekord_powtorzenia: powtorzenia.length > 0 ? Math.max(...powtorzenia) : null,
  };
}
