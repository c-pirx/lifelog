/**
 * Raport tygodniowy i podgląd tygodnia w toku.
 *
 * Każdy test podaje `teraz` jawnie. Bez tego zestaw zacząłby padać po zmianie
 * daty na maszynie — ta sama pułapka co przy `trendWagi` i `czestePosilki`.
 *
 * Tydzień raportu biegnie od niedzieli do soboty, a raport za niego powstaje
 * w kolejną niedzielę o 9:00 czasu lokalnego.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import { ustawCele, zapiszPosilek } from "../src/domain/diet.js";
import { zapiszWage } from "../src/domain/metrics.js";
import {
  dopiszKomentarz,
  raport,
  raporty,
  tydzienWToku,
  zapewnijRaporty,
} from "../src/domain/raporty.js";
import { dodajDzienPlanu, rozpocznijTrening, zakonczTrening, zapiszSerie } from "../src/domain/workouts.js";

let db: Baza;

beforeEach(() => {
  db = otworzBaze({ sciezka: ":memory:" });
});

// Sierpień 2026 w Europe/Warsaw to UTC+2, więc 10:00Z wypada w środku dnia
// lokalnego — bez ryzyka, że wpis przeskoczy na sąsiednią dobę.
const wPoludnie = (data: string) => `${data}T10:00:00.000Z`;

/** Niedziele kolejnych tygodni testowych. */
const TYDZIEN_1 = "2026-08-02"; // do soboty 2026-08-08
const TYDZIEN_2 = "2026-08-09"; // do soboty 2026-08-15
const TYDZIEN_3 = "2026-08-16"; // do soboty 2026-08-22
const TYDZIEN_4 = "2026-08-23"; // do soboty 2026-08-29, bieżący w testach

/** Wtorek czwartego tygodnia, godzina 12:00 lokalnie. */
const WTOREK = "2026-08-25T10:00:00.000Z";

function posilek(data: string, kcal: number, dodatki: Record<string, unknown> = {}) {
  return zapiszPosilek(db, { opis: "posiłek", kcal, ts: wPoludnie(data), ...dodatki });
}

function cele(kcal: number) {
  return ustawCele(db, {
    kcal,
    bialko_g: 150,
    wegle_g: 200,
    tluszcz_g: 70,
    obowiazuje_od: "2026-07-01",
  });
}

type SeriaTestowa = {
  cwiczenie: string;
  typ?: "silowe" | "cardio" | "na_czas";
  powtorzenia?: number;
  ciezar_kg?: number;
  czas_s?: number;
};

function trening(data: string, serie: SeriaTestowa[]) {
  rozpocznijTrening(db, { ts: wPoludnie(data), bez_planu: true });
  for (const s of serie) zapiszSerie(db, { ...s, ts: wPoludnie(data) });
  zakonczTrening(db, { ts: `${data}T11:00:00.000Z` });
}

