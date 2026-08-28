/**
 * Czyści lokalne dane: rejestr użytkowników i wszystkie dzienniki.
 * Uruchomienie: `node tools/wyczysc.mjs [--tak]`
 *
 * Przydatne po zabawie danymi poglądowymi, gdy chcesz zacząć zapisywać
 * naprawdę. Kasujemy pliki baz zamiast wierszy w tabelach — przy bazie na
 * użytkownika to jedyna wersja, która nie zestarzeje się przy następnej
 * migracji (poprzednia wersja tego skryptu nie znała tabel dodanych po
 * jej napisaniu). Operacja jest nieodwracalna, więc wymaga flagi.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const KATALOG = process.env.DANE_KATALOG ?? "./dane";

if (!process.argv.includes("--tak")) {
  console.log(
    `To usunie WSZYSTKIE konta i dzienniki z ${KATALOG} bez możliwości cofnięcia.\n` +
      "Jeśli na pewno tego chcesz, uruchom ponownie z flagą --tak:\n" +
      "  npm run reset -- --tak",
  );
  process.exit(1);
}

if (!existsSync(KATALOG)) {
  console.log(`Katalog ${KATALOG} nie istnieje — nie ma czego czyścić.`);
  process.exit(0);
}

// Kasujemy wyłącznie pliki baz (razem z plikami -wal/-shm), nie cały katalog:
// gdyby ktoś trzymał w katalogu danych coś swojego, ma to przetrwać.
let usuniete = 0;
const usunBazy = (katalog) => {
  for (const nazwa of readdirSync(katalog)) {
    if (/\.db(-wal|-shm)?$/.test(nazwa)) {
      rmSync(join(katalog, nazwa), { force: true });
      usuniete += 1;
      console.log(`  usunięto ${join(katalog, nazwa)}`);
    }
  }
};

usunBazy(KATALOG);
const uzytkownicy = join(KATALOG, "uzytkownicy");
if (existsSync(uzytkownicy)) usunBazy(uzytkownicy);

console.log(usuniete > 0 ? "Dane wyczyszczone." : "Nie było żadnych baz do usunięcia.");
