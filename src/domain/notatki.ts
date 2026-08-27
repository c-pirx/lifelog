/**
 * Notatki: dziennik myśli i spraw roboczych.
 *
 * Piąty byt obok posiłków, serii, aktywności i wagi — jedyny, który nic nie
 * mierzy. System go przechowuje i pokazuje, ale niczego z niego nie liczy:
 * notatka nie wchodzi do raportu tygodnia, nie zmienia oceny „lepiej / gorzej"
 * i nie pojawia się w bilansie dnia. Tekst nie jest pomiarem.
 *
 * Notatka niesie DWIE wersje tego samego: `tresc` oczyszczoną przez model
 * i `surowe_wejscie` — dokładną transkrypcję. Czyszczenie robi Claude po drodze
 * (patrz opis narzędzia `notatki`), bo serwer nie ma połączenia z żadnym
 * modelem. Domena pilnuje tylko tego, żeby oryginał raz zapisany został
 * nietknięty: poprawki go nie dotykają.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import { dataLokalna, godzinaLokalna, terazUtc, STREFA_DOMYSLNA } from "../lib/time.js";
import { BladDomeny } from "./bledy.js";
import {
  KATEGORIA_DOMYSLNA,
  KATEGORIE_NOTATEK,
  type FolderNotatek,
  type HistoriaNotatek,
  type KategoriaNotatki,
  type Notatka,
  type NowaNotatka,
} from "./typy.js";

export type Opcje = { strefa?: string };

/**
 * Dwadzieścia tysięcy znaków to kilkadziesiąt minut dyktowania bez przerwy.
 * Powyżej to nie notatka, tylko wklejony plik.
 */
const MAKS_DLUGOSC = 20_000;

/** Tytuł ma się mieścić w jednej linii listy — dłuższy i tak zostałby przycięty. */
const MAKS_TYTUL = 120;

const DOMYSLNIE_NOTATEK = 30;
const MAKS_NOTATEK = 200;

function zbuduj(wiersz: repo.WierszNotatki, strefa: string): Notatka {
  return { ...wiersz, godzina: godzinaLokalna(wiersz.ts, strefa) };
}

/**
 * Treść po przycięciu białych znaków. Wspólne dla zapisu i poprawki, bo trasa
 * `/wpis` przepuszcza `dane` bez schematu i to jedyna zapora przed pustym wpisem.
 */
export function sprawdzTresc(tresc: unknown): string {
  if (typeof tresc !== "string" || tresc.trim() === "") {
    throw new BladDomeny("Notatka bez treści nic nie mówi", "pusta_tresc");
  }

  const przycieta = tresc.trim();
  if (przycieta.length > MAKS_DLUGOSC) {
    throw new BladDomeny(
      `Notatka ma ${przycieta.length} znaków, a mieści się ${MAKS_DLUGOSC}`,
      "za_dluga_notatka",
    );
  }

  return przycieta;
}

/** Nieznany folder to pomyłka po stronie wywołującego, a nie powód do worka. */
export function sprawdzKategorie(kategoria: unknown): KategoriaNotatki {
  if (kategoria == null) return KATEGORIA_DOMYSLNA;

  if (!KATEGORIE_NOTATEK.includes(kategoria as KategoriaNotatki)) {
    throw new BladDomeny(
      `Nieznana kategoria notatki: "${String(kategoria)}". Dozwolone: ${KATEGORIE_NOTATEK.join(", ")}`,
      "zla_kategoria",
    );
  }

  return kategoria as KategoriaNotatki;
}

/** Pusty tytuł zapisujemy jako brak — lista bierze wtedy początek treści. */
export function przytnijTytul(tytul: unknown): string | null {
  if (tytul == null) return null;
  if (typeof tytul !== "string") {
    throw new BladDomeny("Tytuł notatki musi być tekstem", "zly_tytul");
  }
  return tytul.trim().slice(0, MAKS_TYTUL) || null;
}

export function zapiszNotatke(db: Baza, dane: NowaNotatka, opcje: Opcje = {}): Notatka {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const tresc = sprawdzTresc(dane.tresc);
  const kategoria = sprawdzKategorie(dane.kategoria);
  const ts = dane.ts ?? terazUtc();

  const id = repo.wstawNotatke(db, {
    ts,
    data_lokalna: dataLokalna(ts, strefa),
    kategoria,
    tytul: przytnijTytul(dane.tytul),
    tresc,
    // Surowe wejście zapisujemy takie, jakie przyszło — bez przycinania sensu.
    // Sam trim, żeby puste pole nie udawało transkrypcji.
    surowe_wejscie: dane.surowe_wejscie?.trim() || null,
    zrodlo: dane.zrodlo ?? "czat",
    utworzono: terazUtc(),
  });

  const zapisana = repo.notatkaPoId(db, id);
  if (!zapisana) throw new Error(`Nie udało się odczytać zapisanej notatki o id ${id}`);
  return zbuduj(zapisana, strefa);
}

/**
 * Wszystkie foldery, w każdym najnowsze `ile` notatek.
 *
 * Foldery zwracamy ZAWSZE komplet, także puste: folder, który znika przy zerze,
 * przestaje być folderem, a użytkownik nie wie, gdzie właściwie dyktować.
 * Kolejność ustala `KATEGORIE_NOTATEK` i tylko ona.
 *
 * Stronicowanie idzie liczbą, nie oknem dni — inaczej niż dieta i ruch, tak samo
 * jak archiwum raportów. Dziennik czyta się „ostatnie trzydzieści"; przy dwóch
 * notatkach w miesiącu okno dni pokazywałoby pustkę mimo pełnego folderu.
 */
export function historiaNotatek(
  db: Baza,
  opcje: Opcje & { ile?: number } = {},
): HistoriaNotatek {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const zadane = Number(opcje.ile ?? DOMYSLNIE_NOTATEK);
  const ile = Number.isFinite(zadane)
    ? Math.min(Math.max(Math.floor(zadane), 1), MAKS_NOTATEK)
    : DOMYSLNIE_NOTATEK;

  const stat = new Map(repo.agregatNotatek(db).map((w) => [w.kategoria, w]));

  const foldery = KATEGORIE_NOTATEK.map((kategoria): FolderNotatek => {
    const podsumowanie = stat.get(kategoria);

    return {
      kategoria,
      ile: podsumowanie?.ile ?? 0,
      ostatnia: podsumowanie?.ostatnia ?? null,
      // Pusty folder nie potrzebuje zapytania — trzy karty to trzy odczyty,
      // a zwykle notatki leżą w jednym albo dwóch.
      notatki: podsumowanie
        ? repo.notatkiZKategorii(db, kategoria, ile).map((w) => zbuduj(w, strefa))
        : [],
    };
  });

  return { ile, foldery };
}
