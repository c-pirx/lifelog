/**
 * Testy REST dla aplikacji webowej.
 *
 * Najważniejszy jest tu ostatni blok: dowód, że sesja treningowa rozpoczęta
 * przez Claude'a i seria odhaczona w aplikacji to ten sam stan. To założenie,
 * na którym stoi cała architektura — gdyby przestało być prawdą, użytkownik
 * widziałby dwie różne wersje swojego treningu.
 */

import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { utworzApp } from "../src/app.js";
import { otworzBaze, type Baza } from "../src/db/index.js";
import type { PodsumowanieDnia, StanTreningu } from "../src/domain/typy.js";

const HASLO = "tajne-haslo-testowe";
const TOKEN_MCP = "token-mcp-o-wystarczajacej-dlugosci";
const SEKRET = "sekret-sesji-o-wystarczajacej-dlugosci";

let db: Baza;
let serwer: ReturnType<typeof serve>;
let adres: string;
let ciasteczko = "";

async function zadanie(sciezka: string, opcje: RequestInit = {}): Promise<Response> {
  return fetch(`${adres}${sciezka}`, {
    ...opcje,
    headers: {
      "content-type": "application/json",
      ...(ciasteczko ? { cookie: ciasteczko } : {}),
      ...opcje.headers,
    },
  });
}

async function pobierz<T>(sciezka: string): Promise<T> {
  const odpowiedz = await zadanie(sciezka);
  expect(odpowiedz.status, `GET ${sciezka}`).toBe(200);
  return (await odpowiedz.json()) as T;
}

async function wyslij(sciezka: string, dane: unknown): Promise<Response> {
  return zadanie(sciezka, { method: "POST", body: JSON.stringify(dane) });
}

beforeAll(async () => {
  db = otworzBaze({ sciezka: ":memory:" });
  const app = utworzApp(db, {
    mcpToken: TOKEN_MCP,
    haslo: HASLO,
    sekretSesji: SEKRET,
    strefa: "Europe/Warsaw",
    ciasteczkoTylkoHttps: false,
  });

  serwer = serve({ fetch: app.fetch, port: 0 });
  await new Promise((gotowe) => serwer.once("listening", gotowe));
  adres = `http://127.0.0.1:${(serwer.address() as AddressInfo).port}`;
});

afterAll(() => {
  serwer.close();
});

describe("logowanie", () => {
  it("odrzuca dostęp bez sesji", async () => {
    expect((await zadanie("/api/dzien")).status).toBe(401);
  });

  it("odrzuca błędne hasło", async () => {
    expect((await wyslij("/api/logowanie", { haslo: "zle" })).status).toBe(401);
  });

  it("odrzuca puste hasło", async () => {
    expect((await wyslij("/api/logowanie", {})).status).toBe(401);
  });

  it("wydaje ciasteczko sesji po poprawnym haśle", async () => {
    const odpowiedz = await wyslij("/api/logowanie", { haslo: HASLO });
    expect(odpowiedz.status).toBe(200);

    const naglowek = odpowiedz.headers.get("set-cookie") ?? "";
    expect(naglowek).toMatch(/sesja=/);
    expect(naglowek).toMatch(/HttpOnly/i);

    ciasteczko = naglowek.split(";")[0] ?? "";
    expect((await zadanie("/api/dzien")).status).toBe(200);
  });

  it("odrzuca podrobione ciasteczko", async () => {
    const odpowiedz = await zadanie("/api/dzien", { headers: { cookie: "sesja=podrobka.xyz" } });
    expect(odpowiedz.status).toBe(401);
  });
});

