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
import { BladDomeny, czyBladDomeny } from "../domain/bledy.js";
import { podsumowanieDnia, ustawCele, zapiszPosilek } from "../domain/diet.js";
import { zmienWpis } from "../domain/edits.js";
import { trendWagi, zapiszWage } from "../domain/metrics.js";
import { dopiszKomentarz, raport, zapewnijRaporty } from "../domain/raporty.js";
import type { PostepCwiczenia } from "../domain/typy.js";
import { PEWNOSCI, PORY, TYPY_CWICZEN } from "../domain/typy.js";
import {
  dodajDzienPlanu,
  historiaCwiczenia,
  odhaczCwiczenie,
  planTreningowy,
  plany,
  ustawPlanDomyslny,
  zapiszPlan,
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
  planyWTekscie,
  podsumowanieWTekscie,
  posilekWTekscie,
  raportWTekscie,
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

/** Ćwiczenie w planie — ten sam kształt przy pojedynczym dniu i przy całym planie. */
const SCHEMAT_CWICZENIA_W_PLANIE = z.object({
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
  ciezar_cel_kg: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Ciężar roboczy. Dzięki niemu aplikacja odhacza serię jednym stuknięciem; " +
        "pominięty spada na wynik z poprzedniego treningu.",
    ),
});

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
        "ZASADA SZACOWANIA — trzy poziomy pewności, stosuj ją zawsze:\n" +
        "• pewnosc='dokladne' — podana gramatura, etykieta lub jednoznaczny produkt " +
        "(„200 g piersi z kurczaka”): oszacuj makro i zapisz OD RAZU.\n" +
        "• pewnosc='szacowane' — opis konkretny, ale bez wag („owsianka z bananem i masłem " +
        "orzechowym”): oszacuj porcje i zapisz OD RAZU.\n" +
        "• pewnosc='niepewne' — ogólnik („zjadłem obiad u mamy”) albo zdjęcie bez szczegółów: " +
        "NAJPIERW dopytaj o skład i wielkość porcji. Dopiero gdy użytkownik nie potrafi " +
        "doprecyzować, zapisz najlepsze oszacowanie z pewnosc='niepewne'.\n\n" +
        "ZAWSZE podaj w odpowiedzi przyjęte wartości, żeby użytkownik mógł je poprawić jednym zdaniem. " +
        "W polu surowe_wejscie umieść oryginalną wypowiedź użytkownika — pozwoli to później przeliczyć " +
        "posiłek bez zgadywania. Gdy użytkownik wymienia składniki, podaj je w pozycje z makro każdego " +
        "z osobna — pozwoli to później poprawiać pojedynczy składnik zamiast całego posiłku. " +
        "Suma z pól głównych i tak decyduje o podsumowaniu dnia.",
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
          .enum(PEWNOSCI as unknown as [string, ...string[]])
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
            pewnosc: args.pewnosc as never,
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
      title: "Podsumowanie dnia lub tygodnia",
      description:
        "Bez argumentów: bilans dzisiejszego dnia — zjedzone makro, cele, ile zostało oraz lista " +
        "posiłków z identyfikatorami (przydatne do poprawek).\n" +
        'Z okres="tydzien": raport zamkniętego tygodnia (niedziela–sobota) z dietą, wagą, treningiem ' +
        "i porównaniem do tygodnia wcześniej. Raporty powstają same w niedzielę o 9:00; bez podanej " +
        "daty zwracany jest najnowszy.\n" +
        "Parametr „komentarz” zapisuje Twoją interpretację przy raporcie — użytkownik zobaczy ją " +
        "w aplikacji obok liczb. W zadaniu cyklicznym rób to w dwóch krokach: najpierw odczytaj " +
        "raport bez „komentarz”, napisz użytkownikowi podsumowanie, a dopiero potem zapisz je " +
        "drugim wywołaniem z „komentarz”.",
      inputSchema: {
        okres: z
          .enum(["dzien", "tydzien"])
          .optional()
          .describe("Pomiń albo podaj „dzien”, żeby zobaczyć dobę; „tydzien” daje raport tygodniowy."),
        data: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD. Przy tygodniu wystarczy dowolny jego dzień — zostanie dopasowany do raportu.",
          ),
        komentarz: z
          .string()
          .optional()
          .describe('Komentarz do raportu tygodnia. Wymaga okres="tydzien".'),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        if (args.okres !== "tydzien") {
          if (args.komentarz) {
            throw new BladDomeny(
              'Komentarz da się dopisać tylko do raportu tygodnia — dodaj okres="tydzien".',
              "komentarz_bez_tygodnia",
            );
          }
          return podsumowanieWTekscie(podsumowanieDnia(db, args.data, { strefa }));
        }

        // Odczyt dogenerowuje zaległości — raport jest gotowy w chwili, gdy
        // ktoś po niego sięga, nawet jeśli serwer stał przez weekend.
        zapewnijRaporty(db, { strefa });

        if (args.komentarz) {
          const wskazany = args.data ?? raport(db)?.tydzien_od;
          if (!wskazany) {
            throw new BladDomeny(
              "Nie ma jeszcze żadnego raportu tygodniowego, więc nie ma czego komentować.",
              "brak_raportu",
            );
          }
          const zapisany = dopiszKomentarz(db, wskazany, args.komentarz, { strefa });
          return `Komentarz zapisany przy raporcie ${zapisany.tydzien_od} – ${zapisany.tydzien_do}.`;
        }

        const znaleziony = raport(db, args.data);
        return znaleziony
          ? raportWTekscie(znaleziony)
          : "Nie ma jeszcze raportu za ten tydzień. Pierwszy powstaje w niedzielę o 9:00, " +
              "po zamknięciu pełnego tygodnia niedziela–sobota.";
      }),
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
      title: "Zarządzaj planami treningowymi",
      description:
        "Podgląd i edycja planów treningowych. Planów może być wiele, ale tylko JEDEN jest " +
        "domyślny — to on definiuje harmonogram tygodnia i to jego dzień aplikacja podpowiada " +
        "po wejściu w zakładkę Trening. Pozostałe czekają jako szablony do odpalenia z ręki.\n\n" +
        "• akcja='pokaz' — wyświetla wszystkie plany z dniami.\n" +
        "• akcja='zapisz_plan' — tworzy lub NADPISUJE cały plan wraz z dniami (pole dni). " +
        "Dni pominięte w nowej wersji znikają z planu, ale ich historia zostaje.\n" +
        "• akcja='ustaw_domyslny' — przestawia, który plan rządzi harmonogramem.\n" +
        "• akcja='zapisz_dzien' — tworzy lub NADPISUJE pojedynczy dzień wraz z listą ćwiczeń. " +
        "Podawaj zawsze pełną listę ćwiczeń tego dnia, bo poprzednia jest zastępowana.\n" +
        "• akcja='usun_dzien' — usuwa dzień o podanym kodzie.\n\n" +
        "Pole plan wskazuje, o który plan chodzi; pominięte oznacza plan domyślny. Kod dnia " +
        "musi być unikalny w obrębie planu, ale różne plany mogą mieć własne „A”.\n" +
        "dzien_tygodnia (1 = poniedziałek … 7 = niedziela) buduje stały harmonogram.",
      inputSchema: {
        akcja: z.enum(["pokaz", "zapisz_plan", "ustaw_domyslny", "zapisz_dzien", "usun_dzien"]),
        plan: z.string().optional().describe("Nazwa planu, np. „PPL”. Pominięta — plan domyślny."),
        opis: z.string().optional().describe("Jednozdaniowy opis planu, np. „redukcja, 4 dni”"),
        domyslny: z
          .boolean()
          .optional()
          .describe("Przy zapisz_plan: czy plan ma od razu przejąć harmonogram."),
        kod: z.string().optional().describe("Krótki identyfikator dnia, np. „A”, „push”"),
        nazwa: z.string().optional().describe("Nazwa opisowa dnia, np. „Nogi i klatka”"),
        dzien_tygodnia: z.number().int().min(1).max(7).nullable().optional(),
        cwiczenia: z.array(SCHEMAT_CWICZENIA_W_PLANIE).optional(),
        dni: z
          .array(
            z.object({
              kod: z.string(),
              nazwa: z.string().optional(),
              dzien_tygodnia: z.number().int().min(1).max(7).nullable().optional(),
              cwiczenia: z.array(SCHEMAT_CWICZENIA_W_PLANIE).optional(),
            }),
          )
          .optional()
          .describe("Tylko przy zapisz_plan: komplet dni tego planu."),
      },
    },
    async (args) =>
      zBezpiecznikiem(() => {
        if (args.akcja === "pokaz") return planyWTekscie(plany(db));

        if (args.akcja === "ustaw_domyslny") {
          if (!args.plan) return "Podaj nazwę planu (pole plan).";
          const plan = ustawPlanDomyslny(db, args.plan);
          return `Plan „${plan.nazwa}” rządzi teraz harmonogramem.\n\n${planyWTekscie([plan])}`;
        }

        if (args.akcja === "zapisz_plan") {
          if (!args.plan) return "Podaj nazwę planu (pole plan).";
          const plan = zapiszPlan(db, {
            nazwa: args.plan,
            opis: args.opis ?? null,
            domyslny: args.domyslny ?? false,
            dni: (args.dni ?? []).map((d) => ({
              kod: d.kod,
              nazwa: d.nazwa ?? d.kod,
              dzien_tygodnia: d.dzien_tygodnia ?? null,
              cwiczenia: (d.cwiczenia ?? []) as never,
            })),
          });
          return `Zapisano plan:\n\n${planyWTekscie([plan])}`;
        }

        if (!args.kod) {
          return "Podaj kod dnia planu (pole kod).";
        }

        if (args.akcja === "usun_dzien") {
          return usunDzienPlanu(db, args.kod, args.plan)
            ? `Usunięto dzień ${args.kod} z planu.`
            : `Nie znaleziono dnia o kodzie ${args.kod}.`;
        }

        const dzien = dodajDzienPlanu(db, {
          kod: args.kod,
          nazwa: args.nazwa ?? args.kod,
          plan: args.plan,
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

  /** „(2/4)" wg celu z planu albo „(2. seria)", gdy planu nie ma. */
  const licznikSerii = (postep?: PostepCwiczenia): string =>
    postep?.serie_cel
      ? ` (${postep.serie_zrobione}/${postep.serie_cel})`
      : ` (${postep?.serie_zrobione ?? 1}. seria)`;

  const zostalo = (nazwy: string[]): string =>
    nazwy.length > 0 ? `Zostało: ${nazwy.join(", ")}` : "Plan wykonany.";

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
        "lub ćwiczeniu izometrycznym podaj typ. Ćwiczenie już znane zachowuje swój typ.\n\n" +
        "ile_serii odhacza całe ćwiczenie naraz — „zrobiłem wszystkie serie z założonym " +
        "obciążeniem”. Wynik bierze się wtedy z planu albo z poprzedniego treningu, " +
        "a pozostałe pola wyniku są pomijane.",
      inputSchema: {
        cwiczenie: z.string().describe("Nazwa ćwiczenia, wielkość liter bez znaczenia"),
        ile_serii: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Odhacza tyle serii naraz, zamiast zapisywać jedną z podanym wynikiem."),
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
        if (args.ile_serii != null) {
          const stan = odhaczCwiczenie(
            db,
            { cwiczenie: args.cwiczenie, ile: args.ile_serii },
            { strefa, ts: czas(args.czas) },
          );
          const szukana = args.cwiczenie.trim().toLowerCase();
          const postep = [...stan.wg_planu, ...stan.poza_planem].find(
            (c) => c.nazwa.toLowerCase() === szukana,
          );
          const ostatnia = postep?.serie.at(-1);

          return (
            `${postep?.nazwa ?? args.cwiczenie}: odhaczone ${args.ile_serii} ×` +
            `${ostatnia ? ` ${seriaWTekscie(ostatnia)}` : ""}${licznikSerii(postep)}\n` +
            zostalo(stan.pozostalo)
          );
        }

        const seria = zapiszSerie(
          db,
          { ...args, typ: args.typ as never, ts: czas(args.czas) },
          { strefa },
        );
        const stan = stanTreningu(db);
        const postep = [...stan.wg_planu, ...stan.poza_planem].find(
          (c) => c.cwiczenie_id === seria.cwiczenie_id,
        );

        const ostrzezenie = postep?.slabsze_niz_poprzednio.includes(seria.nr_serii)
          ? "  ⚠ słabiej niż poprzednio"
          : "";
        const rekord = postep?.rekordy.includes(seria.nr_serii) ? "  ★ rekord" : "";

        return (
          `${seria.nazwa}: ${seriaWTekscie(seria)}${licznikSerii(postep)}${ostrzezenie}${rekord}\n` +
          zostalo(stan.pozostalo)
        );
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
            pewnosc: z.enum(PEWNOSCI as unknown as [string, ...string[]]).optional(),
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

