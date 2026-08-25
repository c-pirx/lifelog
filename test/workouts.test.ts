import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import {
  dodajDzienPlanu,
  historiaCwiczenia,
  planTreningowy,
  propozycjaSerii,
  rozpocznijTrening,
  stanTreningu,
  usunDzienPlanu,
  zakonczTrening,
  zapiszSerie,
} from "../src/domain/workouts.js";
import type { Seria } from "../src/domain/typy.js";

let db: Baza;

beforeEach(() => {
  db = otworzBaze({ sciezka: ":memory:" });
});

/** Dzień A zaplanowany na poniedziałek: przysiad 5×5, wyciskanie 3×8. */
function planA() {
  return dodajDzienPlanu(db, {
    kod: "A",
    nazwa: "Nogi i klatka",
    dzien_tygodnia: 1,
    cwiczenia: [
      { nazwa: "przysiad", typ: "silowe", serie_cel: 5, powt_cel: "5" },
      { nazwa: "wyciskanie", typ: "silowe", serie_cel: 3, powt_cel: "8" },
    ],
  });
}

/** Rozegrany w całości trening w przeszłości — źródło danych „poprzednio". */
function przeszlyTrening(ciezar: number, data = "2026-08-17T09:00:00.000Z") {
  rozpocznijTrening(db, { kod: "A", ts: data });
  for (let nr = 1; nr <= 5; nr += 1) {
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: ciezar, ts: data });
  }
  zakonczTrening(db, { ts: data });
}

describe("plan treningowy", () => {
  it("zapisuje dzień z ćwiczeniami w podanej kolejności", () => {
    const dzien = planA();

    expect(dzien.kod).toBe("A");
    expect(dzien.dzien_tygodnia).toBe(1);
    expect(dzien.cwiczenia.map((c) => c.nazwa)).toEqual(["przysiad", "wyciskanie"]);
    expect(dzien.cwiczenia[0]?.serie_cel).toBe(5);
  });

  it("tworzy brakujące ćwiczenia i nie duplikuje istniejących", () => {
    planA();
    dodajDzienPlanu(db, {
      kod: "B",
      nazwa: "Plecy",
      dzien_tygodnia: 3,
      cwiczenia: [{ nazwa: "przysiad", typ: "silowe" }, { nazwa: "wiosłowanie", typ: "silowe" }],
    });

    const nazwy = db
      .prepare<[], { nazwa: string }>("SELECT nazwa FROM cwiczenia ORDER BY nazwa")
      .all()
      .map((w) => w.nazwa);

    expect(nazwy).toEqual(["przysiad", "wiosłowanie", "wyciskanie"]);
  });

  it("nadpisuje ćwiczenia przy ponownym zapisie tego samego dnia", () => {
    planA();
    const zmieniony = dodajDzienPlanu(db, {
      kod: "A",
      nazwa: "Nogi",
      dzien_tygodnia: 1,
      cwiczenia: [{ nazwa: "martwy ciąg", typ: "silowe", serie_cel: 3, powt_cel: "5" }],
    });

    expect(zmieniony.cwiczenia.map((c) => c.nazwa)).toEqual(["martwy ciąg"]);
    expect(planTreningowy(db)).toHaveLength(1);
  });

  it("zapamiętuje ciężar docelowy ćwiczenia", () => {
    const dzien = dodajDzienPlanu(db, {
      kod: "C",
      nazwa: "Klatka",
      dzien_tygodnia: null,
      cwiczenia: [
        { nazwa: "wyciskanie", typ: "silowe", serie_cel: 4, powt_cel: "8", ciezar_cel_kg: 60 },
      ],
    });

    expect(dzien.cwiczenia[0]?.ciezar_cel_kg).toBe(60);
  });

  it("usuwa dzień planu", () => {
    planA();
    expect(usunDzienPlanu(db, "A")).toBe(true);
    expect(planTreningowy(db)).toEqual([]);
  });
});

