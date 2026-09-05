import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import {
  oznaczWyslane,
  subskrypcjeUzytkownika,
  usunSubskrypcje,
  uzytkownikPoId,
  wyslaneDzis,
  zapiszSubskrypcje,
} from "../src/db/rejestr.js";
import { ustawCele, zapiszPosilek } from "../src/domain/diet.js";
import { utworzKonto } from "../src/domain/konta.js";
import {
  odczytajRodzaje,
  powiadomieniaNaTeraz,
  zapiszRodzaje,
  type RodzajPowiadomienia,
} from "../src/domain/powiadomienia.js";
import {
  dodajDzienPlanu,
  rozpocznijTrening,
  zakonczTrening,
  zapiszSerie,
} from "../src/domain/workouts.js";

let db: Baza;

beforeEach(() => {
  db = otworzBaze({ sciezka: ":memory:" });
});

/**
 * Testy stoją w UTC, żeby godzina w znaczniku była wprost godziną, którą czyta
 * reguła. Przesunięcie strefy sprawdza osobny przypadek na końcu pliku.
 */
const STREFA = "UTC";

const MIGRACJE_REJESTRU = fileURLToPath(new URL("../migrations-rejestr/", import.meta.url));

/** Poniedziałek — dzień, na który zaplanowany jest dzień A. */
const PONIEDZIALEK = "2026-08-17";

/** Chwila o podanej godzinie poniedziałku. */
const o = (godzina: number): string =>
  `${PONIEDZIALEK}T${String(godzina).padStart(2, "0")}:00:00.000Z`;

const WSZYSTKIE: RodzajPowiadomienia[] = ["trening_rano", "trening_wieczor", "kalorie"];

const CELE = { kcal: 2800, bialko_g: 180, wegle_g: 300, tluszcz_g: 90 };

function sprawdz(teraz: string, nadpisz: Partial<Parameters<typeof powiadomieniaNaTeraz>[1]> = {}) {
  return powiadomieniaNaTeraz(db, {
    teraz,
    strefa: STREFA,
    wlaczone: WSZYSTKIE,
    juzWyslane: [],
    ...nadpisz,
  });
}

const rodzaje = (teraz: string): string[] => sprawdz(teraz).map((p) => p.rodzaj);

/** Dzień A na poniedziałek. Plan założony tą drogą staje się domyślny. */
function planA() {
  return dodajDzienPlanu(db, {
    kod: "A",
    nazwa: "Nogi i klatka",
    dzien_tygodnia: 1,
    cwiczenia: [{ nazwa: "przysiad", typ: "silowe", serie_cel: 5, powt_cel: "5" }],
  });
}

/** Rozegrany i zamknięty trening dnia A — pusta sesja nie liczy się jako realizacja. */
function odbytyTrening(ts: string) {
  rozpocznijTrening(db, { kod: "A", ts, strefa: STREFA });
  zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100, ts }, { strefa: STREFA });
  zakonczTrening(db, { ts, strefa: STREFA });
}

function zjedzone(kcalRazem: number, ts: string) {
  zapiszPosilek(db, { opis: "posiłki dnia", kcal: kcalRazem, ts }, { strefa: STREFA });
}

describe("przypomnienie o treningu", () => {
  it("rano w dzień z planu, którego jeszcze nie zrobiono", () => {
    planA();

    const [powiadomienie] = sprawdz(o(9));

    expect(powiadomienie?.rodzaj).toBe("trening_rano");
    expect(powiadomienie?.tresc).toContain("Dzień A");
    expect(powiadomienie?.tresc).toContain("Nogi i klatka");
    expect(powiadomienie?.ekran).toBe("trening");
  });

  it("milknie, gdy trening został odhaczony", () => {
    planA();
    odbytyTrening(o(7));

    expect(rodzaje(o(9))).toEqual([]);
    expect(rodzaje(o(21))).toEqual([]);
  });

  it("otwarta sesja bez serii jeszcze nie gasi przypomnienia", () => {
    // Sesja otwarta i zamknięta bez ani jednej serii to ślad po pomyłce,
    // a nie odbyty trening — `historiaSesji` też jej nie pokazuje.
    planA();
    rozpocznijTrening(db, { kod: "A", ts: o(7), strefa: STREFA });
    zakonczTrening(db, { ts: o(8), strefa: STREFA });

    expect(rodzaje(o(9))).toEqual(["trening_rano"]);
  });

  it("w dzień wolny nie odzywa się wcale", () => {
    planA();

    // Wtorek — plan nie przewiduje dnia.
    expect(rodzaje("2026-08-18T09:00:00.000Z")).toEqual([]);
  });

  it("bez planu treningowego nie ma o czym przypominać", () => {
    expect(rodzaje(o(9))).toEqual([]);
  });

  it("przed ósmą milczy", () => {
    planA();

    expect(rodzaje(o(7))).toEqual([]);
  });

  it("wieczorem mówi o ostatniej szansie", () => {
    planA();

    const [powiadomienie] = sprawdz(o(21));

    expect(powiadomienie?.rodzaj).toBe("trening_wieczor");
    expect(powiadomienie?.tytul).toContain("Ostatnia szansa");
  });

  it("o 20:05 wychodzi TYLKO wieczorne, nie dwa naraz", () => {
    // Telefon włączony pierwszy raz po dwudziestej spełnia oba warunki naraz.
    // Dwa powiadomienia o tej samej sprawie to dokładnie ten szum, po którym
    // użytkownik wycisza kanał — a wtedy traci też przypomnienie o kaloriach.
    planA();

    expect(rodzaje("2026-08-17T20:05:00.000Z")).toEqual(["trening_wieczor"]);
  });
});

