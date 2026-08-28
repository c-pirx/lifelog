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

import { utworzRouterApi } from "./api/routes.js";
import type { ZrodlaDanych } from "./db/pula.js";
import { dzisiaj } from "./lib/time.js";
import { utworzRouterMcp } from "./mcp/server.js";

export type { ZrodlaDanych } from "./db/pula.js";

export type UstawieniaApp = {
  /** Wspólne hasło bramy rejestracji (REJESTRACJA_HASLO). */
  rejestracjaHaslo: string;
  sekretSesji: string;
  /** Strefa domyślna: /zdrowie i konta zakładane bez podania strefy. */
  strefa: string;
  /** Katalog z plikami PWA. Pomiń w testach, żeby nie serwować statyków. */
  katalogStatykow?: string;
  /** Wyłączane przy pracy lokalnej po http. */
  ciasteczkoTylkoHttps?: boolean;
};

export function utworzApp(zrodla: ZrodlaDanych, ustawienia: UstawieniaApp) {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/zdrowie", (c) =>
    c.json({ ok: true, dzisiaj: dzisiaj(ustawienia.strefa), strefa: ustawienia.strefa }),
  );

  app.route("/mcp", utworzRouterMcp(zrodla));

  app.route(
    "/api",
    utworzRouterApi(zrodla, {
      rejestracjaHaslo: ustawienia.rejestracjaHaslo,
      sekretSesji: ustawienia.sekretSesji,
      strefa: ustawienia.strefa,
      ciasteczkoTylkoHttps: ustawienia.ciasteczkoTylkoHttps,
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
      if (/\.(html|js|css|json|webmanifest)$/.test(new URL(c.req.url).pathname) || c.req.path === "/") {
        c.header("Cache-Control", "no-cache");
      }
    });

    app.use("/*", serveStatic({ root: ustawienia.katalogStatykow }));
  }

  return app;
}
