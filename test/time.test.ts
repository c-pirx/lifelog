import { describe, expect, it } from "vitest";

import {
  dataLokalna,
  dzienTygodnia,
  godzinaLokalna,
  parsujCzas,
  przesunDate,
  zakresDat,
} from "../src/lib/time.js";

const WARSZAWA = "Europe/Warsaw";

describe("granice doby", () => {
  it("22:30 UTC to już następny dzień w Polsce (czas letni, +2h)", () => {
    // Klasyczna pułapka: późna kolacja zapisana wieczorem wpadłaby
    // do poprzedniej doby, gdyby liczyć dzień w UTC.
    expect(dataLokalna("2026-08-24T22:30:00.000Z", WARSZAWA)).toBe("2026-08-25");
  });

  it("23:30 UTC to następny dzień także zimą (+1h)", () => {
    expect(dataLokalna("2026-01-10T23:30:00.000Z", WARSZAWA)).toBe("2026-01-11");
  });

  it("21:00 UTC latem to jeszcze ten sam dzień (23:00 lokalnie)", () => {
    expect(dataLokalna("2026-08-24T21:00:00.000Z", WARSZAWA)).toBe("2026-08-24");
  });

  it("północ lokalna trafia we właściwą dobę", () => {
    // 22:00 UTC = 00:00 lokalnie następnego dnia (czas letni).
    expect(dataLokalna("2026-08-24T22:00:00.000Z", WARSZAWA)).toBe("2026-08-25");
    expect(godzinaLokalna("2026-08-24T22:00:00.000Z", WARSZAWA)).toBe("00:00");
  });

  it("różni się od doby liczonej w UTC", () => {
    const chwila = "2026-08-24T22:30:00.000Z";
    expect(dataLokalna(chwila, "UTC")).toBe("2026-08-24");
    expect(dataLokalna(chwila, WARSZAWA)).toBe("2026-08-25");
  });
});

describe("zmiana czasu", () => {
  it("działa w dobie przejścia na czas letni (29.03.2026)", () => {
    expect(godzinaLokalna("2026-03-29T00:30:00.000Z", WARSZAWA)).toBe("01:30");
    // O 02:00 lokalnie zegar skacze na 03:00 — 01:30 UTC to już 03:30.
    expect(godzinaLokalna("2026-03-29T01:30:00.000Z", WARSZAWA)).toBe("03:30");
  });

  it("działa w dobie przejścia na czas zimowy (25.10.2026)", () => {
    expect(godzinaLokalna("2026-10-25T00:30:00.000Z", WARSZAWA)).toBe("02:30");
    expect(godzinaLokalna("2026-10-25T01:30:00.000Z", WARSZAWA)).toBe("02:30");
  });
});

describe("dzień tygodnia", () => {
  it("liczy poniedziałek jako 1, a niedzielę jako 7", () => {
    expect(dzienTygodnia("2026-08-24T09:00:00.000Z", WARSZAWA)).toBe(1); // poniedziałek
    expect(dzienTygodnia("2026-08-28T09:00:00.000Z", WARSZAWA)).toBe(5); // piątek
    expect(dzienTygodnia("2026-08-30T09:00:00.000Z", WARSZAWA)).toBe(7); // niedziela
  });

  it("uwzględnia strefę przy zmianie doby", () => {
    // Niedziela 22:30 UTC = poniedziałek 00:30 w Polsce.
    const chwila = "2026-08-30T22:30:00.000Z";
    expect(dzienTygodnia(chwila, "UTC")).toBe(7);
    expect(dzienTygodnia(chwila, WARSZAWA)).toBe(1);
  });
});

describe("parsowanie czasu podanego przez użytkownika", () => {
  it("bierze pełny ISO ze strefą wprost", () => {
    expect(parsujCzas("2026-08-25T07:00:00Z", WARSZAWA)).toBe("2026-08-25T07:00:00.000Z");
  });

  it("traktuje czas bez strefy jako ścienny w Polsce", () => {
    // 09:00 w Polsce latem to 07:00 UTC.
    expect(parsujCzas("2026-08-25 09:00", WARSZAWA)).toBe("2026-08-25T07:00:00.000Z");
    expect(parsujCzas("2026-08-25T09:00", WARSZAWA)).toBe("2026-08-25T07:00:00.000Z");
  });

  it("uwzględnia czas zimowy", () => {
    // 09:00 w Polsce zimą to 08:00 UTC.
    expect(parsujCzas("2026-01-15 09:00", WARSZAWA)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("trafia we właściwą chwilę w dobie zmiany czasu", () => {
    // Po przejściu na czas letni 29.03.2026 offset to +2h.
    expect(parsujCzas("2026-03-29 10:00", WARSZAWA)).toBe("2026-03-29T08:00:00.000Z");
    // Przed przejściem, tej samej doby, offset to jeszcze +1h.
    expect(parsujCzas("2026-03-29 01:00", WARSZAWA)).toBe("2026-03-29T00:00:00.000Z");
  });

  it("sama godzina oznacza dzisiaj", () => {
    const wynik = parsujCzas("09:00", WARSZAWA);
    expect(godzinaLokalna(wynik, WARSZAWA)).toBe("09:00");
  });

  it("zapisany czas wraca po konwersji w obie strony", () => {
    const utc = parsujCzas("2026-08-24 22:30", WARSZAWA);
    expect(godzinaLokalna(utc, WARSZAWA)).toBe("22:30");
    expect(dataLokalna(utc, WARSZAWA)).toBe("2026-08-24");
  });

  it("odrzuca format, którego nie rozumie", () => {
    expect(() => parsujCzas("wczoraj wieczorem", WARSZAWA)).toThrow(/format/i);
  });
});

describe("arytmetyka dat", () => {
  it("przesuwa przez granicę miesiąca i roku", () => {
    expect(przesunDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(przesunDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(przesunDate("2026-08-25", -7)).toBe("2026-08-18");
  });

  it("obsługuje rok przestępny", () => {
    expect(przesunDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(przesunDate("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("buduje zakres dat włącznie z końcem", () => {
    expect(zakresDat("2026-08-24", "2026-08-27")).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ]);
  });

  it("zwraca pustą listę, gdy koniec jest przed początkiem", () => {
    expect(zakresDat("2026-08-27", "2026-08-24")).toEqual([]);
  });

  it("odrzuca datę w złym formacie", () => {
    expect(() => przesunDate("25.08.2026", 1)).toThrow();
  });
});
