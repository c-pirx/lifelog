/**
 * Strona powitalna: przekierowanie zalogowanych, animacja podpisu i zapis
 * na listę oczekujących.
 *
 * Świadomie nie rejestruje service workera — powłoka aplikacji mieszka pod
 * /app i to ona ma być dostępna bez zasięgu. Strona powitalna ma być zawsze
 * świeża, bo zmienia się częściej niż aplikacja.
 */

const CZAS_OTWARCIA = Date.now();

// === Zalogowany trafia prosto do aplikacji ===============================

// Ktoś z zainstalowaną wcześniej aplikacją ma w zakładce jeszcze stare „/".
// Bez tego zobaczyłby stronę marketingową zamiast swojego dnia.
fetch("/api/konto", { credentials: "same-origin" })
  .then((odpowiedz) => {
    if (odpowiedz.ok) location.replace("/app");
  })
  .catch(() => {
    // Brak sieci: zostajemy na stronie powitalnej. Aplikacja i tak nie ma
    // stąd czego pokazać.
  });

// === Podpis strony: zdanie zamienia się w zapis ==========================

/**
 * Trzy przykłady, po jednym na drogę zapisu: posiłek, seria, notatka.
 * Etykiety pól są dokładnie te, których używa dziennik — to ma być podgląd
 * produktu, nie jego reklama.
 */
const PRZYKLADY = [
  {
    mowa: "zjadłem dwa jajka na maśle i tosta",
    pola: [
      ["posiłek", "jajecznica z tostem"],
      ["kcal", "410"],
      ["b/w/t", "24 / 28 / 22"],
    ],
  },
  {
    mowa: "wyciskanie, ósemka na sześćdziesiąt, trzecia seria",
    pola: [
      ["ćwiczenie", "wyciskanie sztangi"],
      ["seria", "3"],
      ["wynik", "8 × 60 kg"],
      ["", "rekord"],
    ],
  },
  {
    mowa: "przejechałem dwadzieścia dwa kilometry w godzinę i pięć",
    pola: [
      ["aktywność", "rower"],
      ["dystans", "22 km"],
      ["czas", "1:05"],
    ],
  },
];

const PREFERUJE_SPOKOJ = matchMedia("(prefers-reduced-motion: reduce)").matches;

const przemiana = document.getElementById("przemiana");
const mowa = document.getElementById("mowa");
const zapis = document.getElementById("zapis");

function pokazZapis(przyklad) {
  zapis.replaceChildren(
    ...przyklad.pola.map(([etykieta, wartosc], i) => {
      const pole = document.createElement("span");
      pole.className = "pole";
      if (etykieta) {
        const nazwa = document.createElement("span");
        nazwa.textContent = etykieta;
        pole.append(nazwa);
      }
      pole.append(wartosc);
      // Pola wjeżdżają po kolei — tak, jak model wypełnia je czytając zdanie.
      pole.style.animationDelay = `${i * 90}ms`;
      return pole;
    }),
  );
}

function czekaj(ms) {
  return new Promise((gotowe) => setTimeout(gotowe, ms));
}

async function napisz(tekst) {
  przemiana.classList.add("pisze");
  mowa.textContent = "";
  for (const znak of tekst) {
    mowa.textContent += znak;
    // Nierówny rytm: równe odstępy brzmią jak maszyna, nie jak mowa.
    await czekaj(znak === " " ? 55 : 26);
  }
  przemiana.classList.remove("pisze");
}

async function karuzela() {
  let i = 0;
  for (;;) {
    const przyklad = PRZYKLADY[i % PRZYKLADY.length];
    zapis.replaceChildren();
    await napisz(przyklad.mowa);
    await czekaj(320);
    pokazZapis(przyklad);
    await czekaj(4200);
    i += 1;
  }
}

if (przemiana && !PREFERUJE_SPOKOJ) {
  // Stan początkowy jest już w HTML-u, więc przy wyłączonym JS-ie strona
  // pokazuje kompletny przykład, tylko bez ruchu.
  void karuzela();
}

// === Zapis na listę =====================================================

/**
 * Dwa formularze — w nagłówku i w stopce — obsługiwane tą samą funkcją.
 * Kopia logiki rozjechałaby się przy pierwszej poprawce.
 */
function podłączFormularz({ formularz, email, zgoda, pulapka, przycisk, komunikat }) {
  if (!formularz) return;

  formularz.addEventListener("submit", async (zdarzenie) => {
    zdarzenie.preventDefault();

    // Blokada obejmuje formularz, nie sam przycisk: klawisz „Gotowe"
    // z klawiatury telefonu wysyła formularz z pominięciem przycisku.
    if (formularz.dataset.wysyla === "tak") return;

    komunikat.textContent = "";
    komunikat.classList.remove("zly");

    if (!email.value.trim()) {
      komunikat.textContent = "Wpisz adres e-mail.";
      komunikat.classList.add("zly");
      email.focus();
      return;
    }
    if (!zgoda.checked) {
      komunikat.textContent = "Zaznacz zgodę — bez niej nie możemy zapisać adresu.";
      komunikat.classList.add("zly");
      zgoda.focus();
      return;
    }

    formularz.dataset.wysyla = "tak";
    przycisk.disabled = true;
    const napis = przycisk.textContent;
    przycisk.textContent = "Zapisuję…";

    try {
      const odpowiedz = await fetch("/api/lista", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.value.trim(),
          zgoda: true,
          pulapka: pulapka.value,
          otwarto: CZAS_OTWARCIA,
        }),
      });

      if (!odpowiedz.ok) {
        const tresc = await odpowiedz.json().catch(() => ({}));
        throw new Error(tresc.blad ?? "Nie udało się zapisać. Spróbuj za chwilę.");
      }

      // Podziękowanie w miejscu formularza: znikający komunikat na stronie,
      // którą się przewija, przepada zanim ktokolwiek go przeczyta.
      const gotowe = document.createElement("div");
      gotowe.className = "gotowe";
      gotowe.innerHTML =
        "<p>Jesteś na liście.</p>" +
        "<p>Wysłaliśmy potwierdzenie — jeśli go nie widać, sprawdź spam. " +
        "Następny mail od nas to już zaproszenie.</p>";
      formularz.replaceWith(gotowe);
    } catch (blad) {
      komunikat.textContent = blad.message;
      komunikat.classList.add("zly");
      formularz.dataset.wysyla = "nie";
      przycisk.disabled = false;
      przycisk.textContent = napis;
    }
  });
}

podłączFormularz({
  formularz: document.getElementById("formularz"),
  email: document.getElementById("email"),
  zgoda: document.getElementById("zgoda"),
  pulapka: document.getElementById("pulapka"),
  przycisk: document.getElementById("przycisk"),
  komunikat: document.getElementById("komunikat"),
});

podłączFormularz({
  formularz: document.getElementById("formularz-stopka"),
  email: document.getElementById("email-stopka"),
  zgoda: document.getElementById("zgoda-stopka"),
  pulapka: document.getElementById("pulapka-stopka"),
  przycisk: document.getElementById("przycisk-stopka"),
  komunikat: document.getElementById("komunikat-stopka"),
});
