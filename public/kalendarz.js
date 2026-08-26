/**
 * Etykieta dnia — jedna dla paska dat, zakładki Dieta i historii ruchu.
 *
 * Moduł istnieje z tego samego powodu co seria.js: trzy ekrany pokazują datę
 * i każdy musi pokazywać ją identycznie. Dwie kopie już się zdążyły rozmnożyć
 * (dieta.js i aktywnosci.js); pasek dat na Dziś byłby trzecią.
 *
 * Czysty, bez DOM i bez sieci.
 */

const DNI_TYGODNIA = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

/** „wt 25.08", a dla dzisiejszego dnia z dopiskiem — żeby lista miała kotwicę. */
export function etykietaDnia(data, dzisiaj) {
  // Południe UTC: ta sama data w każdej strefie — ten sam trik co przy wykresach.
  const chwila = new Date(`${data}T12:00:00Z`);
  const [, miesiac, dzien] = data.split("-");
  const podstawa = `${DNI_TYGODNIA[chwila.getUTCDay()]} ${dzien}.${miesiac}`;
  return data === dzisiaj ? `${podstawa} · dziś` : podstawa;
}
