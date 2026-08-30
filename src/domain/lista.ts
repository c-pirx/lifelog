/**
 * Lista oczekujących na premierę — droga od adresu e-mail do konta.
 *
 * Rejestracja nie jest już otwarta za wspólnym hasłem. Kolejność jest teraz
 * taka: ktoś zostawia adres → gospodarz zaprasza konkretny wpis → z maila
 * przychodzi JEDNORAZOWY kod → kod zamienia się w konto i gaśnie. Dzięki temu
 * dostęp da się cofnąć jednej osobie, a kod nie krąży dalej między znajomymi.
 *
 * Ten plik zależy od `konta.ts` (tworzy konto), ale nie odwrotnie —
 * konta nie wiedzą, że istnieje jakakolwiek lista.
 *
 * Dwa sekrety — kod zaproszenia i token wypisu — istnieją jawnie wyłącznie
 * w wysłanym mailu; rejestr zna sam SHA-256, dokładnie jak przy tokenie
 * konektora.
 */

import { randomBytes } from "node:crypto";

import { odczytajPodpisanyTekst, podpiszTekst } from "../auth.js";
import type { Baza } from "../db/index.js";
import {
  oznaczWykorzystanie,
  policzWpisyListy,
  usunWpisListy,
  wpisListyPoEmailu,
  wpisListyPoKodHasz,
  wstawNaListe,
  wszystkieWpisyListy,
  wTransakcji,
  zapiszKodZaproszenia,
  type WierszListy,
} from "../db/rejestr.js";
import { BladDomeny } from "./bledy.js";
import { haszTokenu, utworzKonto } from "./konta.js";

/** Ile dni działa kod z maila. Krócej byłoby wredne, dłużej — bez sensu. */
export const WAZNOSC_ZAPROSZENIA_DNI = 14;

/**
 * Formularza wysłanego szybciej nie wypełnił człowiek. Filtr jest tani
 * i celowo tępy: znacznik czasu przychodzi od klienta, więc broni tylko przed
 * prostym skryptem — poważniejszy napór dławi nginx.
 */
export const MIN_CZAS_WYPELNIENIA_MS = 2000;

const MAX_DLUGOSC_EMAILA = 254;
const MAX_DLUGOSC_IMIENIA = 60;

/** Bez ambicji do RFC 5322: odsiewa literówki, resztę rozstrzyga wysłany mail. */
const KSZTALT_EMAILA = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type StanWpisu = "oczekuje" | "zaproszony" | "zarejestrowany";

export type WpisListy = {
  id: number;
  email: string;
  imie: string | null;
  zapisano: string;
  stan: StanWpisu;
  zaproszono: string | null;
  wykorzystano: string | null;
};

export type DaneZapisu = {
  email: string;
  imie?: string;
  zgoda: boolean;
  /** Honeypot: pole ukryte przed człowiekiem. Wypełnione = bot. */
  pulapka?: string;
  /** Znacznik załadowania strony (ms epoch) — do minimalnego czasu wypełnienia. */
  otwarto?: number;
};

export type WynikZapisu = {
  /** Czy powstał NOWY wiersz. Tylko wtedy wychodzą maile. */
  nowy: boolean;
  wpis: WpisListy | null;
  /**
   * Długość listy po zapisie — ona, a nie `id`, jest „numerem" pokazywanym
   * człowiekowi: identyfikatory zostawiają dziury po wypisach i pierwszy
   * zapisany po czystce dostałby numer czterdziesty.
   */
  lacznie: number;
};

/**
 * Rozdzielenie przeznaczeń sekretu: ten sam klucz podpisuje ciasteczka sesji,
 * więc token wypisu wyprowadzamy z jego wariantu. Bez tego podpis z jednej
 * dziedziny dałoby się podstawić w drugiej.
 */
function sekretWypisu(sekretSesji: string): string {
  return `${sekretSesji}|wypis-z-listy`;
}

/**
 * Token do linku „usuń mój adres". Nie ma go w bazie — jest wyprowadzany
 * z adresu, więc każdy kolejny mail może nieść działający link, a wpis nie
 * potrzebuje kolumny z sekretem.
 */
export function tokenWypisu(email: string, sekretSesji: string): string {
  return podpiszTekst(email.trim().toLowerCase(), sekretWypisu(sekretSesji));
}

