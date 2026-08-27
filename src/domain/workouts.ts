/**
 * Treningi: plan, sesje, serie i stan trwającego treningu.
 *
 * Stan sesji żyje w bazie, nie w rozmowie — dlatego Claude i aplikacja webowa
 * zawsze widzą to samo, niezależnie od tego, przez które wejście przyszła seria.
 */

import type { Baza } from "../db/index.js";
import * as repo from "../db/repo.js";
import {
  dataLokalna,
  dzienTygodnia,
  godzinaLokalna,
  terazUtc,
  STREFA_DOMYSLNA,
} from "../lib/time.js";
import { BladDomeny } from "./bledy.js";
import type {
  Cwiczenie,
  CwiczenieWDniu,
  DzienPlanu,
  NowaSeria,
  CwiczenieWSesji,
  Plan,
  PlanNaDzis,
  PostepCwiczenia,
  Propozycja,
  Seria,
  Sesja,
  SesjaZWynikami,
  StanTreningu,
  TypCwiczenia,
  ZrodloPropozycji,
} from "./typy.js";

export type Opcje = { strefa?: string; ts?: string };

// === ĆWICZENIA ==========================================================

/** Zwraca ćwiczenie o podanej nazwie, tworząc je, jeśli jeszcze nie istnieje. */
export function zapewnijCwiczenie(
  db: Baza,
  nazwa: string,
  typ: TypCwiczenia = "silowe",
  partia: string | null = null,
): Cwiczenie {
  const przycieta = nazwa.trim();
  if (przycieta === "") throw new BladDomeny("Nazwa ćwiczenia nie może być pusta", "pusta_nazwa");

  const istniejace = repo.cwiczeniePoNazwie(db, przycieta);
  if (istniejace) return istniejace;

  const id = repo.wstawCwiczenie(db, przycieta, typ, partia);
  return { id, nazwa: przycieta, typ, partia };
}

function znajdzCwiczenie(db: Baza, nazwa: string): Cwiczenie {
  const cwiczenie = repo.cwiczeniePoNazwie(db, nazwa.trim());
  if (!cwiczenie) {
    throw new BladDomeny(`Nie znaleziono ćwiczenia o nazwie "${nazwa}"`, "nieznane_cwiczenie");
  }
  return cwiczenie;
}

// === PLAN ===============================================================

export type NoweCwiczenieWPlanie = {
  nazwa: string;
  typ?: TypCwiczenia;
  partia?: string;
  serie_cel?: number;
  powt_cel?: string;
  czas_cel_s?: number;
  dystans_cel_m?: number;
  ciezar_cel_kg?: number;
};

export type NowyDzienPlanu = {
  kod: string;
  nazwa: string;
  dzien_tygodnia?: number | null;
  /** Nazwa planu. Pominięta — dzień trafia do planu domyślnego. */
  plan?: string;
  cwiczenia: NoweCwiczenieWPlanie[];
};

export type NowyPlan = {
  nazwa: string;
  opis?: string | null;
  /** Czy plan ma od razu przejąć harmonogram. Pierwszy plan w bazie zawsze przejmuje. */
  domyslny?: boolean;
  dni: NowyDzienPlanu[];
};

const PIERWSZY_PLAN = "Mój plan";

/**
 * Plan, do którego trafia dzień bez wskazanej nazwy planu.
 *
 * W pustej bazie tworzy go od ręki: dyktowanie planu Claude'owi nie może
 * wymagać osobnego kroku „najpierw załóż plan".
 */
function zapewnijPlan(db: Baza, nazwa?: string): repo.WierszPlanu {
  if (nazwa !== undefined) {
    const przycieta = nazwa.trim();
    if (przycieta === "") throw new BladDomeny("Nazwa planu nie może być pusta", "pusta_nazwa_planu");

    const istniejacy = repo.planPoNazwie(db, przycieta);
    if (istniejacy) return istniejacy;

    // Pierwszy plan w bazie od razu przejmuje harmonogram — inaczej aplikacja
    // po dodaniu planu nadal twierdziłaby, że nie ma dziś czego trenować.
    const id = repo.wstawPlan(db, przycieta, null, repo.planDomyslny(db) === undefined);
    return repo.planPoId(db, id) as repo.WierszPlanu;
  }

  const domyslny = repo.planDomyslny(db);
  if (domyslny) return domyslny;

  const id = repo.wstawPlan(db, PIERWSZY_PLAN, null, true);
  return repo.planPoId(db, id) as repo.WierszPlanu;
}

/**
 * Zapisuje dzień planu. Ponowne wywołanie z tym samym kodem nadpisuje dzień
 * w całości — plan jest dyktowany Claude'owi i łatwiej podać go od nowa,
 * niż opisywać różnicę. Kod rozstrzyga się w obrębie planu, nie globalnie.
 */
