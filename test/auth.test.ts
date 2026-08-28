/**
 * Testy tokenu sesji. Dotąd token niósł tylko czas wydania — przy wielu
 * użytkownikach musi nieść też, CZYJA to sesja, a podpis musi zależeć od
 * hasza hasła: zmiana hasła unieważnia wtedy wszystkie stare sesje bez
 * tabeli sesji.
 */

import { describe, expect, it } from "vitest";

import { odczytajToken, utworzToken, WAZNOSC_SESJI_DNI } from "../src/auth.js";

const SEKRET_ANI = "sekret-bazowy" + "hasz-hasla-ani";
const SEKRET_TOMKA = "sekret-bazowy" + "hasz-hasla-tomka";

/** Sekret per użytkownik, jak w rejestrze: 1 → Ania, 2 → Tomek. */
function sekretDla(id: number): string | null {
  if (id === 1) return SEKRET_ANI;
  if (id === 2) return SEKRET_TOMKA;
  return null;
}

describe("token sesji", () => {
  it("odczyt oddaje identyfikator użytkownika, z którym go wydano", () => {
    const token = utworzToken(SEKRET_ANI, 1);
    expect(odczytajToken(token, sekretDla)).toBe(1);
  });

  it("odrzuca token podpisany sekretem innego użytkownika — kradzież cudzej sesji przez podmianę id", () => {
    // Napastnik z ważnym tokenem Ani podmienia w ładunku id na 2.
    const token = utworzToken(SEKRET_ANI, 1);
    const [ladunekAni, podpisAni] = token.split(".");
    const ladunekPodmieniony = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(ladunekAni!, "base64url").toString()), uzytkownik: 2 }),
    ).toString("base64url");

    expect(odczytajToken(`${ladunekPodmieniony}.${podpisAni}`, sekretDla)).toBeNull();
  });

  it("odrzuca token użytkownika, którego już nie ma (sekret null)", () => {
    const token = utworzToken("jakis-sekret", 99);
    expect(odczytajToken(token, sekretDla)).toBeNull();
  });

  it("odrzuca token po zmianie hasła — sekret przestał pasować", () => {
    const token = utworzToken(SEKRET_ANI, 1);
    const poZmianie = (id: number) => (id === 1 ? "sekret-bazowy" + "hasz-nowego-hasla" : null);
    expect(odczytajToken(token, poZmianie)).toBeNull();
  });

  it("odrzuca token przeterminowany i z przyszłości", () => {
    const teraz = Date.now();
    const zaStary = utworzToken(SEKRET_ANI, 1, teraz - (WAZNOSC_SESJI_DNI * 24 * 60 * 60 * 1000 + 1000));
    const zPrzyszlosci = utworzToken(SEKRET_ANI, 1, teraz + 60_000);

    expect(odczytajToken(zaStary, sekretDla, teraz)).toBeNull();
    expect(odczytajToken(zPrzyszlosci, sekretDla, teraz)).toBeNull();
  });

  it("odrzuca śmieci: pusty token, brak podpisu, ładunek niebędący JSON-em", () => {
    expect(odczytajToken("", sekretDla)).toBeNull();
    expect(odczytajToken("samladunekbezkropki", sekretDla)).toBeNull();
    expect(odczytajToken("nie-json.podpis", sekretDla)).toBeNull();
  });

  it("odrzuca ładunek bez pola uzytkownik — token starego formatu nie loguje na żadne konto", () => {
    const ladunek = Buffer.from(JSON.stringify({ wydano: Date.now() })).toString("base64url");
    // Stary format nie zna użytkownika, więc nie da się nawet wskazać sekretu.
    expect(odczytajToken(`${ladunek}.jakis-podpis`, sekretDla)).toBeNull();
  });
});
