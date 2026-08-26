/**
 * Test integracyjny serwera MCP: prawdziwy klient SDK rozmawia po HTTP
 * z prawdziwym serwerem, który zapisuje do prawdziwej bazy.
 *
 * To jest odpowiednik ręcznego klikania w MCP Inspectorze — z tą różnicą,
 * że wykonuje się przy każdym `npm test`.
 */

import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { utworzApp } from "../src/app.js";
import { otworzBaze, type Baza } from "../src/db/index.js";

const TOKEN = "testowy-token-o-wystarczajacej-dlugosci";

let db: Baza;
let serwer: ReturnType<typeof serve>;
let klient: Client;
let adres: string;

/** Wyciąga czysty tekst z odpowiedzi narzędzia. */
function tresc(wynik: unknown): string {
  const zawartosc = (wynik as { content?: { type: string; text?: string }[] }).content ?? [];
  return zawartosc.map((c) => c.text ?? "").join("\n");
}

async function wywolaj(nazwa: string, argumenty: Record<string, unknown> = {}): Promise<string> {
  return tresc(await klient.callTool({ name: nazwa, arguments: argumenty }));
}

beforeAll(async () => {
  db = otworzBaze({ sciezka: ":memory:" });
  const app = utworzApp(db, {
    mcpToken: TOKEN,
    haslo: "nieuzywane-w-tym-tescie",
    sekretSesji: "nieuzywany-w-tym-tescie",
    strefa: "Europe/Warsaw",
  });

  serwer = serve({ fetch: app.fetch, port: 0 });
  await new Promise((gotowe) => serwer.once("listening", gotowe));

  const port = (serwer.address() as AddressInfo).port;
  adres = `http://127.0.0.1:${port}`;

  klient = new Client({ name: "test", version: "1.0.0" });
  await klient.connect(new StreamableHTTPClientTransport(new URL(`${adres}/mcp/${TOKEN}`)));
});

afterAll(async () => {
  await klient.close();
  serwer.close();
});

