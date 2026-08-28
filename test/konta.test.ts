/**
 * Testy rejestru użytkowników i logiki kont.
 *
 * Najważniejsze są tu dwa dowody bezpieczeństwa: że w bazie nie leży ani
 * jawne hasło, ani jawny token konektora. Wszystko inne — rejestracja,
 * logowanie, rotacja tokenu — jest zwykłą mechaniką wokół tych dwóch zasad.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { otworzBaze, type Baza } from "../src/db/index.js";
import { czyBladDomeny } from "../src/domain/bledy.js";
import {
  nowyTokenKonektora,
  odnotujKonektor,
  sprawdzKodRejestracji,
  uzytkownikPoTokenie,
  zaloguj,
  zarejestruj,
  zmienHaslo,
} from "../src/domain/konta.js";

/** Katalog migracji rejestru liczony od tego pliku — cwd bywa gdzie indziej. */
const MIGRACJE_REJESTRU = fileURLToPath(new URL("../migrations-rejestr/", import.meta.url));

const KOD_BRAMY = "wspolne-haslo-bramy";

function otworzRejestr(): Baza {
  return otworzBaze({ sciezka: ":memory:", katalogMigracji: MIGRACJE_REJESTRU });
}

function zarejestrujTestowo(rejestr: Baza, login = "ania") {
  return zarejestruj(rejestr, {
    kod: KOD_BRAMY,
    login,
    haslo: "sekretne-haslo-anny",
    zgoda: true,
    kodOczekiwany: KOD_BRAMY,
  });
}

describe("brama rejestracji", () => {
  it("przyjmuje poprawny kod", () => {
    expect(sprawdzKodRejestracji(KOD_BRAMY, KOD_BRAMY)).toBe(true);
  });

  it("odrzuca zły kod i pusty kod", () => {
    expect(sprawdzKodRejestracji("zle-haslo", KOD_BRAMY)).toBe(false);
    expect(sprawdzKodRejestracji("", KOD_BRAMY)).toBe(false);
  });

  it("odrzuca wszystko, gdy kod oczekiwany jest pusty — brak konfiguracji nie otwiera bramy", () => {
    expect(sprawdzKodRejestracji("", "")).toBe(false);
  });
});

describe("rejestracja", () => {
  it("zakłada konto i oddaje token konektora dokładnie raz", () => {
    const rejestr = otworzRejestr();
    const wynik = zarejestrujTestowo(rejestr);

    expect(wynik.id).toBeGreaterThan(0);
    expect(wynik.tokenKonektora).toMatch(/^[0-9a-f]{64}$/);
  });

  it("odrzuca zły kod bramy", () => {
    const rejestr = otworzRejestr();
    expect(() =>
      zarejestruj(rejestr, {
        kod: "zly",
        login: "ania",
        haslo: "cokolwiek-dlugiego",
        zgoda: true,
        kodOczekiwany: KOD_BRAMY,
      }),
    ).toThrowError(expect.objectContaining({ name: "BladDomeny" }));
  });

  it("odrzuca rejestrację bez zgody", () => {
    const rejestr = otworzRejestr();
    expect(() =>
      zarejestruj(rejestr, {
        kod: KOD_BRAMY,
        login: "ania",
        haslo: "cokolwiek-dlugiego",
        zgoda: false,
        kodOczekiwany: KOD_BRAMY,
      }),
    ).toThrowError(expect.objectContaining({ name: "BladDomeny" }));
  });

  it("odrzuca zajęty login niezależnie od wielkości liter", () => {
    const rejestr = otworzRejestr();
    zarejestrujTestowo(rejestr, "Ania");

    try {
      zarejestrujTestowo(rejestr, "ania");
      expect.unreachable("druga rejestracja powinna odpaść");
    } catch (blad) {
      expect(czyBladDomeny(blad)).toBe(true);
    }
  });

  it("odrzuca hasło krótsze niż 10 znaków", () => {
    const rejestr = otworzRejestr();
    expect(() =>
      zarejestruj(rejestr, {
        kod: KOD_BRAMY,
        login: "ania",
        haslo: "krotkie",
        zgoda: true,
        kodOczekiwany: KOD_BRAMY,
      }),
    ).toThrowError(expect.objectContaining({ name: "BladDomeny" }));
  });

  it("nie zostawia w bazie ani jawnego hasła, ani jawnego tokenu", () => {
    const rejestr = otworzRejestr();
    const { tokenKonektora } = zarejestrujTestowo(rejestr);

    const wiersz = rejestr
      .prepare<[], Record<string, unknown>>("SELECT * FROM uzytkownicy")
      .get()!;
    const zrzut = JSON.stringify(wiersz);

    expect(zrzut).not.toContain("sekretne-haslo-anny");
    expect(zrzut).not.toContain(tokenKonektora);
  });
});

