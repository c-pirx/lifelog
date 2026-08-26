import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import { podsumowanieDnia, ustawCele, zapiszPosilek } from "../src/domain/diet.js";
import { zmienWpis } from "../src/domain/edits.js";
import { ostatniaWaga, trendWagi, zapiszWage } from "../src/domain/metrics.js";
import {
  dodajDzienPlanu,
  rozpocznijTrening,
  stanTreningu,
  zapiszSerie,
} from "../src/domain/workouts.js";

/** Stała data odniesienia — bez niej testy trendu zaczęłyby padać po 90 dniach. */
const DO_DNIA = { do: "2026-08-25" };

let db: Baza;

beforeEach(() => {
  db = otworzBaze({ sciezka: ":memory:" });
});

describe("pomiary wagi", () => {
  it("zapisuje pomiar", () => {
    const waga = zapiszWage(db, 81.4, { ts: "2026-08-25T06:00:00.000Z" });

    expect(waga.kg).toBe(81.4);
    expect(waga.data_lokalna).toBe("2026-08-25");
  });

  it("drugi pomiar tego samego dnia nadpisuje pierwszy", () => {
    zapiszWage(db, 81.4, { ts: "2026-08-25T06:00:00.000Z" });
    zapiszWage(db, 81.9, { ts: "2026-08-25T18:00:00.000Z" });

    const trend = trendWagi(db, 90, DO_DNIA);
    expect(trend).toHaveLength(1);
    expect(trend[0]?.kg).toBe(81.9);
  });

  it("odrzuca wartość spoza sensownego zakresu", () => {
    expect(() => zapiszWage(db, 0)).toThrow(/zakres/i);
    expect(() => zapiszWage(db, 900)).toThrow(/zakres/i);
  });

  it("liczy średnią kroczącą z okna 7 dni", () => {
    zapiszWage(db, 80, { ts: "2026-08-23T06:00:00.000Z" });
    zapiszWage(db, 82, { ts: "2026-08-24T06:00:00.000Z" });
    zapiszWage(db, 81, { ts: "2026-08-25T06:00:00.000Z" });

    const trend = trendWagi(db, 90, DO_DNIA);

    expect(trend[0]?.srednia_7d).toBe(80);
    expect(trend[1]?.srednia_7d).toBe(81);
    expect(trend[2]?.srednia_7d).toBe(81);
  });

  it("nie wciąga do średniej pomiarów starszych niż okno", () => {
    zapiszWage(db, 90, { ts: "2026-08-01T06:00:00.000Z" });
    zapiszWage(db, 80, { ts: "2026-08-25T06:00:00.000Z" });

    expect(trendWagi(db, 90, DO_DNIA).at(-1)?.srednia_7d).toBe(80);
  });

  it("zwraca ostatni pomiar", () => {
    zapiszWage(db, 80, { ts: "2026-08-20T06:00:00.000Z" });
    zapiszWage(db, 81, { ts: "2026-08-25T06:00:00.000Z" });

    expect(ostatniaWaga(db)?.kg).toBe(81);
  });
});

describe("poprawianie posiłku", () => {
  beforeEach(() => {
    ustawCele(db, { kcal: 2400, bialko_g: 180, wegle_g: 250, tluszcz_g: 80, obowiazuje_od: "2026-08-01" });
  });

  it("zmienia kalorie i przelicza sumę dnia", () => {
    const posilek = zapiszPosilek(db, {
      opis: "obiad",
      kcal: 700,
      ts: "2026-08-25T12:00:00.000Z",
    });

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: { kcal: 900 } });

    expect(podsumowanieDnia(db, "2026-08-25").spozyte.kcal).toBe(900);
  });

  it("nie rusza pól, których nie podano", () => {
    const posilek = zapiszPosilek(db, {
      opis: "obiad",
      kcal: 700,
      bialko_g: 45,
      ts: "2026-08-25T12:00:00.000Z",
    });

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: { kcal: 900 } });

    const poprawiony = podsumowanieDnia(db, "2026-08-25").posilki[0];
    expect(poprawiony?.bialko_g).toBe(45);
    expect(poprawiony?.opis).toBe("obiad");
  });

  it("pozwala oznaczyć szacunek jako potwierdzony", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-25T12:00:00.000Z" });
    expect(posilek.pewnosc).toBe("szacowane");

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: { kcal: 720, pewnosc: "dokladne" },
    });

    expect(podsumowanieDnia(db, "2026-08-25").ile_szacowanych).toBe(0);
  });

  it("odrzuca nieznaną porę", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-25T12:00:00.000Z" });

    expect(() =>
      zmienWpis(db, {
        typ: "posilek",
        id: posilek.id,
        akcja: "popraw",
        // Celowo wartość spoza dozwolonych — sprawdzamy walidację wejścia.
        dane: { pora: "drugie sniadanie" as never },
      }),
    ).toThrow(/pora/i);
  });

  it("odrzuca poprawkę bez żadnych zmian", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-25T12:00:00.000Z" });

    expect(() =>
      zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: {} }),
    ).toThrow(/zmian/i);
  });
});

