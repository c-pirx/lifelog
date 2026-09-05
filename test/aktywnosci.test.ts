import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import {
  aktywnosciZDnia,
  historiaRuchu,
  statAktywnosci,
  zapiszAktywnosc,
} from "../src/domain/aktywnosci.js";
import { czyBladDomeny } from "../src/domain/bledy.js";
import {
  rozpocznijTrening,
  stanTreningu,
  zakonczTrening,
  zapiszSerie,
} from "../src/domain/workouts.js";

let db: Baza;

beforeEach(() => {
  db = otworzBaze({ sciezka: ":memory:" });
});

const kod = (uruchom: () => unknown): string => {
  try {
    uruchom();
  } catch (blad) {
    return czyBladDomeny(blad) ? blad.kod : `nie-domenowy: ${String(blad)}`;
  }
  return "brak-bledu";
};

describe("zapis aktywności", () => {
  it("zapisuje dystans i czas, licząc dobę w strefie użytkownika", () => {
    const aktywnosc = zapiszAktywnosc(db, {
      dyscyplina: "rower",
      dystans_m: 5000,
      czas_s: 1500,
      ts: "2026-08-25T21:30:00.000Z",
    });

    expect(aktywnosc.id).toBeGreaterThan(0);
    expect(aktywnosc.dystans_m).toBe(5000);
    expect(aktywnosc.czas_s).toBe(1500);
    // 21:30 UTC to 23:30 w Warszawie — wpis należy jeszcze do 25.
    expect(aktywnosc.data_lokalna).toBe("2026-08-25");
    expect(aktywnosc.godzina).toBe("23:30");
    expect(aktywnosc.zrodlo).toBe("czat");
  });

  it("przyjmuje sam czas — bieg bez zmierzonego dystansu to nadal bieg", () => {
    const aktywnosc = zapiszAktywnosc(db, { dyscyplina: "bieg", czas_s: 1800 });

    expect(aktywnosc.dystans_m).toBeNull();
    expect(aktywnosc.czas_s).toBe(1800);
  });

  it("odrzuca wpis bez dystansu i bez czasu", () => {
    expect(kod(() => zapiszAktywnosc(db, { dyscyplina: "rower" }))).toBe(
      "brak_czasu_i_dystansu",
    );
  });

  it("odrzuca pustą nazwę dyscypliny", () => {
    expect(kod(() => zapiszAktywnosc(db, { dyscyplina: "   ", czas_s: 600 }))).toBe(
      "pusta_dyscyplina",
    );
  });

  it("odrzuca liczby poza sensownym zakresem", () => {
    expect(kod(() => zapiszAktywnosc(db, { dyscyplina: "rower", dystans_m: 500_000 }))).toBe(
      "zly_dystans",
    );
    expect(kod(() => zapiszAktywnosc(db, { dyscyplina: "rower", czas_s: 200_000 }))).toBe(
      "zly_czas",
    );
    expect(kod(() => zapiszAktywnosc(db, { dyscyplina: "rower", czas_s: 600, rpe: 12 }))).toBe(
      "zle_rpe",
    );
  });

  it("przycina nazwę i zamienia pustą notatkę na brak", () => {
    const aktywnosc = zapiszAktywnosc(db, {
      dyscyplina: "  spacer  ",
      czas_s: 900,
      notatka: "   ",
    });

    expect(aktywnosc.dyscyplina).toBe("spacer");
    expect(aktywnosc.notatka).toBeNull();
  });
});

describe("aktywności a trening", () => {
  /**
   * Cała racja bytu osobnej tabeli: aktywność nie może zająć jedynego miejsca
   * na otwartą sesję ani wmieszać się w stan treningu.
   */
  it("nie blokuje rozpoczęcia treningu i nie pojawia się w jego stanie", () => {
    zapiszAktywnosc(db, { dyscyplina: "rower", dystans_m: 12_000, czas_s: 2400 });

    expect(() => rozpocznijTrening(db, { bez_planu: true })).not.toThrow();

    const stan = stanTreningu(db);
    expect(stan.sesja).not.toBeNull();
    expect(stan.wg_planu).toHaveLength(0);
    expect(stan.poza_planem).toHaveLength(0);
  });
});