describe("rozpoczynanie treningu", () => {
  it("wybiera dzień z harmonogramu tygodniowego", () => {
    planA();
    // 24.08.2026 to poniedziałek.
    const sesja = rozpocznijTrening(db, { ts: "2026-08-24T09:00:00.000Z" });

    expect(sesja.dzien_kod).toBe("A");
    expect(sesja.status).toBe("aktywna");
  });

  it("jawnie wskazany dzień ma pierwszeństwo przed harmonogramem", () => {
    planA();
    dodajDzienPlanu(db, { kod: "B", nazwa: "Plecy", dzien_tygodnia: 3, cwiczenia: [] });

    // Poniedziałek, ale chcemy dzień B.
    const sesja = rozpocznijTrening(db, { kod: "B", ts: "2026-08-24T09:00:00.000Z" });

    expect(sesja.dzien_kod).toBe("B");
  });

  it("pozwala trenować w dniu bez zaplanowanego treningu", () => {
    planA();
    // Wtorek — harmonogram nic nie przewiduje.
    const sesja = rozpocznijTrening(db, { ts: "2026-08-25T09:00:00.000Z" });

    expect(sesja.dzien_id).toBeNull();
    expect(sesja.status).toBe("aktywna");
  });

  it("bez_planu otwiera pustą sesję nawet wtedy, gdy harmonogram coś przewiduje", () => {
    planA();
    // Poniedziałek, a więc dzień A wg harmonogramu — ale dziś improwizujemy.
    const sesja = rozpocznijTrening(db, { bez_planu: true, ts: "2026-08-24T09:00:00.000Z" });

    expect(sesja.dzien_id).toBeNull();
    expect(sesja.dzien_kod).toBeNull();
    expect(stanTreningu(db).wg_planu).toEqual([]);
  });

  it("odmawia rozpoczęcia drugiej sesji, gdy jedna jest otwarta", () => {
    planA();
    rozpocznijTrening(db, { ts: "2026-08-24T09:00:00.000Z" });

    expect(() => rozpocznijTrening(db, { ts: "2026-08-24T10:00:00.000Z" })).toThrow(
      /aktywn/i,
    );
  });

  it("pozwala rozpocząć nową sesję po zamknięciu poprzedniej", () => {
    planA();
    rozpocznijTrening(db, { ts: "2026-08-24T09:00:00.000Z" });
    zakonczTrening(db, { ts: "2026-08-24T10:00:00.000Z" });

    expect(() => rozpocznijTrening(db, { ts: "2026-08-26T09:00:00.000Z" })).not.toThrow();
  });
});

describe("zapisywanie serii", () => {
  beforeEach(() => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });
  });

  it("numeruje kolejne serie automatycznie", () => {
    const pierwsza = zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    const druga = zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });

    expect(pierwsza.nr_serii).toBe(1);
    expect(druga.nr_serii).toBe(2);
  });

  it("numeruje osobno dla każdego ćwiczenia", () => {
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    const wyciskanie = zapiszSerie(db, { cwiczenie: "wyciskanie", powtorzenia: 8, ciezar_kg: 70 });

    expect(wyciskanie.nr_serii).toBe(1);
  });

  it("wymaga otwartej sesji", () => {
    zakonczTrening(db, {});
    expect(() => zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5 })).toThrow(/sesj/i);
  });

  it("przyjmuje ćwiczenie spoza planu dnia", () => {
    const seria = zapiszSerie(db, { cwiczenie: "brzuszki", powtorzenia: 20 });
    expect(seria.nazwa).toBe("brzuszki");
  });

  it("nie rozróżnia wielkości liter w nazwie ćwiczenia", () => {
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    const druga = zapiszSerie(db, { cwiczenie: "Przysiad", powtorzenia: 5, ciezar_kg: 100 });

    expect(druga.nr_serii).toBe(2);
  });
});

