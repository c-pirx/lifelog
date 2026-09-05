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

/**
 * Wczorajsza data względem podanego „dzisiaj".
 *
 * Południe UTC i odjęta doba — ten sam chwyt co przy samej etykiecie. Zmiana
 * czasu przesuwa dobę o godzinę, a nie o dwanaście, więc data po odjęciu
 * 24 godzin od południa nadal wypada w poprzednim dniu.
 */
function wczorajszaData(dzisiaj) {
  if (!dzisiaj) return null;
  const chwila = Date.parse(`${dzisiaj}T12:00:00Z`);
  if (Number.isNaN(chwila)) return null;
  return new Date(chwila - 86_400_000).toISOString().slice(0, 10);
}

/**
 * „wt 25.08", a dla dwóch ostatnich dni z dopiskiem — żeby lista miała kotwicę.
 *
 * „wczoraj" stoi obok „dziś", bo to jedyne dwa dni, które użytkownik ma w głowie
 * bez liczenia. Trzeci taki dopisek („przedwczoraj") już by nie pomagał: przy
 * długiej liście trzy wyróżnione wiersze pod rząd przestają wyróżniać.
 */
export function etykietaDnia(data, dzisiaj) {
  // Południe UTC: ta sama data w każdej strefie — ten sam trik co przy wykresach.
  const chwila = new Date(`${data}T12:00:00Z`);
  const [, miesiac, dzien] = data.split("-");
  const podstawa = `${DNI_TYGODNIA[chwila.getUTCDay()]} ${dzien}.${miesiac}`;

  if (data === dzisiaj) return `${podstawa} · dziś`;
  if (data === wczorajszaData(dzisiaj)) return `${podstawa} · wczoraj`;
  return podstawa;
}
