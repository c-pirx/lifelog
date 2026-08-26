/**
 * Timer przerwy. Sama arytmetyka — rysowanie zostaje w `app.js` i wymaga oka.
 *
 * Kafelki podają CAŁKOWITY czas przerwy, nie dokładkę: po 90 sekundach
 * stuknięcie w 120 ma dać 30 sekund, a nie kolejne dwie minuty.
 */

import { describe, expect, it } from "vitest";

import { stanPrzerwy, trwanieWTekscie } from "../public/przerwa.js";

const KROKI = [90, 120, 180];
const START = 1_000_000;
const po = (sekundy: number) => START + sekundy * 1000;

const widoczne = (start: number | null, cel: number | null, teraz: number) =>
  stanPrzerwy(start, cel, teraz, KROKI)
    .kafelki.filter((k) => k.widoczny)
    .map((k) => k.sekundy);

describe("timer przerwy", () => {
  it("odlicza do końca wybranej przerwy", () => {
    expect(stanPrzerwy(START, 120, po(30), KROKI)).toMatchObject({ pozostalo: 90, gotowe: false });
  });

  it("melduje gotowość, gdy czas minął", () => {
    expect(stanPrzerwy(START, 90, po(90), KROKI)).toMatchObject({ pozostalo: 0, gotowe: true });
  });

  it("nie schodzi poniżej zera, gdy przerwa się przeciągnęła", () => {
    expect(stanPrzerwy(START, 90, po(300), KROKI).pozostalo).toBe(0);
  });

  it("chowa kafelek, którego czas już minął, i zostawia dłuższe", () => {
    expect(widoczne(START, 90, po(90))).toEqual([120, 180]);
  });

  it("dłuższy kafelek dokłada różnicę, a nie pełny czas od nowa", () => {
    // Użytkownik wybrał 90, doczekał końca i sięga po 120 — zostaje mu 30 s.
    expect(stanPrzerwy(START, 120, po(90), KROKI)).toMatchObject({ pozostalo: 30, gotowe: false });
  });

  it("po przekroczeniu wszystkich kroków nie zostaje żaden kafelek", () => {
    expect(widoczne(START, 180, po(180))).toEqual([]);
  });

  it("zaznacza kafelek odpowiadający bieżącemu celowi", () => {
    const stan = stanPrzerwy(START, 120, po(10), KROKI);
    expect(stan.kafelki.filter((k) => k.wybrany).map((k) => k.sekundy)).toEqual([120]);
  });

  it("bez rozpoczętej przerwy nie ma czego liczyć", () => {
    expect(stanPrzerwy(null, null, po(10), KROKI)).toMatchObject({ pozostalo: 0, gotowe: false });
    expect(widoczne(null, null, po(10))).toEqual(KROKI);
  });
});

describe("czas trwania treningu", () => {
  it("pokazuje minuty i sekundy przez pierwszą godzinę", () => {
    expect(trwanieWTekscie(0)).toBe("0:00");
    expect(trwanieWTekscie(95)).toBe("1:35");
    expect(trwanieWTekscie(3599)).toBe("59:59");
  });

  it("dokłada godziny dopiero wtedy, gdy są", () => {
    expect(trwanieWTekscie(3600)).toBe("1:00:00");
    expect(trwanieWTekscie(3725)).toBe("1:02:05");
  });

  it("ujemny czas czyta jako zero", () => {
    // Sesja otwarta przez czat mogła powstać z czasem, który zegar telefonu
    // ma jeszcze przed sobą. Licznik lecący wstecz wyglądałby na awarię.
    expect(trwanieWTekscie(-30)).toBe("0:00");
  });
});
