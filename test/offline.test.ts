/**
 * Testy czystej części warstwy offline.
 *
 * Nakładka i polityka błędów kolejki to jedyne kawałki offline'u, które da się
 * sprawdzić bez przeglądarki — reszta (service worker, IndexedDB) wymaga testu
 * ręcznego. Tym bardziej warto objąć testami to, co się da: nakładka decyduje
 * o tym, czy użytkownik bez zasięgu widzi swoją serię, a polityka kolejki
 * o tym, czy jeden odrzucony wpis nie zablokuje wysyłki całego treningu.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  czasWysilku,
  ekranAktywnosci,
  wpisAktywnosci,
  wpisTreningu,
  wpisyDnia,
} from "../public/aktywnosci.js";
import { ekranDieta } from "../public/dieta.js";
import { decyzjaKolejki } from "../public/kolejka.js";
import { kartaMakro, PASMO } from "../public/makra.js";
import {
  nalozNaAktywnosci,
  nalozNaDzien,
  nalozNaDzienRuchu,
  nalozNaNotatki,
  nalozNaTrening,
} from "../public/nakladka.js";
import { ekranNotatki } from "../public/notatki.js";
import { wpisPosilku } from "../public/posilek.js";
import { ekranRaporty, panelTygodnia } from "../public/raporty.js";
import { PASMO_CELU } from "../src/domain/raporty.js";

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
    sesja: { id: 7, dzien_id: 2, dzien_kod: "A", dzien_nazwa: "Nogi", status: "aktywna" },
    // Jawny typ, bo część testów podmienia dzień na `null` (dzień wolny),
    // a wywnioskowany kształt takiego przypisania by nie przyjął.
    dzis: {
      data: "2026-08-25",
      dzien: { id: 2, kod: "A", nazwa: "Nogi" } as { id: number; kod: string; nazwa: string } | null,
      zrealizowany: false,
    },
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

describe("nakładka poprawki posiłku", () => {
  const poprawka = (id: number, dane: Record<string, unknown>, idKolejki = 1) => ({
    id: idKolejki,
    sciezka: "/wpis",
    dane: { typ: "posilek", id, akcja: "popraw", dane },
    czas_lokalny: CZAS,
  });

  it("nakłada zmienione pola i przelicza sumy dnia", () => {
    const dzien = nalozNaDzien(dzienZSerwera(), [poprawka(1, { kcal: 650, opis: "owsianka XL" })]);

    const wpis = dzien.posilki[0];
    expect(wpis.opis).toBe("owsianka XL");
    expect(wpis.kcal).toBe(650);
    expect(wpis.oczekujaca_zmiana).toBe(true);
    expect(dzien.spozyte.kcal).toBe(650);
    // Pola niepodane zostają.
    expect(wpis.bialko_g).toBe(30);
  });

  it("nie wnioskuje z czasu ani pozycji — to robota domeny po wysyłce", () => {
    const dzien = nalozNaDzien(dzienZSerwera(), [
      poprawka(1, { czas: "2026-08-20 09:00", pozycje: [{ nazwa: "jajko" }] }),
    ]);

    const wpis = dzien.posilki[0];
    // Wpis zostaje w swoim dniu pod starą godziną, bez zgadniętego rozbicia.
    expect(wpis.godzina).toBe("08:15");
    expect(wpis.pozycje).toBeUndefined();
    expect(wpis.oczekujaca_zmiana).toBe(true);
  });

  it("dwie poprawki tego samego wpisu — wygrywa późniejsza, jak na serwerze", () => {
    const dzien = nalozNaDzien(dzienZSerwera(), [
      poprawka(1, { kcal: 600 }, 1),
      poprawka(1, { kcal: 700 }, 2),
    ]);

    expect(dzien.posilki[0].kcal).toBe(700);
  });

  it("poprawka nieistniejącego wpisu zostawia dzień w spokoju", () => {
    const dzien = nalozNaDzien(dzienZSerwera(), [poprawka(999, { kcal: 1 })]);

    expect(dzien.posilki).toEqual(dzienZSerwera().posilki);
    expect(dzien.spozyte).toEqual(dzienZSerwera().spozyte);
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

  it("odtwarza sesję po id dnia, gdy dwa plany mają dzień o tym samym kodzie", () => {
    const pusty = { sesja: null, wg_planu: [], poza_planem: [], ukonczone_cwiczen: 0, wszystkich_cwiczen: 0, pozostalo: [] };

    const wynik = nalozNaTrening(
      pusty,
      [{ id: 20, sciezka: "/trening/start", czas_lokalny: CZAS, dane: { dzien_id: 7 } }],
      [
        { id: 1, kod: "A", nazwa: "Nogi" },
        { id: 7, kod: "A", nazwa: "Push" },
      ],
    );

    expect(wynik.sesja).toMatchObject({ dzien_nazwa: "Push", oczekuje: true });
  });

  it("zakończenie czekające w kolejce zamyka sesję i gasi dzisiejsze zadanie", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      { id: 14, sciezka: "/trening/koniec", czas_lokalny: CZAS, dane: {} },
    ]);

    expect(wynik.sesja).toBeNull();
    expect(wynik.dzis.zrealizowany).toBe(true);
  });

  it("zakończenie sesji bez ani jednej serii nie gasi dzisiejszego zadania", () => {
    const trening = treningZSerwera();
    trening.wg_planu[0]!.serie_zrobione = 0;
    trening.wg_planu[0]!.serie = [];

    const wynik = nalozNaTrening(trening, [
      { id: 14, sciezka: "/trening/koniec", czas_lokalny: CZAS, dane: {} },
    ]);

    expect(wynik.dzis.zrealizowany).toBe(false);
  });

  it("zakończenie treningu z innego dnia nie gasi dzisiejszego zadania", () => {
    const trening = treningZSerwera();
    trening.sesja.dzien_id = 9;

    const wynik = nalozNaTrening(trening, [
      { id: 14, sciezka: "/trening/koniec", czas_lokalny: CZAS, dane: {} },
    ]);

    expect(wynik.dzis.zrealizowany).toBe(false);
  });

  it("trening rozegrany w całości bez zasięgu też gasi dzisiejsze zadanie", () => {
    // Start, seria i koniec czekają w kolejce — serwer nie wie jeszcze o niczym,
    // a to najczęstszy przebieg treningu na siłowni.
    const zSerwera = treningZSerwera();
    const pusty = {
      sesja: null,
      wg_planu: [],
      poza_planem: [],
      ukonczone_cwiczen: 0,
      wszystkich_cwiczen: 0,
      pozostalo: [],
      dzis: zSerwera.dzis,
    };

    const wynik = nalozNaTrening(
      pusty,
      [
        { id: 21, sciezka: "/trening/start", czas_lokalny: CZAS, dane: { dzien_id: 2 } },
        {
          id: 22,
          sciezka: "/trening/seria",
          czas_lokalny: CZAS,
          dane: { cwiczenie: "przysiad", powtorzenia: 5, ciezar_kg: 100 },
        },
        { id: 23, sciezka: "/trening/koniec", czas_lokalny: CZAS, dane: {} },
      ],
      [{ id: 2, kod: "A", nazwa: "Nogi" }],
    );

    expect(wynik.sesja).toBeNull();
    expect(wynik.dzis.zrealizowany).toBe(true);
  });

  it("dzień wolny zostaje wolny, choćby trening zamknięto bez zasięgu", () => {
    const trening = treningZSerwera();
    trening.dzis = { data: "2026-08-25", dzien: null, zrealizowany: false };

    const wynik = nalozNaTrening(trening, [
      { id: 14, sciezka: "/trening/koniec", czas_lokalny: CZAS, dane: {} },
    ]);

    expect(wynik.dzis.zrealizowany).toBe(false);
  });

  it("odhaczenie całego ćwiczenia z kolejki pokazuje jeden znacznik, a nie zgadnięte serie", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      {
        id: 15,
        sciezka: "/trening/cwiczenie/odhacz",
        czas_lokalny: CZAS,
        dane: { cwiczenie: "przysiad" },
      },
    ]);

    const przysiad = wynik.wg_planu[0];
    // Ile serii dopisze serwer — wie serwer. Nakładka renderuje, nie liczy.
    expect(przysiad?.serie.filter((s: { oczekuje?: boolean }) => s.oczekuje)).toHaveLength(1);
    expect(przysiad?.serie.at(-1)?.cale_cwiczenie).toBe(true);
  });

  it("nie zgaduje liczby serii, więc licznik czeka na serwer", () => {
    const wynik = nalozNaTrening(treningZSerwera(), [
      {
        id: 16,
        sciezka: "/trening/cwiczenie/odhacz",
        czas_lokalny: CZAS,
        dane: { cwiczenie: "przysiad" },
      },
    ]);

    expect(wynik.wg_planu[0]?.serie_zrobione).toBe(1);
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

describe("widok tygodnia", () => {
  const tydzien = {
    tydzien_od: "2026-08-23",
    tydzien_do: "2026-08-29",
    dni_zamkniete: 2,
    dieta: { dni_z_zapisem: 3, srednie: { kcal: 2000 }, dni_w_celu: 2 },
    trening: { sesje: 1, sesje_w_planie: 4, serie: 12, objetosc_kg: 3400 },
    prognoza: {
      na_koniec: { kcal: 14000 },
      cel_tygodnia: { kcal: 14700 },
      roznica: { kcal: -700 },
      na_kursie: false,
      dzis: { kcal: 500 },
    },
    zmiana: { kcal_dziennie: 500, dni_w_celu: 1, serie: 3, objetosc_kg: 200, waga_kg: null, ocena: "lepiej" },
  };

  it("pokazuje prognozę i werdykt przyniesiony z serwera", () => {
    const html = panelTygodnia(tydzien);

    expect(html).toContain("14000");
    expect(html).toContain("14700");
    expect(html).toContain("poza-kursem");
  });

  it("nie ocenia tygodnia samodzielnie — bierze ocenę z danych", () => {
    // Gdyby widok wyciągał werdykt z liczb, czat i aplikacja mogłyby ocenić
    // ten sam tydzień inaczej.
    const html = panelTygodnia({ ...tydzien, zmiana: { ...tydzien.zmiana, ocena: "gorzej" } });

    expect(html).toContain("zmiana gorzej");
    expect(html).not.toContain("zmiana lepiej");
  });

  it("przed pierwszym zamkniętym dniem zapowiada prognozę zamiast jej zmyślać", () => {
    const html = panelTygodnia({ ...tydzien, dni_zamkniete: 0, prognoza: null, zmiana: null });

    expect(html).toMatch(/prognoza pojawi się/i);
    expect(html).not.toContain("14000");
  });

  it("puste archiwum tłumaczy, kiedy pojawi się pierwszy raport", () => {
    expect(ekranRaporty([])).toMatch(/niedzielę o 9:00/);
  });

  it("archiwum rozwija najnowszy raport, gdy nic nie wskazano", () => {
    const raporty = [
      { ...tydzien, tydzien_od: "2026-08-16", tydzien_do: "2026-08-22", waga: { start: null, koniec: null, zmiana_kg: null }, komentarz: "Nowszy" },
      { ...tydzien, tydzien_od: "2026-08-09", tydzien_do: "2026-08-15", waga: { start: null, koniec: null, zmiana_kg: null }, komentarz: "Starszy" },
    ];

    const html = ekranRaporty(raporty);

    expect(html).toContain("Nowszy");
    expect(html).not.toContain("Starszy");
  });
});

describe("kafelki tygodnia", () => {
  const tydzien = {
    tydzien_od: "2026-08-23",
    tydzien_do: "2026-08-29",
    dni_zamkniete: 3,
    dieta: { dni_z_zapisem: 3, srednie: { kcal: 2663 }, dni_w_celu: 2 },
    trening: { sesje: 2, sesje_w_planie: 2, serie: 17, objetosc_kg: 8530 },
    cel_kcal: { trafione: 2, dni_za_nami: 4 },
    plan: { zrobione: 1, zaplanowane: 2 },
    prognoza: null,
    zmiana: null,
  };

  it("bierze oba ułamki gotowe z serwera, nie liczy ich sam", () => {
    const html = panelTygodnia(tydzien);

    expect(html).toContain("2/4");
    expect(html).toContain("1/2");
    // Stara arytmetyka dzieliła przez dni z zapisem i wszystkie sesje tygodnia.
    expect(html).not.toContain("2/3");
    expect(html).not.toContain("2/2");
  });

  it("mianownik dni w celu zgadza się z nagłówkiem karty", () => {
    expect(panelTygodnia(tydzien)).toContain("4 z 7 dni tygodnia");
  });

  it("odpowiedź sprzed wdrożenia nowych pól nie wypisuje undefined", () => {
    // Service worker potrafi oddać odpowiedź zapisaną przed aktualizacją.
    const { cel_kcal: _cel, plan: _plan, ...stary } = tydzien;
    const html = panelTygodnia(stary);

    expect(html).not.toContain("undefined");
    expect(html).toContain("2/3");
  });

  it("odmienia liczebniki w wierszu porównania", () => {
    const z = (dni: number, serie: number) =>
      panelTygodnia({
        ...tydzien,
        zmiana: {
          kcal_dziennie: 0,
          dni_w_celu: dni,
          serie,
          objetosc_kg: 0,
          waga_kg: null,
          ocena: "lepiej",
        },
      });

    expect(z(1, 3)).toContain("+1 dzień w celu");
    expect(z(1, 3)).toContain("+3 serie");
    expect(z(2, 5)).toContain("+2 dni w celu");
    expect(z(2, 5)).toContain("+5 serii");
    expect(z(0, 0)).toContain("0 serii");
  });
});

describe("karta makro", () => {
  const dzien = (data: string, kcal: number, cel: number | null = 2600) => ({
    data,
    kcal,
    bialko_g: 150,
    wegle_g: 250,
    tluszcz_g: 80,
    cel_kcal: cel,
    cel_bialko_g: cel === null ? null : 160,
    cel_wegle_g: cel === null ? null : 300,
    cel_tluszcz_g: cel === null ? null : 85,
  });

  it("pasmo jest tym samym progiem co w domenie", () => {
    expect(PASMO).toBe(PASMO_CELU);
  });

  it("liczy trafienia i barwi kropki z celu każdego dnia", () => {
    // 2600 ±7 % = 2418–2782: 2500 w paśmie, 2790 ponad, 2100 poniżej.
    const html = kartaMakro([
      dzien("2026-08-23", 2500),
      dzien("2026-08-24", 2790),
      dzien("2026-08-25", 2100),
    ]);

    expect(html).toContain("średnie z 3 dni · pasmo ±7 % wokół celu");
    expect(html).toContain("<b>1 z 3 dni</b> w paśmie");
    expect(html).toContain("<b>2463</b> <span class=\"cel\">/ 2600 kcal</span>");
    expect(html).toMatch(/class="pelna"><title>2026-08-23: 2500 kcal/);
    expect(html).toMatch(/class="ponad"><title>2026-08-24: 2790 kcal/);
    expect(html).toMatch(/class="pusta"><title>2026-08-25: 2100 kcal/);
    expect((html.match(/<li class="makro-wiersz"/g) ?? []).length).toBe(4);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("bez celu pokazuje samą średnią i nieme kropki", () => {
    const html = kartaMakro([dzien("2026-08-25", 2100, null)]);

    expect(html).toContain("średnie z 1 dnia</p>");
    expect(html).not.toContain("pasmo");
    expect(html).toContain("<b>2100</b> <span class=\"cel\">kcal</span>");
    expect(html).toContain(">bez celu<");
    expect(html).toContain('class="niema"');
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("trzydzieści dni daje trzydzieści kropek w każdym wierszu", () => {
    const dni = Array.from({ length: 30 }, (_, i) =>
      dzien(`2026-08-${String(i + 1).padStart(2, "0")}`, 2600),
    );
    const html = kartaMakro(dni);

    expect((html.match(/<circle /g) ?? []).length).toBe(120);
    expect(html).toContain("<b>30 z 30 dni</b> w paśmie");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("pusty okres mówi o braku danych", () => {
    expect(kartaMakro([])).toContain("Brak danych");
  });
});

describe("powłoka service workera", () => {
  it("ma na liście każdy moduł, który importuje app.js", () => {
    // Moduł spoza listy nie trafia do cache'u, a bez zasięgu nieudany import
    // kładzie CAŁY app.js — aplikacja na siłowni nie wstaje. Tak zniknął
    // makra.js przy pierwszym wdrożeniu karty Makro.
    const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

    const powloka = sw.match(/const POWLOKA = \[([^\]]*)\]/)?.[1] ?? "";
    const importy = [...app.matchAll(/from "\.\/([\w-]+\.js)"/g)].map((m) => `/${m[1]}`);

    expect(importy.length).toBeGreaterThan(0);
    for (const modul of importy) expect(powloka).toContain(`"${modul}"`);
  });
});

describe("wpis posiłku", () => {
  const posilek = {
    id: 5,
    data_lokalna: "2026-08-25",
    godzina: "08:15",
    opis: "śniadanie",
    kcal: 470,
    bialko_g: 28,
    wegle_g: 40,
    tluszcz_g: 20,
    pewnosc: "szacowane",
    pozycje: [
      { id: 1, nazwa: "jajko", ilosc_g: null, kcal: 150, bialko_g: 13, wegle_g: null, tluszcz_g: null },
      { id: 2, nazwa: "bułka", ilosc_g: 80, kcal: 200, bialko_g: null, wegle_g: null, tluszcz_g: null },
    ],
  };

  it("nie pokazuje rozbicia w zwykłym widoku — składniki mieszkają w edycji", () => {
    // Lista dnia ma nieść bilans, nie recepturę: rozbicie każdego posiłku
    // wydłużało wpisy kilkukrotnie, a czyta się je dopiero przy poprawianiu.
    const html = wpisPosilku(posilek, null);

    expect(html).not.toContain("jajko");
    expect(html).not.toContain("bułka");

    // W formularzu edycji składniki są — po wierszu na każdy.
    const edycja = wpisPosilku(posilek, 5);
    expect(edycja).toContain('value="jajko"');
    expect(edycja).toContain('value="bułka"');
  });

  it("oznacza wpis z najniższą pewnością", () => {
    const html = wpisPosilku({ ...posilek, pewnosc: "niepewne" }, null);

    expect(html).toContain("niepewne");
    expect(html).not.toContain("szacunek");
  });

  it("formularz edycji niesie dane do poprawki czasu i pozycji", () => {
    const html = wpisPosilku(posilek, 5);

    // Data dnia i wyjściowa godzina — bez nich app.js nie odróżni „godzina
    // zmieniona" od „godzina nietknięta" i nie zakotwiczy edycji w dniu wpisu.
    // Nazwa data-dzien-wpisu jest celowa: goły data-dzien łapałby delegowany
    // handler paska dat przy każdym stuknięciu w pole formularza.
    expect(html).toContain('data-dzien-wpisu="2026-08-25"');
    expect(html).not.toContain('data-dzien="');
    expect(html).toContain('data-godzina="08:15"');
    expect(html).toContain('data-ile-pozycji="2"');
    // Po wierszu na każdą pozycję plus przycisk dokładania.
    expect(html.match(/data-wiersz/g)).toHaveLength(2);
    expect(html).toContain("data-dodaj-wiersz");
    expect(html).toContain('value="jajko"');
  });

  it("posiłek bez rozbicia deklaruje to w formularzu", () => {
    const html = wpisPosilku({ ...posilek, pozycje: [] }, 5);

    // Granica „wyczyść vs nie ruszaj" to obecność klucza w żądaniu — bez
    // licznika wierszy app.js nie odróżni nietkniętego edytora od jawnego
    // wyczyszczenia rozbicia.
    expect(html).toContain('data-ile-pozycji="0"');
  });

  it("wpis z kolejki nie dostaje przycisków edycji", () => {
    const html = wpisPosilku({ ...posilek, id: "oczekuje-1", oczekuje: true }, null);

    expect(html).not.toContain("data-edytuj-posilek");
    expect(html).not.toContain("data-usun-posilek");
    expect(html).toContain("⏳ czeka");
  });
});

describe("widok diety", () => {
  const posilek = (id: number, opis: string) => ({
    id,
    data_lokalna: "2026-08-25",
    godzina: "08:15",
    opis,
    kcal: 500,
    bialko_g: 30,
    wegle_g: 50,
    tluszcz_g: 20,
    pewnosc: "dokladne",
    pozycje: [],
  });

  const historia = {
    od: "2026-08-12",
    do: "2026-08-25",
    dni: [
      {
        data: "2026-08-25",
        spozyte: { kcal: 1800, bialko_g: 120, wegle_g: 200, tluszcz_g: 60 },
        cel_kcal: 2400,
        ile_szacowanych: 1,
        ile_niepewnych: 0,
        posilki: [posilek(1, "owsianka")],
      },
      {
        data: "2026-08-24",
        spozyte: { kcal: 2100, bialko_g: 140, wegle_g: 220, tluszcz_g: 70 },
        cel_kcal: null,
        ile_szacowanych: 0,
        ile_niepewnych: 0,
        posilki: [posilek(2, "obiad wczorajszy")],
      },
    ],
  };

  it("pokazuje nagłówki dni z sumami; zwinięty dzień nie zdradza posiłków", () => {
    const html = ekranDieta(historia, null, null, "2026-08-25");

    expect(html).toContain("wt 25.08 · dziś");
    expect(html).toContain("pn 24.08");
    expect(html).toContain("1800 / 2400 kcal");
    expect(html).not.toContain("owsianka");
  });

  it("rozwija wskazany dzień, resztę zostawia zwiniętą", () => {
    const html = ekranDieta(historia, "2026-08-25", null, "2026-08-25");

    expect(html).toContain("owsianka");
    expect(html).not.toContain("obiad wczorajszy");
  });

  it("dzień bez celu nie zmyśla mianownika", () => {
    const html = ekranDieta(historia, null, null, "2026-08-25");

    expect(html).toContain("2100 kcal");
    expect(html).not.toContain("2100 / ");
  });

  it("zawsze proponuje sięgnięcie po starsze dni", () => {
    expect(ekranDieta(historia, null, null, "2026-08-25")).toContain("data-starsze-diety");
    expect(
      ekranDieta({ od: "2026-08-12", do: "2026-08-25", dni: [] }, null, null, "2026-08-25"),
    ).toContain("data-starsze-diety");
  });

  it("pusta historia tłumaczy się zamiast świecić gołym brakiem danych", () => {
    const html = ekranDieta({ od: "2026-08-12", do: "2026-08-25", dni: [] }, null, null, null);

    expect(html).toContain("pusto");
    expect(html).toContain("2026-08-12");
  });

  it("nie ocenia dni — liczby bez werdyktów", () => {
    // Werdykty („na kursie", „lepiej") przychodzą z serwera na ekranie
    // Postępy; historia ma pokazywać fakty, nie sądy.
    const html = ekranDieta(historia, "2026-08-25", null, "2026-08-25");

    expect(html).not.toMatch(/lepiej|gorzej|na kursie/);
  });
});

describe("nakładka na aktywności", () => {
  const zSerwera = () => [
    {
      id: 1,
      godzina: "17:20",
      data_lokalna: "2026-08-25",
      dyscyplina: "rower",
      dystans_m: 18_000,
      czas_s: 3600,
      rpe: null,
      notatka: null,
    },
  ];

  it("bez kolejki zwraca listę nietkniętą", () => {
    const lista = zSerwera();

    expect(nalozNaAktywnosci(lista, [], "2026-08-25")).toBe(lista);
  });

  it("dokłada wpis z kolejki ze znacznikiem oczekiwania", () => {
    const wynik = nalozNaAktywnosci(
      zSerwera(),
      [
        {
          id: 4,
          sciezka: "/aktywnosci",
          czas_lokalny: CZAS,
          // Godzina podana bez strefy — inaczej wynik zależałby od zegara
          // maszyny, na której biegnie test.
          dane: { dyscyplina: "bieg", dystans_m: 5000, czas_s: 1500, czas: "2026-08-25 17:20" },
        },
      ],
      "2026-08-25",
    );

    expect(wynik).toHaveLength(2);
    expect(wynik[1]).toMatchObject({ dyscyplina: "bieg", oczekuje: true, godzina: "17:20" });
  });

  it("pomija wpisy z innego dnia niż oglądany", () => {
    const wynik = nalozNaAktywnosci(
      zSerwera(),
      [
        {
          id: 5,
          sciezka: "/aktywnosci",
          czas_lokalny: "2026-08-26T12:00:00.000Z",
          dane: { dyscyplina: "spacer", czas_s: 900 },
        },
      ],
      "2026-08-25",
    );

    expect(wynik).toHaveLength(1);
  });

  it("ukrywa wpis, którego usunięcie czeka w kolejce", () => {
    const wynik = nalozNaAktywnosci(
      zSerwera(),
      [{ id: 6, sciezka: "/wpis", dane: { typ: "aktywnosc", id: 1, akcja: "usun" } }],
      "2026-08-25",
    );

    expect(wynik).toHaveLength(0);
  });

  it("nakłada poprawkę i oznacza wpis jako zmieniony", () => {
    const wynik = nalozNaAktywnosci(
      zSerwera(),
      [
        {
          id: 7,
          sciezka: "/wpis",
          dane: { typ: "aktywnosc", id: 1, akcja: "popraw", dane: { dystans_m: 22_000 } },
        },
      ],
      "2026-08-25",
    );

    expect(wynik[0]).toMatchObject({ dystans_m: 22_000, oczekujaca_zmiana: true });
  });

  it("czas z poprawki zostaje serwerowi — przenoszenie dni to robota domeny", () => {
    const wynik = nalozNaAktywnosci(
      zSerwera(),
      [
        {
          id: 8,
          sciezka: "/wpis",
          dane: { typ: "aktywnosc", id: 1, akcja: "popraw", dane: { czas: "2026-08-23 07:00" } },
        },
      ],
      "2026-08-25",
    );

    expect(wynik[0]?.godzina).toBe("17:20");
    expect(wynik[0]).toMatchObject({ oczekujaca_zmiana: true });
  });

  it("nie miesza się z kolejką posiłków", () => {
    const wynik = nalozNaAktywnosci(
      zSerwera(),
      [{ id: 9, sciezka: "/posilki", czas_lokalny: CZAS, dane: { opis: "baton", kcal: 250 } }],
      "2026-08-25",
    );

    expect(wynik).toHaveLength(1);
  });

  it("dzień z zakładki przelicza sumy po nałożeniu", () => {
    const dzien = {
      data: "2026-08-25",
      dystans_m: 18_000,
      czas_s: 3600,
      aktywnosci: zSerwera(),
    };

    const wynik = nalozNaDzienRuchu(dzien, [
      {
        id: 10,
        sciezka: "/aktywnosci",
        czas_lokalny: CZAS,
        dane: { dyscyplina: "bieg", dystans_m: 5000, czas_s: 1500 },
      },
    ]);

    expect(wynik.dystans_m).toBe(23_000);
    expect(wynik.czas_s).toBe(5100);
  });
});

describe("widok aktywności", () => {
  const dzien = (data: string) => ({
    data,
    dystans_m: 18_000,
    czas_s: 3600,
    aktywnosci: [
      {
        id: 1,
        godzina: "17:20",
        data_lokalna: data,
        dyscyplina: "rower",
        dystans_m: 18_000,
        czas_s: 3600,
        rpe: null,
        notatka: "wokół jeziora",
      },
    ],
  });

  it("pusta historia mówi, od kiedy patrzy, i nadal pozwala dodać wpis", () => {
    const html = ekranAktywnosci({ od: "2026-08-12", do: "2026-08-25", dni: [] }, null, null, "2026-08-25");

    expect(html).toContain("2026-08-12");
    expect(html).toContain("Dodaj aktywność");
  });

  it("zwinięty dzień pokazuje sumy, rozwinięty także wpisy", () => {
    const historia = { od: "2026-08-12", do: "2026-08-25", dni: [dzien("2026-08-25")] };

    const zwiniety = ekranAktywnosci(historia, null, null, "2026-08-25");
    expect(zwiniety).toContain("18.0 km");
    expect(zwiniety).not.toContain("wokół jeziora");

    const rozwiniety = ekranAktywnosci(historia, "2026-08-25", null, "2026-08-25");
    expect(rozwiniety).toContain("wokół jeziora");
  });

  it("atrybut dnia nie koliduje z paskiem dat na ekranie Dziś", () => {
    const html = ekranAktywnosci(
      { od: "2026-08-12", do: "2026-08-25", dni: [dzien("2026-08-25")] },
      null,
      null,
      "2026-08-25",
    );

    // Goły data-dzien łapałby delegowany handler paska dat i sypał RangeError.
    expect(html).toContain("data-dzien-aktywnosci=");
    expect(html).not.toMatch(/data-dzien="/);
  });

  it("wpis oczekujący nie ma przycisków poprawki ani usunięcia", () => {
    const czekajacy = {
      id: "oczekuje-4",
      oczekuje: true,
      godzina: "17:20",
      dyscyplina: "bieg",
      dystans_m: 5000,
      czas_s: 1500,
    };

    expect(wpisAktywnosci(czekajacy, null)).not.toContain("data-usun-aktywnosc");
    expect(wpisAktywnosci(czekajacy, null)).toContain("⏳ czeka");
  });

  it("wpis w edycji podaje dzień i godzinę, żeby poprawka nie przeniosła go na dzisiaj", () => {
    const html = wpisAktywnosci(dzien("2026-08-23").aktywnosci[0], 1);

    expect(html).toContain('data-dzien-wpisu="2026-08-23"');
    expect(html).toContain('data-godzina="17:20"');
  });

  it("czas wysiłku podaje minuty, a od godziny w górę godziny", () => {
    expect(czasWysilku(1500)).toBe("25 min");
    expect(czasWysilku(3900)).toBe("1 h 05 min");
  });
});

describe("historia ruchu w widoku", () => {
  const treningZSerwera = (godzina = "17:00") => ({
    id: 7,
    dzien_kod: "A",
    dzien_nazwa: "Nogi i klatka",
    data_lokalna: "2026-08-25",
    godzina,
    trwanie_s: 4500,
    serie_lacznie: 3,
    cwiczenia: [
      {
        cwiczenie_id: 3,
        nazwa: "przysiad",
        typ: "silowe",
        serie: [
          { id: 1, nr_serii: 1, powtorzenia: 5, ciezar_kg: 100 },
          { id: 2, nr_serii: 2, powtorzenia: 5, ciezar_kg: 100 },
          { id: 3, nr_serii: 3, powtorzenia: 5, ciezar_kg: 110 },
        ],
      },
    ],
  });

  const rowerZSerwera = (godzina = "07:20") => ({
    id: 1,
    godzina,
    data_lokalna: "2026-08-25",
    dyscyplina: "rower",
    dystans_m: 18_000,
    czas_s: 3600,
    rpe: null,
    notatka: null,
  });

  it("wpis treningu pokazuje wyniki, zwijając serie pod rząd", () => {
    const html = wpisTreningu(treningZSerwera());

    expect(html).toContain("Trening A");
    expect(html).toContain("Nogi i klatka");
    expect(html).toContain("3 serie");
    expect(html).toContain("1 h 15 min");
    expect(html).toContain("5×100 kg ×2 · 5×110 kg");
  });

  it("trening da się usunąć, ale nie poprawić serii po serii", () => {
    const html = wpisTreningu(treningZSerwera());

    expect(html).toContain('data-usun-sesje="7"');
    expect(html).not.toContain("data-edytuj-serie");
  });

  it("trening z usunięciem w kolejce traci przycisk i dostaje znacznik", () => {
    const html = wpisTreningu({ ...treningZSerwera(), oczekujace_usuniecie: true });

    expect(html).toContain("⏳ usuwanie");
    expect(html).not.toContain("data-usun-sesje");
  });

  it("wpisy dnia idą po godzinie, niezależnie od rodzaju", () => {
    const dzien = {
      data: "2026-08-25",
      dystans_m: 18_000,
      czas_s: 3600,
      aktywnosci: [rowerZSerwera("07:20")],
      treningi: [treningZSerwera("17:00")],
    };

    expect(wpisyDnia(dzien).map((w) => w.rodzaj)).toEqual(["aktywnosc", "trening"]);

    const wieczornyRower = {
      ...dzien,
      aktywnosci: [rowerZSerwera("19:30")],
    };
    expect(wpisyDnia(wieczornyRower).map((w) => w.rodzaj)).toEqual(["trening", "aktywnosc"]);
  });

  it("rozwinięty dzień pokazuje trening i aktywność, zwinięty tylko skrót", () => {
    const historia = {
      od: "2026-08-12",
      do: "2026-08-25",
      dni: [
        {
          data: "2026-08-25",
          dystans_m: 18_000,
          czas_s: 3600,
          aktywnosci: [rowerZSerwera()],
          treningi: [treningZSerwera()],
        },
      ],
    };

    const zwiniety = ekranAktywnosci(historia, null, null, "2026-08-25");
    expect(zwiniety).toContain("Trening A · rower 18.0 km");
    expect(zwiniety).not.toContain("5×100 kg");

    const rozwiniety = ekranAktywnosci(historia, "2026-08-25", null, "2026-08-25");
    expect(rozwiniety).toContain("5×100 kg ×2");
    expect(rozwiniety).toContain("rower");
  });

  it("kolejka ukrywa trening, którego usunięcie czeka na wysłanie", () => {
    const dzien = {
      data: "2026-08-25",
      dystans_m: 0,
      czas_s: 0,
      aktywnosci: [],
      treningi: [treningZSerwera()],
    };

    const wynik = nalozNaDzienRuchu(dzien, [
      { id: 9, sciezka: "/wpis", dane: { typ: "sesja", id: 7, akcja: "usun" } },
    ]);

    expect(wynik.treningi).toHaveLength(0);
  });

  it("usunięcie posiłku w kolejce nie rusza treningów", () => {
    const dzien = {
      data: "2026-08-25",
      dystans_m: 0,
      czas_s: 0,
      aktywnosci: [],
      treningi: [treningZSerwera()],
    };

    const wynik = nalozNaDzienRuchu(dzien, [
      { id: 10, sciezka: "/wpis", dane: { typ: "posilek", id: 7, akcja: "usun" } },
    ]);

    expect(wynik.treningi).toHaveLength(1);
  });
});

describe("skrót dnia w historii ruchu", () => {
  const dzien = (treningi: unknown[], aktywnosci: unknown[] = []) => ({
    od: "2026-08-12",
    do: "2026-08-25",
    dni: [{ data: "2026-08-25", dystans_m: 0, czas_s: 0, treningi, aktywnosci }],
  });

  const sesja = (id: number, kod = "T", trwanie_s = 4500) => ({
    id,
    dzien_kod: kod,
    dzien_nazwa: "Test",
    data_lokalna: "2026-08-25",
    godzina: "17:00",
    trwanie_s,
    serie_lacznie: 1,
    cwiczenia: [{ cwiczenie_id: 1, nazwa: "pompki", typ: "silowe", serie: [{ powtorzenia: 10 }] }],
  });

  it("zwija powtórzony napis zamiast wypisywać go sześć razy", () => {
    const html = ekranAktywnosci(dzien([sesja(1), sesja(2), sesja(3)]), null, null, "2026-08-25");

    expect(html).toContain("Trening T ×3");
    expect(html).not.toContain("Trening T · Trening T");
  });

  it("krótszy niż minuta trening nie chwali się „0 min”", () => {
    const html = wpisTreningu(sesja(1, "T", 40));

    expect(html).not.toContain("0 min");
    expect(html).toContain("Trening T");
  });
});

describe("nakładka na notatki", () => {
  const zSerwera = () => [
    {
      kategoria: "dziennik",
      ile: 2,
      ostatnia: "2026-08-25",
      notatki: [
        {
          id: 1,
          data_lokalna: "2026-08-25",
          godzina: "09:12",
          kategoria: "dziennik",
          tytul: "Zebranie",
          tresc: "Nikogo nie było.",
          surowe_wejscie: "no dzisiaj pojechalem",
        },
      ],
    },
    { kategoria: "praca", ile: 0, ostatnia: null, notatki: [] },
    { kategoria: "inne", ile: 0, ostatnia: null, notatki: [] },
  ];

  it("bez kolejki zwraca foldery nietknięte", () => {
    const foldery = zSerwera();

    expect(nalozNaNotatki(foldery, [])).toBe(foldery);
  });

  it("dokłada notatkę z kolejki do właściwego folderu i podbija licznik", () => {
    const wynik = nalozNaNotatki(zSerwera(), [
      {
        id: 7,
        sciezka: "/notatki",
        dane: { tresc: "Termin na piątek", kategoria: "praca" },
        czas_lokalny: "2026-08-25T14:00:00.000Z",
      },
    ]);

    const praca = wynik.find((f) => f.kategoria === "praca");
    expect(praca?.ile).toBe(1);
    expect(praca?.notatki[0]?.oczekuje).toBe(true);
    expect(praca?.notatki[0]?.tresc).toBe("Termin na piątek");
    // Tytułu nie zgadujemy — nadaje go model przy zapisie z czatu.
    expect(praca?.notatki[0]?.tytul).toBeNull();
    // Folder, którego kolejka nie dotyczy, zostaje ten sam.
    expect(wynik.find((f) => f.kategoria === "dziennik")?.ile).toBe(2);
  });

  it("notatka bez kategorii ląduje w worku, tak jak w domenie", () => {
    const wynik = nalozNaNotatki(zSerwera(), [
      {
        id: 8,
        sciezka: "/notatki",
        dane: { tresc: "Luźna myśl" },
        czas_lokalny: "2026-08-25T14:00:00.000Z",
      },
    ]);

    expect(wynik.find((f) => f.kategoria === "inne")?.notatki).toHaveLength(1);
  });

  it("usunięcie czekające w kolejce znika z listy od razu", () => {
    const wynik = nalozNaNotatki(zSerwera(), [
      {
        id: 9,
        sciezka: "/wpis",
        dane: { typ: "notatka", id: 1, akcja: "usun" },
        czas_lokalny: "2026-08-25T15:00:00.000Z",
      },
    ]);

    const dziennik = wynik.find((f) => f.kategoria === "dziennik");
    expect(dziennik?.notatki).toHaveLength(0);
    // Licznik idzie w dół razem z listą — karta mówiąca „2 notatki" nad pustą
    // listą wyglądałaby na zepsutą.
    expect(dziennik?.ile).toBe(1);
  });

  it("nie rusza usunięć innych typów wpisu", () => {
    const foldery = zSerwera();
    const wynik = nalozNaNotatki(foldery, [
      {
        id: 10,
        sciezka: "/wpis",
        dane: { typ: "posilek", id: 1, akcja: "usun" },
        czas_lokalny: "2026-08-25T15:00:00.000Z",
      },
    ]);

    expect(wynik).toBe(foldery);
  });
});

describe("ekran notatek", () => {
  const historia = {
    ile: 30,
    foldery: [
      {
        kategoria: "dziennik",
        ile: 1,
        ostatnia: "2026-08-25",
        notatki: [
          {
            id: 1,
            data_lokalna: "2026-08-25",
            godzina: "09:12",
            kategoria: "dziennik",
            tytul: "Zebranie",
            tresc: "Nikogo nie było.",
            surowe_wejscie: "no dzisiaj pojechalem do zebranie",
          },
        ],
      },
      { kategoria: "praca", ile: 0, ostatnia: null, notatki: [] },
      { kategoria: "inne", ile: 3, ostatnia: "2026-08-20", notatki: [] },
    ],
  };

  it("pokazuje trzy foldery, a worek na resztę ciszej niż pozostałe", () => {
    const ekran = ekranNotatki(historia, null, null, "2026-08-25");

    expect(ekran).toMatch(/data-folder="dziennik"/);
    expect(ekran).toMatch(/data-folder="praca"/);
    expect(ekran).toMatch(/folder-cichy/);
    expect(ekran).toMatch(/1 notatka/);
    expect(ekran).toMatch(/3 notatki/);
  });

  it("zwinięta notatka pokazuje sam nagłówek, rozwinięta pełną treść i oryginał", () => {
    const zwinieta = ekranNotatki(historia, "dziennik", null, "2026-08-25");
    expect(zwinieta).toMatch(/Zebranie/);
    expect(zwinieta).not.toMatch(/tresc-notatki/);

    const rozwinieta = ekranNotatki(historia, "dziennik", "1", "2026-08-25");
    expect(rozwinieta).toMatch(/tresc-notatki/);
    expect(rozwinieta).toMatch(/Pokaż oryginał/);
    expect(rozwinieta).toMatch(/pojechalem do zebranie/);
  });

  it("notatka z kolejki nie ma przycisku usuwania — nie ma jeszcze czego usuwać", () => {
    const zOczekujaca = {
      ile: 30,
      foldery: [
        {
          kategoria: "dziennik",
          ile: 1,
          ostatnia: "2026-08-25",
          notatki: [
            {
              id: "oczekuje-4",
              oczekuje: true,
              data_lokalna: "2026-08-25",
              godzina: "18:00",
              kategoria: "dziennik",
              tytul: null,
              tresc: "Notatka bez zasięgu",
              surowe_wejscie: null,
            },
          ],
        },
      ],
    };

    const ekran = ekranNotatki(zOczekujaca, "dziennik", null, "2026-08-25");
    expect(ekran).toMatch(/czeka/);
    expect(ekran).not.toMatch(/data-usun-notatke/);
    // Bez tytułu listę otwiera pierwsza linia treści.
    expect(ekran).toMatch(/Notatka bez zasięgu/);
  });

  it("pusty folder mówi, skąd wziąć notatki", () => {
    const ekran = ekranNotatki(historia, "praca", null, "2026-08-25");

    expect(ekran).toMatch(/jest pusty/);
    expect(ekran).toMatch(/data-zamknij-folder/);
  });
});
