/**
 * Obsługa czasu i granic doby.
 *
 * Serwer może stać w dowolnej strefie (na hostingu zwykle UTC), a doba
 * użytkownika jest liczona w Europe/Warsaw. Cała konwersja żyje tutaj —
 * nigdzie indziej w kodzie nie wolno używać metod lokalnych typu getDate().
 */

export const STREFA_DOMYSLNA = process.env["TZ_APP"] ?? "Europe/Warsaw";

/** Znacznik chwili obecnej w UTC, ISO 8601. */
export function terazUtc(): string {
  return new Date().toISOString();
}

type CzesciDaty = {
  rok: number;
  miesiac: number;
  dzien: number;
  godzina: number;
  minuta: number;
};

function rozbij(iso: string, strefa: string): CzesciDaty {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) {
    throw new Error(`Niepoprawny znacznik czasu: ${iso}`);
  }

  const czesci = new Intl.DateTimeFormat("en-US", {
    timeZone: strefa,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(data);

  const pobierz = (typ: Intl.DateTimeFormatPartTypes): number => {
    const czesc = czesci.find((c) => c.type === typ);
    if (!czesc) throw new Error(`Brak części "${typ}" w sformatowanej dacie`);
    return Number(czesc.value);
  };

  // Uwaga: dla północy Intl potrafi zwrócić godzinę 24 zamiast 0.
  const godzina = pobierz("hour") % 24;

  return {
    rok: pobierz("year"),
    miesiac: pobierz("month"),
    dzien: pobierz("day"),
    godzina,
    minuta: pobierz("minute"),
  };
}

const dwucyfrowo = (n: number): string => String(n).padStart(2, "0");

/** Data lokalna w formacie YYYY-MM-DD — klucz, po którym grupujemy dobę. */
export function dataLokalna(iso: string, strefa: string = STREFA_DOMYSLNA): string {
  const { rok, miesiac, dzien } = rozbij(iso, strefa);
  return `${rok}-${dwucyfrowo(miesiac)}-${dwucyfrowo(dzien)}`;
}

/** Dzisiejsza data lokalna. */
export function dzisiaj(strefa: string = STREFA_DOMYSLNA): string {
  return dataLokalna(terazUtc(), strefa);
}

/** Godzina lokalna w formacie HH:MM — do wyświetlania przy posiłkach. */
export function godzinaLokalna(iso: string, strefa: string = STREFA_DOMYSLNA): string {
  const { godzina, minuta } = rozbij(iso, strefa);
  return `${dwucyfrowo(godzina)}:${dwucyfrowo(minuta)}`;
}

/** Dzień tygodnia jako 1 = poniedziałek … 7 = niedziela (zgodnie z ISO-8601). */
export function dzienTygodnia(iso: string, strefa: string = STREFA_DOMYSLNA): number {
  const { rok, miesiac, dzien } = rozbij(iso, strefa);
  const numer = new Date(Date.UTC(rok, miesiac - 1, dzien)).getUTCDay();
  return numer === 0 ? 7 : numer;
}

/** Przesunięcie strefy względem UTC w minutach, dla konkretnej chwili. */
function offsetMinut(chwila: Date, strefa: string): number {
  const czesci = new Intl.DateTimeFormat("en-US", {
    timeZone: strefa,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(chwila);

  const pobierz = (typ: Intl.DateTimeFormatPartTypes): number =>
    Number(czesci.find((c) => c.type === typ)?.value ?? 0);

  const jakoUtc = Date.UTC(
    pobierz("year"),
    pobierz("month") - 1,
    pobierz("day"),
    pobierz("hour") % 24,
    pobierz("minute"),
    pobierz("second"),
  );

  return (jakoUtc - chwila.getTime()) / 60_000;
}

const WZORZEC_ZE_STREFA = /(Z|[+-]\d{2}:?\d{2})$/;
const WZORZEC_LOKALNY = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const WZORZEC_GODZINY = /^(\d{2}):(\d{2})$/;

/**
 * Zamienia czas podany przez użytkownika na znacznik UTC.
 *
 * Przyjmuje trzy postacie, bo model rzadko podaje pełne ISO z offsetem:
 *   "2026-08-25T07:00:00Z"  – pełny ISO ze strefą, brany wprost
 *   "2026-08-24 20:00"      – czas ścienny w strefie aplikacji
 *   "20:00"                 – godzina dzisiaj w strefie aplikacji
 *
 * Konwersja czasu ściennego jest dwuprzebiegowa, żeby poprawnie trafić
 * w doby zmiany czasu, kiedy offset zależy od wyniku.
 */
export function parsujCzas(tekst: string, strefa: string = STREFA_DOMYSLNA): string {
  const wejscie = tekst.trim();

  if (WZORZEC_ZE_STREFA.test(wejscie)) {
    const data = new Date(wejscie);
    if (Number.isNaN(data.getTime())) {
      throw new Error(`Niepoprawny znacznik czasu: ${tekst}`);
    }
    return data.toISOString();
  }

  const godzinaDzis = WZORZEC_GODZINY.exec(wejscie);
  const pelny = godzinaDzis
    ? WZORZEC_LOKALNY.exec(`${dzisiaj(strefa)}T${wejscie}`)
    : WZORZEC_LOKALNY.exec(wejscie);

  if (!pelny) {
    throw new Error(
      `Nie rozpoznano formatu czasu: "${tekst}". Oczekiwano ISO 8601, "YYYY-MM-DD HH:MM" albo "HH:MM".`,
    );
  }

  const [, rok, miesiac, dzien, godzina, minuta, sekunda] = pelny;
  const scienny = Date.UTC(
    Number(rok),
    Number(miesiac) - 1,
    Number(dzien),
    Number(godzina),
    Number(minuta),
    Number(sekunda ?? 0),
  );

  const pierwszeZgadniecie = new Date(scienny - offsetMinut(new Date(scienny), strefa) * 60_000);
  const poprawiony = offsetMinut(pierwszeZgadniecie, strefa);

  return new Date(scienny - poprawiony * 60_000).toISOString();
}

const WZORZEC_DATY = /^(\d{4})-(\d{2})-(\d{2})$/;

function rozbijDate(data: string): [number, number, number] {
  const dopasowanie = WZORZEC_DATY.exec(data);
  if (!dopasowanie) {
    throw new Error(`Oczekiwano daty w formacie YYYY-MM-DD, otrzymano: ${data}`);
  }
  return [Number(dopasowanie[1]), Number(dopasowanie[2]), Number(dopasowanie[3])];
}

/** Przesuwa datę YYYY-MM-DD o podaną liczbę dni (może być ujemna). */
export function przesunDate(data: string, oDni: number): string {
  const [rok, miesiac, dzien] = rozbijDate(data);
  const przesunieta = new Date(Date.UTC(rok, miesiac - 1, dzien + oDni));
  return `${przesunieta.getUTCFullYear()}-${dwucyfrowo(przesunieta.getUTCMonth() + 1)}-${dwucyfrowo(przesunieta.getUTCDate())}`;
}

/** Lista kolejnych dat od `od` do `do` włącznie — do wykresów i podsumowań. */
export function zakresDat(od: string, doDaty: string): string[] {
  const wynik: string[] = [];
  let biezaca = od;
  // Zabezpieczenie przed pomyloną kolejnością argumentów i nieskończoną pętlą.
  for (let i = 0; i < 3650 && biezaca <= doDaty; i += 1) {
    wynik.push(biezaca);
    biezaca = przesunDate(biezaca, 1);
  }
  return wynik;
}
