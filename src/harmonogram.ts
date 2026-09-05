/**
 * Dwa cykliczne zadania procesu aplikacji: raporty tygodniowe i powiadomienia
 * push. Oba chodzą po wszystkich kontach, każde konto we WŁASNEJ strefie.
 *
 * Zamiast osobnych jednostek systemd (wzorzec `asystent-kopia.timer`) robi to
 * sam proces aplikacji. Powód: obie pętle są idempotentne i samonaprawialne,
 * więc wystarczy je wołać dostatecznie często. Nowa jednostka systemd
 * oznaczałaby edycję `wdrozenie/02-aplikacja.sh`, czyli dokładnie tego skryptu,
 * który już raz kosztował nas wymianę wszystkich sekretów.
 *
 * Tik raportów jest tylko zapasem: raport ma być gotowy w niedzielę o 9:00,
 * a pierwszy odczyt tego dnia i tak go wywoła. Przy wielu użytkownikach nabiera
 * drugiej roli — dogenerowuje raporty kontom, które od dawna nie zaglądały.
 *
 * Tik powiadomień jest odwrotnie: to JEDYNA droga, którą cokolwiek wychodzi.
 * Chodzi częściej, bo pory są konkretne (8:00, 18:00, 20:00), a nie tygodniowe.
 */

import type { ZrodlaDanych } from "./db/pula.js";
import {
  oznaczWyslane,
  subskrypcjeUzytkownika,
  usunSubskrypcje,
  wyslaneDzis,
} from "./db/rejestr.js";
import { aktywneKonta } from "./domain/konta.js";
import { odczytajRodzaje, powiadomieniaNaTeraz } from "./domain/powiadomienia.js";
import { zapewnijRaporty } from "./domain/raporty.js";
import { czySubskrypcjaMartwa, type Push } from "./lib/push.js";
import { dataLokalna, terazUtc } from "./lib/time.js";

const CO_GODZINE_MS = 60 * 60 * 1000;

/**
 * Pięć minut, a nie godzina: pory powiadomień to konkretne godziny, a interwał
 * liczy się od startu procesu. Restart o 8:37 przesunąłby godzinny tik na 9:37,
 * 10:37 i osiemnasta nie wypadłaby nigdy.
 *
 * Osobny od tiku raportów, a nie wspólny: jeden pięciominutowy puszczałby
 * `zapewnijRaporty` dwanaście razy częściej bez żadnego zysku, a błąd raportu
 * zabierałby ze sobą wysyłkę.
 */
const CO_5_MINUT_MS = 5 * 60 * 1000;

export function uruchomHarmonogram(zrodla: ZrodlaDanych, push?: Push): () => void {
  const przebiegRaportow = (): void => {
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

  przebiegRaportow();
  const uchwytRaportow = setInterval(przebiegRaportow, CO_GODZINE_MS);
  // Bez unref() timer trzymałby proces przy życiu przy próbie zamknięcia.
  uchwytRaportow.unref();

  if (!push) {
    return () => clearInterval(uchwytRaportow);
  }

  const przebiegPowiadomien = (): void => przeslijPowiadomienia(zrodla, push);

  przebiegPowiadomien();
  const uchwytPowiadomien = setInterval(przebiegPowiadomien, CO_5_MINUT_MS);
  uchwytPowiadomien.unref();

  return () => {
    clearInterval(uchwytRaportow);
    clearInterval(uchwytPowiadomien);
  };
}

/**
 * Jeden przebieg po kontach. Celowo SYNCHRONICZNY: `setInterval(async …)`
 * nakłada przebiegi, więc przy jednym zawieszonym połączeniu o osiemnastej
 * biegłyby dwa naraz. Wysyłka idzie obok, wzorem `wyslijWTle` z tras — jej
 * wynik nie może wstrzymywać pętli ani decydować o śladzie.
 *
 * `teraz` jest parametrem wyłącznie po to, żeby dało się to przetestować —
 * ta sama zasada, co przy `powiadomieniaNaTeraz` i `trendWagi`.
 */
export function przeslijPowiadomienia(
  zrodla: ZrodlaDanych,
  push: Push,
  teraz: string = terazUtc(),
): void {
  for (const konto of aktywneKonta(zrodla.rejestr)) {
    try {
      // Odsiew od najtańszego: konto, które powiadomień nie chce, nie ma po co
      // otwierać dziennika. Główny wyłącznik jest już w wierszu konta.
      //
      // Pusta lista rodzajów NIE przerywa: rodzaje stałe (wisząca sesja, gotowy
      // raport, cisza na wadze) własnych przełączników nie mają, więc odhaczenie
      // wszystkich trzech szczegółowych znaczy „nie chcę codziennych przypomnień",
      // a nie „nie chcę wiedzieć, że otwarta sesja blokuje mi trening".
      if (!konto.powiadomienia_wlaczone) continue;

      const subskrypcje = subskrypcjeUzytkownika(zrodla.rejestr, konto.id);
      if (subskrypcje.length === 0) continue;

      const wlaczone = odczytajRodzaje(konto.powiadomienia);

      const data = dataLokalna(teraz, konto.strefa);

      const doWyslania = powiadomieniaNaTeraz(zrodla.pula.daj(konto.id), {
        teraz,
        strefa: konto.strefa,
        wlaczone,
        juzWyslane: wyslaneDzis(zrodla.rejestr, konto.id, data),
      });

      for (const powiadomienie of doWyslania) {
        // Ślad PRZED wysyłką. Przy niedostępnym push service odwrotna kolejność
        // dawałaby ponawianie co pięć minut do północy — a zgubione
        // powiadomienie jest kłopotem, powódź powiadomień awarią.
        const pierwszyRaz = oznaczWyslane(zrodla.rejestr, {
          uzytkownik_id: konto.id,
          data_lokalna: data,
          rodzaj: powiadomienie.rodzaj,
          wyslano: teraz,
        });
        if (!pierwszyRaz) continue;

        for (const subskrypcja of subskrypcje) {
          void push
            .wyslij(subskrypcja, {
              tytul: powiadomienie.tytul,
              tresc: powiadomienie.tresc,
              ekran: powiadomienie.ekran,
              rodzaj: powiadomienie.rodzaj,
            })
            .catch((blad: unknown) => {
              if (czySubskrypcjaMartwa(blad)) {
                // Przeglądarka wyrzuciła subskrypcję: aplikacja odinstalowana,
                // dane wyczyszczone, zgoda cofnięta. Bez skasowania wiersza tik
                // do końca świata pukałby w martwy adres.
                usunSubskrypcje(zrodla.rejestr, subskrypcja.id);
                return;
              }
              console.error(`Nie udało się wysłać powiadomienia do ${konto.login}:`, blad);
            });
        }
      }
    } catch (blad) {
      console.error(`Nie udało się przygotować powiadomień dla ${konto.login}:`, blad);
    }
  }
}
