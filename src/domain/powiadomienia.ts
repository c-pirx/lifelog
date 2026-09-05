/**
 * Powiadomienia push: co, komu i kiedy wysłać.
 *
 * Cała reguła siedzi w jednej czystej funkcji — bez sieci, bez zegara, bez
 * wiedzy o subskrypcjach. Chwila przychodzi parametrem, tak samo jak przy
 * `trendWagi` i `czestePosilki`, bo test zależny od dzisiejszej daty zaczyna
 * padać sam z siebie po kilku miesiącach.
 *
 * Stan dnia czytamy WYŁĄCZNIE przez `planNaDzis` i `podsumowanieDnia` — te same
 * funkcje, którymi odpowiada ekran Dziś i czat. Drugie miejsce liczące „czy dziś
 * był trening" rozjechałoby się z ekranem Trening przy pierwszej poprawce.
 *
 * Zasada, której nie wolno tu złamać: powiadomienie MILKNIE, gdy warunek znika.
 * Odhaczony trening gasi wieczorne przypomnienie, dopisana kolacja gasi to
 * o 18:00. Bezwarunkowe powiadomienie o stałej porze zostaje w telefonie
 * wyciszone w ciągu dwóch tygodni — i zabiera ze sobą pozostałe.
 */

import type { Baza } from "../db/index.js";
import { dataLokalna, godzinaLokalna, STREFA_DOMYSLNA } from "../lib/time.js";
import { podsumowanieDnia } from "./diet.js";
import { planNaDzis } from "./workouts.js";

export type RodzajPowiadomienia = "trening_rano" | "trening_wieczor" | "kalorie";

export const RODZAJE_POWIADOMIEN: readonly RodzajPowiadomienia[] = [
  "trening_rano",
  "trening_wieczor",
  "kalorie",
];

/**
 * Godziny lokalne, od których powiadomienie może pójść.
 *
 * Rano ma GÓRNĄ granicę i to nie jest ozdobnik: bez niej telefon włączony
 * pierwszy raz o 20:05 w niezrobiony dzień treningowy spełniałby oba warunki
 * i dostałby dwa powiadomienia naraz — dokładnie ten szum, który kończy się
 * wyciszeniem kanału.
 */
export const GODZINA_RANO = 8;
export const GODZINA_KALORII = 18;
export const GODZINA_WIECZOR = 20;

/**
 * Progi jako UŁAMEK celu dziennego, nie sztywne kalorie.
 *
 * Przy celu 3500 kcal alarm od 1500 nie przyszedłby nigdy, a przy celu 1600 —
 * codziennie. Dolny próg jest skalibrowany na realny przypadek: 1500 z 2800 to
 * 53,6 %, czyli tuż pod 55 %.
 */
export const PROG_ZA_MALO = 0.55;
export const PROG_ZA_DUZO = 0.85;

export type DoWyslania = {
  rodzaj: RodzajPowiadomienia;
  tytul: string;
  tresc: string;
  /** Zakładka do otwarcia po stuknięciu. Adres składa service worker. */
  ekran: "dzis" | "trening";
};

export type OpcjePowiadomien = {
  /** Chwila w UTC ISO — podawana, nie czytana z zegara. */
  teraz: string;
  strefa?: string;
  /** Rodzaje włączone przez użytkownika. Pusta lista = cisza. */
  wlaczone: readonly RodzajPowiadomienia[];
  /** Rodzaje już wysłane tego dnia lokalnego. */
  juzWyslane: readonly RodzajPowiadomienia[];
};

/** „utrzymanie" pilnuje obu stron; masa tylko dolnej, redukcja tylko górnej. */
const PROGI_TRYBU = {
  masa: { zaMalo: true, zaDuzo: false },
  redukcja: { zaMalo: false, zaDuzo: true },
  utrzymanie: { zaMalo: true, zaDuzo: true },
} as const;

const kcal = (x: number): string => String(Math.round(x));