describe("typy ćwiczeń", () => {
  beforeEach(() => {
    dodajDzienPlanu(db, {
      kod: "C",
      nazwa: "Mieszany",
      dzien_tygodnia: 5,
      cwiczenia: [
        { nazwa: "przysiad", typ: "silowe", serie_cel: 3, powt_cel: "5" },
        { nazwa: "bieżnia", typ: "cardio", serie_cel: 1 },
        { nazwa: "deska", typ: "na_czas", serie_cel: 2 },
      ],
    });
    rozpocznijTrening(db, { kod: "C", ts: "2026-08-28T09:00:00.000Z" });
  });

  it("zapisuje siłowe w polach ciężaru i powtórzeń", () => {
    const seria = zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });

    expect(seria).toMatchObject({ powtorzenia: 5, ciezar_kg: 100, czas_s: null, dystans_m: null });
  });

  it("zapisuje cardio w polach czasu i dystansu", () => {
    const seria = zapiszSerie(db, { cwiczenie: "bieżnia", czas_s: 1800, dystans_m: 5000 });

    expect(seria).toMatchObject({ czas_s: 1800, dystans_m: 5000, powtorzenia: null });
  });

  it("zapisuje ćwiczenie na czas w polu czasu", () => {
    const seria = zapiszSerie(db, { cwiczenie: "deska", czas_s: 90 });

    expect(seria).toMatchObject({ czas_s: 90, powtorzenia: null, ciezar_kg: null });
  });

  it("odrzuca serię siłową bez powtórzeń", () => {
    expect(() => zapiszSerie(db, { cwiczenie: "przysiad", ciezar_kg: 100 })).toThrow(/powt/i);
  });

  it("odrzuca cardio bez czasu i dystansu", () => {
    expect(() => zapiszSerie(db, { cwiczenie: "bieżnia", powtorzenia: 10 })).toThrow(
      /czas|dystans/i,
    );
  });

  it("nie miesza typów w historii", () => {
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    zapiszSerie(db, { cwiczenie: "bieżnia", czas_s: 1800, dystans_m: 5000 });

    const historia = historiaCwiczenia(db, "bieżnia");

    expect(historia.serie).toHaveLength(1);
    expect(historia.typ).toBe("cardio");
  });

  it("tworzy nieznane ćwiczenie w podanym typie", () => {
    // Bez tego wiosłowanie na ergometrze dorzucone w trakcie treningu wpadłoby
    // jako siłowe i zażądało powtórzeń.
    const seria = zapiszSerie(db, { cwiczenie: "ergometr", typ: "cardio", czas_s: 600 });

    expect(seria).toMatchObject({ czas_s: 600, powtorzenia: null });
    expect(historiaCwiczenia(db, "ergometr").typ).toBe("cardio");
  });

  it("domyślnie tworzy nieznane ćwiczenie jako siłowe", () => {
    zapiszSerie(db, { cwiczenie: "wyciskanie francuskie", powtorzenia: 12, ciezar_kg: 30 });

    expect(historiaCwiczenia(db, "wyciskanie francuskie").typ).toBe("silowe");
  });

  it("nie przepisuje typu ćwiczenia, które już istnieje", () => {
    // Pomyłka w aplikacji nie może przekwalifikować bieżni na siłową —
    // przepisałaby wtedy sens wszystkich wcześniejszych serii.
    zapiszSerie(db, { cwiczenie: "bieżnia", typ: "silowe", czas_s: 1200 });

    expect(historiaCwiczenia(db, "bieżnia").typ).toBe("cardio");
  });
});

describe("stan treningu", () => {
  it("pokazuje, co zrobione i co zostało", () => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });

    const stan = stanTreningu(db);
    const przysiad = stan.wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.serie_zrobione).toBe(2);
    expect(przysiad?.ukonczone).toBe(false);
    expect(stan.ukonczone_cwiczen).toBe(0);
    expect(stan.wszystkich_cwiczen).toBe(2);
    expect(stan.pozostalo).toContain("przysiad");
    expect(stan.pozostalo).toContain("wyciskanie");
  });

  it("uznaje ćwiczenie za ukończone po wykonaniu docelowej liczby serii", () => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });
    for (let i = 0; i < 5; i += 1) {
      zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    }

    const stan = stanTreningu(db);

    expect(stan.wg_planu.find((c) => c.nazwa === "przysiad")?.ukonczone).toBe(true);
    expect(stan.ukonczone_cwiczen).toBe(1);
    expect(stan.pozostalo).toEqual(["wyciskanie"]);
  });

  it("wydziela ćwiczenia zrobione poza planem", () => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });
    zapiszSerie(db, { cwiczenie: "brzuszki", powtorzenia: 20 });

    const stan = stanTreningu(db);

    expect(stan.poza_planem.map((c) => c.nazwa)).toEqual(["brzuszki"]);
    expect(stan.wszystkich_cwiczen).toBe(2);
  });

  it("zwraca pusty stan, gdy nie ma otwartej sesji", () => {
    planA();
    const stan = stanTreningu(db);

    expect(stan.sesja).toBeNull();
    expect(stan.wg_planu).toEqual([]);
  });
});

