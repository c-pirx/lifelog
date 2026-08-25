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

export function utworzToken(sekret: string, teraz: number = Date.now()): string {
  const ladunek = base64url(JSON.stringify({ wydano: teraz }));
  return `${ladunek}${ROZDZIELNIK}${hmac(ladunek, sekret)}`;
}

export function tokenWazny(token: string, sekret: string, teraz: number = Date.now()): boolean {
  const [ladunek, sygnatura] = token.split(ROZDZIELNIK);
  if (!ladunek || !sygnatura) return false;

  if (!porownajBezpiecznie(sygnatura, hmac(ladunek, sekret))) return false;

  try {
    const { wydano } = JSON.parse(Buffer.from(ladunek, "base64url").toString()) as {
      wydano?: number;
    };
    if (typeof wydano !== "number") return false;

    const wiek = teraz - wydano;
    return wiek >= 0 && wiek < WAZNOSC_SESJI_DNI * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function hasloPoprawne(podane: string, oczekiwane: string): boolean {
  return oczekiwane !== "" && porownajBezpiecznie(podane, oczekiwane);
}