export function dodajDzienPlanu(db: Baza, dane: NowyDzienPlanu): DzienPlanu {
  const kod = dane.kod.trim();
  if (kod === "") throw new BladDomeny("Kod dnia planu nie może być pusty", "pusty_kod");

  const dzienTyg = dane.dzien_tygodnia ?? null;
  if (dzienTyg !== null && (dzienTyg < 1 || dzienTyg > 7)) {
    throw new BladDomeny(
      `Dzień tygodnia musi być w zakresie 1–7 (1 = poniedziałek), otrzymano: ${dzienTyg}`,
      "zly_dzien_tygodnia",
    );
  }

  const id = db.transaction(() => {
    const plan = zapewnijPlan(db, dane.plan);
    return zapiszDzien(db, plan.id, { ...dane, kod, dzien_tygodnia: dzienTyg });
  })();

  const zapisany = dzienPlanuPoId(db, id);
  if (!zapisany) throw new Error(`Nie udało się odczytać zapisanego dnia planu o id ${id}`);
  return zapisany;
}

/** Wspólne wnętrze zapisu dnia — używane pojedynczo i przy zapisie całego planu. */
function zapiszDzien(db: Baza, planId: number, dane: NowyDzienPlanu): number {
  const kod = dane.kod.trim();
  const istniejacy = repo.dzienPlanuPoKodzie(db, kod, planId);

  const dzienId = istniejacy
    ? (repo.aktualizujDzienPlanu(db, istniejacy.id, {
        kod,
        nazwa: dane.nazwa,
        dzien_tygodnia: dane.dzien_tygodnia ?? null,
        // Dzień wracający do planu po nadpisaniu ma znów być widoczny.
        aktywny: 1,
      }),
      istniejacy.id)
    : repo.wstawDzienPlanu(db, planId, kod, dane.nazwa, dane.dzien_tygodnia ?? null);

  repo.usunCwiczeniaWDniu(db, dzienId);

  dane.cwiczenia.forEach((c, indeks) => {
    const cwiczenie = zapewnijCwiczenie(db, c.nazwa, c.typ ?? "silowe", c.partia ?? null);
    repo.wstawCwiczenieWDniu(db, {
      dzien_id: dzienId,
      cwiczenie_id: cwiczenie.id,
      kolejnosc: indeks + 1,
      serie_cel: c.serie_cel ?? null,
      powt_cel: c.powt_cel ?? null,
      czas_cel_s: c.czas_cel_s ?? null,
      dystans_cel_m: c.dystans_cel_m ?? null,
      ciezar_cel_kg: c.ciezar_cel_kg ?? null,
    });
  });

  return dzienId;
}

/**
 * Tworzy albo nadpisuje cały plan wraz z dniami.
 *
 * Dni nieobecne w nowej wersji **gasną** (`aktywny = 0`) zamiast zniknąć:
 * usunięcie wywróciłoby się na kluczu obcym dokładnie wtedy, kiedy najbardziej
 * boli — gdy dzień ma za sobą miesiące rozegranych sesji.
 */
export function zapiszPlan(db: Baza, dane: NowyPlan): Plan {
  const nazwa = dane.nazwa.trim();
  if (nazwa === "") throw new BladDomeny("Nazwa planu nie może być pusta", "pusta_nazwa_planu");

  const id = db.transaction(() => {
    const plan = zapewnijPlan(db, nazwa);
    if (dane.opis !== undefined) repo.aktualizujPlan(db, plan.id, { opis: dane.opis });

    for (const dzien of dane.dni) zapiszDzien(db, plan.id, dzien);
    repo.wygasDniPozaLista(db, plan.id, dane.dni.map((d) => d.kod.trim()));

    if (dane.domyslny) {
      repo.wyczyscDomyslny(db);
      repo.aktualizujPlan(db, plan.id, { domyslny: 1 });
    }

    return plan.id;
  })();

  return zbudujPlan(db, repo.planPoId(db, id) as repo.WierszPlanu);
}

/** Przełącza plan rządzący harmonogramem. Zdjęcie i założenie flagi w jednej transakcji. */
export function ustawPlanDomyslny(db: Baza, nazwa: string): Plan {
  const plan = repo.planPoNazwie(db, nazwa.trim());
  if (!plan) throw new BladDomeny(`Nie znaleziono planu o nazwie "${nazwa}"`, "nieznany_plan");

  db.transaction(() => {
    repo.wyczyscDomyslny(db);
    repo.aktualizujPlan(db, plan.id, { domyslny: 1 });
  })();

  return zbudujPlan(db, repo.planPoId(db, plan.id) as repo.WierszPlanu);
}

function zbudujDzien(wiersz: repo.WierszDniaPlanu, cwiczenia: repo.WierszCwiczeniaWDniu[]): DzienPlanu {
  return {
    id: wiersz.id,
    plan_id: wiersz.plan_id,
    kod: wiersz.kod,
    nazwa: wiersz.nazwa,
    dzien_tygodnia: wiersz.dzien_tygodnia,
    aktywny: wiersz.aktywny === 1,
    cwiczenia: cwiczenia.map(
      ({ dzien_id: _pomijamy, ...reszta }): CwiczenieWDniu => reszta,
    ),
  };
}

