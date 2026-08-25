/**
 * Buduje paczkę rozszerzenia .mcpb do instalacji w Claude Desktop przez
 * Ustawienia → Extensions, zamiast ręcznego grzebania w pliku konfiguracyjnym
 * (który Claude Desktop i tak nadpisuje).
 *
 * Uruchomienie: `npm run rozszerzenie`
 *
 * Manifest powstaje tutaj, a nie leży w repozytorium, bo zawiera adres serwera
 * razem z tokenem. Gotowa paczka też jest poza repozytorium — traktuj ją jak
 * hasło i nikomu jej nie wysyłaj.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const KORZEN = resolve(import.meta.dirname, "..");
const ZRODLO = join(KORZEN, "rozszerzenie");
const BUDOWA = join(KORZEN, "dist-rozszerzenie");

function odczytajToken() {
  const plik = join(KORZEN, ".env");
  if (!existsSync(plik)) throw new Error("Brak pliku .env — skopiuj .env.example i uzupełnij");

  const token = readFileSync(plik, "utf8")
    .split("\n")
    .find((linia) => linia.startsWith("MCP_TOKEN="))
    ?.slice("MCP_TOKEN=".length)
    .trim();

  if (!token) throw new Error("MCP_TOKEN jest pusty w pliku .env");
  return token;
}

const port = process.env.PORT ?? "3000";
const adres = `http://localhost:${port}/mcp/${odczytajToken()}`;

const manifest = {
  manifest_version: "0.3",
  name: "asystent-diety-treningu",
  display_name: "Asystent diety i treningu",
  version: JSON.parse(readFileSync(join(KORZEN, "package.json"), "utf8")).version,
  description: "Dziennik posiłków i treningów — zapis i podsumowania z rozmowy.",
  long_description:
    "Zapisuje posiłki z makroskładnikami, prowadzi przez trening według stałego planu " +
    "i pilnuje realizacji celów. Łączy się z serwerem działającym na tym komputerze, " +
    "więc dane nie opuszczają Twojej maszyny.",
  author: { name: "Projekt osobisty" },
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: { MCP_URL: "${user_config.adres_serwera}" },
    },
  },
  user_config: {
    adres_serwera: {
      type: "string",
      title: "Adres serwera",
      description:
        "Pełny adres serwera MCP wraz z tokenem. Serwer musi działać (npm run dev).",
      required: true,
      default: adres,
    },
  },
  compatibility: { runtimes: { node: ">=20.0.0" } },
};

rmSync(BUDOWA, { recursive: true, force: true });
mkdirSync(join(BUDOWA, "server"), { recursive: true });

writeFileSync(join(BUDOWA, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
copyFileSync(join(ZRODLO, "server", "index.js"), join(BUDOWA, "server", "index.js"));
copyFileSync(join(KORZEN, "public", "icons", "ikona-192.png"), join(BUDOWA, "icon.png"));

execFileSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", BUDOWA, join(KORZEN, "asystent.mcpb")], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

console.log("\nGotowe: asystent.mcpb");
console.log("Instalacja: Claude Desktop → Ustawienia → Extensions → Advanced settings");
console.log("            → Extension Developer → Install Extension… → wskaż ten plik");
console.log("\nUWAGA: paczka zawiera token dostępu do Twoich danych. Nie udostępniaj jej.");
