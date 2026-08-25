/**
 * Pierwsza konfiguracja projektu: tworzy plik .env z wygenerowanymi sekretami.
 * Uruchomienie: npm run setup
 *
 * Istnieje po to, żeby ktoś, kto właśnie sklonował repozytorium, nie musiał
 * ręcznie wymyślać, co wpisać w .env — i żeby nie wpisał tam czegoś słabego.
 */

import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLIK = join(KORZEN, ".env");

if (existsSync(PLIK)) {
  console.log(
    "Plik .env już istnieje — nie ruszam go.\n" +
      "Jeśli chcesz zacząć od nowa, usuń go najpierw i uruchom ponownie.",
  );
  process.exit(0);
}

const [wersjaGlowna] = process.versions.node.split(".").map(Number);
if (wersjaGlowna < 20) {
  console.error(`Potrzebny Node.js 20 lub nowszy (masz ${process.versions.node}).`);
  process.exit(1);
}

const sekret = () => randomBytes(32).toString("hex");

// Hasło do aplikacji webowej: krótsze niż token, bo wpisujesz je z klawiatury
// telefonu, ale wciąż ponad 100 bitów entropii.
const haslo = randomBytes(15).toString("base64url");

const tresc = `# Konfiguracja lokalna. Ten plik jest w .gitignore i nigdy nie trafia do repozytorium.
# Wygenerowano: ${new Date().toISOString()}

PORT=3000
# Puste = nasłuch na wszystkich interfejsach (wygodne lokalnie).
# Na serwerze ustaw 127.0.0.1 — do internetu wystawia wtedy dopiero reverse proxy.
HOST=

DB_PATH=./dane/asystent.db
TZ_APP=Europe/Warsaw

# Token konektora MCP. Jest częścią adresu URL serwera.
MCP_TOKEN=${sekret()}

# Hasło do aplikacji webowej.
APP_PASSWORD=${haslo}

# Klucz do podpisywania ciasteczka sesji.
SESSION_SECRET=${sekret()}
`;

writeFileSync(PLIK, tresc, "utf8");

console.log(`Utworzono ${PLIK}\n`);
console.log("Hasło do aplikacji webowej:");
console.log(`  ${haslo}\n`);
console.log("Zapisz je — drugi raz nie zostanie pokazane (choć zawsze możesz zajrzeć do .env).\n");
console.log("Dalej:");
console.log("  npm run dev     — uruchom serwer");
console.log("  npm run demo    — wypełnij bazę danymi poglądowymi (opcjonalnie)");
