/**
 * Kolejka zapisów czekających na sieć.
 *
 * Powód istnienia: na siłowni w piwnicy zapis serii kończył się komunikatem
 * „Brak połączenia z serwerem" i wynik przepadał. Teraz trafia tutaj i jedzie
 * na serwer, gdy telefon odzyska zasięg.
 *
 * IndexedDB, a nie localStorage: zapisy muszą przetrwać zamknięcie aplikacji
 * i wygaszenie telefonu, a localStorage bywa czyszczony pod presją pamięci.
 *
 * Dostęp do IndexedDB siedzi wyłącznie w ciałach funkcji — dzięki temu moduł
 * daje się zaimportować w teście node'owym, żeby sprawdzić samą politykę błędów.
 */

const BAZA = "asystent-kolejka";
const SKLAD = "zapisy";

/**
 * Co zrobić z wpisem po nieudanej próbie wysłania.
 *
 * Reguły nie są kosmetyką:
 *  - 401 zatrzymuje całą kolejkę, bo wygasła sesja unieważni każdy kolejny wpis,
 *    a wysyłanie ich po kolei tylko wykasowałoby trening;
 *  - 400 wyrzuca wpis, bo błąd domenowy nie naprawi się sam — jeden zły zapis
 *    zablokowałby kolejkę na zawsze;
 *  - brak sieci (0) i błędy serwera (5xx) zostawiają wpis do ponowienia.
 */
export function decyzjaKolejki(status) {
  if (status === 401 || status === 403) return "zatrzymaj";
  if (status >= 400 && status < 500) return "usun";
  return "ponow";
}

function otworz() {
  return new Promise((zrob, odrzuc) => {
    const zadanie = indexedDB.open(BAZA, 1);

    zadanie.onupgradeneeded = () => {
      // autoIncrement daje rosnące klucze, a rosnące klucze dają kolejność FIFO
      // za darmo — kursor IndexedDB czyta je rosnąco.
      zadanie.result.createObjectStore(SKLAD, { keyPath: "id", autoIncrement: true });
    };

    zadanie.onsuccess = () => zrob(zadanie.result);
    zadanie.onerror = () => odrzuc(zadanie.error);
  });
}

function transakcja(db, tryb, wykonaj) {
  return new Promise((zrob, odrzuc) => {
    const t = db.transaction(SKLAD, tryb);
    const wynik = wykonaj(t.objectStore(SKLAD));
    t.oncomplete = () => zrob(wynik?.result ?? wynik);
    t.onerror = () => odrzuc(t.error);
  });
}

export async function dodajDoKolejki(wpis) {
  const db = await otworz();
  try {
    return await transakcja(db, "readwrite", (sklad) => sklad.add(wpis));
  } finally {
    db.close();
  }
}

export async function wpisyKolejki() {
  const db = await otworz();
  try {
    return await transakcja(db, "readonly", (sklad) => sklad.getAll());
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function usunZKolejki(id) {
  const db = await otworz();
  try {
    await transakcja(db, "readwrite", (sklad) => sklad.delete(id));
  } finally {
    db.close();
  }
}

/**
 * Wysyła kolejkę po jednym wpisie, w kolejności dodania.
 *
 * Sekwencyjnie, i to nie z ostrożności: numer serii nadaje serwer, licząc
 * dotychczasowe serie ćwiczenia. Równoległa wysyłka pomieszałaby numerację,
 * a wraz z nią kolejność treningu.
 *
 * `wyslij` dostaje wpis i zwraca status HTTP (0 przy braku sieci).
 */
export async function wyslijKolejke(wyslij) {
  const wpisy = await wpisyKolejki();
  const podsumowanie = { wyslane: 0, odrzucone: 0, zostalo: wpisy.length };

  for (const wpis of wpisy) {
    const status = await wyslij(wpis);

    if (status >= 200 && status < 300) {
      await usunZKolejki(wpis.id);
      podsumowanie.wyslane += 1;
      podsumowanie.zostalo -= 1;
      continue;
    }

    const decyzja = decyzjaKolejki(status);

    if (decyzja === "usun") {
      await usunZKolejki(wpis.id);
      podsumowanie.odrzucone += 1;
      podsumowanie.zostalo -= 1;
      continue;
    }

    // "zatrzymaj" i "ponow" kończą przebieg — reszta poczeka na następną okazję.
    podsumowanie.zatrzymana = decyzja === "zatrzymaj";
    break;
  }

  return podsumowanie;
}
