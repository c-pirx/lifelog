#!/usr/bin/env node
/**
 * Punkt wejścia rozszerzenia dla Claude Desktop.
 *
 * Paczka .mcpb nie zawiera samego serwera — ten żyje w katalogu projektu,
 * razem z bazą i natywnym modułem SQLite, którego nie da się sensownie
 * spakować. Ten plik tylko uruchamia zbudowany serwer stdio z projektu.
 *
 * Ścieżkę podaje Claude Desktop w zmiennej KATALOG_PROJEKTU, wypełnianej
 * z pola konfiguracyjnego rozszerzenia — dzięki temu po przeniesieniu
 * projektu wystarczy poprawić ją w interfejsie, bez przebudowy paczki.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const log = (...czesci) => process.stderr.write(`[rozszerzenie] ${czesci.join(" ")}\n`);

const katalog = process.env.KATALOG_PROJEKTU;

if (!katalog) {
  log("Brak ścieżki do projektu. Uzupełnij pole „Katalog projektu” w ustawieniach rozszerzenia.");
  process.exit(1);
}

const serwer = join(katalog, "dist", "mcp", "stdio.js");

if (!existsSync(serwer)) {
  log(`Nie znaleziono ${serwer}.`);
  log("Zbuduj projekt: npm run build");
  process.exit(1);
}

await import(pathToFileURL(serwer).href);