function zbudujPlan(db: Baza, wiersz: repo.WierszPlanu): Plan {
  return {
    id: wiersz.id,
    nazwa: wiersz.nazwa,
    opis: wiersz.opis,
    domyslny: wiersz.domyslny === 1,
    dni: repo
      .dniPlanu(db, wiersz.id)
      .filter((d) => d.aktywny === 1)
      .map((d) => zbudujDzien(d, repo.cwiczeniaWDniu(db, d.id))),
  };
}

/** Wszystkie plany z dniami; domyślny pierwszy. */
export function plany(db: Baza): Plan[] {
  return repo.plany(db).map((w) => zbudujPlan(db, w));
}

export function planDomyslny(db: Baza): Plan | null {
  const wiersz = repo.planDomyslny(db);
  return wiersz ? zbudujPlan(db, wiersz) : null;
}

function dzienPlanuPoId(db: Baza, id: number): DzienPlanu | null {
  const wiersz = repo.dzienPlanuPoId(db, id);
  if (!wiersz) return null;
  return zbudujDzien(wiersz, repo.cwiczeniaWDniu(db, id));
}

/** Dzień szukany w planie domyślnym, o ile nie wskazano innego. */
export function dzienPlanu(db: Baza, kod: string, plan?: string): DzienPlanu | null {
  const wPlanie = plan !== undefined ? repo.planPoNazwie(db, plan.trim()) : repo.planDomyslny(db);
  if (!wPlanie) return null;

  const wiersz = repo.dzienPlanuPoKodzie(db, kod, wPlanie.id);
  if (!wiersz) return null;
  return zbudujDzien(wiersz, repo.cwiczeniaWDniu(db, wiersz.id));
}

/** Dni planu domyślnego — to, co dotąd znaczyło „plan treningowy". */
export function planTreningowy(db: Baza): DzienPlanu[] {
  return planDomyslny(db)?.dni ?? [];
}

export function usunDzienPlanu(db: Baza, kod: string, plan?: string): boolean {
  const wPlanie = plan !== undefined ? repo.planPoNazwie(db, plan.trim()) : repo.planDomyslny(db);
  if (!wPlanie) return false;

  const wiersz = repo.dzienPlanuPoKodzie(db, kod, wPlanie.id);
  if (!wiersz) return false;
  return repo.usunDzienPlanu(db, wiersz.id) > 0;
}

// === SESJE ==============================================================

function zbudujSesje(wiersz: repo.WierszSesji): Sesja {
  return wiersz;
}

export function aktywnaSesja(db: Baza): Sesja | null {
  const wiersz = repo.aktywnaSesja(db);
  return wiersz ? zbudujSesje(wiersz) : null;
}

export type OpcjeStartu = Opcje & {
  /**
   * Droga aplikacji: id jest jednoznaczne również wtedy, gdy dwa plany mają
   * dzień o tym samym kodzie.
   */
  dzien_id?: number;
  kod?: string;
  /** Plan, w którym szukać kodu. Pominięty — plan domyślny. */
  plan?: string;
  /**
   * Sesja bez dnia planu — świadomie, a nie z braku kodu. Samo pominięcie
   * `kod` sięga do harmonogramu, więc w poniedziałek otworzyłoby dzień A
   * zamiast pustego treningu.
   */
  bez_planu?: boolean;
};

/**
 * Dzień, który harmonogram przewiduje na daną chwilę.
 *
 * Jedno wywołanie dla dwóch pytań: „co otworzyć" przy starcie sesji i „co dziś"
 * na ekranie Trening. Dwie kopie tego wyboru rozjechałyby się przy pierwszej
 * poprawce, a użytkownik zobaczyłby komunikat o innym dniu, niż odpaliłby
 * przycisk. Harmonogram czyta wyłącznie plan domyślny — szablon z ustawionym
 * dniem tygodnia nie ma prawa przejąć poniedziałku.
 */
function dzienZHarmonogramu(
  db: Baza,
  ts: string,
  strefa: string,
): repo.WierszDniaPlanu | undefined {
  const domyslny = repo.planDomyslny(db);
  return domyslny
    ? repo.dzienPlanuNaDzienTygodnia(db, dzienTygodnia(ts, strefa), domyslny.id)
    : undefined;
}

/**
 * Który dzień otwiera sesja. Kolejność jest tu całą regułą: jawne wskazanie
 * bije domyślanie się, a `bez_planu` bije wszystko.
 */