export function powiadomieniaNaTeraz(db: Baza, opcje: OpcjePowiadomien): DoWyslania[] {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const godzina = Number(godzinaLokalna(opcje.teraz, strefa).slice(0, 2));

  const dozwolony = (rodzaj: RodzajPowiadomienia): boolean =>
    opcje.wlaczone.includes(rodzaj) && !opcje.juzWyslane.includes(rodzaj);

  const wynik: DoWyslania[] = [];

  const poraTreningu =
    godzina >= GODZINA_WIECZOR
      ? "trening_wieczor"
      : godzina >= GODZINA_RANO
        ? "trening_rano"
        : null;

  if (poraTreningu !== null && dozwolony(poraTreningu)) {
    const trening = trescTreningu(db, poraTreningu, opcje.teraz, strefa);
    if (trening) wynik.push(trening);
  }

  if (godzina >= GODZINA_KALORII && dozwolony("kalorie")) {
    const kalorie = trescKalorii(db, opcje.teraz, strefa);
    if (kalorie) wynik.push(kalorie);
  }

  return wynik;
}

/**
 * Dzień z harmonogramu, którego jeszcze nie zrobiono.
 *
 * Zrealizowany dzień gasi oba przypomnienia — to jest to milknięcie. Dzień wolny
 * też, bo nie ma o czym przypominać.
 */
function trescTreningu(
  db: Baza,
  rodzaj: "trening_rano" | "trening_wieczor",
  teraz: string,
  strefa: string,
): DoWyslania | null {
  const plan = planNaDzis(db, { ts: teraz, strefa });
  if (!plan.dzien || plan.zrealizowany) return null;

  const opis = `Dzień ${plan.dzien.kod} — ${plan.dzien.nazwa}`;

  return rodzaj === "trening_rano"
    ? { rodzaj, tytul: "Dziś dzień treningowy", tresc: opis, ekran: "trening" }
    : {
        rodzaj,
        tytul: "Ostatnia szansa na trening",
        tresc: `${opis}. Dzień się kończy.`,
        ekran: "trening",
      };
}

/**
 * Bilans dnia zestawiony z celem — w stronę, którą wskazuje tryb.
 *
 * Bez ustawionych celów nie ma z czym porównywać, więc nie ma powiadomienia.
 * Treść podaje LICZBY, nie ocenę: „zostało 1300 kcal" czyta się jako zachętę
 * przy budowaniu masy i jako ostrzeżenie przy redukcji, a system nie musi
 * wybierać za użytkownika.
 */
function trescKalorii(db: Baza, teraz: string, strefa: string): DoWyslania | null {
  const dzien = podsumowanieDnia(db, dataLokalna(teraz, strefa), { strefa });
  if (!dzien.cele || dzien.cele.kcal <= 0) return null;

  const zjedzone = dzien.spozyte.kcal;
  const cel = dzien.cele.kcal;
  const udzial = zjedzone / cel;
  const zostalo = cel - zjedzone;
  const progi = PROGI_TRYBU[dzien.cele.tryb];

  if (progi.zaMalo && udzial < PROG_ZA_MALO) {
    return {
      rodzaj: "kalorie",
      tytul: "Za mało jak na dziś",
      tresc: `${kcal(zjedzone)} z ${kcal(cel)} kcal. Zostało ${kcal(zostalo)} — zdążysz zjeść?`,
      ekran: "dzis",
    };
  }

  if (progi.zaDuzo && udzial > PROG_ZA_DUZO) {
    return {
      rodzaj: "kalorie",
      tytul: "Zostało mało na wieczór",
      tresc: `${kcal(zjedzone)} z ${kcal(cel)} kcal. Na resztę dnia zostało ${kcal(zostalo)}.`,
      ekran: "dzis",
    };
  }

  return null;
}

/**
 * Kolumna `powiadomienia` w rejestrze ↔ lista rodzajów.
 *
 * Tekst po przecinku zamiast trzech kolumn boolowskich: czwarty rodzaj ma być
 * jedną linią w TypeScripcie, nie migracją. Nieznane nazwy odpadają po cichu —
 * to jedyne miejsce, w którym stara wersja kodu spotyka nowy rodzaj.
 */
export function odczytajRodzaje(zapis: string): RodzajPowiadomienia[] {
  return zapis
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RodzajPowiadomienia =>
      RODZAJE_POWIADOMIEN.includes(s as RodzajPowiadomienia),
    );
}

export function zapiszRodzaje(rodzaje: readonly RodzajPowiadomienia[]): string {
  return RODZAJE_POWIADOMIEN.filter((r) => rodzaje.includes(r)).join(",");
}
