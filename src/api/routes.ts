/**
 * REST dla aplikacji webowej — drugi cienki adapter nad `domain/`.
 *
 * Te same funkcje, które wołają narzędzia MCP. Gdyby któryś zapis szedł tu
 * własną drogą, czat i aplikacja zaczęłyby pokazywać różne liczby.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { odczytajToken, utworzToken, WAZNOSC_SESJI_DNI } from "../auth.js";
import type { Baza } from "../db/index.js";
import type { ZrodlaDanych } from "../db/pula.js";
import { aktywnosciZDnia, historiaRuchu, zapiszAktywnosc } from "../domain/aktywnosci.js";
import { czyBladDomeny } from "../domain/bledy.js";
import {
  kontoPoId,
  nowyTokenKonektora,
  sekretSesjiDla,
  zaloguj,
  zmienHaslo,
  type Konto,
} from "../domain/konta.js";
import {
  tokenWypisu,
  wypiszZListy,
  zapiszNaListe,
  zarejestrujZKodem,
} from "../domain/lista.js";
import { wiadomoscDlaGospodarza, wiadomoscPowitalna } from "../domain/wiadomosci.js";
import type { Poczta, Wiadomosc } from "../lib/poczta.js";
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
import { historiaNotatek, zapiszNotatke } from "../domain/notatki.js";
import { raporty, tydzienWToku, zapewnijRaporty } from "../domain/raporty.js";
import { KATEGORIE_NOTATEK, PORY, TYPY_CWICZEN } from "../domain/typy.js";
import {
  dodajDzienPlanu,
  historiaCwiczenia,
  historiaSesji,
  odhaczCwiczenie,
  planNaDzis,
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

/**
 * Poczta razem z tym, czego potrzebuje treść wiadomości: dokąd prowadzą linki
 * i kto dostaje powiadomienia. Komplet albo nic — sam transport bez adresu
 * publicznego wysyłałby maile z linkami donikąd.
 */
export type UslugaPoczty = {
  transport: Poczta;
  /** Publiczny adres aplikacji, bez ukośnika na końcu. */
  adresPubliczny: string;
  /** Adres gospodarza — tam idą powiadomienia o zapisach na listę. */
  gospodarz: string;
};

export type UstawieniaApi = {
  sekretSesji: string;
  /** Strefa domyślna — konta zakładane bez podania własnej. */
  strefa: string;
  /** Wyłączane w testach i przy pracy lokalnej po http. */
  ciasteczkoTylkoHttps?: boolean;
  /** Brak = zapisy na listę działają, maile nie wychodzą. */
  poczta?: UslugaPoczty;
};

/**
 * Zmienne kontekstu ustawiane przez bramę sesji: dziennik i strefa
 * zalogowanego użytkownika. Trasy nie wiedzą, że użytkowników jest wielu —
 * dostają jedną bazę, dokładnie jak przed wielodostępem.
 */
