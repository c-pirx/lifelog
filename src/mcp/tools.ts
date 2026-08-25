/**
 * Narzędzia MCP — cienki adapter nad warstwą domenową.
 *
 * Żadnej logiki biznesowej tutaj: zamiana argumentów, wywołanie `domain/`,
 * sformatowanie odpowiedzi. Opisy narzędzi są częścią produktu — to z nich
 * Claude uczy się, kiedy dopytać, a kiedy zapisać od razu.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Baza } from "../db/index.js";
import { czyBladDomeny } from "../domain/bledy.js";
import { podsumowanieDnia, ustawCele, zapiszPosilek } from "../domain/diet.js";
import { zmienWpis } from "../domain/edits.js";
import { trendWagi, zapiszWage } from "../domain/metrics.js";
import { PORY, TYPY_CWICZEN } from "../domain/typy.js";
import {
  dodajDzienPlanu,
  historiaCwiczenia,
  planTreningowy,
  rozpocznijTrening,
  stanTreningu,
  usunDzienPlanu,
  zakonczTrening,
  zapiszSerie,
} from "../domain/workouts.js";
import { parsujCzas, STREFA_DOMYSLNA } from "../lib/time.js";
import {
  historiaWTekscie,
  planWTekscie,
  podsumowanieWTekscie,
  posilekWTekscie,
  seriaWTekscie,
  stanTreninguWTekscie,
} from "./formatowanie.js";

type Wynik = { content: { type: "text"; text: string }[]; isError?: boolean };

const tekst = (tresc: string): Wynik => ({ content: [{ type: "text", text: tresc }] });

/**
 * Zamienia wyjątek na czytelny komunikat. Błędy domenowe trafiają do
 * użytkownika wprost; techniczne są logowane i podawane ogólnikowo.
 */
function zBezpiecznikiem(uruchom: () => string): Wynik {
  try {
    return tekst(uruchom());
  } catch (blad) {
    if (czyBladDomeny(blad)) {
      return { content: [{ type: "text", text: blad.message }], isError: true };
    }
    console.error("Nieoczekiwany błąd narzędzia MCP:", blad);
    return {
      content: [{ type: "text", text: "Wystąpił błąd po stronie serwera. Spróbuj ponownie." }],
      isError: true,
    };
  }
}

const OPIS_CZASU =
  'Czas zdarzenia. Przyjmuje "HH:MM" (dzisiaj), "YYYY-MM-DD HH:MM" (czas polski) ' +
  "albo pełne ISO 8601 ze strefą. Pomiń, żeby użyć chwili obecnej. " +
  "NIE przeliczaj sam na UTC — podaj czas polski, serwer go zamieni.";

const schematPozycji = z.object({
  nazwa: z.string(),
  ilosc_g: z.number().optional(),
  kcal: z.number().optional(),
  bialko_g: z.number().optional(),
  wegle_g: z.number().optional(),
  tluszcz_g: z.number().optional(),
});

