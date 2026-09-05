/**
 * Cały SQL rejestru użytkowników — siostra `repo.ts`, ta sama zasada:
 * wymiana bazy to przepisanie jednego pliku, funkcje celowo „głupie".
 *
 * Rejestr to osobna baza (rejestr.db) obok dzienników per użytkownik.
 * W kolumnach nigdy nie ma jawnego hasła ani jawnego tokenu konektora —
 * wyłącznie hasze; pilnuje tego test w `test/konta.test.ts`.
 */

import type { Baza } from "./index.js";

export type WierszUzytkownika = {
  id: number;
  login: string;
  hasz_hasla: string;
  sol: string;
  token_hasz: string;
  strefa: string;
  zgoda_ts: string;
  utworzono: string;
  ostatnie_uzycie_konektora: string | null;
  aktywny: number;
  /** Włączone rodzaje powiadomień po przecinku; pusto = wyłączone. */
  powiadomienia: string;
};

export type NowyUzytkownik = {
  login: string;
  hasz_hasla: string;
  sol: string;
  token_hasz: string;
  strefa: string;
  zgoda_ts: string;
  utworzono: string;
};

export function wstawUzytkownika(db: Baza, dane: NowyUzytkownik): number {
  const wynik = db
    .prepare(
      `INSERT INTO uzytkownicy (login, hasz_hasla, sol, token_hasz, strefa, zgoda_ts, utworzono)
       VALUES (@login, @hasz_hasla, @sol, @token_hasz, @strefa, @zgoda_ts, @utworzono)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function uzytkownikPoLoginie(db: Baza, login: string): WierszUzytkownika | undefined {
  return db
    .prepare<[string], WierszUzytkownika>("SELECT * FROM uzytkownicy WHERE login = ?")
    .get(login);
}

export function uzytkownikPoId(db: Baza, id: number): WierszUzytkownika | undefined {
  return db.prepare<[number], WierszUzytkownika>("SELECT * FROM uzytkownicy WHERE id = ?").get(id);
}

export function uzytkownikPoTokenHasz(db: Baza, tokenHasz: string): WierszUzytkownika | undefined {
  return db
    .prepare<[string], WierszUzytkownika>("SELECT * FROM uzytkownicy WHERE token_hasz = ?")
    .get(tokenHasz);
}

export function zapiszHaslo(db: Baza, id: number, haszHasla: string, sol: string): void {
  db.prepare("UPDATE uzytkownicy SET hasz_hasla = ?, sol = ? WHERE id = ?").run(
    haszHasla,
    sol,
    id,
  );
}

export function zapiszTokenHasz(db: Baza, id: number, tokenHasz: string): void {
  db.prepare("UPDATE uzytkownicy SET token_hasz = ? WHERE id = ?").run(tokenHasz, id);
}

export function wszyscyAktywni(db: Baza): WierszUzytkownika[] {
  return db
    .prepare<[], WierszUzytkownika>("SELECT * FROM uzytkownicy WHERE aktywny = 1 ORDER BY id")
    .all();
}

export function odnotujUzycieKonektora(db: Baza, id: number, ts: string): void {
  db.prepare("UPDATE uzytkownicy SET ostatnie_uzycie_konektora = ? WHERE id = ?").run(ts, id);
}

/**
 * Atomowe złożenie kilku zapisów. Istnieje po to, żeby domena mogła zażądać
 * transakcji, nie znając `better-sqlite3` — rejestracja z kodu zaproszenia
 * musi utworzyć konto i zgasić kod w jednym kroku albo w żadnym.
 */
export function wTransakcji<T>(db: Baza, dzialanie: () => T): T {
  return db.transaction(dzialanie)();
}

// === Powiadomienia push ==================================================

export type WierszSubskrypcji = {
  id: number;
  uzytkownik_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  utworzono: string;
};

/**
 * UPSERT po `endpoint`, nie zwykły INSERT.
 *
 * Dwa zwyczajne przypadki dawałyby inaczej błąd zamiast zapisu: przeglądarka
 * rotuje klucze zachowując adres oraz jeden telefon obsługuje dwa konta.
 * Ten drugi jest ważniejszy — bez przepięcia `uzytkownik_id` powiadomienia
 * jednego domownika szłyby na urządzenie zalogowane teraz na drugie konto.
 */
export function zapiszSubskrypcje(db: Baza, dane: Omit<WierszSubskrypcji, "id">): void {
  db.prepare(
    `INSERT INTO subskrypcje_push (uzytkownik_id, endpoint, p256dh, auth, utworzono)
     VALUES (@uzytkownik_id, @endpoint, @p256dh, @auth, @utworzono)
     ON CONFLICT (endpoint) DO UPDATE SET
       uzytkownik_id = excluded.uzytkownik_id,
       p256dh        = excluded.p256dh,
       auth          = excluded.auth`,
  ).run(dane);
}

export function subskrypcjeUzytkownika(db: Baza, uzytkownikId: number): WierszSubskrypcji[] {
  return db
    .prepare<[number], WierszSubskrypcji>(
      "SELECT * FROM subskrypcje_push WHERE uzytkownik_id = ? ORDER BY id",
    )
    .all(uzytkownikId);
}

/** Kasujemy po odpowiedzi 404/410 — przeglądarka wyrzuciła subskrypcję. */
export function usunSubskrypcje(db: Baza, id: number): void {
  db.prepare("DELETE FROM subskrypcje_push WHERE id = ?").run(id);
}

export function zapiszPowiadomienia(db: Baza, uzytkownikId: number, zapis: string): void {
  db.prepare("UPDATE uzytkownicy SET powiadomienia = ? WHERE id = ?").run(zapis, uzytkownikId);
}

/**
 * Znak wysyłki stawiany PRZED wysłaniem; `false` znaczy „już dziś poszło".
 *
 * Kolejność jest tu całą regułą. Przy niedostępnym push service oznaczanie po
 * udanej wysyłce dawałoby ponawianie co pięć minut aż do północy — a zgubione
 * powiadomienie jest kłopotem, powódź powiadomień awarią.
 */
export function oznaczWyslane(
  db: Baza,
  dane: { uzytkownik_id: number; data_lokalna: string; rodzaj: string; wyslano: string },
): boolean {
  const wynik = db
    .prepare(
      `INSERT OR IGNORE INTO wyslane_powiadomienia (uzytkownik_id, data_lokalna, rodzaj, wyslano)
       VALUES (@uzytkownik_id, @data_lokalna, @rodzaj, @wyslano)`,
    )
    .run(dane);
  return wynik.changes === 1;
}

export function wyslaneDzis(db: Baza, uzytkownikId: number, dataLokalna: string): string[] {
  return db
    .prepare<[number, string], { rodzaj: string }>(
      "SELECT rodzaj FROM wyslane_powiadomienia WHERE uzytkownik_id = ? AND data_lokalna = ?",
    )
    .all(uzytkownikId, dataLokalna)
    .map((w) => w.rodzaj);
}

// === Lista oczekujących ==================================================

export type WierszListy = {
  id: number;
  email: string;
  imie: string | null;
  zapisano: string;
  zgoda_ts: string;
  stan: string;
  zaproszono: string | null;
  wykorzystano: string | null;
  uzytkownik_id: number | null;
  kod_hasz: string | null;
  kod_wygasa: string | null;
};

export type NowyWpisListy = {
  email: string;
  imie: string | null;
  zapisano: string;
  zgoda_ts: string;
};

export function wstawNaListe(db: Baza, dane: NowyWpisListy): number {
  const wynik = db
    .prepare(
      `INSERT INTO lista_oczekujacych (email, imie, zapisano, zgoda_ts)
       VALUES (@email, @imie, @zapisano, @zgoda_ts)`,
    )
    .run(dane);
  return Number(wynik.lastInsertRowid);
}

export function wpisListyPoEmailu(db: Baza, email: string): WierszListy | undefined {
  return db
    .prepare<[string], WierszListy>("SELECT * FROM lista_oczekujacych WHERE email = ?")
    .get(email);
}

export function wpisListyPoKodHasz(db: Baza, kodHasz: string): WierszListy | undefined {
  return db
    .prepare<[string], WierszListy>("SELECT * FROM lista_oczekujacych WHERE kod_hasz = ?")
    .get(kodHasz);
}

export function wszystkieWpisyListy(db: Baza): WierszListy[] {
  return db
    .prepare<[], WierszListy>("SELECT * FROM lista_oczekujacych ORDER BY zapisano, id")
    .all();
}

export function policzWpisyListy(db: Baza): number {
  return (
    db.prepare<[], { ile: number }>("SELECT COUNT(*) AS ile FROM lista_oczekujacych").get()?.ile ?? 0
  );
}

export function zapiszKodZaproszenia(
  db: Baza,
  id: number,
  kodHasz: string,
  kodWygasa: string,
  zaproszono: string,
): void {
  db.prepare(
    `UPDATE lista_oczekujacych
        SET kod_hasz = ?, kod_wygasa = ?, zaproszono = ?, stan = 'zaproszony'
      WHERE id = ?`,
  ).run(kodHasz, kodWygasa, zaproszono, id);
}

/**
 * Zamknięcie zaproszenia: konto powstało, kod gaśnie. Zerowanie `kod_hasz`
 * musi zajść w tej samej transakcji co utworzenie konta — inaczej dwa
 * równoległe żądania założyłyby dwa konta z jednego zaproszenia.
 */
export function oznaczWykorzystanie(
  db: Baza,
  id: number,
  uzytkownikId: number,
  kiedy: string,
): void {
  db.prepare(
    `UPDATE lista_oczekujacych
        SET stan = 'zarejestrowany', uzytkownik_id = ?, wykorzystano = ?,
            kod_hasz = NULL, kod_wygasa = NULL
      WHERE id = ?`,
  ).run(uzytkownikId, kiedy, id);
}

/**
 * Wypis kasuje wiersz, a nie ustawia flagę. Prawo do bycia zapomnianym jest
 * wtedy dosłowne, a ktoś, kto zmieni zdanie, zapisuje się po prostu na nowo.
 */
export function usunWpisListy(db: Baza, id: number): void {
  db.prepare("DELETE FROM lista_oczekujacych WHERE id = ?").run(id);
}
