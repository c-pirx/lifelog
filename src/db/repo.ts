/**
 * Jedyne miejsce w projekcie, w którym występuje SQL.
 *
 * Warstwa domenowa woła wyłącznie te funkcje. Dzięki temu przejście z SQLite
 * na Postgres jest przepisaniem tego pliku, a nie przebudową aplikacji.
 * Funkcje są celowo „głupie": żadnej logiki biznesowej, same odczyty i zapisy.
 */

import type { Baza } from "./index.js";
import type {
  KategoriaNotatki,
  Pewnosc,
  Pora,
  StatusSesji,
  TrybCelu,
  TypCwiczenia,
  ZrodloWpisu,
} from "../domain/typy.js";

// === Surowe kształty wierszy =============================================

export type WierszCele = {
  id: number;
  obowiazuje_od: string;
  kcal: number;
  bialko_g: number;
  wegle_g: number;
  tluszcz_g: number;
  opis: string | null;
  tryb: TrybCelu;
};

export type WierszPosilku = {
  id: number;
  ts: string;
  data_lokalna: string;
  pora: Pora;
  opis: string;
  kcal: number;
  bialko_g: number;
  wegle_g: number;
  tluszcz_g: number;
  zrodlo: ZrodloWpisu;
  pewnosc: Pewnosc;
  surowe_wejscie: string | null;
};

export type WierszPozycji = {
  id: number;
  posilek_id: number;
  nazwa: string;
  ilosc_g: number | null;
  kcal: number | null;
  bialko_g: number | null;
  wegle_g: number | null;
  tluszcz_g: number | null;
};

export type WierszCwiczenia = {
  id: number;
  nazwa: string;
  typ: TypCwiczenia;
  partia: string | null;
};

export type WierszDniaPlanu = {
  id: number;
  plan_id: number;
  kod: string;
  nazwa: string;
  dzien_tygodnia: number | null;
  aktywny: number;
};

export type WierszPlanu = {
  id: number;
  nazwa: string;
  opis: string | null;
  domyslny: number;
};

export type WierszCwiczeniaWDniu = {
  id: number;
  dzien_id: number;
  cwiczenie_id: number;
  nazwa: string;
  typ: TypCwiczenia;
  kolejnosc: number;
  serie_cel: number | null;
  powt_cel: string | null;
  czas_cel_s: number | null;
  dystans_cel_m: number | null;
  ciezar_cel_kg: number | null;
};

export type WierszSesji = {
  id: number;
  dzien_id: number | null;
  dzien_kod: string | null;
  dzien_nazwa: string | null;
  start_ts: string;
  data_lokalna: string;
  koniec_ts: string | null;
  status: StatusSesji;
  notatki: string | null;
};

export type WierszSerii = {
  id: number;
  sesja_id: number;
  cwiczenie_id: number;
  nazwa: string;
  typ: TypCwiczenia;
  nr_serii: number;
  powtorzenia: number | null;
  ciezar_kg: number | null;
  czas_s: number | null;
  dystans_m: number | null;
  rpe: number | null;
  ts: string;
};

export type WierszWagi = {
  id: number;
  ts: string;
  data_lokalna: string;
  kg: number;
  notatka: string | null;
};

export type WierszAktywnosci = {
  id: number;
  ts: string;
  data_lokalna: string;
  dyscyplina: string;
  dystans_m: number | null;
  czas_s: number | null;
  rpe: number | null;
  notatka: string | null;
  zrodlo: "czat" | "apka";
};

export type WierszNotatki = {
  id: number;
  ts: string;
  data_lokalna: string;
  kategoria: KategoriaNotatki;
  tytul: string | null;
  tresc: string;
  surowe_wejscie: string | null;
  zrodlo: "czat" | "apka";
};

// === CELE ===============================================================

