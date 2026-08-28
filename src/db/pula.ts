/**
 * Pula otwartych baz użytkowników — jedno wejście do dzienników per osoba.
 *
 * To jedyne miejsce w projekcie, w którym dałoby się pomylić użytkownika:
 * oddać uchwyt Kasi żądaniu Tomka. Dlatego plik robi dokładnie jedną rzecz
 * i ma własne testy (`test/pula.test.ts`) z dowodem rozdzielności.
 *
 * LRU na Map: kolejność wstawiania jest kolejnością użycia, bo każde `daj`
 * przestawia wpis na koniec. Po przekroczeniu limitu zamykany jest uchwyt
 * z początku mapy — najdawniej używany, nie najdawniej otwarty.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { otworzBaze, otworzPolaczenie, uruchomMigracje, type Baza } from "./index.js";

export type OpcjePuli = {
  /** Katalog z plikami `<id>.db`. */
  katalog: string;
  /** Ile uchwytów trzymać otwartych naraz. */
  limit?: number;
  /** Zestaw migracji — domyślnie schemat dziennika. */
  katalogMigracji?: string;
};

export type PulaBaz = {
  daj(id: number): Baza;
  zamknij(): void;
};

/**
 * Dwa źródła danych aplikacji wielodostępowej — podawane razem wszystkim
 * adapterom. Rejestr mówi, KTO pyta; pula oddaje JEGO dziennik.
 */
export type ZrodlaDanych = {
  rejestr: Baza;
  pula: PulaBaz;
};

const DOMYSLNY_LIMIT = 50;

/**
 * Doprowadza wszystkie dzienniki w katalogu do bieżącego schematu.
 *
 * Wołane przy starcie procesu, PRZED nasłuchiwaniem: wdrożenie ma zmigrować
 * także konta, które od dawna nie zaglądały, a błąd migracji ma zatrzymać
 * start — lepiej brak usługi z czytelnym wpisem w dzienniku niż połowa baz
 * w nowym schemacie i połowa w starym. Migracja przy otwarciu z puli zostaje
 * jako siatka bezpieczeństwa.
 */
export function zmigrujWszystkie(
  katalog: string,
  katalogMigracji?: string,
): { baz: number; zastosowanych: number } {
  if (!existsSync(katalog)) return { baz: 0, zastosowanych: 0 };

  let baz = 0;
  let zastosowanych = 0;
  for (const nazwa of readdirSync(katalog)) {
    if (!/^\d+\.db$/.test(nazwa)) continue;
    baz += 1;
    const db = otworzPolaczenie(join(katalog, nazwa));
    try {
      zastosowanych += uruchomMigracje(db, katalogMigracji).length;
    } finally {
      db.close();
    }
  }
  return { baz, zastosowanych };
}

export function utworzPule(opcje: OpcjePuli): PulaBaz {
  const limit = opcje.limit ?? DOMYSLNY_LIMIT;
  const otwarte = new Map<number, Baza>();

  return {
    daj(id: number): Baza {
      // Nazwa pliku powstaje z tej liczby — wszystko, co nie jest dodatnią
      // liczbą całkowitą, jest błędem programisty, nie danymi do obsłużenia.
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Nieprawidłowy identyfikator użytkownika: ${id}`);
      }

      const juzOtwarta = otwarte.get(id);
      if (juzOtwarta) {
        // Odświeżenie pozycji LRU: usunięcie i ponowne wstawienie
        // przestawia wpis na koniec mapy.
        otwarte.delete(id);
        otwarte.set(id, juzOtwarta);
        return juzOtwarta;
      }

      const db = otworzBaze({
        sciezka: join(opcje.katalog, `${id}.db`),
        ...(opcje.katalogMigracji ? { katalogMigracji: opcje.katalogMigracji } : {}),
      });
      otwarte.set(id, db);

      while (otwarte.size > limit) {
        const [najstarszyId, najstarsza] = otwarte.entries().next().value as [number, Baza];
        otwarte.delete(najstarszyId);
        najstarsza.close();
      }

      return db;
    },

    zamknij(): void {
      for (const db of otwarte.values()) db.close();
      otwarte.clear();
    },
  };
}
