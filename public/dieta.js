/**
 * Zakładka Dieta — historia posiłków pogrupowana po dniach.
 *
 * Czysty moduł na wzór raporty.js: bez DOM, bez sieci i bez ocen domenowych —
 * renderuje liczby, które przyszły z serwera (po nałożeniu kolejki offline),
 * niczego nie wylicza poza sklejeniem tekstu. Stan (rozwinięty dzień, posiłek
 * w edycji) przychodzi parametrami z app.js i tam mieszka.
 */

import { wpisPosilku } from "./posilek.js";

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const zaokr = (liczba) => Math.round(Number(liczba) || 0);

const DNI_TYGODNIA = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

/** „wt 25.08", a dla dzisiejszego dnia z dopiskiem — żeby lista miała kotwicę. */
function etykietaDnia(data, dzisiaj) {
  // Południe UTC: ta sama data w każdej strefie — ten sam trik co przy wykresach.
  const chwila = new Date(`${data}T12:00:00Z`);
  const [, miesiac, dzien] = data.split("-");
  const podstawa = `${DNI_TYGODNIA[chwila.getUTCDay()]} ${dzien}.${miesiac}`;
  return data === dzisiaj ? `${podstawa} · dziś` : podstawa;
}

function kartaDnia(d, rozwiniety, edytowanyPosilek, dzisiaj) {
  const cel = d.cel_kcal ? ` / ${zaokr(d.cel_kcal)}` : "";

  return `
    <section class="karta">
      <button class="dzien-diety ${rozwiniety ? "rozwiniety" : ""}" data-dzien-diety="${esc(d.data)}">
        <span class="data">${etykietaDnia(d.data, dzisiaj)}</span>
        <span class="liczby-dnia">${zaokr(d.spozyte.kcal)}${cel} kcal · B ${zaokr(d.spozyte.bialko_g)} · W ${zaokr(d.spozyte.wegle_g)} · T ${zaokr(d.spozyte.tluszcz_g)}</span>
      </button>
      ${rozwiniety ? d.posilki.map((p) => wpisPosilku(p, edytowanyPosilek)).join("") : ""}
    </section>`;
}

export function ekranDieta(historia, rozwinietyDzien, edytowanyPosilek, dzisiaj) {
  const starsze = `
    <div class="przyciski">
      <button class="przycisk pelny" data-starsze-diety>Pokaż starsze</button>
    </div>`;

  if (!historia?.dni?.length) {
    return `
      <section class="karta">
        <div class="pusto">Żadnych posiłków od ${esc(historia?.od ?? "")} — historia zacznie się od pierwszego zapisu.</div>
      </section>
      ${starsze}`;
  }

  return `${historia.dni
    .map((d) => kartaDnia(d, d.data === rozwinietyDzien, edytowanyPosilek, dzisiaj))
    .join("")}
    ${starsze}`;
}