describe("przypomnienie o kaloriach", () => {
  it("przy budowaniu masy odzywa się poniżej progu", () => {
    ustawCele(db, { ...CELE, tryb: "masa", obowiazuje_od: "2026-08-01" });
    zjedzone(1500, o(14));

    const [powiadomienie] = sprawdz(o(18));

    expect(powiadomienie?.rodzaj).toBe("kalorie");
    expect(powiadomienie?.tresc).toContain("1500 z 2800");
    expect(powiadomienie?.tresc).toContain("1300");
    expect(powiadomienie?.ekran).toBe("dzis");
  });

  it("przy budowaniu masy milknie po dojedzeniu do progu", () => {
    ustawCele(db, { ...CELE, tryb: "masa", obowiazuje_od: "2026-08-01" });
    zjedzone(1700, o(14)); // 60,7 % celu

    expect(rodzaje(o(18))).toEqual([]);
  });

  it("przy budowaniu masy nie ostrzega przed zjedzeniem za dużo", () => {
    ustawCele(db, { ...CELE, tryb: "masa", obowiazuje_od: "2026-08-01" });
    zjedzone(2700, o(14));

    expect(rodzaje(o(18))).toEqual([]);
  });

  it("przy redukcji ostrzega powyżej progu", () => {
    ustawCele(db, { ...CELE, tryb: "redukcja", obowiazuje_od: "2026-08-01" });
    zjedzone(2500, o(14)); // 89,3 % celu

    const [powiadomienie] = sprawdz(o(18));

    expect(powiadomienie?.rodzaj).toBe("kalorie");
    expect(powiadomienie?.tresc).toContain("300");
  });

  it("przy redukcji nie popędza do jedzenia", () => {
    ustawCele(db, { ...CELE, tryb: "redukcja", obowiazuje_od: "2026-08-01" });
    zjedzone(1500, o(14));

    expect(rodzaje(o(18))).toEqual([]);
  });

  it("na utrzymaniu pilnuje obu stron", () => {
    ustawCele(db, { ...CELE, tryb: "utrzymanie", obowiazuje_od: "2026-08-01" });
    zjedzone(1000, o(14));

    expect(rodzaje(o(18))).toEqual(["kalorie"]);
  });

  it("bez ustawionych celów nie ma z czym porównywać", () => {
    zjedzone(500, o(14));

    expect(rodzaje(o(18))).toEqual([]);
  });

  it("przed osiemnastą milczy", () => {
    ustawCele(db, { ...CELE, tryb: "masa", obowiazuje_od: "2026-08-01" });
    zjedzone(500, o(14));

    expect(rodzaje(o(17))).toEqual([]);
  });
});

describe("przełączniki i ślad wysyłki", () => {
  it("wyłączony rodzaj nie wychodzi", () => {
    planA();

    expect(sprawdz(o(9), { wlaczone: ["kalorie"] })).toEqual([]);
  });

  it("rodzaj wysłany dziś nie wraca po raz drugi", () => {
    planA();

    expect(sprawdz(o(9), { juzWyslane: ["trening_rano"] })).toEqual([]);
  });

  it("ślad jednego rodzaju nie zatrzymuje pozostałych", () => {
    planA();
    ustawCele(db, { ...CELE, tryb: "masa", obowiazuje_od: "2026-08-01" });
    zjedzone(800, o(14));

    expect(sprawdz(o(19), { juzWyslane: ["trening_rano"] }).map((p) => p.rodzaj)).toEqual([
      "kalorie",
    ]);
  });
});

describe("strefa użytkownika", () => {
  it("godzinę czyta ze strefy konta, nie z zegara serwera", () => {
    planA();

    const dla = (chwila: string, strefa: string) =>
      powiadomieniaNaTeraz(db, {
        teraz: chwila,
        strefa,
        wlaczone: WSZYSTKIE,
        juzWyslane: [],
      }).map((p) => p.rodzaj);

    // 06:00 UTC to jeszcze noc w Londynie, ale już ósma rano w Warszawie.
    expect(dla("2026-08-17T06:00:00.000Z", "UTC")).toEqual([]);
    expect(dla("2026-08-17T06:00:00.000Z", "Europe/Warsaw")).toEqual(["trening_rano"]);

    // 08:00 UTC to poranek w Londynie i dwudziesta w Auckland — ta sama chwila,
    // dwa różne powiadomienia.
    expect(dla("2026-08-17T08:00:00.000Z", "UTC")).toEqual(["trening_rano"]);
    expect(dla("2026-08-17T08:00:00.000Z", "Pacific/Auckland")).toEqual(["trening_wieczor"]);
  });
});

