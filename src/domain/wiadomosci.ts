/**
 * Treść wiadomości wychodzących — czyste funkcje, zero sieci.
 *
 * Mieszka w domenie, a nie przy transporcie, z tego samego powodu, dla którego
 * zasada szacowania makro mieszka w opisie narzędzia: to, co dostaje człowiek,
 * jest decyzją produktową. Dzięki rozdzieleniu testy sprawdzają, że link wypisu
 * naprawdę trafia do maila, nie dotykając Resendu.
 *
 * Cztery wiadomości i ani jednej więcej: dwie do zapisanego (powitanie
 * i zaproszenie) oraz dwie do gospodarza (nowy zapis, nowe konto). Poczta jest
 * tu transakcyjna, nie marketingowa — próg dla piątej jest równie wysoki.
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

/**
 * Wydzielony panel z instrukcją: wgłębione tło i zielona krawędź, żeby kroki
 * odróżniały się od listu jednym spojrzeniem. Numerację niesie `<ol>`, ale
 * kroki są krótkie — klient, który listę spłaszczy, dalej daje się przeczytać.
 */
function blok(naglowek: string, wstep: string, kroki: string[], stopka: string): string {
  const pozycje = kroki
    .map((krok) => `<li style="margin:0 0 8px">${bezpieczny(krok)}</li>`)
    .join("");
  return [
    `<div style="margin:28px 0;padding:18px 20px;background:#0f1115;border-left:3px solid #95e6b9;border-radius:12px">`,
    `<p style="margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#95e6b9">${bezpieczny(naglowek)}</p>`,
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">${bezpieczny(wstep)}</p>`,
    `<ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6">${pozycje}</ol>`,
    `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#8b93a3">${bezpieczny(stopka)}</p>`,
    `</div>`,
  ].join("");
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
      `To pomyłka albo zmiana zdania? <a href="${bezpieczny(wypis)}" style="color:#95e6b9">Usuń mój adres</a> — kasujemy wpis od razu, bez pytań.`,
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
  /** Link „zaproś" — zastępuje wejście na serwer po `npm run lista`. */
  tokenZaproszenia: string;
  adresy: Adresy;
}): Wiadomosc {
  const zapros = `${dane.adresy.publiczny}/api/lista/zapros/${dane.tokenZaproszenia}`;
  const linie = [
    `Adres: ${dane.email}`,
    `Imię: ${dane.imie ?? "(nie podano)"}`,
    `Numer na liście: ${dane.numer}`,
    `Zapisanych łącznie: ${dane.lacznie}`,
  ];

  return {
    odbiorca: dane.odbiorca,
    temat: `Nowy zapis na listę: ${dane.email}`,
    tekst:
      `${linie.join("\n")}\n\nZaproś (link pyta o potwierdzenie): ${zapros}\n\n` +
      `Albo przez ssh: npm run lista -- zapros ${dane.email}\n`,
    html: oprawa(
      "Nowy zapis na listę",
      linie.map(akapit).join("") + przycisk("Zaproś tę osobę", zapros),
      `Powiadomienie z ${bezpieczny(NAZWA)}a. Link otwiera stronę z pytaniem — kod wychodzi dopiero po potwierdzeniu.`,
    ),
  };
}

// === 3. Zaproszenie do założenia konta ===================================

/** Kroki podłączenia konektora — skrót tego, co ekran Konto mówi szerzej. */
const KROKI_KONEKTORA = [
  "Załóż konto z linku powyżej.",
  'W aplikacji: menu → Konto → „Wygeneruj i pokaż adres konektora".',
  "Na claude.ai: Ustawienia → Konektory → Dodaj własny konektor. Wklej adres.",
  'Przy pierwszym pytaniu o zgodę wybierz „Zawsze zezwalaj".',
];

const WSTEP_KONEKTORA =
  "Aplikacja to jedno wejście do dziennika, Claude drugie: mówisz zdaniem, " +
  "on zapisuje. Bez tego zostaje samo wyklikiwanie.";

const STOPKA_KONEKTORA =
  "Konfiguruje się raz, najwygodniej przy komputerze. Po stronie Claude'a potrzebny plan płatny.";

export function wiadomoscZaproszenie(dane: {
  email: string;
  imie: string | null;
  kod: string;
  waznoscDni: number;
  tokenWypisu: string;
  adresy: Adresy;
  /** Adres gospodarza do zgłoszeń; bez niego mail nie zaprasza do pisania donikąd. */
  kontakt: string | null;
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
  const naglowekBloku = "Pełnia możliwości: Claude pod ręką";
  const dopiski = [
    ...(dane.kontakt
      ? [
          `Coś nie działa albo wygląda dziwnie? Napisz na ${dane.kontakt} — to wciąż ` +
            "wersja beta i każde zgłoszenie realnie coś zmienia.",
        ]
      : []),
    `Mamy nadzieję, że ${NAZWA} będzie Ci służyć w codziennym osiąganiu celów.`,
  ];

  const krokiTekstem = KROKI_KONEKTORA.map((krok, i) => `${i + 1}. ${krok}`).join("\n");
  const blokTekstem = [
    `— ${naglowekBloku} —`,
    WSTEP_KONEKTORA,
    krokiTekstem,
    STOPKA_KONEKTORA,
  ].join("\n\n");

  return {
    odbiorca: dane.email,
    temat: `Zaproszenie do ${NAZWA}a`,
    tekst:
      `${zdania.join("\n\n")}\n\nZałóż konto: ${link}\n\n${blokTekstem}\n\n` +
      `${dopiski.join("\n\n")}\n\nNie chcesz? Wypisz się: ${wypis}\n`,
    html: oprawa(
      "Zaproszenie czeka",
      zdania.slice(1).map(akapit).join("") +
        przycisk("Załóż konto", link) +
        blok(naglowekBloku, WSTEP_KONEKTORA, KROKI_KONEKTORA, STOPKA_KONEKTORA) +
        dopiski.map(akapit).join(""),
      `Link działa ${dane.waznoscDni} dni i tylko raz. Zmiana zdania? <a href="${bezpieczny(wypis)}" style="color:#95e6b9">Usuń mój adres</a>.`,
    ),
  };
}

// === 4. Nowe konto z zaproszenia =========================================

/**
 * Druga wiadomość dla gospodarza: kod zaproszenia zamienił się w konto.
 *
 * Zapis na listę i rejestracja to dwa osobne zdarzenia rozdzielone tygodniami,
 * więc mają dwa osobne maile — jeden mówi „ktoś chce", drugi „ktoś wszedł".
 * Login jest tu najważniejszy: to jedyny uchwyt do konta w `npm run konta`,
 * a rejestr nie wie, który adres z listy za nim stoi.
 */
export function wiadomoscORejestracji(dane: {
  odbiorca: string;
  email: string;
  imie: string | null;
  login: string;
}): Wiadomosc {
  const linie = [
    `Login konta: ${dane.login}`,
    `Adres z listy: ${dane.email}`,
    `Imię: ${dane.imie ?? "(nie podano)"}`,
    "",
    "Kod zaproszenia zgasł — wpis na liście jest zamknięty.",
  ];

  return {
    odbiorca: dane.odbiorca,
    temat: `Nowe konto z zaproszenia: ${dane.login}`,
    tekst: `${linie.join("\n")}\n`,
    html: oprawa(
      "Nowe konto z zaproszenia",
      linie.filter((linia) => linia !== "").map(akapit).join(""),
      `Powiadomienie z ${bezpieczny(NAZWA)}a. Konto już działa — ten mail tylko o nim mówi.`,
    ),
  };
}
