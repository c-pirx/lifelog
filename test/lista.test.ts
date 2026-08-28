/**
 * Testy listy oczekujących: od adresu e-mail do konta.
 *
 * Najważniejsze są trzy dowody, każdy pilnujący innej obietnicy:
 *  - jeden adres dostaje najwyżej JEDNĄ wiadomość powitalną (inaczej formularz
 *    byłby działkiem na cudzą skrzynkę),
 *  - kod zaproszenia da się zużyć DOKŁADNIE RAZ,
 *  - w rejestrze nie leży ani jawny kod, ani jawny token wypisu.
 *
 * Poczta jest atrapą zbierającą wiadomości do tablicy — żaden test nie dobija
 * się do internetu.
 */

import { serve } from "@hono/node-server";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { utworzApp } from "../src/app.js";
import { otworzBaze, type Baza } from "../src/db/index.js";
import { utworzPule, type PulaBaz } from "../src/db/pula.js";
import { czyBladDomeny } from "../src/domain/bledy.js";
import { zaloguj } from "../src/domain/konta.js";
import {
  liczbaZapisanych,
  tokenWypisu,
  usunZListy,
  wpisyListy,
  wypiszZListy,
  zapiszNaListe,
  zapros,
  zarejestrujZKodem,
  WAZNOSC_ZAPROSZENIA_DNI,
} from "../src/domain/lista.js";
import { wiadomoscZaproszenie } from "../src/domain/wiadomosci.js";
import type { Poczta, Wiadomosc } from "../src/lib/poczta.js";

const MIGRACJE_REJESTRU = fileURLToPath(new URL("../migrations-rejestr/", import.meta.url));
const SEKRET = "sekret-sesji-dla-testow-listy";
const ADRES_PUBLICZNY = "https://przyklad.test";

function otworzRejestr(): Baza {
  return otworzBaze({ sciezka: ":memory:", katalogMigracji: MIGRACJE_REJESTRU });
}

/** Poczta, która niczego nie wysyła — tylko zapamiętuje, co miało pójść. */
function atrapaPoczty(): Poczta & { wyslane: Wiadomosc[] } {
  const wyslane: Wiadomosc[] = [];
  return {
    wyslane,
    wlaczona: true,
    async wyslij(wiadomosc: Wiadomosc): Promise<void> {
      wyslane.push(wiadomosc);
    },
  };
}

// === Domena ==============================================================

describe("zapis na listę", () => {
  it("zapisuje nowy adres i zwraca długość listy", () => {
    const rejestr = otworzRejestr();
    const wynik = zapiszNaListe(rejestr, { email: "Ania@Przyklad.PL", zgoda: true });

    expect(wynik.nowy).toBe(true);
    // Adres znormalizowany, mimo COLLATE NOCASE: wraca do człowieka w mailu.
    expect(wynik.wpis?.email).toBe("ania@przyklad.pl");
    expect(wynik.lacznie).toBe(1);
  });

  it("przy duplikacie nie tworzy drugiego wiersza i mówi, że nic nowego nie powstało", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });
    const drugi = zapiszNaListe(rejestr, { email: "ANIA@przyklad.pl", zgoda: true });

    expect(drugi.nowy).toBe(false);
    expect(wpisyListy(rejestr)).toHaveLength(1);
  });

  it("połyka wypełnioną pułapkę bez zapisu i bez błędu", () => {
    const rejestr = otworzRejestr();
    const wynik = zapiszNaListe(rejestr, {
      email: "bot@przyklad.pl",
      zgoda: true,
      pulapka: "Sp. z o.o.",
    });

    expect(wynik.nowy).toBe(false);
    expect(wpisyListy(rejestr)).toHaveLength(0);
  });

  it("połyka formularz wysłany szybciej, niż zdąży go wypełnić człowiek", () => {
    const rejestr = otworzRejestr();
    const teraz = new Date("2026-08-28T10:00:00Z");
    const wynik = zapiszNaListe(
      rejestr,
      { email: "bot@przyklad.pl", zgoda: true, otwarto: teraz.getTime() - 300 },
      { teraz },
    );

    expect(wynik.nowy).toBe(false);
    expect(wpisyListy(rejestr)).toHaveLength(0);
  });

  it("licznik rośnie z zapisem i maleje z wypisem — pokazuje stan, nie historię", () => {
    const rejestr = otworzRejestr();
    expect(liczbaZapisanych(rejestr)).toBe(0);

    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });
    zapiszNaListe(rejestr, { email: "bartek@przyklad.pl", zgoda: true });
    expect(liczbaZapisanych(rejestr)).toBe(2);

    usunZListy(rejestr, "ania@przyklad.pl");
    expect(liczbaZapisanych(rejestr)).toBe(1);
  });

  it("odrzuca brak zgody i adres bez sensu — o tym mówimy wprost", () => {
    const rejestr = otworzRejestr();
    expect(() => zapiszNaListe(rejestr, { email: "a@b.pl", zgoda: false })).toThrowError(
      expect.objectContaining({ name: "BladDomeny" }),
    );
    expect(() => zapiszNaListe(rejestr, { email: "to nie adres", zgoda: true })).toThrowError(
      expect.objectContaining({ name: "BladDomeny" }),
    );
  });
});