function dzienNaStart(
  db: Baza,
  opcje: OpcjeStartu,
  ts: string,
  strefa: string,
): repo.WierszDniaPlanu | undefined {
  if (opcje.bez_planu) return undefined;

  if (opcje.dzien_id !== undefined) {
    const dzien = repo.dzienPlanuPoId(db, opcje.dzien_id);
    if (!dzien) {
      throw new BladDomeny(`Nie znaleziono dnia planu o id ${opcje.dzien_id}`, "nieznany_dzien");
    }
    return dzien;
  }

  if (opcje.kod) {
    const plan = opcje.plan !== undefined ? repo.planPoNazwie(db, opcje.plan.trim()) : repo.planDomyslny(db);
    if (!plan) {
      throw new BladDomeny(
        opcje.plan !== undefined
          ? `Nie znaleziono planu o nazwie "${opcje.plan}"`
          : "Nie ma jeszcze żadnego planu treningowego",
        "nieznany_plan",
      );
    }

    const dzien = repo.dzienPlanuPoKodzie(db, opcje.kod, plan.id);
    if (!dzien) {
      throw new BladDomeny(
        `Nie znaleziono dnia planu o kodzie "${opcje.kod}" w planie "${plan.nazwa}"`,
        "nieznany_dzien",
      );
    }
    return dzien;
  }

  return dzienZHarmonogramu(db, ts, strefa);
}

export function rozpocznijTrening(db: Baza, opcje: OpcjeStartu = {}): Sesja {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const ts = opcje.ts ?? terazUtc();

  const otwarta = repo.aktywnaSesja(db);
  if (otwarta) {
    throw new BladDomeny(
      `Masz już aktywną sesję rozpoczętą ${otwarta.data_lokalna}` +
        `${otwarta.dzien_kod ? ` (dzień ${otwarta.dzien_kod})` : ""}. ` +
        "Zakończ ją, zanim zaczniesz nową.",
      "sesja_juz_aktywna",
    );
  }

  const dzien = dzienNaStart(db, opcje, ts, strefa);

  const id = repo.wstawSesje(db, {
    dzien_id: dzien?.id ?? null,
    start_ts: ts,
    data_lokalna: dataLokalna(ts, strefa),
  });

  const sesja = repo.sesjaPoId(db, id);
  if (!sesja) throw new Error(`Nie udało się odczytać rozpoczętej sesji o id ${id}`);
  return zbudujSesje(sesja);
}

export type OpcjeKonca = Opcje & { notatki?: string; status?: "zakonczona" | "porzucona" };

export function zakonczTrening(db: Baza, opcje: OpcjeKonca = {}): Sesja {
  const otwarta = repo.aktywnaSesja(db);
  if (!otwarta) {
    throw new BladDomeny("Nie ma otwartej sesji treningowej do zakończenia", "brak_sesji");
  }

  repo.zamknijSesje(
    db,
    otwarta.id,
    opcje.status ?? "zakonczona",
    opcje.ts ?? terazUtc(),
    opcje.notatki ?? null,
  );

  const zamknieta = repo.sesjaPoId(db, otwarta.id);
  if (!zamknieta) throw new Error(`Nie udało się odczytać zamkniętej sesji o id ${otwarta.id}`);
  return zbudujSesje(zamknieta);
}

// === SERIE ==============================================================

function sprawdzPolaSerii(typ: TypCwiczenia, dane: NowaSeria, nazwa: string): void {
  if (typ === "silowe" && (dane.powtorzenia == null || dane.powtorzenia <= 0)) {
    throw new BladDomeny(
      `Ćwiczenie "${nazwa}" jest siłowe — podaj liczbę powtórzeń`,
      "brak_powtorzen",
    );
  }

  if (typ === "cardio" && dane.czas_s == null && dane.dystans_m == null) {
    throw new BladDomeny(
      `Ćwiczenie "${nazwa}" to cardio — podaj czas lub dystans`,
      "brak_czasu_i_dystansu",
    );
  }

  if (typ === "na_czas" && dane.czas_s == null) {
    throw new BladDomeny(`Ćwiczenie "${nazwa}" jest na czas — podaj czas w sekundach`, "brak_czasu");
  }
}

export function zapiszSerie(db: Baza, dane: NowaSeria, opcje: Opcje = {}): Seria {
  const sesja = repo.aktywnaSesja(db);
  if (!sesja) {
    throw new BladDomeny(
      "Nie ma otwartej sesji treningowej — zacznij trening przed zapisaniem serii",
      "brak_sesji",
    );
  }

  const cwiczenie = zapewnijCwiczenie(db, dane.cwiczenie, dane.typ ?? "silowe");
  sprawdzPolaSerii(cwiczenie.typ, dane, cwiczenie.nazwa);

  // Pola nienależące do typu ćwiczenia zostają puste, żeby historia się nie mieszała.
  const silowe = cwiczenie.typ === "silowe";
  const id = repo.wstawSerie(db, {
    sesja_id: sesja.id,
    cwiczenie_id: cwiczenie.id,
    nr_serii: dane.nr_serii ?? repo.ileSerii(db, sesja.id, cwiczenie.id) + 1,
    powtorzenia: silowe ? (dane.powtorzenia ?? null) : null,
    ciezar_kg: silowe ? (dane.ciezar_kg ?? null) : null,
    czas_s: silowe ? null : (dane.czas_s ?? null),
    dystans_m: cwiczenie.typ === "cardio" ? (dane.dystans_m ?? null) : null,
    rpe: dane.rpe ?? null,
    ts: dane.ts ?? opcje.ts ?? terazUtc(),
  });

  const seria = repo.seriaPoId(db, id);
  if (!seria) throw new Error(`Nie udało się odczytać zapisanej serii o id ${id}`);
  return seria;
}

