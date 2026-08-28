/**
 * Wysyłka poczty — jedyne miejsce, w którym aplikacja rozmawia ze światem
 * poza własnym serwerem.
 *
 * Transport jest cienki celowo: `fetch` do HTTP API Resendu, zero nowych
 * zależności w package.json. Dostawca odpowiada za SPF i DKIM, więc mail
 * z powiadomieniem nie ląduje w spamie — czego samodzielny SMTP na VPS-ie
 * bez reputacji nie gwarantuje.
 *
 * Poczta jest WSTRZYKIWANA do aplikacji, nie importowana przez trasy. Dzięki
 * temu testy podstawiają atrapę i żaden z nich nie dobija się do internetu.
 * Jest też OPCJONALNA: bez kompletu zmiennych aplikacja wstaje i zapisy
 * działają, tylko maile nie wychodzą — patrz `wczytajPoczte` w config.ts.
 *
 * Treść wiadomości mieszka osobno, w `domain/wiadomosci.ts`: co napisać to
 * decyzja produktowa, czym wysłać — techniczna.
 */

const ADRES_API = "https://api.resend.com/emails";

/** Wysyłka nie może wisieć w nieskończoność; zapis na listę już się udał. */
const LIMIT_CZASU_MS = 10_000;

export type Wiadomosc = {
  odbiorca: string;
  temat: string;
  tekst: string;
  html: string;
};

export type Poczta = {
  /** Odrzucone obietnice obsługuje wołający — zapis danych już się powiódł. */
  wyslij(wiadomosc: Wiadomosc): Promise<void>;
  /** Czy cokolwiek naprawdę wychodzi. Widoczne w /zdrowie. */
  readonly wlaczona: boolean;
};

export type UstawieniaPoczty = {
  klucz: string;
  /** Nadawca w formacie „Nazwa <adres@domena>". */
  nadawca: string;
};

export function pocztaResend(ustawienia: UstawieniaPoczty): Poczta {
  return {
    wlaczona: true,
    async wyslij(wiadomosc: Wiadomosc): Promise<void> {
      const odpowiedz = await fetch(ADRES_API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ustawienia.klucz}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: ustawienia.nadawca,
          to: [wiadomosc.odbiorca],
          subject: wiadomosc.temat,
          text: wiadomosc.tekst,
          html: wiadomosc.html,
        }),
        signal: AbortSignal.timeout(LIMIT_CZASU_MS),
      });

      if (!odpowiedz.ok) {
        // Treść błędu Resendu bywa jedyną wskazówką, co jest nie tak
        // z domeną nadawcy — bez niej diagnoza to zgadywanie.
        const powod = await odpowiedz.text().catch(() => "");
        throw new Error(`Resend odrzucił wysyłkę (${odpowiedz.status}): ${powod.slice(0, 300)}`);
      }
    },
  };
}
