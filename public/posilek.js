/**
 * Wpis posiłku — jeden renderer dla ekranu Dziś i zakładki Dieta.
 *
 * Moduł jest czysty (bez DOM, bez sieci), jak raporty.js — ale w odróżnieniu
 * od niego jest WSPÓLNY: edycja posiłku ma działać identycznie na obu
 * ekranach, a zduplikowany formularz prędzej czy później by się rozjechał.
 * Stan (id posiłku otwartego do edycji) przychodzi parametrem z app.js.
 *
 * Granica „wyczyść rozbicie vs nie ruszaj" w żądaniu poprawki leży na
 * obecności klucza `pozycje` — stąd atrybut data-mial-pozycje na formularzu:
 * bez niego skasowanie wszystkich wierszy nie dałoby się odróżnić od
 * formularza posiłku, który rozbicia nigdy nie miał.
 */

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const zaokr = (liczba) => Math.round(Number(liczba) || 0);

/** Pola posiłku — wspólne dla dopisywania i poprawiania. */
export function polaPosilku(p = {}, idPrzedrostek = "") {
  const id = (nazwa) => `${idPrzedrostek}${nazwa}`;

  return `
    <div class="szeroko">
      <label for="${id("opis")}">Co zjadłeś</label>
      <input id="${id("opis")}" name="opis" required autocomplete="off" value="${esc(p.opis ?? "")}" />
    </div>
    <div>
      <label for="${id("kcal")}">Kalorie</label>
      <input id="${id("kcal")}" name="kcal" inputmode="decimal" required value="${p.kcal ?? ""}" />
    </div>
    <div>
      <label for="${id("godzina")}">Godzina</label>
      <input id="${id("godzina")}" name="godzina" inputmode="numeric" placeholder="teraz" value="${esc(p.godzina ?? "")}" />
    </div>
    <div>
      <label for="${id("bialko")}">Białko (g)</label>
      <input id="${id("bialko")}" name="bialko_g" inputmode="decimal" value="${p.bialko_g ?? ""}" />
    </div>
    <div>
      <label for="${id("wegle")}">Węgle (g)</label>
      <input id="${id("wegle")}" name="wegle_g" inputmode="decimal" value="${p.wegle_g ?? ""}" />
    </div>
    <div>
      <label for="${id("tluszcz")}">Tłuszcz (g)</label>
      <input id="${id("tluszcz")}" name="tluszcz_g" inputmode="decimal" value="${p.tluszcz_g ?? ""}" />
    </div>`;
}

function wierszPozycji(p = {}) {
  return `
    <div class="pozycja-wiersz" data-wiersz>
      <input name="poz-nazwa" placeholder="składnik" autocomplete="off" value="${esc(p.nazwa ?? "")}" />
      <input name="poz-ilosc" inputmode="decimal" placeholder="g" value="${p.ilosc_g ?? ""}" />
      <input name="poz-kcal" inputmode="decimal" placeholder="kcal" value="${p.kcal ?? ""}" />
      <input name="poz-bialko" inputmode="decimal" placeholder="B" value="${p.bialko_g ?? ""}" />
      <input name="poz-wegle" inputmode="decimal" placeholder="W" value="${p.wegle_g ?? ""}" />
      <input name="poz-tluszcz" inputmode="decimal" placeholder="T" value="${p.tluszcz_g ?? ""}" />
      <button type="button" class="przycisk cichy" data-usun-wiersz aria-label="Usuń składnik">✕</button>
    </div>`;
}

/** Pusty wiersz dla przycisku „+ składnik". */
export const szablonWiersza = () => wierszPozycji();

/** Podgląd rozbicia: jedna linia na składnik — nazwa, ilość i kcal wystarczą na telefonie. */
function listaPozycji(pozycje) {
  if (!pozycje?.length) return "";

  return `<ul class="pozycje">${pozycje
    .map(
      (p) => `
      <li>
        <span class="nazwa">${esc(p.nazwa)}</span>
        ${p.ilosc_g != null ? `<span class="ilosc">${zaokr(p.ilosc_g)} g</span>` : ""}
        ${p.kcal != null ? `<span class="kcal">${zaokr(p.kcal)} kcal</span>` : ""}
      </li>`,
    )
    .join("")}</ul>`;
}

export function wpisPosilku(p, edytowanyPosilek) {
  if (p.id === edytowanyPosilek) {
    return `
      <form id="edycja-posilku-${p.id}" data-posilek="${p.id}" class="wpis-edycja"
            data-dzien="${esc(p.data_lokalna)}" data-godzina="${esc(p.godzina)}"
            data-mial-pozycje="${p.pozycje?.length ? 1 : 0}">
        <div class="pola">${polaPosilku(p, `e${p.id}-`)}</div>
        <div class="pozycje-edycja">
          <div class="cel">Składniki — makro całości przeliczy się z ich sumy</div>
          ${(p.pozycje ?? []).map(wierszPozycji).join("")}
          <button type="button" class="przycisk" data-dodaj-wiersz>+ składnik</button>
        </div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Popraw</button>
          <button class="przycisk" type="button" data-anuluj-posilku>Anuluj</button>
        </div>
      </form>`;
  }

  return `
    <div class="wpis ${p.oczekuje ? "oczekuje" : ""}">
      <div class="tresc">
        <div class="naglowek">
          <span class="godzina">${esc(p.godzina)}</span>
          <span class="opis">${esc(p.opis)}</span>
          ${p.pewnosc === "szacowane" ? '<span class="znacznik">szacunek</span>' : ""}
          ${p.pewnosc === "niepewne" ? '<span class="znacznik niepewne">niepewne</span>' : ""}
          ${p.oczekuje ? '<span class="znacznik">⏳ czeka</span>' : ""}
          ${p.oczekujaca_zmiana ? '<span class="znacznik">⏳ zmiana</span>' : ""}
        </div>
        <div class="szczegoly">
          ${zaokr(p.kcal)} kcal · B ${zaokr(p.bialko_g)} · W ${zaokr(p.wegle_g)} · T ${zaokr(p.tluszcz_g)}
        </div>
        ${listaPozycji(p.pozycje)}
      </div>
      ${
        // Wpis bez id z bazy nie ma czego poprawiać ani usuwać — obie akcje
        // wrócą, gdy kolejka go wyśle.
        p.oczekuje
          ? ""
          : `<button class="przycisk cichy" data-edytuj-posilek="${p.id}" aria-label="Popraw">✎</button>
             <button class="przycisk cichy" data-usun-posilek="${p.id}" aria-label="Usuń">✕</button>`
      }
    </div>`;
}