// === PROPOZYCJA SERII ===================================================

export type CelCwiczenia = Pick<
  CwiczenieWDniu,
  "powt_cel" | "czas_cel_s" | "dystans_cel_m" | "ciezar_cel_kg"
>;

type PoleWyniku = keyof Omit<Propozycja, "zrodlo">;

/** Które pola w ogóle mają sens dla danego typu — te same, których pilnuje `sprawdzPolaSerii`. */
const POLA_TYPU: Record<TypCwiczenia, PoleWyniku[]> = {
  silowe: ["powtorzenia", "ciezar_kg"],
  cardio: ["czas_s", "dystans_m"],
  na_czas: ["czas_s"],
};

/**
 * „8" daje 8. „8-12" i „do upadku" nie dają nic — rozstrzyganie, czy chodziło
 * o dolną czy górną granicę, byłoby narzucaniem progresji, której system
 * świadomie nie narzuca.
 */
function powtorzeniaZCelu(powtCel: string | null): number | null {
  if (powtCel === null) return null;
  const liczba = Number(powtCel.trim());
  return Number.isInteger(liczba) && liczba > 0 ? liczba : null;
}

/**
 * Czy z propozycji da się w ogóle zapisać serię — te same pola, których wymaga
 * `sprawdzPolaSerii`. Bez nich przycisk „odhacz" nie ma czego zapisać
 * i aplikacja musi otworzyć formularz.
 */
function propozycjaKompletna(typ: TypCwiczenia, w: Omit<Propozycja, "zrodlo">): boolean {
  if (typ === "silowe") return w.powtorzenia != null;
  if (typ === "cardio") return w.czas_s != null || w.dystans_m != null;
  return w.czas_s != null;
}

const wynikSerii = (s: Seria): Omit<Propozycja, "zrodlo"> => ({
  powtorzenia: s.powtorzenia,
  ciezar_kg: s.ciezar_kg,
  czas_s: s.czas_s,
  dystans_m: s.dystans_m,
});

/**
 * Liczby, które aplikacja wpisze na przycisk „odhacz serię".
 *
 * Kolejność źródeł jest tu całą regułą: ostatnia seria tej sesji bije cel
 * z planu, bo podbicie ciężaru w trzeciej serii jest faktem, a plan tylko
 * zamiarem sprzed tygodnia. Pola brane są pojedynczo, więc plan podający same
 * powtórzenia dostaje ciężar z poprzedniego treningu.
 *
 * Czysta funkcja bez dostępu do bazy — cała reguła daje się sprawdzić tablicą
 * przypadków, a ten sam wynik dostaje aplikacja, czat i zapis zbiorczy.
 */
export function propozycjaSerii(
  typ: TypCwiczenia,
  cel: CelCwiczenia | null,
  serieTejSesji: Seria[],
  poprzednio: Seria[],
): Propozycja {
  const zrodla: { nazwa: Exclude<ZrodloPropozycji, "brak">; pola: Omit<Propozycja, "zrodlo"> }[] =
    [];

  const ostatnia = serieTejSesji.at(-1);
  if (ostatnia) zrodla.push({ nazwa: "ostatnia_seria", pola: wynikSerii(ostatnia) });

  if (cel) {
    zrodla.push({
      nazwa: "plan",
      pola: {
        powtorzenia: powtorzeniaZCelu(cel.powt_cel),
        ciezar_kg: cel.ciezar_cel_kg,
        czas_s: cel.czas_cel_s,
        dystans_m: cel.dystans_cel_m,
      },
    });
  }

  const poprzednia = poprzednio.at(-1);
  if (poprzednia) zrodla.push({ nazwa: "poprzedni_trening", pola: wynikSerii(poprzednia) });

  const wybrane: Omit<Propozycja, "zrodlo"> = {
    powtorzenia: null,
    ciezar_kg: null,
    czas_s: null,
    dystans_m: null,
  };

  // Źródła stoją już w kolejności pierwszeństwa, więc najmniejszy indeks wśród
  // tych, które cokolwiek wniosły, jest źródłem do pokazania na przycisku.
  let najlepsze = zrodla.length;

  for (const pole of POLA_TYPU[typ]) {
    const indeks = zrodla.findIndex((z) => z.pola[pole] != null);
    if (indeks === -1) continue;

    wybrane[pole] = zrodla[indeks]?.pola[pole] ?? null;
    najlepsze = Math.min(najlepsze, indeks);
  }

  // Niekompletna propozycja zachowuje zebrane liczby — formularz może się nimi
  // wypełnić — ale melduje „brak", żeby aplikacja nie pokazała przycisku.
  const zrodlo =
    najlepsze < zrodla.length && propozycjaKompletna(typ, wybrane)
      ? (zrodla[najlepsze]?.nazwa ?? "brak")
      : "brak";

  return { ...wybrane, zrodlo };
}

