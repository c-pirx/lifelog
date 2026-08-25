/**
 * Wystawienie serwera MCP przez HTTP.
 *
 * Tryb bezstanowy: każde żądanie dostaje własną instancję serwera i transportu.
 * Nie ma sesji do wygaśnięcia ani stanu do zsynchronizowania między procesami —
 * cały stan aplikacji i tak żyje w bazie.
 */

import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Hono, type Context } from "hono";

import type { Baza } from "../db/index.js";
import { zarejestrujNarzedzia } from "./tools.js";

export type SrodowiskoMcp = { Bindings: HttpBindings };

const NAZWA_SERWERA = "asystent-diety-treningu";
const WERSJA = "0.1.0";

/**
 * Porównanie odporne na atak czasowy. Dla jednoosobowej aplikacji to ostrożność
 * na wyrost, ale kosztuje jedną funkcję.
 */
function tokenPasuje(podany: string, oczekiwany: string): boolean {
  if (podany.length !== oczekiwany.length) return false;
  let roznica = 0;
  for (let i = 0; i < podany.length; i += 1) {
    roznica |= podany.charCodeAt(i) ^ oczekiwany.charCodeAt(i);
  }
  return roznica === 0;
}

export function utworzRouterMcp(db: Baza, token: string, strefa: string) {
  const router = new Hono<SrodowiskoMcp>();

  // Token w ścieżce, bo konektor Claude przyjmuje tylko adres URL —
  // uwierzytelnianie nagłówkiem jest u Anthropic wciąż w wersji beta.
  // Nagłówek Authorization obsługujemy dodatkowo, dla klientów, które go potrafią.
  const sprawdzToken = (c: Context<SrodowiskoMcp>): boolean => {
    const zeSciezki = c.req.param("token");
    if (zeSciezki && tokenPasuje(zeSciezki, token)) return true;

    const naglowek = c.req.header("authorization") ?? "";
    const zNaglowka = naglowek.replace(/^Bearer\s+/i, "");
    return zNaglowka !== "" && tokenPasuje(zNaglowka, token);
  };

  const obsluz = async (c: Context<SrodowiskoMcp>) => {
    if (!sprawdzToken(c)) {
      return c.json({ error: "Brak dostępu" }, 401);
    }

    const server = new McpServer({ name: NAZWA_SERWERA, version: WERSJA });
    zarejestrujNarzedzia(server, db, strefa);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

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
