#!/usr/bin/env node
/**
 * Most stdio ↔ HTTP dla Claude Desktop.
 *
 * Claude Desktop rozmawia z serwerami MCP wyłącznie przez stdio, a nasz serwer
 * mówi po HTTP. Ten plik tłumaczy jedno na drugie: czyta wiersze JSON-RPC ze
 * standardowego wejścia, przesyła je na adres serwera i odsyła odpowiedzi
 * z powrotem na standardowe wyjście.
 *
 * Celowo bez zależności — cała paczka rozszerzenia to ten jeden plik, więc nie
 * ma czego instalować ani co się może rozjechać wersjami.
 *
 * Adres serwera przychodzi w zmiennej MCP_URL, ustawianej przez Claude Desktop
 * z pola konfiguracyjnego rozszerzenia.
 */

const ADRES = process.env.MCP_URL;

/** Diagnostyka idzie na stderr — stdout jest zarezerwowany dla protokołu. */
const log = (...czesci) => process.stderr.write(`[most] ${czesci.join(" ")}\n`);

if (!ADRES) {
  log("Brak adresu serwera (MCP_URL). Uzupełnij konfigurację rozszerzenia.");
  process.exit(1);
}

const wyslij = (wiadomosc) => process.stdout.write(`${JSON.stringify(wiadomosc)}\n`);

/**
 * Wyciąga treść JSON-RPC z odpowiedzi. Serwer zwraca zwykły JSON, ale gdyby
 * kiedyś przełączył się na strumień SSE, obsługujemy też ten format.
 */
function odczytajTresc(typTresci, tekst) {
  if (!tekst.trim()) return null;

  if (typTresci.includes("text/event-stream")) {
    const dane = tekst
      .split("\n")
      .filter((linia) => linia.startsWith("data:"))
      .map((linia) => linia.slice(5).trim())
      .join("");
    return dane ? JSON.parse(dane) : null;
  }

  return JSON.parse(tekst);
}

async function przekaz(linia) {
  let zadanie;
  try {
    zadanie = JSON.parse(linia);
  } catch {
    log("pominięto wiersz, który nie jest poprawnym JSON-em");
    return;
  }

  try {
    const odpowiedz = await fetch(ADRES, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: linia,
    });

    // 202 to potwierdzenie powiadomienia — nie ma treści i nie ma czego odsyłać.
    if (odpowiedz.status === 202) return;

    if (!odpowiedz.ok) {
      throw new Error(`serwer odpowiedział ${odpowiedz.status}`);
    }

    const tresc = odczytajTresc(
      odpowiedz.headers.get("content-type") ?? "",
      await odpowiedz.text(),
    );
    if (tresc) wyslij(tresc);
  } catch (blad) {
    log(`błąd połączenia: ${blad.message}`);

    // Bez odpowiedzi klient czekałby w nieskończoność; powiadomienia (bez id) pomijamy.
    if (zadanie?.id !== undefined) {
      wyslij({
        jsonrpc: "2.0",
        id: zadanie.id,
        error: {
          code: -32_603,
          message:
            `Nie udało się połączyć z serwerem asystenta (${blad.message}). ` +
            "Sprawdź, czy serwer działa: npm run dev",
        },
      });
    }
  }
}

let bufor = "";
process.stdin.setEncoding("utf8");

process.stdin.on("data", (fragment) => {
  bufor += fragment;

  let koniecWiersza;
  while ((koniecWiersza = bufor.indexOf("\n")) !== -1) {
    const linia = bufor.slice(0, koniecWiersza).trim();
    bufor = bufor.slice(koniecWiersza + 1);
    if (linia) void przekaz(linia);
  }
});

process.stdin.on("end", () => process.exit(0));

log(`gotowy, serwer: ${ADRES.replace(/\/mcp\/.*/, "/mcp/<token>")}`);