describe("dzień i historia", () => {
  beforeEach(() => {
    zapiszAktywnosc(db, {
      dyscyplina: "rower",
      dystans_m: 8000,
      czas_s: 1800,
      ts: "2026-08-25T06:00:00.000Z",
    });
    zapiszAktywnosc(db, {
      dyscyplina: "spacer",
      czas_s: 1200,
      ts: "2026-08-25T16:00:00.000Z",
    });
    zapiszAktywnosc(db, {
      dyscyplina: "bieg",
      dystans_m: 5000,
      czas_s: 1500,
      ts: "2026-08-23T06:00:00.000Z",
    });
  });

  it("zwraca aktywności wskazanego dnia w kolejności zapisu", () => {
    const dzien = aktywnosciZDnia(db, "2026-08-25");

    expect(dzien.map((a) => a.dyscyplina)).toEqual(["rower", "spacer"]);
  });

  it("grupuje historię po dniach, od najnowszego, z sumami dnia", () => {
    const historia = historiaRuchu(db, { dni: 14, przed: "2026-08-26" });

    expect(historia.do).toBe("2026-08-25");
    expect(historia.dni.map((d) => d.data)).toEqual(["2026-08-25", "2026-08-23"]);

    const [pierwszy] = historia.dni;
    expect(pierwszy?.dystans_m).toBe(8000);
    expect(pierwszy?.czas_s).toBe(3000);
    expect(pierwszy?.aktywnosci).toHaveLength(2);
  });

  it("okno „przed” zaczyna się dzień wcześniej — strony się nie zazębiają", () => {
    const historia = historiaRuchu(db, { dni: 1, przed: "2026-08-25" });

    expect(historia.od).toBe("2026-08-24");
    expect(historia.do).toBe("2026-08-24");
    expect(historia.dni).toHaveLength(0);
  });

  it("podaje sumy całego okna, żeby widok nie musiał ich składać sam", () => {
    const historia = historiaRuchu(db, { dni: 14, przed: "2026-08-26" });

    expect(historia.dni_okna).toBe(14);
    expect(historia.sumy.aktywnosci).toBe(3);
    expect(historia.sumy.dystans_m).toBe(13_000);
    expect(historia.sumy.czas_s).toBe(4500);
    // Dwa dni z wpisami z czternastu w oknie — mianownik zostaje przy oknie.
    expect(historia.sumy.dni_z_ruchem).toBe(2);
  });

  it("do sum wchodzą też odbyte treningi, ale nie dokładają kilometrów", () => {
    rozpocznijTrening(db, { bez_planu: true, ts: "2026-08-24T16:00:00.000Z" });
    zapiszSerie(db, {
      cwiczenie: "przysiad",
      typ: "silowe",
      powtorzenia: 5,
      ciezar_kg: 100,
      ts: "2026-08-24T16:10:00.000Z",
    });
    zakonczTrening(db, { ts: "2026-08-24T17:00:00.000Z" });

    const historia = historiaRuchu(db, { dni: 14, przed: "2026-08-26" });

    expect(historia.sumy.treningi).toBe(1);
    // Trening siłowy nie ma kilometrów i suma okna nie może ich sobie dorobić.
    expect(historia.sumy.dystans_m).toBe(13_000);
    expect(historia.sumy.dni_z_ruchem).toBe(3);
  });

  it("okno bez wpisów oddaje same zera, a nie brak pola", () => {
    const historia = historiaRuchu(db, { dni: 3, przed: "2026-08-01" });

    expect(historia.sumy).toEqual({
      treningi: 0,
      aktywnosci: 0,
      dystans_m: 0,
      czas_s: 0,
      dni_z_ruchem: 0,
    });
  });
});

