/**
 * Znaki graficzne wpisów — sztanga, rower, bieg, spacer, basen, puls.
 *
 * Osobny moduł z tego samego powodu co seria.js i kalendarz.js: ten sam znak
 * rysują dziś dwa ekrany (historia ruchu i sekcja „Ruch" na Dziś), a dwie kopie
 * tej samej ścieżki SVG rozjechałyby się przy pierwszej poprawce.
 *
 * Rysowane wprost w SVG, jak ikony nawigacji i wykresy: `currentColor` przejmuje
 * kolor otoczenia, a kreska 1.8 czyta się przy 18 px. Żadnej biblioteki ikon —
 * strona powitalna obiecuje brak żądań do obcych domen i dotyczy to też aplikacji.
 *
 * Czysty: bez DOM, bez sieci, bez ocen domenowych. Wybór znaku to sprawa
 * WYGLĄDU, nie dziedziny — dyscyplina jest wolnym tekstem i serwer świadomie
 * jej nie kategoryzuje, więc dopasowanie po słowie kluczowym mieszka tutaj,
 * a nie w src/domain/.
 */

const rysuj = (wnetrze) =>
  `<svg class="znak" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${wnetrze}</svg>`;

/** Sztanga — ta sama, co w dolnym pasku pod „Trening". */
export const ZNAK_SZTANGA = rysuj(`<path d="M7 7.5v9M4 9.5v5M17 7.5v9M20 9.5v5M7 12h10" />`);

/** Rower — ta sama, co przy „Aktywności" w szufladzie. */
export const ZNAK_ROWER = rysuj(`
  <circle cx="6" cy="16.5" r="3.5" />
  <circle cx="18" cy="16.5" r="3.5" />
  <path d="M6 16.5 10.5 9h4.5l3 7.5" />
  <path d="M9 9h3.5" />`);

/** Biegacz — pochylony do przodu, żeby odróżniał się od spaceru sylwetką. */
export const ZNAK_BIEG = rysuj(`
  <circle cx="15.5" cy="5" r="2" />
  <path d="M17 10.5 13 12l1.5 3.5" />
  <path d="M13 12 9.5 10" />
  <path d="M14.5 15.5 11.5 20" />
  <path d="M17 10.5 19.5 14" />`);

/**
 * Spacerowicz — wyprostowany, z jedną ręką. Od biegacza odróżnia go POSTAWA,
 * bo to jedyna różnica czytelna przy 22 px. Ślady stóp, próbowane wcześniej,
 * schodziły przy tym rozmiarze do dwóch kropek nie do odróżnienia od literówki.
 */
export const ZNAK_SPACER = rysuj(`
  <circle cx="12.5" cy="4.5" r="2" />
  <path d="M12.5 8v5.5" />
  <path d="M12.5 13.5 9.5 20" />
  <path d="M12.5 13.5 15.5 20" />
  <path d="M12.5 9.5 9 11.5" />`);

/** Fale — pływanie bez sylwetki, bo ta przy 18 px zlewa się z biegaczem. */
export const ZNAK_BASEN = rysuj(`
  <path d="M3 9.5c1.9-1.7 3.8-1.7 5.7 0s3.8 1.7 5.6 0 3.8-1.7 5.7 0" />
  <path d="M3 14.5c1.9-1.7 3.8-1.7 5.7 0s3.8 1.7 5.6 0 3.8-1.7 5.7 0" />
  <path d="M3 19.5c1.9-1.7 3.8-1.7 5.7 0s3.8 1.7 5.6 0 3.8-1.7 5.7 0" />`);

/** Linia tętna — ten sam rysunek co w logo. Znak zastępczy dla reszty. */
export const ZNAK_PULS = rysuj(`<path d="M3 12h4l2.5-6 4.5 12 2.5-6H21" />`);

/** Ołówek — poprawka wpisu. */
export const ZNAK_POPRAW = rysuj(`
  <path d="M4.5 19.5h3.2l9.4-9.4-3.2-3.2-9.4 9.4z" />
  <path d="M14.6 5.8 16.4 4a1.6 1.6 0 0 1 2.3 0l1.3 1.3a1.6 1.6 0 0 1 0 2.3l-1.8 1.8" />`);

/** Kosz — usunięcie wpisu. Kosz, a nie krzyżyk: krzyżyk znaczy „zamknij". */
export const ZNAK_USUN = rysuj(`
  <path d="M5 7h14" />
  <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
  <path d="M6.5 7l.8 11.6A1.6 1.6 0 0 0 8.9 20h6.2a1.6 1.6 0 0 0 1.6-1.4L17.5 7" />
  <path d="M10.5 11v5M13.5 11v5" />`);

/**
 * Słowa kluczowe → znak. Kolejność ma znaczenie tylko tam, gdzie jedno słowo
 * zawiera się w drugim; dziś taka para nie występuje, ale lista jest tablicą,
 * a nie obiektem, właśnie po to, żeby dołożenie takiej pary dało się rozstrzygnąć.
 *
 * Warianty bez polskich znaków („plyw", „chod") stoją obok pełnych: dyktowana
 * dyscyplina bywa zapisana i tak, i tak, a wpis z czatu i z aplikacji ma dostać
 * ten sam znak.
 */
const SLOWA = [
  [["rower", "kolarstw", "cykl", "spinning"], ZNAK_ROWER],
  [["bieg", "jogging", "trucht"], ZNAK_BIEG],
  [["spacer", "marsz", "chód", "chod", "nordic"], ZNAK_SPACER],
  [["basen", "pływ", "plyw"], ZNAK_BASEN],
];

/**
 * Znak dla dyscypliny podanej wolnym tekstem. Nierozpoznana dostaje puls —
 * znak zastępczy, a nie brak znaku: dziura w kolumnie ikon czytałaby się jak
 * błąd, a nie jak „nie wiem, co to za sport".
 */
export function znakDyscypliny(dyscyplina) {
  const tekst = String(dyscyplina ?? "").toLowerCase();
  for (const [slowa, znak] of SLOWA) {
    if (slowa.some((s) => tekst.includes(s))) return znak;
  }
  return ZNAK_PULS;
}
