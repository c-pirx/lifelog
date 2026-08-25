/**
 * Czyści bazę z wszystkich danych, zachowując strukturę tabel.
 * Uruchomienie: `node tools/wyczysc.mjs [--tak]`
 *
 * Przydatne po zabawie danymi poglądowymi, gdy chcesz zacząć zapisywać
 * naprawdę. Operacja jest nieodwracalna, więc wymaga potwierdzenia flagą.
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const SCIEZKA = process.env.DB_PATH ?? "./dane/asystent.db";

if (!process.argv.includes("--tak")) {
  console.log(
    `To usunie WSZYSTKIE dane z ${SCIEZKA} bez możliwości cofnięcia.\n` +
      "Jeśli na pewno tego chcesz, uruchom ponownie z flagą --tak:\n" +
      "  npm run reset -- --tak",
  );
  process.exit(1);
}

if (!existsSync(SCIEZKA)) {
  console.log(`Baza ${SCIEZKA} nie istnieje — nie ma czego czyścić.`);
  process.exit(0);
}

const db = new Database(SCIEZKA);
db.pragma("foreign_keys = ON");

// Kolejność ma znaczenie: najpierw tabele zależne, potem te, do których się odwołują.
const tabele = [
  "serie",
  "sesje",
  "cwiczenia_w_dniu",
  "dni_planu",
  "cwiczenia",
  "pozycje_posilku",
  "posilki",
  "cele",
  "waga_ciala",
];

db.transaction(() => {
  for (const tabela of tabele) {
    const { changes } = db.prepare(`DELETE FROM ${tabela}`).run();
    if (changes > 0) console.log(`  ${tabela}: usunięto ${changes}`);
  }
  // Numeracja od nowa, żeby identyfikatory w podsumowaniach zaczynały się od 1.
  db.prepare("DELETE FROM sqlite_sequence").run();
})();

console.log("Baza wyczyszczona.");