describe("moment powstania raportu", () => {
  beforeEach(() => {
    posilek(TYDZIEN_3, 2000);
  });

  it("w niedzielę o 8:59 raportu za miniony tydzień jeszcze nie ma", () => {
    // 06:59Z to 08:59 w Warszawie.
    const nowe = zapewnijRaporty(db, { teraz: `${TYDZIEN_4}T06:59:00.000Z` });

    expect(nowe).toHaveLength(0);
    expect(raporty(db)).toHaveLength(0);
  });

  it("w niedzielę o 9:01 raport już jest", () => {
    const nowe = zapewnijRaporty(db, { teraz: `${TYDZIEN_4}T07:01:00.000Z` });

    expect(nowe).toHaveLength(1);
    expect(nowe[0]?.tydzien_od).toBe(TYDZIEN_3);
    expect(nowe[0]?.tydzien_do).toBe("2026-08-22");
  });

  it("nie obejmuje tygodnia, który wciąż trwa", () => {
    posilek("2026-08-24", 2000);
    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raporty(db).map((r) => r.tydzien_od)).not.toContain(TYDZIEN_4);
  });

  it("drugie wywołanie niczego nie dubluje", () => {
    zapewnijRaporty(db, { teraz: WTOREK });
    const drugie = zapewnijRaporty(db, { teraz: WTOREK });

    expect(drugie).toHaveLength(0);
    expect(raporty(db)).toHaveLength(1);
  });

  it("po przerwie w działaniu serwera dolicza wszystkie zaległe tygodnie", () => {
    posilek(TYDZIEN_1, 2000);
    posilek(TYDZIEN_2, 2000);

    const nowe = zapewnijRaporty(db, { teraz: WTOREK });

    expect(nowe.map((r) => r.tydzien_od)).toEqual([TYDZIEN_1, TYDZIEN_2, TYDZIEN_3]);
  });

  it("pomija tygodnie bez jednego wpisu", () => {
    posilek(TYDZIEN_1, 2000);
    // Tydzień drugi zostaje pusty — urlop bez zapisów.

    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raporty(db).map((r) => r.tydzien_od)).toEqual([TYDZIEN_3, TYDZIEN_1]);
  });

  it("migawka nie zmienia się po późniejszej poprawce wpisu z tamtego tygodnia", () => {
    zapewnijRaporty(db, { teraz: WTOREK });
    const przed = raport(db, TYDZIEN_3)?.dieta.srednie.kcal;

    posilek("2026-08-18", 5000);
    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raport(db, TYDZIEN_3)?.dieta.srednie.kcal).toBe(przed);
  });
});

describe("liczby w raporcie", () => {
  it("liczy średnią z dni, w których cokolwiek zapisano", () => {
    cele(2000);
    posilek(TYDZIEN_3, 2000);
    posilek("2026-08-17", 2000);
    posilek("2026-08-18", 2000);

    zapewnijRaporty(db, { teraz: WTOREK });
    const r = raport(db, TYDZIEN_3);

    expect(r?.dieta.dni_z_zapisem).toBe(3);
    expect(r?.dieta.srednie.kcal).toBe(2000);
    expect(r?.dieta.dni_w_celu).toBe(3);
  });

  it("dzień poza pasmem wokół celu nie liczy się jako trafiony", () => {
    cele(2000);
    posilek(TYDZIEN_3, 2000);
    posilek("2026-08-17", 1400);

    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raport(db, TYDZIEN_3)?.dieta.dni_w_celu).toBe(1);
  });

  it("zlicza wpisy oznaczone jako szacowane", () => {
    posilek(TYDZIEN_3, 2000, { pewnosc: "dokladne" });
    posilek("2026-08-17", 2000, { pewnosc: "szacowane" });

    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raport(db, TYDZIEN_3)?.dieta.ile_szacowanych).toBe(1);
  });

  it("objętość liczy wyłącznie z serii siłowych", () => {
    posilek(TYDZIEN_3, 2000);
    trening(TYDZIEN_3, [
      { cwiczenie: "przysiad", powtorzenia: 10, ciezar_kg: 50 },
      { cwiczenie: "przysiad", powtorzenia: 10, ciezar_kg: 50 },
      { cwiczenie: "bieżnia", typ: "cardio", czas_s: 1200 },
    ]);

    zapewnijRaporty(db, { teraz: WTOREK });
    const t = raport(db, TYDZIEN_3)?.trening;

    expect(t?.sesje).toBe(1);
    expect(t?.serie).toBe(3);
    expect(t?.objetosc_kg).toBe(1000);
    expect(t?.cwiczenia.find((c) => c.nazwa === "bieżnia")?.objetosc_kg).toBe(0);
  });

  it("pokazuje, ile sesji wypada w planie tygodnia", () => {
    dodajDzienPlanu(db, { kod: "A", nazwa: "Nogi", dzien_tygodnia: 1, cwiczenia: [] });
    dodajDzienPlanu(db, { kod: "B", nazwa: "Klatka", dzien_tygodnia: 4, cwiczenia: [] });
    posilek(TYDZIEN_3, 2000);
    trening("2026-08-17", [{ cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 60 }]);

    zapewnijRaporty(db, { teraz: WTOREK });
    const t = raport(db, TYDZIEN_3)?.trening;

    expect(t?.sesje).toBe(1);
    expect(t?.sesje_w_planie).toBe(2);
  });

  it("wagę bierze ze średniej kroczącej, nie z surowego pomiaru", () => {
    for (const dzien of ["2026-08-16", "2026-08-17", "2026-08-18"]) {
      zapiszWage(db, 80, { ts: wPoludnie(dzien) });
    }
    // Skok wodny w ostatnim dniu tygodnia — średnia ma go stłumić.
    zapiszWage(db, 83, { ts: wPoludnie("2026-08-22") });

    zapewnijRaporty(db, { teraz: WTOREK });
    const waga = raport(db, TYDZIEN_3)?.waga;

    expect(waga?.start).toBe(80);
    expect(waga?.koniec).toBeGreaterThan(80);
    expect(waga?.koniec).toBeLessThan(83);
  });

  it("porównuje zamknięty tydzień z poprzednim", () => {
    posilek(TYDZIEN_2, 1800);
    posilek(TYDZIEN_3, 2200);

    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raport(db, TYDZIEN_3)?.zmiana?.kcal_dziennie).toBe(400);
    expect(raport(db, TYDZIEN_2)?.zmiana).toBeNull();
  });

  it("przyjmuje dowolny dzień tygodnia i normalizuje go do niedzieli", () => {
    posilek(TYDZIEN_3, 2000);
    zapewnijRaporty(db, { teraz: WTOREK });

    expect(raport(db, "2026-08-19")?.tydzien_od).toBe(TYDZIEN_3);
  });
});

