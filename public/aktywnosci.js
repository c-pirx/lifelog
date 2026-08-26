/**
 * Historia ruchu — zakładka z odbytymi treningami i aktywnościami poza planem.
 *
 * Zakładka scala DWA rodzaje wpisów. Rozdział bytów ma sens tam, gdzie coś
 * rozstrzyga — w bazie i w ocenie tygodnia — ale użytkownik patrzący wstecz
 * chce jednej listy „co robiłem", a nie dwóch ekranów do zestawiania w głowie.
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

import { etykietaDnia } from "./kalendarz.js";
import { serieZgrupowane } from "./seria.js";

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

/** „5,2 km" — jedno miejsce po przecinku wystarczy, GPS-a i tak tu nie ma. */
const kilometry = (metry) => (Math.round((Number(metry) || 0) / 100) / 10).toFixed(1);

/** „25 min" albo „1 h 05 min". Sekundy przy przejażdżce nikogo nie obchodzą. */
export function czasWysilku(sekundy) {
  const minuty = Math.round((Number(sekundy) || 0) / 60);
  if (minuty < 60) return `${minuty} min`;
  return `${Math.floor(minuty / 60)} h ${String(minuty % 60).padStart(2, "0")} min`;
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

/**
 * Odbyty trening: nagłówek i wyniki ćwiczenie po ćwiczeniu.
 *
 * Bez przycisku poprawki — poprawianie serii wstecz to osobna sprawa. Jest za to
 * usunięcie całego treningu, bo omyłkowo otwarta i odhaczona sesja nie ma
 * dziś żadnej drogi wyjścia.
 */
export function wpisTreningu(t) {
  const nazwa = t.dzien_kod ? `Trening ${esc(t.dzien_kod)}` : "Trening bez planu";
  const opis = t.dzien_nazwa ? ` · ${esc(t.dzien_nazwa)}` : "";
  // Poniżej minuty czas milczy: „0 min" wygląda na zepsutą liczbę, a nie na
  // trening odhaczony w kilkanaście sekund po fakcie.
  const trwanie = t.trwanie_s >= 60 ? ` · ${czasWysilku(t.trwanie_s)}` : "";

  return `
    <div class="wpis ${t.oczekujace_usuniecie ? "oczekuje" : ""}">
      <div class="tresc">
        <div class="naglowek">
          <span class="godzina">${esc(t.godzina)}</span>
          <span class="opis">${nazwa}</span>
          ${t.oczekujace_usuniecie ? '<span class="znacznik">⏳ usuwanie</span>' : ""}
        </div>
        <div class="szczegoly">${t.serie_lacznie} ${odmianaSerii(t.serie_lacznie)}${opis}${trwanie}</div>
        <ul class="pozycje">
          ${t.cwiczenia
            .map(
              (c) => `
            <li>
              <span class="nazwa">${esc(c.nazwa)}</span>
              <span class="kcal">${esc(serieZgrupowane(c.serie))}</span>
            </li>`,
            )
            .join("")}
        </ul>
      </div>
      ${
        t.oczekujace_usuniecie
          ? ""
          : `<button class="przycisk cichy" data-usun-sesje="${t.id}" aria-label="Usuń trening">✕</button>`
      }
    </div>`;
}

/**
 * Treningi i aktywności jednego dnia w jednej liście, po godzinie.
 *
 * Poranny rower ma stać nad wieczorną siłownią — inaczej „co robiłem we wtorek"
 * czyta się w dwóch turach. Wpisy bez godziny (nie powinno ich być) lądują na
 * końcu, zamiast wywracać sortowanie.
 */
export function wpisyDnia(d) {
  const wpisy = [
    ...(d.treningi ?? []).map((t) => ({ rodzaj: "trening", godzina: t.godzina ?? "99:99", dane: t })),
    ...(d.aktywnosci ?? []).map((a) => ({ rodzaj: "aktywnosc", godzina: a.godzina ?? "99:99", dane: a })),
  ];

  return wpisy.sort((a, b) => (a.godzina < b.godzina ? -1 : a.godzina > b.godzina ? 1 : 0));
}

const odmianaSerii = (ile) => (ile === 1 ? "seria" : ile < 5 ? "serie" : "serii");

/**
 * Podsumowanie dnia na zwiniętej karcie: co to było, a nie ile tego było.
 *
 * „Trening A · rower 18,4 km" mówi więcej niż „2 wpisy" — a to jedyna treść,
 * po której użytkownik wybiera, który dzień rozwinąć. Powtórzenia zwijają się
 * w „×3", bo trzy razy ten sam napis pod rząd zajmuje miejsce i nic nie dodaje.
 */
function skrotDnia(d) {
  const czesci = (d.treningi ?? []).map((t) =>
    t.dzien_kod ? `Trening ${t.dzien_kod}` : "Trening",
  );

  for (const a of d.aktywnosci ?? []) {
    const miara = a.dystans_m != null ? ` ${kilometry(a.dystans_m)} km` : ` ${czasWysilku(a.czas_s)}`;
    czesci.push(`${a.dyscyplina}${miara}`);
  }

  const grupy = [];
  for (const opis of czesci) {
    const ostatnia = grupy.at(-1);
    if (ostatnia && ostatnia.opis === opis) ostatnia.ile += 1;
    else grupy.push({ opis, ile: 1 });
  }

  return grupy.map((g) => (g.ile > 1 ? `${g.opis} ×${g.ile}` : g.opis)).join(" · ");
}

function kartaDnia(d, rozwiniety, edytowana, dzisiaj) {
  const wpisy = wpisyDnia(d);

  return `
    <section class="karta">
      <button class="dzien-diety ${rozwiniety ? "rozwiniety" : ""}" data-dzien-aktywnosci="${esc(d.data)}">
        <span class="data">${etykietaDnia(d.data, dzisiaj)}</span>
        <span class="liczby-dnia">${esc(skrotDnia(d))}</span>
      </button>
      ${
        rozwiniety
          ? wpisy
              .map((w) =>
                w.rodzaj === "trening" ? wpisTreningu(w.dane) : wpisAktywnosci(w.dane, edytowana),
              )
              .join("")
          : ""
      }
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
        <div class="pusto">Żadnego ruchu od ${esc(historia?.od ?? "")} — odbyte treningi pojawią się tu same, a bieg, rower i spacer zapiszesz powyżej albo zdaniem do Claude'a.</div>
      </section>
      ${starsze}`;
  }

  return `${formularz}
    ${historia.dni
      .map((d) => kartaDnia(d, d.data === rozwinietyDzien, edytowana, dzisiaj))
      .join("")}
    ${starsze}`;
}