// === STAN TRENINGU ======================================================

/**
 * Porównanie serii z najlepszą z podanych: ujemne — słabsza, zero — tyle samo,
 * dodatnie — lepsza. Świadomie prosta reguła; system pokazuje fakty, decyzję
 * o progresji podejmuje użytkownik.
 *
 * Jedna miarka dla obu odczytów: „słabsza niż poprzednio" i „rekord" muszą
 * mierzyć tak samo, bo inaczej ta sama seria umiałaby być jednocześnie słabsza
 * i rekordowa.
 */
function porownajZNajlepsza(seria: Seria, inne: Seria[], typ: TypCwiczenia): number {
  const maks = (wartosci: (number | null)[]): number =>
    wartosci.reduce<number>((n, w) => Math.max(n, w ?? 0), 0);

  if (typ === "silowe") {
    const najwiekszyCiezar = maks(inne.map((s) => s.ciezar_kg));
    const ciezar = seria.ciezar_kg ?? 0;

    if (ciezar !== najwiekszyCiezar) return ciezar - najwiekszyCiezar;

    // Ten sam ciężar — rozstrzyga liczba powtórzeń.
    const najwiecejPowtorzen = maks(
      inne.filter((s) => (s.ciezar_kg ?? 0) === najwiekszyCiezar).map((s) => s.powtorzenia),
    );
    return (seria.powtorzenia ?? 0) - najwiecejPowtorzen;
  }

  if (typ === "cardio") {
    const najdalej = maks(inne.map((s) => s.dystans_m));
    if (najdalej > 0) return (seria.dystans_m ?? 0) - najdalej;
  }

  return (seria.czas_s ?? 0) - maks(inne.map((s) => s.czas_s));
}

/** Czy seria wypadła słabiej niż najlepsza seria z poprzedniego razu. */
const czySlabsza = (seria: Seria, poprzednie: Seria[], typ: TypCwiczenia): boolean =>
  poprzednie.length > 0 && porownajZNajlepsza(seria, poprzednie, typ) < 0;

/**
 * Czy seria pobiła wszystko, co zapisano przed tą sesją. Przy pierwszym w życiu
 * podejściu do ćwiczenia rekordu nie ma — nie ma czego bić.
 */
const czyRekord = (seria: Seria, wczesniejsze: Seria[], typ: TypCwiczenia): boolean =>
  wczesniejsze.length > 0 && porownajZNajlepsza(seria, wczesniejsze, typ) > 0;

/** Ćwiczenie spoza planu dnia nie ma celu — stąd `null` zamiast pustego obiektu. */
type CelWPostepie = (CelCwiczenia & { serie_cel: number | null }) | null;

function zbudujPostep(
  db: Baza,
  cwiczenie: { id: number; nazwa: string; typ: TypCwiczenia },
  cel: CelWPostepie,
  serieSesji: Seria[],
  sesjaId: number,
): PostepCwiczenia {
  const serie = serieSesji.filter((s) => s.cwiczenie_id === cwiczenie.id);
  const poprzednio = repo.serieZPoprzedniegoRazu(db, cwiczenie.id, sesjaId);
  const wczesniejsze = repo.serieCwiczeniaPrzedSesja(db, cwiczenie.id, sesjaId);

  return {
    cwiczenie_id: cwiczenie.id,
    nazwa: cwiczenie.nazwa,
    typ: cwiczenie.typ,
    serie_cel: cel?.serie_cel ?? null,
    powt_cel: cel?.powt_cel ?? null,
    serie_zrobione: serie.length,
    serie,
    poprzednio,
    slabsze_niz_poprzednio: serie
      .filter((s) => czySlabsza(s, poprzednio, cwiczenie.typ))
      .map((s) => s.nr_serii),
    rekordy: serie
      .filter((s) => czyRekord(s, wczesniejsze, cwiczenie.typ))
      .map((s) => s.nr_serii),
    propozycja: propozycjaSerii(cwiczenie.typ, cel, serie, poprzednio),
    ukonczone: cel?.serie_cel ? serie.length >= cel.serie_cel : serie.length > 0,
  };
}

const PUSTY_STAN: StanTreningu = {
  sesja: null,
  wg_planu: [],
  poza_planem: [],
  ukonczone_cwiczen: 0,
  wszystkich_cwiczen: 0,
  pozostalo: [],
};