describe("wypis z listy", () => {
  it("kasuje wiersz, a nie oznacza go", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });

    const token = tokenWypisu("ania@przyklad.pl", SEKRET);
    expect(wypiszZListy(rejestr, token, SEKRET)).toBe(true);
    expect(wpisyListy(rejestr)).toHaveLength(0);
  });

  it("nie wywraca się na tokenie podrobionym ani na cudzym sekrecie", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });

    expect(wypiszZListy(rejestr, "zupelnie-zmyslony", SEKRET)).toBe(false);
    expect(wypiszZListy(rejestr, tokenWypisu("ania@przyklad.pl", "inny-sekret"), SEKRET)).toBe(
      false,
    );
    expect(wpisyListy(rejestr)).toHaveLength(1);
  });

  it("działa mimo wielkości liter w adresie z linku", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });

    expect(wypiszZListy(rejestr, tokenWypisu("Ania@Przyklad.pl", SEKRET), SEKRET)).toBe(true);
  });
});

describe("zaproszenie", () => {
  it("wydaje kod i przestawia wpis na „zaproszony”", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });

    const zaproszenie = zapros(rejestr, "ania@przyklad.pl");
    expect(zaproszenie.kod.length).toBeGreaterThan(20);
    expect(wpisyListy(rejestr)[0]?.stan).toBe("zaproszony");
  });

  it("odmawia zapraszania adresu spoza listy", () => {
    const rejestr = otworzRejestr();
    expect(() => zapros(rejestr, "nieznany@przyklad.pl")).toThrowError(
      expect.objectContaining({ name: "BladDomeny" }),
    );
  });

  it("nie zostawia w rejestrze ani jawnego kodu, ani jawnego tokenu wypisu", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });
    const { kod } = zapros(rejestr, "ania@przyklad.pl");

    const zrzut = JSON.stringify(
      rejestr.prepare<[], Record<string, unknown>>("SELECT * FROM lista_oczekujacych").get()!,
    );

    expect(zrzut).not.toContain(kod);
    expect(zrzut).not.toContain(tokenWypisu("ania@przyklad.pl", SEKRET));
  });
});

