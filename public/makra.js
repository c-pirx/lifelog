/**
 * Karta „Makro — 30 dni" na ekranie Postępy.
 *
 * Osobny plik z tego samego powodu co raporty.js: funkcje są czyste (bez DOM,
 * bez sieci), więc dają się objąć testami. Nic domenowego poza średnią
 * i liczbą dni w paśmie — werdykty tygodnia liczy serwer.
 */

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const zaokr = (liczba) => Math.round(Number(liczba) || 0);

/** Makro dnia, w kolejności pasków na ekranie Dziś. */
const MAKRA = [
  { pole: "kcal", cel: "cel_kcal", nazwa: "Kalorie", jednostka: "kcal" },
  { pole: "bialko_g", cel: "cel_bialko_g", nazwa: "Białko", jednostka: "g" },
  { pole: "wegle_g", cel: "cel_wegle_g", nazwa: "Węglowodany", jednostka: "g" },
  { pole: "tluszcz_g", cel: "cel_tluszcz_g", nazwa: "Tłuszcze", jednostka: "g" },
];

/**
 * Ta sama tolerancja co `PASMO_CELU` w src/domain/raporty.ts — kafelek „dni
 * w celu" tygodnia i kropki tutaj mają liczyć to samo. Pilnuje tego test
 * w test/offline.test.ts.
 */
export const PASMO = 0.07;

const dniSlowo = (n) => `${n} ${n === 1 ? "dnia" : "dni"}`;

/**
 * Dzień wobec swojego celu — klasy z `.kropki` na liście ćwiczeń (pełna /
 * pusta) i ze słupka wykresu kalorii (ponad). Bez celu kropka jest niema.
 */
function stanDnia(wartosc, cel) {
  if (!cel) return "niema";
  const odchylenie = (wartosc - cel) / cel;
  return odchylenie > PASMO ? "ponad" : odchylenie < -PASMO ? "pusta" : "pelna";
}

/**
 * Rząd kropek, jeden dzień = jedna kropka, tą samą geometrią co `kropkiSerii`
 * (promień 4, odstęp 13). Trzydzieści dni to 389 px — na telefonie CSS skaluje
 * SVG do szerokości karty, przy kilku dniach zostaje w naturalnym rozmiarze,
 * od lewej. Stan liczony z celu TEGO dnia, tak samo jak licznik pod spodem.
 */
function kropkiDni(dni, makro) {
  const kola = dni
    .map((d, i) => {
      const wartosc = d[makro.pole] ?? 0;
      return `<circle cx="${6 + i * 13}" cy="6" r="4" class="${stanDnia(wartosc, d[makro.cel])}"><title>${esc(d.data)}: ${zaokr(wartosc)} ${makro.jednostka}</title></circle>`;
    })
    .join("");
  const szer = dni.length * 13 - 1;

  return `<svg class="kropki" width="${szer}" height="12" viewBox="0 0 ${szer} 12" aria-hidden="true">${kola}</svg>`;
}

/** Jeden wiersz tabeli: nazwa, średnia z celem, dni w paśmie, kropki. */
function wierszMakro(dni, makro) {
  const wartosci = dni.map((d) => d[makro.pole] ?? 0);
  const srednia = zaokr(wartosci.reduce((s, v) => s + v, 0) / wartosci.length);

  // Cel przy liczbie z ostatniego dnia — jak linia celu na wykresie kalorii.
  // Trafienia liczone każdemu dniowi z jego własnym celem, żeby zmiana celu
  // w środku okresu nie fałszowała historii.
  const cel = dni.at(-1)?.[makro.cel] ?? null;
  const zCelem = dni.filter((d) => d[makro.cel]);
  const trafione = zCelem.filter((d) => stanDnia(d[makro.pole] ?? 0, d[makro.cel]) === "pelna").length;

  const opis = `${makro.nazwa}: średnio ${srednia} ${makro.jednostka} z ${dniSlowo(dni.length)}${
    zCelem.length ? `, ${trafione} z ${zCelem.length} w paśmie celu` : ", bez celu"
  }`;

  return `
    <li class="makro-wiersz" aria-label="${esc(opis)}">
      <span class="nazwa">${makro.nazwa}</span>
      <span class="srednia"><b>${srednia}</b> <span class="cel">${
        cel ? `/ ${zaokr(cel)} ` : ""
      }${makro.jednostka}</span></span>
      <span class="dni">${
        zCelem.length ? `<b>${trafione} z ${dniSlowo(zCelem.length)}</b> w paśmie` : "bez celu"
      }</span>
      ${kropkiDni(dni, makro)}
    </li>`;
}

/**
 * Zawartość karty: klucz do liczb i cztery wiersze. Klucz stoi raz, nad
 * tabelą — bez niego duża liczba wyglądałaby na dzisiejszą, a „w paśmie"
 * nie mówiłoby, jak szerokie jest pasmo.
 */
export function kartaMakro(dni) {
  if (!dni.length) return '<div class="pusto">Brak danych.</div>';

  const jestCel = MAKRA.some((m) => dni.some((d) => d[m.cel]));

  return `
    <p class="cel makra-klucz">średnie z ${dniSlowo(dni.length)}${
      jestCel ? ` · pasmo ±${Math.round(PASMO * 100)} % wokół celu` : ""
    }</p>
    <ul class="makra">${MAKRA.map((m) => wierszMakro(dni, m)).join("")}</ul>`;
}
