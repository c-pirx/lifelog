/**
 * Połączenie z bazą i uruchamianie migracji.
 *
 * Migracje wykonują się przy starcie procesu — nie ma osobnego kroku
 * wdrożeniowego do zapomnienia. Zastosowane pliki są zapisywane w tabeli
 * `_migracje`, więc ponowny start jest bezpieczny.
 */

import Database from "better-sqlite3";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Baza = Database.Database;

const TEN_PLIK = fileURLToPath(import.meta.url);

/** Katalog projektu — szukany w górę, żeby działało i z `src/`, i z `dist/`. */
function korzenProjektu(): string {
  let katalog = dirname(TEN_PLIK);
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(katalog, "package.json"))) return katalog;
    const wyzej = dirname(katalog);
    if (wyzej === katalog) break;
    katalog = wyzej;
  }
  throw new Error("Nie znaleziono katalogu projektu (brak package.json w górę drzewa)");
}

function wczytajMigracje(): { nazwa: string; sql: string }[] {
  const katalog = join(korzenProjektu(), "migrations");
  return readdirSync(katalog)
    .filter((nazwa) => nazwa.endsWith(".sql"))
    .sort()
    .map((nazwa) => ({ nazwa, sql: readFileSync(join(katalog, nazwa), "utf8") }));
}

export function uruchomMigracje(db: Baza): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migracje (
      nazwa      TEXT PRIMARY KEY,
      zastosowano TEXT NOT NULL
    )
  `);

  const juzZastosowane = new Set(
    db.prepare<[], { nazwa: string }>("SELECT nazwa FROM _migracje").all().map((w) => w.nazwa),
  );

  const zastosowaneTeraz: string[] = [];
  const zapisz = db.prepare("INSERT INTO _migracje (nazwa, zastosowano) VALUES (?, ?)");

  for (const migracja of wczytajMigracje()) {
    if (juzZastosowane.has(migracja.nazwa)) continue;

    // Każda migracja jest atomowa: albo przechodzi w całości, albo wcale.
    db.transaction(() => {
      db.exec(migracja.sql);
      zapisz.run(migracja.nazwa, new Date().toISOString());
    })();

    zastosowaneTeraz.push(migracja.nazwa);
  }

  return zastosowaneTeraz;
}

export type OpcjeBazy = {
  /** Ścieżka do pliku bazy albo ":memory:" w testach. */
  sciezka?: string;
};

export function otworzBaze(opcje: OpcjeBazy = {}): Baza {
  const sciezka = opcje.sciezka ?? process.env["DB_PATH"] ?? "./dane/asystent.db";
  const wPamieci = sciezka === ":memory:";

  if (!wPamieci) {
    mkdirSync(dirname(resolve(sciezka)), { recursive: true });
  }

  const db = new Database(sciezka);

  db.pragma("foreign_keys = ON");
  if (!wPamieci) {
    // WAL pozwala czytać w trakcie zapisu — istotne, gdy aplikacja webowa
    // odświeża ekran w chwili, gdy Claude zapisuje serię.
    db.pragma("journal_mode = WAL");
  }

  uruchomMigracje(db);
  return db;
}