export function stanTreningu(db: Baza): StanTreningu {
  const wiersz = repo.aktywnaSesja(db);
  if (!wiersz) return PUSTY_STAN;

  const sesja = zbudujSesje(wiersz);
  const serie = repo.serieSesji(db, sesja.id);
  const plan = sesja.dzien_id ? repo.cwiczeniaWDniu(db, sesja.dzien_id) : [];

  const wgPlanu = plan.map((c) =>
    zbudujPostep(
      db,
      { id: c.cwiczenie_id, nazwa: c.nazwa, typ: c.typ },
      c,
      serie,
      sesja.id,
    ),
  );

  const wPlanie = new Set(plan.map((c) => c.cwiczenie_id));
  const dodatkowe = new Map<number, Seria>();
  for (const s of serie) {
    if (!wPlanie.has(s.cwiczenie_id) && !dodatkowe.has(s.cwiczenie_id)) {
      dodatkowe.set(s.cwiczenie_id, s);
    }
  }

  const pozaPlanem = [...dodatkowe.values()].map((s) =>
    zbudujPostep(
      db,
      { id: s.cwiczenie_id, nazwa: s.nazwa, typ: s.typ },
      null,
      serie,
      sesja.id,
    ),
  );

  return {
    sesja,
    wg_planu: wgPlanu,
    poza_planem: pozaPlanem,
    ukonczone_cwiczen: wgPlanu.filter((c) => c.ukonczone).length,
    wszystkich_cwiczen: wgPlanu.length,
    pozostalo: wgPlanu.filter((c) => !c.ukonczone).map((c) => c.nazwa),
  };
}

// === CO DZIŚ ============================================================

/**
 * Co harmonogram przewiduje na dziś i czy to już za nami.
 *
 * Dzień wybierany jest tą samą drogą, którą otwiera go start treningu
 * (`dzienZHarmonogramu`) — komunikat i przycisk mają dotyczyć tego samego dnia.
 *
 * Realizację czyta `historiaSesji`, ta sama, którą pokazuje zakładka
 * Aktywności. Niesie już obie potrzebne reguły: liczy wyłącznie sesje
 * ZAKOŃCZONE i mające choć jedną serię. Porzucona sesja mówi wprost, że
 * treningu nie było, a pusta jest śladem po otwarciu i zamknięciu ekranu.
 *
 * `ts` w opcjach jest po to, żeby testy nie zależały od dzisiejszej daty.
 */
export function planNaDzis(db: Baza, opcje: Opcje = {}): PlanNaDzis {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const ts = opcje.ts ?? terazUtc();
  const data = dataLokalna(ts, strefa);

  const wiersz = dzienZHarmonogramu(db, ts, strefa);
  if (!wiersz) return { data, dzien: null, zrealizowany: false };

  const dzien = zbudujDzien(wiersz, repo.cwiczeniaWDniu(db, wiersz.id));

  // Porównanie po `dzien_id`, a nie po kodzie: kod jest unikalny w obrębie
  // planu, więc trening z szablonu o tym samym kodzie zgasiłby dzisiejszy dzień,
  // choć go nie wykonał.
  const zrealizowany = historiaSesji(db, data, data, { strefa }).some(
    (sesja) => sesja.dzien_id === dzien.id,
  );

  return { data, dzien, zrealizowany };
}

// === ODHACZANIE CAŁEGO ĆWICZENIA ========================================

export type DaneOdhaczenia = {
  cwiczenie: string;
  /** Wymagane tylko wtedy, gdy plan nie podaje celu serii. */
  ile?: number;
};

/**
 * Dopisuje brakujące serie ćwiczenia z liczbami stojącymi na przycisku.
 *
 * Odhaczenie całego ćwiczenia znaczy „zrobiłem wszystkie serie z założonym
 * obciążeniem", więc każda dopisana seria dostaje tę samą propozycję. Liczy ją
 * serwer, a nie aplikacja — gdyby liczyła aplikacja, czat i telefon umiałyby
 * zapisać za ten sam trening co innego.
 *
 * Całość w transakcji: ćwiczenie dopisane w połowie byłoby gorsze niż błąd.
 */
