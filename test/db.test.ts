import { describe, expect, it } from "vitest";

import { otworzBaze, uruchomMigracje } from "../src/db/index.js";

describe("migracje", () => {
  it("tworzą komplet tabel w pustej bazie", () => {
    const db = otworzBaze({ sciezka: ":memory:" });

    const tabele = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((w) => w.name);

    for (const oczekiwana of [
      "cele",
      "posilki",
      "pozycje_posilku",
      "cwiczenia",
      "dni_planu",
      "cwiczenia_w_dniu",
      "sesje",
      "serie",
      "waga_ciala",
    ]) {
      expect(tabele).toContain(oczekiwana);
    }
  });

  it("są idempotentne — drugi start nie stosuje ich ponownie", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    expect(uruchomMigracje(db)).toEqual([]);
  });
});

describe("więzy schematu", () => {
  it("nie pozwalają na dwie aktywne sesje naraz", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const wstaw = db.prepare(
      "INSERT INTO sesje (start_ts, data_lokalna, status) VALUES (?, ?, 'aktywna')",
    );

    wstaw.run("2026-08-25T10:00:00.000Z", "2026-08-25");
    expect(() => wstaw.run("2026-08-25T11:00:00.000Z", "2026-08-25")).toThrow();
  });

  it("pozwalają na wiele sesji zakończonych", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const wstaw = db.prepare(
      "INSERT INTO sesje (start_ts, data_lokalna, status) VALUES (?, ?, 'zakonczona')",
    );

    wstaw.run("2026-08-24T10:00:00.000Z", "2026-08-24");
    expect(() => wstaw.run("2026-08-25T10:00:00.000Z", "2026-08-25")).not.toThrow();
  });

  it("usuwają pozycje razem z posiłkiem (kaskada)", () => {
    const db = otworzBaze({ sciezka: ":memory:" });

    const posilek = db
      .prepare(
        `INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                              zrodlo, pewnosc, utworzono)
         VALUES (?, ?, 'obiad', 'kurczak z ryżem', 700, 45, 80, 15, 'czat', 'szacowane', ?)`,
      )
      .run("2026-08-25T12:00:00.000Z", "2026-08-25", "2026-08-25T12:00:00.000Z");

    db.prepare("INSERT INTO pozycje_posilku (posilek_id, nazwa, ilosc_g) VALUES (?, 'ryż', 100)").run(
      posilek.lastInsertRowid,
    );

    db.prepare("DELETE FROM posilki WHERE id = ?").run(posilek.lastInsertRowid);

    const pozostale = db
      .prepare<[], { ile: number }>("SELECT COUNT(*) AS ile FROM pozycje_posilku")
      .get();
    expect(pozostale?.ile).toBe(0);
  });

  it("odrzucają nieznaną porę posiłku", () => {
    const db = otworzBaze({ sciezka: ":memory:" });

    expect(() =>
      db
        .prepare(
          `INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                                zrodlo, pewnosc, utworzono)
           VALUES (?, ?, 'drugie sniadanie', 'x', 1, 1, 1, 1, 'czat', 'dokladne', ?)`,
        )
        .run("2026-08-25T10:00:00.000Z", "2026-08-25", "2026-08-25T10:00:00.000Z"),
    ).toThrow();
  });

  it("dopuszczają tylko jeden pomiar wagi na dobę", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const wstaw = db.prepare("INSERT INTO waga_ciala (ts, data_lokalna, kg) VALUES (?, ?, ?)");

    wstaw.run("2026-08-25T06:00:00.000Z", "2026-08-25", 81.4);
    expect(() => wstaw.run("2026-08-25T18:00:00.000Z", "2026-08-25", 82.1)).toThrow();
  });
});