describe("tydzień w toku", () => {
  it("prognozuje koniec tygodnia ze średniej dni zamkniętych", () => {
    cele(2100);
    posilek(TYDZIEN_4, 2000); // niedziela
    posilek("2026-08-24", 2000); // poniedziałek
    posilek("2026-08-25", 500); // dzisiaj, dzień w toku

    const postep = tydzienWToku(db, { teraz: WTOREK });

    expect(postep.dni_zamkniete).toBe(2);
    expect(postep.prognoza?.na_koniec.kcal).toBe(14_000);
    expect(postep.prognoza?.cel_tygodnia?.kcal).toBe(14_700);
    expect(postep.prognoza?.dzis.kcal).toBe(500);
  });

  it("dzisiejszy niepełny dzień nie wchodzi do prognozy", () => {
    cele(2000);
    posilek(TYDZIEN_4, 2000);
    posilek("2026-08-24", 2000);

    const bezDzisiaj = tydzienWToku(db, { teraz: WTOREK }).prognoza?.na_koniec.kcal;
    posilek("2026-08-25", 300);
    const zDzisiaj = tydzienWToku(db, { teraz: WTOREK }).prognoza?.na_koniec.kcal;

    expect(zDzisiaj).toBe(bezDzisiaj);
  });

  it("uznaje tempo za utrzymane, gdy prognoza mieści się w pasmie celu", () => {
    cele(2000);
    posilek(TYDZIEN_4, 2000);
    posilek("2026-08-24", 2000);

    expect(tydzienWToku(db, { teraz: WTOREK }).prognoza?.na_kursie).toBe(true);
  });

  it("porównuje z tym samym wycinkiem poprzedniego tygodnia, nie z całym", () => {
    // Poprzedni tydzień: dwa pierwsze dni lekkie, końcówka bardzo ciężka.
    posilek(TYDZIEN_3, 1500);
    posilek("2026-08-17", 1500);
    for (const dzien of ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"]) {
      posilek(dzien, 3000);
    }
    posilek(TYDZIEN_4, 2000);
    posilek("2026-08-24", 2000);

    // Wobec dwóch pierwszych dni poprzedniego tygodnia (1500) jest o 500 więcej.
    // Wobec całego poprzedniego tygodnia (średnia ~2571) wyszłoby mniej.
    expect(tydzienWToku(db, { teraz: WTOREK }).zmiana?.kcal_dziennie).toBe(500);
  });

  it("w niedzielę rano nie ma jeszcze czego prognozować ani z czym porównywać", () => {
    cele(2000);
    posilek(TYDZIEN_4, 800);

    const postep = tydzienWToku(db, { teraz: `${TYDZIEN_4}T10:00:00.000Z` });

    expect(postep.dni_zamkniete).toBe(0);
    expect(postep.prognoza).toBeNull();
    expect(postep.zmiana).toBeNull();
  });

  it("ocenia tydzień po trafieniach w cel i liczbie serii, nie po samych kaloriach", () => {
    cele(2000);
    // Poprzedni tydzień: dwa dni obok celu i bez treningu.
    posilek(TYDZIEN_3, 1200);
    posilek("2026-08-17", 1200);
    // Bieżący: dwa dni w celu — mimo że kalorii jest WIĘCEJ, to jest poprawa.
    posilek(TYDZIEN_4, 2000);
    posilek("2026-08-24", 2000);

    const zmiana = tydzienWToku(db, { teraz: WTOREK }).zmiana;

    expect(zmiana?.kcal_dziennie).toBe(800);
    expect(zmiana?.dni_w_celu).toBe(2);
    expect(zmiana?.ocena).toBe("lepiej");
  });

  it("mniej trafień w cel i mniej serii to werdykt „gorzej”", () => {
    cele(2000);
    posilek(TYDZIEN_3, 2000);
    posilek("2026-08-17", 2000);
    trening(TYDZIEN_3, [{ cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 60 }]);
    posilek(TYDZIEN_4, 1000);
    posilek("2026-08-24", 1000);

    expect(tydzienWToku(db, { teraz: WTOREK }).zmiana?.ocena).toBe("gorzej");
  });

  it("bez poprzedniego tygodnia w bazie zmiana jest pusta, a nie zerowa", () => {
    posilek(TYDZIEN_4, 2000);
    posilek("2026-08-24", 2000);

    expect(tydzienWToku(db, { teraz: WTOREK }).zmiana).toBeNull();
  });

  it("dietę liczy z dni zamkniętych, ale dzisiejsze serie już się liczą", () => {
    // Dzień w toku nie może psuć średniej ani „dni w celu" — o dwunastej dzień
    // z tysiącem kalorii wygląda jak nietrafiony cel, choć jeszcze trwa.
    // Serie są odwrotnie: to fakt dokonany, widoczny zaraz po powrocie z siłowni.
    posilek(TYDZIEN_4, 2000);
    posilek("2026-08-25", 1000);
    trening("2026-08-25", [
      { cwiczenie: "przysiad", powtorzenia: 8, ciezar_kg: 80 },
      { cwiczenie: "przysiad", powtorzenia: 8, ciezar_kg: 80 },
    ]);

    const postep = tydzienWToku(db, { teraz: WTOREK });

    expect(postep.tydzien_od).toBe(TYDZIEN_4);
    expect(postep.tydzien_do).toBe("2026-08-29");
    expect(postep.dieta.dni_z_zapisem).toBe(1);
    expect(postep.prognoza?.dzis.kcal).toBe(1000);
    expect(postep.trening.serie).toBe(2);
  });
});

