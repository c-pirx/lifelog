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

const WERSJA = "v19";
const CACHE_POWLOKI = `powloka-${WERSJA}`;
const CACHE_API = `api-${WERSJA}`;

/** Plik powłoki. Serwer wystawia go pod /app; „/" należy do strony powitalnej. */
const POWLOKA_HTML = "/aplikacja.html";

// Strony powitalnej celowo NIE ma na tej liście: zmienia się częściej niż
// aplikacja i ma być zawsze świeża. Ofline'u wymaga wyłącznie aplikacja.
const POWLOKA = [
  POWLOKA_HTML,
  "/aktywnosci.js",
  "/app.js",
  "/dieta.js",
  "/kalendarz.js",
  "/kolejka.js",
  "/makra.js",
  "/nakladka.js",
  "/notatki.js",
  "/posilek.js",
  "/przerwa.js",
  "/raporty.js",
  "/seria.js",
  "/znaki.js",
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

// === Powiadomienia push ==================================================

/**
 * Ładunek jest w całości od naszego serwera i to on decyduje o treści —
 * service worker niczego nie dopisuje ani nie tłumaczy.
 *
 * `tag` po rodzaju powiadomienia: to samo przypomnienie przysłane dwa razy ma
 * podmienić poprzednie, a nie ułożyć się w stos. Ślad wysyłki w rejestrze
 * powinien to wykluczyć, ale duplikat na ekranie jest gorszy niż jego brak.
 */
self.addEventListener("push", (zdarzenie) => {
  if (!zdarzenie.data) return;

  let ladunek;
  try {
    ladunek = zdarzenie.data.json();
  } catch {
    return;
  }

  zdarzenie.waitUntil(
    self.registration.showNotification(ladunek.tytul, {
      body: ladunek.tresc,
      icon: "/icons/ikona-192.png",
      badge: "/icons/ikona-192.png",
      tag: ladunek.rodzaj ?? "lifelog",
      data: { ekran: ladunek.ekran ?? "dzis" },
    }),
  );
});

/**
 * Stuknięcie otwiera zakładkę, o której mówi powiadomienie.
 *
 * Otwarte okno dostaje `postMessage`, a nie `navigate`: przy różnicy samego
 * fragmentu adresu nawigacja nie przeładowałaby dokumentu, więc kod startowy
 * czytający hash nigdy by nie pobiegł, a użytkownik zostałby na ekranie,
 * który akurat miał przed sobą.
 */
self.addEventListener("notificationclick", (zdarzenie) => {
  zdarzenie.notification.close();
  const ekran = zdarzenie.notification.data?.ekran ?? "dzis";

  zdarzenie.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((okna) => {
      const otwarte = okna.find((okno) => new URL(okno.url).pathname.startsWith("/app"));
      if (otwarte) {
        otwarte.postMessage({ ekran });
        return otwarte.focus();
      }
      return self.clients.openWindow(`/app#${ekran}`);
    }),
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

  // Żądania zakresowe omijają cache w całości. Odtwarzacz wideo prosi
  // o fragmenty pliku, a Cache API odrzuca odpowiedzi 206 — `cache.put`
  // sypałby odrzuconą obietnicą przy każdym kawałku nagrania. Nawet gdyby
  // przyjmował: film ze strony powitalnej nie ma czego szukać w magazynie,
  // który istnieje po to, żeby dziennik otwierał się w piwnicy siłowni.
  if (zadanie.headers.has("range")) return;

  if (adres.pathname.startsWith("/api/") || adres.pathname === "/zdrowie") {
    zdarzenie.respondWith(siecPotemCache(zadanie));
    return;
  }

  if (zadanie.mode === "navigate") {
    // Aplikacja: powłoka z cache, odświeżenie w tle. To ta gałąź sprawia,
    // że w piwnicy siłowni cokolwiek się otwiera.
    if (adres.pathname === "/app" || adres.pathname.startsWith("/app/")) {
      zdarzenie.respondWith(cachePotemSiec(new Request(POWLOKA_HTML)));
      return;
    }

    // „/" to strona powitalna — najpierw sieć, bo ma być świeża.
    //
    // Zapas z powłoki jest tu mimo to konieczny: kto zainstalował aplikację
    // wcześniej, ma w skrócie na ekranie głównym jeszcze stare start_url „/".
    // Bez tej gałęzi taka osoba straciłaby tryb offline — czyli aplikacja
    // zepsułaby się dokładnie tam, po co ją w ogóle instalowała.
    if (adres.pathname === "/") {
      zdarzenie.respondWith(fetch(zadanie).catch(() => cachePotemSiec(new Request(POWLOKA_HTML))));
      return;
    }

    // Reszta stron (polityka, potwierdzenie wypisu) idzie zwykłą drogą —
    // podanie im powłoki aplikacji byłoby podmianą treści.
    return;
  }

  zdarzenie.respondWith(cachePotemSiec(zadanie));
});
