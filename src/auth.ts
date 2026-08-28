/**
 * Logowanie do aplikacji webowej.
 *
 * Jeden użytkownik, jedno hasło ze zmiennej środowiskowej, sesja w podpisanym
 * ciasteczku. Bez bazy sesji i bez bibliotek — HMAC z `node:crypto` wystarcza,
 * a im mniej ruchomych części, tym mniej rzeczy do zepsucia na produkcji.
 *
 * Ścieżka /mcp ma własne uwierzytelnianie tokenem i celowo NIE przechodzi tędy:
 * Claude łączy się z chmury Anthropic i nie ma jak przejść przez formularz.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const ROZDZIELNIK = ".";

/** Ważność sesji. Aplikacja osobista — logowanie co tydzień byłoby udręką. */
export const WAZNOSC_SESJI_DNI = 400;

function base64url(dane: Buffer | string): string {
  return Buffer.from(dane).toString("base64url");
}

function hmac(tresc: string, sekret: string): string {
  return createHmac("sha256", sekret).update(tresc).digest("base64url");
}

function porownajBezpiecznie(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Podpisanie dowolnego krótkiego tekstu tym samym chwytem, co ciasteczko sesji:
 * treść jawnie, obok HMAC. Służy linkom, które muszą działać bezterminowo
 * i bez wiersza w bazie — dziś wypisowi z listy oczekujących.
 *
 * Bez daty ważności celowo: link „usuń mój adres" ma zadziałać także pół roku
 * po mailu, w którym przyszedł.
 */
export function podpiszTekst(tekst: string, sekret: string): string {
  const ladunek = base64url(tekst);
  return `${ladunek}${ROZDZIELNIK}${hmac(ladunek, sekret)}`;
}

/** Odwrotność `podpiszTekst`. Null, gdy podpis się nie zgadza. */
export function odczytajPodpisanyTekst(podpisany: string, sekret: string): string | null {
  const [ladunek, sygnatura] = podpisany.split(ROZDZIELNIK);
  if (!ladunek || !sygnatura) return null;
  if (!porownajBezpiecznie(sygnatura, hmac(ladunek, sekret))) return null;
  return Buffer.from(ladunek, "base64url").toString();
}

export function utworzToken(sekret: string, uzytkownikId: number, teraz: number = Date.now()): string {
  const ladunek = base64url(JSON.stringify({ wydano: teraz, uzytkownik: uzytkownikId }));
  return `${ladunek}${ROZDZIELNIK}${hmac(ladunek, sekret)}`;
}

/**
 * Odczytuje z tokenu identyfikator użytkownika albo null, gdy token nie jest
 * ważny — z dowolnego powodu: zły podpis, przeterminowanie, nieznane konto.
 *
 * Sekret podpisu zależy od użytkownika (zawiera hasz jego hasła), więc musi
 * przyjść z zewnątrz przez `sekretDlaUzytkownika`. Identyfikator z ładunku
 * czytamy PRZED weryfikacją — inaczej nie wiadomo, którym sekretem
 * weryfikować — ale zwracamy go dopiero, gdy podpis się zgadza. Podmiana id
 * w ładunku unieważnia podpis, bo cudzy sekret jest inny.
 */
export function odczytajToken(
  token: string,
  sekretDlaUzytkownika: (id: number) => string | null,
  teraz: number = Date.now(),
): number | null {
  const [ladunek, sygnatura] = token.split(ROZDZIELNIK);
  if (!ladunek || !sygnatura) return null;

  let wydano: unknown;
  let uzytkownik: unknown;
  try {
    ({ wydano, uzytkownik } = JSON.parse(Buffer.from(ladunek, "base64url").toString()) as {
      wydano?: unknown;
      uzytkownik?: unknown;
    });
  } catch {
    return null;
  }
  if (typeof wydano !== "number" || typeof uzytkownik !== "number") return null;

  const sekret = sekretDlaUzytkownika(uzytkownik);
  if (sekret === null) return null;

  if (!porownajBezpiecznie(sygnatura, hmac(ladunek, sekret))) return null;

  const wiek = teraz - wydano;
  if (wiek < 0 || wiek >= WAZNOSC_SESJI_DNI * 24 * 60 * 60 * 1000) return null;

  return uzytkownik;
}

export function hasloPoprawne(podane: string, oczekiwane: string): boolean {
  return oczekiwane !== "" && porownajBezpiecznie(podane, oczekiwane);
}
