import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import {
  czestePosilki,
  podsumowanieDnia,
  ustawCele,
  zapiszPosilek,
} from "../src/domain/diet.js";

let db: Baza;

beforeEach(() => {
  db = otworzBaze({ sciezka: ":memory:" });
});

const CELE = { kcal: 2400, bialko_g: 180, wegle_g: 250, tluszcz_g: 80 };

describe("zapis posiłku", () => {
  it("zapisuje podane makro i zwraca kompletny wpis", () => {
    const posilek = zapiszPosilek(db, {
      opis: "owsianka z bananem",
      kcal: 400,
      bialko_g: 15,
      wegle_g: 60,
      tluszcz_g: 10,
      pora: "sniadanie",
      ts: "2026-08-25T07:00:00.000Z",
    });

    expect(posilek.id).toBeGreaterThan(0);
    expect(posilek.kcal).toBe(400);
    expect(posilek.pora).toBe("sniadanie");
    expect(posilek.data_lokalna).toBe("2026-08-25");
    expect(posilek.godzina).toBe("09:00");
  });

  it("przyjmuje sam opis i kalorie — makro domyślnie zerowe", () => {
    const posilek = zapiszPosilek(db, { opis: "kawa z mlekiem", kcal: 60 });

    expect(posilek.kcal).toBe(60);
    expect(posilek.bialko_g).toBe(0);
  });

  it("domyślnie oznacza wpis jako szacowany i pochodzący z czatu", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700 });

    expect(posilek.pewnosc).toBe("szacowane");
    expect(posilek.zrodlo).toBe("czat");
  });

  it("zachowuje oryginalne zdanie użytkownika", () => {
    const posilek = zapiszPosilek(db, {
      opis: "kurczak z ryżem",
      kcal: 700,
      surowe_wejscie: "zjadłem kurczaka z ryżem koło drugiej",
    });

    expect(posilek.surowe_wejscie).toBe("zjadłem kurczaka z ryżem koło drugiej");
  });
});

describe("wnioskowanie pory dnia", () => {
  const oGodzinie = (utc: string) => zapiszPosilek(db, { opis: "x", kcal: 100, ts: utc }).pora;

  it("rano to śniadanie", () => {
    expect(oGodzinie("2026-08-25T06:00:00.000Z")).toBe("sniadanie"); // 08:00 lokalnie
  });

  it("południe to obiad", () => {
    expect(oGodzinie("2026-08-25T12:00:00.000Z")).toBe("obiad"); // 14:00 lokalnie
  });

  it("wieczór to kolacja", () => {
    expect(oGodzinie("2026-08-25T17:00:00.000Z")).toBe("kolacja"); // 19:00 lokalnie
  });

  it("noc to przekąska", () => {
    expect(oGodzinie("2026-08-25T22:00:00.000Z")).toBe("przekaska"); // 00:00 lokalnie
  });

  it("jawnie podana pora ma pierwszeństwo przed wnioskowaniem", () => {
    const posilek = zapiszPosilek(db, {
      opis: "naleśniki",
      kcal: 500,
      pora: "sniadanie",
      ts: "2026-08-25T17:00:00.000Z",
    });
    expect(posilek.pora).toBe("sniadanie");
  });
});

describe("granica doby", () => {
  it("kolacja o 22:30 UTC trafia do następnej doby lokalnej", () => {
    zapiszPosilek(db, { opis: "późna kolacja", kcal: 600, ts: "2026-08-24T22:30:00.000Z" });

    expect(podsumowanieDnia(db, "2026-08-24").spozyte.kcal).toBe(0);
    expect(podsumowanieDnia(db, "2026-08-25").spozyte.kcal).toBe(600);
  });
});