describe("edycja pozycji posiłku", () => {
  const zapiszZlozony = () =>
    zapiszPosilek(db, {
      opis: "śniadanie",
      kcal: 500,
      bialko_g: 30,
      ts: "2026-08-25T06:00:00.000Z",
      pozycje: [
        { nazwa: "jajko", kcal: 150, bialko_g: 13 },
        { nazwa: "bułka", kcal: 200, bialko_g: 7 },
      ],
    });

  it("zastępuje całe rozbicie nową listą", () => {
    const posilek = zapiszZlozony();

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: { pozycje: [{ nazwa: "owsianka" }] },
    });

    const po = podsumowanieDnia(db, "2026-08-25").posilki[0];
    expect(po?.pozycje.map((p) => p.nazwa)).toEqual(["owsianka"]);
  });

  it("przelicza nagłówek z sumy pozycji, gdy każda zna dane pole", () => {
    const posilek = zapiszZlozony();

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: {
        pozycje: [
          { nazwa: "jajko", kcal: 150, bialko_g: 13 },
          { nazwa: "bułka", kcal: 200, bialko_g: 7 },
          { nazwa: "ser cheddar", kcal: 120, bialko_g: 8 },
        ],
      },
    });

    const po = podsumowanieDnia(db, "2026-08-25").posilki[0];
    expect(po?.kcal).toBe(470);
    expect(po?.bialko_g).toBe(28);
  });

  it("pole podane jawnie wygrywa z auto-sumą", () => {
    const posilek = zapiszZlozony();

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: {
        kcal: 600,
        pozycje: [
          { nazwa: "jajko", kcal: 150, bialko_g: 13 },
          { nazwa: "bułka", kcal: 200, bialko_g: 7 },
        ],
      },
    });

    const po = podsumowanieDnia(db, "2026-08-25").posilki[0];
    expect(po?.kcal).toBe(600);
    expect(po?.bialko_g).toBe(20);
  });

  it("liczy per pole — pozycja bez białka zostawia białko nagłówka w spokoju", () => {
    const posilek = zapiszZlozony();

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: {
        pozycje: [
          { nazwa: "jajko", kcal: 150 },
          { nazwa: "bułka", kcal: 200, bialko_g: 7 },
        ],
      },
    });

    const po = podsumowanieDnia(db, "2026-08-25").posilki[0];
    expect(po?.kcal).toBe(350);
    expect(po?.bialko_g).toBe(30);
  });

  it("pusta lista czyści rozbicie i nie tyka nagłówka", () => {
    const posilek = zapiszZlozony();

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: { pozycje: [] } });

    const po = podsumowanieDnia(db, "2026-08-25").posilki[0];
    expect(po?.pozycje).toEqual([]);
    expect(po?.kcal).toBe(500);
  });

  it("przeliczenie nie zmienia pewności — to arytmetyka, nie nowa wiedza", () => {
    const posilek = zapiszZlozony();
    expect(posilek.pewnosc).toBe("szacowane");

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: { pozycje: [{ nazwa: "jajko", kcal: 150, bialko_g: 13, wegle_g: 1, tluszcz_g: 10 }] },
    });

    expect(podsumowanieDnia(db, "2026-08-25").posilki[0]?.pewnosc).toBe("szacowane");
  });

  it("odrzuca pozycję bez nazwy i z ujemnym makro", () => {
    const posilek = zapiszZlozony();

    expect(() =>
      zmienWpis(db, {
        typ: "posilek",
        id: posilek.id,
        akcja: "popraw",
        dane: { pozycje: [{ nazwa: "" }] },
      }),
    ).toThrow(/nazw/i);

    expect(() =>
      zmienWpis(db, {
        typ: "posilek",
        id: posilek.id,
        akcja: "popraw",
        dane: { pozycje: [{ nazwa: "jajko", kcal: -150 }] },
      }),
    ).toThrow(/zakres/i);
  });
});

