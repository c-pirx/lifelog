import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { otworzBaze, uruchomMigracje } from "../src/db/index.js";

/** Katalog migracji liczony od tego pliku — w git worktree cwd bywa gdzie indziej. */
const KATALOG_MIGRACJI = fileURLToPath(new URL("../migrations/", import.meta.url));

/**
 * Baza doprowadzona do stanu sprzed wskazanej migracji: wszystkie wcześniejsze
 * pliki zastosowane i odnotowane, tak jakby stała na starej wersji aplikacji.
 */
function bazaPrzedMigracja(nazwaMigracji: string) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE _migracje (nazwa TEXT PRIMARY KEY, zastosowano TEXT NOT NULL)");

  const zapisz = db.prepare("INSERT INTO _migracje (nazwa, zastosowano) VALUES (?, ?)");
  for (const nazwa of readdirSync(KATALOG_MIGRACJI).filter((n) => n.endsWith(".sql")).sort()) {
    if (nazwa >= nazwaMigracji) break;
    db.exec(readFileSync(KATALOG_MIGRACJI + nazwa, "utf8"));
    zapisz.run(nazwa, "2026-01-01T00:00:00.000Z");
  }

  return db;
}

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
      "plany",
      "dni_planu",
      "cwiczenia_w_dniu",
      "sesje",
      "serie",
      "waga_ciala",
      "aktywnosci",
    ]) {
      expect(tabele).toContain(oczekiwana);
    }
  });

  it("są idempotentne — drugi start nie stosuje ich ponownie", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    expect(uruchomMigracje(db)).toEqual([]);
  });
});