export function wstawCele(
  db: Baza,
  dane: Omit<WierszCele, "id"> & { utworzono: string },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO cele (obowiazuje_od, kcal, bialko_g, wegle_g, tluszcz_g, opis, tryb, utworzono)
       VALUES (@obowiazuje_od, @kcal, @bialko_g, @wegle_g, @tluszcz_g, @opis, @tryb, @utworzono)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

/** Cele obowiązujące danego dnia, czyli najnowsze wprowadzone nie później niż tego dnia. */
export function celeNaDzien(db: Baza, data: string): WierszCele | undefined {
  return db
    .prepare<[string], WierszCele>(
      `SELECT id, obowiazuje_od, kcal, bialko_g, wegle_g, tluszcz_g, opis, tryb
       FROM cele
       WHERE obowiazuje_od <= ?
       ORDER BY obowiazuje_od DESC, id DESC
       LIMIT 1`,
    )
    .get(data);
}

// === POSIŁKI ============================================================

export function wstawPosilek(
  db: Baza,
  dane: Omit<WierszPosilku, "id"> & { utworzono: string },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                            zrodlo, pewnosc, surowe_wejscie, utworzono)
       VALUES (@ts, @data_lokalna, @pora, @opis, @kcal, @bialko_g, @wegle_g, @tluszcz_g,
               @zrodlo, @pewnosc, @surowe_wejscie, @utworzono)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function wstawPozycje(
  db: Baza,
  posilekId: number,
  pozycje: Omit<WierszPozycji, "id" | "posilek_id">[],
): void {
  if (pozycje.length === 0) return;

  const zapytanie = db.prepare(
    `INSERT INTO pozycje_posilku (posilek_id, nazwa, ilosc_g, kcal, bialko_g, wegle_g, tluszcz_g)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const p of pozycje) {
    zapytanie.run(posilekId, p.nazwa, p.ilosc_g, p.kcal, p.bialko_g, p.wegle_g, p.tluszcz_g);
  }
}

/** Zastępuje całe rozbicie posiłku nową listą. Pusta lista czyści rozbicie. */
export function zastapPozycje(
  db: Baza,
  posilekId: number,
  pozycje: Omit<WierszPozycji, "id" | "posilek_id">[],
): void {
  db.prepare("DELETE FROM pozycje_posilku WHERE posilek_id = ?").run(posilekId);
  wstawPozycje(db, posilekId, pozycje);
}

const KOLUMNY_POSILKU = `id, ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                         zrodlo, pewnosc, surowe_wejscie`;

export function posilkiZDnia(db: Baza, data: string): WierszPosilku[] {
  return db
    .prepare<[string], WierszPosilku>(
      `SELECT ${KOLUMNY_POSILKU} FROM posilki WHERE data_lokalna = ? ORDER BY ts, id`,
    )
    .all(data);
}

export function posilkiZZakresu(db: Baza, od: string, doDaty: string): WierszPosilku[] {
  return db
    .prepare<[string, string], WierszPosilku>(
      `SELECT ${KOLUMNY_POSILKU} FROM posilki
       WHERE data_lokalna BETWEEN ? AND ? ORDER BY ts, id`,
    )
    .all(od, doDaty);
}

export type WierszCzestegoPosilku = {
  opis: string;
  ile: number;
  ostatnio: string;
  kcal: number;
  bialko_g: number;
  wegle_g: number;
  tluszcz_g: number;
};

/**
 * Najczęściej powtarzane posiłki z ostatnich dni — do podpowiedzi w aplikacji.
 *
 * Makro pochodzą z NAJNOWSZEGO wystąpienia, nie ze średniej: gdy porcja się
 * zmieniła, świeższa wartość jest bliższa prawdy niż uśredniona historia.
 * Kolumny bez agregatu obok MAX() zwraca w SQLite ten wiersz, który dał
 * maksimum — zachowanie udokumentowane i celowo tu wykorzystane.
 */
export function czestePosilki(db: Baza, od: string, limit: number): WierszCzestegoPosilku[] {
  return db
    .prepare<[string, number], WierszCzestegoPosilku>(
      `SELECT opis, COUNT(*) AS ile, MAX(ts) AS ostatnio,
              kcal, bialko_g, wegle_g, tluszcz_g
       FROM posilki
       WHERE data_lokalna >= ?
       GROUP BY opis
       ORDER BY ile DESC, ostatnio DESC
       LIMIT ?`,
    )
    .all(od, limit);
}

/** Sumy dzienne liczone w bazie — do wykresów za dłuższy okres. */
export function sumyDzienne(
  db: Baza,
  od: string,
  doDaty: string,
): { data_lokalna: string; kcal: number; bialko_g: number; wegle_g: number; tluszcz_g: number }[] {
  return db
    .prepare<[string, string], { data_lokalna: string; kcal: number; bialko_g: number; wegle_g: number; tluszcz_g: number }>(
      `SELECT data_lokalna,
              SUM(kcal) AS kcal, SUM(bialko_g) AS bialko_g,
              SUM(wegle_g) AS wegle_g, SUM(tluszcz_g) AS tluszcz_g
       FROM posilki
       WHERE data_lokalna BETWEEN ? AND ?
       GROUP BY data_lokalna
       ORDER BY data_lokalna`,
    )
    .all(od, doDaty);
}

export function posilekPoId(db: Baza, id: number): WierszPosilku | undefined {
  return db
    .prepare<[number], WierszPosilku>(`SELECT ${KOLUMNY_POSILKU} FROM posilki WHERE id = ?`)
    .get(id);
}

export function pozycjeDlaPosilkow(db: Baza, ids: number[]): WierszPozycji[] {
  if (ids.length === 0) return [];
  const znaki = ids.map(() => "?").join(", ");
  return db
    .prepare<number[], WierszPozycji>(
      `SELECT id, posilek_id, nazwa, ilosc_g, kcal, bialko_g, wegle_g, tluszcz_g
       FROM pozycje_posilku WHERE posilek_id IN (${znaki}) ORDER BY id`,
    )
    .all(...ids);
}

/** Aktualizuje wskazane kolumny posiłku. Zwraca liczbę zmienionych wierszy. */
export function aktualizujPosilek(
  db: Baza,
  id: number,
  pola: Partial<Omit<WierszPosilku, "id">>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;

  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db
    .prepare(`UPDATE posilki SET ${przypisania} WHERE id = @id`)
    .run({ ...pola, id }).changes;
}

export function usunPosilek(db: Baza, id: number): number {
  return db.prepare("DELETE FROM posilki WHERE id = ?").run(id).changes;
}

// === ĆWICZENIA ==========================================================

export function cwiczeniePoNazwie(db: Baza, nazwa: string): WierszCwiczenia | undefined {
  return db
    .prepare<[string], WierszCwiczenia>(
      "SELECT id, nazwa, typ, partia FROM cwiczenia WHERE nazwa = ? COLLATE NOCASE",
    )
    .get(nazwa);
}

export function cwiczeniePoId(db: Baza, id: number): WierszCwiczenia | undefined {
  return db
    .prepare<[number], WierszCwiczenia>("SELECT id, nazwa, typ, partia FROM cwiczenia WHERE id = ?")
    .get(id);
}

export function wstawCwiczenie(
  db: Baza,
  nazwa: string,
  typ: TypCwiczenia,
  partia: string | null,
): number {
  const wynik = db
    .prepare("INSERT INTO cwiczenia (nazwa, typ, partia) VALUES (?, ?, ?)")
    .run(nazwa, typ, partia);
  return Number(wynik.lastInsertRowid);
}

export function wszystkieCwiczenia(db: Baza): WierszCwiczenia[] {
  return db
    .prepare<[], WierszCwiczenia>("SELECT id, nazwa, typ, partia FROM cwiczenia ORDER BY nazwa")
    .all();
}

// === PLAN TRENINGOWY ====================================================

const KOLUMNY_PLANU = "id, nazwa, opis, domyslny";

/** Plan domyślny zawsze pierwszy — to on rządzi harmonogramem i zakładką. */
export function plany(db: Baza): WierszPlanu[] {
  return db
    .prepare<[], WierszPlanu>(`SELECT ${KOLUMNY_PLANU} FROM plany ORDER BY domyslny DESC, id`)
    .all();
}

export function planPoId(db: Baza, id: number): WierszPlanu | undefined {
  return db.prepare<[number], WierszPlanu>(`SELECT ${KOLUMNY_PLANU} FROM plany WHERE id = ?`).get(id);
}

export function planPoNazwie(db: Baza, nazwa: string): WierszPlanu | undefined {
  return db
    .prepare<[string], WierszPlanu>(
      `SELECT ${KOLUMNY_PLANU} FROM plany WHERE nazwa = ? COLLATE NOCASE`,
    )
    .get(nazwa);
}

export function planDomyslny(db: Baza): WierszPlanu | undefined {
  return db.prepare<[], WierszPlanu>(`SELECT ${KOLUMNY_PLANU} FROM plany WHERE domyslny = 1`).get();
}

export function wstawPlan(db: Baza, nazwa: string, opis: string | null, domyslny: boolean): number {
  const wynik = db
    .prepare("INSERT INTO plany (nazwa, opis, domyslny) VALUES (?, ?, ?)")
    .run(nazwa, opis, domyslny ? 1 : 0);
  return Number(wynik.lastInsertRowid);
}

export function aktualizujPlan(
  db: Baza,
  id: number,
  pola: Partial<{ nazwa: string; opis: string | null; domyslny: number }>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;
  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db.prepare(`UPDATE plany SET ${przypisania} WHERE id = @id`).run({ ...pola, id }).changes;
}

/** Zdejmuje flagę ze wszystkich planów. Wołane w transakcji razem z założeniem nowej. */
export function wyczyscDomyslny(db: Baza): number {
  return db.prepare("UPDATE plany SET domyslny = 0 WHERE domyslny = 1").run().changes;
}

const KOLUMNY_DNIA = "id, plan_id, kod, nazwa, dzien_tygodnia, aktywny";

/** Bez `planId` — dni ze wszystkich planów; zakładka Trening potrzebuje kompletu. */
export function dniPlanu(db: Baza, planId?: number): WierszDniaPlanu[] {
  const warunek = planId === undefined ? "" : "WHERE plan_id = @planId";
  return db
    .prepare<{ planId?: number }, WierszDniaPlanu>(
      `SELECT ${KOLUMNY_DNIA} FROM dni_planu ${warunek}
       ORDER BY dzien_tygodnia IS NULL, dzien_tygodnia, kod`,
    )
    .all({ planId });
}

export function dzienPlanuPoKodzie(
  db: Baza,
  kod: string,
  planId: number,
): WierszDniaPlanu | undefined {
  return db
    .prepare<[string, number], WierszDniaPlanu>(
      `SELECT ${KOLUMNY_DNIA} FROM dni_planu WHERE kod = ? COLLATE NOCASE AND plan_id = ?`,
    )
    .get(kod, planId);
}

export function dzienPlanuPoId(db: Baza, id: number): WierszDniaPlanu | undefined {
  return db
    .prepare<[number], WierszDniaPlanu>(`SELECT ${KOLUMNY_DNIA} FROM dni_planu WHERE id = ?`)
    .get(id);
}

/**
 * Harmonogram czyta wyłącznie plan domyślny. Bez tego zawężenia szablon
 * z ustawionym dniem tygodnia potrafiłby przejąć poniedziałek.
 */
export function dzienPlanuNaDzienTygodnia(
  db: Baza,
  dzien: number,
  planId: number,
): WierszDniaPlanu | undefined {
  return db
    .prepare<[number, number], WierszDniaPlanu>(
      `SELECT ${KOLUMNY_DNIA} FROM dni_planu
       WHERE dzien_tygodnia = ? AND plan_id = ? AND aktywny = 1`,
    )
    .get(dzien, planId);
}

export function wstawDzienPlanu(
  db: Baza,
  planId: number,
  kod: string,
  nazwa: string,
  dzienTygodnia: number | null,
): number {
  const wynik = db
    .prepare("INSERT INTO dni_planu (plan_id, kod, nazwa, dzien_tygodnia) VALUES (?, ?, ?, ?)")
    .run(planId, kod, nazwa, dzienTygodnia);
  return Number(wynik.lastInsertRowid);
}

/**
 * Gasi dni planu spoza podanej listy kodów zamiast je kasować — usunięcie
 * wywróciłoby się na kluczu obcym, gdy dzień ma za sobą rozegrane sesje.
 */
export function wygasDniPozaLista(db: Baza, planId: number, kody: string[]): number {
  const puste = kody.map(() => "?").join(", ") || "NULL";
  return db
    .prepare(
      `UPDATE dni_planu SET aktywny = 0
       WHERE plan_id = ? AND kod COLLATE NOCASE NOT IN (${puste})`,
    )
    .run(planId, ...kody).changes;
}

export function aktualizujDzienPlanu(
  db: Baza,
  id: number,
  pola: Partial<{ kod: string; nazwa: string; dzien_tygodnia: number | null; aktywny: number }>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;
  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db.prepare(`UPDATE dni_planu SET ${przypisania} WHERE id = @id`).run({ ...pola, id }).changes;
}

export function usunDzienPlanu(db: Baza, id: number): number {
  return db.prepare("DELETE FROM dni_planu WHERE id = ?").run(id).changes;
}

export function cwiczeniaWDniu(db: Baza, dzienId: number): WierszCwiczeniaWDniu[] {
  return db
    .prepare<[number], WierszCwiczeniaWDniu>(
      `SELECT cwd.id, cwd.dzien_id, cwd.cwiczenie_id, c.nazwa, c.typ, cwd.kolejnosc,
              cwd.serie_cel, cwd.powt_cel, cwd.czas_cel_s, cwd.dystans_cel_m, cwd.ciezar_cel_kg
       FROM cwiczenia_w_dniu cwd
       JOIN cwiczenia c ON c.id = cwd.cwiczenie_id
       WHERE cwd.dzien_id = ?
       ORDER BY cwd.kolejnosc`,
    )
    .all(dzienId);
}

export function wstawCwiczenieWDniu(
  db: Baza,
  dane: {
    dzien_id: number;
    cwiczenie_id: number;
    kolejnosc: number;
    serie_cel: number | null;
    powt_cel: string | null;
    czas_cel_s: number | null;
    dystans_cel_m: number | null;
    ciezar_cel_kg: number | null;
  },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO cwiczenia_w_dniu
         (dzien_id, cwiczenie_id, kolejnosc, serie_cel, powt_cel, czas_cel_s, dystans_cel_m,
          ciezar_cel_kg)
       VALUES (@dzien_id, @cwiczenie_id, @kolejnosc, @serie_cel, @powt_cel, @czas_cel_s,
               @dystans_cel_m, @ciezar_cel_kg)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function usunCwiczeniaWDniu(db: Baza, dzienId: number): number {
  return db.prepare("DELETE FROM cwiczenia_w_dniu WHERE dzien_id = ?").run(dzienId).changes;
}

// === SESJE ==============================================================

const KOLUMNY_SESJI = `s.id, s.dzien_id, d.kod AS dzien_kod, d.nazwa AS dzien_nazwa,
                       s.start_ts, s.data_lokalna, s.koniec_ts, s.status, s.notatki`;

export function aktywnaSesja(db: Baza): WierszSesji | undefined {
  return db
    .prepare<[], WierszSesji>(
      `SELECT ${KOLUMNY_SESJI} FROM sesje s LEFT JOIN dni_planu d ON d.id = s.dzien_id
       WHERE s.status = 'aktywna'`,
    )
    .get();
}

export function sesjaPoId(db: Baza, id: number): WierszSesji | undefined {
  return db
    .prepare<[number], WierszSesji>(
      `SELECT ${KOLUMNY_SESJI} FROM sesje s LEFT JOIN dni_planu d ON d.id = s.dzien_id
       WHERE s.id = ?`,
    )
    .get(id);
}

export function wstawSesje(
  db: Baza,
  dane: { dzien_id: number | null; start_ts: string; data_lokalna: string },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO sesje (dzien_id, start_ts, data_lokalna, status)
       VALUES (@dzien_id, @start_ts, @data_lokalna, 'aktywna')`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function zamknijSesje(
  db: Baza,
  id: number,
  status: StatusSesji,
  koniecTs: string,
  notatki: string | null,
): number {
  return db
    .prepare("UPDATE sesje SET status = ?, koniec_ts = ?, notatki = ? WHERE id = ?")
    .run(status, koniecTs, notatki, id).changes;
}

/** Zakończone sesje z zakresu, najnowsza pierwsza — materiał na historię ruchu. */
export function sesjeZZakresu(db: Baza, od: string, doDaty: string): WierszSesji[] {
  return db
    .prepare<[string, string], WierszSesji>(
      `SELECT ${KOLUMNY_SESJI} FROM sesje s LEFT JOIN dni_planu d ON d.id = s.dzien_id
       WHERE s.status = 'zakonczona' AND s.data_lokalna BETWEEN ? AND ?
       ORDER BY s.data_lokalna DESC, s.start_ts`,
    )
    .all(od, doDaty);
}

export function usunSesje(db: Baza, id: number): number {
  // Serie znikają kaskadą ze schematu — patrz `serie.sesja_id … ON DELETE CASCADE`.
  return db.prepare("DELETE FROM sesje WHERE id = ?").run(id).changes;
}

export function ostatnieSesje(db: Baza, limit: number): WierszSesji[] {
  return db
    .prepare<[number], WierszSesji>(
      `SELECT ${KOLUMNY_SESJI} FROM sesje s LEFT JOIN dni_planu d ON d.id = s.dzien_id
       WHERE s.status = 'zakonczona' ORDER BY s.start_ts DESC LIMIT ?`,
    )
    .all(limit);
}

// === SERIE ==============================================================

const KOLUMNY_SERII = `se.id, se.sesja_id, se.cwiczenie_id, c.nazwa, c.typ, se.nr_serii,
                       se.powtorzenia, se.ciezar_kg, se.czas_s, se.dystans_m, se.rpe, se.ts`;

export function wstawSerie(
  db: Baza,
  dane: {
    sesja_id: number;
    cwiczenie_id: number;
    nr_serii: number;
    powtorzenia: number | null;
    ciezar_kg: number | null;
    czas_s: number | null;
    dystans_m: number | null;
    rpe: number | null;
    ts: string;
  },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO serie (sesja_id, cwiczenie_id, nr_serii, powtorzenia, ciezar_kg,
                          czas_s, dystans_m, rpe, ts)
       VALUES (@sesja_id, @cwiczenie_id, @nr_serii, @powtorzenia, @ciezar_kg,
               @czas_s, @dystans_m, @rpe, @ts)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function serieSesji(db: Baza, sesjaId: number): WierszSerii[] {
  return db
    .prepare<[number], WierszSerii>(
      `SELECT ${KOLUMNY_SERII} FROM serie se JOIN cwiczenia c ON c.id = se.cwiczenie_id
       WHERE se.sesja_id = ? ORDER BY se.ts, se.id`,
    )
    .all(sesjaId);
}

/**
 * Serie wielu sesji naraz. Historia ruchu czyta dwa tygodnie sesji na jednym
 * ekranie — pytanie per sesja dałoby kilkanaście zapytań zamiast jednego.
 */
export function serieDlaSesji(db: Baza, ids: number[]): WierszSerii[] {
  if (ids.length === 0) return [];
  const znaki = ids.map(() => "?").join(", ");
  return db
    .prepare<number[], WierszSerii>(
      `SELECT ${KOLUMNY_SERII} FROM serie se JOIN cwiczenia c ON c.id = se.cwiczenie_id
       WHERE se.sesja_id IN (${znaki}) ORDER BY se.ts, se.id`,
    )
    .all(...ids);
}

export function ileSerii(db: Baza, sesjaId: number, cwiczenieId: number): number {
  return (
    db
      .prepare<[number, number], { ile: number }>(
        "SELECT COUNT(*) AS ile FROM serie WHERE sesja_id = ? AND cwiczenie_id = ?",
      )
      .get(sesjaId, cwiczenieId)?.ile ?? 0
  );
}

/**
 * Serie danego ćwiczenia z ostatniej zakończonej sesji, w której się pojawiło.
 * Używane do pokazywania „co robiłeś poprzednio" przy każdym ćwiczeniu.
 */
export function serieZPoprzedniegoRazu(
  db: Baza,
  cwiczenieId: number,
  pomijajacSesje: number | null,
): WierszSerii[] {
  const poprzedniaSesja = db
    .prepare<[number, number], { sesja_id: number }>(
      `SELECT se.sesja_id
       FROM serie se
       JOIN sesje s ON s.id = se.sesja_id
       WHERE se.cwiczenie_id = ? AND s.status = 'zakonczona' AND se.sesja_id != ?
       ORDER BY s.start_ts DESC
       LIMIT 1`,
    )
    .get(cwiczenieId, pomijajacSesje ?? -1);

  if (!poprzedniaSesja) return [];

  return db
    .prepare<[number, number], WierszSerii>(
      `SELECT ${KOLUMNY_SERII} FROM serie se JOIN cwiczenia c ON c.id = se.cwiczenie_id
       WHERE se.sesja_id = ? AND se.cwiczenie_id = ? ORDER BY se.nr_serii`,
    )
    .all(poprzedniaSesja.sesja_id, cwiczenieId);
}

/**
 * Wszystkie serie ćwiczenia z zakończonych sesji poza wskazaną.
 *
 * Rekord liczy się właśnie z nich, a nie z bieżącej sesji: inaczej pierwsza
 * dzisiejsza seria sama ustanawiałaby rekord, a każda następna już tylko
 * go wyrównywała — oznaczenie traciłoby sens w dniu, w którym ma działać.
 */
export function serieCwiczeniaPrzedSesja(
  db: Baza,
  cwiczenieId: number,
  pomijajacSesje: number | null,
): WierszSerii[] {
  return db
    .prepare<[number, number], WierszSerii>(
      `SELECT ${KOLUMNY_SERII} FROM serie se
       JOIN cwiczenia c ON c.id = se.cwiczenie_id
       JOIN sesje s ON s.id = se.sesja_id
       WHERE se.cwiczenie_id = ? AND s.status = 'zakonczona' AND se.sesja_id != ?
       ORDER BY se.ts, se.id`,
    )
    .all(cwiczenieId, pomijajacSesje ?? -1);
}

/** Serie ćwiczenia z ostatnich `limitSesji` sesji, od najnowszej. */
export function historiaCwiczenia(
  db: Baza,
  cwiczenieId: number,
  limitSesji: number,
): (WierszSerii & { data_lokalna: string })[] {
  const sesje = db
    .prepare<[number, number], { id: number }>(
      `SELECT s.id
       FROM sesje s
       WHERE EXISTS (SELECT 1 FROM serie WHERE sesja_id = s.id AND cwiczenie_id = ?)
       ORDER BY s.start_ts DESC
       LIMIT ?`,
    )
    .all(cwiczenieId, limitSesji);

  if (sesje.length === 0) return [];

  const idSesji = sesje.map((s) => s.id);
  const znaki = idSesji.map(() => "?").join(", ");

  return db
    .prepare<number[], WierszSerii & { data_lokalna: string }>(
      `SELECT ${KOLUMNY_SERII}, s.data_lokalna
       FROM serie se
       JOIN cwiczenia c ON c.id = se.cwiczenie_id
       JOIN sesje s ON s.id = se.sesja_id
       WHERE se.cwiczenie_id = ? AND se.sesja_id IN (${znaki})
       ORDER BY s.start_ts DESC, se.nr_serii`,
    )
    .all(cwiczenieId, ...idSesji);
}

export function seriaPoId(db: Baza, id: number): WierszSerii | undefined {
  return db
    .prepare<[number], WierszSerii>(
      `SELECT ${KOLUMNY_SERII} FROM serie se JOIN cwiczenia c ON c.id = se.cwiczenie_id
       WHERE se.id = ?`,
    )
    .get(id);
}

export function aktualizujSerie(
  db: Baza,
  id: number,
  pola: Partial<{
    powtorzenia: number | null;
    ciezar_kg: number | null;
    czas_s: number | null;
    dystans_m: number | null;
    rpe: number | null;
  }>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;
  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db.prepare(`UPDATE serie SET ${przypisania} WHERE id = @id`).run({ ...pola, id }).changes;
}

export function usunSerie(db: Baza, id: number): number {
  return db.prepare("DELETE FROM serie WHERE id = ?").run(id).changes;
}

// === WAGA ===============================================================

/** Zapis wagi nadpisuje wcześniejszy pomiar z tego samego dnia. */
export function zapiszWage(
  db: Baza,
  dane: { ts: string; data_lokalna: string; kg: number; notatka: string | null },
): void {
  db.prepare(
    `INSERT INTO waga_ciala (ts, data_lokalna, kg, notatka)
     VALUES (@ts, @data_lokalna, @kg, @notatka)
     ON CONFLICT (data_lokalna) DO UPDATE
       SET ts = excluded.ts, kg = excluded.kg, notatka = excluded.notatka`,
  ).run(dane);
}

export function wagaZZakresu(db: Baza, od: string, doDaty: string): WierszWagi[] {
  return db
    .prepare<[string, string], WierszWagi>(
      `SELECT id, ts, data_lokalna, kg, notatka FROM waga_ciala
       WHERE data_lokalna BETWEEN ? AND ? ORDER BY data_lokalna`,
    )
    .all(od, doDaty);
}

export function ostatniaWaga(db: Baza): WierszWagi | undefined {
  return db
    .prepare<[], WierszWagi>(
      `SELECT id, ts, data_lokalna, kg, notatka FROM waga_ciala
       ORDER BY data_lokalna DESC LIMIT 1`,
    )
    .get();
}

export function wagaPoId(db: Baza, id: number): WierszWagi | undefined {
  return db
    .prepare<[number], WierszWagi>(
      "SELECT id, ts, data_lokalna, kg, notatka FROM waga_ciala WHERE id = ?",
    )
    .get(id);
}

export function aktualizujWage(
  db: Baza,
  id: number,
  pola: Partial<{ kg: number; notatka: string | null }>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;
  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db.prepare(`UPDATE waga_ciala SET ${przypisania} WHERE id = @id`).run({ ...pola, id })
    .changes;
}

export function usunWage(db: Baza, id: number): number {
  return db.prepare("DELETE FROM waga_ciala WHERE id = ?").run(id).changes;
}

// === AKTYWNOŚCI =========================================================

const KOLUMNY_AKTYWNOSCI = `id, ts, data_lokalna, dyscyplina, dystans_m, czas_s, rpe, notatka, zrodlo`;

export function wstawAktywnosc(
  db: Baza,
  dane: {
    ts: string;
    data_lokalna: string;
    dyscyplina: string;
    dystans_m: number | null;
    czas_s: number | null;
    rpe: number | null;
    notatka: string | null;
    zrodlo: "czat" | "apka";
    utworzono: string;
  },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO aktywnosci (ts, data_lokalna, dyscyplina, dystans_m, czas_s, rpe, notatka, zrodlo, utworzono)
       VALUES (@ts, @data_lokalna, @dyscyplina, @dystans_m, @czas_s, @rpe, @notatka, @zrodlo, @utworzono)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function aktywnosciZDnia(db: Baza, data: string): WierszAktywnosci[] {
  return db
    .prepare<[string], WierszAktywnosci>(
      `SELECT ${KOLUMNY_AKTYWNOSCI} FROM aktywnosci WHERE data_lokalna = ? ORDER BY ts`,
    )
    .all(data);
}

export function aktywnosciZZakresu(db: Baza, od: string, doDaty: string): WierszAktywnosci[] {
  return db
    .prepare<[string, string], WierszAktywnosci>(
      `SELECT ${KOLUMNY_AKTYWNOSCI} FROM aktywnosci
       WHERE data_lokalna BETWEEN ? AND ? ORDER BY data_lokalna DESC, ts`,
    )
    .all(od, doDaty);
}

export function aktywnoscPoId(db: Baza, id: number): WierszAktywnosci | undefined {
  return db
    .prepare<[number], WierszAktywnosci>(
      `SELECT ${KOLUMNY_AKTYWNOSCI} FROM aktywnosci WHERE id = ?`,
    )
    .get(id);
}

export function aktualizujAktywnosc(
  db: Baza,
  id: number,
  pola: Partial<Omit<WierszAktywnosci, "id" | "zrodlo">>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;
  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db.prepare(`UPDATE aktywnosci SET ${przypisania} WHERE id = @id`).run({ ...pola, id })
    .changes;
}

export function usunAktywnosc(db: Baza, id: number): number {
  return db.prepare("DELETE FROM aktywnosci WHERE id = ?").run(id).changes;
}

/**
 * Aktywności z zakresu zsumowane per dyscyplina.
 *
 * Grupowanie idzie `COLLATE NOCASE`, tak jak wyszukiwanie ćwiczeń: „Rower"
 * podyktowane Claude'owi i „rower" wpisane w aplikacji to jedna pozycja.
 * Do pokazania wybierana jest pisownia pierwsza alfabetycznie — dowolna, ale
 * ta sama przy każdym odczycie, więc raport nie zmienia się między wejściami.
 */
export function agregatAktywnosci(
  db: Baza,
  od: string,
  doDaty: string,
): { nazwa: string; ile: number; czas_s: number; dystans_m: number }[] {
  return db
    .prepare<[string, string], { nazwa: string; ile: number; czas_s: number; dystans_m: number }>(
      `SELECT MIN(dyscyplina) AS nazwa, COUNT(*) AS ile,
              COALESCE(SUM(czas_s), 0) AS czas_s,
              COALESCE(SUM(dystans_m), 0) AS dystans_m
       FROM aktywnosci
       WHERE data_lokalna BETWEEN ? AND ?
       GROUP BY dyscyplina COLLATE NOCASE
       ORDER BY ile DESC, czas_s DESC, nazwa`,
    )
    .all(od, doDaty);
}

// === NOTATKI ============================================================

const KOLUMNY_NOTATKI = `id, ts, data_lokalna, kategoria, tytul, tresc, surowe_wejscie, zrodlo`;

export function wstawNotatke(
  db: Baza,
  dane: {
    ts: string;
    data_lokalna: string;
    kategoria: KategoriaNotatki;
    tytul: string | null;
    tresc: string;
    surowe_wejscie: string | null;
    zrodlo: "czat" | "apka";
    utworzono: string;
  },
): number {
  const wynik = db
    .prepare(
      `INSERT INTO notatki (ts, data_lokalna, kategoria, tytul, tresc, surowe_wejscie, zrodlo, utworzono)
       VALUES (@ts, @data_lokalna, @kategoria, @tytul, @tresc, @surowe_wejscie, @zrodlo, @utworzono)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

/** Najnowsze notatki jednego folderu. Dziennik czyta się od końca. */
export function notatkiZKategorii(db: Baza, kategoria: string, limit: number): WierszNotatki[] {
  return db
    .prepare<[string, number], WierszNotatki>(
      `SELECT ${KOLUMNY_NOTATKI} FROM notatki
       WHERE kategoria = ? ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .all(kategoria, limit);
}

export function notatkaPoId(db: Baza, id: number): WierszNotatki | undefined {
  return db
    .prepare<[number], WierszNotatki>(`SELECT ${KOLUMNY_NOTATKI} FROM notatki WHERE id = ?`)
    .get(id);
}

export function aktualizujNotatke(
  db: Baza,
  id: number,
  pola: Partial<Omit<WierszNotatki, "id" | "zrodlo" | "surowe_wejscie">>,
): number {
  const klucze = Object.keys(pola);
  if (klucze.length === 0) return 0;
  const przypisania = klucze.map((k) => `${k} = @${k}`).join(", ");
  return db.prepare(`UPDATE notatki SET ${przypisania} WHERE id = @id`).run({ ...pola, id }).changes;
}

export function usunNotatke(db: Baza, id: number): number {
  return db.prepare("DELETE FROM notatki WHERE id = ?").run(id).changes;
}

/**
 * Licznik i data ostatniej notatki per folder.
 *
 * Osobne zapytanie, bo karta folderu ma mówić, ile notatek jest W OGÓLE — nie
 * ile zmieściło się w pobranej porcji. Inaczej „Pokaż starsze" podbijałoby
 * licznik, jakby notatek przybywało.
 */
export function agregatNotatek(db: Baza): { kategoria: string; ile: number; ostatnia: string }[] {
  return db
    .prepare<[], { kategoria: string; ile: number; ostatnia: string }>(
      `SELECT kategoria, COUNT(*) AS ile, MAX(data_lokalna) AS ostatnia
       FROM notatki GROUP BY kategoria`,
    )
    .all();
}

// === RAPORTY TYGODNIOWE =================================================

export type WierszRaportu = {
  id: number;
  tydzien_od: string;
  tydzien_do: string;
  dane: string;
  komentarz: string | null;
  komentarz_ts: string | null;
  utworzono: string;
};

const KOLUMNY_RAPORTU = `id, tydzien_od, tydzien_do, dane, komentarz, komentarz_ts, utworzono`;

/**
 * Zapis raportu jest idempotentny dzięki UNIQUE na `tydzien_od` — ponowne
 * generowanie tego samego tygodnia nie nadpisze migawki ani komentarza.
 */
export function wstawRaport(
  db: Baza,
  dane: { tydzien_od: string; tydzien_do: string; dane: string; utworzono: string },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO raporty_tygodniowe (tydzien_od, tydzien_do, dane, utworzono)
     VALUES (@tydzien_od, @tydzien_do, @dane, @utworzono)`,
  ).run(dane);
}

export function raportPoTygodniu(db: Baza, tydzienOd: string): WierszRaportu | undefined {
  return db
    .prepare<[string], WierszRaportu>(
      `SELECT ${KOLUMNY_RAPORTU} FROM raporty_tygodniowe WHERE tydzien_od = ?`,
    )
    .get(tydzienOd);
}

export function ostatnieRaporty(db: Baza, limit: number): WierszRaportu[] {
  return db
    .prepare<[number], WierszRaportu>(
      `SELECT ${KOLUMNY_RAPORTU} FROM raporty_tygodniowe ORDER BY tydzien_od DESC LIMIT ?`,
    )
    .all(limit);
}

export function tygodnieZRaportem(db: Baza, od: string, doDaty: string): string[] {
  return db
    .prepare<[string, string], { tydzien_od: string }>(
      `SELECT tydzien_od FROM raporty_tygodniowe WHERE tydzien_od BETWEEN ? AND ?`,
    )
    .all(od, doDaty)
    .map((w) => w.tydzien_od);
}

export function ustawKomentarzRaportu(
  db: Baza,
  tydzienOd: string,
  komentarz: string,
  ts: string,
): number {
  return db
    .prepare("UPDATE raporty_tygodniowe SET komentarz = ?, komentarz_ts = ? WHERE tydzien_od = ?")
    .run(komentarz, ts, tydzienOd).changes;
}

/** Najstarszy dzień z jakimkolwiek wpisem — punkt startowy generowania raportów. */
export function najwczesniejszaData(db: Baza): string | undefined {
  return (
    db
      .prepare<[], { data: string | null }>(
        `SELECT MIN(data) AS data FROM (
           SELECT MIN(data_lokalna) AS data FROM posilki
           UNION ALL SELECT MIN(data_lokalna) FROM sesje
           UNION ALL SELECT MIN(data_lokalna) FROM waga_ciala
           UNION ALL SELECT MIN(data_lokalna) FROM aktywnosci
         )`,
      )
      .get()?.data ?? undefined
  );
}

/** Ile wpisów dowolnego rodzaju wpadło w zakres — tygodnie puste pomijamy. */
export function ileWpisow(db: Baza, od: string, doDaty: string): number {
  return (
    db
      .prepare<[string, string, string, string, string, string, string, string], { ile: number }>(
        `SELECT (SELECT COUNT(*) FROM posilki WHERE data_lokalna BETWEEN ? AND ?)
              + (SELECT COUNT(*) FROM sesje WHERE data_lokalna BETWEEN ? AND ?)
              + (SELECT COUNT(*) FROM waga_ciala WHERE data_lokalna BETWEEN ? AND ?)
              + (SELECT COUNT(*) FROM aktywnosci WHERE data_lokalna BETWEEN ? AND ?) AS ile`,
      )
      .get(od, doDaty, od, doDaty, od, doDaty, od, doDaty)?.ile ?? 0
  );
}

export function ileSesjiZakonczonych(db: Baza, od: string, doDaty: string): number {
  return (
    db
      .prepare<[string, string], { ile: number }>(
        `SELECT COUNT(*) AS ile FROM sesje
         WHERE status = 'zakonczona' AND data_lokalna BETWEEN ? AND ?`,
      )
      .get(od, doDaty)?.ile ?? 0
  );
}

/**
 * Serie z zakończonych sesji w zakresie, zsumowane per ćwiczenie.
 *
 * Objętość ma sens wyłącznie dla ćwiczeń siłowych — przy cardio i „na czas"
 * kolumny `ciezar_kg` i `powtorzenia` są puste, więc iloczyn dawałby zero
 * udające wynik. Stąd jawny warunek na typ zamiast cichego COALESCE.
 */
export function agregatSerii(
  db: Baza,
  od: string,
  doDaty: string,
): { nazwa: string; typ: TypCwiczenia; serie: number; objetosc_kg: number }[] {
  return db
    .prepare<[string, string], { nazwa: string; typ: TypCwiczenia; serie: number; objetosc_kg: number }>(
      `SELECT c.nazwa, c.typ, COUNT(*) AS serie,
              COALESCE(SUM(CASE WHEN c.typ = 'silowe'
                                THEN COALESCE(se.ciezar_kg, 0) * COALESCE(se.powtorzenia, 0)
                                ELSE 0 END), 0) AS objetosc_kg
       FROM serie se
       JOIN cwiczenia c ON c.id = se.cwiczenie_id
       JOIN sesje s ON s.id = se.sesja_id
       WHERE s.status = 'zakonczona' AND s.data_lokalna BETWEEN ? AND ?
       GROUP BY c.id
       ORDER BY objetosc_kg DESC, serie DESC, c.nazwa`,
    )
    .all(od, doDaty);
}