export function zarejestrujNarzedzia(server: McpServer, db: Baza, strefa = STREFA_DOMYSLNA): void {
  const czas = (podany?: string): string | undefined =>
    podany === undefined ? undefined : parsujCzas(podany, strefa);

  // === DIETA ============================================================

  server.registerTool(
    "zapisz_posilek",
    {
      title: "Zapisz posiłek",
      description:
        "Zapisuje zjedzony posiłek wraz z makroskładnikami.\n\n" +
        "ZASADA SZACOWANIA — stosuj ją zawsze:\n" +
        "• Opis konkretny (podana gramatura lub jednoznaczny produkt, np. „200 g piersi z kurczaka”, " +
        "„owsianka 80 g z bananem”): oszacuj makro i zapisz OD RAZU z pewnosc='dokladne'.\n" +
        "• Opis ogólnikowy („zjadłem obiad”, „coś u mamy”, „kanapki”): NAJPIERW dopytaj o skład " +
        "i wielkość porcji. Dopiero gdy użytkownik nie potrafi doprecyzować, zapisz najlepsze " +
        "oszacowanie z pewnosc='szacowane'.\n\n" +
        "ZAWSZE podaj w odpowiedzi przyjęte wartości, żeby użytkownik mógł je poprawić jednym zdaniem. " +
        "W polu surowe_wejscie umieść oryginalną wypowiedź użytkownika — pozwoli to później przeliczyć " +
        "posiłek bez zgadywania. Rozbicie na składniki (pozycje) jest opcjonalne; suma z pól głównych " +
        "i tak decyduje o podsumowaniu dnia.",
      inputSchema: {
        opis: z.string().describe("Krótki opis posiłku, np. „kurczak z ryżem i brokułami”"),
        kcal: z.number().describe("Kalorie całego posiłku"),
        bialko_g: z.number().optional(),
        wegle_g: z.number().optional(),
        tluszcz_g: z.number().optional(),
        pora: z
          .enum(PORY as unknown as [string, ...string[]])
          .optional()
          .describe("Pomiń, aby wywnioskować z godziny"),
        czas: z.string().optional().describe(OPIS_CZASU),
        pewnosc: z
          .enum(["dokladne", "szacowane"])
          .optional()
          .describe("Patrz zasada szacowania w opisie narzędzia. Domyślnie 'szacowane'."),
        zrodlo: z
          .enum(["czat", "zdjecie", "apka"])
          .optional()
          .describe("Ustaw 'zdjecie', gdy makro pochodzi z analizy fotografii posiłku"),
        surowe_wejscie: z.string().optional().describe("Oryginalna wypowiedź użytkownika"),
        pozycje: z.array(schematPozycji).optional().describe("Opcjonalne rozbicie na składniki"),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        const posilek = zapiszPosilek(
          db,
          {
            opis: args.opis,
            kcal: args.kcal,
            bialko_g: args.bialko_g,
            wegle_g: args.wegle_g,
            tluszcz_g: args.tluszcz_g,
            pora: args.pora as never,
            ts: czas(args.czas),
            pewnosc: args.pewnosc,
            zrodlo: args.zrodlo,
            surowe_wejscie: args.surowe_wejscie,
            pozycje: args.pozycje,
          },
          { strefa },
        );

        const dzien = podsumowanieDnia(db, posilek.data_lokalna, { strefa });
        const bilans = dzien.pozostalo
          ? `\nZostało dziś: ${Math.round(dzien.pozostalo.kcal)} kcal, ${Math.round(dzien.pozostalo.bialko_g)} g białka.`
          : "";

        return `Zapisano: ${posilekWTekscie(posilek)}${bilans}`;
      }),
  );

  server.registerTool(
    "podsumowanie_dnia",
    {
      title: "Podsumowanie dnia",
      description:
        "Zwraca bilans wybranego dnia: zjedzone makro, cele, ile zostało oraz listę posiłków " +
        "z ich identyfikatorami (przydatne do poprawek). Bez argumentu pokazuje dzisiaj.",
      inputSchema: {
        data: z.string().optional().describe("Data w formacie YYYY-MM-DD. Pomiń, aby zobaczyć dzisiaj."),
      },
    },
    async (args) => zBezpiecznikiem(() => podsumowanieWTekscie(podsumowanieDnia(db, args.data, { strefa }))),
  );

  server.registerTool(
    "ustaw_cele",
    {
      title: "Ustaw cele dzienne",
      description:
        "Ustawia dzienne cele kaloryczne i makroskładnikowe. Cele obowiązują od podanego dnia " +
        "w przód — wcześniejsze podsumowania zachowują stare wartości, więc historia nie jest fałszowana.",
      inputSchema: {
        kcal: z.number(),
        bialko_g: z.number(),
        wegle_g: z.number(),
        tluszcz_g: z.number(),
        obowiazuje_od: z.string().optional().describe("YYYY-MM-DD. Pomiń, aby obowiązywały od dzisiaj."),
        opis: z.string().optional().describe("Np. „redukcja 0,5 kg/tydzień”"),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        const cele = ustawCele(db, args, { strefa });
        return (
          `Cele od ${cele.obowiazuje_od}: ${cele.kcal} kcal, ` +
          `B ${cele.bialko_g} g, W ${cele.wegle_g} g, T ${cele.tluszcz_g} g.`
        );
      }),
  );

  // === TRENING ==========================================================

  server.registerTool(
    "zarzadzaj_planem",
    {
      title: "Zarządzaj planem treningowym",
      description:
        "Podgląd i edycja stałego planu treningowego.\n" +
        "• akcja='pokaz' — wyświetla cały plan.\n" +
        "• akcja='zapisz_dzien' — tworzy lub NADPISUJE dzień o podanym kodzie wraz z listą ćwiczeń. " +
        "Podawaj zawsze pełną listę ćwiczeń tego dnia, bo poprzednia jest zastępowana.\n" +
        "• akcja='usun_dzien' — usuwa dzień o podanym kodzie.\n\n" +
        "dzien_tygodnia (1 = poniedziałek … 7 = niedziela) buduje stały harmonogram, dzięki któremu " +
        "rozpocznij_trening sam podpowiada właściwy dzień.",
      inputSchema: {
        akcja: z.enum(["pokaz", "zapisz_dzien", "usun_dzien"]),
        kod: z.string().optional().describe("Krótki identyfikator dnia, np. „A”, „push”"),
        nazwa: z.string().optional().describe("Nazwa opisowa, np. „Nogi i klatka”"),
        dzien_tygodnia: z.number().int().min(1).max(7).nullable().optional(),
        cwiczenia: z
          .array(
            z.object({
              nazwa: z.string(),
              typ: z
                .enum(TYPY_CWICZEN as unknown as [string, ...string[]])
                .optional()
                .describe("Domyślnie 'silowe'. 'cardio' dla biegu/roweru, 'na_czas' dla deski."),
              partia: z.string().optional(),
              serie_cel: z.number().int().positive().optional(),
              powt_cel: z.string().optional().describe("Np. „5” albo zakres „8-12”"),
              czas_cel_s: z.number().int().positive().optional(),
              dystans_cel_m: z.number().positive().optional(),
            }),
          )
          .optional(),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        if (args.akcja === "pokaz") return planWTekscie(planTreningowy(db));

        if (!args.kod) {
          return "Podaj kod dnia planu (pole kod).";
        }

        if (args.akcja === "usun_dzien") {
          return usunDzienPlanu(db, args.kod)
            ? `Usunięto dzień ${args.kod} z planu.`
            : `Nie znaleziono dnia o kodzie ${args.kod}.`;
        }

        const dzien = dodajDzienPlanu(db, {
          kod: args.kod,
          nazwa: args.nazwa ?? args.kod,
          dzien_tygodnia: args.dzien_tygodnia ?? null,
          cwiczenia: (args.cwiczenia ?? []) as never,
        });

        return `Zapisano dzień planu:\n\n${planWTekscie([dzien])}`;
      }),
  );

  server.registerTool(
    "rozpocznij_trening",
    {
      title: "Rozpocznij trening",
      description:
        "Otwiera sesję treningową. Bez argumentu wybiera dzień z harmonogramu tygodniowego; " +
        "podaj kod, żeby trenować inny dzień niż przewiduje harmonogram, albo bez_planu " +
        "dla treningu zupełnie poza planem. " +
        "Naraz może być otwarta tylko jedna sesja — zakończ poprzednią, jeśli została otwarta.",
      inputSchema: {
        kod: z.string().optional().describe("Kod dnia planu. Pomiń, aby użyć harmonogramu."),
        bez_planu: z
          .boolean()
          .optional()
          .describe("Sesja bez dnia planu, nawet jeśli harmonogram coś dziś przewiduje."),
        czas: z.string().optional().describe(OPIS_CZASU),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        rozpocznijTrening(db, {
          kod: args.kod,
          bez_planu: args.bez_planu,
          ts: czas(args.czas),
          strefa,
        });
        return stanTreninguWTekscie(stanTreningu(db));
      }),
  );

  server.registerTool(
    "zapisz_serie",
    {
      title: "Zapisz serię",
      description:
        "Dopisuje serię do trwającej sesji. Numer serii nadawany jest automatycznie, " +
        "chyba że podasz nr_serii (przydatne przy uzupełnianiu luk).\n\n" +
        "Wypełniaj pola zgodnie z typem ćwiczenia: siłowe — powtorzenia (i ciezar_kg); " +
        "cardio — czas_s lub dystans_m; na czas — czas_s. " +
        "Nieznane ćwiczenie zostanie utworzone — domyślnie jako siłowe, więc przy cardio " +
        "lub ćwiczeniu izometrycznym podaj typ. Ćwiczenie już znane zachowuje swój typ.",
      inputSchema: {
        cwiczenie: z.string().describe("Nazwa ćwiczenia, wielkość liter bez znaczenia"),
        typ: z
          .enum(TYPY_CWICZEN as unknown as [string, ...string[]])
          .optional()
          .describe("Tylko przy pierwszym wystąpieniu ćwiczenia. Domyślnie silowe."),
        powtorzenia: z.number().int().positive().optional(),
        ciezar_kg: z.number().nonnegative().optional(),
        czas_s: z.number().int().positive().optional(),
        dystans_m: z.number().positive().optional(),
        rpe: z.number().min(1).max(10).optional().describe("Subiektywna trudność 1–10"),
        nr_serii: z.number().int().positive().optional(),
        czas: z.string().optional().describe(OPIS_CZASU),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        const seria = zapiszSerie(
          db,
          { ...args, typ: args.typ as never, ts: czas(args.czas) },
          { strefa },
        );
        const stan = stanTreningu(db);
        const postep = [...stan.wg_planu, ...stan.poza_planem].find(
          (c) => c.cwiczenie_id === seria.cwiczenie_id,
        );

        const licznik = postep?.serie_cel
          ? ` (${postep.serie_zrobione}/${postep.serie_cel})`
          : ` (${postep?.serie_zrobione ?? 1}. seria)`;

        const ostrzezenie = postep?.slabsze_niz_poprzednio.includes(seria.nr_serii)
          ? "  ⚠ słabiej niż poprzednio"
          : "";

        return `${seria.nazwa}: ${seriaWTekscie(seria)}${licznik}${ostrzezenie}\n` +
          (stan.pozostalo.length > 0 ? `Zostało: ${stan.pozostalo.join(", ")}` : "Plan wykonany.");
      }),
  );

  server.registerTool(
    "stan_treningu",
    {
      title: "Stan treningu",
      description:
        "Pokazuje trwającą sesję: co już zrobione, ile serii zostało do celu, wyniki " +
        "z poprzedniego takiego treningu i serie słabsze niż ostatnio. " +
        "Używaj, gdy użytkownik pyta „co mi zostało” albo chce porównania z poprzednim razem.",
      inputSchema: {},
    },
    async () => zBezpiecznikiem(() => stanTreninguWTekscie(stanTreningu(db))),
  );

  server.registerTool(
    "zakoncz_trening",
    {
      title: "Zakończ trening",
      description: "Zamyka trwającą sesję i podsumowuje ją. Opcjonalnie zapisuje notatkę.",
      inputSchema: {
        notatki: z.string().optional(),
        czas: z.string().optional().describe(OPIS_CZASU),
        porzucona: z
          .boolean()
          .optional()
          .describe("true, gdy trening został przerwany, a nie ukończony"),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        const przed = stanTreningu(db);
        const sesja = zakonczTrening(db, {
          notatki: args.notatki,
          ts: czas(args.czas),
          status: args.porzucona ? "porzucona" : "zakonczona",
        });

        const serie = przed.wg_planu
          .concat(przed.poza_planem)
          .reduce((suma, c) => suma + c.serie_zrobione, 0);

        return (
          `Trening ${sesja.dzien_kod ?? "bez planu"} zakończony. ` +
          `Ćwiczeń wg planu: ${przed.ukonczone_cwiczen}/${przed.wszystkich_cwiczen}, serii łącznie: ${serie}.` +
          (przed.pozostalo.length > 0 ? `\nNiedokończone: ${przed.pozostalo.join(", ")}.` : "")
        );
      }),
  );

  server.registerTool(
    "historia_cwiczenia",
    {
      title: "Historia ćwiczenia",
      description:
        "Zwraca wyniki danego ćwiczenia z ostatnich sesji wraz z rekordem ciężaru. " +
        "Używaj do oceny progresji („czy powinienem dołożyć w przysiadzie?”).",
      inputSchema: {
        cwiczenie: z.string(),
        ile_sesji: z.number().int().positive().max(50).optional().describe("Domyślnie 10"),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => historiaWTekscie(historiaCwiczenia(db, args.cwiczenie, args.ile_sesji ?? 10))),
  );

  // === POMIARY I POPRAWKI ==============================================

  server.registerTool(
    "zapisz_wage",
    {
      title: "Zapisz wagę ciała",
      description:
        "Zapisuje pomiar wagi. Jeden pomiar na dobę — ponowny zapis tego samego dnia nadpisuje " +
        "poprzedni. Zwraca też średnią kroczącą z 7 dni, bo dzienne wahania wody potrafią " +
        "przykryć rzeczywisty trend.",
      inputSchema: {
        kg: z.number().positive(),
        czas: z.string().optional().describe(OPIS_CZASU),
        notatka: z.string().optional(),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        const waga = zapiszWage(db, args.kg, { ts: czas(args.czas), notatka: args.notatka, strefa });
        // Okno trendu kończy się na dacie pomiaru, a nie na dzisiaj — inaczej
        // pomiar wpisany wstecz wypadłby poza okno i nie miałby średniej.
        const trend = trendWagi(db, 30, { strefa, do: waga.data_lokalna });
        const ostatni = trend.at(-1);
        const pierwszy = trend[0];

        const zmiana =
          trend.length > 1 && pierwszy && ostatni
            ? ` Zmiana średniej w tym okresie: ${(ostatni.srednia_7d - pierwszy.srednia_7d).toFixed(1)} kg.`
            : "";

        return (
          `Zapisano ${waga.kg} kg (${waga.data_lokalna}).` +
          (ostatni ? ` Średnia 7-dniowa: ${ostatni.srednia_7d} kg.` : "") +
          zmiana
        );
      }),
  );

  server.registerTool(
    "zmien_wpis",
    {
      title: "Popraw lub usuń wpis",
      description:
        "Poprawia albo usuwa wcześniejszy wpis. Identyfikatory znajdziesz w podsumowaniu dnia " +
        "(posiłki) i w stanie treningu (serie).\n" +
        "• typ='posilek' — pola: opis, kcal, bialko_g, wegle_g, tluszcz_g, pora, pewnosc\n" +
        "• typ='seria' — pola: powtorzenia, ciezar_kg, czas_s, dystans_m, rpe\n" +
        "• typ='waga' — pola: kg, notatka\n\n" +
        "Podawaj wyłącznie pola, które mają się zmienić — reszta zostaje nietknięta. " +
        "Po poprawieniu szacunku na potwierdzoną wartość ustaw pewnosc='dokladne'.",
      inputSchema: {
        typ: z.enum(["posilek", "seria", "waga"]),
        id: z.number().int().positive(),
        akcja: z.enum(["popraw", "usun"]),
        dane: z
          .object({
            opis: z.string().optional(),
            kcal: z.number().optional(),
            bialko_g: z.number().optional(),
            wegle_g: z.number().optional(),
            tluszcz_g: z.number().optional(),
            pora: z.enum(PORY as unknown as [string, ...string[]]).optional(),
            pewnosc: z.enum(["dokladne", "szacowane"]).optional(),
            powtorzenia: z.number().int().optional(),
            ciezar_kg: z.number().optional(),
            czas_s: z.number().int().optional(),
            dystans_m: z.number().optional(),
            rpe: z.number().optional(),
            kg: z.number().optional(),
            notatka: z.string().optional(),
          })
          .optional(),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        const wynik = zmienWpis(db, {
          typ: args.typ,
          id: args.id,
          akcja: args.akcja,
          dane: args.dane as never,
        });
        return wynik.opis;
      }),
  );
}

/** Nazwy zarejestrowanych narzędzi — używane w teście pilnującym budżetu kontekstu. */
export const NAZWY_NARZEDZI = [
  "zapisz_posilek",
  "podsumowanie_dnia",
  "ustaw_cele",
  "zarzadzaj_planem",
  "rozpocznij_trening",
  "zapisz_serie",
  "stan_treningu",
  "zakoncz_trening",
  "historia_cwiczenia",
  "zapisz_wage",
  "zmien_wpis",
] as const;

