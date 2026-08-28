/**
 * Jednorazowe przeniesienie bazy jednoosobowej na układ wielodostępowy.
 * Uruchomienie (przy ZATRZYMANYM serwerze):
 *
 *   npm run build
 *   npm run przenies -- --login twoj-login --haslo twoje-nowe-haslo
 *
 * Co robi, w kolejności:
 *   1. kopia zapasowa starej bazy (asystent.db.przed-przeniesieniem),
 *   2. rejestr.db z kontem nr 1 (hasło podane flagą, token konektora nowy),
 *   3. przeniesienie asystent.db → uzytkownicy/<id>.db.
 *
 * Sięga po zbudowaną domenę z dist/ — hasła haszuje dokładnie ten sam kod,
 * który potem sprawdza je przy logowaniu. Dlatego wymaga `npm run build`.
 */

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KORZEN = join(fileURLToPath(new URL(".", import.meta.url)), "..");

try {
  process.loadEnvFile(join(KORZEN, ".env"));
} catch {
  // Brak .env — zmienne przychodzą ze środowiska (serwer).
}

const KATALOG = process.env.DANE_KATALOG ?? join(KORZEN, "dane");
const STARA = join(KATALOG, "asystent.db");
const REJESTR = join(KATALOG, "rejestr.db");

function flaga(nazwa) {
  const indeks = process.argv.indexOf(`--${nazwa}`);
  return indeks > 0 ? process.argv[indeks + 1] : undefined;
}

const login = flaga("login");
const haslo = flaga("haslo");
const strefa = flaga("strefa");

if (!login || !haslo) {
  console.error(
    "Podaj dane konta, które przejmie dotychczasowy dziennik:\n" +
      "  npm run przenies -- --login twoj-login --haslo twoje-nowe-haslo [--strefa Europe/Warsaw]",
  );
  process.exit(1);
}

if (!existsSync(STARA)) {
  console.error(`Nie ma ${STARA} — nie ma czego przenosić.`);
  process.exit(1);
}

const DIST = join(KORZEN, "dist");
if (!existsSync(join(DIST, "domain", "konta.js"))) {
  console.error("Brak zbudowanego kodu. Uruchom najpierw: npm run build");
  process.exit(1);
}

const { otworzBaze, katalogMigracjiRejestru } = await import(
  pathToFileURL(join(DIST, "db", "index.js"))
);
const { zarejestruj } = await import(pathToFileURL(join(DIST, "domain", "konta.js")));
const Database = (await import("better-sqlite3")).default;

// 1. Kopia przez API kopii SQLite, nie zwykłe skopiowanie pliku — baza mogła
//    zostać zamknięta w trybie WAL i część danych siedzi w pliku -wal.
const KOPIA = `${STARA}.przed-przeniesieniem`;
if (existsSync(KOPIA)) {
  console.error(`Kopia ${KOPIA} już istnieje — wygląda na drugie uruchomienie. Przerywam.`);
  process.exit(1);
}
const zrodlo = new Database(STARA, { readonly: true });
await zrodlo.backup(KOPIA);
zrodlo.close();
console.log(`Kopia: ${KOPIA}`);

// 2. Rejestr z kontem. Zgoda: przenosisz własne dane na własny serwer.
const rejestr = otworzBaze({ sciezka: REJESTR, katalogMigracji: katalogMigracjiRejestru() });
const zajete = rejestr.prepare("SELECT COUNT(*) AS ile FROM uzytkownicy").get();
if (zajete.ile > 0) {
  console.error("Rejestr ma już konta — to przeniesienie zostało chyba wykonane. Przerywam.");
  process.exit(1);
}

const wynik = zarejestruj(rejestr, {
  kod: "przeniesienie",
  kodOczekiwany: "przeniesienie",
  login,
  haslo,
  zgoda: true,
  ...(strefa ? { strefa } : {}),
});
rejestr.close();

// 3. Dziennik pod numer konta. Kopia z kroku 1 jest spójna, więc pliki -wal
//    i -shm zostawiamy przy oryginale — SQLite odtworzy z nich stan przy
//    pierwszym otwarciu pod nową nazwą.
const CEL = join(KATALOG, "uzytkownicy", `${wynik.id}.db`);
const { mkdirSync } = await import("node:fs");
mkdirSync(join(KATALOG, "uzytkownicy"), { recursive: true });
renameSync(STARA, CEL);
for (const przyrostek of ["-wal", "-shm"]) {
  if (existsSync(`${STARA}${przyrostek}`)) renameSync(`${STARA}${przyrostek}`, `${CEL}${przyrostek}`);
}

console.log(`Dziennik: ${CEL}`);
console.log();
console.log(`Konto: ${login} (nr ${wynik.id})`);
console.log("Adres konektora (pokazywany tylko teraz — wklej go na claude.ai):");
console.log(`  https://TWOJA-DOMENA/mcp/${wynik.tokenKonektora}`);
console.log();
console.log("Można uruchomić serwer.");
