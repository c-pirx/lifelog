/**
 * Aktywności poza planem — zakładka z historią i wspólny renderer wpisu.
 *
 * Czysty moduł na wzór dieta.js i posilek.js: bez DOM, bez sieci, bez ocen
 * domenowych. Renderuje liczby przysłane przez serwer (po nałożeniu kolejki
 * offline) i niczego nie wylicza poza sklejeniem tekstu. Stan — rozwinięty
 * dzień, wpis otwarty do poprawki — przychodzi parametrami z app.js.
 *
 * Wpis i ekran mieszkają w jednym pliku, bo ten sam renderer obsługuje ekran
 * Dziś i tę zakładkę. Rozbicie na `aktywnosc.js` i `aktywnosci.js` dałoby dwie
 * nazwy różniące się jedną literą — pomyłka przy imporcie byłaby kwestią czasu.
 */

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const DNI_TYGODNIA = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

/** „5,2 km" — jedno miejsce po przecinku wystarczy, GPS-a i tak tu nie ma. */
const kilometry = (metry) => (Math.round((Number(metry) || 0) / 100) / 10).toFixed(1);

/** „25 min" albo „1 h 05 min". Sekundy przy przejażdżce nikogo nie obchodzą. */
export function czasWysilku(sekundy) {
  const minuty = Math.round((Number(sekundy) || 0) / 60);
  if (minuty < 60) return `${minuty} min`;
  return `${Math.floor(minuty / 60)} h ${String(minuty % 60).padStart(2, "0")} min`;
}

/** „wt 25.08", a dla dzisiejszego dnia z dopiskiem — żeby lista miała kotwicę. */
function etykietaDnia(data, dzisiaj) {
  // Południe UTC: ta sama data w każdej strefie — ten sam trik co przy wykresach.
  const chwila = new Date(`${data}T12:00:00Z`);
  const [, miesiac, dzien] = data.split("-");
  const podstawa = `${DNI_TYGODNIA[chwila.getUTCDay()]} ${dzien}.${miesiac}`;
  return data === dzisiaj ? `${podstawa} · dziś` : podstawa;
}

/** Miary wpisu w jednej linii; kolejność jak w czacie: najpierw dystans. */
function miary(a) {
  const czesci = [];
  if (a.dystans_m != null) czesci.push(`${kilometry(a.dystans_m)} km`);
  if (a.czas_s != null) czesci.push(czasWysilku(a.czas_s));
  if (a.rpe != null) czesci.push(`RPE ${a.rpe}`);
  return czesci.join(" · ");
}

/** Pola aktywności — wspólne dla dopisywania i poprawiania. */
export function polaAktywnosci(a = {}, idPrzedrostek = "") {
  const id = (nazwa) => `${idPrzedrostek}${nazwa}`;
  const dystans = a.dystans_m != null ? kilometry(a.dystans_m) : "";
  const czas = a.czas_s != null ? Math.round(a.czas_s / 60) : "";

  return `
    <div class="szeroko">
      <label for="${id("dyscyplina")}">Co robiłeś</label>
      <input id="${id("dyscyplina")}" name="dyscyplina" required autocomplete="off"
             placeholder="rower, bieg, spacer" value="${esc(a.dyscyplina ?? "")}" />
    </div>
    <div>
      <label for="${id("dystans")}">Dystans (km)</label>
      <input id="${id("dystans")}" name="dystans_km" inputmode="decimal" value="${dystans}" />
    </div>
    <div>
      <label for="${id("minuty")}">Czas (min)</label>
      <input id="${id("minuty")}" name="czas_min" inputmode="numeric" value="${czas}" />
    </div>
    <div>
      <label for="${id("godzina")}">Godzina</label>
      <input id="${id("godzina")}" name="godzina" inputmode="numeric" placeholder="teraz" value="${esc(a.godzina ?? "")}" />
    </div>
    <div class="szeroko">
      <label for="${id("notatka")}">Notatka</label>
      <input id="${id("notatka")}" name="notatka" autocomplete="off" value="${esc(a.notatka ?? "")}" />
    </div>`;
}

