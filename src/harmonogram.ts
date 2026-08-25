/**
 * Cykliczne dogenerowanie raportów tygodniowych.
 *
 * Zamiast osobnej jednostki systemd (wzorzec `asystent-kopia.timer`) raporty
 * dogenerowuje sam proces aplikacji. Powód: `zapewnijRaporty` jest idempotentne
 * i samonaprawialne, więc wystarczy je wołać dostatecznie często — przy starcie,
 * z tego tiku oraz przy każdym odczycie z API i MCP. Nowa jednostka systemd
 * oznaczałaby edycję `wdrozenie/02-aplikacja.sh`, czyli dokładnie tego skryptu,
 * który już raz kosztował nas wymianę wszystkich sekretów.
 *
 * Tik jest tylko zapasem: raport ma być gotowy w niedzielę o 9:00, a pierwszy
 * odczyt tego dnia i tak go wywoła.
 */

import type { Baza } from "./db/index.js";
import { zapewnijRaporty } from "./domain/raporty.js";

const CO_GODZINE_MS = 60 * 60 * 1000;

export function uruchomHarmonogram(db: Baza, strefa: string): () => void {
  const przebieg = (): void => {
    try {
      for (const raport of zapewnijRaporty(db, { strefa })) {
        console.log(`Raport tygodniowy ${raport.tydzien_od} – ${raport.tydzien_do} gotowy`);
      }
    } catch (blad) {
      // Nieudany raport nie może położyć procesu, który obsługuje zapisy serii
      // w siłowni. Wpis do dziennika wystarczy — kolejny tik spróbuje ponownie.
      console.error("Nie udało się wygenerować raportu tygodniowego:", blad);
    }
  };

  przebieg();

  const uchwyt = setInterval(przebieg, CO_GODZINE_MS);
  // Bez unref() timer trzymałby proces przy życiu przy próbie zamknięcia.
  uchwyt.unref();

  return () => clearInterval(uchwyt);
}