describe("rejestracja z kodu zaproszenia", () => {
  function zaproszony(rejestr: Baza, email = "ania@przyklad.pl"): string {
    zapiszNaListe(rejestr, { email, zgoda: true });
    return zapros(rejestr, email).kod;
  }

  it("zakłada konto i wiąże je z wpisem na liście", () => {
    const rejestr = otworzRejestr();
    const kod = zaproszony(rejestr);

    const wynik = zarejestrujZKodem(rejestr, {
      kod,
      login: "ania",
      haslo: "haslo-anny-dlugie",
      zgoda: true,
    });

    expect(wynik.tokenKonektora).toMatch(/^[0-9a-f]{64}$/);
    expect(zaloguj(rejestr, "ania", "haslo-anny-dlugie")?.id).toBe(wynik.id);
    expect(wpisyListy(rejestr)[0]?.stan).toBe("zarejestrowany");
  });

  it("zużywa kod dokładnie raz", () => {
    const rejestr = otworzRejestr();
    const kod = zaproszony(rejestr);
    zarejestrujZKodem(rejestr, { kod, login: "ania", haslo: "haslo-anny-dlugie", zgoda: true });

    try {
      zarejestrujZKodem(rejestr, { kod, login: "tomek", haslo: "haslo-tomka-dlugie", zgoda: true });
      expect.unreachable("drugie użycie kodu powinno odpaść");
    } catch (blad) {
      expect(czyBladDomeny(blad)).toBe(true);
    }
  });

  it("odrzuca kod po terminie ważności", () => {
    const rejestr = otworzRejestr();
    const kod = zaproszony(rejestr);

    const poTerminie = new Date(
      Date.now() + (WAZNOSC_ZAPROSZENIA_DNI + 1) * 24 * 60 * 60 * 1000,
    );
    expect(() =>
      zarejestrujZKodem(
        rejestr,
        { kod, login: "ania", haslo: "haslo-anny-dlugie", zgoda: true },
        { teraz: poTerminie },
      ),
    ).toThrowError(expect.objectContaining({ kod: "kod_wygasl" }));
  });

  it("odrzuca kod zmyślony i pusty", () => {
    const rejestr = otworzRejestr();
    for (const kod of ["zmyslony", ""]) {
      expect(() =>
        zarejestrujZKodem(rejestr, { kod, login: "ktos", haslo: "haslo-dlugie-123", zgoda: true }),
      ).toThrowError(expect.objectContaining({ kod: "zly_kod_rejestracji" }));
    }
  });

  it("nie zostawia konta, gdy zakładanie odpadnie w połowie", () => {
    const rejestr = otworzRejestr();
    const kod = zaproszony(rejestr);

    // Za krótkie hasło odpada już w `utworzKonto`, więc transakcja się cofa —
    // wpis musi zostać zaproszony, a nie zużyty.
    expect(() =>
      zarejestrujZKodem(rejestr, { kod, login: "ania", haslo: "krotkie", zgoda: true }),
    ).toThrowError(expect.objectContaining({ name: "BladDomeny" }));

    expect(wpisyListy(rejestr)[0]?.stan).toBe("zaproszony");
    expect(
      zarejestrujZKodem(rejestr, { kod, login: "ania", haslo: "haslo-anny-dlugie", zgoda: true }).id,
    ).toBeGreaterThan(0);
  });
});

describe("treść maila z zaproszeniem", () => {
  it("niesie link do rejestracji i link wypisu", () => {
    const wiadomosc = wiadomoscZaproszenie({
      email: "ania@przyklad.pl",
      imie: "Ania",
      kod: "kod-abc",
      waznoscDni: WAZNOSC_ZAPROSZENIA_DNI,
      tokenWypisu: "token-xyz",
      adresy: { publiczny: ADRES_PUBLICZNY },
    });

    expect(wiadomosc.odbiorca).toBe("ania@przyklad.pl");
    for (const tresc of [wiadomosc.tekst, wiadomosc.html]) {
      expect(tresc).toContain(`${ADRES_PUBLICZNY}/app?kod=kod-abc`);
      expect(tresc).toContain(`${ADRES_PUBLICZNY}/api/lista/wypis/token-xyz`);
    }
  });
});

// === Trasa =============================================================