describe("dieta przez API", () => {
  it("zapisuje posiłek i pokazuje go w podsumowaniu dnia", async () => {
    await wyslij("/api/cele", {
      kcal: 2400,
      bialko_g: 180,
      wegle_g: 250,
      tluszcz_g: 80,
      obowiazuje_od: "2026-08-01",
    });

    const utworzony = await wyslij("/api/posilki", {
      opis: "jajecznica z 3 jaj",
      kcal: 330,
      bialko_g: 21,
      czas: "2026-08-25 09:00",
    });
    expect(utworzony.status).toBe(201);

    const dzien = await pobierz<PodsumowanieDnia>("/api/dzien?data=2026-08-25");
    expect(dzien.spozyte.kcal).toBe(330);
    expect(dzien.pozostalo?.kcal).toBe(2070);
    expect(dzien.posilki[0]?.opis).toBe("jajecznica z 3 jaj");
  });

  it("oznacza wpisy z aplikacji jako dokładne, nie szacowane", async () => {
    const dzien = await pobierz<PodsumowanieDnia>("/api/dzien?data=2026-08-25");
    expect(dzien.posilki[0]?.pewnosc).toBe("dokladne");
    expect(dzien.posilki[0]?.zrodlo).toBe("apka");
  });

  it("poprawia i usuwa wpis", async () => {
    const dzien = await pobierz<PodsumowanieDnia>("/api/dzien?data=2026-08-25");
    const id = dzien.posilki[0]?.id ?? 0;

    await wyslij("/api/wpis", { typ: "posilek", id, akcja: "popraw", dane: { kcal: 400 } });
    expect((await pobierz<PodsumowanieDnia>("/api/dzien?data=2026-08-25")).spozyte.kcal).toBe(400);

    await wyslij("/api/wpis", { typ: "posilek", id, akcja: "usun" });
    expect((await pobierz<PodsumowanieDnia>("/api/dzien?data=2026-08-25")).posilki).toHaveLength(0);
  });

  it("odrzuca posiłek bez opisu", async () => {
    expect((await wyslij("/api/posilki", { kcal: 100 })).status).toBe(400);
  });

  it("tłumaczy błąd domenowy zamiast zwracać awarię", async () => {
    const odpowiedz = await wyslij("/api/wpis", { typ: "posilek", id: 9999, akcja: "usun" });

    expect(odpowiedz.status).toBe(400);
    expect(((await odpowiedz.json()) as { blad: string }).blad).toMatch(/nie znaleziono/i);
  });
});

describe("trening przez API", () => {
  it("prowadzi przez plan, sesję i serie", async () => {
    await wyslij("/api/plan", {
      kod: "A",
      nazwa: "Nogi",
      dzien_tygodnia: 1,
      cwiczenia: [{ nazwa: "przysiad", typ: "silowe", serie_cel: 3, powt_cel: "5" }],
    });

    const start = await wyslij("/api/trening/start", { kod: "A" });
    expect(start.status).toBe(201);

    const po = (await (
      await wyslij("/api/trening/seria", { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 })
    ).json()) as StanTreningu;

    expect(po.wg_planu[0]?.serie_zrobione).toBe(1);
    expect(po.pozostalo).toEqual(["przysiad"]);
  });

  it("odmawia drugiej sesji, gdy jedna jest otwarta", async () => {
    const odpowiedz = await wyslij("/api/trening/start", { kod: "A" });

    expect(odpowiedz.status).toBe(400);
    expect(((await odpowiedz.json()) as { blad: string }).blad).toMatch(/aktywn/i);
  });

  it("zapisuje serię pod godziną podaną przez klienta", async () => {
    // Fundament kolejki offline: seria wpisana o 18:05 i wysłana o 19:30
    // musi wylądować pod 18:05, inaczej historia treningu kłamie.
    await wyslij("/api/trening/seria", {
      cwiczenie: "przysiad",
      powtorzenia: 3,
      ciezar_kg: 102.5,
      czas: "2026-08-24T16:05:00.000Z",
    });

    const stan = await pobierz<StanTreningu>("/api/trening");
    const zapisana = stan.wg_planu[0]?.serie.find((s) => s.ciezar_kg === 102.5);

    expect(zapisana?.ts).toBe("2026-08-24T16:05:00.000Z");
    // Serie sortują się po ts (repo.serieSesji), więc wpis z wcześniejszą
    // godziną wchodzi na swoje miejsce w kolejności, a nie na koniec listy.
    expect(stan.wg_planu[0]?.serie[0]?.ciezar_kg).toBe(102.5);
  });

  it("przyjmuje ćwiczenie spoza planu w podanym typie", async () => {
    const po = (await (
      await wyslij("/api/trening/seria", { cwiczenie: "ergometr", typ: "cardio", czas_s: 600 })
    ).json()) as StanTreningu;

    const dodatkowe = po.poza_planem.find((c) => c.nazwa === "ergometr");

    expect(dodatkowe?.typ).toBe("cardio");
    expect(dodatkowe?.serie[0]?.czas_s).toBe(600);
  });

  it("usuwa serię przez /api/wpis", async () => {
    const przed = await pobierz<StanTreningu>("/api/trening");
    const doUsuniecia = przed.poza_planem.find((c) => c.nazwa === "ergometr")?.serie[0];

    const odpowiedz = await wyslij("/api/wpis", {
      typ: "seria",
      id: doUsuniecia?.id,
      akcja: "usun",
    });
    expect(odpowiedz.status).toBe(200);

    const po = await pobierz<StanTreningu>("/api/trening");
    expect(po.poza_planem.find((c) => c.nazwa === "ergometr")).toBeUndefined();
  });

  it("zamyka sesję", async () => {
    const odpowiedz = await wyslij("/api/trening/koniec", { notatki: "ok" });
    expect(odpowiedz.status).toBe(200);

    expect((await pobierz<StanTreningu>("/api/trening")).sesja).toBeNull();
  });
});

