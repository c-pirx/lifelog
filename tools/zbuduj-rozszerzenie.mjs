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

if (!existsSync(join(KORZEN, "dist", "mcp", "stdio.js"))) {
  throw new Error("Brak dist/mcp/stdio.js — zbuduj projekt: npm run build");
}

const manifest = {
  manifest_version: "0.3",
  name: "asystent-diety-treningu",
  display_name: "Asystent diety i treningu",
  version: JSON.parse(readFileSync(join(KORZEN, "package.json"), "utf8")).version,
  description: "Dziennik posiłków i treningów — zapis i podsumowania z rozmowy.",
  long_description:
    "Zapisuje posiłki z makroskładnikami, prowadzi przez trening według stałego planu " +
    "i pilnuje realizacji celów. Działa lokalnie — dane nie opuszczają tego komputera " +
    "i nic nie musi działać w tle: Claude uruchamia serwer wtedy, kiedy go potrzebuje.",
  author: { name: "Projekt osobisty" },
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: { KATALOG_PROJEKTU: "${user_config.katalog_projektu}" },
    },
  },
  user_config: {
    katalog_projektu: {
      type: "directory",
      title: "Katalog projektu",
      description:
        "Katalog z zbudowanym projektem (musi zawierać dist/mcp/stdio.js po npm run build).",
      required: true,
      multiple: false,
      default: [KORZEN],
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
console.log("\nSerwer nie musi działać w tle — Claude uruchamia go sam, gdy jest potrzebny.");
