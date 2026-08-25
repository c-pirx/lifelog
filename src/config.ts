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

/** Wczytuje plik .env, jeśli istnieje. Brak pliku nie jest błędem. */
export function wczytajPlikEnv(): void {
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
    host: process.env["HOST"] ?? "::",
    sciezkaBazy: process.env["DB_PATH"] ?? "./dane/asystent.db",
    mcpToken: wymagana("MCP_TOKEN", braki),
    hasloAplikacji: wymagana("APP_PASSWORD", braki),
    sekretSesji: wymagana("SESSION_SECRET", braki),
    strefa: process.env["TZ_APP"] ?? "Europe/Warsaw",
  };

  if (braki.length > 0) {
    throw new Error(
      `Brak wymaganych zmiennych środowiskowych: ${braki.join(", ")}.\n` +
        "Skopiuj .env.example do .env i uzupełnij. Sekrety wygenerujesz przez:\n" +
        '  node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  if (!Number.isInteger(konfiguracja.port) || konfiguracja.port <= 0) {
    throw new Error(`PORT musi być dodatnią liczbą całkowitą, otrzymano: ${process.env["PORT"]}`);
  }

  return konfiguracja;
}
