/**
 * Złożenie aplikacji z warstw. Wydzielone z `server.ts`, żeby testy mogły
 * postawić serwer bez wczytywania konfiguracji i otwierania pliku bazy.
 */

import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { utworzRouterApi } from "./api/routes.js";
import type { Baza } from "./db/index.js";
import { dzisiaj } from "./lib/time.js";
import { utworzRouterMcp } from "./mcp/server.js";

export type UstawieniaApp = {
  mcpToken: string;
  haslo: string;
  sekretSesji: string;
  strefa: string;
  /** Katalog z plikami PWA. Pomiń w testach, żeby nie serwować statyków. */
  katalogStatykow?: string;
  /** Wyłączane przy pracy lokalnej po http. */
  ciasteczkoTylkoHttps?: boolean;
};

export function utworzApp(db: Baza, ustawienia: UstawieniaApp) {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/zdrowie", (c) =>
    c.json({ ok: true, dzisiaj: dzisiaj(ustawienia.strefa), strefa: ustawienia.strefa }),
  );

  app.route("/mcp", utworzRouterMcp(db, ustawienia.mcpToken, ustawienia.strefa));

  app.route(
    "/api",
    utworzRouterApi(db, {
      haslo: ustawienia.haslo,
      sekretSesji: ustawienia.sekretSesji,
      strefa: ustawienia.strefa,
      ciasteczkoTylkoHttps: ustawienia.ciasteczkoTylkoHttps,
    }),
  );

  // Musi być ostatnie — przechwytuje wszystko, co nie trafiło wyżej.
  if (ustawienia.katalogStatykow) {
    app.use("/*", serveStatic({ root: ustawienia.katalogStatykow }));
  }

  return app;
}
