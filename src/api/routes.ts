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
import { czyBladDomeny } from "../domain/bledy.js";
import {
  celeNaDzien,
  podsumowanieDnia,
  sumyDzienne,
  ustawCele,
  zapiszPosilek,
} from "../domain/diet.js";
import { zmienWpis } from "../domain/edits.js";
import { ostatniaWaga, trendWagi, zapiszWage } from "../domain/metrics.js";
import { PORY, TYPY_CWICZEN } from "../domain/typy.js";
import {
  dodajDzienPlanu,
  historiaCwiczenia,
  planTreningowy,
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
  powtorzenia: z.number().int().positive().optional(),
  ciezar_kg: z.number().nonnegative().optional(),
  czas_s: z.number().int().positive().optional(),
  dystans_m: z.number().positive().optional(),
  rpe: z.number().min(1).max(10).optional(),
});

const schematCelow = z.object({
  kcal: z.number().positive(),
  bialko_g: z.number().nonnegative(),
  wegle_g: z.number().nonnegative(),
  tluszcz_g: z.number().nonnegative(),
  obowiazuje_od: z.string().optional(),
  opis: z.string().optional(),
});

const schematWpisu = z.object({
  typ: z.enum(["posilek", "seria", "waga"]),
  id: z.number().int().positive(),
  akcja: z.enum(["popraw", "usun"]),
  dane: z.record(z.string(), z.unknown()).optional(),
});

const schematDniaPlanu = z.object({
  kod: z.string().min(1),
  nazwa: z.string().min(1),
  dzien_tygodnia: z.number().int().min(1).max(7).nullable().optional(),
  cwiczenia: z.array(
    z.object({
      nazwa: z.string().min(1),
      typ: z.enum(TYPY_CWICZEN as unknown as [string, ...string[]]).optional(),
      serie_cel: z.number().int().positive().optional(),
      powt_cel: z.string().optional(),
      czas_cel_s: z.number().int().positive().optional(),
      dystans_cel_m: z.number().positive().optional(),
    }),
  ),
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

  api.get("/dzien", (c) =>
    c.json(podsumowanieDnia(db, c.req.query("data"), { strefa: ustawienia.strefa })),
  );

  api.post("/posilki", async (c) => {
    const dane = schematPosilku.parse(await c.req.json());
    const posilek = zapiszPosilek(
      db,
      { ...dane, pora: dane.pora as never, ts: czas(dane.czas), zrodlo: "apka", pewnosc: "dokladne" },
      { strefa: ustawienia.strefa },
    );
    return c.json(posilek, 201);
  });

  api.get("/cele", (c) =>
    c.json(celeNaDzien(db, c.req.query("data") ?? dzisiaj(ustawienia.strefa))),
  );

  api.post("/cele", async (c) => {
    const dane = schematCelow.parse(await c.req.json());
    return c.json(ustawCele(db, dane, { strefa: ustawienia.strefa }), 201);
  });

  // === Trening ==========================================================

  api.get("/plan", (c) => c.json(planTreningowy(db)));

  api.post("/plan", async (c) => {
    const dane = schematDniaPlanu.parse(await c.req.json());
    return c.json(dodajDzienPlanu(db, dane as never), 201);
  });

  api.get("/trening", (c) => c.json(stanTreningu(db)));

  api.post("/trening/start", async (c) => {
    const { kod } = (await c.req.json().catch(() => ({}))) as { kod?: string };
    rozpocznijTrening(db, { kod, strefa: ustawienia.strefa });
    return c.json(stanTreningu(db), 201);
  });

  api.post("/trening/seria", async (c) => {
    const dane = schematSerii.parse(await c.req.json());
    zapiszSerie(db, dane, { strefa: ustawienia.strefa });
    return c.json(stanTreningu(db), 201);
  });

  api.post("/trening/koniec", async (c) => {
    const { notatki } = (await c.req.json().catch(() => ({}))) as { notatki?: string };
    return c.json(zakonczTrening(db, { notatki, strefa: ustawienia.strefa }));
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
    });
  });

  api.post("/wpis", async (c) => {
    const dane = schematWpisu.parse(await c.req.json());
    return c.json(zmienWpis(db, dane as never));
  });

  return api;
}