describe("podsumowanie dnia", () => {
  beforeEach(() => {
    ustawCele(db, { ...CELE, obowiazuje_od: "2026-08-01" });
  });

  it("sumuje posiłki i liczy, ile zostało do celu", () => {
    zapiszPosilek(db, {
      opis: "śniadanie",
      kcal: 500,
      bialko_g: 30,
      wegle_g: 60,
      tluszcz_g: 15,
      ts: "2026-08-25T07:00:00.000Z",
    });
    zapiszPosilek(db, {
      opis: "obiad",
      kcal: 800,
      bialko_g: 50,
      wegle_g: 90,
      tluszcz_g: 20,
      ts: "2026-08-25T12:00:00.000Z",
    });

    const dzien = podsumowanieDnia(db, "2026-08-25");

    expect(dzien.spozyte).toEqual({ kcal: 1300, bialko_g: 80, wegle_g: 150, tluszcz_g: 35 });
    expect(dzien.pozostalo).toEqual({ kcal: 1100, bialko_g: 100, wegle_g: 100, tluszcz_g: 45 });
    expect(dzien.procent_kcal).toBe(54);
    expect(dzien.posilki).toHaveLength(2);
  });

  it("pokazuje ujemną pozostałość po przekroczeniu celu", () => {
    zapiszPosilek(db, { opis: "uczta", kcal: 3000, ts: "2026-08-25T12:00:00.000Z" });

    expect(podsumowanieDnia(db, "2026-08-25").pozostalo?.kcal).toBe(-600);
  });

  it("zwraca posiłki w kolejności spożycia", () => {
    zapiszPosilek(db, { opis: "obiad", kcal: 800, ts: "2026-08-25T12:00:00.000Z" });
    zapiszPosilek(db, { opis: "śniadanie", kcal: 500, ts: "2026-08-25T07:00:00.000Z" });

    expect(podsumowanieDnia(db, "2026-08-25").posilki.map((p) => p.opis)).toEqual([
      "śniadanie",
      "obiad",
    ]);
  });

  it("liczy, ile wpisów danego dnia jest tylko szacowanych", () => {
    zapiszPosilek(db, { opis: "a", kcal: 100, pewnosc: "dokladne", ts: "2026-08-25T07:00:00.000Z" });
    zapiszPosilek(db, { opis: "b", kcal: 100, pewnosc: "szacowane", ts: "2026-08-25T08:00:00.000Z" });
    zapiszPosilek(db, { opis: "c", kcal: 100, pewnosc: "szacowane", ts: "2026-08-25T09:00:00.000Z" });

    expect(podsumowanieDnia(db, "2026-08-25").ile_szacowanych).toBe(2);
  });

  it("wlicza niepewne do szacowanych i liczy je też osobno", () => {
    zapiszPosilek(db, { opis: "a", kcal: 100, pewnosc: "dokladne", ts: "2026-08-25T07:00:00.000Z" });
    zapiszPosilek(db, { opis: "b", kcal: 100, pewnosc: "szacowane", ts: "2026-08-25T08:00:00.000Z" });
    zapiszPosilek(db, { opis: "c", kcal: 100, pewnosc: "niepewne", ts: "2026-08-25T09:00:00.000Z" });

    const dzien = podsumowanieDnia(db, "2026-08-25");
    expect(dzien.ile_szacowanych).toBe(2);
    expect(dzien.ile_niepewnych).toBe(1);
  });

  it("działa dla dnia bez posiłków", () => {
    const dzien = podsumowanieDnia(db, "2026-08-25");

    expect(dzien.spozyte.kcal).toBe(0);
    expect(dzien.pozostalo?.kcal).toBe(2400);
    expect(dzien.posilki).toEqual([]);
  });
});

describe("posiłek złożony", () => {
  it("liczy się do sumy dnia tak samo jak posiłek bez rozbicia", () => {
    ustawCele(db, { ...CELE, obowiazuje_od: "2026-08-01" });

    zapiszPosilek(db, {
      opis: "obiad z rozbiciem",
      kcal: 700,
      bialko_g: 45,
      wegle_g: 80,
      tluszcz_g: 15,
      ts: "2026-08-25T12:00:00.000Z",
      pozycje: [
        { nazwa: "pierś z kurczaka", ilosc_g: 200, kcal: 330, bialko_g: 40 },
        { nazwa: "ryż", ilosc_g: 100, kcal: 370, bialko_g: 5 },
      ],
    });
    zapiszPosilek(db, {
      opis: "obiad bez rozbicia",
      kcal: 700,
      bialko_g: 45,
      wegle_g: 80,
      tluszcz_g: 15,
      ts: "2026-08-26T12:00:00.000Z",
    });

    const zRozbiciem = podsumowanieDnia(db, "2026-08-25");
    const bezRozbicia = podsumowanieDnia(db, "2026-08-26");

    expect(zRozbiciem.spozyte).toEqual(bezRozbicia.spozyte);
    expect(zRozbiciem.posilki[0]?.pozycje).toHaveLength(2);
    expect(bezRozbicia.posilki[0]?.pozycje).toEqual([]);
  });

  it("zwraca pozycje wraz z posiłkiem", () => {
    zapiszPosilek(db, {
      opis: "obiad",
      kcal: 700,
      ts: "2026-08-25T12:00:00.000Z",
      pozycje: [{ nazwa: "ryż", ilosc_g: 100, kcal: 370 }],
    });

    const pozycja = podsumowanieDnia(db, "2026-08-25").posilki[0]?.pozycje[0];

    expect(pozycja?.nazwa).toBe("ryż");
    expect(pozycja?.ilosc_g).toBe(100);
    expect(pozycja?.tluszcz_g).toBeNull();
  });
});

