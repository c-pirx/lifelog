/**
 * Punkt wejścia: jeden proces obsługujący trzy ścieżki.
 *
 *   /mcp    – serwer MCP dla konektora Claude   (Etap 2)
 *   /api/*  – REST dla aplikacji webowej        (Etap 3)
 *   /*      – pliki statyczne PWA               (Etap 3)
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { wczytajKonfiguracje, wczytajPlikEnv } from "./config.js";
import { otworzBaze } from "./db/index.js";
import { dzisiaj } from "./lib/time.js";

wczytajPlikEnv();

const konfiguracja = wczytajKonfiguracje();
const db = otworzBaze({ sciezka: konfiguracja.sciezkaBazy });

const app = new Hono();

app.get("/zdrowie", (c) =>
  c.json({
    ok: true,
    dzisiaj: dzisiaj(konfiguracja.strefa),
    strefa: konfiguracja.strefa,
    tabel: db
      .prepare<[], { ile: number }>(
        "SELECT COUNT(*) AS ile FROM sqlite_master WHERE type = 'table'",
      )
      .get()?.ile,
  }),
);

// Pliki statyczne PWA. Musi być ostatnie — przechwytuje wszystko, co zostało.
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: konfiguracja.port }, (info) => {
  console.log(`Asystent słucha na http://localhost:${info.port}`);
});

export { app, db };