describe("POST /api/lista", () => {
  let rejestr: Baza;
  let pula: PulaBaz;
  let katalogPuli: string;
  let serwer: ReturnType<typeof serve>;
  let adres: string;
  let poczta: ReturnType<typeof atrapaPoczty>;

  beforeEach(async () => {
    rejestr = otworzRejestr();
    katalogPuli = mkdtempSync(join(tmpdir(), "lista-test-"));
    pula = utworzPule({ katalog: katalogPuli });
    poczta = atrapaPoczty();

    const app = utworzApp(
      { rejestr, pula },
      {
        sekretSesji: SEKRET,
        strefa: "Europe/Warsaw",
        ciasteczkoTylkoHttps: false,
        poczta: { transport: poczta, adresPubliczny: ADRES_PUBLICZNY, gospodarz: "ja@przyklad.pl" },
      },
    );

    serwer = serve({ fetch: app.fetch, port: 0 });
    await new Promise((gotowe) => serwer.once("listening", gotowe));
    adres = `http://127.0.0.1:${(serwer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    serwer.close();
    pula.zamknij();
    rmSync(katalogPuli, { recursive: true, force: true });
  });

  async function zapisz(dane: Record<string, unknown>): Promise<Response> {
    return fetch(`${adres}/api/lista`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dane),
    });
  }

  it("zapisuje adres i wysyła dwie wiadomości: powitanie i powiadomienie", async () => {
    expect((await zapisz({ email: "ania@przyklad.pl", zgoda: true })).status).toBe(201);

    expect(wpisyListy(rejestr)).toHaveLength(1);
    expect(poczta.wyslane.map((w) => w.odbiorca)).toEqual([
      "ania@przyklad.pl",
      "ja@przyklad.pl",
    ]);
    // Link wypisu musi trafić do maila — to jedyne miejsce, gdzie człowiek
    // może go dostać.
    expect(poczta.wyslane[0]?.tekst).toContain(`${ADRES_PUBLICZNY}/api/lista/wypis/`);
  });

  it("na duplikat odpowiada tak samo, ale nie wysyła drugiego maila", async () => {
    await zapisz({ email: "ania@przyklad.pl", zgoda: true });
    poczta.wyslane.length = 0;

    expect((await zapisz({ email: "ania@przyklad.pl", zgoda: true })).status).toBe(201);
    expect(poczta.wyslane).toHaveLength(0);
  });

  it("na bota odpowiada tak samo i nie robi nic", async () => {
    expect(
      (await zapisz({ email: "bot@przyklad.pl", zgoda: true, pulapka: "cokolwiek" })).status,
    ).toBe(201);

    expect(wpisyListy(rejestr)).toHaveLength(0);
    expect(poczta.wyslane).toHaveLength(0);
  });

  it("link wypisu z maila kasuje wpis, a nieznany token kończy się tak samo", async () => {
    await zapisz({ email: "ania@przyklad.pl", zgoda: true });
    const token = tokenWypisu("ania@przyklad.pl", SEKRET);

    const wypis = await fetch(`${adres}/api/lista/wypis/${token}`, { redirect: "manual" });
    expect(wypis.status).toBe(302);
    expect(wypis.headers.get("location")).toBe("/wypisano.html");
    expect(wpisyListy(rejestr)).toHaveLength(0);

    const nieznany = await fetch(`${adres}/api/lista/wypis/nieistniejacy`, { redirect: "manual" });
    expect(nieznany.status).toBe(302);
    expect(nieznany.headers.get("location")).toBe("/wypisano.html");
  });

  it("zapis na listę nie wymaga sesji, a lista nie jest widoczna przez API", async () => {
    await zapisz({ email: "ania@przyklad.pl", zgoda: true });

    // Listę ogląda się wyłącznie przez `npm run lista`. Gdyby kiedyś powstała
    // trasa GET, ten test ma o tym przypomnieć.
    expect((await fetch(`${adres}/api/lista`)).status).toBe(401);
  });

  it("licznik jest publiczny i zdradza wyłącznie liczbę", async () => {
    await zapisz({ email: "ania@przyklad.pl", zgoda: true });
    await zapisz({ email: "bartek@przyklad.pl", zgoda: true });

    const odpowiedz = await fetch(`${adres}/api/lista/licznik`);
    expect(odpowiedz.status).toBe(200);
    // Dokładnie jeden klucz: gdyby odpowiedź kiedyś urosła, ten test ma
    // zmusić do zastanowienia, czy nowe pole nie zdradza za dużo.
    expect(await odpowiedz.json()).toEqual({ zapisanych: 2 });
  });
});

describe("administracja z wiersza poleceń", () => {
  it("usuwa wpis po adresie i mówi, gdy nie było czego usuwać", () => {
    const rejestr = otworzRejestr();
    zapiszNaListe(rejestr, { email: "ania@przyklad.pl", zgoda: true });

    expect(usunZListy(rejestr, "ANIA@przyklad.pl")).toBe(true);
    expect(usunZListy(rejestr, "ania@przyklad.pl")).toBe(false);
  });
});
