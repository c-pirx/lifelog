/**
 * Testy czystej części warstwy offline.
 *
 * Nakładka i polityka błędów kolejki to jedyne kawałki offline'u, które da się
 * sprawdzić bez przeglądarki — reszta (service worker, IndexedDB) wymaga testu
 * ręcznego. Tym bardziej warto objąć testami to, co się da: nakładka decyduje
 * o tym, czy użytkownik bez zasięgu widzi swoją serię, a polityka kolejki
 * o tym, czy jeden odrzucony wpis nie zablokuje wysyłki całego treningu.
 */

import { describe, expect, it } from "vitest";

import { decyzjaKolejki } from "../public/kolejka.js";
import { nalozNaDzien, nalozNaTrening } from "../public/nakladka.js";

/** Południe UTC: ta sama data lokalna w każdej strefie, w której test może biec. */
const CZAS = "2026-08-25T12:05:00.000Z";

function dzienZSerwera() {
  return {
    data: "2026-08-25",
    cele: { kcal: 2600, bialko_g: 180, wegle_g: 280, tluszcz_g: 85 },
    spozyte: { kcal: 500, bialko_g: 30, wegle_g: 50, tluszcz_g: 20 },
    posilki: [
      { id: 1, godzina: "08:15", opis: "owsianka", kcal: 500, bialko_g: 30, wegle_g: 50, tluszcz_g: 20 },
    ],
  };
}

function treningZSerwera() {
  return {
    sesja: { id: 7, dzien_kod: "A", dzien_nazwa: "Nogi", status: "aktywna" },
    wg_planu: [
      {
        cwiczenie_id: 3,
        nazwa: "przysiad",
        typ: "silowe",
        serie_cel: 3,
        powt_cel: "5",
        serie_zrobione: 1,
        serie: [{ id: 11, nr_serii: 1, powtorzenia: 5, ciezar_kg: 100 }],
        poprzednio: [{ id: 9, nr_serii: 1, powtorzenia: 5, ciezar_kg: 105 }],
        slabsze_niz_poprzednio: [1],
        ukonczone: false,
      },
    ],
    poza_planem: [],
    ukonczone_cwiczen: 0,
    wszystkich_cwiczen: 1,
    pozostalo: ["przysiad"],
  };
}

describe("nakładka na podsumowanie dnia", () => {
  it("bez kolejki zwraca stan nietknięty", () => {
    const dzien = dzienZSerwera();

    expect(nalozNaDzien(dzien, [])).toBe(dzien);
  });

  it("dolicza posiłek z kolejki do listy i do sum dnia", () => {
    const wynik = nalozNaDzien(dzienZSerwera(), [
      {
        id: 4,
        sciezka: "/posilki",
        czas_lokalny: CZAS,
        dane: { opis: "kurczak z ryżem", kcal: 700, bialko_g: 60, wegle_g: 70, tluszcz_g: 15 },
      },
    ]);

    expect(wynik.posilki).toHaveLength(2);
    expect(wynik.posilki[1]).toMatchObject({ opis: "kurczak z ryżem", oczekuje: true });
    expect(wynik.spozyte).toEqual({ kcal: 1200, bialko_g: 90, wegle_g: 120, tluszcz_g: 35 });
  });

  it("ukrywa posiłek, którego usunięcie czeka w kolejce", () => {
    const wynik = nalozNaDzien(dzienZSerwera(), [
      { id: 5, sciezka: "/wpis", czas_lokalny: CZAS, dane: { typ: "posilek", id: 1, akcja: "usun" } },
    ]);

    expect(wynik.posilki).toHaveLength(0);
    expect(wynik.spozyte.kcal).toBe(0);
  });

  it("pomija wpisy z innego dnia niż oglądany", () => {
    // Cofnięcie się na wczoraj nie może pokazywać dzisiejszej kolejki.
    const wynik = nalozNaDzien(dzienZSerwera(), [
      { id: 7, sciezka: "/posilki", czas_lokalny: "2026-08-26T12:00:00.000Z", dane: { opis: "jutro", kcal: 900 } },
    ]);

    expect(wynik.posilki).toHaveLength(1);
    expect(wynik.spozyte.kcal).toBe(500);
  });

  it("wpis z własną godziną trafia do dnia, który niesie, a nie do dnia wysyłki", () => {
    const wynik = nalozNaDzien(dzienZSerwera(), [
      {
        id: 8,
        sciezka: "/posilki",
        czas_lokalny: "2026-08-26T09:00:00.000Z",
        dane: { opis: "kolacja z wczoraj", kcal: 400, czas: "2026-08-25 21:30" },
      },
    ]);

    expect(wynik.posilki).toHaveLength(2);
    expect(wynik.posilki[1]).toMatchObject({ opis: "kolacja z wczoraj", godzina: "21:30" });
  });

  it("nie rusza celów — to należy do domeny, nie do nakładki", () => {
    const wynik = nalozNaDzien(dzienZSerwera(), [
      { id: 6, sciezka: "/posilki", czas_lokalny: CZAS, dane: { opis: "baton", kcal: 250 } },
    ]);

    expect(wynik.cele).toEqual(dzienZSerwera().cele);
  });
});

