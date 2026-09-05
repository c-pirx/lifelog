/**
 * Złożenie aplikacji z warstw. Wydzielone z `server.ts`, żeby testy mogły
 * postawić serwer bez wczytywania konfiguracji i otwierania plików baz.
 *
 * Od wielodostępu aplikacja nie dostaje jednej bazy, tylko dwa źródła:
 * rejestr (kto istnieje i jak się loguje) oraz pulę dzienników per użytkownik.
 * Którą bazą obsłużyć żądanie, rozstrzyga sesja (REST) albo token konektora
 * (MCP) — zawsze przed zbudowaniem czegokolwiek, co dotyka danych.
 */

import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { utworzRouterApi, type UslugaPoczty } from "./api/routes.js";
import type { ZrodlaDanych } from "./db/pula.js";
import type { Push } from "./lib/push.js";
import { dzisiaj } from "./lib/time.js";
import { utworzRouterMcp } from "./mcp/server.js";

export type { ZrodlaDanych } from "./db/pula.js";

/** Powłoka PWA. Pod „/" stoi strona powitalna, aplikacja mieszka pod /app. */
const PLIK_POWLOKI = "/aplikacja.html";

export type UstawieniaApp = {
  sekretSesji: string;
  /** Strefa domyślna: /zdrowie i konta zakładane bez podania strefy. */
  strefa: string;
  /** Katalog z plikami PWA. Pomiń w testach, żeby nie serwować statyków. */
  katalogStatykow?: string;
  /** Wyłączane przy pracy lokalnej po http. */
  ciasteczkoTylkoHttps?: boolean;
  /** Brak = aplikacja działa, maile nie wychodzą. Patrz `config.wczytajPoczte`. */
  poczta?: UslugaPoczty;
  /** Brak = aplikacja działa, powiadomienia nie wychodzą. Patrz `config.wczytajPush`. */
  push?: Push;
};

export function utworzApp(zrodla: ZrodlaDanych, ustawienia: UstawieniaApp) {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/zdrowie", (c) =>
    c.json({
      ok: true,
      dzisiaj: dzisiaj(ustawienia.strefa),
      strefa: ustawienia.strefa,
      // Jedyny sygnał, że wysyłka jest nieskonfigurowana — brak maila
      // sam z siebie nie rzuca się w oczy.
      poczta: ustawienia.poczta?.transport.wlaczona ?? false,
      // Tym bardziej przy powiadomieniach: nieprzysłane wygląda dokładnie
      // tak samo jak „dziś nie było o czym przypominać".
      push: ustawienia.push?.wlaczona ?? false,
    }),
  );

  app.route("/mcp", utworzRouterMcp(zrodla));

  app.route(
    "/api",
    utworzRouterApi(zrodla, {
      sekretSesji: ustawienia.sekretSesji,
      strefa: ustawienia.strefa,
      ciasteczkoTylkoHttps: ustawienia.ciasteczkoTylkoHttps,
      ...(ustawienia.poczta ? { poczta: ustawienia.poczta } : {}),
      ...(ustawienia.push ? { push: ustawienia.push } : {}),
    }),
  );

  // Musi być ostatnie — przechwytuje wszystko, co nie trafiło wyżej.
  if (ustawienia.katalogStatykow) {
    // Te same nagłówki, które na produkcji dokłada nginx. Bez jawnego
    // Cache-Control przeglądarka stosuje własną heurystykę i potrafi serwować
    // starą powłokę mimo zmienionego pliku — a service worker wciąga tę starą
    // kopię do swojego cache i utrwala ją na dobre, bo dopasowuje adresy
    // z pominięciem części zapytania. Efekt: „zmiany nie docierają",
    // identyczny jak na telefonie, tylko trudniejszy do zauważenia lokalnie.
    app.use("/*", async (c, nastepny) => {
      await nastepny();
      const sciezka = new URL(c.req.url).pathname;
      if (/\.(html|js|css|json|webmanifest)$/.test(sciezka) || sciezka === "/" || sciezka === "/app") {
        c.header("Cache-Control", "no-cache");
      }
    });

    // Powłoka aplikacji pod jednym adresem bez rozszerzenia — „/" należy
    // do strony powitalnej. Osobna trasa, a nie katalog `public/app/`:
    // wszystkie zasoby ładują się ścieżkami bezwzględnymi, więc jeden plik
    // wystarcza, a katalog kusiłby do rozjechania się z resztą statyków.
    app.get(
      "/app",
      serveStatic({ root: ustawienia.katalogStatykow, rewriteRequestPath: () => PLIK_POWLOKI }),
    );

    app.use("/*", serveStatic({ root: ustawienia.katalogStatykow }));
  }

  return app;
}