describe("komentarz Claude", () => {
  beforeEach(() => {
    posilek(TYDZIEN_3, 2000);
    zapewnijRaporty(db, { teraz: WTOREK });
  });

  it("dopisuje się do zapisanego raportu", () => {
    dopiszKomentarz(db, TYDZIEN_3, "Solidny tydzień, białko trzyma poziom.");

    expect(raport(db, TYDZIEN_3)?.komentarz).toBe("Solidny tydzień, białko trzyma poziom.");
  });

  it("nie rusza liczb w migawce", () => {
    const przed = raport(db, TYDZIEN_3)?.dieta.srednie.kcal;
    dopiszKomentarz(db, TYDZIEN_3, "Cokolwiek.");

    expect(raport(db, TYDZIEN_3)?.dieta.srednie.kcal).toBe(przed);
  });

  it("przyjmuje dowolny dzień tygodnia jako wskazanie raportu", () => {
    dopiszKomentarz(db, "2026-08-20", "Środek tygodnia też wskazuje ten raport.");

    expect(raport(db, TYDZIEN_3)?.komentarz).toContain("Środek tygodnia");
  });

  it("odmawia, gdy raportu za wskazany tydzień nie ma", () => {
    expect(() => dopiszKomentarz(db, "2026-01-04", "Nie ma takiego raportu.")).toThrow(
      /Nie ma raportu/,
    );
  });
});
