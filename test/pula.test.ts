/**
 * Testy puli otwartych baz użytkowników.
 *
 * Pula to jedyne miejsce w projekcie, w którym dałoby się pomylić
 * użytkownika — oddać uchwyt Kasi żądaniu Tomka. Dlatego obok mechaniki LRU
 * najważniejszy jest tu test rozdzielności: zapis w bazie A nie może być
 * widoczny w bazie B.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { utworzPule, zmigrujWszystkie, type PulaBaz } from "../src/db/pula.js";

let katalogi: string[] = [];
let pule: PulaBaz[] = [];

function swiezyKatalog(): string {
  const katalog = mkdtempSync(join(tmpdir(), "pula-test-"));
  katalogi.push(katalog);
  return katalog;
}

function swiezaPula(limit?: number): PulaBaz {
  const pula = utworzPule({ katalog: swiezyKatalog(), ...(limit ? { limit } : {}) });
  pule.push(pula);
  return pula;
}

afterEach(() => {
  // Najpierw zamknięcie uchwytów, potem sprzątanie plików — na Windowsie
  // otwarty plik bazy nie da się skasować.
  for (const pula of pule) pula.zamknij();
  pule = [];
  for (const katalog of katalogi) rmSync(katalog, { recursive: true, force: true });
  katalogi = [];
});

describe("pula baz", () => {
  it("tworzy plik <id>.db i stosuje w nim schemat dziennika", () => {
    const katalog = swiezyKatalog();
    const pula = utworzPule({ katalog });
    pule.push(pula);

    const db = pula.daj(7);

    expect(existsSync(join(katalog, "7.db"))).toBe(true);
    const tabele = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((w) => w.name);
    expect(tabele).toContain("posilki");
    expect(tabele).toContain("sesje");
  });

  it("drugie wywołanie oddaje ten sam uchwyt, nie nowe połączenie", () => {
    const pula = swiezaPula();
    expect(pula.daj(1)).toBe(pula.daj(1));
  });

  it("dwa identyfikatory to dwie rozdzielne bazy — zapis u A niewidoczny u B", () => {
    const pula = swiezaPula();
    const a = pula.daj(1);
    const b = pula.daj(2);

    a.prepare(
      "INSERT INTO posilki (ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g, tluszcz_g, zrodlo, pewnosc, utworzono)" +
        " VALUES ('2026-08-28T10:00:00.000Z', '2026-08-28', 'obiad', 'owsianka', 500, 30, 60, 15, 'czat', 'dokladne', '2026-08-28T10:00:00.000Z')",
    ).run();

    expect(a.prepare("SELECT COUNT(*) AS ile FROM posilki").get()).toEqual({ ile: 1 });
    expect(b.prepare("SELECT COUNT(*) AS ile FROM posilki").get()).toEqual({ ile: 0 });
  });

  it("po przekroczeniu limitu zamyka uchwyt najdawniej używany", () => {
    const pula = swiezaPula(2);
    const a = pula.daj(1);
    const b = pula.daj(2);
    pula.daj(3);

    expect(a.open).toBe(false);
    expect(b.open).toBe(true);
  });

  it("użycie odświeża pozycję — wypada najdawniej UŻYWANY, nie najdawniej otwarty", () => {
    const pula = swiezaPula(2);
    const a = pula.daj(1);
    const b = pula.daj(2);
    pula.daj(1); // odświeżenie A: teraz najstarsze jest B
    pula.daj(3);

    expect(b.open).toBe(false);
    expect(a.open).toBe(true);
  });

  it("wyparta baza wraca do życia świeżym uchwytem z danymi na miejscu", () => {
    const pula = swiezaPula(2);
    const a = pula.daj(1);
    a.prepare("INSERT INTO waga_ciala (ts, data_lokalna, kg) VALUES ('2026-08-28T08:00:00.000Z', '2026-08-28', 80)").run();

    pula.daj(2);
    pula.daj(3); // wypiera 1

    const aZnow = pula.daj(1);
    expect(aZnow).not.toBe(a);
    expect(aZnow.prepare("SELECT COUNT(*) AS ile FROM waga_ciala").get()).toEqual({ ile: 1 });
  });

  it("zamknij() zamyka wszystkie uchwyty", () => {
    const pula = swiezaPula();
    const a = pula.daj(1);
    const b = pula.daj(2);

    pula.zamknij();

    expect(a.open).toBe(false);
    expect(b.open).toBe(false);
  });

  it("zmigrujWszystkie doprowadza każdą bazę do bieżącego schematu przy starcie", () => {
    // Dwie bazy na starym schemacie: katalog migracji ma jeden plik.
    const katalogBaz = swiezyKatalog();
    const stareMigracje = swiezyKatalog();
    writeFileSync(join(stareMigracje, "0001_start.sql"), "CREATE TABLE proba (id INTEGER PRIMARY KEY);");

    const stara = utworzPule({ katalog: katalogBaz, katalogMigracji: stareMigracje });
    stara.daj(1).prepare("INSERT INTO proba DEFAULT VALUES").run();
    stara.daj(2);
    stara.zamknij();

    // Wdrożenie: dochodzi migracja 0002. Start procesu ma ją zastosować
    // wszystkim bazom — także kontom, które od dawna nie zaglądały.
    const noweMigracje = swiezyKatalog();
    writeFileSync(join(noweMigracje, "0001_start.sql"), "CREATE TABLE proba (id INTEGER PRIMARY KEY);");
    writeFileSync(join(noweMigracje, "0002_kolumna.sql"), "ALTER TABLE proba ADD COLUMN uwaga TEXT;");

    const wynik = zmigrujWszystkie(katalogBaz, noweMigracje);
    expect(wynik.baz).toBe(2);
    expect(wynik.zastosowanych).toBe(2); // po jednej nowej migracji na bazę

    // Dane przetrwały, schemat jest nowy.
    const nowa = utworzPule({ katalog: katalogBaz, katalogMigracji: noweMigracje });
    pule.push(nowa);
    const kolumny = nowa
      .daj(1)
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('proba')")
      .all()
      .map((k) => k.name);
    expect(kolumny).toContain("uwaga");
    expect(nowa.daj(1).prepare("SELECT COUNT(*) AS ile FROM proba").get()).toEqual({ ile: 1 });
  });

  it("zmigrujWszystkie na pustym katalogu niczego nie robi i nie przeszkadza", () => {
    expect(zmigrujWszystkie(swiezyKatalog())).toEqual({ baz: 0, zastosowanych: 0 });
  });

  it("odrzuca identyfikator niebędący dodatnią liczbą całkowitą — nazwa pliku powstaje z tej wartości", () => {
    const pula = swiezaPula();
    expect(() => pula.daj(0)).toThrow();
    expect(() => pula.daj(-1)).toThrow();
    expect(() => pula.daj(1.5)).toThrow();
    expect(() => pula.daj(Number.NaN)).toThrow();
  });
});
