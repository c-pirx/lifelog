/**
 * Konta użytkowników: rejestracja za wspólnym hasłem bramy, logowanie,
 * token konektora, zmiana hasła.
 *
 * Kryptografia w całości z `node:crypto` — tym samym duchem, w którym
 * `auth.ts` używa HMAC zamiast biblioteki od sesji: mniej ruchomych części.
 *
 *  - hasła: scrypt z solą 16 B na użytkownika (parametry domyślne Node,
 *    N=16384 — wystarczające przy logowaniu dławionym przez nginx i minimum
 *    10 znaków hasła);
 *  - token konektora: 32 B losowe, w bazie wyłącznie SHA-256. Jawny token
 *    użytkownik widzi raz — przy rejestracji albo rotacji — i wyciek rejestru
 *    nie daje działających adresów.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { hasloPoprawne } from "../auth.js";
import type { Baza } from "../db/index.js";
import {
  odnotujUzycieKonektora,
  uzytkownikPoId,
  uzytkownikPoLoginie,
  uzytkownikPoTokenHasz,
  wstawUzytkownika,
  zapiszHaslo,
  zapiszTokenHasz,
  type WierszUzytkownika,
} from "../db/rejestr.js";
import { BladDomeny } from "./bledy.js";

const MIN_DLUGOSC_HASLA = 10;
const DOMYSLNA_STREFA = "Europe/Warsaw";

export type Konto = {
  id: number;
  login: string;
  strefa: string;
  ostatnie_uzycie_konektora: string | null;
};

export type DaneRejestracji = {
  /** Kod bramy podany przez rejestrującego. */
  kod: string;
  login: string;
  haslo: string;
  zgoda: boolean;
  /** Kod bramy z konfiguracji (REJESTRACJA_HASLO). */
  kodOczekiwany: string;
  strefa?: string;
};

// === Kryptografia ========================================================

function haszujHaslo(haslo: string, solHex: string): string {
  return scryptSync(haslo, Buffer.from(solHex, "hex"), 64).toString("hex");
}

function hasloZgodne(haslo: string, wiersz: WierszUzytkownika): boolean {
  const podany = Buffer.from(haszujHaslo(haslo, wiersz.sol), "hex");
  const zapisany = Buffer.from(wiersz.hasz_hasla, "hex");
  return podany.length === zapisany.length && timingSafeEqual(podany, zapisany);
}

function haszTokenu(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// === Brama rejestracji ===================================================

/**
 * Jedyne miejsce, w którym rozstrzyga się wpuszczenie do rejestracji.
 * Przejście na jednorazowe kody w tabeli to podmiana ciała tej funkcji —
 * reszta ścieżki rejestracji nie wie, skąd bierze się werdykt.
 */
export function sprawdzKodRejestracji(podany: string, oczekiwany: string): boolean {
  // Pusty kod oczekiwany = brak konfiguracji. Brama zostaje zamknięta,
  // bo otwarcie jej przez przeoczenie zmiennej byłoby cichą katastrofą.
  return hasloPoprawne(podany, oczekiwany);
}

// === Operacje na kontach =================================================

function wierszNaKonto(wiersz: WierszUzytkownika): Konto {
  return {
    id: wiersz.id,
    login: wiersz.login,
    strefa: wiersz.strefa,
    ostatnie_uzycie_konektora: wiersz.ostatnie_uzycie_konektora,
  };
}

function sprawdzDlugoscHasla(haslo: string): void {
  if (haslo.length < MIN_DLUGOSC_HASLA) {
    throw new BladDomeny(`Hasło musi mieć co najmniej ${MIN_DLUGOSC_HASLA} znaków`, "haslo_za_krotkie");
  }
}

export function zarejestruj(
  rejestr: Baza,
  dane: DaneRejestracji,
): { id: number; tokenKonektora: string } {
  if (!sprawdzKodRejestracji(dane.kod, dane.kodOczekiwany)) {
    throw new BladDomeny("Nieprawidłowy kod rejestracji", "zly_kod_rejestracji");
  }
  if (dane.zgoda !== true) {
    throw new BladDomeny("Rejestracja wymaga zgody na przetwarzanie danych", "brak_zgody");
  }

  const login = dane.login.trim();
  if (login === "") {
    throw new BladDomeny("Login nie może być pusty", "pusty_login");
  }
  sprawdzDlugoscHasla(dane.haslo);

  // COLLATE NOCASE w schemacie i tak by to złapał, ale jawne sprawdzenie
  // daje czytelny komunikat zamiast surowego błędu więzu UNIQUE.
  if (uzytkownikPoLoginie(rejestr, login)) {
    throw new BladDomeny("Ten login jest już zajęty", "login_zajety");
  }

  const sol = randomBytes(16).toString("hex");
  const tokenKonektora = randomBytes(32).toString("hex");
  const teraz = new Date().toISOString();

  const id = wstawUzytkownika(rejestr, {
    login,
    hasz_hasla: haszujHaslo(dane.haslo, sol),
    sol,
    token_hasz: haszTokenu(tokenKonektora),
    strefa: dane.strefa ?? DOMYSLNA_STREFA,
    zgoda_ts: teraz,
    utworzono: teraz,
  });

  // Jawny token wraca wyłącznie tutaj — rejestr zna tylko jego hasz.
  return { id, tokenKonektora };
}

export function zaloguj(rejestr: Baza, login: string, haslo: string): Konto | null {
  const wiersz = uzytkownikPoLoginie(rejestr, login.trim());
  if (!wiersz || wiersz.aktywny !== 1) return null;
  if (!hasloZgodne(haslo, wiersz)) return null;
  return wierszNaKonto(wiersz);
}

export function uzytkownikPoTokenie(rejestr: Baza, token: string): Konto | null {
  // Lookup po haszu w indeksie UNIQUE nie ma wycieku czasowego, który przy
  // porównywaniu jawnych tokenów trzeba było neutralizować ręcznie.
  const wiersz = uzytkownikPoTokenHasz(rejestr, haszTokenu(token));
  if (!wiersz || wiersz.aktywny !== 1) return null;
  return wierszNaKonto(wiersz);
}

/** Rotacja tokenu: stary adres konektora natychmiast przestaje działać. */
export function nowyTokenKonektora(rejestr: Baza, id: number): string {
  if (!uzytkownikPoId(rejestr, id)) {
    throw new BladDomeny("Nie ma takiego użytkownika", "brak_uzytkownika");
  }
  const token = randomBytes(32).toString("hex");
  zapiszTokenHasz(rejestr, id, haszTokenu(token));
  return token;
}

/** Znacznik dla wskaźnika „✓ połączono" na ekranie Konto. */
export function odnotujKonektor(rejestr: Baza, id: number, ts: string): void {
  odnotujUzycieKonektora(rejestr, id, ts);
}

/**
 * Nowa sól i nowy hasz. Sesje aplikacji są podpisywane sekretem zawierającym
 * hasz hasła, więc zmiana unieważnia je wszystkie bez tabeli sesji.
 */
export function zmienHaslo(rejestr: Baza, id: number, noweHaslo: string): void {
  sprawdzDlugoscHasla(noweHaslo);
  if (!uzytkownikPoId(rejestr, id)) {
    throw new BladDomeny("Nie ma takiego użytkownika", "brak_uzytkownika");
  }
  const sol = randomBytes(16).toString("hex");
  zapiszHaslo(rejestr, id, haszujHaslo(noweHaslo, sol), sol);
}
