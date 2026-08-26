/**
 * REST dla aplikacji webowej — drugi cienki adapter nad `domain/`.
 *
 * Te same funkcje, które wołają narzędzia MCP. Gdyby któryś zapis szedł tu
 * własną drogą, czat i aplikacja zaczęłyby pokazywać różne liczby.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { hasloPoprawne, tokenWazny, utworzToken, WAZNOSC_SESJI_DNI } from "../auth.js";
import type { Baza } from "../db/index.js";
import { aktywnosciZDnia, historiaAktywnosci, zapiszAktywnosc } from "../domain/aktywnosci.js";
import { czyBladDomeny } from "../domain/bledy.js";
import {
  celeNaDzien,
  czestePosilki,
  historiaDiety,
  podsumowanieDnia,
  sumyDzienne,
  ustawCele,
  zapiszPosilek,
} from "../domain/diet.js";
import { zmienWpis } from "../domain/edits.js";
import { ostatniaWaga, trendWagi, zapiszWage } from "../domain/metrics.js";
import { raporty, tydzienWToku, zapewnijRaporty } from "../domain/raporty.js";
import { PORY, TYPY_CWICZEN } from "../domain/typy.js";
import {
  dodajDzienPlanu,
  historiaCwiczenia,
  odhaczCwiczenie,
  planTreningowy,
  plany,
  ustawPlanDomyslny,
  rozpocznijTrening,
  stanTreningu,
  zakonczTrening,
  zapiszSerie,
} from "../domain/workouts.js";
import { dzisiaj, parsujCzas, przesunDate } from "../lib/time.js";

export const NAZWA_CIASTECZKA = "sesja";

export type UstawieniaApi = {
  haslo: string;
  sekretSesji: string;
  strefa: string;
  /** Wyłączane w testach i przy pracy lokalnej po http. */
  ciasteczkoTylkoHttps?: boolean;
};

const schematPosilku = z.object({
  opis: z.string().min(1),
  kcal: z.number(),
  bialko_g: z.number().optional(),
  wegle_g: z.number().optional(),
  tluszcz_g: z.number().optional(),
  pora: z.enum(PORY as unknown as [string, ...string[]]).optional(),
  czas: z.string().optional(),
});

const schematSerii = z.object({
  cwiczenie: z.string().min(1),
  /** Bierze udział tylko przy tworzeniu nowego ćwiczenia — patrz `NowaSeria.typ`. */
  typ: z.enum(TYPY_CWICZEN as unknown as [string, ...string[]]).optional(),
  powtorzenia: z.number().int().positive().optional(),
  ciezar_kg: z.number().nonnegative().optional(),
  czas_s: z.number().int().positive().optional(),
  dystans_m: z.number().positive().optional(),
  rpe: z.number().min(1).max(10).optional(),
  czas: z.string().optional(),
});

const schematCelow = z.object({
  kcal: z.number().positive(),
  bialko_g: z.number().nonnegative(),
  wegle_g: z.number().nonnegative(),
  tluszcz_g: z.number().nonnegative(),
  obowiazuje_od: z.string().optional(),
  opis: z.string().optional(),
});

const schematAktywnosci = z.object({
  dyscyplina: z.string().min(1),
  dystans_m: z.number().positive().optional(),
  czas_s: z.number().int().positive().optional(),
  rpe: z.number().min(1).max(10).optional(),
  notatka: z.string().optional(),
  czas: z.string().optional(),
});

const schematWpisu = z.object({
  typ: z.enum(["posilek", "seria", "waga", "aktywnosc"]),
  id: z.number().int().positive(),
  akcja: z.enum(["popraw", "usun"]),
  dane: z.record(z.string(), z.unknown()).optional(),
});

const schematDniaPlanu = z.object({
  kod: z.string().min(1),
  nazwa: z.string().min(1),
  /** Nazwa planu; pominięta — dzień trafia do planu domyślnego. */
  plan: z.string().min(1).optional(),
  dzien_tygodnia: z.number().int().min(1).max(7).nullable().optional(),
  cwiczenia: z.array(
    z.object({
      nazwa: z.string().min(1),
      typ: z.enum(TYPY_CWICZEN as unknown as [string, ...string[]]).optional(),
      serie_cel: z.number().int().positive().optional(),
      powt_cel: z.string().optional(),
      czas_cel_s: z.number().int().positive().optional(),
      dystans_cel_m: z.number().positive().optional(),
      ciezar_cel_kg: z.number().nonnegative().optional(),
    }),
  ),
});

const schematOdhaczenia = z.object({
  cwiczenie: z.string().min(1),
  /** Górna granica to higiena wejścia — realne ćwiczenie nie ma pięćdziesięciu serii. */
  ile: z.number().int().positive().max(50).optional(),
  czas: z.string().optional(),
});

