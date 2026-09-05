/**
 * Wysyłka powiadomień push — drugie i ostatnie miejsce, w którym aplikacja
 * rozmawia ze światem poza własnym serwerem.
 *
 * Kształt kopiuje `Poczta` z `poczta.ts` i robi to celowo: ta sama rola, ta sama
 * umowa. Transport jest WSTRZYKIWANY do aplikacji, nie importowany przez trasy,
 * więc testy podstawiają atrapę i żaden nie dobija się do internetu. Jest też
 * OPCJONALNY: bez kompletu kluczy VAPID aplikacja wstaje i wszystko działa,
 * tylko powiadomienia nie wychodzą — patrz `wczytajPush` w config.ts.
 *
 * Tu, inaczej niż przy poczcie, sięgamy po bibliotekę. Szyfrowanie ładunku
 * (RFC 8291: ECDH P-256, HKDF, AES-128-GCM) i podpis VAPID to około stu
 * trzydziestu linii kryptografii, w której błąd nie krzyczy — daje ciszę
 * nieodróżnialną od „użytkownik nie ma subskrypcji".
 *
 * O czym mówi treść powiadomienia, decyduje `domain/powiadomienia.ts`: co
 * napisać to sprawa produktowa, czym wysłać — techniczna.
 */

// Import DOMYŚLNY i tylko taki. `web-push` jest paczką CommonJS, a jej eksporty
// powstają wywołaniem `.bind()`, którego `cjs-module-lexer` nie rozpoznaje.
// `import { sendNotification } from "web-push"` przeszedłby kontrolę typów
// i wywalił proces dopiero przy starcie — dlatego sięgamy przez pole.
import webpush from "web-push";

/** Wysyłka nie może wisieć w pętli tiku; biblioteka nie ma własnego limitu. */
const LIMIT_CZASU_MS = 10_000;

/**
 * Ile push service ma przechowywać powiadomienie dla wyłączonego telefonu.
 *
 * Trzy godziny, nie domyślne cztery tygodnie: „dziś dzień treningowy"
 * dostarczone pojutrze jest gorsze niż niedostarczone wcale.
 */
const TTL_S = 3 * 60 * 60;

export type SubskrypcjaPush = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type Ladunek = {
  tytul: string;
  tresc: string;
  /** Zakładka otwierana po stuknięciu — service worker składa z niej adres. */
  ekran: string;
  /** Grupuje powiadomienia w systemie: to samo przypomnienie podmienia poprzednie. */
  rodzaj: string;
};

export type Push = {
  /** Odrzucone obietnice obsługuje wołający — tak samo jak przy `Poczta.wyslij`. */
  wyslij(subskrypcja: SubskrypcjaPush, ladunek: Ladunek): Promise<void>;
  /** Czy cokolwiek naprawdę wychodzi. Widoczne w /zdrowie. */
  readonly wlaczona: boolean;
  /** Klucz publiczny VAPID — aplikacja potrzebuje go do `pushManager.subscribe`. */
  readonly kluczPubliczny: string;
};

export type UstawieniaPush = {
  publiczny: string;
  prywatny: string;
  /** Kontakt do właściciela serwera w formacie `mailto:…` — wymaga go standard. */
  kontakt: string;
};

export function pushWebPush(ustawienia: UstawieniaPush): Push {
  return {
    wlaczona: true,
    kluczPubliczny: ustawienia.publiczny,

    async wyslij(subskrypcja: SubskrypcjaPush, ladunek: Ladunek): Promise<void> {
      await webpush.sendNotification(
        {
          endpoint: subskrypcja.endpoint,
          keys: { p256dh: subskrypcja.p256dh, auth: subskrypcja.auth },
        },
        JSON.stringify(ladunek),
        {
          // Klucze podawane przy KAŻDYM wywołaniu, a nie raz przez
          // `setVapidDetails` — tamto ustawia stan modułowy biblioteki,
          // czyli dokładnie to, czego ten projekt unika wszędzie indziej.
          vapidDetails: {
            subject: ustawienia.kontakt,
            publicKey: ustawienia.publiczny,
            privateKey: ustawienia.prywatny,
          },
          timeout: LIMIT_CZASU_MS,
          TTL: TTL_S,
        },
      );
    },
  };
}

/**
 * Czy błąd znaczy „tej subskrypcji już nie ma".
 *
 * 404 i 410 od push service mówią, że przeglądarka ją wyrzuciła: aplikacja
 * odinstalowana, dane wyczyszczone, użytkownik cofnął zgodę. Wiersz leci wtedy
 * z bazy — bez tego tik do końca świata pukałby w martwy adres.
 *
 * Czytamy samo `statusCode`, bez `instanceof WebPushError`: jedno pole zamiast
 * wciągania klasy z paczki, a atrapa w testach nie musi jej udawać.
 */
export function czySubskrypcjaMartwa(blad: unknown): boolean {
  const status = (blad as { statusCode?: unknown })?.statusCode;
  return status === 404 || status === 410;
}
