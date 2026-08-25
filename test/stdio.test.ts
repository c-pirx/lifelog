/**
 * Test lokalnego serwera MCP (stdio) — tego, który Claude uruchamia sam.
 *
 * Uruchamiamy prawdziwy proces potomny na osobnej bazie i rozmawiamy z nim
 * klientem SDK, dokładnie tak jak robi to Claude Desktop i Claude Code.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ścieżki liczymy względem tego pliku i przez mechanizm rozwiązywania Node,
// a nie względem katalogu roboczego. W git worktree (i przy hoistowanych
// zależnościach) katalog node_modules leży piętro wyżej, więc dosłowne
// "node_modules/tsx/dist/cli.mjs" nie istnieje — proces potomny wstawał
// wtedy martwy, a test padał na mylącym „Connection closed".
const TSX = fileURLToPath(import.meta.resolve("tsx/cli"));
const SERWER_STDIO = fileURLToPath(new URL("../src/mcp/stdio.ts", import.meta.url));

let katalogTymczasowy: string;
let klient: Client;

async function wywolaj(nazwa: string, argumenty: Record<string, unknown> = {}): Promise<string> {
  const wynik = await klient.callTool({ name: nazwa, arguments: argumenty });
  return ((wynik as { content?: { text?: string }[] }).content ?? [])
    .map((c) => c.text ?? "")
    .join("\n");
}

beforeAll(async () => {
  katalogTymczasowy = mkdtempSync(join(tmpdir(), "asystent-stdio-"));

  klient = new Client({ name: "test", version: "1.0.0" });
  await klient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [TSX, SERWER_STDIO],
      env: {
        ...process.env,
        DB_PATH: join(katalogTymczasowy, "test.db"),
        TZ_APP: "Europe/Warsaw",
      },
      // Obcy katalog roboczy: Claude uruchamia proces skądkolwiek.
      cwd: tmpdir(),
      stderr: "pipe",
    }),
  );
}, 60_000);

afterAll(async () => {
  await klient?.close();
  rmSync(katalogTymczasowy, { recursive: true, force: true });
});

describe("lokalny serwer stdio", () => {
  it("startuje bez serwera HTTP i wystawia komplet narzędzi", async () => {
    const { tools } = await klient.listTools();
    expect(tools).toHaveLength(11);
  });

  it("zakłada bazę od zera i zapisuje do niej", async () => {
    await wywolaj("ustaw_cele", {
      kcal: 2400,
      bialko_g: 180,
      wegle_g: 250,
      tluszcz_g: 80,
      obowiazuje_od: "2026-08-01",
    });

    const zapis = await wywolaj("zapisz_posilek", {
      opis: "owsianka",
      kcal: 400,
      bialko_g: 15,
      czas: "2026-08-25 09:00",
      pewnosc: "dokladne",
    });

    expect(zapis).toMatch(/Zapisano/);
    expect(await wywolaj("podsumowanie_dnia", { data: "2026-08-25" })).toMatch(/owsianka/);
  });

  it("przyjmuje czas polski mimo obcego katalogu roboczego", async () => {
    await wywolaj("zapisz_posilek", {
      opis: "późna kolacja",
      kcal: 500,
      czas: "2026-08-26 23:30",
    });

    // 23:30 czasu polskiego to 21:30 UTC — doba nie może się przesunąć.
    expect(await wywolaj("podsumowanie_dnia", { data: "2026-08-26" })).toMatch(/późna kolacja/);
  });

  it("zgłasza błędy domenowe jako komunikat, nie jako awarię", async () => {
    const wynik = await klient.callTool({
      name: "zapisz_serie",
      arguments: { cwiczenie: "przysiad", powtorzenia: 5 },
    });

    expect(wynik.isError).toBe(true);
  });
});
