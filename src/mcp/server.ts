/**
 * Wystawienie serwera MCP przez HTTP.
 *
 * Tryb bezstanowy: każde żądanie dostaje własną instancję serwera i transportu.
 * Nie ma sesji do wygaśnięcia ani stanu do zsynchronizowania między procesami —
 * cały stan aplikacji i tak żyje w bazie.
 *
 * Kolejność w `obsluz` jest gwarancją izolacji między użytkownikami i nie
 * wolno jej odwrócić: najpierw token wskazuje konto w rejestrze, potem pula
 * oddaje dziennik TEGO konta, i dopiero wtedy powstają narzędzia — z uchwytem
 * zamkniętym w domknięciu. Żadne narzędzie nie przyjmuje parametru
 * wskazującego użytkownika, więc rozmowa nie ma jak wskazać cudzej bazy.
 */

import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Hono, type Context } from "hono";

import type { ZrodlaDanych } from "../db/pula.js";
import { odnotujKonektor, uzytkownikPoTokenie, type Konto } from "../domain/konta.js";
import { zarejestrujNarzedzia } from "./tools.js";

export type SrodowiskoMcp = { Bindings: HttpBindings };

const NAZWA_SERWERA = "asystent-diety-treningu";
const WERSJA = "0.1.0";

export function utworzRouterMcp(zrodla: ZrodlaDanych) {
  const { rejestr, pula } = zrodla;
  const router = new Hono<SrodowiskoMcp>();

  // Token w ścieżce, bo konektor Claude przyjmuje tylko adres URL —
  // uwierzytelnianie nagłówkiem jest u Anthropic wciąż w wersji beta.
  // Nagłówek Authorization obsługujemy dodatkowo, dla klientów, które go potrafią.
  //
  // W rejestrze leży wyłącznie SHA-256 tokenu, więc rozpoznanie to lookup
  // po indeksie UNIQUE — bez porównywania jawnych sekretów, a więc i bez
  // wycieku czasowego, który trzeba by neutralizować ręcznie.
  const rozpoznajKonto = (c: Context<SrodowiskoMcp>): Konto | null => {
    const zeSciezki = c.req.param("token");
    if (zeSciezki) {
      const konto = uzytkownikPoTokenie(rejestr, zeSciezki);
      if (konto) return konto;
    }

    const naglowek = c.req.header("authorization") ?? "";
    const zNaglowka = naglowek.replace(/^Bearer\s+/i, "");
    return zNaglowka === "" ? null : uzytkownikPoTokenie(rejestr, zNaglowka);
  };

  const obsluz = async (c: Context<SrodowiskoMcp>) => {
    const konto = rozpoznajKonto(c);
    if (!konto) {
      return c.json({ error: "Brak dostępu" }, 401);
    }

    // Zasila wskaźnik „✓ połączono" na ekranie Konto.
    odnotujKonektor(rejestr, konto.id, new Date().toISOString());

    const db = pula.daj(konto.id);
    const server = new McpServer({ name: NAZWA_SERWERA, version: WERSJA });
    zarejestrujNarzedzia(server, db, konto.strefa);

    // Zwykły JSON zamiast strumienia SSE: żadne z narzędzi nie strumieniuje
    // wyników, a prostsza odpowiedź ułatwia napisanie własnego mostu stdio.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // Instancje żyją tylko na czas żądania — sprzątamy, gdy odpowiedź się zamknie.
    c.env.outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);

    const cialo = c.req.header("content-type")?.includes("application/json")
      ? await c.req.json().catch(() => undefined)
      : undefined;

    await transport.handleRequest(c.env.incoming, c.env.outgoing, cialo);

    return RESPONSE_ALREADY_SENT;
  };

  router.all("/", obsluz);
  router.all("/:token", obsluz);

  return router;
}