describe("poprawianie godziny posiłku", () => {
  it("goła godzina zostaje w dniu wpisu, nie przeskakuje na dzisiaj", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-20T12:00:00.000Z" });

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: { czas: "14:30" } });

    const po = podsumowanieDnia(db, "2026-08-20").posilki[0];
    expect(po?.godzina).toBe("14:30");
    expect(po?.data_lokalna).toBe("2026-08-20");
  });

  it("pełna data przenosi wpis do innego dnia", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-20T12:00:00.000Z" });

    zmienWpis(db, {
      typ: "posilek",
      id: posilek.id,
      akcja: "popraw",
      dane: { czas: "2026-08-21 09:00" },
    });

    expect(podsumowanieDnia(db, "2026-08-20").posilki).toEqual([]);
    expect(podsumowanieDnia(db, "2026-08-21").posilki[0]?.godzina).toBe("09:00");
  });

  it("wieczorna godzina przy granicy doby nie zmienia dnia lokalnego", () => {
    // 23:30 czasu polskiego to 21:30 UTC — data lokalna musi zostać sierpniowa 20-go.
    const posilek = zapiszPosilek(db, { opis: "kolacja", kcal: 400, ts: "2026-08-20T17:00:00.000Z" });

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: { czas: "23:30" } });

    const po = podsumowanieDnia(db, "2026-08-20").posilki[0];
    expect(po?.data_lokalna).toBe("2026-08-20");
    expect(po?.godzina).toBe("23:30");
  });

  it("odrzuca nierozpoznawalny czas", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-20T12:00:00.000Z" });

    expect(() =>
      zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "popraw", dane: { czas: "wczoraj" } }),
    ).toThrow(/czas/i);
  });
});

describe("usuwanie posiłku", () => {
  it("znika z podsumowania dnia", () => {
    const posilek = zapiszPosilek(db, { opis: "obiad", kcal: 700, ts: "2026-08-25T12:00:00.000Z" });

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "usun" });

    expect(podsumowanieDnia(db, "2026-08-25").posilki).toEqual([]);
    expect(podsumowanieDnia(db, "2026-08-25").spozyte.kcal).toBe(0);
  });

  it("zabiera ze sobą pozycje składowe", () => {
    const posilek = zapiszPosilek(db, {
      opis: "obiad",
      kcal: 700,
      ts: "2026-08-25T12:00:00.000Z",
      pozycje: [{ nazwa: "ryż", ilosc_g: 100 }],
    });

    zmienWpis(db, { typ: "posilek", id: posilek.id, akcja: "usun" });

    const ile = db
      .prepare<[], { ile: number }>("SELECT COUNT(*) AS ile FROM pozycje_posilku")
      .get()?.ile;
    expect(ile).toBe(0);
  });
});

describe("poprawianie serii", () => {
  beforeEach(() => {
    dodajDzienPlanu(db, {
      kod: "A",
      nazwa: "Nogi",
      dzien_tygodnia: 1,
      cwiczenia: [{ nazwa: "przysiad", typ: "silowe", serie_cel: 3, powt_cel: "5" }],
    });
    rozpocznijTrening(db, { kod: "A", ts: "2026-08-24T09:00:00.000Z" });
  });

  it("zmienia ciężar w zapisanej serii", () => {
    const seria = zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });

    zmienWpis(db, { typ: "seria", id: seria.id, akcja: "popraw", dane: { ciezar_kg: 105 } });

    const stan = stanTreningu(db).wg_planu[0];
    expect(stan?.serie[0]?.ciezar_kg).toBe(105);
    expect(stan?.serie[0]?.powtorzenia).toBe(5);
  });

  it("usunięcie serii cofa postęp ćwiczenia", () => {
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });
    const trzecia = zapiszSerie(db, { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 });

    expect(stanTreningu(db).wg_planu[0]?.ukonczone).toBe(true);

    zmienWpis(db, { typ: "seria", id: trzecia.id, akcja: "usun" });

    const stan = stanTreningu(db).wg_planu[0];
    expect(stan?.serie_zrobione).toBe(2);
    expect(stan?.ukonczone).toBe(false);
  });
});

describe("poprawianie wagi", () => {
  it("zmienia wartość pomiaru", () => {
    const waga = zapiszWage(db, 81.4, { ts: "2026-08-25T06:00:00.000Z" });

    zmienWpis(db, { typ: "waga", id: waga.id, akcja: "popraw", dane: { kg: 80.9 } });

    expect(trendWagi(db, 90, DO_DNIA)[0]?.kg).toBe(80.9);
  });

  it("odrzuca absurdalną wartość", () => {
    const waga = zapiszWage(db, 81.4, { ts: "2026-08-25T06:00:00.000Z" });

    expect(() =>
      zmienWpis(db, { typ: "waga", id: waga.id, akcja: "popraw", dane: { kg: 812 } }),
    ).toThrow(/zakres/i);
  });
});

describe("odporność na złe wejście", () => {
  it("zgłasza brak wpisu o podanym id", () => {
    expect(() => zmienWpis(db, { typ: "posilek", id: 999, akcja: "usun" })).toThrow(
      /nie znaleziono/i,
    );
  });

  it("zgłasza nieznany typ wpisu", () => {
    expect(() => zmienWpis(db, { typ: "trening" as never, id: 1, akcja: "usun" })).toThrow(
      /nieznany typ/i,
    );
  });
});