export function wpisAktywnosci(a, edytowana) {
  if (a.id === edytowana) {
    return `
      <form id="edycja-aktywnosci-${a.id}" data-aktywnosc="${a.id}" class="wpis-edycja"
            data-dzien-wpisu="${esc(a.data_lokalna)}" data-godzina="${esc(a.godzina)}">
        <div class="pola">${polaAktywnosci(a, `a${a.id}-`)}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Popraw</button>
          <button class="przycisk" type="button" data-anuluj-aktywnosci>Anuluj</button>
        </div>
      </form>`;
  }

  return `
    <div class="wpis ${a.oczekuje ? "oczekuje" : ""}">
      <div class="tresc">
        <div class="naglowek">
          <span class="godzina">${esc(a.godzina)}</span>
          <span class="opis">${esc(a.dyscyplina)}</span>
          ${a.oczekuje ? '<span class="znacznik">⏳ czeka</span>' : ""}
          ${a.oczekujaca_zmiana ? '<span class="znacznik">⏳ zmiana</span>' : ""}
        </div>
        <div class="szczegoly">${esc(miary(a))}</div>
        ${a.notatka ? `<div class="szczegoly">${esc(a.notatka)}</div>` : ""}
      </div>
      ${
        // Wpis bez id z bazy nie ma czego poprawiać ani usuwać — obie akcje
        // wrócą, gdy kolejka go wyśle.
        a.oczekuje
          ? ""
          : `<button class="przycisk cichy" data-edytuj-aktywnosc="${a.id}" aria-label="Popraw">✎</button>
             <button class="przycisk cichy" data-usun-aktywnosc="${a.id}" aria-label="Usuń">✕</button>`
      }
    </div>`;
}

function kartaDnia(d, rozwiniety, edytowana, dzisiaj) {
  const dystans = d.dystans_m > 0 ? `${kilometry(d.dystans_m)} km` : "";
  const czas = d.czas_s > 0 ? czasWysilku(d.czas_s) : "";
  const liczby = [dystans, czas].filter(Boolean).join(" · ");

  return `
    <section class="karta">
      <button class="dzien-diety ${rozwiniety ? "rozwiniety" : ""}" data-dzien-aktywnosci="${esc(d.data)}">
        <span class="data">${etykietaDnia(d.data, dzisiaj)}</span>
        <span class="liczby-dnia">${d.aktywnosci.length} × ${liczby || "bez miary"}</span>
      </button>
      ${rozwiniety ? d.aktywnosci.map((a) => wpisAktywnosci(a, edytowana)).join("") : ""}
    </section>`;
}

export function ekranAktywnosci(historia, rozwinietyDzien, edytowana, dzisiaj) {
  const formularz = `
    <section class="karta">
      <form id="formularz-aktywnosci" hidden>
        <div class="pola">${polaAktywnosci()}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Zapisz</button>
          <button class="przycisk" type="button" data-anuluj="formularz-aktywnosci">Anuluj</button>
        </div>
      </form>
      <div class="przyciski" id="dodaj-aktywnosc-wrapper">
        <button class="przycisk pelny" data-pokaz="formularz-aktywnosci">+ Dodaj aktywność</button>
      </div>
    </section>`;

  const starsze = `
    <div class="przyciski">
      <button class="przycisk pelny" data-starsze-aktywnosci>Pokaż starsze</button>
    </div>`;

  if (!historia?.dni?.length) {
    return `
      ${formularz}
      <section class="karta">
        <div class="pusto">Żadnego wyjścia od ${esc(historia?.od ?? "")} — bieg, rower i spacer zapiszesz tutaj albo zdaniem do Claude'a.</div>
      </section>
      ${starsze}`;
  }

  return `${formularz}
    ${historia.dni
      .map((d) => kartaDnia(d, d.data === rozwinietyDzien, edytowana, dzisiaj))
      .join("")}
    ${starsze}`;
}
