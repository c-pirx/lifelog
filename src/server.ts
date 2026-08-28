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
import { utworzPule } from "./db/pula.js";
import { uruchomHarmonogram } from "./harmonogram.js";

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
const pula = utworzPule({ katalog: join(konfiguracja.katalogDanych, "uzytkownicy") });
const zrodla = { rejestr, pula };

const app = utworzApp(zrodla, {
  rejestracjaHaslo: konfiguracja.rejestracjaHaslo,
  sekretSesji: konfiguracja.sekretSesji,
  strefa: konfiguracja.strefa,
  katalogStatykow: "./public",
  // Na produkcji HTTPS zapewnia reverse proxy; lokalnie pracujemy po http.
  ciasteczkoTylkoHttps: process.env["NODE_ENV"] === "production",
});

// Wołane tylko tutaj, nigdy z utworzApp() — inaczej każdy test stawiający
// aplikację zostawiałby po sobie działający timer.
uruchomHarmonogram(zrodla);

serve({ fetch: app.fetch, port: konfiguracja.port, hostname: konfiguracja.host }, (info) => {
  console.log(`Asystent słucha na ${konfiguracja.host}:${info.port}`);
});