describe("uwierzytelnianie", () => {
  it("odrzuca żądanie bez tokenu", async () => {
    const odpowiedz = await fetch(`${adres}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(odpowiedz.status).toBe(401);
  });

  it("odrzuca żądanie z błędnym tokenem", async () => {
    const odpowiedz = await fetch(`${adres}/mcp/zly-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(odpowiedz.status).toBe(401);
  });
});

describe("lista narzędzi", () => {
  it("wystawia dokładnie 11 narzędzi", async () => {
    const { tools } = await klient.listTools();
    expect(tools).toHaveLength(11);
  });

  it("mieści się w przyjętym budżecie 12 narzędzi", async () => {
    // Każde narzędzie zajmuje kontekst w KAŻDEJ rozmowie z Claude.
    const { tools } = await klient.listTools();
    expect(tools.length).toBeLessThanOrEqual(12);
  });

  it("każde narzędzie ma opis", async () => {
    const { tools } = await klient.listTools();
    for (const narzedzie of tools) {
      expect(narzedzie.description, `brak opisu: ${narzedzie.name}`).toBeTruthy();
    }
  });

  it("opis zapisz_posilek zawiera zasadę szacowania", async () => {
    const { tools } = await klient.listTools();
    const opis = tools.find((t) => t.name === "zapisz_posilek")?.description ?? "";

    expect(opis).toMatch(/ZASADA SZACOWANIA/);
    expect(opis).toMatch(/dopytaj/i);
    expect(opis).toMatch(/niepewne/);
  });
});

describe("przepływ dietetyczny", () => {
  it("ustawia cele, zapisuje posiłek i podsumowuje dzień", async () => {
    expect(
      await wywolaj("ustaw_cele", {
        kcal: 2400,
        bialko_g: 180,
        wegle_g: 250,
        tluszcz_g: 80,
        obowiazuje_od: "2026-08-01",
      }),
    ).toMatch(/2400 kcal/);

    const zapis = await wywolaj("zapisz_posilek", {
      opis: "owsianka z bananem",
      kcal: 400,
      bialko_g: 15,
      czas: "2026-08-25 09:00",
      pewnosc: "dokladne",
    });

    expect(zapis).toMatch(/Zapisano/);
    expect(zapis).toMatch(/09:00/);
    expect(zapis).toMatch(/Zostało dziś: 2000 kcal/);

    const dzien = await wywolaj("podsumowanie_dnia", { data: "2026-08-25" });
    expect(dzien).toMatch(/400 kcal/);
    expect(dzien).toMatch(/owsianka z bananem/);
  });

  it("oznacza wpis z najniższą pewnością w odpowiedzi i w podsumowaniu", async () => {
    const zapis = await wywolaj("zapisz_posilek", {
      opis: "obiad u mamy",
      kcal: 800,
      czas: "2026-08-24 14:00",
      pewnosc: "niepewne",
    });

    expect(zapis).toMatch(/\(niepewne\)/);

    const dzien = await wywolaj("podsumowanie_dnia", { data: "2026-08-24" });
    expect(dzien).toMatch(/w tym niepewnych: 1/);
  });

  it("przyjmuje czas polski i nie gubi doby", async () => {
    await wywolaj("zapisz_posilek", {
      opis: "późna kolacja",
      kcal: 600,
      czas: "2026-08-26 23:30",
    });

    // 23:30 czasu polskiego to 21:30 UTC — dzień musi zostać 26-go.
    expect(await wywolaj("podsumowanie_dnia", { data: "2026-08-26" })).toMatch(/późna kolacja/);
  });

  it("poprawia zapisany posiłek", async () => {
    await wywolaj("zapisz_posilek", { opis: "obiad", kcal: 700, czas: "2026-08-27 14:00" });

    const dzien = await wywolaj("podsumowanie_dnia", { data: "2026-08-27" });
    const id = Number(/#(\d+)/.exec(dzien)?.[1]);
    expect(id).toBeGreaterThan(0);

    await wywolaj("zmien_wpis", {
      typ: "posilek",
      id,
      akcja: "popraw",
      dane: { kcal: 900, pewnosc: "dokladne" },
    });

    expect(await wywolaj("podsumowanie_dnia", { data: "2026-08-27" })).toMatch(/900 kcal/);
  });

  it("poprawia pozycje i godzinę posiłku", async () => {
    await wywolaj("zapisz_posilek", {
      opis: "śniadanie złożone",
      kcal: 500,
      czas: "2026-08-28 08:00",
      pozycje: [{ nazwa: "jajko", kcal: 150 }],
    });

    const dzien = await wywolaj("podsumowanie_dnia", { data: "2026-08-28" });
    const id = Number(/#(\d+)/.exec(dzien)?.[1]);
    expect(id).toBeGreaterThan(0);

    const wynik = await wywolaj("zmien_wpis", {
      typ: "posilek",
      id,
      akcja: "popraw",
      dane: {
        czas: "09:15",
        pozycje: [
          { nazwa: "jajko", kcal: 150 },
          { nazwa: "bułka", kcal: 200 },
        ],
      },
    });
    expect(wynik).toMatch(/przeliczony z pozycji: 350 kcal/);

    const po = await wywolaj("podsumowanie_dnia", { data: "2026-08-28" });
    expect(po).toMatch(/09:15/);
    expect(po).toMatch(/350 kcal/);
    // Claude musi widzieć rozbicie, które sam zapisał — inaczej nie ma jak
    // poprawić pojedynczego składnika.
    expect(po).toMatch(/· jajko — 150 kcal/);
    expect(po).toMatch(/· bułka — 200 kcal/);
  });
});

describe("przepływ treningowy", () => {
  it("prowadzi przez cały trening od planu do podsumowania", async () => {
    const plan = await wywolaj("zarzadzaj_planem", {
      akcja: "zapisz_dzien",
      kod: "A",
      nazwa: "Nogi",
      dzien_tygodnia: 1,
      cwiczenia: [
        { nazwa: "przysiad", typ: "silowe", serie_cel: 3, powt_cel: "5" },
        { nazwa: "wykroki", typ: "silowe", serie_cel: 2, powt_cel: "10" },
      ],
    });
    expect(plan).toMatch(/przysiad/);

    const start = await wywolaj("rozpocznij_trening", { kod: "A", czas: "2026-09-07 18:00" });
    expect(start).toMatch(/Trening A/);
    expect(start).toMatch(/Zostało: przysiad, wykroki/);

    const seria = await wywolaj("zapisz_serie", {
      cwiczenie: "przysiad",
      powtorzenia: 5,
      ciezar_kg: 100,
    });
    expect(seria).toMatch(/5×100 kg/);
    expect(seria).toMatch(/\(1\/3\)/);

    const stan = await wywolaj("stan_treningu");
    expect(stan).toMatch(/Postęp: 0\/2/);

    const koniec = await wywolaj("zakoncz_trening", { notatki: "test" });
    expect(koniec).toMatch(/zakończony/);
    expect(koniec).toMatch(/Niedokończone/);
  });

  it("zapamiętuje ciężar docelowy i odhacza całe ćwiczenie jednym wywołaniem", async () => {
    const plan = await wywolaj("zarzadzaj_planem", {
      akcja: "zapisz_dzien",
      kod: "D",
      nazwa: "Klatka",
      cwiczenia: [
        { nazwa: "wyciskanie hantlami", typ: "silowe", serie_cel: 4, powt_cel: "8", ciezar_cel_kg: 30 },
      ],
    });
    expect(plan).toMatch(/30 kg/);

    await wywolaj("rozpocznij_trening", { kod: "D", czas: "2026-09-14 18:00" });
    const wynik = await wywolaj("zapisz_serie", {
      cwiczenie: "wyciskanie hantlami",
      ile_serii: 4,
    });

    expect(wynik).toMatch(/\(4\/4\)/);
    await wywolaj("zakoncz_trening", {});
  });

  it("zapisuje cały plan naraz i przełącza domyślny", async () => {
    const zapisany = await wywolaj("zarzadzaj_planem", {
      akcja: "zapisz_plan",
      plan: "PPL",
      dni: [
        { kod: "A", nazwa: "Push", dzien_tygodnia: 2, cwiczenia: [{ nazwa: "pompki", serie_cel: 3 }] },
        { kod: "B", nazwa: "Pull", cwiczenia: [{ nazwa: "podciąganie", serie_cel: 3 }] },
      ],
    });
    expect(zapisany).toMatch(/PPL/);
    expect(zapisany).toMatch(/Push/);

    // Kod „A" istnieje już w planie domyślnym — plany nie mogą sobie kolidować.
    const przelaczony = await wywolaj("zarzadzaj_planem", {
      akcja: "ustaw_domyslny",
      plan: "PPL",
    });
    expect(przelaczony).toMatch(/PPL/);

    const plan = await wywolaj("zarzadzaj_planem", { akcja: "pokaz" });
    expect(plan).toMatch(/PPL/);
    expect(plan).toMatch(/domyślny/i);
  });

  it("nie pozwala zapisać serii bez otwartej sesji", async () => {
    const wynik = await klient.callTool({
      name: "zapisz_serie",
      arguments: { cwiczenie: "przysiad", powtorzenia: 5 },
    });

    expect(wynik.isError).toBe(true);
    expect(tresc(wynik)).toMatch(/sesj/i);
  });

  it("odrzuca cardio bez czasu i dystansu, tłumacząc czego brakuje", async () => {
    await wywolaj("zarzadzaj_planem", {
      akcja: "zapisz_dzien",
      kod: "C",
      nazwa: "Cardio",
      cwiczenia: [{ nazwa: "bieżnia", typ: "cardio", serie_cel: 1 }],
    });
    await wywolaj("rozpocznij_trening", { kod: "C", czas: "2026-09-08 18:00" });

    const wynik = await klient.callTool({
      name: "zapisz_serie",
      arguments: { cwiczenie: "bieżnia", powtorzenia: 10 },
    });

    expect(wynik.isError).toBe(true);
    expect(tresc(wynik)).toMatch(/czas|dystans/i);

    await wywolaj("zakoncz_trening", {});
  });

  it("pokazuje wyniki poprzedniego treningu i oznacza słabsze serie", async () => {
    await wywolaj("zarzadzaj_planem", {
      akcja: "zapisz_dzien",
      kod: "D",
      nazwa: "Klatka",
      cwiczenia: [{ nazwa: "wyciskanie", typ: "silowe", serie_cel: 2, powt_cel: "5" }],
    });

    await wywolaj("rozpocznij_trening", { kod: "D", czas: "2026-09-09 18:00" });
    await wywolaj("zapisz_serie", { cwiczenie: "wyciskanie", powtorzenia: 5, ciezar_kg: 80 });
    await wywolaj("zakoncz_trening", {});

    await wywolaj("rozpocznij_trening", { kod: "D", czas: "2026-09-16 18:00" });
    const slabsza = await wywolaj("zapisz_serie", {
      cwiczenie: "wyciskanie",
      powtorzenia: 5,
      ciezar_kg: 75,
    });

    expect(slabsza).toMatch(/słabiej niż poprzednio/);

    const stan = await wywolaj("stan_treningu");
    expect(stan).toMatch(/poprzednio: 5×80 kg/);

    await wywolaj("zakoncz_trening", {});
  });

  it("zwraca historię ćwiczenia z rekordem", async () => {
    const historia = await wywolaj("historia_cwiczenia", { cwiczenie: "wyciskanie" });

    expect(historia).toMatch(/Rekord ciężaru: 80 kg/);
    expect(historia).toMatch(/2026-09-16/);
  });
});

describe("waga", () => {
  it("zapisuje pomiar i podaje średnią kroczącą", async () => {
    const wynik = await wywolaj("zapisz_wage", { kg: 81.4, czas: "2026-09-20 07:00" });

    expect(wynik).toMatch(/81\.4 kg/);
    expect(wynik).toMatch(/Średnia 7-dniowa/);
  });
});

describe("raport tygodniowy przez MCP", () => {
  it("bez raportu w bazie tłumaczy, kiedy powstanie pierwszy", async () => {
    // Świeża baza nie ma zamkniętego tygodnia z danymi — odpowiedź jest ta sama
    // niezależnie od dnia uruchomienia testu.
    const wynik = await wywolaj("podsumowanie_dnia", { okres: "tydzien" });

    expect(wynik).toMatch(/niedziel/i);
    expect(wynik).toMatch(/9:00/);
  });

  it("odmawia zapisania komentarza bez wskazania tygodnia", async () => {
    const wynik = await wywolaj("podsumowanie_dnia", { komentarz: "Dobry tydzień." });

    expect(wynik).toMatch(/okres="tydzien"/);
  });

  it("nadal mieści się w budżecie narzędzi mimo nowych możliwości", async () => {
    // Raport tygodniowy wszedł parametrami istniejącego narzędzia, nie kolejną
    // pozycją — właśnie po to, żeby ten warunek dalej był prawdziwy.
    const { tools } = await klient.listTools();
    const podsumowanie = tools.find((t) => t.name === "podsumowanie_dnia");

    expect(tools).toHaveLength(11);
    expect(Object.keys(podsumowanie?.inputSchema.properties ?? {})).toContain("okres");
  });
});

describe("aktywności poza planem", () => {
  it("zapisuje aktywność bez otwartej sesji i nie tworzy sesji", async () => {
    const wynik = await wywolaj("zapisz_serie", {
      cwiczenie: "rower",
      aktywnosc: true,
      dystans_m: 20_000,
      czas_s: 3600,
      notatka: "wokół jeziora",
      czas: "2026-09-20 17:30",
    });

    expect(wynik).toMatch(/rower/);
    expect(wynik).toMatch(/20 km/);
    expect(wynik).toMatch(/1 h 00 min/);
    expect(wynik).toMatch(/wokół jeziora/);

    // Zapis aktywności nie może dotknąć sesji — inaczej zablokowałby trening.
    expect(await wywolaj("stan_treningu")).toMatch(/nie ma otwartej sesji/i);
  });

  it("odrzuca pola siłowe zmieszane z aktywnością", async () => {
    const wynik = await klient.callTool({
      name: "zapisz_serie",
      arguments: { cwiczenie: "rower", aktywnosc: true, dystans_m: 5000, powtorzenia: 10 },
    });

    expect(wynik.isError).toBe(true);
    expect(tresc(wynik)).toMatch(/powtorzenia/);
  });

  it("odrzuca aktywność bez dystansu i bez czasu", async () => {
    const wynik = await klient.callTool({
      name: "zapisz_serie",
      arguments: { cwiczenie: "spacer", aktywnosc: true },
    });

    expect(wynik.isError).toBe(true);
    expect(tresc(wynik)).toMatch(/dystans/i);
  });

  it("podsumowanie dnia pokazuje aktywności z identyfikatorami", async () => {
    const podsumowanie = await wywolaj("podsumowanie_dnia", { data: "2026-09-20" });

    expect(podsumowanie).toMatch(/Aktywności poza planem/);
    expect(podsumowanie).toMatch(/#\d+ 17:30 rower/);
  });

  it("poprawia aktywność przez zmien_wpis", async () => {
    const podsumowanie = await wywolaj("podsumowanie_dnia", { data: "2026-09-20" });
    const id = Number(/#(\d+) 17:30 rower/.exec(podsumowanie)?.[1]);

    expect(await wywolaj("zmien_wpis", {
      typ: "aktywnosc",
      id,
      akcja: "popraw",
      dane: { dystans_m: 25_000 },
    })).toMatch(/poprawiono/i);

    expect(await wywolaj("podsumowanie_dnia", { data: "2026-09-20" })).toMatch(/25 km/);
  });

  it("opis zapisz_serie rozstrzyga, kiedy to seria, a kiedy aktywność", async () => {
    const { tools } = await klient.listTools();
    const opis = tools.find((t) => t.name === "zapisz_serie")?.description ?? "";

    expect(opis).toMatch(/SAMODZIELNĄ AKTYWNOŚĆ/);
    expect(opis).toMatch(/W TRAKCIE trwającej sesji/);
  });
});
