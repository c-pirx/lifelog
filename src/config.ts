/**
 * Konfiguracja czytana wyłącznie ze zmiennych środowiskowych.
 *
 * Aplikacja nie wie nic o hostingu — plik `.env` lokalnie, zmienne środowiska
 * w kontenerze. Braki wykrywamy przy starcie, a nie przy pierwszym żądaniu.
 */

export type Konfiguracja = {
  port: number;
  /** Interfejs nasłuchu. Za reverse proxy ustawiamy 127.0.0.1. */
  host: string;
  /** Katalog danych: rejestr.db i podkatalog uzytkownicy/ z dziennikami. */
  katalogDanych: string;
  sekretSesji: string;
  /** Strefa domyślna: /zdrowie i konta zakładane bez podania strefy. */
  strefa: string;
  /**
   * Poczta wychodząca. Wszystkie trzy pola albo żadne — komplet włącza wysyłkę,
   * brak choćby jednego zostawia aplikację działającą, tylko bez maili.
   */
  poczta: KonfiguracjaPoczty | null;
  /** Powiadomienia push. Ta sama zasada „komplet albo nic" co przy poczcie. */
  push: KonfiguracjaPush | null;
};

export type KonfiguracjaPush = {
  /** Klucz publiczny VAPID — trafia też do przeglądarki. */
  publiczny: string;
  prywatny: string;
  /** Kontakt do właściciela serwera, format `mailto:…`. Wymaga go standard. */
  kontakt: string;
};

export type KonfiguracjaPoczty = {
  /** Klucz API Resendu. */
  klucz: string;
  /** Nadawca w formacie „Nazwa <adres@domena>". */
  nadawca: string;
  /** Adres, na który idą powiadomienia o zapisach na listę. */
  gospodarz: string;
  /** Publiczny adres aplikacji, bez ukośnika — do linków w mailach. */
  adresPubliczny: string;
};

/**
 * Najniższa wersja Node, na której aplikacja działa. Musi zgadzać się z polem
 * `engines.node` w package.json — pilnuje tego test w `test/wersja.test.ts`.
 * Próg wyznacza `process.loadEnvFile()`, dostępne od 20.12.
 */
export const WYMAGANY_NODE = "20.12.0";

/**
 * Przerywa z czytelnym komunikatem, jeśli Node jest za stary.
 *
 * Bez tego objaw był mylący: `process.loadEnvFile` nie istniało, wyjątek
 * ginął w `catch`, a użytkownik dostawał komunikat o brakujących zmiennych
 * środowiskowych — mimo poprawnie wypełnionego .env.
 */
export function sprawdzWersjeNode(): void {
  if (typeof process.loadEnvFile !== "function") {
    throw new Error(
      `Potrzebny Node.js ${WYMAGANY_NODE} lub nowszy (masz ${process.versions.node}).\n` +
        "Aktualizacja: https://nodejs.org — weź wersję LTS.",
    );
  }
}

/** Wczytuje plik .env, jeśli istnieje. Brak pliku nie jest błędem. */
export function wczytajPlikEnv(): void {
  sprawdzWersjeNode();

  try {
    process.loadEnvFile();
  } catch {
    // Brak .env — zmienne przychodzą ze środowiska (kontener, systemd).
  }
}

function wymagana(nazwa: string, braki: string[]): string {
  const wartosc = process.env[nazwa];
  if (!wartosc || wartosc.trim() === "") {
    braki.push(nazwa);
    return "";
  }
  return wartosc;
}

/**
 * Poczta jest OPCJONALNA i to świadoma decyzja: gdyby jej zmienne były
 * wymagane, jedno pole zapomniane w /etc/asystent/env kładłoby aplikację przy
 * wdrożeniu — a systemd restartowałby ją w pętli. Brak maili jest kłopotem,
 * brak aplikacji awarią. Widać to w /zdrowie i w logu przy starcie.
 *
 * Komplet albo nic: sam klucz bez adresu publicznego dawałby maile z linkami
 * donikąd, czyli gorzej niż brak maila.
 */
function wczytajPoczte(): KonfiguracjaPoczty | null {
  const klucz = process.env["RESEND_API_KEY"]?.trim();
  const nadawca = process.env["MAIL_OD"]?.trim();
  const gospodarz = process.env["MAIL_GOSPODARZ"]?.trim();
  const adresPubliczny = process.env["PUBLICZNY_ADRES"]?.trim().replace(/\/+$/, "");

  if (!klucz || !nadawca || !gospodarz || !adresPubliczny) return null;
  return { klucz, nadawca, gospodarz, adresPubliczny };
}

/**
 * Powiadomienia push — opcjonalne z tego samego powodu co poczta i tak samo
 * „komplet albo nic". Sam klucz publiczny bez prywatnego dałby aplikację, która
 * pozwala się zasubskrybować, a potem nigdy nic nie wysyła: gorzej niż wyłączona
 * wprost, bo użytkownik czeka na powiadomienia, które nie przyjdą.
 */
function wczytajPush(): KonfiguracjaPush | null {
  const publiczny = process.env["VAPID_PUBLICZNY"]?.trim();
  const prywatny = process.env["VAPID_PRYWATNY"]?.trim();
  const kontakt = process.env["VAPID_KONTAKT"]?.trim();

  if (!publiczny || !prywatny || !kontakt) return null;
  return { publiczny, prywatny, kontakt };
}

export function wczytajKonfiguracje(): Konfiguracja {
  const braki: string[] = [];

  const konfiguracja: Konfiguracja = {
    port: Number(process.env["PORT"] ?? 3000),
    // Domyślnie wszystkie interfejsy, żeby praca lokalna była wygodna.
    // Na produkcji ustawiamy 127.0.0.1 — do świata wystawia dopiero nginx.
    // Celowo `||`, a nie `??`: w pliku .env pusta wartość ma znaczyć
    // "domyślnie", a `??` przepuściłoby pusty ciąg jako prawidłowy adres.
    host: process.env["HOST"] || "::",
    katalogDanych: process.env["DANE_KATALOG"] ?? "./dane",
    sekretSesji: wymagana("SESSION_SECRET", braki),
    strefa: process.env["TZ_APP"] ?? "Europe/Warsaw",
    poczta: wczytajPoczte(),
    push: wczytajPush(),
  };

  if (braki.length > 0) {
    throw new Error(
      `Brak wymaganych zmiennych środowiskowych: ${braki.join(", ")}.\n` +
        "Uruchom: npm run setup — utworzy .env z wygenerowanymi sekretami.\n" +
        "(Na serwerze zmienne przychodzą z /etc/asystent/env, nie z pliku .env.)",
    );
  }

  if (!Number.isInteger(konfiguracja.port) || konfiguracja.port <= 0) {
    throw new Error(`PORT musi być dodatnią liczbą całkowitą, otrzymano: ${process.env["PORT"]}`);
  }

  return konfiguracja;
}
