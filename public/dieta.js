/**
 * Zakładka Dieta — historia posiłków pogrupowana po dniach.
 *
 * Czysty moduł na wzór raporty.js: bez DOM, bez sieci i bez ocen domenowych —
 * renderuje liczby, które przyszły z serwera (po nałożeniu kolejki offline),
 * niczego nie wylicza poza sklejeniem tekstu. Stan (rozwinięty dzień, posiłek
 * w edycji) przychodzi parametrami z app.js i tam mieszka.
 */

import { etykietaDnia } from "./kalendarz.js";
import { wpisPosilku } from "./posilek.js";

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const zaokr = (liczba) => Math.round(Number(liczba) || 0);

/**
 * Pasek trafienia w cel — jedyny znak, po którym dzień diety da się ocenić
 * rzutem oka. Bez niego wiersz mówi „2310 / 2600 kcal" i porównanie trzeba
 * zrobić w głowie, dzień po dniu.
 *
 * Świadomie NIE ocenia: rysuje udział zjedzonych kalorii w celu i nic więcej.
 * Werdykt „w celu / poza celem" przychodzi gotowy z serwera na ekranie Postępy
 * i tylko tam ma prawo paść — tutaj kolor ostrzegawczy pojawia się wyłącznie
 * przy jawnym przekroczeniu celu, tak samo jak w pasku makro na Dziś.
 */
function pasekDnia(d) {
  if (!d.cel_kcal) return "";

  const udzial = (zaokr(d.spozyte.kcal) / zaokr(d.cel_kcal)) * 100;
  return `<span class="pasek ${udzial > 100 ? "przekroczony" : ""}">
            <span style="width:${Math.min(100, Math.max(0, udzial)).toFixed(1)}%"></span>
          </span>`;
}

function kartaDnia(d, rozwiniety, edytowanyPosilek, dzisiaj) {
  const cel = d.cel_kcal ? ` / ${zaokr(d.cel_kcal)}` : "";

  return `
    <div class="dzien ${rozwiniety ? "rozwiniety" : ""}">
      <button class="naglowek-dnia" data-dzien-diety="${esc(d.data)}"
              aria-expanded="${rozwiniety ? "true" : "false"}">
        <span class="opis-dnia">
          <span class="data">${etykietaDnia(d.data, dzisiaj)}</span>
          <span class="liczby-dnia">${zaokr(d.spozyte.kcal)}${cel} kcal · B ${zaokr(d.spozyte.bialko_g)} · W ${zaokr(d.spozyte.wegle_g)} · T ${zaokr(d.spozyte.tluszcz_g)}</span>
          ${pasekDnia(d)}
        </span>
        <span class="szewron" aria-hidden="true"></span>
      </button>
      ${
        rozwiniety
          ? `<div class="wpisy-dnia">${d.posilki.map((p) => wpisPosilku(p, edytowanyPosilek)).join("")}</div>`
          : ""
      }
    </div>`;
}

export function ekranDieta(historia, rozwinietyDzien, edytowanyPosilek, dzisiaj) {
  // Jak w zakładce Aktywności: dociążenie listy, nie akcja główna ekranu.
  const starsze = `
    <div class="przyciski dociazenie">
      <button class="przycisk cichy" data-starsze-diety>Pokaż starsze ↓</button>
    </div>`;

  if (!historia?.dni?.length) {
    return `
      <section class="karta">
        <div class="pusto">Żadnych posiłków od ${esc(historia?.od ?? "")} — historia zacznie się od pierwszego zapisu.</div>
      </section>
      ${starsze}`;
  }

  // Jedna karta na całą listę — powód ten sam co przy historii ruchu: stos
  // jednakowych pudełek to rytm bez hierarchii.
  return `<section class="karta lista-dni">
      ${historia.dni
        .map((d) => kartaDnia(d, d.data === rozwinietyDzien, edytowanyPosilek, dzisiaj))
        .join("")}
    </section>
    ${starsze}`;
}
