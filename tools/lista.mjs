/**
 * Lista oczekujących z wiersza poleceń — przez ssh, bez panelu w aplikacji.
 * Ta sama zasada co przy `konta.mjs`: zero nowych tras HTTP to zero nowej
 * powierzchni ataku, a zapraszanie robi się raz na jakiś czas.
 *
 *   npm run lista                                  # wszyscy zapisani
 *   npm run lista -- zapros <email>                # kod + mail z linkiem
 *   npm run lista -- zapros <email> --bez-maila    # sam link, do skopiowania
 *   npm run lista -- usun <email>                  # kasuje wpis
 *
 * Wymaga `npm run build` — kody hasuje ten sam kod, który je sprawdza.
 */

import { existsSync } from "node:fs";
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
  console.error(`Nie ma rejestru (${REJESTR}). Świeża instalacja nie ma jeszcze listy.`);
  process.exit(1);
}

const DIST = join(KORZEN, "dist");
if (!existsSync(join(DIST, "domain", "lista.js"))) {
  console.error("Brak zbudowanego kodu. Uruchom najpierw: npm run build");
  process.exit(1);
}

const { otworzBaze, katalogMigracjiRejestru } = await import(
  pathToFileURL(join(DIST, "db", "index.js"))
);
const { tokenWypisu, usunZListy, wpisyListy, zapros, WAZNOSC_ZAPROSZENIA_DNI } = await import(
  pathToFileURL(join(DIST, "domain", "lista.js"))
);
const { wiadomoscZaproszenie } = await import(
  pathToFileURL(join(DIST, "domain", "wiadomosci.js"))
);
const { pocztaResend } = await import(pathToFileURL(join(DIST, "lib", "poczta.js")));

const rejestr = otworzBaze({ sciezka: REJESTR, katalogMigracji: katalogMigracjiRejestru() });

const [polecenie = "lista", email, ...reszta] = process.argv.slice(2);

const ADRES_PUBLICZNY = (process.env.PUBLICZNY_ADRES ?? "").replace(/\/+$/, "");

function zakonczBledem(tekst) {
  console.error(tekst);
  rejestr.close();
  process.exit(1);
}

switch (polecenie) {
  case "lista": {
    const wpisy = wpisyListy(rejestr);
    if (wpisy.length === 0) {
      console.log("Lista oczekujących jest pusta.");
      break;
    }
    for (const w of wpisy) {
      const kiedy = w.zapisano.slice(0, 10);
      const imie = w.imie ? ` (${w.imie})` : "";
      console.log(`  ${kiedy}  ${w.stan.padEnd(14)} ${w.email}${imie}`);
    }
    console.log(`\nRazem: ${wpisy.length}`);
    break;
  }

  case "zapros": {
    if (!email) zakonczBledem("Użycie: npm run lista -- zapros <email>");
    if (!ADRES_PUBLICZNY) {
      zakonczBledem("Brak PUBLICZNY_ADRES — bez niego nie da się zbudować linku zaproszenia.");
    }

    let zaproszenie;
    try {
      zaproszenie = zapros(rejestr, email);
    } catch (blad) {
      zakonczBledem(blad.message);
    }

    // Jawny kod widać wyłącznie tutaj — w rejestrze leży sam hasz.
    const link = `${ADRES_PUBLICZNY}/app?kod=${encodeURIComponent(zaproszenie.kod)}`;
    console.log(`Kod dla ${zaproszenie.wpis.email} (ważny ${WAZNOSC_ZAPROSZENIA_DNI} dni):`);
    console.log(`  ${link}`);

    const bezMaila = reszta.includes("--bez-maila");
    const klucz = process.env.RESEND_API_KEY;
    const nadawca = process.env.MAIL_OD;

    if (bezMaila) {
      console.log("\n(--bez-maila) Wyślij ten link samodzielnie.");
      break;
    }
    if (!klucz || !nadawca) {
      console.log("\nPoczta nieskonfigurowana (RESEND_API_KEY, MAIL_OD) — wyślij link ręcznie.");
      break;
    }

    const poczta = pocztaResend({ klucz, nadawca });
    await poczta.wyslij(
      wiadomoscZaproszenie({
        email: zaproszenie.wpis.email,
        imie: zaproszenie.wpis.imie,
        kod: zaproszenie.kod,
        waznoscDni: WAZNOSC_ZAPROSZENIA_DNI,
        tokenWypisu: tokenWypisu(zaproszenie.wpis.email, process.env.SESSION_SECRET ?? ""),
        adresy: { publiczny: ADRES_PUBLICZNY },
        // Zgłoszenia idą tam, gdzie powiadomienia o zapisach — do gospodarza.
        kontakt: process.env.MAIL_GOSPODARZ?.trim() || null,
      }),
    );
    console.log(`\nZaproszenie wysłane na ${zaproszenie.wpis.email}.`);
    break;
  }

  case "usun": {
    if (!email) zakonczBledem("Użycie: npm run lista -- usun <email>");
    console.log(usunZListy(rejestr, email) ? `Usunięto ${email}.` : `Nie ma na liście: ${email}.`);
    break;
  }

  default:
    zakonczBledem("Polecenia: lista | zapros <email> [--bez-maila] | usun <email>");
}

rejestr.close();