type SrodowiskoApi = {
  Variables: {
    db: Baza;
    strefa: string;
    konto: Konto;
  };
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

// Notatka wpisana palcem nie ma surowej transkrypcji — nie przeszła przez model,
// więc nie ma czego zestawiać. Pole zostaje w schemacie wyłącznie dla „Cofnij"
// po usunięciu: przywracana notatka musi wrócić z oryginałem, inaczej jedno
// omyłkowe stuknięcie w ✕ kasowałoby zapis prawdy bezpowrotnie.
const schematNotatki = z.object({
  tresc: z.string().min(1),
  kategoria: z.enum(KATEGORIE_NOTATEK as unknown as [string, ...string[]]).optional(),
  tytul: z.string().optional(),
  surowe_wejscie: z.string().optional(),
  czas: z.string().optional(),
});

const schematWpisu = z.object({
  typ: z.enum(["posilek", "seria", "waga", "aktywnosc", "sesja", "notatka"]),
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

export function utworzRouterApi(zrodla: ZrodlaDanych, ustawienia: UstawieniaApi) {
  const { rejestr, pula } = zrodla;
  const api = new Hono<SrodowiskoApi>();
  const czas = (c: { var: { strefa: string } }, podany?: string) =>
    podany ? parsujCzas(podany, c.var.strefa) : undefined;

  /** Ciasteczko sesji podpisane sekretem zależnym od hasza hasła użytkownika. */
  const wydajSesje = (c: Parameters<typeof setCookie>[0], idUzytkownika: number): boolean => {
    const sekret = sekretSesjiDla(rejestr, idUzytkownika, ustawienia.sekretSesji);
    if (sekret === null) return false;
    setCookie(c, NAZWA_CIASTECZKA, utworzToken(sekret, idUzytkownika), {
      httpOnly: true,
      sameSite: "Lax",
      secure: ustawienia.ciasteczkoTylkoHttps ?? true,
      path: "/",
      maxAge: WAZNOSC_SESJI_DNI * 24 * 60 * 60,
    });
    return true;
  };

  // === Lista oczekujących ===============================================

  /**
   * Wysyłka poza cyklem żądania: zapis już się udał i nie ma powodu, żeby
   * awaria Resendu zamieniła go w 500. Nieudany mail zostaje w dzienniku —
   * źródłem prawdy jest wiersz w rejestrze.
   */
  const wyslijWTle = (wiadomosc: Wiadomosc): void => {
    if (!ustawienia.poczta) return;
    void ustawienia.poczta.transport.wyslij(wiadomosc).catch((blad: unknown) => {
      console.error(`Nie udało się wysłać „${wiadomosc.temat}":`, blad);
    });
  };

  // Przed bramą sesji — zapisujący się ze zdefiniowania nie ma konta.
  // Napór z internetu dławi nginx (strefa `zapisy`), boty odsiewa domena.
  api.post("/lista", async (c) => {
    const dane = z
      .object({
        email: z.string().min(1),
        imie: z.string().optional(),
        zgoda: z.boolean(),
        /** Honeypot — pole ukryte przed człowiekiem. */
        pulapka: z.string().optional(),
        /** Znacznik załadowania strony, do minimalnego czasu wypełnienia. */
        otwarto: z.number().optional(),
      })
      .parse(await c.req.json());

    const wynik = zapiszNaListe(rejestr, dane);

    // Maile wychodzą WYŁĄCZNIE przy nowym wpisie. Przy duplikacie milczymy,
    // bo inaczej formularz stałby się działkiem na cudzą skrzynkę: jeden
    // adres dostaje od nas najwyżej jedno powitanie, kiedykolwiek.
    if (wynik.nowy && wynik.wpis && !ustawienia.poczta) {
      // Zapis się udał, ale nikt się o nim nie dowie. Bez tej linijki cisza
      // po stronie poczty byłaby zupełnie niema.
      console.warn(
        `Poczta wyłączona — nie wysłano powitania do ${wynik.wpis.email} ani powiadomienia.`,
      );
    }

    if (wynik.nowy && wynik.wpis && ustawienia.poczta) {
      const adresy = { publiczny: ustawienia.poczta.adresPubliczny };
      wyslijWTle(
        wiadomoscPowitalna({
          email: wynik.wpis.email,
          imie: wynik.wpis.imie,
          numer: wynik.lacznie,
          tokenWypisu: tokenWypisu(wynik.wpis.email, ustawienia.sekretSesji),
          adresy,
        }),
      );
      wyslijWTle(
        wiadomoscDlaGospodarza({
          odbiorca: ustawienia.poczta.gospodarz,
          email: wynik.wpis.email,
          imie: wynik.wpis.imie,
          numer: wynik.lacznie,
          lacznie: wynik.lacznie,
        }),
      );
    }

    // Jedna odpowiedź na nowy adres, duplikat i bota — formularz nie ma
    // zdradzać, kto już jest na liście.
    return c.json({ ok: true }, 201);
  });

  /**
   * Wypis z linku w stopce maila. Zawsze ta sama strona: gdyby nieznany token
   * dawał inną odpowiedź, link służyłby do sprawdzania, czy ktoś jest na liście.
   */
  api.get("/lista/wypis/:token", (c) => {
    wypiszZListy(rejestr, c.req.param("token"), ustawienia.sekretSesji);
    return c.redirect("/wypisano.html", 302);
  });

  // === Rejestracja ======================================================

  // Rejestracja stoi już nie na wspólnym haśle, tylko na jednorazowym kodzie
  // z maila zaproszenia — dostęp da się cofnąć jednej osobie, a kod nie krąży
  // dalej między znajomymi.
  api.post("/rejestracja", async (c) => {
    const dane = z
      .object({
        kod: z.string(),
        login: z.string().min(1),
        haslo: z.string(),
        zgoda: z.boolean(),
      })
      .parse(await c.req.json());

    const wynik = zarejestrujZKodem(rejestr, dane);
    wydajSesje(c, wynik.id);

    // Jawny token pojawia się wyłącznie tutaj i przy rotacji — rejestr trzyma
    // sam hasz, więc później nie ma go już skąd odczytać.
    return c.json({ ok: true, token_konektora: wynik.tokenKonektora }, 201);
  });

  // === Logowanie ========================================================

  api.post("/logowanie", async (c) => {
    const { login, haslo } = (await c.req.json().catch(() => ({}))) as {
      login?: string;
      haslo?: string;
    };

    const konto = login && haslo ? zaloguj(rejestr, login, haslo) : null;
    if (!konto || !wydajSesje(c, konto.id)) {
      // Jedna odpowiedź na złe hasło i nieznany login — formularz nie ma
      // zdradzać, które konta istnieją.
      return c.json({ blad: "Nieprawidłowy login lub hasło" }, 401);
    }

    return c.json({ ok: true });
  });

  api.post("/wylogowanie", (c) => {
    deleteCookie(c, NAZWA_CIASTECZKA, { path: "/" });
    return c.json({ ok: true });
  });

  // === Brama ============================================================

  api.use("/*", async (c, nastepny) => {
    const token = getCookie(c, NAZWA_CIASTECZKA);
    const id = token
      ? odczytajToken(token, (kandydat) => sekretSesjiDla(rejestr, kandydat, ustawienia.sekretSesji))
      : null;
    const konto = id === null ? null : kontoPoId(rejestr, id);
    if (!konto) {
      return c.json({ blad: "Wymagane logowanie" }, 401);
    }

    // Od tego miejsca trasy widzą wyłącznie dziennik zalogowanego —
    // uchwyt innej bazy nie istnieje w ich zasięgu.
    c.set("db", pula.daj(konto.id));
    c.set("strefa", konto.strefa);
    c.set("konto", konto);
    return nastepny();
  });

  // === Konto ============================================================

  api.get("/konto", (c) => c.json(c.var.konto));

  // Rotacja tokenu konektora. Rejestr trzyma sam hasz, więc to jedyna droga
  // do zobaczenia adresu — także po zgubieniu tego z rejestracji.
  api.post("/konektor/nowy", (c) =>
    c.json({ ok: true, token_konektora: nowyTokenKonektora(rejestr, c.var.konto.id) }),
  );

  api.post("/haslo", async (c) => {
    const { stare, nowe } = z
      .object({ stare: z.string(), nowe: z.string() })
      .parse(await c.req.json());

    // Sesja nie wystarcza do zmiany hasła: telefon zostawiony odblokowany
    // nie może przejąć konta na stałe.
    if (!zaloguj(rejestr, c.var.konto.login, stare)) {
      return c.json({ blad: "Nieprawidłowe obecne hasło" }, 401);
    }

    zmienHaslo(rejestr, c.var.konto.id, nowe);
    // Stare sesje właśnie zgasły (sekret podpisu zawiera hasz hasła) —
    // ta odpowiedź niesie świeże ciasteczko, żeby zalogowany nie wypadł.
    wydajSesje(c, c.var.konto.id);
    return c.json({ ok: true });
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
    const dzien = podsumowanieDnia(c.var.db, c.req.query("data"), { strefa: c.var.strefa });
    return c.json({
      ...dzien,
      aktywnosci: aktywnosciZDnia(c.var.db, dzien.data, { strefa: c.var.strefa }),
      treningi: historiaSesji(c.var.db, dzien.data, dzien.data, { strefa: c.var.strefa }),
    });
  });

  api.post("/posilki", async (c) => {
    const dane = schematPosilku.parse(await c.req.json());
    const posilek = zapiszPosilek(
      c.var.db,
      { ...dane, pora: dane.pora as never, ts: czas(c, dane.czas), zrodlo: "apka", pewnosc: "dokladne" },
      { strefa: c.var.strefa },
    );
    return c.json(posilek, 201);
  });

  api.get("/posilki/czeste", (c) =>
    c.json(
      czestePosilki(c.var.db, {
        dni: Number(c.req.query("dni") ?? 30),
        limit: Number(c.req.query("limit") ?? 8),
        strefa: c.var.strefa,
      }),
    ),
  );

  // Historia do zakładki Dieta. Górna granica okna to higiena wejścia —
  // trzy miesiące posiłków z pozycjami to i tak sporo kilobajtów.
  api.get("/dieta", (c) =>
    c.json(
      historiaDiety(c.var.db, {
        dni: Math.min(Number(c.req.query("dni") ?? 14), 92),
        przed: c.req.query("przed"),
        strefa: c.var.strefa,
      }),
    ),
  );

  // === Aktywności poza planem ==========================================

  // Jedna trasa, dwa odczyty: `data` daje same aktywności jednego dnia,
  // `dni`/`przed` rosnące okno pełnej historii ruchu — z treningami włącznie.
  // Tak samo jak `/dzien` i `/dieta` dzielą się rolami po stronie diety.
  api.get("/aktywnosci", (c) => {
    const data = c.req.query("data");
    if (data) return c.json(aktywnosciZDnia(c.var.db, data, { strefa: c.var.strefa }));

    return c.json(
      historiaRuchu(c.var.db, {
        dni: Math.min(Number(c.req.query("dni") ?? 14), 92),
        przed: c.req.query("przed"),
        strefa: c.var.strefa,
      }),
    );
  });

  api.post("/aktywnosci", async (c) => {
    const { czas: kiedy, ...dane } = schematAktywnosci.parse(await c.req.json());
    return c.json(
      zapiszAktywnosc(
        c.var.db,
        { ...dane, ts: czas(c, kiedy), zrodlo: "apka" },
        { strefa: c.var.strefa },
      ),
      201,
    );
  });

  api.get("/cele", (c) =>
    c.json(celeNaDzien(c.var.db, c.req.query("data") ?? dzisiaj(c.var.strefa))),
  );

  api.post("/cele", async (c) => {
    const dane = schematCelow.parse(await c.req.json());
    return c.json(ustawCele(c.var.db, dane, { strefa: c.var.strefa }), 201);
  });

  // === Notatki ==========================================================

  // Komplet folderów w jednej odpowiedzi, każdy z najnowszą porcją notatek.
  // Dzięki temu po zbuforowaniu zakładka działa bez zasięgu w całości, nie
  // tylko ten folder, który akurat był otwarty — ten sam chwyt co przy /raporty.
  api.get("/notatki", (c) =>
    c.json(
      historiaNotatek(c.var.db, {
        ile: Number(c.req.query("ile") ?? 30),
        strefa: c.var.strefa,
      }),
    ),
  );

  api.post("/notatki", async (c) => {
    const { czas: kiedy, ...dane } = schematNotatki.parse(await c.req.json());
    return c.json(
      zapiszNotatke(
        c.var.db,
        { ...dane, kategoria: dane.kategoria as never, ts: czas(c, kiedy), zrodlo: "apka" },
        { strefa: c.var.strefa },
      ),
      201,
    );
  });

  // === Trening ==========================================================

  // `/plan` to dni planu domyślnego — tyle, ile potrzebuje harmonogram.
  // `/plany` niesie komplet, bo zakładka Trening pokazuje też szablony.
  api.get("/plan", (c) => c.json(planTreningowy(c.var.db)));

  api.get("/plany", (c) => c.json(plany(c.var.db)));

  api.post("/plan", async (c) => {
    const dane = schematDniaPlanu.parse(await c.req.json());
    return c.json(dodajDzienPlanu(c.var.db, dane as never), 201);
  });

  api.post("/plan/domyslny", async (c) => {
    const { plan } = z.object({ plan: z.string().min(1) }).parse(await c.req.json());
    return c.json(ustawPlanDomyslny(c.var.db, plan));
  });

  // `dzis` dokładane w trasie, tak samo jak `/dzien` dokłada aktywności: stan
  // trwającej sesji i harmonogram to dwa osobne pytania, ale ekran Trening
  // zadaje oba naraz, a drugie żądanie to drugie czekanie na telefonie.
  api.get("/trening", (c) =>
    c.json({ ...stanTreningu(c.var.db), dzis: planNaDzis(c.var.db, { strefa: c.var.strefa }) }),
  );

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
    rozpocznijTrening(c.var.db, {
      kod,
      plan,
      dzien_id: dzienId,
      bez_planu: bezPlanu,
      ts: czas(c, kiedy),
      strefa: c.var.strefa,
    });
    return c.json(stanTreningu(c.var.db), 201);
  });

  api.post("/trening/seria", async (c) => {
    const dane = schematSerii.parse(await c.req.json());
    zapiszSerie(c.var.db, { ...dane, typ: dane.typ as never, ts: czas(c, dane.czas) }, {
      strefa: c.var.strefa,
    });
    return c.json(stanTreningu(c.var.db), 201);
  });

  // Ciało nie niesie liczb wyniku: ile serii i z jakim obciążeniem — liczy
  // domena. Gdyby liczyła aplikacja, czat i telefon umiałyby zapisać za ten
  // sam trening co innego.
  api.post("/trening/cwiczenie/odhacz", async (c) => {
    const { czas: kiedy, ...dane } = schematOdhaczenia.parse(await c.req.json());
    return c.json(
      odhaczCwiczenie(c.var.db, dane, { ts: czas(c, kiedy), strefa: c.var.strefa }),
      201,
    );
  });

  api.post("/trening/koniec", async (c) => {
    const { notatki, czas: kiedy } = (await c.req.json().catch(() => ({}))) as {
      notatki?: string;
      czas?: string;
    };
    return c.json(
      zakonczTrening(c.var.db, { notatki, ts: czas(c, kiedy), strefa: c.var.strefa }),
    );
  });

  api.get("/historia/:cwiczenie", (c) =>
    c.json(historiaCwiczenia(c.var.db, c.req.param("cwiczenie"), Number(c.req.query("sesje") ?? 10))),
  );

  // === Pomiary i poprawki ==============================================

  api.get("/waga", (c) => {
    const dni = Number(c.req.query("dni") ?? 90);
    return c.json({ trend: trendWagi(c.var.db, dni, { strefa: c.var.strefa }), ostatnia: ostatniaWaga(c.var.db) });
  });

  api.post("/waga", async (c) => {
    const { kg, notatka, czas: kiedy } = (await c.req.json()) as {
      kg: number;
      notatka?: string;
      czas?: string;
    };
    return c.json(zapiszWage(c.var.db, kg, { notatka, ts: czas(c, kiedy), strefa: c.var.strefa }), 201);
  });

  api.get("/postepy", (c) => {
    const dni = Number(c.req.query("dni") ?? 30);
    const koniec = dzisiaj(c.var.strefa);
    return c.json({
      dni: sumyDzienne(c.var.db, przesunDate(koniec, -(dni - 1)), koniec),
      waga: trendWagi(c.var.db, dni, { strefa: c.var.strefa }),
      // Tydzień w toku dokładamy tutaj zamiast robić osobną trasę: ekran
      // Postępy i tak ją woła, a drugie żądanie to drugie czekanie na telefonie.
      tydzien: tydzienWToku(c.var.db, { strefa: c.var.strefa }),
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
    zapewnijRaporty(c.var.db, { strefa: c.var.strefa });

    const ile = Math.min(Number(c.req.query("ile") ?? 12), 52);
    return c.json(raporty(c.var.db, ile));
  });

  api.post("/wpis", async (c) => {
    const dane = schematWpisu.parse(await c.req.json());
    // Strefa jest potrzebna do przeliczenia pola `czas` względem dnia wpisu.
    return c.json(zmienWpis(c.var.db, dane as never, { strefa: c.var.strefa }));
  });

  return api;
}
