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
