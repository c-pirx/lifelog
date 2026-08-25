/**
 * Service worker: powłoka aplikacji i ostatni znany stan bez sieci.
 *
 * Bez niego aplikacja w siłowni bez zasięgu w ogóle się nie otwierała — a do
 * siłowni wchodzi się z aplikacją zamkniętą, więc sama kolejka zapisów by nie
 * wystarczyła.
 *
 * Zapisy (POST) celowo NIE przechodzą tędy. Zajmuje się nimi kolejka
 * w kolejka.js, która potrafi je odłożyć i wysłać później — service worker
 * umiałby najwyżej udać, że się udało.
 */

const WERSJA = "v2";
const CACHE_POWLOKI = `powloka-${WERSJA}`;
const CACHE_API = `api-${WERSJA}`;

const POWLOKA = [
  "/",
  "/index.html",
  "/app.js",
  "/kolejka.js",
  "/nakladka.js",
  "/raporty.js",
  "/style.css",
  "/manifest.json",
  "/icons/ikona-180.png",
  "/icons/ikona-192.png",
  "/icons/ikona-512.png",
];

self.addEventListener("install", (zdarzenie) => {
  zdarzenie.waitUntil(
    caches
      .open(CACHE_POWLOKI)
      .then((cache) => cache.addAll(POWLOKA))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (zdarzenie) => {
  zdarzenie.waitUntil(
    caches
      .keys()
      .then((klucze) =>
        Promise.all(klucze.filter((k) => !k.endsWith(WERSJA)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Dane: najpierw sieć, cache jako zapas.
 *
 * Zapisujemy wyłącznie udane odpowiedzi. Zbuforowane 401 byłoby gorsze niż brak
 * cache'u — aplikacja pokazywałaby ekran logowania także po odzyskaniu sieci.
 */
async function siecPotemCache(zadanie) {
  try {
    const odpowiedz = await fetch(zadanie);
    if (odpowiedz.ok) {
      const cache = await caches.open(CACHE_API);
      await cache.put(zadanie, odpowiedz.clone());
    }
    return odpowiedz;
  } catch (problem) {
    const zapas = await caches.match(zadanie);
    if (zapas) return zapas;
    // Brak zapasu — niech żądanie polegnie tak jak zwykle, żeby aplikacja
    // rozpoznała brak sieci, a nie odpowiedź serwera.
    throw problem;
  }
}

/**
 * Powłoka: najpierw cache, odświeżenie w tle.
 *
 * Dzięki odświeżaniu w tle nowa wersja dociera nawet wtedy, gdy zapomnimy
 * podbić WERSJĘ — kolejne otwarcie aplikacji dostaje świeże pliki.
 */
async function cachePotemSiec(zadanie) {
  const cache = await caches.open(CACHE_POWLOKI);
  const zcache = await cache.match(zadanie, { ignoreSearch: true });

  const zsieci = fetch(zadanie)
    .then((odpowiedz) => {
      if (odpowiedz.ok) cache.put(zadanie, odpowiedz.clone());
      return odpowiedz;
    })
    .catch(() => undefined);

  return zcache ?? (await zsieci) ?? Response.error();
}

self.addEventListener("fetch", (zdarzenie) => {
  const zadanie = zdarzenie.request;

  if (zadanie.method !== "GET") return;

  const adres = new URL(zadanie.url);
  if (adres.origin !== self.location.origin) return;

  // Logowanie i konektor MCP zawsze prosto do serwera.
  if (adres.pathname.startsWith("/mcp")) return;

  if (adres.pathname.startsWith("/api/") || adres.pathname === "/zdrowie") {
    zdarzenie.respondWith(siecPotemCache(zadanie));
    return;
  }

  // Wejście do aplikacji z zakładki na ekranie głównym to nawigacja pod „/",
  // ale po odświeżeniu potrafi przyjść pod dowolną ścieżką — obie mają dostać
  // tę samą powłokę.
  if (zadanie.mode === "navigate") {
    zdarzenie.respondWith(cachePotemSiec(new Request("/index.html")));
    return;
  }

  zdarzenie.respondWith(cachePotemSiec(zadanie));
});
