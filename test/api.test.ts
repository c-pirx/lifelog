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

  it("poprawia pozycje i godzinę wpisu przez /wpis", async () => {
    const utworzony = await wyslij("/api/posilki", {
      opis: "śniadanie złożone",
      kcal: 500,
      czas: "2026-08-23 08:00",
    });
    const { id } = (await utworzony.json()) as { id: number };

    const poprawka = await wyslij("/api/wpis", {
      typ: "posilek",
      id,
      akcja: "popraw",
      dane: {
        czas: "9:15",
        pozycje: [
          { nazwa: "jajko", kcal: 150 },
          { nazwa: "bułka", kcal: 200 },
        ],
      },
    });
    expect(poprawka.status).toBe(200);

    const dzien = await pobierz<PodsumowanieDnia>("/api/dzien?data=2026-08-23");
    const posilek = dzien.posilki.find((p) => p.id === id);
    expect(posilek?.godzina).toBe("09:15");
    expect(posilek?.pozycje.map((p) => p.nazwa)).toEqual(["jajko", "bułka"]);
    // Auto-suma: każda pozycja zna kcal, więc nagłówek został przeliczony.
    expect(posilek?.kcal).toBe(350);
  });

  it("zwraca historię diety pogrupowaną po dniach", async () => {
    // Posiłki z 2026-08-23 zapisał test poprawki pozycji wyżej.
    const historia = await pobierz<{
      od: string;
      do: string;
      dni: { data: string; spozyte: { kcal: number }; posilki: unknown[] }[];
    }>("/api/dieta?przed=2026-08-24&dni=7");

    expect(historia.od).toBe("2026-08-17");
    expect(historia.do).toBe("2026-08-23");
    const dzien = historia.dni.find((d) => d.data === "2026-08-23");
    expect(dzien?.posilki.length).toBeGreaterThan(0);
  });

  it("historia wymaga zalogowania jak każda trasa", async () => {
    const odpowiedz = await fetch(`${adres}/api/dieta`);
    expect(odpowiedz.status).toBe(401);
  });

  it("odrzuca zniekształcone pozycje zamiast zapisać śmieci", async () => {
    const utworzony = await wyslij("/api/posilki", {
      opis: "obiad",
      kcal: 700,
      czas: "2026-08-23 14:00",
    });
    const { id } = (await utworzony.json()) as { id: number };

    const odpowiedz = await wyslij("/api/wpis", {
      typ: "posilek",
      id,
      akcja: "popraw",
      dane: { pozycje: [{ kcal: 100 }] },
    });
    expect(odpowiedz.status).toBe(400);
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
    // Aplikacja rysuje przycisk „odhacz" z tych liczb, więc muszą dojechać.
    expect(po.wg_planu[0]?.propozycja).toMatchObject({ powtorzenia: 5, ciezar_kg: 100 });
  });

  it("wystawia plany z dniami i zaznacza domyślny", async () => {
    const plany = await pobierz<{ nazwa: string; domyslny: boolean; dni: { kod: string }[] }[]>(
      "/api/plany",
    );

    expect(plany[0]?.domyslny).toBe(true);
    expect(plany[0]?.dni.map((d) => d.kod)).toContain("A");
  });

  it("przełącza plan domyślny", async () => {
    await wyslij("/api/plan", {
      plan: "PPL",
      kod: "A",
      nazwa: "Push",
      cwiczenia: [{ nazwa: "pompki", serie_cel: 3, powt_cel: "10" }],
    });

    const odpowiedz = await wyslij("/api/plan/domyslny", { plan: "PPL" });
    expect(odpowiedz.status).toBe(200);

    const plany = await pobierz<{ nazwa: string; domyslny: boolean }[]>("/api/plany");
    expect(plany[0]).toMatchObject({ nazwa: "PPL", domyslny: true });

    // Sprzątamy po sobie: reszta bloku zakłada, że rządzi plan z dniem „A" na nogi.
    await wyslij("/api/plan/domyslny", { plan: "Mój plan" });
  });

  it("odhacza całe ćwiczenie jednym żądaniem", async () => {
    const odpowiedz = await wyslij("/api/trening/cwiczenie/odhacz", { cwiczenie: "przysiad" });
    expect(odpowiedz.status).toBe(201);

    const przysiad = ((await odpowiedz.json()) as StanTreningu).wg_planu.find(
      (c) => c.nazwa === "przysiad",
    );

    expect(przysiad?.serie_zrobione).toBe(3);
    expect(przysiad?.ukonczone).toBe(true);
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

describe("aktywności poza planem", () => {
  it("zapisuje aktywność i pokazuje ją w historii", async () => {
    const odpowiedz = await wyslij("/api/aktywnosci", {
      dyscyplina: "rower",
      dystans_m: 18_000,
      czas_s: 3600,
      notatka: "wokół jeziora",
    });
    expect(odpowiedz.status).toBe(201);

    const zapisana = (await odpowiedz.json()) as { id: number; zrodlo: string; godzina: string };
    expect(zapisana.zrodlo).toBe("apka");
    expect(zapisana.godzina).toMatch(/^\d{2}:\d{2}$/);

    const historia = await pobierz<{ dni: { data: string; dystans_m: number }[] }>(
      "/api/aktywnosci?dni=7",
    );
    expect(historia.dni[0]?.dystans_m).toBe(18_000);
  });

  it("dzień niesie aktywności obok posiłków — jedno żądanie, nie dwa", async () => {
    const dzien = await pobierz<PodsumowanieDnia & { aktywnosci: { dyscyplina: string }[] }>(
      "/api/dzien",
    );

    expect(dzien.aktywnosci.map((a) => a.dyscyplina)).toContain("rower");
  });

  it("odczyt pojedynczego dnia wskazanego datą", async () => {
    const dzien = await pobierz<{ data: string }>("/api/dzien");
    const lista = await pobierz<{ dyscyplina: string }[]>(`/api/aktywnosci?data=${dzien.data}`);

    expect(Array.isArray(lista)).toBe(true);
    expect(lista.map((a) => a.dyscyplina)).toContain("rower");
  });

  it("wpis odłożony w kolejce trafia pod swoją godzinę, nie pod godzinę wysyłki", async () => {
    const odpowiedz = await wyslij("/api/aktywnosci", {
      dyscyplina: "bieg",
      czas_s: 1800,
      czas: "2026-08-23 07:15",
    });

    const zapisana = (await odpowiedz.json()) as { data_lokalna: string; godzina: string };
    expect(zapisana.data_lokalna).toBe("2026-08-23");
    expect(zapisana.godzina).toBe("07:15");
  });

  it("odrzuca aktywność bez dystansu i bez czasu", async () => {
    const odpowiedz = await wyslij("/api/aktywnosci", { dyscyplina: "rower" });
    expect(odpowiedz.status).toBe(400);
  });

  it("poprawia i usuwa aktywność tą samą trasą co pozostałe wpisy", async () => {
    const utworzona = (await (
      await wyslij("/api/aktywnosci", { dyscyplina: "spacer", czas_s: 900 })
    ).json()) as { id: number };

    const poprawka = await wyslij("/api/wpis", {
      typ: "aktywnosc",
      id: utworzona.id,
      akcja: "popraw",
      dane: { czas_s: 1200 },
    });
    expect(poprawka.status).toBe(200);

    const usuniecie = await wyslij("/api/wpis", {
      typ: "aktywnosc",
      id: utworzona.id,
      akcja: "usun",
    });
    expect(usuniecie.status).toBe(200);
  });

  it("wymaga zalogowania", async () => {
    const odpowiedz = await fetch(`${adres}/api/aktywnosci`);
    expect(odpowiedz.status).toBe(401);
  });
});

describe("historia ruchu", () => {
  /** Trening odbyty i zamknięty przez REST — tą samą drogą, co aplikacja. */
  async function odbytyTrening() {
    await wyslij("/api/plan", {
      kod: "H",
      nazwa: "Historia",
      cwiczenia: [{ nazwa: "przysiad historyczny", typ: "silowe", serie_cel: 2, powt_cel: "5" }],
    });
    await wyslij("/api/trening/start", { kod: "H" });
    await wyslij("/api/trening/seria", {
      cwiczenie: "przysiad historyczny",
      powtorzenia: 5,
      ciezar_kg: 100,
    });
    await wyslij("/api/trening/koniec", {});
  }

  it("zakładka dostaje odbyte treningi razem z aktywnościami", async () => {
    await odbytyTrening();

    const historia = await pobierz<{
      dni: { data: string; treningi: { dzien_kod: string; serie_lacznie: number }[] }[];
    }>("/api/aktywnosci?dni=7");

    const trening = historia.dni.flatMap((d) => d.treningi).find((t) => t.dzien_kod === "H");
    expect(trening?.serie_lacznie).toBe(1);
  });

  it("dzień niesie treningi obok posiłków i aktywności — jednym żądaniem", async () => {
    const dzien = await pobierz<{ treningi: { dzien_kod: string | null }[] }>("/api/dzien");

    expect(dzien.treningi.map((t) => t.dzien_kod)).toContain("H");
  });

  it("usuwa cały trening razem z seriami", async () => {
    const dzien = await pobierz<{ treningi: { id: number; dzien_kod: string | null }[] }>(
      "/api/dzien",
    );
    const trening = dzien.treningi.find((t) => t.dzien_kod === "H");

    const odpowiedz = await wyslij("/api/wpis", {
      typ: "sesja",
      id: trening?.id,
      akcja: "usun",
    });
    expect(odpowiedz.status).toBe(200);

    const po = await pobierz<{ treningi: { dzien_kod: string | null }[] }>("/api/dzien");
    expect(po.treningi.map((t) => t.dzien_kod)).not.toContain("H");

    // Ćwiczenie zostaje — znika wykonanie, nie definicja.
    const historia = await pobierz<{ serie: unknown[] }>(
      `/api/historia/${encodeURIComponent("przysiad historyczny")}`,
    );
    expect(historia.serie).toHaveLength(0);
  });

  it("odmawia poprawiania sesji", async () => {
    const odpowiedz = await wyslij("/api/wpis", { typ: "sesja", id: 1, akcja: "popraw", dane: {} });
    expect(odpowiedz.status).toBe(400);
  });
});

describe("notatki", () => {
  type Folder = {
    kategoria: string;
    ile: number;
    ostatnia: string | null;
    notatki: { id: number; tresc: string; surowe_wejscie: string | null; zrodlo: string }[];
  };

  const foldery = async () => (await pobierz<{ foldery: Folder[] }>("/api/notatki")).foldery;
  const folder = async (kategoria: string) =>
    (await foldery()).find((f) => f.kategoria === kategoria)!;

  it("zapisuje notatkę z aplikacji i pokazuje ją w folderze", async () => {
    const odpowiedz = await wyslij("/api/notatki", {
      tresc: "Ustaliliśmy termin na piątek.",
      kategoria: "praca",
    });
    expect(odpowiedz.status).toBe(201);

    const zapisana = (await odpowiedz.json()) as { id: number; zrodlo: string; godzina: string };
    expect(zapisana.zrodlo).toBe("apka");
    expect(zapisana.godzina).toMatch(/^\d{2}:\d{2}$/);

    const praca = await folder("praca");
    expect(praca.ile).toBe(1);
    expect(praca.notatki[0]?.tresc).toBe("Ustaliliśmy termin na piątek.");
    // Notatka wpisana palcem nie przeszła przez model — nie ma oryginału.
    expect(praca.notatki[0]?.surowe_wejscie).toBeNull();
  });

  it("odczyt zwraca komplet folderów, także pustych", async () => {
    expect((await foldery()).map((f) => f.kategoria)).toEqual(["dziennik", "praca", "inne"]);
  });

  it("odrzuca notatkę bez treści", async () => {
    expect((await wyslij("/api/notatki", { tresc: "" })).status).toBe(400);
  });

  it("odrzuca folder spoza listy", async () => {
    const odpowiedz = await wyslij("/api/notatki", { tresc: "Coś", kategoria: "pomysly" });
    expect(odpowiedz.status).toBe(400);
  });

  it("wpis odłożony w kolejce trafia pod swoją godzinę, nie pod godzinę wysyłki", async () => {
    const zapisana = (await (
      await wyslij("/api/notatki", { tresc: "Notatka sprzed dwóch dni", czas: "2026-08-23 07:15" })
    ).json()) as { data_lokalna: string; godzina: string };

    expect(zapisana.data_lokalna).toBe("2026-08-23");
    expect(zapisana.godzina).toBe("07:15");
  });

  it("przywrócenie po usunięciu niesie z powrotem surową transkrypcję", async () => {
    // Ta jedna droga wysyła surowe_wejscie z aplikacji: bez niej omyłkowe
    // stuknięcie w ✕ kasowałoby zapis prawdy bezpowrotnie.
    const odpowiedz = await wyslij("/api/notatki", {
      tresc: "Przywrócona notatka",
      kategoria: "dziennik",
      surowe_wejscie: "przywrocona notatka tak jak bylo podyktowane",
    });

    const zapisana = (await odpowiedz.json()) as { surowe_wejscie: string | null };
    expect(zapisana.surowe_wejscie).toContain("podyktowane");
  });

  it("poprawia i usuwa notatkę tą samą trasą co pozostałe wpisy", async () => {
    const utworzona = (await (
      await wyslij("/api/notatki", { tresc: "Do poprawki", kategoria: "inne" })
    ).json()) as { id: number };

    const poprawka = await wyslij("/api/wpis", {
      typ: "notatka",
      id: utworzona.id,
      akcja: "popraw",
      dane: { tresc: "Po poprawce" },
    });
    expect(poprawka.status).toBe(200);
    expect((await folder("inne")).notatki[0]?.tresc).toBe("Po poprawce");

    const usuniecie = await wyslij("/api/wpis", {
      typ: "notatka",
      id: utworzona.id,
      akcja: "usun",
    });
    expect(usuniecie.status).toBe(200);

    // Licznik folderu tu nie wystarczy: „inne" jest workiem i leży w nim także
    // notatka z testu godziny wysyłki.
    const zostale = (await folder("inne")).notatki.map((n) => n.tresc);
    expect(zostale).not.toContain("Po poprawce");
  });
});
