/**
 * Błąd wynikający z reguł domeny, a nie z awarii techniczej.
 *
 * Adaptery (MCP, REST) tłumaczą go na czytelny komunikat dla użytkownika
 * zamiast pokazywać ślad stosu.
 */
export class BladDomeny extends Error {
  constructor(
    komunikat: string,
    readonly kod: string = "blad_domeny",
  ) {
    super(komunikat);
    this.name = "BladDomeny";
  }
}

export function czyBladDomeny(blad: unknown): blad is BladDomeny {
  return blad instanceof BladDomeny;
}
