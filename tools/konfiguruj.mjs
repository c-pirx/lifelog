/**
 * Pierwsza konfiguracja projektu: tworzy plik .env z wygenerowanymi sekretami.
 * Uruchomienie: npm run setup
 *
 * Istnieje po to, żeby ktoś, kto właśnie sklonował repozytorium, nie musiał
 * ręcznie wymyślać, co wpisać w .env — i żeby nie wpisał tam czegoś słabego.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLIK = join(KORZEN, ".env");

// Wersję czytamy z `engines` w package.json, żeby próg był zapisany w jednym
// miejscu. Sprawdzamy WSZYSTKIE trzy człony, nie samą główną: aplikacja używa
// `process.loadEnvFile()`, dostępnego dopiero od 20.12. Wcześniejsza wersja
// tego skryptu porównywała tylko „20" i przepuszczała Node 20.5, po którym
// serwer twierdził, że brakuje zmiennych środowiskowych — mimo poprawnego .env.
const WYMAGANA = JSON.parse(readFileSync(join(KORZEN, "package.json"), "utf8")).engines.node.replace(
  /^[^\d]*/,
  "",
);

function starszaNiz(mamy, wymagana) {
  const a = mamy.split(".").map(Number);
  const b = wymagana.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

if (starszaNiz(process.versions.node, WYMAGANA)) {
  console.error(`Potrzebny Node.js ${WYMAGANA} lub nowszy (masz ${process.versions.node}).`);
  console.error("Aktualizacja: https://nodejs.org — weź wersję LTS.");
  process.exit(1);
}

if (existsSync(PLIK)) {
  console.log(
    "Plik .env już istnieje — nie ruszam go.\n" +
      "Jeśli chcesz zacząć od nowa, usuń go najpierw i uruchom ponownie.",
  );
  process.exit(0);
}

const sekret = () => randomBytes(32).toString("hex");

const tresc = `# Konfiguracja lokalna. Ten plik jest w .gitignore i nigdy nie trafia do repozytorium.
# Wygenerowano: ${new Date().toISOString()}

PORT=3000
# Puste = nasłuch na wszystkich interfejsach (wygodne lokalnie).
# Na serwerze ustaw 127.0.0.1 — do internetu wystawia wtedy dopiero reverse proxy.
HOST=

# Katalog danych: rejestr.db i podkatalog uzytkownicy/ z dziennikami.
DANE_KATALOG=./dane
TZ_APP=Europe/Warsaw

# Klucz do podpisywania ciasteczka sesji. Podpisuje też linki „wypisz mnie"
# ze stopki maili — jego wymiana wylogowuje wszystkich i unieważnia te linki.
SESSION_SECRET=${sekret()}

# Poczta wychodząca (Resend). Komplet czterech albo żadnej: bez nich aplikacja
# działa, zapisy na listę oczekujących też, tylko maile nie wychodzą.
RESEND_API_KEY=
MAIL_OD=Lifelog <powitanie@twojadomena.pl>
MAIL_GOSPODARZ=
PUBLICZNY_ADRES=http://localhost:3000

# Powiadomienia push. Ta sama zasada: komplet trzech albo żadnej.
# Klucze generuje \`npx web-push generate-vapid-keys\` — RAZ, bo ich wymiana
# unieważnia wszystkie subskrypcje.
VAPID_PUBLICZNY=
VAPID_PRYWATNY=
VAPID_KONTAKT=mailto:ty@twojadomena.pl
`;

writeFileSync(PLIK, tresc, "utf8");

console.log(`Utworzono ${PLIK}\n`);
console.log("Rejestracja jest zamknięta — konta powstają z zaproszeń z listy oczekujących.");
console.log("Pierwsze konto dla siebie załóż poleceniem:");
console.log("  npm run build && npm run konta -- utworz <login> <haslo>\n");
console.log("Dalej:");
console.log("  npm run dev     — uruchom serwer, potem otwórz http://localhost:3000");
console.log("  npm run demo    — dane poglądowe (opcjonalnie, przy działającym serwerze)");