describe("porównanie z poprzednim treningiem", () => {
  it("podaje wyniki z poprzedniej sesji przy każdym ćwiczeniu", () => {
    planA();
    przeszlyTrening(100);
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.poprzednio).toHaveLength(5);
    expect(przysiad?.poprzednio[0]?.ciezar_kg).toBe(100);
  });

  it("oznacza serię z mniejszym ciężarem jako słabszą", () => {
    planA();
    przeszlyTrening(100);
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 95 });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.slabsze_niz_poprzednio).toEqual([2]);
  });

  it("oznacza serię z mniejszą liczbą powtórzeń przy tym samym ciężarze", () => {
    planA();
    przeszlyTrening(100);
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 3, ciezar_kg: 100 });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.slabsze_niz_poprzednio).toEqual([1]);
  });

  it("nie oznacza nic, gdy nie ma z czym porównywać", () => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 1, ciezar_kg: 20 });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.poprzednio).toEqual([]);
    expect(przysiad?.slabsze_niz_poprzednio).toEqual([]);
  });

  it("porównuje z ostatnią zakończoną sesją, pomijając trwającą", () => {
    planA();
    przeszlyTrening(90, "2026-08-10T09:00:00.000Z");
    przeszlyTrening(100, "2026-08-17T09:00:00.000Z");
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.poprzednio[0]?.ciezar_kg).toBe(100);
  });
});

describe("kończenie treningu", () => {
  it("zamyka sesję i zapisuje notatkę", () => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    const sesja = zakonczTrening(db, { notatki: "ciężko szło", ts: "2026-08-24T10:30:00.000Z" });

    expect(sesja.status).toBe("zakonczona");
    expect(sesja.koniec_ts).toBe("2026-08-24T10:30:00.000Z");
    expect(sesja.notatki).toBe("ciężko szło");
    expect(stanTreningu(db).sesja).toBeNull();
  });

  it("odmawia zakończenia, gdy nic nie jest otwarte", () => {
    expect(() => zakonczTrening(db, {})).toThrow(/sesj/i);
  });
});

describe("rekordy i propozycja w stanie treningu", () => {
  it("podaje propozycję kolejnej serii przy każdym ćwiczeniu", () => {
    planA();
    przeszlyTrening(100);
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.propozycja).toMatchObject({ powtorzenia: 5, ciezar_kg: 100 });
  });

  it("oznacza serię, która pobiła dotychczasowy rekord", () => {
    planA();
    przeszlyTrening(100);
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 105 });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.rekordy).toEqual([1]);
  });

  it("rekord nie liczy się z bieżącej sesji, więc obie mocniejsze serie są oznaczone", () => {
    planA();
    przeszlyTrening(100);
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 105 });
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 105 });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.rekordy).toEqual([1, 2]);
  });

  it("nie oznacza rekordu przy pierwszym w życiu podejściu do ćwiczenia", () => {
    planA();
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });

    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });

    const przysiad = stanTreningu(db).wg_planu.find((c) => c.nazwa === "przysiad");

    expect(przysiad?.rekordy).toEqual([]);
  });
});

