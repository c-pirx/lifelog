/**
 * Arytmetyka timera przerwy między seriami.
 *
 * Kafelki podają **całkowity** czas przerwy liczony od jej początku, a nie
 * dokładkę do bieżącego odliczania. Wybrałeś 90, doczekałeś końca i sięgasz
 * po 120 — dostajesz pozostałe 30 sekund. Inaczej wydłużenie odpoczynku
 * wymagałoby liczenia różnicy w pamięci, spoconym kciukiem, między seriami.
 *
 * Stąd bierze się też znikanie kafelków: krok, którego czas już minął, nie ma
 * czego zaoferować. Po 90 sekundach zostaje samo 120 i 180.
 *
 * Moduł jest czysty (bez DOM, bez zegara) właśnie po to, żeby dało się go objąć
 * testami — rysowanie i odliczanie zostaje w `app.js`.
 */

/**
 * @param {number|null} start   Znacznik rozpoczęcia przerwy (ms).
 * @param {number|null} cel     Całkowity czas przerwy w sekundach.
 * @param {number} teraz        Bieżący znacznik (ms).
 * @param {number[]} kroki      Kroki oferowane na kafelkach, w sekundach.
 */
export function stanPrzerwy(start, cel, teraz, kroki) {
  const trwa = start !== null && cel !== null;

  // Zaokrąglamy obie liczby tak samo, żeby „gotowe" i zniknięcie kafelka
  // wypadły w tej samej chwili, a nie o ćwierć sekundy od siebie.
  const minelo = trwa ? Math.round((teraz - start) / 1000) : 0;
  const pozostalo = trwa ? Math.max(0, Math.round((start + cel * 1000 - teraz) / 1000)) : 0;

  return {
    pozostalo,
    gotowe: trwa && pozostalo === 0,
    kafelki: kroki.map((sekundy) => ({
      sekundy,
      widoczny: !trwa || sekundy > minelo,
      wybrany: sekundy === cel,
    })),
  };
}

/** „1:30", a przy zerze słowo zamiast zer — timer ma krzyczeć, nie odliczać w dół. */
export function czasWTekscie(pozostalo) {
  if (pozostalo <= 0) return "gotowe";
  return `${Math.floor(pozostalo / 60)}:${String(pozostalo % 60).padStart(2, "0")}`;
}

/**
 * Czas trwania treningu: „42:15", a po godzinie „1:02:05".
 *
 * Godziny dochodzą dopiero wtedy, gdy są — trening trwa zwykle poniżej
 * godziny i wiodące „0:" zabierałoby miejsce, nie niosąc niczego.
 *
 * Ujemna wartość czytana jest jako zero: sesję mógł otworzyć czat z czasem,
 * który zegar telefonu ma jeszcze przed sobą, a licznik lecący wstecz
 * wyglądałby na awarię.
 */
export function trwanieWTekscie(sekundy) {
  const calosc = Math.max(0, Math.floor(sekundy));
  const s = String(calosc % 60).padStart(2, "0");
  const minuty = Math.floor(calosc / 60);

  if (minuty < 60) return `${minuty}:${s}`;
  return `${Math.floor(minuty / 60)}:${String(minuty % 60).padStart(2, "0")}:${s}`;
}