describe("cele w czasie", () => {
  it("zmiana celu nie zmienia podsumowań sprzed jej wejścia w życie", () => {
    ustawCele(db, { ...CELE, obowiazuje_od: "2026-08-01" });
    zapiszPosilek(db, { opis: "obiad", kcal: 1000, ts: "2026-08-10T12:00:00.000Z" });
    zapiszPosilek(db, { opis: "obiad", kcal: 1000, ts: "2026-08-20T12:00:00.000Z" });

    // Cięcie kalorii od 15 sierpnia.
    ustawCele(db, { ...CELE, kcal: 2000, obowiazuje_od: "2026-08-15" });

    expect(podsumowanieDnia(db, "2026-08-10").cele?.kcal).toBe(2400);
    expect(podsumowanieDnia(db, "2026-08-10").pozostalo?.kcal).toBe(1400);

    expect(podsumowanieDnia(db, "2026-08-20").cele?.kcal).toBe(2000);
    expect(podsumowanieDnia(db, "2026-08-20").pozostalo?.kcal).toBe(1000);
  });

  it("dzień wejścia w życie liczy się już wg nowego celu", () => {
    ustawCele(db, { ...CELE, obowiazuje_od: "2026-08-01" });
    ustawCele(db, { ...CELE, kcal: 2000, obowiazuje_od: "2026-08-15" });

    expect(podsumowanieDnia(db, "2026-08-15").cele?.kcal).toBe(2000);
  });

  it("radzi sobie z dniem sprzed pierwszych celów", () => {
    ustawCele(db, { ...CELE, obowiazuje_od: "2026-08-15" });
    zapiszPosilek(db, { opis: "obiad", kcal: 800, ts: "2026-08-10T12:00:00.000Z" });

    const dzien = podsumowanieDnia(db, "2026-08-10");

    expect(dzien.cele).toBeNull();
    expect(dzien.pozostalo).toBeNull();
    expect(dzien.procent_kcal).toBeNull();
    expect(dzien.spozyte.kcal).toBe(800);
  });

  it("z dwóch celów tego samego dnia wygrywa ustawiony później", () => {
    ustawCele(db, { ...CELE, obowiazuje_od: "2026-08-15" });
    ustawCele(db, { ...CELE, kcal: 1800, obowiazuje_od: "2026-08-15" });

    expect(podsumowanieDnia(db, "2026-08-20").cele?.kcal).toBe(1800);
  });
});

describe("częste posiłki", () => {
  /** Data odniesienia podawana jawnie — inaczej testy zaczęłyby padać z czasem. */
  const DO = "2026-08-25";

  function zapisz(opis: string, kcal: number, data: string) {
    zapiszPosilek(db, { opis, kcal, bialko_g: kcal / 10, ts: `${data}T12:00:00.000Z` });
  }

  it("porządkuje po liczbie powtórzeń", () => {
    zapisz("owsianka", 400, "2026-08-20");
    zapisz("owsianka", 400, "2026-08-21");
    zapisz("owsianka", 400, "2026-08-22");
    zapisz("kanapka", 300, "2026-08-23");
    zapisz("kanapka", 300, "2026-08-24");
    zapisz("sałatka", 200, "2026-08-24");

    const czeste = czestePosilki(db, { do: DO });

    expect(czeste.map((p) => [p.opis, p.ile])).toEqual([
      ["owsianka", 3],
      ["kanapka", 2],
      ["sałatka", 1],
    ]);
  });

  it("bierze makro z najnowszego wystąpienia, nie ze średniej", () => {
    // Porcja urosła — podpowiedź ma proponować to, co jadło się ostatnio.
    zapisz("owsianka", 400, "2026-08-20");
    zapisz("owsianka", 600, "2026-08-24");

    expect(czestePosilki(db, { do: DO })[0]).toMatchObject({ opis: "owsianka", kcal: 600 });
  });

  it("pomija posiłki spoza okna", () => {
    zapisz("stare danie", 500, "2026-07-01");
    zapisz("świeże danie", 500, "2026-08-24");

    const czeste = czestePosilki(db, { dni: 30, do: DO });

    expect(czeste.map((p) => p.opis)).toEqual(["świeże danie"]);
  });

  it("przycina listę do podanego limitu", () => {
    for (const nazwa of ["a", "b", "c", "d", "e"]) zapisz(nazwa, 100, "2026-08-24");

    expect(czestePosilki(db, { limit: 3, do: DO })).toHaveLength(3);
  });

  it("na pustej bazie zwraca pustą listę", () => {
    expect(czestePosilki(db, { do: DO })).toEqual([]);
  });
});