describe("propozycja serii", () => {
  /** Zapisana seria zbudowana wprost — `propozycjaSerii` nie sięga do bazy. */
  const seria = (wynik: Partial<Seria>): Seria => ({
    id: 1,
    sesja_id: 1,
    cwiczenie_id: 1,
    nazwa: "wyciskanie",
    typ: "silowe",
    nr_serii: 1,
    powtorzenia: null,
    ciezar_kg: null,
    czas_s: null,
    dystans_m: null,
    rpe: null,
    ts: "2026-08-25T10:00:00.000Z",
    ...wynik,
  });

  const cel = (pola: Partial<Parameters<typeof propozycjaSerii>[1] & object>) => ({
    powt_cel: null,
    czas_cel_s: null,
    dystans_cel_m: null,
    ciezar_cel_kg: null,
    ...pola,
  });

  it("bierze liczby z celu planu, gdy nie ma żadnej historii", () => {
    const wynik = propozycjaSerii("silowe", cel({ powt_cel: "8", ciezar_cel_kg: 60 }), [], []);

    expect(wynik).toMatchObject({ powtorzenia: 8, ciezar_kg: 60, zrodlo: "plan" });
  });

  it("ostatnia seria tej sesji bije cel z planu", () => {
    const wynik = propozycjaSerii(
      "silowe",
      cel({ powt_cel: "8", ciezar_cel_kg: 60 }),
      [seria({ powtorzenia: 8, ciezar_kg: 62.5 })],
      [],
    );

    expect(wynik).toMatchObject({ powtorzenia: 8, ciezar_kg: 62.5, zrodlo: "ostatnia_seria" });
  });

  it("uzupełnia ciężar z poprzedniego treningu, gdy plan go nie podaje", () => {
    const wynik = propozycjaSerii(
      "silowe",
      cel({ powt_cel: "8" }),
      [],
      [seria({ powtorzenia: 8, ciezar_kg: 60 })],
    );

    expect(wynik).toMatchObject({ powtorzenia: 8, ciezar_kg: 60 });
  });

  it("zgłasza brak propozycji, gdy nie ma ani planu, ani historii", () => {
    expect(propozycjaSerii("silowe", null, [], []).zrodlo).toBe("brak");
  });

  it("zgłasza brak, gdy plan podaje sam ciężar bez powtórzeń", () => {
    const wynik = propozycjaSerii("silowe", cel({ ciezar_cel_kg: 60 }), [], []);

    expect(wynik.zrodlo).toBe("brak");
  });

  it("zakres w powt_cel nie daje liczby i schodzi do poprzedniego treningu", () => {
    const wynik = propozycjaSerii(
      "silowe",
      cel({ powt_cel: "8-12" }),
      [],
      [seria({ powtorzenia: 10, ciezar_kg: 60 })],
    );

    expect(wynik).toMatchObject({ powtorzenia: 10, zrodlo: "poprzedni_trening" });
  });

  it("ćwiczenie bez obciążenia proponuje same powtórzenia", () => {
    const wynik = propozycjaSerii("silowe", cel({ powt_cel: "10" }), [], []);

    expect(wynik).toMatchObject({ powtorzenia: 10, ciezar_kg: null, zrodlo: "plan" });
  });

  it("cardio bierze czas i dystans, nie powtórzenia", () => {
    const wynik = propozycjaSerii(
      "cardio",
      cel({ czas_cel_s: 1200, dystans_cel_m: 5000, powt_cel: "8" }),
      [],
      [],
    );

    expect(wynik).toMatchObject({ czas_s: 1200, dystans_m: 5000, powtorzenia: null });
  });

  it("ćwiczenie na czas bierze sam czas", () => {
    const wynik = propozycjaSerii("na_czas", cel({ czas_cel_s: 60, ciezar_cel_kg: 20 }), [], []);

    expect(wynik).toMatchObject({ czas_s: 60, ciezar_kg: null, zrodlo: "plan" });
  });
});

describe("historia ćwiczenia", () => {
  it("zwraca serie pogrupowane w sesje, od najnowszej", () => {
    planA();
    przeszlyTrening(90, "2026-08-10T09:00:00.000Z");
    przeszlyTrening(100, "2026-08-17T09:00:00.000Z");

    const historia = historiaCwiczenia(db, "przysiad");

    expect(historia.sesje).toHaveLength(2);
    expect(historia.sesje[0]?.data).toBe("2026-08-17");
    expect(historia.sesje[0]?.serie[0]?.ciezar_kg).toBe(100);
    expect(historia.rekord_ciezar).toBe(100);
  });

  it("zgłasza brak ćwiczenia zamiast zwracać pustkę", () => {
    expect(() => historiaCwiczenia(db, "nieistniejące")).toThrow(/nie znaleziono|nieznane/i);
  });
});