describe("migracja 0004 — plany", () => {
  /** Baza sprzed migracji, z dniem planu i rozegraną na nim sesją. */
  function bazaZHistoria() {
    const db = bazaPrzedMigracja("0004");

    const dzien = db
      .prepare("INSERT INTO dni_planu (kod, nazwa, dzien_tygodnia) VALUES ('A', 'Nogi', 1)")
      .run();
    db.prepare(
      `INSERT INTO sesje (dzien_id, start_ts, data_lokalna, status)
       VALUES (?, '2026-08-17T09:00:00.000Z', '2026-08-17', 'zakonczona')`,
    ).run(dzien.lastInsertRowid);

    return { db, dzienId: Number(dzien.lastInsertRowid) };
  }

  it("zawija istniejące dni w jeden plan domyślny", () => {
    const { db, dzienId } = bazaZHistoria();

    uruchomMigracje(db);

    const plan = db
      .prepare<[], { nazwa: string; domyslny: number }>("SELECT nazwa, domyslny FROM plany")
      .get();
    expect(plan?.domyslny).toBe(1);

    const dzien = db
      .prepare<[number], { plan_id: number }>("SELECT plan_id FROM dni_planu WHERE id = ?")
      .get(dzienId);
    expect(dzien?.plan_id).toBeGreaterThan(0);
  });

  it("nie osierocia sesji przy przebudowie tabeli dni", () => {
    const { db, dzienId } = bazaZHistoria();

    uruchomMigracje(db);

    const sesja = db
      .prepare<[], { dzien_id: number }>("SELECT dzien_id FROM sesje")
      .get();
    expect(sesja?.dzien_id).toBe(dzienId);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("przywraca kontrolę klucza obcego po migracjach", () => {
    const { db } = bazaZHistoria();

    uruchomMigracje(db);

    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("migracja 0005 — pewność", () => {
  /** Baza sprzed migracji, z posiłkiem i jego pozycją — jest co osierocić. */
  function bazaZPosilkiem() {
    const db = bazaPrzedMigracja("0005");

    const posilek = db
      .prepare(
        `INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                              zrodlo, pewnosc, utworzono)
         VALUES ('2026-08-25T12:00:00.000Z', '2026-08-25', 'obiad', 'kurczak z ryżem',
                 700, 45, 80, 15, 'czat', 'szacowane', '2026-08-25T12:00:00.000Z')`,
      )
      .run();
    db.prepare("INSERT INTO pozycje_posilku (posilek_id, nazwa, kcal) VALUES (?, 'ryż', 210)").run(
      posilek.lastInsertRowid,
    );

    return { db, posilekId: Number(posilek.lastInsertRowid) };
  }

  it("zachowuje posiłki, ich id i powiązane pozycje", () => {
    const { db, posilekId } = bazaZPosilkiem();

    uruchomMigracje(db);

    const posilek = db
      .prepare<[number], { opis: string; pewnosc: string }>(
        "SELECT opis, pewnosc FROM posilki WHERE id = ?",
      )
      .get(posilekId);
    expect(posilek).toEqual({ opis: "kurczak z ryżem", pewnosc: "szacowane" });

    const pozycja = db
      .prepare<[number], { nazwa: string }>(
        "SELECT nazwa FROM pozycje_posilku WHERE posilek_id = ?",
      )
      .get(posilekId);
    expect(pozycja?.nazwa).toBe("ryż");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("dopuszcza nową wartość i dalej odrzuca nieznane", () => {
    const { db } = bazaZPosilkiem();
    uruchomMigracje(db);

    const wstaw = db.prepare(
      `INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                            zrodlo, pewnosc, utworzono)
       VALUES ('2026-08-25T18:00:00.000Z', '2026-08-25', 'kolacja', 'x', 1, 1, 1, 1, 'czat', ?,
               '2026-08-25T18:00:00.000Z')`,
    );

    expect(() => wstaw.run("niepewne")).not.toThrow();
    expect(() => wstaw.run("bzdura")).toThrow();
  });

  it("odtwarza indeks po dacie — DROP TABLE zabrał go razem ze starą tabelą", () => {
    const { db } = bazaZPosilkiem();
    uruchomMigracje(db);

    const indeksy = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'posilki'",
      )
      .all()
      .map((w) => w.name);
    expect(indeksy).toContain("idx_posilki_data");
  });
});

describe("więzy schematu", () => {
  it("dopuszczają tylko jeden plan domyślny", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const wstaw = db.prepare("INSERT INTO plany (nazwa, domyslny) VALUES (?, 1)");

    wstaw.run("Pierwszy");
    expect(() => wstaw.run("Drugi")).toThrow();
  });

  it("pozwalają dwóm planom mieć dzień o tym samym kodzie", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const plan = db.prepare("INSERT INTO plany (nazwa, domyslny) VALUES (?, 0)");
    const pierwszy = plan.run("PPL");
    const drugi = plan.run("Full body");

    const dzien = db.prepare("INSERT INTO dni_planu (plan_id, kod, nazwa) VALUES (?, 'A', 'Nogi')");
    dzien.run(pierwszy.lastInsertRowid);

    expect(() => dzien.run(drugi.lastInsertRowid)).not.toThrow();
  });

  it("nie pozwalają powtórzyć kodu dnia w jednym planie", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const plan = db.prepare("INSERT INTO plany (nazwa, domyslny) VALUES ('PPL', 0)").run();

    const dzien = db.prepare("INSERT INTO dni_planu (plan_id, kod, nazwa) VALUES (?, 'A', ?)");
    dzien.run(plan.lastInsertRowid, "Nogi");

    expect(() => dzien.run(plan.lastInsertRowid, "Inne nogi")).toThrow();
  });

  it("usuwają dni razem z planem (kaskada)", () => {
    const db = otworzBaze({ sciezka: ":memory:" });
    const plan = db.prepare("INSERT INTO plany (nazwa, domyslny) VALUES ('PPL', 0)").run();
    db.prepare("INSERT INTO dni_planu (plan_id, kod, nazwa) VALUES (?, 'A', 'Nogi')").run(
      plan.lastInsertRowid,
    );

    db.prepare("DELETE FROM plany WHERE id = ?").run(plan.lastInsertRowid);

    expect(db.prepare<[], { ile: number }>("SELECT COUNT(*) AS ile FROM dni_planu").get()?.ile).toBe(
      0,
    );
  });

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

describe("migracja 0006 — aktywności", () => {
  /** Baza sprzed migracji, z posiłkiem i rozegraną sesją — jest co osierocić. */
  function bazaZDanymi() {
    const db = bazaPrzedMigracja("0006");

    db.prepare(
      `INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g,
                            zrodlo, pewnosc, utworzono)
       VALUES ('2026-08-25T10:00:00.000Z', '2026-08-25', 'obiad', 'ryż z kurczakiem',
               700, 50, 80, 15, 'czat', 'szacowane', '2026-08-25T10:00:00.000Z')`,
    ).run();

    db.prepare("INSERT INTO plany (id, nazwa, domyslny) VALUES (1, 'Mój plan', 1)").run();
    const dzien = db
      .prepare("INSERT INTO dni_planu (plan_id, kod, nazwa) VALUES (1, 'A', 'Nogi')")
      .run();
    db.prepare(
      `INSERT INTO sesje (dzien_id, start_ts, data_lokalna, status)
       VALUES (?, '2026-08-24T09:00:00.000Z', '2026-08-24', 'zakonczona')`,
    ).run(dzien.lastInsertRowid);

    return db;
  }

  it("dokłada tabelę do bazy z danymi, nie ruszając istniejących wpisów", () => {
    const db = bazaZDanymi();

    expect(uruchomMigracje(db)).toContain("0006_aktywnosci.sql");

    const posilki = db
      .prepare<[], { ile: number }>("SELECT COUNT(*) AS ile FROM posilki")
      .get();
    expect(posilki?.ile).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("odrzuca źródło spoza listy — apka i czat, nic więcej", () => {
    const db = otworzBaze({ sciezka: ":memory:" });

    expect(() =>
      db
        .prepare(
          `INSERT INTO aktywnosci (ts, data_lokalna, dyscyplina, czas_s, zrodlo, utworzono)
           VALUES ('2026-08-25T10:00:00.000Z', '2026-08-25', 'rower', 600, 'zdjecie', ?)`,
        )
        .run("2026-08-25T10:00:00.000Z"),
    ).toThrow();
  });
});
