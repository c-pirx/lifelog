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
  haslo: konfiguracja.hasloAplikacji,
  sekretSesji: konfiguracja.sekretSesji,
  strefa: konfiguracja.strefa,
  katalogStatykow: "./public",
  // Na produkcji HTTPS zapewnia reverse proxy; lokalnie pracujemy po http.
  ciasteczkoTylkoHttps: process.env["NODE_ENV"] === "production",
});

serve({ fetch: app.fetch, port: konfiguracja.port, hostname: konfiguracja.host }, (info) => {
  console.log(`Asystent słucha na ${konfiguracja.host}:${info.port}`);
});
