/**
 * Aktywności poza planem: bieg, rower, spacer, basen.
 *
 * Osobny byt, celowo ubogi. Trening z planu ma sesję, numerowane serie, cele
 * i porównanie z poprzednim razem — losowa przejażdżka nie ma nic z tych rzeczy
 * i nie ma udawać, że ma. Zapis jest jednostrzałowy: nie trzeba nic otwierać
 * ani zamykać, więc jedno zdanie w czacie albo jeden formularz w aplikacji
 * kończy sprawę.
 *
 * Czego tu świadomie NIE ma: spalonych kalorii. Szacowanie wydatku jest
 * niedokładne, a raz pokazana liczba zaczyna żyć własnym życiem — tym bardziej
 * gdyby miała podnosić dzienny limit jedzenia.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import { dataLokalna, dzisiaj, godzinaLokalna, przesunDate, terazUtc, STREFA_DOMYSLNA } from "../lib/time.js";
import { BladDomeny } from "./bledy.js";
import type { Aktywnosc, DzienAktywnosci, HistoriaAktywnosci, NowaAktywnosc } from "./typy.js";

export type Opcje = { strefa?: string };

/** Najdłuższa aktywność, jaką przyjmujemy — doba to już pomyłka w jednostkach. */
const MAKS_CZAS_S = 24 * 60 * 60;

/** Trzysta kilometrów. Powyżej to literówka, a nie wyjazd. */
const MAKS_DYSTANS_M = 300_000;

function zbuduj(wiersz: repo.WierszAktywnosci, strefa: string): Aktywnosc {
  return { ...wiersz, godzina: godzinaLokalna(wiersz.ts, strefa) };
}

/**
 * Sprawdzenie pól wzorem `sprawdzPolaSerii` z workouts.ts.
 *
 * Wpis bez dystansu i bez czasu przepuszczony do bazy byłby samą nazwą
 * dyscypliny — w historii nie do odróżnienia od pomyłkowego stuknięcia.
 */
function sprawdzPola(dane: NowaAktywnosc): string {
  const dyscyplina = dane.dyscyplina.trim();
  if (dyscyplina === "") {
    throw new BladDomeny("Nazwa aktywności nie może być pusta", "pusta_dyscyplina");
  }

  if (dane.dystans_m == null && dane.czas_s == null) {
    throw new BladDomeny(
      `Aktywność „${dyscyplina}" bez dystansu i bez czasu nic nie mówi — podaj przynajmniej jedno`,
      "brak_czasu_i_dystansu",
    );
  }

  sprawdzWartosci(dane);
  return dyscyplina;
}

/**
 * Zakresy liczb — wspólne dla zapisu i poprawki.
 *
 * Trasa `/wpis` przepuszcza `dane` bez schematu, więc dla aplikacji webowej
 * to jedyna zapora przed „5 km" wpisanym w polu sekund.
 */
export function sprawdzWartosci(dane: {
  dystans_m?: number | null;
  czas_s?: number | null;
  rpe?: number | null;
}): void {
  sprawdzZakres(dane.dystans_m, MAKS_DYSTANS_M, "Dystans", "m", "zly_dystans");
  sprawdzZakres(dane.czas_s, MAKS_CZAS_S, "Czas", "s", "zly_czas");

  if (dane.rpe != null && (!Number.isFinite(dane.rpe) || dane.rpe < 1 || dane.rpe > 10)) {
    throw new BladDomeny(`RPE musi mieścić się w 1–10, otrzymano: ${dane.rpe}`, "zle_rpe");
  }
}

function sprawdzZakres(
  wartosc: number | null | undefined,
  maks: number,
  nazwa: string,
  jednostka: string,
  kod: string,
): void {
  if (wartosc == null) return;
  if (!Number.isFinite(wartosc) || wartosc <= 0 || wartosc > maks) {
    throw new BladDomeny(
      `${nazwa} poza sensownym zakresem: ${wartosc} ${jednostka} (dozwolone 0–${maks})`,
      kod,
    );
  }
}

export function zapiszAktywnosc(db: Baza, dane: NowaAktywnosc, opcje: Opcje = {}): Aktywnosc {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const dyscyplina = sprawdzPola(dane);
  const ts = dane.ts ?? terazUtc();

  const id = repo.wstawAktywnosc(db, {
    ts,
    data_lokalna: dataLokalna(ts, strefa),
    dyscyplina,
    dystans_m: dane.dystans_m ?? null,
    czas_s: dane.czas_s ?? null,
    rpe: dane.rpe ?? null,
    notatka: dane.notatka?.trim() || null,
    zrodlo: dane.zrodlo ?? "czat",
    utworzono: terazUtc(),
  });

  const zapisana = repo.aktywnoscPoId(db, id);
  if (!zapisana) throw new Error(`Nie udało się odczytać zapisanej aktywności o id ${id}`);
  return zbuduj(zapisana, strefa);
}

export function aktywnosciZDnia(db: Baza, data?: string, opcje: Opcje = {}): Aktywnosc[] {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  return repo.aktywnosciZDnia(db, data ?? dzisiaj(strefa)).map((w) => zbuduj(w, strefa));
}

const sumujPole = (lista: Aktywnosc[], pole: "dystans_m" | "czas_s"): number =>
  lista.reduce((suma, a) => suma + (a[pole] ?? 0), 0);

/**
 * Historia pogrupowana po dniach, najnowszy pierwszy.
 *
 * Kształt i mechanika okna jak w `historiaDiety`: `przed` wskazuje dzień, PRZED
 * którym zaczyna się kolejna strona, żeby „Pokaż starsze" nie powtarzało
 * ostatniego dnia z poprzedniej porcji.
 */
export function historiaAktywnosci(
  db: Baza,
  opcje: Opcje & { dni?: number; przed?: string } = {},
): HistoriaAktywnosci {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const dni = opcje.dni ?? 14;
  const koniec = opcje.przed ? przesunDate(opcje.przed, -1) : dzisiaj(strefa);
  const od = przesunDate(koniec, -(dni - 1));

  const poDniu = new Map<string, Aktywnosc[]>();
  for (const wiersz of repo.aktywnosciZZakresu(db, od, koniec)) {
    const aktywnosc = zbuduj(wiersz, strefa);
    const lista = poDniu.get(wiersz.data_lokalna);
    if (lista) lista.push(aktywnosc);
    else poDniu.set(wiersz.data_lokalna, [aktywnosc]);
  }

  return {
    od,
    do: koniec,
    dni: [...poDniu.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([data, lista]): DzienAktywnosci => ({
        data,
        dystans_m: sumujPole(lista, "dystans_m"),
        czas_s: sumujPole(lista, "czas_s"),
        aktywnosci: lista,
      })),
  };
}

/** Statystyka tygodnia — liczby do raportu, bez żadnej oceny. */
export type StatAktywnosci = {
  ile: number;
  czas_s: number;
  dystans_m: number;
  dyscypliny: { nazwa: string; ile: number; czas_s: number; dystans_m: number }[];
};

export const BRAK_AKTYWNOSCI: StatAktywnosci = {
  ile: 0,
  czas_s: 0,
  dystans_m: 0,
  dyscypliny: [],
};

export function statAktywnosci(db: Baza, od: string, doDaty: string): StatAktywnosci {
  const dyscypliny = repo.agregatAktywnosci(db, od, doDaty);

  return {
    ile: dyscypliny.reduce((s, d) => s + d.ile, 0),
    czas_s: dyscypliny.reduce((s, d) => s + d.czas_s, 0),
    dystans_m: dyscypliny.reduce((s, d) => s + d.dystans_m, 0),
    dyscypliny,
  };
}
