/**
 * Zakładka Notatki — czytnik dziennika, nie edytor.
 *
 * Notatki powstają dyktowane do Claude'a: to on składa surową transkrypcję
 * w zdania i to on nadaje tytuł. Aplikacja ma je pokazać tak, żeby dało się je
 * przeczytać, i pozwolić skasować pomyłkę — poprawianie zostaje w czacie, bo
 * to tam mieszka wersja surowa i kontekst rozmowy.
 *
 * Czysty moduł na wzór dieta.js i aktywnosci.js: bez DOM, bez sieci, bez ocen
 * domenowych. Stan (otwarty folder, rozwinięta notatka) przychodzi parametrami
 * z app.js i tam mieszka.
 */

import { etykietaDnia } from "./kalendarz.js";
import { ZNAK_USUN } from "./znaki.js";

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

/**
 * Nazwy folderów. Jedyne miejsce w aplikacji powtarzające listę z domeny —
 * i słusznie, bo tu chodzi o polskie napisy, a nie o dozwolone wartości.
 * `drugorzedny` przenosi hierarchię do UI: „inne" to worek na resztę i ma tak
 * wyglądać, żeby nie konkurował wzrokowo z dwoma folderami, do których
 * naprawdę się wraca.
 */
const FOLDERY = {
  dziennik: { nazwa: "Dziennik", opis: "Myśli i przeżycia" },
  praca: { nazwa: "Praca", opis: "Ustalenia i zadania" },
  inne: { nazwa: "Inne", opis: "Reszta", drugorzedny: true },
};

const opisFolderu = (kategoria) => FOLDERY[kategoria] ?? { nazwa: kategoria, opis: "" };

/** „1 notatka", „3 notatki", „12 notatek" — licznik ma się czytać po polsku. */
function odmianaNotatek(ile) {
  if (ile === 1) return "notatka";
  const koncowka = ile % 10;
  const dziesiatki = ile % 100;
  const male = koncowka >= 2 && koncowka <= 4 && (dziesiatki < 10 || dziesiatki > 20);
  return male ? "notatki" : "notatek";
}

/** Tytuł notatki, a bez niego pierwsza linia treści. */
function tytulNotatki(n) {
  if (n.tytul) return n.tytul;
  const pierwsza = String(n.tresc ?? "").split("\n")[0].trim();
  return pierwsza.length > 60 ? `${pierwsza.slice(0, 60)}…` : pierwsza || "(bez treści)";
}

/**
 * Pojedyncza notatka: nagłówek zawsze, treść po rozwinięciu.
 *
 * Oryginał dyktowania chowa się w `<details>` i to jest świadome — aplikacja ma
 * być szczera co do tego, że tekst przepisał model, ale surowa transkrypcja
 * czyta się źle i nie może zasłaniać wersji uporządkowanej.
 */
export function wpisNotatki(n, otwarta) {
  const rozwinieta = String(n.id) === String(otwarta);
  const tytul = tytulNotatki(n);
  const skrot = String(n.tresc ?? "").replace(/\s+/g, " ").trim();

  // Notatka krótka jak jedna linia miałaby tytuł i zapowiedź brzmiące
  // identycznie — ten sam tekst dwa razy pod rząd wygląda na usterkę.
  const pokazSkrot = !rozwinieta && skrot !== tytul;

  return `
    <article class="notatka ${rozwinieta ? "rozwinieta" : ""} ${n.oczekuje ? "oczekuje" : ""}">
      <div class="wiersz">
        <button class="naglowek" data-notatka="${esc(n.id)}">
          <span class="tytul">${esc(tytul)}</span>
          <span class="meta">${esc(n.godzina ?? "")}${n.oczekuje ? " · ⏳ czeka" : ""}</span>
          ${pokazSkrot ? `<span class="skrot">${esc(skrot)}</span>` : ""}
        </button>
        ${
          // Notatka bez id z bazy nie ma czego usuwać — przycisk wróci, gdy
          // kolejka ją wyśle.
          n.oczekuje
            ? ""
            : `<button class="przycisk cichy niszczy" data-usun-notatke="${esc(n.id)}" aria-label="Usuń">${ZNAK_USUN}</button>`
        }
      </div>
      ${
        rozwinieta
          ? `<div class="tresc-notatki">${esc(n.tresc)}</div>
             ${
               n.surowe_wejscie
                 ? `<details class="oryginal">
                      <summary>Pokaż oryginał dyktowania</summary>
                      <p>${esc(n.surowe_wejscie)}</p>
                    </details>`
                 : ""
             }`
          : ""
      }
    </article>`;
}

/**
 * Formularz dopisania notatki z ręki.
 *
 * Bez pola tytułu i bez surowego wejścia: tekst wpisany palcem nie przechodził
 * przez model, więc nie ma czego zestawiać z oryginałem, a tytuł i tak wyjdzie
 * z pierwszej linii.
 */
