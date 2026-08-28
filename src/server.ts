/**
 * Punkt wejścia procesu: konfiguracja, bazy, nasłuchiwanie.
 * Samo złożenie tras żyje w `app.ts`.
 *
 * Układ danych: `<katalogDanych>/rejestr.db` (konta) oraz
 * `<katalogDanych>/uzytkownicy/<id>.db` (dziennik na osobę).
 */

import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { utworzApp } from "./app.js";
import { wczytajKonfiguracje, wczytajPlikEnv } from "./config.js";
import { katalogMigracjiRejestru, otworzBaze } from "./db/index.js";
import { utworzPule, zmigrujWszystkie } from "./db/pula.js";
import { uruchomHarmonogram } from "./harmonogram.js";
import { pocztaResend } from "./lib/poczta.js";

wczytajPlikEnv();

const konfiguracja = wczytajKonfiguracje();

// Zapora na czas przejścia na wielodostęp: stara baza jednoosobowa obok
// pustego rejestru oznacza dane, których nikt już by nie czytał. Lepiej nie
// wystartować z czytelnym komunikatem, niż udawać świeżą instalację —
// systemd restartowałby proces w pętli, a użytkownik widziałby pustą apkę.
const staraBaza = join(konfiguracja.katalogDanych, "asystent.db");
const rejestrIstnieje = existsSync(join(konfiguracja.katalogDanych, "rejestr.db"));
if (existsSync(staraBaza) && !rejestrIstnieje) {
  console.error(
    `Znaleziono bazę jednoosobową (${staraBaza}), a rejestru użytkowników jeszcze nie ma.\n` +
      "Uruchom raz: npm run przenies — przeniesie dane na układ wielodostępowy.",
  );
  process.exit(1);
}

const rejestr = otworzBaze({
  sciezka: join(konfiguracja.katalogDanych, "rejestr.db"),
  katalogMigracji: katalogMigracjiRejestru(),
});

// Wdrożenie ma zmigrować wszystkie dzienniki od razu, nie przy pierwszym
// odwiedzeniu konta. Błąd przerywa start — lepiej brak usługi z czytelnym
// wpisem w dzienniku niż połowa baz w nowym schemacie i połowa w starym.
const katalogUzytkownikow = join(konfiguracja.katalogDanych, "uzytkownicy");
const migracja = zmigrujWszystkie(katalogUzytkownikow);
console.log(`Dzienniki: baz ${migracja.baz}, zastosowanych migracji ${migracja.zastosowanych}`);

const pula = utworzPule({ katalog: katalogUzytkownikow });
const zrodla = { rejestr, pula };

// Brak kompletu zmiennych poczty nie zatrzymuje startu — zapisy na listę mają
// działać nawet wtedy, gdy maile nie wychodzą. Żeby cisza nie była niema,
// mówimy o tym w dzienniku, a /zdrowie niesie `poczta: false`.
if (!konfiguracja.poczta) {
  console.warn(
    "Poczta wyłączona — brak kompletu RESEND_API_KEY, MAIL_OD, MAIL_GOSPODARZ, PUBLICZNY_ADRES.\n" +
      "Zapisy na listę oczekujących działają, ale maile powitalne i powiadomienia nie wyjdą.",
  );
}

const app = utworzApp(zrodla, {
  sekretSesji: konfiguracja.sekretSesji,
  strefa: konfiguracja.strefa,
  katalogStatykow: "./public",
  // Na produkcji HTTPS zapewnia reverse proxy; lokalnie pracujemy po http.
  ciasteczkoTylkoHttps: process.env["NODE_ENV"] === "production",
  ...(konfiguracja.poczta
    ? {
        poczta: {
          transport: pocztaResend({
            klucz: konfiguracja.poczta.klucz,
            nadawca: konfiguracja.poczta.nadawca,
          }),
          adresPubliczny: konfiguracja.poczta.adresPubliczny,
          gospodarz: konfiguracja.poczta.gospodarz,
        },
      }
    : {}),
});

// Wołane tylko tutaj, nigdy z utworzApp() — inaczej każdy test stawiający
// aplikację zostawiałby po sobie działający timer.
uruchomHarmonogram(zrodla);

serve({ fetch: app.fetch, port: konfiguracja.port, hostname: konfiguracja.host }, (info) => {
  console.log(`Asystent słucha na ${konfiguracja.host}:${info.port}`);
});