function wierszNaWpis(wiersz: WierszListy): WpisListy {
  return {
    id: wiersz.id,
    email: wiersz.email,
    imie: wiersz.imie,
    zapisano: wiersz.zapisano,
    stan: wiersz.stan as StanWpisu,
    zaproszono: wiersz.zaproszono,
    wykorzystano: wiersz.wykorzystano,
  };
}

function znormalizujEmail(surowy: string): string {
  // Małe litery, mimo COLLATE NOCASE w schemacie: adres wraca do użytkownika
  // w mailu i w CLI, a „Ania@…" raz tak, raz inaczej wygląda na dwa konta.
  const email = surowy.trim().toLowerCase();
  if (email.length > MAX_DLUGOSC_EMAILA || !KSZTALT_EMAILA.test(email)) {
    throw new BladDomeny("To nie wygląda na adres e-mail", "zly_email");
  }
  return email;
}

/**
 * Zapis na listę. Odpowiedź jest CELOWO jednakowa dla nowego adresu,
 * duplikatu i bota — formularz nie ma zdradzać, kto już się zapisał.
 *
 * Duplikat nie wysyła drugiego maila i to nie jest oszczędność, tylko jedyna
 * rzecz, która broni formularza przed zamienieniem go w działko na cudzą
 * skrzynkę: jeden adres dostaje od nas najwyżej jedną wiadomość powitalną.
 */
export function zapiszNaListe(
  rejestr: Baza,
  dane: DaneZapisu,
  opcje: { teraz?: Date } = {},
): WynikZapisu {
  const teraz = opcje.teraz ?? new Date();
  const nic: WynikZapisu = { nowy: false, wpis: null, lacznie: 0 };

  // Bot nie dowiaduje się, że przegrał — inaczej następna próba omija pułapkę.
  if (typeof dane.pulapka === "string" && dane.pulapka.trim() !== "") return nic;
  if (typeof dane.otwarto === "number" && teraz.getTime() - dane.otwarto < MIN_CZAS_WYPELNIENIA_MS) {
    return nic;
  }

  // Zgoda to jedyny warunek, o którym mówimy wprost: człowiek ma wiedzieć,
  // czego mu brakuje, a checkbox jest widoczny.
  if (dane.zgoda !== true) {
    throw new BladDomeny("Zapis wymaga zgody na przetwarzanie adresu", "brak_zgody");
  }

  const email = znormalizujEmail(dane.email);
  const imie = dane.imie?.trim().slice(0, MAX_DLUGOSC_IMIENIA) || null;

  const istniejacy = wpisListyPoEmailu(rejestr, email);
  if (istniejacy) return { ...nic, wpis: wierszNaWpis(istniejacy) };

  const znacznik = teraz.toISOString();
  wstawNaListe(rejestr, { email, imie, zapisano: znacznik, zgoda_ts: znacznik });

  const wpis = wpisListyPoEmailu(rejestr, email);
  return {
    nowy: true,
    wpis: wpis ? wierszNaWpis(wpis) : null,
    lacznie: policzWpisyListy(rejestr),
  };
}

/**
 * Wypis z linku w stopce maila. Kasuje wiersz, a nie ustawia flagę — prawo do
 * bycia zapomnianym jest wtedy dosłowne. Nieznany i podrobiony token nie są
 * błędem: odpowiedź ma wyglądać tak samo, żeby link nie służył do sprawdzania,
 * czy ktoś jest na liście.
 */
export function wypiszZListy(rejestr: Baza, token: string, sekretSesji: string): boolean {
  const email = odczytajPodpisanyTekst(token, sekretWypisu(sekretSesji));
  if (email === null) return false;
  const wiersz = wpisListyPoEmailu(rejestr, email);
  if (!wiersz) return false;
  usunWpisListy(rejestr, wiersz.id);
  return true;
}

export type Zaproszenie = {
  wpis: WpisListy;
  /** Jawny kod — pokazywany raz, potem zostaje sam hasz. */
  kod: string;
  wygasa: string;
};

/**
 * Zaproszenie konkretnego adresu. Powtórne wywołanie wydaje NOWY kod
 * i unieważnia poprzedni (kolumna jest jedna) — to zamierzone: tak wygląda
 * „wyślij jeszcze raz, poprzedni mail gdzieś przepadł".
 */
