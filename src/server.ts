/**
 * Punkt wejścia procesu: konfiguracja, baza, nasłuchiwanie.
 * Samo złożenie tras żyje w `app.ts`.
 */

import { serve } from "@hono/node-server";

import { utworzApp } from "./app.js";
import { wczytajKonfiguracje, wczytajPlikEnv } from "./config.js";
import { otworzBaze } from "./db/index.js";

wczytajPlikEnv();

const konfiguracja = wczytajKonfiguracje();
const db = otworzBaze({ sciezka: konfiguracja.sciezkaBazy });

const app = utworzApp(db, {
  mcpToken: konfiguracja.mcpToken,
  strefa: konfiguracja.strefa,
  katalogStatykow: "./public",
});

serve({ fetch: app.fetch, port: konfiguracja.port }, (info) => {
  console.log(`Asystent słucha na http://localhost:${info.port}`);
  console.log(`Adres konektora MCP: http://localhost:${info.port}/mcp/<MCP_TOKEN>`);
});
