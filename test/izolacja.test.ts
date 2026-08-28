/**
 * Dowód izolacji między użytkownikami — najważniejszy test wielodostępu.
 *
 * Dwoje użytkowników na jednej instancji: zapis u Ani nie może być widoczny,
 * odczytywalny ani poprawialny z konta Tomka — ani przez REST (ciasteczko),
 * ani przez MCP (token konektora). Izolacja jest strukturalna: dziennik
 * wybiera się PRZED zbudowaniem narzędzi i trasy nie mają uchwytu cudzej
 * bazy. Ten plik pilnuje, żeby tak zostało.
 */

import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { utworzApp } from "../src/app.js";
import { otworzBaze } from "../src/db/index.js";
import { utworzPule, type PulaBaz } from "../src/db/pula.js";
import { zapiszNaListe, zapros } from "../src/domain/lista.js";
import type { PodsumowanieDnia } from "../src/domain/typy.js";

const MIGRACJE_REJESTRU = fileURLToPath(new URL("../migrations-rejestr/", import.meta.url));

let rejestr: ReturnType<typeof otworzBaze>;
let katalogPuli: string;
let pula: PulaBaz;
let serwer: ReturnType<typeof serve>;
let adres: string;

type Osoba = { ciasteczko: string; token: string };
let ania: Osoba;
let tomek: Osoba;
let idPosilkuAni = 0;

/** Pełna droga do konta: zapis na listę, zaproszenie, rejestracja z kodu. */
async function zaloz(login: string): Promise<Osoba> {
  const email = `${login}@przyklad.pl`;
  zapiszNaListe(rejestr, { email, zgoda: true });
  const { kod } = zapros(rejestr, email);

  const odpowiedz = await fetch(`${adres}/api/rejestracja`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kod, login, haslo: `haslo-${login}-123`, zgoda: true }),
  });
  const { token_konektora } = (await odpowiedz.json()) as { token_konektora: string };
  return {
    ciasteczko: (odpowiedz.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    token: token_konektora,
  };
}

async function rest(osoba: Osoba, sciezka: string, dane?: unknown): Promise<Response> {
  return fetch(`${adres}${sciezka}`, {
    method: dane === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: osoba.ciasteczko },
    ...(dane === undefined ? {} : { body: JSON.stringify(dane) }),
  });
}

/** Woła narzędzie MCP tokenem wskazanej osoby i oddaje tekst odpowiedzi. */
async function narzedziem(
  osoba: Osoba,
  nazwa: string,
  argumenty: Record<string, unknown> = {},
): Promise<string> {
  const klient = new Client({ name: "test-izolacji", version: "1.0.0" });
  await klient.connect(new StreamableHTTPClientTransport(new URL(`${adres}/mcp/${osoba.token}`)));
  try {
    const wynik = await klient.callTool({ name: nazwa, arguments: argumenty });
    const zawartosc = (wynik as { content?: { text?: string }[] }).content ?? [];
    return zawartosc.map((c) => c.text ?? "").join("\n");
  } finally {
    await klient.close();
  }
}

beforeAll(async () => {
  rejestr = otworzBaze({ sciezka: ":memory:", katalogMigracji: MIGRACJE_REJESTRU });
  katalogPuli = mkdtempSync(join(tmpdir(), "izolacja-test-"));
  pula = utworzPule({ katalog: katalogPuli });

  const app = utworzApp(
    { rejestr, pula },
    {
      sekretSesji: "sekret-sesji-izolacja",
      strefa: "Europe/Warsaw",
      ciasteczkoTylkoHttps: false,
    },
  );

  serwer = serve({ fetch: app.fetch, port: 0 });
  await new Promise((gotowe) => serwer.once("listening", gotowe));
  adres = `http://127.0.0.1:${(serwer.address() as AddressInfo).port}`;

  ania = await zaloz("ania");
  tomek = await zaloz("tomek");

  // Ania zapisuje posiłek — wszystkie testy niżej próbują go dosięgnąć z konta Tomka.
  const zapis = await rest(ania, "/api/posilki", {
    opis: "owsianka izolacyjna",
    kcal: 500,
    bialko_g: 30,
    czas: "2026-08-28 09:00",
  });
  expect(zapis.status).toBe(201);
  idPosilkuAni = ((await zapis.json()) as { id: number }).id;
});

afterAll(() => {
  serwer.close();
  pula.zamknij();
  rmSync(katalogPuli, { recursive: true, force: true });
});

describe("izolacja przez REST", () => {
  it("dzień Tomka jest pusty, choć Ania właśnie jadła", async () => {
    const dzien = (await (
      await rest(tomek, "/api/dzien?data=2026-08-28")
    ).json()) as PodsumowanieDnia;
    expect(dzien.spozyte.kcal).toBe(0);
    expect(dzien.posilki).toHaveLength(0);
  });

  it("dzień Ani ma jej posiłek — izolacja nie działa przez gubienie danych", async () => {
    const dzien = (await (
      await rest(ania, "/api/dzien?data=2026-08-28")
    ).json()) as PodsumowanieDnia;
    expect(dzien.spozyte.kcal).toBe(500);
  });

  it("Tomek nie poprawi ani nie usunie wpisu Ani — identyfikator trafia w JEGO pustą bazę", async () => {
    const poprawka = await rest(tomek, "/api/wpis", {
      typ: "posilek",
      id: idPosilkuAni,
      akcja: "popraw",
      dane: { kcal: 1 },
    });
    expect(poprawka.status).toBe(400);

    const usuniecie = await rest(tomek, "/api/wpis", {
      typ: "posilek",
      id: idPosilkuAni,
      akcja: "usun",
    });
    expect(usuniecie.status).toBe(400);

    // Wpis Ani stoi nietknięty.
    const dzien = (await (
      await rest(ania, "/api/dzien?data=2026-08-28")
    ).json()) as PodsumowanieDnia;
    expect(dzien.spozyte.kcal).toBe(500);
  });
});

describe("izolacja przez MCP", () => {
  it("podsumowanie dnia tokenem Tomka nie widzi posiłku Ani", async () => {
    const tekst = await narzedziem(tomek, "podsumowanie_dnia", { data: "2026-08-28" });
    expect(tekst).not.toContain("owsianka izolacyjna");
  });

  it("podsumowanie dnia tokenem Ani widzi jej posiłek", async () => {
    const tekst = await narzedziem(ania, "podsumowanie_dnia", { data: "2026-08-28" });
    expect(tekst).toContain("owsianka izolacyjna");
  });

  it("zmien_wpis tokenem Tomka z identyfikatorem wpisu Ani nie ma czego zmienić", async () => {
    await narzedziem(tomek, "zmien_wpis", {
      typ: "posilek",
      id: idPosilkuAni,
      akcja: "usun",
    }).catch(() => "");

    // Niezależnie od treści odpowiedzi liczy się skutek: wpis Ani stoi.
    const dzien = (await (
      await rest(ania, "/api/dzien?data=2026-08-28")
    ).json()) as PodsumowanieDnia;
    expect(dzien.spozyte.kcal).toBe(500);
  });

  it("sesja treningowa Ani nie blokuje treningu Tomka — indeks jednej otwartej sesji jest per baza", async () => {
    expect(await narzedziem(ania, "rozpocznij_trening", { bez_planu: true })).toBeTruthy();
    // Przy wspólnej bazie idx_sesja_aktywna odrzuciłby drugą otwartą sesję.
    const tomka = await narzedziem(tomek, "rozpocznij_trening", { bez_planu: true });
    expect(tomka).not.toContain("już trwa");
  });
});
