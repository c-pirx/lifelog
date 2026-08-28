/**
 * Administracja kontami z wiersza poleceń — przez ssh, bez panelu w UI.
 * Zero nowych tras HTTP oznacza zero nowej powierzchni ataku; to również
 * jedyna ścieżka resetu hasła, zamiast wysyłki e-maili.
 *
 *   npm run konta -- lista
 *   npm run konta -- utworz <login> <haslo>         # konto poza listą oczekujących
 *   npm run konta -- haslo <login> <nowe-haslo>     # reset hasła
 *   npm run konta -- zablokuj <login>               # konto i konektor gasną
 *   npm run konta -- odblokuj <login>
 *   npm run konta -- usun <login> --tak             # kasuje TAKŻE dziennik
 *
 * Wymaga `npm run build` — hasła haszuje ten sam kod, który je sprawdza.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KORZEN = join(fileURLToPath(new URL(".", import.meta.url)), "..");

try {
  process.loadEnvFile(join(KORZEN, ".env"));
} catch {
  // Brak .env — zmienne przychodzą ze środowiska (serwer).
}

const KATALOG = process.env.DANE_KATALOG ?? join(KORZEN, "dane");
const REJESTR = join(KATALOG, "rejestr.db");

if (!existsSync(REJESTR)) {
  console.error(`Nie ma rejestru (${REJESTR}). Świeża instalacja nie ma jeszcze kont.`);
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
const { utworzKonto, zmienHaslo } = await import(pathToFileURL(join(DIST, "domain", "konta.js")));

const rejestr = otworzBaze({ sciezka: REJESTR, katalogMigracji: katalogMigracjiRejestru() });

const [polecenie, login, ...reszta] = process.argv.slice(2);

function kontoAlboKoniec(szukanyLogin) {
  const wiersz = rejestr
    .prepare("SELECT * FROM uzytkownicy WHERE login = ?")
    .get(szukanyLogin ?? "");
  if (!wiersz) {
    console.error(`Nie ma konta o loginie: ${szukanyLogin}`);
    process.exit(1);
  }
  return wiersz;
}

switch (polecenie) {
  case "lista": {
    const wiersze = rejestr
      .prepare(
        "SELECT id, login, strefa, aktywny, utworzono, ostatnie_uzycie_konektora FROM uzytkownicy ORDER BY id",
      )
      .all();
    if (wiersze.length === 0) {
      console.log("Rejestr jest pusty.");
      break;
    }
    for (const w of wiersze) {
      const stan = w.aktywny ? "aktywne " : "ZABLOKOWANE";
      const konektor = w.ostatnie_uzycie_konektora
        ? `konektor ${w.ostatnie_uzycie_konektora}`
        : "konektor nieużywany";
      console.log(`  ${w.id}. ${w.login}  ${stan}  ${w.strefa}  ${konektor}`);
    }
    break;
  }

  // Konto z pominięciem listy oczekujących: dla gospodarza, dla konta
  // poglądowego (npm run demo) i na wypadek, gdyby mail z zaproszeniem
  // uparcie nie docierał.
  case "utworz": {
    const haslo = reszta[0];
    if (!login || !haslo) {
      console.error("Użycie: npm run konta -- utworz <login> <haslo>");
      process.exit(1);
    }
    const wynik = utworzKonto(rejestr, { login, haslo, zgoda: true });
    console.log(`Konto ${login} utworzone (id ${wynik.id}).`);
    console.log("Token konektora — widoczny TYLKO teraz, zapisz go:");
    console.log(`  ${wynik.tokenKonektora}`);
    break;
  }

  case "haslo": {
    const konto = kontoAlboKoniec(login);
    const nowe = reszta[0];
    if (!nowe) {
      console.error("Podaj nowe hasło: npm run konta -- haslo <login> <nowe-haslo>");
      process.exit(1);
    }
    zmienHaslo(rejestr, konto.id, nowe);
    console.log(`Hasło konta ${konto.login} zmienione. Stare sesje wygasły.`);
    break;
  }

  case "zablokuj":
  case "odblokuj": {
    const konto = kontoAlboKoniec(login);
    const aktywny = polecenie === "odblokuj" ? 1 : 0;
    rejestr.prepare("UPDATE uzytkownicy SET aktywny = ? WHERE id = ?").run(aktywny, konto.id);
    console.log(
      aktywny
        ? `Konto ${konto.login} odblokowane.`
        : `Konto ${konto.login} zablokowane — logowanie i konektor przestały działać.`,
    );
    break;
  }

  case "usun": {
    const konto = kontoAlboKoniec(login);
    if (!process.argv.includes("--tak")) {
      console.log(
        `To usunie konto ${konto.login} RAZEM z całym dziennikiem, bez cofnięcia.\n` +
          `Jeśli na pewno: npm run konta -- usun ${konto.login} --tak`,
      );
      process.exit(1);
    }
    rejestr.prepare("DELETE FROM uzytkownicy WHERE id = ?").run(konto.id);
    for (const przyrostek of ["", "-wal", "-shm"]) {
      rmSync(join(KATALOG, "uzytkownicy", `${konto.id}.db${przyrostek}`), { force: true });
    }
    console.log(`Konto ${konto.login} i dziennik ${konto.id}.db usunięte.`);
    break;
  }

  default:
    console.error(
      "Polecenia: lista | utworz <login> <haslo> | haslo <login> <nowe> | " +
        "zablokuj <login> | odblokuj <login> | usun <login> --tak",
    );
    process.exit(1);
}

rejestr.close();
