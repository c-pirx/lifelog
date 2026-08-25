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
  sciezkaBazy: string;
  mcpToken: string;
  hasloAplikacji: string;
  sekretSesji: string;
  strefa: string;
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

export function wczytajKonfiguracje(): Konfiguracja {
  const braki: string[] = [];

  const konfiguracja: Konfiguracja = {
    port: Number(process.env["PORT"] ?? 3000),
    // Domyślnie wszystkie interfejsy, żeby praca lokalna była wygodna.
    // Na produkcji ustawiamy 127.0.0.1 — do świata wystawia dopiero nginx.
    // Celowo `||`, a nie `??`: w pliku .env pusta wartość ma znaczyć
    // "domyślnie", a `??` przepuściłoby pusty ciąg jako prawidłowy adres.
    host: process.env["HOST"] || "::",
    sciezkaBazy: process.env["DB_PATH"] ?? "./dane/asystent.db",
    mcpToken: wymagana("MCP_TOKEN", braki),
    hasloAplikacji: wymagana("APP_PASSWORD", braki),
    sekretSesji: wymagana("SESSION_SECRET", braki),
    strefa: process.env["TZ_APP"] ?? "Europe/Warsaw",
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