describe("statystyka tygodnia", () => {
  it("sumuje wpisy i rozbija je na dyscypliny", () => {
    zapiszAktywnosc(db, {
      dyscyplina: "rower",
      dystans_m: 8000,
      czas_s: 1800,
      ts: "2026-08-25T06:00:00.000Z",
    });
    zapiszAktywnosc(db, {
      dyscyplina: "rower",
      dystans_m: 12_000,
      czas_s: 2400,
      ts: "2026-08-26T06:00:00.000Z",
    });
    zapiszAktywnosc(db, {
      dyscyplina: "bieg",
      dystans_m: 5000,
      czas_s: 1500,
      ts: "2026-08-27T06:00:00.000Z",
    });

    const stat = statAktywnosci(db, "2026-08-23", "2026-08-29");

    expect(stat.ile).toBe(3);
    expect(stat.dystans_m).toBe(25_000);
    expect(stat.czas_s).toBe(5700);
    expect(stat.dyscypliny[0]).toMatchObject({ nazwa: "rower", ile: 2, dystans_m: 20_000 });
  });

  it("łączy dyscypliny pisane różną wielkością liter", () => {
    zapiszAktywnosc(db, { dyscyplina: "Rower", czas_s: 600, ts: "2026-08-25T06:00:00.000Z" });
    zapiszAktywnosc(db, { dyscyplina: "rower", czas_s: 600, ts: "2026-08-26T06:00:00.000Z" });

    const stat = statAktywnosci(db, "2026-08-23", "2026-08-29");

    expect(stat.dyscypliny).toHaveLength(1);
    expect(stat.dyscypliny[0]?.ile).toBe(2);
  });

  it("pusty zakres daje zera, a nie brak pola", () => {
    const stat = statAktywnosci(db, "2026-08-23", "2026-08-29");

    expect(stat).toEqual({ ile: 0, czas_s: 0, dystans_m: 0, dyscypliny: [] });
  });
});

describe("historia ruchu scala treningi z aktywnościami", () => {
  function trening(data: string, ciezar: number) {
    rozpocznijTrening(db, { bez_planu: true, ts: `${data}T16:00:00.000Z` });
    zapiszSerie(db, {
      cwiczenie: "przysiad",
      powtorzenia: 5,
      ciezar_kg: ciezar,
      ts: `${data}T16:05:00.000Z`,
    });
    zakonczTrening(db, { ts: `${data}T17:00:00.000Z` });
  }

  it("dzień z samym treningiem też trafia do historii", () => {
    trening("2026-08-24", 100);

    const historia = historiaRuchu(db, { dni: 14, przed: "2026-08-26" });

    expect(historia.dni.map((d) => d.data)).toEqual(["2026-08-24"]);
    expect(historia.dni[0]?.treningi).toHaveLength(1);
    expect(historia.dni[0]?.aktywnosci).toHaveLength(0);
  });

  it("dzień z jednym i drugim niesie oba wpisy", () => {
    trening("2026-08-24", 100);
    zapiszAktywnosc(db, {
      dyscyplina: "rower",
      dystans_m: 12_000,
      czas_s: 2400,
      ts: "2026-08-24T06:00:00.000Z",
    });

    const [dzien] = historiaRuchu(db, { dni: 14, przed: "2026-08-26" }).dni;

    expect(dzien?.treningi).toHaveLength(1);
    expect(dzien?.aktywnosci).toHaveLength(1);
  });

  it("sumy dnia liczą się z aktywności, nie z treningu", () => {
    // Bieżnia w sesji ma dystans, ale to seria treningu — kilometry dnia
    // opisują wyjścia poza plan i nie mogą jej wchłonąć.
    rozpocznijTrening(db, { bez_planu: true, ts: "2026-08-24T16:00:00.000Z" });
    zapiszSerie(db, {
      cwiczenie: "bieżnia",
      typ: "cardio",
      dystans_m: 3000,
      ts: "2026-08-24T16:05:00.000Z",
    });
    zakonczTrening(db, { ts: "2026-08-24T17:00:00.000Z" });
    zapiszAktywnosc(db, {
      dyscyplina: "rower",
      dystans_m: 12_000,
      ts: "2026-08-24T06:00:00.000Z",
    });

    const [dzien] = historiaRuchu(db, { dni: 14, przed: "2026-08-26" }).dni;

    expect(dzien?.dystans_m).toBe(12_000);
  });

  it("okno „przed” obejmuje treningi tak samo jak aktywności", () => {
    trening("2026-08-24", 100);

    expect(historiaRuchu(db, { dni: 1, przed: "2026-08-24" }).dni).toHaveLength(0);
    expect(historiaRuchu(db, { dni: 1, przed: "2026-08-25" }).dni).toHaveLength(1);
  });
});
