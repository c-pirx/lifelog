/**
 * Cykliczne dogenerowanie raportów tygodniowych — dla każdego konta osobno.
 *
 * Zamiast osobnej jednostki systemd (wzorzec `asystent-kopia.timer`) raporty
 * dogenerowuje sam proces aplikacji. Powód: `zapewnijRaporty` jest idempotentne
 * i samonaprawialne, więc wystarczy je wołać dostatecznie często — przy starcie,
 * z tego tiku oraz przy każdym odczycie z API i MCP. Nowa jednostka systemd
 * oznaczałaby edycję `wdrozenie/02-aplikacja.sh`, czyli dokładnie tego skryptu,
 * który już raz kosztował nas wymianę wszystkich sekretów.
 *
 * Tik jest tylko zapasem: raport ma być gotowy w niedzielę o 9:00, a pierwszy
 * odczyt tego dnia i tak go wywoła. Przy wielu użytkownikach tik nabiera
 * jednak drugiej roli: dogenerowuje raporty kontom, które od dawna nie
 * zaglądały — żeby po powrocie archiwum było kompletne od ręki.
 */

import type { ZrodlaDanych } from "./db/pula.js";
import { aktywneKonta } from "./domain/konta.js";
import { zapewnijRaporty } from "./domain/raporty.js";

const CO_GODZINE_MS = 60 * 60 * 1000;

export function uruchomHarmonogram(zrodla: ZrodlaDanych): () => void {
  const przebieg = (): void => {
    // Każde konto z osobna i każde we WŁASNEJ strefie czasowej — tydzień
    // użytkownika z Londynu kończy się o innej godzinie niż warszawski.
    // Błąd jednego konta nie może zatrzymać pozostałych ani położyć procesu,
    // który obsługuje zapisy serii w siłowni.
    for (const konto of aktywneKonta(zrodla.rejestr)) {
      try {
        const db = zrodla.pula.daj(konto.id);
        for (const raport of zapewnijRaporty(db, { strefa: konto.strefa })) {
          console.log(
            `Raport tygodniowy ${raport.tydzien_od} – ${raport.tydzien_do} gotowy (${konto.login})`,
          );
        }
      } catch (blad) {
        console.error(`Nie udało się wygenerować raportu dla ${konto.login}:`, blad);
      }
    }
  };

  przebieg();

  const uchwyt = setInterval(przebieg, CO_GODZINE_MS);
  // Bez unref() timer trzymałby proces przy życiu przy próbie zamknięcia.
  uchwyt.unref();

  return () => clearInterval(uchwyt);
}