describe("nakładka na stan treningu", () => {
  it("bez kolejki zwraca stan nietknięty", () => {
    const trening = treningZSerwera();

    expect(nalozNaTrening(trening, [])).toBe(trening);
  });

  it("dokłada serię z kolejki do ćwiczenia z planu i podbija licznik", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      {
        id: 8,
        sciezka: "/trening/seria",
        czas_lokalny: CZAS,
        dane: { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 },
      },
    ]);

    const przysiad = wynik.wg_planu[0]!;
    expect(przysiad.serie).toHaveLength(2);
    expect(przysiad.serie[1]).toMatchObject({ nr_serii: 2, oczekuje: true, ciezar_kg: 100 });
    expect(przysiad.serie_zrobione).toBe(2);
  });

  it("nie ocenia, czy seria z kolejki była słabsza niż poprzednio", () => {
    // Ta ocena to reguła domenowa. Powtórzona tutaj rozjechałaby się z serwerem
    // przy pierwszej zmianie definicji „słabszej serii".
    const wynik = nalozNaTrening(treningZSerwera(), [
      {
        id: 9,
        sciezka: "/trening/seria",
        czas_lokalny: CZAS,
        dane: { cwiczenie: "przysiad", powtorzenia: 1, ciezar_kg: 20 },
      },
    ]);

    expect(wynik.wg_planu[0]!.slabsze_niz_poprzednio).toEqual([1]);
  });

  it("nieznane ćwiczenie ląduje poza planem", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      {
        id: 10,
        sciezka: "/trening/seria",
        czas_lokalny: CZAS,
        dane: { cwiczenie: "ergometr", typ: "cardio", czas_s: 600 },
      },
    ]);

    expect(wynik.poza_planem).toHaveLength(1);
    expect(wynik.poza_planem[0]).toMatchObject({ nazwa: "ergometr", typ: "cardio" });
    expect(wynik.poza_planem[0]!.serie[0]).toMatchObject({ czas_s: 600, oczekuje: true });
  });

  it("dopasowuje ćwiczenie bez względu na wielkość liter", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      {
        id: 11,
        sciezka: "/trening/seria",
        czas_lokalny: CZAS,
        dane: { cwiczenie: "  Przysiad ", powtorzenia: 5, ciezar_kg: 100 },
      },
    ]);

    expect(wynik.poza_planem).toHaveLength(0);
    expect(wynik.wg_planu[0]!.serie).toHaveLength(2);
  });

  it("odtwarza sesję, gdy jej rozpoczęcie dopiero czeka w kolejce", () => {
    // Cały trening zaczęty bez zasięgu: serwer nie wie o niczym, a ekran i tak
    // musi pokazać sesję, inaczej użytkownik zobaczy „Zacznij trening”.
    const pusty = { sesja: null, wg_planu: [], poza_planem: [], ukonczone_cwiczen: 0, wszystkich_cwiczen: 0, pozostalo: [] };

    const wynik = nalozNaTrening(
      pusty,
      [
        { id: 12, sciezka: "/trening/start", czas_lokalny: CZAS, dane: { kod: "A" } },
        {
          id: 13,
          sciezka: "/trening/seria",
          czas_lokalny: CZAS,
          dane: { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 },
        },
      ],
      [{ id: 1, kod: "A", nazwa: "Nogi" }],
    );

    expect(wynik.sesja).toMatchObject({ dzien_kod: "A", dzien_nazwa: "Nogi", oczekuje: true });
    expect(wynik.poza_planem[0]!.serie).toHaveLength(1);
  });

  it("zakończenie czekające w kolejce zamyka sesję na ekranie", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      { id: 14, sciezka: "/trening/koniec", czas_lokalny: CZAS, dane: {} },
    ]);

    expect(wynik.sesja).toBeNull();
  });
});

describe("polityka błędów kolejki", () => {
  it("wygasła sesja zatrzymuje całą kolejkę", () => {
    // Wysyłanie dalej tylko skasowałoby resztę treningu na 401.
    expect(decyzjaKolejki(401)).toBe("zatrzymaj");
    expect(decyzjaKolejki(403)).toBe("zatrzymaj");
  });

  it("błąd domenowy wyrzuca wpis, zamiast blokować kolejkę na zawsze", () => {
    expect(decyzjaKolejki(400)).toBe("usun");
    expect(decyzjaKolejki(422)).toBe("usun");
  });

  it("brak sieci i awaria serwera zostawiają wpis do ponowienia", () => {
    expect(decyzjaKolejki(0)).toBe("ponow");
    expect(decyzjaKolejki(500)).toBe("ponow");
    expect(decyzjaKolejki(502)).toBe("ponow");
  });
});
