/**
 * Lokalny serwer MCP (stdio) — do uruchamiania bezpośrednio przez Claude.
 *
 * Drugie wejście obok serwera HTTP, sięgające do tej samej bazy i tej samej
 * warstwy domenowej. Różnica jest praktyczna: tutaj nic nie musi działać
 * w tle — Claude uruchamia ten proces sam, kiedy go potrzebuje, i zamyka
 * po zakończeniu.
 *
 * Serwer HTTP zostaje potrzebny dla aplikacji webowej. Oba procesy mogą
 * pracować równocześnie: baza działa w trybie WAL, który dopuszcza czytanie
 * w trakcie zapisu.
 *
 * Uruchomienie: node dist/mcp/stdio.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sprawdzWersjeNode } from "../config.js";
import { otworzBaze } from "../db/index.js";
import { zarejestrujNarzedzia } from "./tools.js";

/**
 * Katalog projektu szukany w górę od tego pliku. Claude uruchamia proces
 * z nieprzewidywalnym katalogiem roboczym, więc ścieżek względnych nie ma
 * co się trzymać.
 */
function korzenProjektu(): string {
  let katalog = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(katalog, "package.json"))) return katalog;
    const wyzej = dirname(katalog);
    if (wyzej === katalog) break;
    katalog = wyzej;
  }
  throw new Error("Nie znaleziono katalogu projektu");
}

const KORZEN = korzenProjektu();

// Zapamiętane przed wczytaniem .env: zmienne podane wprost przy uruchomieniu
// mają pierwszeństwo nad plikiem. Dzięki temu testy mogą wskazać własną bazę.
const dbZWywolania = process.env["DB_PATH"];
const strefaZWywolania = process.env["TZ_APP"];

// Sprawdzamy przed wczytaniem .env. Na starym Node `loadEnvFile` nie istnieje,
// wyjątek wpadłby w `catch` poniżej i proces po cichu wziąłby domyślną ścieżkę
// bazy — czyli Claude pisałby do INNEJ bazy niż aplikacja webowa, gdyby DB_PATH
// w .env wskazywał gdzie indziej. Lepiej przerwać z komunikatem.
sprawdzWersjeNode();

// Wczytujemy .env z katalogu projektu, a nie z katalogu roboczego procesu.
try {
  process.loadEnvFile(join(KORZEN, ".env"));
} catch {
  // Brak .env jest dopuszczalny — zadziałają wartości domyślne.
}

const sciezkaZEnv = dbZWywolania ?? process.env["DB_PATH"] ?? "./dane/asystent.db";
const sciezkaBazy = isAbsolute(sciezkaZEnv) ? sciezkaZEnv : resolve(KORZEN, sciezkaZEnv);
const strefa = strefaZWywolania ?? process.env["TZ_APP"] ?? "Europe/Warsaw";

const db = otworzBaze({ sciezka: sciezkaBazy });

const server = new McpServer({ name: "asystent-diety-treningu", version: "0.1.0" });
zarejestrujNarzedzia(server, db, strefa);

// Diagnostyka wyłącznie na stderr — stdout należy do protokołu MCP.
process.stderr.write(`[asystent] baza: ${sciezkaBazy}\n`);

await server.connect(new StdioServerTransport());

const zamknij = () => {
  db.close();
  process.exit(0);
};

process.on("SIGINT", zamknij);
process.on("SIGTERM", zamknij);