describe("subskrypcje i ślad wysyłki w rejestrze", () => {
  let rejestr: Baza;
  let ania: number;
  let tomek: number;

  const SUBSKRYPCJA = {
    endpoint: "https://push.example/abc",
    p256dh: "klucz-publiczny",
    auth: "sekret",
    utworzono: "2026-08-17T06:00:00.000Z",
  };

  beforeEach(() => {
    rejestr = otworzBaze({ sciezka: ":memory:", katalogMigracji: MIGRACJE_REJESTRU });
    ania = utworzKonto(rejestr, { login: "ania", haslo: "haslo-testowe-1", zgoda: true }).id;
    tomek = utworzKonto(rejestr, { login: "tomek", haslo: "haslo-testowe-2", zgoda: true }).id;
  });

  it("nowe konto ma powiadomienia wyłączone", () => {
    expect(uzytkownikPoId(rejestr, ania)?.powiadomienia).toBe("");
  });

  it("ten sam endpoint zapisany po raz drugi nie mnoży wierszy, tylko odświeża klucze", () => {
    zapiszSubskrypcje(rejestr, { ...SUBSKRYPCJA, uzytkownik_id: ania });
    zapiszSubskrypcje(rejestr, { ...SUBSKRYPCJA, uzytkownik_id: ania, p256dh: "nowy-klucz" });

    const jej = subskrypcjeUzytkownika(rejestr, ania);

    expect(jej).toHaveLength(1);
    expect(jej[0]?.p256dh).toBe("nowy-klucz");
  });

  it("jeden telefon przepięty na drugie konto przestaje dostawać powiadomienia pierwszego", () => {
    // Domownicy dzielący telefon to zwyczajny przypadek, nie egzotyka. Bez
    // przepięcia `uzytkownik_id` Tomek dostawałby powiadomienia Ani.
    zapiszSubskrypcje(rejestr, { ...SUBSKRYPCJA, uzytkownik_id: ania });
    zapiszSubskrypcje(rejestr, { ...SUBSKRYPCJA, uzytkownik_id: tomek });

    expect(subskrypcjeUzytkownika(rejestr, ania)).toEqual([]);
    expect(subskrypcjeUzytkownika(rejestr, tomek)).toHaveLength(1);
  });

  it("ślad stawia się raz na dobę i rodzaj", () => {
    const znacz = () =>
      oznaczWyslane(rejestr, {
        uzytkownik_id: ania,
        data_lokalna: PONIEDZIALEK,
        rodzaj: "kalorie",
        wyslano: o(18),
      });

    expect(znacz()).toBe(true);
    expect(znacz()).toBe(false);
    expect(wyslaneDzis(rejestr, ania, PONIEDZIALEK)).toEqual(["kalorie"]);
  });

  it("ślad jednego konta nie zasłania drugiego ani innego dnia", () => {
    oznaczWyslane(rejestr, {
      uzytkownik_id: ania,
      data_lokalna: PONIEDZIALEK,
      rodzaj: "kalorie",
      wyslano: o(18),
    });

    expect(wyslaneDzis(rejestr, tomek, PONIEDZIALEK)).toEqual([]);
    expect(wyslaneDzis(rejestr, ania, "2026-08-18")).toEqual([]);
  });

  it("usunięcie subskrypcji zdejmuje ją tylko właścicielowi", () => {
    zapiszSubskrypcje(rejestr, { ...SUBSKRYPCJA, uzytkownik_id: ania });
    zapiszSubskrypcje(rejestr, {
      ...SUBSKRYPCJA,
      endpoint: "https://push.example/xyz",
      uzytkownik_id: tomek,
    });

    const jej = subskrypcjeUzytkownika(rejestr, ania);
    usunSubskrypcje(rejestr, jej[0]!.id);

    expect(subskrypcjeUzytkownika(rejestr, ania)).toEqual([]);
    expect(subskrypcjeUzytkownika(rejestr, tomek)).toHaveLength(1);
  });
});

describe("zapis rodzajów w rejestrze", () => {
  it("pusty zapis znaczy ciszę", () => {
    expect(odczytajRodzaje("")).toEqual([]);
  });

  it("czyta listę po przecinku i znosi spacje", () => {
    expect(odczytajRodzaje("trening_rano, kalorie")).toEqual(["trening_rano", "kalorie"]);
  });

  it("odsiewa nazwy, których nie zna", () => {
    // Stara wersja kodu spotykająca rodzaj dodany później — ma go pominąć,
    // a nie wywrócić się przy odczycie konta.
    expect(odczytajRodzaje("kalorie,waga_rano")).toEqual(["kalorie"]);
  });

  it("zapisuje w stałej kolejności, niezależnie od kolejności wejścia", () => {
    expect(zapiszRodzaje(["kalorie", "trening_rano"])).toBe("trening_rano,kalorie");
  });

  it("zapis i odczyt są swoją odwrotnością", () => {
    expect(odczytajRodzaje(zapiszRodzaje(WSZYSTKIE))).toEqual(WSZYSTKIE);
  });
});