export function zapros(rejestr: Baza, email: string, opcje: { teraz?: Date } = {}): Zaproszenie {
  const teraz = opcje.teraz ?? new Date();
  const wiersz = wpisListyPoEmailu(rejestr, email.trim().toLowerCase());
  if (!wiersz) {
    throw new BladDomeny("Tego adresu nie ma na liście", "brak_wpisu");
  }
  if (wiersz.stan === "zarejestrowany") {
    throw new BladDomeny("Ten adres ma już konto", "juz_zarejestrowany");
  }

  const kod = randomBytes(24).toString("base64url");
  const wygasa = new Date(
    teraz.getTime() + WAZNOSC_ZAPROSZENIA_DNI * 24 * 60 * 60 * 1000,
  ).toISOString();
  zapiszKodZaproszenia(rejestr, wiersz.id, haszTokenu(kod), wygasa, teraz.toISOString());

  return { wpis: { ...wierszNaWpis(wiersz), stan: "zaproszony" }, kod, wygasa };
}

export type DaneRejestracji = {
  /** Jednorazowy kod z maila zaproszenia. */
  kod: string;
  login: string;
  haslo: string;
  zgoda: boolean;
  strefa?: string;
};

export type WynikRejestracji = {
  id: number;
  /** Jawny token konektora — pokazywany raz, potem zostaje sam hasz. */
  tokenKonektora: string;
  /**
   * Adres i imię z zużytego wpisu. Konto ich nie przechowuje, a powiadomienie
   * gospodarza musi powiedzieć, KTO wszedł — sam login tego nie mówi.
   */
  email: string;
  imie: string | null;
};

/**
 * Rejestracja z kodu zaproszenia — następczyni bramy na wspólne hasło.
 *
 * Utworzenie konta i zgaszenie kodu idą w JEDNEJ transakcji. Bez tego dwa
 * równoległe żądania z tym samym kodem założyłyby dwa konta: oba znalazłyby
 * wiersz przed zapisem drugiego.
 */
export function zarejestrujZKodem(
  rejestr: Baza,
  dane: DaneRejestracji,
  opcje: { teraz?: Date } = {},
): WynikRejestracji {
  const teraz = opcje.teraz ?? new Date();

  return wTransakcji(rejestr, () => {
    const wiersz = wpisListyPoKodHasz(rejestr, haszTokenu(dane.kod.trim()));
    // Jeden komunikat na kod zły, zużyty i przeterminowany: zaproszony i tak
    // ma poprosić o nowy link, a rozróżnianie mówiłoby obcym za dużo.
    if (!wiersz || wiersz.stan !== "zaproszony" || !wiersz.kod_wygasa) {
      throw new BladDomeny("Kod zaproszenia jest nieprawidłowy lub już zużyty", "zly_kod_rejestracji");
    }
    if (new Date(wiersz.kod_wygasa).getTime() < teraz.getTime()) {
      throw new BladDomeny("Kod zaproszenia stracił ważność — poproś o nowy", "kod_wygasl");
    }

    const konto = utworzKonto(rejestr, {
      login: dane.login,
      haslo: dane.haslo,
      zgoda: dane.zgoda,
      ...(dane.strefa !== undefined ? { strefa: dane.strefa } : {}),
      teraz,
    });

    oznaczWykorzystanie(rejestr, wiersz.id, konto.id, teraz.toISOString());
    return { ...konto, email: wiersz.email, imie: wiersz.imie };
  });
}

/**
 * Ilu ludzi jest na liście — jedyna rzecz o liście widoczna publicznie.
 * Strona powitalna pokazuje tę liczbę przy formularzu zapisu; wpisy same
 * (adresy, stany) pozostają dostępne wyłącznie przez `npm run lista`.
 */
export function liczbaZapisanych(rejestr: Baza): number {
  return policzWpisyListy(rejestr);
}

// === Administracja z wiersza poleceń =====================================

export function wpisyListy(rejestr: Baza): WpisListy[] {
  return wszystkieWpisyListy(rejestr).map(wierszNaWpis);
}

export function usunZListy(rejestr: Baza, email: string): boolean {
  const wiersz = wpisListyPoEmailu(rejestr, email.trim().toLowerCase());
  if (!wiersz) return false;
  usunWpisListy(rejestr, wiersz.id);
  return true;
}
