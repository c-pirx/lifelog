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

function wczytajMigracje(katalogMigracji?: string): { nazwa: string; sql: string }[] {
  const katalog = katalogMigracji ?? join(korzenProjektu(), "migrations");
  return readdirSync(katalog)
    .filter((nazwa) => nazwa.endsWith(".sql"))
    .sort()
    .map((nazwa) => ({ nazwa, sql: readFileSync(join(katalog, nazwa), "utf8") }));
}

export function uruchomMigracje(db: Baza, katalogMigracji?: string): string[] {
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

  /**
   * Zdjęcie w SQLite więzu UNIQUE zadeklarowanego przy kolumnie wymaga
   * przebudowy tabeli: nowa obok, kopia, DROP, RENAME. DROP na tabeli, do
   * której prowadzą klucze obce, SQLite wykonuje jak skasowanie wszystkich
   * wierszy i przerywa na naruszeniu więzów — dlatego migracje biegną
   * z wyłączonym kluczem.
   *
   * Pragma jest bezczynna wewnątrz transakcji, a każda migracja jest w nią
   * opakowana, więc przełącznik musi stać wokół całej pętli.
   */
  const kluczeWlaczone = db.pragma("foreign_keys", { simple: true }) === 1;
  if (kluczeWlaczone) db.pragma("foreign_keys = OFF");

  try {
    for (const migracja of wczytajMigracje(katalogMigracji)) {
      if (juzZastosowane.has(migracja.nazwa)) continue;

      // Każda migracja jest atomowa: albo przechodzi w całości, albo wcale.
      db.transaction(() => {
        db.exec(migracja.sql);
        zapisz.run(migracja.nazwa, new Date().toISOString());
      })();

      zastosowaneTeraz.push(migracja.nazwa);
    }
  } finally {
    if (kluczeWlaczone) db.pragma("foreign_keys = ON");
  }

  // To dopiero zamienia wyłączony klucz z ryzyka w kontrolę. Bez tego
  // przebudowa mogłaby po cichu osierocić sesje, a błąd wyszedłby tygodnie
  // później, przy pierwszym odczycie historii.
  if (kluczeWlaczone && zastosowaneTeraz.length > 0) {
    const osierocone = db.pragma("foreign_key_check") as unknown[];
    if (osierocone.length > 0) {
      throw new Error(
        `Migracje (${zastosowaneTeraz.join(", ")}) zostawiły ${osierocone.length} ` +
          "osieroconych wierszy — baza wymaga ręcznego sprawdzenia.",
      );
    }
  }

  return zastosowaneTeraz;
}

export type OpcjeBazy = {
  /** Ścieżka do pliku bazy albo ":memory:" w testach. */
  sciezka?: string;
  /**
   * Katalog z plikami .sql. Domyślnie `migrations/` w korzeniu projektu —
   * schemat dziennika. Rejestr użytkowników podaje tu własny zestaw.
   */
  katalogMigracji?: string;
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

  uruchomMigracje(db, opcje.katalogMigracji);
  return db;
}