export function odhaczCwiczenie(
  db: Baza,
  dane: DaneOdhaczenia,
  opcje: Opcje = {},
): StanTreningu {
  const sesja = repo.aktywnaSesja(db);
  if (!sesja) {
    throw new BladDomeny("Nie ma otwartej sesji treningowej", "brak_sesji");
  }

  const cwiczenie = znajdzCwiczenie(db, dane.cwiczenie);
  const stan = stanTreningu(db);
  const postep = [...stan.wg_planu, ...stan.poza_planem].find(
    (c) => c.cwiczenie_id === cwiczenie.id,
  );

  // Ćwiczenie spoza planu bez ani jednej serii nie pojawia się jeszcze w stanie
  // treningu — propozycję trzeba wtedy złożyć samemu, z poprzedniego razu.
  const propozycja =
    postep?.propozycja ??
    propozycjaSerii(cwiczenie.typ, null, [], repo.serieZPoprzedniegoRazu(db, cwiczenie.id, sesja.id));

  const zPlanu = postep?.serie_cel != null ? postep.serie_cel - postep.serie_zrobione : null;
  const ile = dane.ile ?? zPlanu;

  if (ile === null) {
    throw new BladDomeny(
      `Ćwiczenie "${cwiczenie.nazwa}" nie ma w planie liczby serii — podaj, ile serii odhaczyć`,
      "brak_celu_serii",
    );
  }

  if (ile <= 0) return stan;

  if (propozycja.zrodlo === "brak") {
    throw new BladDomeny(
      `Nie wiadomo, jakim wynikiem odhaczyć ćwiczenie "${cwiczenie.nazwa}" — zapisz pierwszą serię ręcznie`,
      "brak_propozycji",
    );
  }

  db.transaction(() => {
    for (let i = 0; i < ile; i += 1) {
      zapiszSerie(
        db,
        {
          cwiczenie: cwiczenie.nazwa,
          powtorzenia: propozycja.powtorzenia ?? undefined,
          ciezar_kg: propozycja.ciezar_kg ?? undefined,
          czas_s: propozycja.czas_s ?? undefined,
          dystans_m: propozycja.dystans_m ?? undefined,
        },
        opcje,
      );
    }
  })();

  return stanTreningu(db);
}

// === HISTORIA ===========================================================

export type HistoriaCwiczenia = {
  nazwa: string;
  typ: TypCwiczenia;
  serie: Seria[];
  sesje: { data: string; serie: Seria[] }[];
  rekord_ciezar: number | null;
  rekord_powtorzenia: number | null;
};

/**
 * Zakończone treningi z zakresu dat, każdy z seriami pogrupowanymi po ćwiczeniu.
 *
 * Sesje bez ani jednej serii są pomijane: to ślad po otwarciu i zamknięciu
 * treningu, który w historii ruchu nie niesie żadnej informacji, a potrafi
 * zapchać listę.
 */
export function historiaSesji(
  db: Baza,
  od: string,
  doDaty: string,
  opcje: Opcje = {},
): SesjaZWynikami[] {
  const strefa = opcje.strefa ?? STREFA_DOMYSLNA;
  const sesje = repo.sesjeZZakresu(db, od, doDaty);

  const wgSesji = new Map<number, Seria[]>();
  for (const seria of repo.serieDlaSesji(db, sesje.map((s) => s.id))) {
    const lista = wgSesji.get(seria.sesja_id);
    if (lista) lista.push(seria);
    else wgSesji.set(seria.sesja_id, [seria]);
  }

  return sesje
    .filter((s) => wgSesji.has(s.id))
    .map((s) => {
      const serie = wgSesji.get(s.id) ?? [];

      // Kolejność ćwiczeń bierze się z kolejności pierwszej serii — tak, jak
      // trening naprawdę przebiegł, a nie jak stał w planie.
      const wgCwiczenia = new Map<number, CwiczenieWSesji>();
      for (const seria of serie) {
        const istniejace = wgCwiczenia.get(seria.cwiczenie_id);
        if (istniejace) istniejace.serie.push(seria);
        else {
          wgCwiczenia.set(seria.cwiczenie_id, {
            cwiczenie_id: seria.cwiczenie_id,
            nazwa: seria.nazwa,
            typ: seria.typ,
            serie: [seria],
          });
        }
      }

      return {
        ...zbudujSesje(s),
        godzina: godzinaLokalna(s.start_ts, strefa),
        trwanie_s: s.koniec_ts
          ? Math.max(0, Math.round((Date.parse(s.koniec_ts) - Date.parse(s.start_ts)) / 1000))
          : null,
        serie_lacznie: serie.length,
        cwiczenia: [...wgCwiczenia.values()],
      };
    });
}

export function historiaCwiczenia(db: Baza, nazwa: string, limitSesji = 10): HistoriaCwiczenia {
  const cwiczenie = znajdzCwiczenie(db, nazwa);
  const wiersze = repo.historiaCwiczenia(db, cwiczenie.id, limitSesji);

  const wgSesji = new Map<string, Seria[]>();
  for (const { data_lokalna, ...seria } of wiersze) {
    const lista = wgSesji.get(data_lokalna) ?? [];
    lista.push(seria);
    wgSesji.set(data_lokalna, lista);
  }

  const ciezary = wiersze.map((w) => w.ciezar_kg).filter((c): c is number => c != null);
  const powtorzenia = wiersze.map((w) => w.powtorzenia).filter((p): p is number => p != null);

  return {
    nazwa: cwiczenie.nazwa,
    typ: cwiczenie.typ,
    serie: wiersze.map(({ data_lokalna: _pomijamy, ...seria }) => seria),
    sesje: [...wgSesji.entries()].map(([data, serie]) => ({ data, serie })),
    rekord_ciezar: ciezary.length > 0 ? Math.max(...ciezary) : null,
    rekord_powtorzenia: powtorzenia.length > 0 ? Math.max(...powtorzenia) : null,
  };
}
