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
  aktywneKonta,
  kontoPoId,
  nowyTokenKonektora,
  odnotujKonektor,
  sekretSesjiDla,
  utworzKonto,
  uzytkownikPoTokenie,
  zaloguj,
  zmienHaslo,
} from "../src/domain/konta.js";

/** Katalog migracji rejestru liczony od tego pliku — cwd bywa gdzie indziej. */
const MIGRACJE_REJESTRU = fileURLToPath(new URL("../migrations-rejestr/", import.meta.url));

function otworzRejestr(): Baza {
  return otworzBaze({ sciezka: ":memory:", katalogMigracji: MIGRACJE_REJESTRU });
}

function zarejestrujTestowo(rejestr: Baza, login = "ania") {
  return utworzKonto(rejestr, { login, haslo: "sekretne-haslo-anny", zgoda: true });
}

// Wpuszczaniem do rejestracji zajmuje się lista oczekujących, nie ten plik —
// jednorazowe kody mają własne testy w `lista.test.ts`.
describe("zakładanie konta", () => {
  it("zakłada konto i oddaje token konektora dokładnie raz", () => {
    const rejestr = otworzRejestr();
    const wynik = zarejestrujTestowo(rejestr);

    expect(wynik.id).toBeGreaterThan(0);
    expect(wynik.tokenKonektora).toMatch(/^[0-9a-f]{64}$/);
  });

  it("odrzuca założenie konta bez zgody", () => {
    const rejestr = otworzRejestr();
    expect(() =>
      utworzKonto(rejestr, { login: "ania", haslo: "cokolwiek-dlugiego", zgoda: false }),
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
      utworzKonto(rejestr, { login: "ania", haslo: "krotkie", zgoda: true }),
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

describe("sekret sesji i odczyt konta", () => {
  it("sekret sesji zawiera hasz hasła i zmienia się po zmianie hasła", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);

    const przed = sekretSesjiDla(rejestr, id, "sekret-bazowy");
    zmienHaslo(rejestr, id, "nowe-haslo-anny-123");
    const po = sekretSesjiDla(rejestr, id, "sekret-bazowy");

    expect(przed).not.toBeNull();
    expect(po).not.toBeNull();
    expect(po).not.toBe(przed);
  });

  it("oddaje null dla nieznanego i zablokowanego konta — sesja przestaje działać", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);

    expect(sekretSesjiDla(rejestr, 999, "sekret-bazowy")).toBeNull();

    rejestr.prepare("UPDATE uzytkownicy SET aktywny = 0 WHERE id = ?").run(id);
    expect(sekretSesjiDla(rejestr, id, "sekret-bazowy")).toBeNull();
  });

  it("aktywneKonta pomija zablokowane — harmonogram nie generuje im raportów", () => {
    const rejestr = otworzRejestr();
    zarejestrujTestowo(rejestr, "ania");
    const { id: idTomka } = zarejestrujTestowo(rejestr, "tomek");
    rejestr.prepare("UPDATE uzytkownicy SET aktywny = 0 WHERE id = ?").run(idTomka);

    expect(aktywneKonta(rejestr).map((k) => k.login)).toEqual(["ania"]);
  });

  it("kontoPoId oddaje konto ze strefą, a null dla zablokowanego", () => {
    const rejestr = otworzRejestr();
    const { id } = zarejestrujTestowo(rejestr);

    const konto = kontoPoId(rejestr, id);
    expect(konto).not.toBeNull();
    expect(konto!.login).toBe("ania");
    expect(konto!.strefa).toBe("Europe/Warsaw");

    rejestr.prepare("UPDATE uzytkownicy SET aktywny = 0 WHERE id = ?").run(id);
    expect(kontoPoId(rejestr, id)).toBeNull();
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
