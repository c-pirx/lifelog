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
 * Po jednym przykładzie na drogę zapisu: posiłek, seria, notatka, waga,
 * aktywność, poprawka wpisu i cele. Etykiety pól są dokładnie te, których
 * używa dziennik — to ma być podgląd produktu, nie jego reklama.
 *
 * Każde zdanie musi się kończyć WPISEM, bo to obiecuje nagłówek nad ramą.
 * Odczyty („ile mi zostało do celu”) tu nie pasują, choć produkt je umie.
 *
 * Żadne zdanie nie może być dłuższe od kolarskiego — to ono jest miarką
 * rezerwującą wysokość ramy, a wyższa rama spycha formularz poniżej ekranu.
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
    // Notatka powstaje głosem i to model porządkuje formę — stąd zdanie
    // brzmi jak mowa, a wpis jak zdanie. Folder też wybiera model.
    mowa: "zanotuj że kolano znowu bolało przy przysiadach",
    pola: [
      ["notatka", "kolano boli przy przysiadach"],
      ["folder", "dziennik"],
    ],
  },
  {
    mowa: "ważyłem się rano, osiemdziesiąt jeden i pół",
    pola: [
      ["waga", "81,5 kg"],
      ["średnia 7 dni", "81,9 kg"],
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
  {
    // Jedyny przykład, który nie zakłada wpisu, tylko go poprawia. Strzałka
    // w wartości mówi to bez podpisu.
    mowa: "ten obiad to jednak była pół porcji",
    pola: [
      ["poprawka", "obiad"],
      ["kcal", "620 → 310"],
      ["b/w/t", "31 / 20 / 12"],
    ],
  },
  {
    // Data wejścia w życie jest tu sednem: stare dni zachowują stare cele.
    mowa: "od poniedziałku 2200 kcal, 170 gram białka",
    pola: [
      ["cel od", "8 września"],
      ["kcal", "2200"],
      ["b/w/t", "170 / 245 / 60"],
    ],
  },
];

/**
 * Pełny obrót siedmiu przykładów trwa ponad pół minuty — dłużej, niż ktokolwiek
 * patrzy na podpis strony. Pierwszy zostaje na miejscu, bo to on stoi w HTML-u
 * jako stan początkowy; resztę tasujemy, żeby dwie osoby zobaczyły dwie różne
 * pary przykładów zamiast tej samej.
 */
const KOLEJNOSC = [
  PRZYKLADY[0],
  ...PRZYKLADY.slice(1)
    .map((p) => ({ p, klucz: Math.random() }))
    .sort((a, b) => a.klucz - b.klucz)
    .map(({ p }) => p),
];

const PREFERUJE_SPOKOJ = matchMedia("(prefers-reduced-motion: reduce)").matches;

const przemiana = document.getElementById("przemiana");
const mowa = document.getElementById("mowa");
const zapis = document.getElementById("zapis");

// Miarka dostaje najdłuższe zdanie i rezerwuje wysokość ramy — bez niej
// każda zmiana przykładu szarpałaby formularzem tuż pod spodem.
const miarka = document.getElementById("miarka");
if (miarka) {
  miarka.textContent = PRZYKLADY.map((p) => p.mowa).reduce((a, b) =>
    b.length > a.length ? b : a,
  );
}

/**
 * Karuzela staje, gdy hero zjedzie poza ekran albo karta trafi do tła —
 * pisanie zdań, których nikt nie widzi, kosztuje tylko baterię telefonu.
 * Sprawdzenie stoi na początku iteracji: bieżące zdanie zawsze się
 * dokańcza, a wznowienie zaczyna od czystego przykładu.
 */
let heroWidoczne = true;
const wznowienia = [];

function ruszDalej() {
  if (heroWidoczne && !document.hidden) {
    while (wznowienia.length) wznowienia.shift()();
  }
}

function czekajAzWidoczna() {
  if (heroWidoczne && !document.hidden) return Promise.resolve();
  return new Promise((gotowe) => wznowienia.push(gotowe));
}

if (przemiana && "IntersectionObserver" in window) {
  new IntersectionObserver(
    ([wpis]) => {
      heroWidoczne = wpis.isIntersecting;
      ruszDalej();
    },
    { threshold: 0.15 },
  ).observe(przemiana);
}

document.addEventListener("visibilitychange", ruszDalej);

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
    await czekajAzWidoczna();
    const przyklad = KOLEJNOSC[i % KOLEJNOSC.length];
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

// === Licznik zapisanych =================================================

/**
 * Prawdziwa liczba z rejestru — nigdy zmyślona i nigdy zero: bloki licznika
 * są ukryte w HTML-u i pokazują się dopiero, gdy serwer odpowie liczbą
 * większą od zera. Brak sieci czy błąd oznacza po prostu stronę bez licznika.
 */
function odmienOsoby(ile) {
  if (ile === 1) return "osoba";
  const dziesiatki = ile % 10;
  const setki = ile % 100;
  if (dziesiatki >= 2 && dziesiatki <= 4 && (setki < 12 || setki > 14)) return "osoby";
  return "osób";
}

function doliczDo(element, cel) {
  // Karta w tle dostaje finalną liczbę od razu: wstrzymana animacja
  // zostawiłaby na ekranie zero — czyli kłamstwo gorsze od braku ruchu.
  if (PREFERUJE_SPOKOJ || cel < 2 || document.hidden) {
    element.textContent = String(cel);
    return;
  }
  const start = performance.now();
  const trwanie = 900;
  const tyk = setInterval(() => {
    const postep = Math.min(1, (performance.now() - start) / trwanie);
    // Szybki start, spokojne dojście — jak licznik, nie jak stoper.
    element.textContent = String(Math.round(cel * (1 - (1 - postep) ** 3)));
    if (postep >= 1) clearInterval(tyk);
  }, 40);
}

async function pokazLicznik() {
  try {
    const odpowiedz = await fetch("/api/lista/licznik");
    if (!odpowiedz.ok) return;
    const { zapisanych } = await odpowiedz.json();
    if (typeof zapisanych !== "number" || zapisanych < 1) return;

    for (const blok of document.querySelectorAll("[data-licznik-blok]")) {
      const slowo = blok.querySelector("[data-slowo]");
      if (slowo) slowo.textContent = odmienOsoby(zapisanych);
      blok.hidden = false;
      const liczba = blok.querySelector("[data-liczba]");
      if (liczba) doliczDo(liczba, zapisanych);
    }
  } catch {
    // Brak sieci — strona bez licznika jest kompletna.
  }
}

void pokazLicznik();

// === Film ===============================================================

/**
 * Nagranie rusza samo po trzech sekundach patrzenia — ale `preload="none"`
 * w znaczniku zostaje, więc do tej chwili nie schodzi ani bajt. Nakładka znika
 * dopiero na `playing`, nie na starcie: przy wolnym łączu między jednym
 * a drugim mija sekunda, w której zdjęta za wcześnie zostawiłaby czarną
 * dziurę zamiast obrazu.
 */
const film = /** @type {HTMLVideoElement | null} */ (document.querySelector(".film-wideo"));
const filmStart = document.querySelector(".film-start");

if (film && filmStart) {
  const scena = film.closest(".film-scena");

  /** Wspólne wejście w odtwarzanie: z nakładki i z rozdziału. */
  const puscFilm = () => {
    filmStart.setAttribute("aria-busy", "tak");
    // Kontrolki dopiero teraz. W znaczniku stały zawsze i prześwitywały przez
    // nakładkę wariantu z plakatem: obok dużego przycisku „odtwórz" widniał
    // drugi, mały, w pasku odtwarzacza.
    film.controls = true;
    void film.play().catch(() => {
      // Odtwarzanie odrzucone (np. oszczędzanie danych) — nakładka wraca,
      // bo bez niej zostałby sam czarny prostokąt bez wyjaśnienia.
      filmStart.removeAttribute("aria-busy");
    });
  };

  filmStart.addEventListener("click", () => {
    // Fokus na odtwarzacz, żeby spacja i strzałki działały od razu —
    // przycisk, który za chwilę zniknie, nie może go zatrzymać.
    film.focus();
    puscFilm();
  });

  film.addEventListener("playing", () => {
    filmStart.hidden = true;
    // Łuna przestaje pulsować pod lecącym obrazem: zapraszała do kliknięcia,
    // a po nim ma już tylko trzymać kadr, nie ciągnąć wzroku na boki.
    scena?.classList.add("gra");
  });

  // Pauza i koniec przywracają oddech — sekcja znów czeka na gest.
  for (const zdarzenie of ["pause", "ended"]) {
    film.addEventListener(zdarzenie, () => scena?.classList.remove("gra"));
  }

  // === Podpowiedź o dźwięku =============================================

  /**
   * Nagranie rusza wyciszone, bo inaczej przeglądarka w ogóle by go nie
   * puściła bez kliknięcia. Ścieżka dźwiękowa jednak istnieje, więc trzeba
   * o niej powiedzieć — inaczej gość obejrzy film przekonany, że jest niemy.
   *
   * Podpowiedź gaśnie sama po sześciu sekundach: to trzecia część nagrania,
   * dość, żeby ją zauważyć, i za mało, żeby zawadzała do końca. Pokazuje się
   * raz — przypominanie przy każdym wznowieniu byłoby dopominaniem się.
   */
  const dzwiek = /** @type {HTMLElement | null} */ (document.querySelector(".film-dzwiek"));

  if (dzwiek) {
    const CZAS_PODPOWIEDZI = 6000;
    let podpowiedzZuzyta = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let gasniecie;

    const schowajPodpowiedz = () => {
      clearTimeout(gasniecie);
      dzwiek.hidden = true;
    };

    film.addEventListener("playing", () => {
      if (podpowiedzZuzyta || !film.muted) return;
      podpowiedzZuzyta = true;
      dzwiek.hidden = false;
      gasniecie = setTimeout(schowajPodpowiedz, CZAS_PODPOWIEDZI);
    });

    dzwiek.addEventListener("click", () => {
      film.muted = false;
      schowajPodpowiedz();
    });

    // Także wtedy, gdy dźwięk włączono paskiem odtwarzacza — podpowiedź
    // zachęcająca do zrobienia czegoś, co już się stało, jest szumem.
    film.addEventListener("volumechange", () => {
      if (!film.muted) schowajPodpowiedz();
    });
  }

  // === Start po zauważeniu ==============================================

  /**
   * Film rusza sam, gdy kadr jest na ekranie przez trzy sekundy — tyle trwa
   * przewinięcie obok, więc nagranie nie zaczyna się komuś, kto tylko przez
   * sekcję przejeżdża.
   *
   * Trzy sytuacje autostart pomija, bo w każdej z nich zabrałby decyzję:
   * przy prośbie o ograniczony ruch, przy włączonym oszczędzaniu danych
   * i na wolnym łączu — nagranie waży 3,7 MB i na komórce w drodze na siłownię
   * to nie jest transfer, o który wypada prosić bez pytania.
   */
  const OPOZNIENIE_STARTU = 3000;
  const WIDOCZNE_DOSC = 0.6;

  // `connection` nie jest w standardzie i nie zna go Safari — stąd rzutowanie
  // zamiast prostego odczytu.
  const polaczenie = /** @type {{ saveData?: boolean; effectiveType?: string } | undefined} */ (
    /** @type {any} */ (navigator).connection
  );
  const oszczedzaDane = Boolean(
    polaczenie?.saveData || /(^|-)2g$/.test(polaczenie?.effectiveType ?? ""),
  );

  if (!PREFERUJE_SPOKOJ && !oszczedzaDane && "IntersectionObserver" in window) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let odliczanie;
    let autostartZuzyty = false;

    const obserwatorFilmu = new IntersectionObserver(
      (wpisy) => {
        for (const wpis of wpisy) {
          if (wpis.isIntersecting) {
            // Odliczanie biegnie tylko wtedy, gdy kadr NIEPRZERWANIE jest na
            // ekranie: wyjście z widoku je kasuje, więc trzy sekundy znaczą
            // trzy sekundy patrzenia, a nie sumę mignięć.
            if (autostartZuzyty || !film.paused) continue;
            odliczanie = setTimeout(() => {
              autostartZuzyty = true;
              puscFilm();
            }, OPOZNIENIE_STARTU);
          } else {
            clearTimeout(odliczanie);
            // Poza ekranem nagranie bez dźwięku nie ma odbiorcy, a dalej
            // schodziłoby z serwera. Wznowienia nie ma: kto zjechał w dół,
            // wraca do zatrzymanego kadru i sam decyduje.
            if (!film.paused) film.pause();
          }
        }
      },
      { threshold: WIDOCZNE_DOSC },
    );

    obserwatorFilmu.observe(film);
  }

  // === Rozdziały ========================================================
  const rozdzialy = [...document.querySelectorAll(".film-rozdzialy button")];

  if (rozdzialy.length > 0) {
    for (const przycisk of rozdzialy) {
      przycisk.addEventListener("click", () => {
        film.currentTime = Number(przycisk.dataset["sekunda"]);
        puscFilm();
      });
    }

    // Podświetlenie idzie za obrazem, nie za kliknięciem: przewinięcie suwakiem
    // ma zaznaczyć właściwy rozdział tak samo jak stuknięcie w listę.
    const granice = rozdzialy.map((p) => Number(p.dataset["sekunda"]));
    let ostatni = -1;

    film.addEventListener("timeupdate", () => {
      let biezacy = -1;
      for (let i = 0; i < granice.length; i += 1) {
        if (film.currentTime >= (granice[i] ?? 0)) biezacy = i;
      }
      if (biezacy === ostatni) return;
      ostatni = biezacy;
      rozdzialy.forEach((p, i) => {
        p.parentElement?.classList.toggle("teraz", i === biezacy);
      });
    });

    film.addEventListener("ended", () => {
      ostatni = -1;
      for (const p of rozdzialy) p.parentElement?.classList.remove("teraz");
    });
  }
}

// === Odsłony sekcji przy przewijaniu ====================================

/**
 * Sekcje spod dolnej krawędzi wjeżdżają przy pierwszym pokazaniu.
 * Ukrywa je wyłącznie ten skrypt — bez JS strona jest widoczna w całości —
 * i wyłącznie te, których jeszcze nie widać, więc nic nie mryga przy
 * wejściu w środek strony (np. z kotwicy #lista).
 */
if (!PREFERUJE_SPOKOJ && "IntersectionObserver" in window) {
  const obserwator = new IntersectionObserver(
    (wpisy) => {
      for (const wpis of wpisy) {
        if (!wpis.isIntersecting) continue;
        wpis.target.classList.add("odsloniete");
        obserwator.unobserve(wpis.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );

  for (const sekcja of document.querySelectorAll("main section:not(.hero)")) {
    if (sekcja.getBoundingClientRect().top < innerHeight) continue;
    sekcja.classList.add("do-odslony");
    obserwator.observe(sekcja);
  }
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
    przycisk.textContent = "Zapisujemy…";

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