function formularzNotatki(kategoriaDomyslna) {
  const opcje = Object.entries(FOLDERY)
    .map(
      ([klucz, { nazwa }]) =>
        `<option value="${klucz}" ${klucz === kategoriaDomyslna ? "selected" : ""}>${nazwa}</option>`,
    )
    .join("");

  return `
    <section class="karta">
      <form id="formularz-notatki" hidden>
        <div class="pola">
          <div class="szeroko">
            <label for="notatka-tresc">Notatka</label>
            <textarea id="notatka-tresc" name="tresc" rows="4"
                      placeholder="Co chcesz zapisać?"></textarea>
          </div>
          <div class="szeroko">
            <label for="notatka-kategoria">Folder</label>
            <select id="notatka-kategoria" name="kategoria">${opcje}</select>
          </div>
        </div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Zapisz</button>
          <button class="przycisk" type="button" data-anuluj="formularz-notatki">Anuluj</button>
        </div>
      </form>
      <div class="przyciski">
        <button class="przycisk pelny" data-pokaz="formularz-notatki">+ Dodaj notatkę</button>
      </div>
    </section>`;
}

function kartaFolderu(f) {
  const { nazwa, opis, drugorzedny } = opisFolderu(f.kategoria);
  const podpis = f.ile
    ? `${f.ile} ${odmianaNotatek(f.ile)}${f.ostatnia ? ` · ostatnia ${etykietaDnia(f.ostatnia)}` : ""}`
    : opis;

  const przycisk = `
    <button class="folder ${drugorzedny ? "drugorzedny" : ""}" data-folder="${esc(f.kategoria)}">
      <span class="data">${esc(nazwa)}</span>
      <span class="liczby-dnia">${esc(podpis)}</span>
    </button>`;

  // Worek na resztę stoi poza kartą: ta sama treść, mniejsza waga wzrokowa.
  return drugorzedny
    ? `<div class="folder-cichy">${przycisk}</div>`
    : `<section class="karta">${przycisk}</section>`;
}

/** Notatki folderu w kartach po dniach — najnowszy dzień u góry. */
function dniFolderu(notatki, otwarta, dzisiaj) {
  const poDniu = new Map();

  for (const n of notatki) {
    const dzien = n.data_lokalna ?? "";
    if (!poDniu.has(dzien)) poDniu.set(dzien, []);
    poDniu.get(dzien).push(n);
  }

  return [...poDniu.entries()]
    .map(
      ([data, wpisy]) => `
      <section class="karta">
        <h2>${esc(etykietaDnia(data, dzisiaj))}</h2>
        ${wpisy.map((n) => wpisNotatki(n, otwarta)).join("")}
      </section>`,
    )
    .join("");
}

function ekranFolderu(folder, otwarta, dzisiaj) {
  const { nazwa } = opisFolderu(folder.kategoria);

  const powrot = `
    <div class="przyciski powrot">
      <button class="przycisk pelny" data-zamknij-folder>← Wszystkie foldery</button>
    </div>`;

  if (folder.notatki.length === 0) {
    return `${powrot}
      <section class="karta">
        <div class="pusto">Folder ${esc(nazwa)} jest pusty — podyktuj notatkę Claude'owi albo dopisz ją poniżej.</div>
      </section>
      ${formularzNotatki(folder.kategoria)}`;
  }

  // „Pokaż starsze" tylko wtedy, gdy pobrana porcja nie objęła całego folderu.
  const starsze =
    folder.notatki.length < folder.ile
      ? `<div class="przyciski dociazenie">
           <button class="przycisk cichy" data-starsze-notatek>Pokaż starsze ↓</button>
         </div>`
      : "";

  // Formularz pod listą, nie nad nią. Zakładka jest czytnikiem — dopisanie
  // notatki z ręki to wyjątek od zasady „notatki powstają w czacie", więc jego
  // klawisz nie ma prawa zajmować pierwszego ekranu przed treścią folderu.
  return `${powrot}
    ${dniFolderu(folder.notatki, otwarta, dzisiaj)}
    ${starsze}
    ${formularzNotatki(folder.kategoria)}`;
}

export function ekranNotatki(historia, otwartyFolder, otwartaNotatka, dzisiaj) {
  const foldery = historia?.foldery ?? [];

  if (otwartyFolder) {
    const folder = foldery.find((f) => f.kategoria === otwartyFolder);
    // Folder zniknął (np. pierwszy odczyt bez zasięgu) — zamiast pustego ekranu
    // pokazujemy listę folderów.
    if (folder) return ekranFolderu(folder, otwartaNotatka, dzisiaj);
  }

  const pusto = foldery.every((f) => f.ile === 0);

  // Foldery pierwsze, klawisz dopisania po nich — tak jak w zakładce
  // Aktywności. Karta z samym przyciskiem na górze zabierała cały pierwszy
  // ekran czynności, którą w tej zakładce robi się najrzadziej.
  return `
    ${foldery.map(kartaFolderu).join("")}
    ${
      pusto
        ? `<section class="karta">
             <div class="pusto">Jeszcze nic tu nie ma. Podyktuj notatkę Claude'owi — uporządkuje ją i odłoży do folderu.</div>
           </section>`
        : ""
    }
    ${formularzNotatki("dziennik")}`;
}
