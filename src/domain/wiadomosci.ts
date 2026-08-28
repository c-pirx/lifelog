/**
 * Treść wiadomości wychodzących — czyste funkcje, zero sieci.
 *
 * Mieszka w domenie, a nie przy transporcie, z tego samego powodu, dla którego
 * zasada szacowania makro mieszka w opisie narzędzia: to, co dostaje człowiek,
 * jest decyzją produktową. Dzięki rozdzieleniu testy sprawdzają, że link wypisu
 * naprawdę trafia do maila, nie dotykając Resendu.
 *
 * Trzy wiadomości i ani jednej więcej — poczta jest tu transakcyjna,
 * nie marketingowa.
 */

import type { Wiadomosc } from "../lib/poczta.js";

const NAZWA = "Lifelog";

/** Adresy budujemy z konfiguracji: repozytorium jest publiczne i domeny nie zna. */
export type Adresy = {
  /** Bez ukośnika na końcu, np. https://przyklad.pl */
  publiczny: string;
};

function bezpieczny(tekst: string): string {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkWypisu(adresy: Adresy, token: string): string {
  return `${adresy.publiczny}/api/lista/wypis/${token}`;
}

/**
 * Wspólna oprawa. Style wpisane w atrybuty, bo klienty pocztowe wycinają
 * arkusze — to jedyne miejsce w projekcie, gdzie inline style jest poprawny.
 */
function oprawa(naglowek: string, tresc: string, stopka: string): string {
  return [
    `<div style="margin:0;padding:24px;background:#0f1115;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e7e9ee">`,
    `<div style="max-width:520px;margin:0 auto;background:#171a21;border-radius:16px;padding:28px">`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#95e6b9">${bezpieczny(naglowek)}</h1>`,
    tresc,
    `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #2a2f3a;font-size:12px;line-height:1.6;color:#8b93a3">${stopka}</p>`,
    `</div></div>`,
  ].join("");
}

function akapit(tekst: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${bezpieczny(tekst)}</p>`;
}

function przycisk(etykieta: string, adres: string): string {
  return (
    `<p style="margin:24px 0"><a href="${bezpieczny(adres)}" ` +
    `style="display:inline-block;padding:12px 20px;border-radius:10px;background:#95e6b9;` +
    `color:#0f1115;font-weight:600;font-size:15px;text-decoration:none">${bezpieczny(etykieta)}</a></p>`
  );
}

function powitanie(imie: string | null): string {
  return imie ? `Cześć ${imie}!` : "Cześć!";
}

// === 1. Potwierdzenie zapisu na listę ====================================

export function wiadomoscPowitalna(dane: {
  email: string;
  imie: string | null;
  numer: number;
  tokenWypisu: string;
  adresy: Adresy;
}): Wiadomosc {
  const wypis = linkWypisu(dane.adresy, dane.tokenWypisu);
  const zdania = [
    powitanie(dane.imie),
    `Jesteś na liście oczekujących na ${NAZWA} — masz numer ${dane.numer}.`,
    "Lifelog to dziennik diety i treningów z dwoma wejściami do tych samych danych: " +
      "dyktujesz zdaniem do Claude'a, a na siłowni odhaczasz serie w aplikacji na telefonie.",
    "Odezwiemy się z zaproszeniem, gdy zwolni się miejsce. Nie wysyłamy niczego poza tym " +
      "jednym mailem i zaproszeniem — żadnego newslettera.",
  ];

  return {
    odbiorca: dane.email,
    temat: `Jesteś na liście — ${NAZWA}`,
    tekst: `${zdania.join("\n\n")}\n\nNie chcesz czekać? Wypisz się: ${wypis}\n`,
    html: oprawa(
      "Jesteś na liście",
      zdania.slice(1).map(akapit).join(""),
      `Nie zapisywałeś się albo zmieniłeś zdanie? <a href="${bezpieczny(wypis)}" style="color:#95e6b9">Usuń mój adres</a> — kasujemy wpis od razu, bez pytań.`,
    ),
  };
}

// === 2. Powiadomienie gospodarza =========================================

export function wiadomoscDlaGospodarza(dane: {
  odbiorca: string;
  email: string;
  imie: string | null;
  numer: number;
  lacznie: number;
}): Wiadomosc {
  const linie = [
    `Adres: ${dane.email}`,
    `Imię: ${dane.imie ?? "(nie podano)"}`,
    `Numer na liście: ${dane.numer}`,
    `Zapisanych łącznie: ${dane.lacznie}`,
    "",
    "Zaproszenie: npm run lista -- zapros " + dane.email,
  ];

  return {
    odbiorca: dane.odbiorca,
    temat: `Nowy zapis na listę: ${dane.email}`,
    tekst: `${linie.join("\n")}\n`,
    html: oprawa(
      "Nowy zapis na listę",
      linie.filter((linia) => linia !== "").map(akapit).join(""),
      `Powiadomienie z ${bezpieczny(NAZWA)}a. Wpis jest w rejestrze — ten mail tylko o nim mówi.`,
    ),
  };
}

// === 3. Zaproszenie do założenia konta ===================================

export function wiadomoscZaproszenie(dane: {
  email: string;
  imie: string | null;
  kod: string;
  waznoscDni: number;
  tokenWypisu: string;
  adresy: Adresy;
}): Wiadomosc {
  const link = `${dane.adresy.publiczny}/app?kod=${encodeURIComponent(dane.kod)}`;
  const wypis = linkWypisu(dane.adresy, dane.tokenWypisu);
  const zdania = [
    powitanie(dane.imie),
    `Miejsce w ${NAZWA}u czeka na Ciebie. Link poniżej otwiera zakładanie konta ` +
      "z wpisanym już kodem — wystarczy wymyślić login i hasło.",
    `Kod działa przez ${dane.waznoscDni} dni i tylko raz. Jest przypisany do tego adresu, ` +
      "więc przekazany dalej nikomu nie pomoże.",
  ];

  return {
    odbiorca: dane.email,
    temat: `Zaproszenie do ${NAZWA}a`,
    tekst: `${zdania.join("\n\n")}\n\nZałóż konto: ${link}\n\nNie chcesz? Wypisz się: ${wypis}\n`,
    html: oprawa(
      "Zaproszenie czeka",
      zdania.slice(1).map(akapit).join("") + przycisk("Załóż konto", link),
      `Link działa ${dane.waznoscDni} dni i tylko raz. Zmieniłeś zdanie? <a href="${bezpieczny(wypis)}" style="color:#95e6b9">Usuń mój adres</a>.`,
    ),
  };
}