export function utworzRouterApi(db: Baza, ustawienia: UstawieniaApi) {
  const api = new Hono();
  const czas = (podany?: string) => (podany ? parsujCzas(podany, ustawienia.strefa) : undefined);

  // === Logowanie ========================================================

  api.post("/logowanie", async (c) => {
    const { haslo } = (await c.req.json().catch(() => ({}))) as { haslo?: string };

    if (!haslo || !hasloPoprawne(haslo, ustawienia.haslo)) {
      return c.json({ blad: "Nieprawidłowe hasło" }, 401);
    }

    setCookie(c, NAZWA_CIASTECZKA, utworzToken(ustawienia.sekretSesji), {
      httpOnly: true,
      sameSite: "Lax",
      secure: ustawienia.ciasteczkoTylkoHttps ?? true,
      path: "/",
      maxAge: WAZNOSC_SESJI_DNI * 24 * 60 * 60,
    });

    return c.json({ ok: true });
  });

  api.post("/wylogowanie", (c) => {
    deleteCookie(c, NAZWA_CIASTECZKA, { path: "/" });
    return c.json({ ok: true });
  });

  // === Brama ============================================================

  api.use("/*", async (c, nastepny) => {
    const token = getCookie(c, NAZWA_CIASTECZKA);
    if (!token || !tokenWazny(token, ustawienia.sekretSesji)) {
      return c.json({ blad: "Wymagane logowanie" }, 401);
    }
    return nastepny();
  });

  // Błędy domenowe to komunikat dla użytkownika, nie awaria serwera.
  api.onError((blad, c) => {
    if (czyBladDomeny(blad)) return c.json({ blad: blad.message, kod: blad.kod }, 400);
    if (blad instanceof z.ZodError) return c.json({ blad: "Niepoprawne dane wejściowe" }, 400);
    console.error("Błąd API:", blad);
    return c.json({ blad: "Błąd serwera" }, 500);
  });

  // === Dieta ============================================================

  // Aktywności dokładane do podsumowania w trasie, a nie w domenie: dieta i ruch
  // to osobne byty i mają takie zostać. Ten sam chwyt co przy `/postepy`, które
  // dokłada tydzień — drugie żądanie to drugie czekanie na telefonie.
  api.get("/dzien", (c) => {
    const dzien = podsumowanieDnia(db, c.req.query("data"), { strefa: ustawienia.strefa });
    return c.json({
      ...dzien,
      aktywnosci: aktywnosciZDnia(db, dzien.data, { strefa: ustawienia.strefa }),
    });
  });

  api.post("/posilki", async (c) => {
    const dane = schematPosilku.parse(await c.req.json());
    const posilek = zapiszPosilek(
      db,
      { ...dane, pora: dane.pora as never, ts: czas(dane.czas), zrodlo: "apka", pewnosc: "dokladne" },
      { strefa: ustawienia.strefa },
    );
    return c.json(posilek, 201);
  });

  api.get("/posilki/czeste", (c) =>
    c.json(
      czestePosilki(db, {
        dni: Number(c.req.query("dni") ?? 30),
        limit: Number(c.req.query("limit") ?? 8),
        strefa: ustawienia.strefa,
      }),
    ),
  );

  // Historia do zakładki Dieta. Górna granica okna to higiena wejścia —
  // trzy miesiące posiłków z pozycjami to i tak sporo kilobajtów.
  api.get("/dieta", (c) =>
    c.json(
      historiaDiety(db, {
        dni: Math.min(Number(c.req.query("dni") ?? 14), 92),
        przed: c.req.query("przed"),
        strefa: ustawienia.strefa,
      }),
    ),
  );

  // === Aktywności poza planem ==========================================

  // Jedna trasa, dwa odczyty: `data` daje pojedynczy dzień (ekran Dziś),
  // `dni`/`przed` rosnące okno historii (zakładka Aktywności) — tak samo jak
  // `/dzien` i `/dieta` dzielą się rolami po stronie diety.
  api.get("/aktywnosci", (c) => {
    const data = c.req.query("data");
    if (data) return c.json(aktywnosciZDnia(db, data, { strefa: ustawienia.strefa }));

    return c.json(
      historiaAktywnosci(db, {
        dni: Math.min(Number(c.req.query("dni") ?? 14), 92),
        przed: c.req.query("przed"),
        strefa: ustawienia.strefa,
      }),
    );
  });

  api.post("/aktywnosci", async (c) => {
    const { czas: kiedy, ...dane } = schematAktywnosci.parse(await c.req.json());
    return c.json(
      zapiszAktywnosc(
        db,
        { ...dane, ts: czas(kiedy), zrodlo: "apka" },
        { strefa: ustawienia.strefa },
      ),
      201,
    );
  });

  api.get("/cele", (c) =>
    c.json(celeNaDzien(db, c.req.query("data") ?? dzisiaj(ustawienia.strefa))),
  );

  api.post("/cele", async (c) => {
    const dane = schematCelow.parse(await c.req.json());
    return c.json(ustawCele(db, dane, { strefa: ustawienia.strefa }), 201);
  });

  // === Trening ==========================================================

  // `/plan` to dni planu domyślnego — tyle, ile potrzebuje harmonogram.
  // `/plany` niesie komplet, bo zakładka Trening pokazuje też szablony.
  api.get("/plan", (c) => c.json(planTreningowy(db)));

  api.get("/plany", (c) => c.json(plany(db)));

  api.post("/plan", async (c) => {
    const dane = schematDniaPlanu.parse(await c.req.json());
    return c.json(dodajDzienPlanu(db, dane as never), 201);
  });

  api.post("/plan/domyslny", async (c) => {
    const { plan } = z.object({ plan: z.string().min(1) }).parse(await c.req.json());
    return c.json(ustawPlanDomyslny(db, plan));
  });

  api.get("/trening", (c) => c.json(stanTreningu(db)));

  // Pole `czas` w trzech trasach poniżej jest po to, żeby zapis odłożony
  // w kolejce offline trafił pod godzinę, o której użytkownik go wpisał,
  // a nie pod godzinę, o której telefon odzyskał zasięg.

  api.post("/trening/start", async (c) => {
    const {
      kod,
      plan,
      dzien_id: dzienId,
      bez_planu: bezPlanu,
      czas: kiedy,
    } = (await c.req.json().catch(() => ({}))) as {
      kod?: string;
      plan?: string;
      dzien_id?: number;
      bez_planu?: boolean;
      czas?: string;
    };
    // Aplikacja podaje `dzien_id`, bo kod dnia nie jest już jednoznaczny
    // między planami; czat nadal mówi kodem.
    rozpocznijTrening(db, {
      kod,
      plan,
      dzien_id: dzienId,
      bez_planu: bezPlanu,
      ts: czas(kiedy),
      strefa: ustawienia.strefa,
    });
    return c.json(stanTreningu(db), 201);
  });

  api.post("/trening/seria", async (c) => {
    const dane = schematSerii.parse(await c.req.json());
    zapiszSerie(db, { ...dane, typ: dane.typ as never, ts: czas(dane.czas) }, {
      strefa: ustawienia.strefa,
    });
    return c.json(stanTreningu(db), 201);
  });

  // Ciało nie niesie liczb wyniku: ile serii i z jakim obciążeniem — liczy
  // domena. Gdyby liczyła aplikacja, czat i telefon umiałyby zapisać za ten
  // sam trening co innego.
  api.post("/trening/cwiczenie/odhacz", async (c) => {
    const { czas: kiedy, ...dane } = schematOdhaczenia.parse(await c.req.json());
    return c.json(
      odhaczCwiczenie(db, dane, { ts: czas(kiedy), strefa: ustawienia.strefa }),
      201,
    );
  });

  api.post("/trening/koniec", async (c) => {
    const { notatki, czas: kiedy } = (await c.req.json().catch(() => ({}))) as {
      notatki?: string;
      czas?: string;
    };
    return c.json(
      zakonczTrening(db, { notatki, ts: czas(kiedy), strefa: ustawienia.strefa }),
    );
  });

  api.get("/historia/:cwiczenie", (c) =>
    c.json(historiaCwiczenia(db, c.req.param("cwiczenie"), Number(c.req.query("sesje") ?? 10))),
  );

  // === Pomiary i poprawki ==============================================

  api.get("/waga", (c) => {
    const dni = Number(c.req.query("dni") ?? 90);
    return c.json({ trend: trendWagi(db, dni, { strefa: ustawienia.strefa }), ostatnia: ostatniaWaga(db) });
  });

  api.post("/waga", async (c) => {
    const { kg, notatka, czas: kiedy } = (await c.req.json()) as {
      kg: number;
      notatka?: string;
      czas?: string;
    };
    return c.json(zapiszWage(db, kg, { notatka, ts: czas(kiedy), strefa: ustawienia.strefa }), 201);
  });

  api.get("/postepy", (c) => {
    const dni = Number(c.req.query("dni") ?? 30);
    const koniec = dzisiaj(ustawienia.strefa);
    return c.json({
      dni: sumyDzienne(db, przesunDate(koniec, -(dni - 1)), koniec),
      waga: trendWagi(db, dni, { strefa: ustawienia.strefa }),
      // Tydzień w toku dokładamy tutaj zamiast robić osobną trasę: ekran
      // Postępy i tak ją woła, a drugie żądanie to drugie czekanie na telefonie.
      tydzien: tydzienWToku(db, { strefa: ustawienia.strefa }),
    });
  });

  // === Raporty tygodniowe ===============================================

  /**
   * Całe archiwum w jednej odpowiedzi — raportów są dziesiątki, nie tysiące,
   * a komplet w jednym żądaniu oznacza, że po zbuforowaniu archiwum działa
   * bez zasięgu w całości, nie tylko ostatni otwarty tydzień.
   */
  api.get("/raporty", (c) => {
    // Odczyt dogenerowuje zaległości — dzięki temu raport istnieje dokładnie
    // wtedy, kiedy ktoś po niego sięga, nawet po przestoju serwera.
    zapewnijRaporty(db, { strefa: ustawienia.strefa });

    const ile = Math.min(Number(c.req.query("ile") ?? 12), 52);
    return c.json(raporty(db, ile));
  });

  api.post("/wpis", async (c) => {
    const dane = schematWpisu.parse(await c.req.json());
    // Strefa jest potrzebna do przeliczenia pola `czas` względem dnia wpisu.
    return c.json(zmienWpis(db, dane as never, { strefa: ustawienia.strefa }));
  });

  return api;
}
