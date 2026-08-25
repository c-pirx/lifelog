/**
 * Dopisuje serwer MCP do konfiguracji Claude Desktop.
 * Uruchomienie: `npm run podlacz`
 *
 * Po co osobny skrypt: Claude Desktop potrafi nadpisać
 * claude_desktop_config.json przy zamykaniu, kasując wpisy dodane w czasie
 * działania aplikacji. Dlatego skrypt odmawia pracy przy uruchomionym
 * Claude Desktop — wpis dodany przy zamkniętej aplikacji jest trwały.
 *
 * Wskazujemy node.exe i plik mostu wprost, zamiast `npx`: Claude Desktop
 * uruchamia komendę bez powłoki, więc `npx` na Windowsie bywa nieznajdowany.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NAZWA_WPISU = "asystent-diety";
const KORZEN = resolve(import.meta.dirname, "..");

const sciezkaKonfiguracji =
  process.platform === "win32"
    ? join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json")
    : join(process.env.HOME ?? "", "Library", "Application Support", "Claude", "claude_desktop_config.json");

function czyClaudeDesktopDziala() {
  if (process.platform !== "win32") return false;
  try {
    const wynik = execSync('tasklist /FI "IMAGENAME eq Claude.exe" /NH', { encoding: "utf8" });
    return wynik.toLowerCase().includes("claude.exe");
  } catch {
    return false;
  }
}

function odczytajToken() {
  const plik = join(KORZEN, ".env");
  if (!existsSync(plik)) throw new Error("Brak pliku .env — skopiuj .env.example i uzupełnij MCP_TOKEN");

  const token = readFileSync(plik, "utf8")
    .split("\n")
    .find((linia) => linia.startsWith("MCP_TOKEN="))
    ?.slice("MCP_TOKEN=".length)
    .trim();

  if (!token) throw new Error("MCP_TOKEN jest pusty w pliku .env");
  return token;
}

if (!existsSync(sciezkaKonfiguracji)) {
  console.error(`Nie znaleziono konfiguracji Claude Desktop: ${sciezkaKonfiguracji}`);
  process.exit(1);
}

if (czyClaudeDesktopDziala() && !process.argv.includes("--mimo-wszystko")) {
  console.error(
    "Claude Desktop jest uruchomiony — wpis dodany teraz może zostać nadpisany przy zamykaniu.\n" +
      "Zamknij aplikację i uruchom ponownie ten skrypt.\n" +
      "Jeśli wiesz, co robisz: npm run podlacz -- --mimo-wszystko",
  );
  process.exit(1);
}

const port = process.env.PORT ?? "3000";
const konfiguracja = JSON.parse(readFileSync(sciezkaKonfiguracji, "utf8"));
konfiguracja.mcpServers ??= {};

konfiguracja.mcpServers[NAZWA_WPISU] = {
  command: process.execPath,
  args: [
    join(KORZEN, "node_modules", "mcp-remote", "dist", "proxy.js"),
    `http://localhost:${port}/mcp/${odczytajToken()}`,
  ],
};

copyFileSync(sciezkaKonfiguracji, `${sciezkaKonfiguracji}.kopia`);
writeFileSync(sciezkaKonfiguracji, `${JSON.stringify(konfiguracja, null, 2)}\n`, "utf8");

console.log(`Dodano wpis „${NAZWA_WPISU}" do ${sciezkaKonfiguracji}`);
console.log(`Kopia poprzedniej wersji: ${sciezkaKonfiguracji}.kopia`);
console.log("Uruchom Claude Desktop. Serwer musi działać (npm run dev).");
