/**
 * Notatki — jedyny byt w aplikacji, który nic nie mierzy.
 *
 * Testy pilnują trzech rzeczy, na których stoi cała zakładka: że surowa
 * transkrypcja zapisuje się osobno od wersji oczyszczonej, że lista folderów
 * jest zamknięta i zawsze pełna, oraz że licznik folderu mówi o zawartości,
 * a nie o wielkości pobranej porcji.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import { czyBladDomeny } from "../src/domain/bledy.js";
import { historiaNotatek, zapiszNotatke } from "../src/domain/notatki.js";

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

const folder = (kategoria: string, ile = 30) =>
  historiaNotatek(db, { ile }).foldery.find((f) => f.kategoria === kategoria)!;

describe("zapis notatki", () => {
  it("trzyma oczyszczoną treść i surową transkrypcję osobno", () => {
    const notatka = zapiszNotatke(db, {
      tresc: "Pojechałem na zebranie, ale nikogo nie było.",
      surowe_wejscie: "no dzisiaj pojechalem do zebranie i nikogo nie bylo i mogłem spać",
      kategoria: "dziennik",
      tytul: "Zebranie bez nikogo",
    });

    expect(notatka.id).toBeGreaterThan(0);
    expect(notatka.tresc).toBe("Pojechałem na zebranie, ale nikogo nie było.");
    expect(notatka.surowe_wejscie).toContain("no dzisiaj pojechalem");
    expect(notatka.kategoria).toBe("dziennik");
    expect(notatka.zrodlo).toBe("czat");
  });

  it("liczy dobę w strefie użytkownika, nie w UTC", () => {
    const notatka = zapiszNotatke(db, {
      tresc: "Późna myśl przed snem.",
      ts: "2026-08-25T21:30:00.000Z",
    });

    // 21:30 UTC to 23:30 w Warszawie — notatka należy jeszcze do 25 sierpnia.
    expect(notatka.data_lokalna).toBe("2026-08-25");
    expect(notatka.godzina).toBe("23:30");
  });

  it("bez podanej kategorii ląduje w worku, zamiast zgadywać folder", () => {
    expect(zapiszNotatke(db, { tresc: "Coś do zapamiętania" }).kategoria).toBe("inne");
  });

  it("pusty tytuł i puste surowe wejście zapisuje jako brak", () => {
    const notatka = zapiszNotatke(db, { tresc: "Bez tytułu", tytul: "   ", surowe_wejscie: "  " });

    expect(notatka.tytul).toBeNull();
    expect(notatka.surowe_wejscie).toBeNull();
  });

  it("przycina zbyt długi tytuł, zamiast odrzucać notatkę", () => {
    const notatka = zapiszNotatke(db, { tresc: "Treść", tytul: "x".repeat(300) });

    expect(notatka.tytul).toHaveLength(120);
  });

  it("odrzuca notatkę bez treści", () => {
    expect(kod(() => zapiszNotatke(db, { tresc: "   " }))).toBe("pusta_tresc");
  });

  it("odrzuca treść dłuższą niż godziny dyktowania", () => {
    expect(kod(() => zapiszNotatke(db, { tresc: "a".repeat(20_001) }))).toBe("za_dluga_notatka");
  });

  it("odrzuca kategorię spoza listy — folder ma być jeden z trzech", () => {
    expect(kod(() => zapiszNotatke(db, { tresc: "Treść", kategoria: "pomysly" as never }))).toBe(
      "zla_kategoria",
    );
  });
});

describe("historia notatek", () => {
  it("pokazuje wszystkie trzy foldery także wtedy, gdy baza jest pusta", () => {
    // Folder, który znika przy zerze, przestaje być folderem — użytkownik nie
    // wie wtedy, gdzie właściwie dyktować.
    expect(historiaNotatek(db).foldery.map((f) => f.kategoria)).toEqual([
      "dziennik",
      "praca",
      "inne",
    ]);
    expect(historiaNotatek(db).foldery.every((f) => f.ile === 0 && f.ostatnia === null)).toBe(true);
  });

  it("układa notatki od najnowszej", () => {
    zapiszNotatke(db, { tresc: "Starsza", kategoria: "praca", ts: "2026-08-20T08:00:00.000Z" });
    zapiszNotatke(db, { tresc: "Nowsza", kategoria: "praca", ts: "2026-08-24T08:00:00.000Z" });

    expect(folder("praca").notatki.map((n) => n.tresc)).toEqual(["Nowsza", "Starsza"]);
    expect(folder("praca").ostatnia).toBe("2026-08-24");
  });

  it("licznik folderu mówi o zawartości, a nie o wielkości porcji", () => {
    for (let i = 0; i < 5; i += 1) {
      zapiszNotatke(db, { tresc: `Notatka ${i}`, kategoria: "dziennik" });
    }

    const dziennik = folder("dziennik", 2);
    expect(dziennik.notatki).toHaveLength(2);
    expect(dziennik.ile).toBe(5);
  });

  it("nie miesza folderów", () => {
    zapiszNotatke(db, { tresc: "Osobista", kategoria: "dziennik" });
    zapiszNotatke(db, { tresc: "Zawodowa", kategoria: "praca" });

    expect(folder("dziennik").notatki.map((n) => n.tresc)).toEqual(["Osobista"]);
    expect(folder("praca").notatki.map((n) => n.tresc)).toEqual(["Zawodowa"]);
    expect(folder("inne").notatki).toHaveLength(0);
  });

  it("porcja poza sensownym zakresem spada na wartość domyślną", () => {
    zapiszNotatke(db, { tresc: "Jedyna" });

    expect(historiaNotatek(db, { ile: 0 }).ile).toBe(1);
    expect(historiaNotatek(db, { ile: 9999 }).ile).toBe(200);
    expect(historiaNotatek(db, { ile: Number.NaN }).ile).toBe(30);
  });
});