describe("logowanie", () => {
  it("wpuszcza poprawne hasło i oddaje konto ze strefą", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);

    const konto = zaloguj(rejestr, "ania", "sekretne-haslo-anny");
    expect(konto).not.toBeNull();
    expect(konto!.id).toBe(id);
    expect(konto!.strefa).toBe("Europe/Warsaw");
  });

  it("odrzuca złe hasło i nieznany login tym samym null", () => {
    const rejestr = otworzRejestr();
    zarejestrujTestowo(rejestr);

    expect(zaloguj(rejestr, "ania", "zle-haslo-zupelnie")).toBeNull();
    expect(zaloguj(rejestr, "nie-ma-takiej", "sekretne-haslo-anny")).toBeNull();
  });

  it("nie wpuszcza konta zablokowanego", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);
    rejestr.prepare("UPDATE uzytkownicy SET aktywny = 0 WHERE id = ?").run(id);

    expect(zaloguj(rejestr, "ania", "sekretne-haslo-anny")).toBeNull();
  });
});

describe("token konektora", () => {
  it("znajduje użytkownika po tokenie", () => {
    const rejestr = otworzRejestr();
    const { id, tokenKonektora } = zarejestrujTestowo(rejestr);

    const konto = uzytkownikPoTokenie(rejestr, tokenKonektora);
    expect(konto).not.toBeNull();
    expect(konto!.id).toBe(id);
  });

  it("nie znajduje nikogo po złym tokenie ani po tokenie konta zablokowanego", () => {
    const rejestr = otworzRejestr();
    const { id, tokenKonektora } = zarejestrujTestowo(rejestr);

    expect(uzytkownikPoTokenie(rejestr, "0".repeat(64))).toBeNull();

    rejestr.prepare("UPDATE uzytkownicy SET aktywny = 0 WHERE id = ?").run(id);
    expect(uzytkownikPoTokenie(rejestr, tokenKonektora)).toBeNull();
  });

  it("rotacja unieważnia stary token i wydaje nowy", () => {
    const rejestr = otworzRejestr();
    const { id, tokenKonektora } = zarejestrujTestowo(rejestr);

    const nowy = nowyTokenKonektora(rejestr, id);

    expect(nowy).not.toBe(tokenKonektora);
    expect(uzytkownikPoTokenie(rejestr, tokenKonektora)).toBeNull();
    expect(uzytkownikPoTokenie(rejestr, nowy)!.id).toBe(id);
  });

  it("odnotowuje ostatnie użycie — zasilanie wskaźnika „połączono”", () => {
    const rejestr = otworzRejestr();
    const { id, tokenKonektora } = zarejestrujTestowo(rejestr);

    odnotujKonektor(rejestr, id, "2026-08-28T10:00:00.000Z");

    const konto = uzytkownikPoTokenie(rejestr, tokenKonektora);
    expect(konto!.ostatnie_uzycie_konektora).toBe("2026-08-28T10:00:00.000Z");
  });
});

describe("zmiana hasła", () => {
  it("stare hasło przestaje działać, nowe działa", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);

    zmienHaslo(rejestr, id, "nowe-haslo-anny-123");

    expect(zaloguj(rejestr, "ania", "sekretne-haslo-anny")).toBeNull();
    expect(zaloguj(rejestr, "ania", "nowe-haslo-anny-123")!.id).toBe(id);
  });

  it("zmienia hasz w bazie — sesje podpisane starym haszem tracą ważność", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);
    const przed = rejestr
      .prepare<[number], { hasz_hasla: string }>("SELECT hasz_hasla FROM uzytkownicy WHERE id = ?")
      .get(id)!.hasz_hasla;

    zmienHaslo(rejestr, id, "nowe-haslo-anny-123");

    const po = rejestr
      .prepare<[number], { hasz_hasla: string }>("SELECT hasz_hasla FROM uzytkownicy WHERE id = ?")
      .get(id)!.hasz_hasla;
    expect(po).not.toBe(przed);
  });

  it("odrzuca hasło krótsze niż 10 znaków", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);

    expect(() => zmienHaslo(rejestr, id, "krotkie")).toThrowError(
      expect.objectContaining({ name: "BladDomeny" }),
    );
  });
});