describe("wspólny stan czatu i aplikacji", () => {
  it("sesja z Claude'a i seria z aplikacji to ten sam trening", async () => {
    const klient = new Client({ name: "test", version: "1.0.0" });
    await klient.connect(
      new StreamableHTTPClientTransport(new URL(`${adres}/mcp/${TOKEN_MCP}`)),
    );

    try {
      // 1. Claude otwiera sesję.
      await klient.callTool({ name: "rozpocznij_trening", arguments: { kod: "A" } });

      // 2. Użytkownik odhacza serię w aplikacji webowej.
      await wyslij("/api/trening/seria", { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 110 });

      // 3. Claude pyta o stan i widzi serię wpisaną w aplikacji.
      const wynik = await klient.callTool({ name: "stan_treningu", arguments: {} });
      const tekst = ((wynik as { content: { text?: string }[] }).content ?? [])
        .map((c) => c.text ?? "")
        .join("\n");

      expect(tekst).toMatch(/5×110 kg/);

      // 4. I odwrotnie — seria dopisana przez Claude'a jest widoczna w aplikacji.
      await klient.callTool({
        name: "zapisz_serie",
        arguments: { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 110 },
      });

      const zApi = await pobierz<StanTreningu>("/api/trening");
      expect(zApi.wg_planu[0]?.serie_zrobione).toBe(2);

      await klient.callTool({ name: "zakoncz_trening", arguments: {} });
    } finally {
      await klient.close();
    }
  });
});

describe("tydzień i raporty", () => {
  it("postępy niosą podgląd bieżącego tygodnia", async () => {
    const postepy = await pobierz<{
      tydzien: { tydzien_od: string; tydzien_do: string; dni_zamkniete: number };
    }>("/api/postepy?dni=30");

    expect(postepy.tydzien.tydzien_od <= postepy.tydzien.tydzien_do).toBe(true);
    expect(postepy.tydzien.dni_zamkniete).toBeGreaterThanOrEqual(0);
    expect(postepy.tydzien.dni_zamkniete).toBeLessThanOrEqual(6);
  });

  it("archiwum raportów odpowiada listą", async () => {
    // Świeża baza może nie mieć jeszcze zamkniętego tygodnia — sprawdzamy
    // kształt odpowiedzi, bo liczba raportów zależy od dnia uruchomienia.
    expect(Array.isArray(await pobierz("/api/raporty"))).toBe(true);
  });

  it("archiwum wymaga zalogowania", async () => {
    const odpowiedz = await fetch(`${adres}/api/raporty`);
    expect(odpowiedz.status).toBe(401);
  });
});
