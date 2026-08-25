/**
 * Aplikacja webowa — trzy ekrany, bez frameworka.
 *
 * Priorytet ekranu treningu: wszystko ma być osiągalne kciukiem jedną ręką,
 * a dopisanie serii ma kosztować jedno stuknięcie plus ewentualną korektę
 * ciężaru. Dlatego formularz serii jest wstępnie wypełniony poprzednim wynikiem.
 */

import { dodajDoKolejki, wpisyKolejki, wyslijKolejke } from "./kolejka.js";
import { nalozNaDzien, nalozNaTrening } from "./nakladka.js";
import { ekranRaporty, panelTygodnia } from "./raporty.js";

const widok = document.getElementById("widok");
const tytulEkranu = document.getElementById("tytul-ekranu");
const dataEkranu = document.getElementById("data-ekranu");
const stanSieci = document.getElementById("stan-sieci");
const ekranLogowania = document.getElementById("logowanie");
const aplikacja = document.getElementById("aplikacja");

let ekran = "dzis";
let stan = {};

/** Id serii otwartej do poprawki. Przeżywa odswiez(), bo widok jest bezstanowy. */
let edytowanaSeria = null;

/** Id posiłku otwartego do poprawki. */
let edytowanyPosilek = null;

/** Oglądany dzień; null znaczy „dzisiaj" i tak zostaje po zmianie doby. */
let wybranaData = null;

/** Dzisiejsza data według serwera — granica, poza którą nie ma po co iść. */
let dzisiajData = null;

/** Ostatnio usunięty posiłek — materiał na „Cofnij" w komunikacie. */
let ostatnioUsuniety = null;

/** Rozwinięty raport w archiwum; null znaczy „najnowszy". */
let wybranyRaport = null;

/**
 * Propozycje wyniku z ostatniego odczytu, po nazwie ćwiczenia.
 *
 * Przycisk odhaczania niesie samą nazwę — liczby wracają stąd, zamiast jechać
 * przez atrybuty HTML. Liczy je serwer, my je tylko odsyłamy z powrotem.
 */
const propozycje = new Map();

/** Po odhaczeniu przewijamy do pierwszego niedokończonego ćwiczenia. */
let przewinDoNastepnego = false;

/** Nazwa ćwiczenia otwartego na pełnym ekranie; null znaczy „lista". */
let otwarteCwiczenie = null;

// === Warstwa komunikacji ================================================

/** Błąd niosący kod odpowiedzi — pozwala odróżnić złe hasło od awarii sieci. */
class BladApi extends Error {
  constructor(komunikat, status) {
    super(komunikat);
    this.status = status;
  }
}

async function api(sciezka, opcje = {}) {
  let odpowiedz;
  try {
    odpowiedz = await fetch(`/api${sciezka}`, {
      headers: { "content-type": "application/json" },
      ...opcje,
      body: opcje.dane === undefined ? opcje.body : JSON.stringify(opcje.dane),
    });
  } catch {
    // Zapis bez sieci nie przepada — idzie do kolejki i pojedzie później.
    // Odczyt nie ma czego kolejkować, więc leci błędem jak dotąd.
    if (opcje.method === "POST" && opcje.kolejkuj !== false) {
      await dodajDoKolejki({
        sciezka,
        dane: opcje.dane ?? {},
        // Godzina powstania wpisu, a nie godzina wysyłki — inaczej seria
        // z 18:05 wylądowałaby w historii pod 19:30.
        czas_lokalny: new Date().toISOString(),
      });
      await pokazStanSieci();
      return { oczekuje: true };
    }

    // Brak sieci albo serwer nie odpowiada — to zupełnie inna sytuacja
    // niż odrzucone hasło i użytkownik musi ją odróżnić.
    throw new BladApi("Brak połączenia z serwerem", 0);
  }

  if (odpowiedz.status === 401) {
    // Przy samym logowaniu nie przerzucamy ekranu — użytkownik już na nim jest,
    // a przeładowanie skasowałoby wpisane hasło.
    if (!opcje.bezPrzekierowania) pokazLogowanie();
    throw new BladApi("Wymagane logowanie", 401);
  }

  const tresc = await odpowiedz.json().catch(() => ({}));
  if (!odpowiedz.ok) throw new BladApi(tresc.blad ?? "Coś poszło nie tak", odpowiedz.status);
  return tresc;
}

let uchwytKomunikatu;

/**
 * Komunikat na dole ekranu. `cofnij` dokłada przycisk odwracający akcję —
 * przy usuwaniu jednym stuknięciem to jedyna droga powrotu.
 */
function komunikat(tekst, czyBlad = false, cofnij) {
  document.querySelector(".komunikat")?.remove();
  clearTimeout(uchwytKomunikatu);

  const element = document.createElement("div");
  element.className = czyBlad ? "komunikat blad" : "komunikat";
  element.append(tekst);

  if (cofnij) {
    const przycisk = document.createElement("button");
    przycisk.type = "button";
    przycisk.className = "cofnij";
    przycisk.textContent = "Cofnij";
    przycisk.addEventListener("click", () => {
      element.remove();
      clearTimeout(uchwytKomunikatu);
      cofnij();
    });
    element.append(przycisk);
  }

  document.body.append(element);

  // Na cofnięcie dajemy więcej czasu — zwykłe potwierdzenie nie wymaga reakcji.
  const ileTrzymac = czyBlad ? 5000 : cofnij ? 7000 : 2500;
  uchwytKomunikatu = setTimeout(() => element.remove(), ileTrzymac);
}

/**
 * Opakowanie akcji: pokazuje błąd zamiast cichej porażki i odświeża widok.
 *
 * `formularz` blokuje na czas zapisu jego przycisk. Przy zerwanym połączeniu
 * żądanie odrzuca się dopiero po kilku sekundach i bez blokady wygląda to tak,
 * jakby przycisk nie zadziałał — a drugie stuknięcie zapisuje serię dwa razy.
 */
async function akcja(wykonaj, potwierdzenie, formularz) {
  const przycisk = formularz?.querySelector('button[type="submit"]');
  const etykieta = przycisk?.textContent;

  if (formularz) {
    // Znacznik na formularzu, a nie sama blokada przycisku: formularz wysyła
    // się też klawiszem „Gotowe" z klawiatury telefonu, a ta droga omija
    // wyłączony przycisk.
    formularz.dataset.zapisuje = "1";
  }

  if (przycisk) {
    przycisk.disabled = true;
    przycisk.textContent = "Zapisuję…";
  }

  try {
    await wykonaj();
    if (potwierdzenie) komunikat(potwierdzenie);
    await odswiez();
    void wyslijCzekajace();
  } catch (blad) {
    komunikat(blad.message, true);
  } finally {
    // Przy powodzeniu widok jest już przerysowany i tego formularza nie ma;
    // przywracamy go tylko wtedy, gdy nadal wisi na ekranie po błędzie.
    if (formularz?.isConnected) delete formularz.dataset.zapisuje;
    if (przycisk?.isConnected) {
      przycisk.disabled = false;
      przycisk.textContent = etykieta;
    }
  }
}

/**
 * To samo dla przycisku, co `akcja` robi dla formularza.
 *
 * Blokada podwójnego zapisu siedziała dotąd wyłącznie na formularzu. Przycisk
 * odhaczania to trzecia droga do zapisu i przy słabym zasięgu dwa stuknięcia
 * dopisałyby dwie serie.
 */
async function akcjaPrzycisku(przycisk, wykonaj, potwierdzenie) {
  if (przycisk.dataset.zapisuje) return;

  przycisk.dataset.zapisuje = "1";
  przycisk.disabled = true;

  try {
    await akcja(wykonaj, potwierdzenie);
  } finally {
    if (przycisk.isConnected) {
      delete przycisk.dataset.zapisuje;
      przycisk.disabled = false;
    }
  }
}

// === Kolejka offline ====================================================

async function pokazStanSieci() {
  const wpisy = await wpisyKolejki();
  const bezSieci = !navigator.onLine;

  if (!bezSieci && wpisy.length === 0) {
    stanSieci.hidden = true;
    return wpisy;
  }

  stanSieci.hidden = false;
  stanSieci.className = wpisy.length ? "czeka" : "bez-sieci";
  stanSieci.textContent = wpisy.length ? `⏳ ${wpisy.length} do wysłania` : "bez sieci";
  return wpisy;
}

let wysylkaTrwa = false;

/** Próba opróżnienia kolejki. Cicha, gdy nie ma czego wysyłać. */
async function wyslijCzekajace() {
  if (wysylkaTrwa || !navigator.onLine) return;
  wysylkaTrwa = true;

  try {
    const wynik = await wyslijKolejke(async (wpis) => {
      try {
        const odpowiedz = await fetch(`/api${wpis.sciezka}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // `czas` przed rozwinięciem danych: gdy wpis niesie własną godzinę
          // (posiłek zapisany wstecz), ma ona pierwszeństwo.
          body: JSON.stringify({ czas: wpis.czas_lokalny, ...wpis.dane }),
        });
        return odpowiedz.status;
      } catch {
        return 0;
      }
    });

    if (wynik.wyslane > 0) komunikat(`Wysłano zaległe wpisy: ${wynik.wyslane}`);
    if (wynik.odrzucone > 0) {
      komunikat(`Serwer odrzucił zaległe wpisy: ${wynik.odrzucone}`, true);
    }
    if (wynik.zatrzymana) pokazLogowanie();
    if (wynik.wyslane > 0 || wynik.odrzucone > 0) await odswiez();
  } finally {
    wysylkaTrwa = false;
    await pokazStanSieci();
  }
}

window.addEventListener("online", () => {
  void pokazStanSieci();
  void wyslijCzekajace();
});

window.addEventListener("offline", () => void pokazStanSieci());

// === Timer przerwy ======================================================

/**
 * Odliczanie między seriami.
 *
 * Czas liczymy od znacznika docelowego, a nie odejmując sekundy w interwale:
 * przeglądarka na wygaszonym ekranie dławi setInterval i licznik oparty na
 * dekrementacji zacząłby się spóźniać o kilkadziesiąt sekund. Przy takim
 * dławieniu wibracja potrafi przyjść z opóźnieniem, ale pokazany czas jest
 * zawsze prawdziwy.
 */

const KROKI_PRZERWY = [90, 120, 180];
const DOMYSLNA_PRZERWA = 120;

const elementTimera = document.getElementById("timer");
const czasTimera = document.getElementById("timer-czas");

// localStorage potrafi rzucić w trybie prywatnym — brak zapamiętanej przerwy
// nie jest powodem, żeby timer przestał działać.
const zapamietaj = (klucz, wartosc) => {
  try {
    localStorage.setItem(klucz, wartosc);
  } catch {
    /* pusto */
  }
};

const zapamietane = (klucz) => {
  try {
    return localStorage.getItem(klucz);
  } catch {
    return null;
  }
};

let koniecPrzerwy = null;
let tykanie;

function wybranaPrzerwa() {
  const zapisana = Number(zapamietane("przerwa_s"));
  return KROKI_PRZERWY.includes(zapisana) ? zapisana : DOMYSLNA_PRZERWA;
}

function odswiezTimer() {
  const pozostalo = Math.round((koniecPrzerwy - Date.now()) / 1000);

  if (pozostalo <= 0) {
    czasTimera.textContent = "gotowe";
    elementTimera.classList.add("minela");
    clearInterval(tykanie);
    koniecPrzerwy = null;
    navigator.vibrate?.([180, 90, 180]);
    return;
  }

  czasTimera.textContent = `${Math.floor(pozostalo / 60)}:${String(pozostalo % 60).padStart(2, "0")}`;
}

function startujPrzerwe(sekundy = wybranaPrzerwa()) {
  zapamietaj("przerwa_s", String(sekundy));
  koniecPrzerwy = Date.now() + sekundy * 1000;

  elementTimera.hidden = false;
  elementTimera.classList.remove("minela");
  elementTimera
    .querySelectorAll("[data-przerwa]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.przerwa) === sekundy)),
    );

  clearInterval(tykanie);
  tykanie = setInterval(odswiezTimer, 250);
  odswiezTimer();
}

function zatrzymajPrzerwe() {
  clearInterval(tykanie);
  koniecPrzerwy = null;
  elementTimera.hidden = true;
  elementTimera.classList.remove("minela");
}

elementTimera?.addEventListener("click", (zdarzenie) => {
  const wybor = zdarzenie.target.closest("[data-przerwa]");
  if (wybor) return startujPrzerwe(Number(wybor.dataset.przerwa));
  if (zdarzenie.target.closest("#timer-zamknij")) zatrzymajPrzerwe();
});

// === Pomocnicze =========================================================

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const zaokr = (liczba) => Math.round(Number(liczba) || 0);

/**
 * Przesunięcie daty YYYY-MM-DD o podaną liczbę dni.
 * Liczone w południe UTC, żeby zmiana czasu nie zjadła ani nie dodała doby.
 */
const przesunDate = (data, oDni) => {
  const chwila = new Date(`${data}T12:00:00Z`);
  chwila.setUTCDate(chwila.getUTCDate() + oDni);
  return chwila.toISOString().slice(0, 10);
};

const liczbaZPola = (formularz, nazwa) => {
  const wartosc = formularz.elements[nazwa]?.value?.replace(",", ".").trim();
  return wartosc ? Number(wartosc) : undefined;
};

const makroZFormularza = (formularz) => ({
  opis: formularz.elements.opis.value,
  kcal: liczbaZPola(formularz, "kcal") ?? 0,
  bialko_g: liczbaZPola(formularz, "bialko_g"),
  wegle_g: liczbaZPola(formularz, "wegle_g"),
  tluszcz_g: liczbaZPola(formularz, "tluszcz_g"),
});

/**
 * Moment spożycia dla zapisywanego posiłku.
 *
 * Pusty przy oglądaniu dzisiaj znaczy „teraz" i zostaje serwerowi. Przy
 * cofnięciu się na inny dzień musimy podać datę wprost, inaczej wpis wylądowałby
 * pod dzisiejszą — format „YYYY-MM-DD HH:MM" rozumie parsujCzas na serwerze.
 */
function czasPosilku(formularz) {
  const godzina = formularz.elements.godzina?.value?.trim();
  const dzien = stan.dzien?.data;

  if (!godzina) return wybranaData ? `${dzien} 12:00` : undefined;

  const dopasowanie = /^(\d{1,2})[:.]?(\d{2})$/.exec(godzina);
  if (!dopasowanie) return wybranaData ? `${dzien} 12:00` : undefined;

  return `${dzien} ${dopasowanie[1].padStart(2, "0")}:${dopasowanie[2]}`;
}

/** Wynik serii z formularza. Pola nieobecne dla danego typu wychodzą jako
    undefined i nie trafiają do żądania. */
const wynikZFormularza = (formularz) => ({
  powtorzenia: liczbaZPola(formularz, "powtorzenia"),
  ciezar_kg: liczbaZPola(formularz, "ciezar_kg"),
  czas_s: liczbaZPola(formularz, "czas_s"),
  dystans_m: liczbaZPola(formularz, "dystans_m"),
  rpe: liczbaZPola(formularz, "rpe"),
});

function pasekMakro(etykieta, spozyte, cel, jednostka) {
  const procent = cel ? Math.min(100, (spozyte / cel) * 100) : 0;
  const przekroczony = cel && spozyte > cel;

  return `
    <div class="makro">
      <div class="etykieta">
        <span>${etykieta}</span>
        <span><b>${zaokr(spozyte)}</b> <span class="cel">/ ${cel ? zaokr(cel) : "—"} ${jednostka}</span></span>
      </div>
      <div class="pasek ${przekroczony ? "przekroczony" : ""}"><span style="width:${procent}%"></span></div>
    </div>`;
}

function seriaWTekscie(seria) {
  const czesci = [];
  if (seria.powtorzenia != null) {
    czesci.push(seria.ciezar_kg ? `${seria.powtorzenia}×${seria.ciezar_kg} kg` : `${seria.powtorzenia} powt.`);
  }
  if (seria.czas_s != null) czesci.push(`${seria.czas_s} s`);
  if (seria.dystans_m != null) czesci.push(`${(seria.dystans_m / 1000).toFixed(2)} km`);
  return czesci.join(", ") || "—";
}

/** Puste zamiast null/undefined — inaczej w polu formularza wylądowałoby „null". */
const wartosciSerii = (seria = {}) => ({
  powtorzenia: seria.powtorzenia ?? "",
  ciezar_kg: seria.ciezar_kg ?? "",
  czas_s: seria.czas_s ?? "",
  dystans_m: seria.dystans_m ?? "",
  rpe: seria.rpe ?? "",
});

/**
 * Pola wyniku serii — te same przy dopisywaniu i przy poprawianiu, żeby jedno
 * i drugie zawsze pytało o to samo.
 */
function polaSerii(typ, wartosci) {
  const ciezar = `
    <div class="szeroko">
      <label>Ciężar (kg)</label>
      <div class="stopien">
        <button type="button" data-krok="-2.5" aria-label="Mniej o 2,5 kg">−</button>
        <input name="ciezar_kg" inputmode="decimal" value="${wartosci.ciezar_kg}" />
        <button type="button" data-krok="2.5" aria-label="Więcej o 2,5 kg">+</button>
      </div>
    </div>`;

  const rpe = (szeroko = false) =>
    `<div class="${szeroko ? "szeroko" : ""}">
       <label>RPE (1–10)</label>
       <input name="rpe" inputmode="decimal" value="${wartosci.rpe}" />
     </div>`;

  const czas = `<div><label>Czas (s)</label><input name="czas_s" inputmode="numeric" value="${wartosci.czas_s}" /></div>`;

  // Kolejność dobrana pod siatkę dwukolumnową, żeby nie zostawały puste połówki.
  if (typ === "silowe") {
    return `<div><label>Powtórzenia</label><input name="powtorzenia" inputmode="numeric" value="${wartosci.powtorzenia}" /></div>
      ${rpe()}
      ${ciezar}`;
  }

  if (typ === "cardio") {
    return `${czas}
      <div><label>Dystans (m)</label><input name="dystans_m" inputmode="numeric" value="${wartosci.dystans_m}" /></div>
      ${rpe(true)}`;
  }

  return `${czas}${rpe()}`;
}

// === Ekran: Dziś ========================================================

/** Pola posiłku — wspólne dla dopisywania i poprawiania. */
function polaPosilku(p = {}, idPrzedrostek = "") {
  const id = (nazwa) => `${idPrzedrostek}${nazwa}`;

  return `
    <div class="szeroko">
      <label for="${id("opis")}">Co zjadłeś</label>
      <input id="${id("opis")}" name="opis" required autocomplete="off" value="${esc(p.opis ?? "")}" />
    </div>
    <div>
      <label for="${id("kcal")}">Kalorie</label>
      <input id="${id("kcal")}" name="kcal" inputmode="decimal" required value="${p.kcal ?? ""}" />
    </div>
    <div>
      <label for="${id("godzina")}">Godzina</label>
      <input id="${id("godzina")}" name="godzina" inputmode="numeric" placeholder="teraz" value="${esc(p.godzina ?? "")}" />
    </div>
    <div>
      <label for="${id("bialko")}">Białko (g)</label>
      <input id="${id("bialko")}" name="bialko_g" inputmode="decimal" value="${p.bialko_g ?? ""}" />
    </div>
    <div>
      <label for="${id("wegle")}">Węgle (g)</label>
      <input id="${id("wegle")}" name="wegle_g" inputmode="decimal" value="${p.wegle_g ?? ""}" />
    </div>
    <div>
      <label for="${id("tluszcz")}">Tłuszcz (g)</label>
      <input id="${id("tluszcz")}" name="tluszcz_g" inputmode="decimal" value="${p.tluszcz_g ?? ""}" />
    </div>`;
}

function wpisPosilku(p) {
  if (p.id === edytowanyPosilek) {
    return `
      <form id="edycja-posilku-${p.id}" data-posilek="${p.id}" class="wpis-edycja">
        <div class="pola">${polaPosilku(p, `e${p.id}-`)}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Popraw</button>
          <button class="przycisk" type="button" data-anuluj-posilku>Anuluj</button>
        </div>
      </form>`;
  }

  return `
    <div class="wpis ${p.oczekuje ? "oczekuje" : ""}">
      <div class="tresc">
        <div class="naglowek">
          <span class="godzina">${esc(p.godzina)}</span>
          <span class="opis">${esc(p.opis)}</span>
          ${p.pewnosc === "szacowane" ? '<span class="znacznik">szacunek</span>' : ""}
          ${p.oczekuje ? '<span class="znacznik">⏳ czeka</span>' : ""}
        </div>
        <div class="szczegoly">
          ${zaokr(p.kcal)} kcal · B ${zaokr(p.bialko_g)} · W ${zaokr(p.wegle_g)} · T ${zaokr(p.tluszcz_g)}
        </div>
      </div>
      ${
        // Wpis bez id z bazy nie ma czego poprawiać ani usuwać — obie akcje
        // wrócą, gdy kolejka go wyśle.
        p.oczekuje
          ? ""
          : `<button class="przycisk cichy" data-edytuj-posilek="${p.id}" aria-label="Popraw">✎</button>
             <button class="przycisk cichy" data-usun-posilek="${p.id}" aria-label="Usuń">✕</button>`
      }
    </div>`;
}

function ekranDzis(dzien, czeste = []) {
  const cele = dzien.cele;

  const posilki = dzien.posilki.length
    ? dzien.posilki.map(wpisPosilku).join("")
    : '<div class="pusto">Nic jeszcze nie zapisano.</div>';

  // Podpowiedzi wypełniają formularz, a nie zapisują od razu: ta sama kanapka
  // bywa raz większa, raz mniejsza, a cicha zgoda fałszowałaby bilans.
  const podpowiedzi = czeste.length
    ? `<div class="podpowiedzi">${czeste
        .map(
          (p) =>
            `<button type="button" class="podpowiedz" data-czesty="${esc(JSON.stringify(p))}">
               ${esc(p.opis)} <span class="ile">${zaokr(p.kcal)}</span>
             </button>`,
        )
        .join("")}</div>`
    : "";

  return `
    <section class="karta">
      <div class="paskodat">
        <button class="przycisk cichy" data-dzien="-1" aria-label="Poprzedni dzień">‹</button>
        <span class="etykieta-daty">${esc(dzien.data)}${wybranaData ? "" : " · dziś"}</span>
        <button class="przycisk cichy" data-dzien="1" aria-label="Następny dzień" ${wybranaData ? "" : "disabled"}>›</button>
      </div>
      ${pasekMakro("Kalorie", dzien.spozyte.kcal, cele?.kcal, "kcal")}
      ${pasekMakro("Białko", dzien.spozyte.bialko_g, cele?.bialko_g, "g")}
      ${pasekMakro("Węglowodany", dzien.spozyte.wegle_g, cele?.wegle_g, "g")}
      ${pasekMakro("Tłuszcze", dzien.spozyte.tluszcz_g, cele?.tluszcz_g, "g")}
      ${cele ? "" : '<div class="pusto">Cele nie są ustawione — poproś o to Claude\'a.</div>'}
    </section>

    <section class="karta">
      <h2>Posiłki</h2>
      ${posilki}
      <form id="formularz-posilku" hidden>
        ${podpowiedzi}
        <div class="pola">${polaPosilku()}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Zapisz</button>
          <button class="przycisk" type="button" data-anuluj="formularz-posilku">Anuluj</button>
        </div>
      </form>
      <div class="przyciski" id="dodaj-posilek-wrapper">
        <button class="przycisk pelny" data-pokaz="formularz-posilku">+ Dodaj posiłek</button>
      </div>
    </section>`;
}

// === Ekran: Trening =====================================================

function kartaBezSesji(plan, dzisiajKod) {
  const proponowany = plan.find((d) => d.kod === dzisiajKod);
  const pozostale = plan.filter((d) => d.kod !== dzisiajKod);

  const bezPlanu = `
    <div class="przyciski">
      <button class="przycisk pelny" data-start-bez-planu>Trening bez planu</button>
    </div>`;

  if (!plan.length) {
    return `<section class="karta">
      <h2>Trening</h2>
      <div class="pusto">Plan jest pusty. Podyktuj go Claude'owi — zapisze go sam.</div>
      ${bezPlanu}
    </section>`;
  }

  return `
    <section class="karta">
      <h2>Zacznij trening</h2>
      ${
        proponowany
          ? `<button class="przycisk glowny pelny duzy" data-start="${esc(proponowany.kod)}">
               ${esc(proponowany.kod)} — ${esc(proponowany.nazwa)}
             </button>
             <div class="pusto">Dzisiejszy dzień wg harmonogramu.</div>`
          : '<div class="pusto">Harmonogram nie przewiduje dziś treningu. Wybierz dzień:</div>'
      }
      ${pozostale
        .map(
          (d) =>
            `<div class="przyciski"><button class="przycisk pelny" data-start="${esc(d.kod)}">
               ${esc(d.kod)} — ${esc(d.nazwa)}
             </button></div>`,
        )
        .join("")}
      ${bezPlanu}
    </section>`;
}

/** Poprawka zapisanej serii. Usuwanie siedzi tutaj, a nie przy samej serii —
    jeden przycisk ✕ obok wyniku byłby na telefonie za łatwy do trafienia. */
function formularzPoprawkiSerii(typ, seria) {
  return `
    <form id="edycja-serii-${seria.id}" data-seria="${seria.id}">
      <div class="pola">${polaSerii(typ, wartosciSerii(seria))}</div>
      <div class="przyciski">
        <button class="przycisk glowny" type="submit">Popraw</button>
        <button class="przycisk" type="button" data-anuluj-edycji>Anuluj</button>
      </div>
      <div class="przyciski">
        <button class="przycisk cichy pelny" type="button" data-usun-serie="${seria.id}">
          Usuń serię ${seria.nr_serii}
        </button>
      </div>
    </form>`;
}

/** Kropki postępu: ● zrobiona, ○ została. Bez celu serii nie ma czego rysować. */
function kropkiSerii(cwiczenie) {
  if (!cwiczenie.serie_cel) return "";

  const zrobione = Math.min(cwiczenie.serie_zrobione, 12);
  const zostalo = Math.min(Math.max(0, cwiczenie.serie_cel - cwiczenie.serie_zrobione), 12);

  return `<span class="kropki" aria-hidden="true">${"●".repeat(zrobione)}${"○".repeat(zostalo)}</span>`;
}

/**
 * Skąd wzięły się liczby na przycisku. Jedno stuknięcie zapisuje serię bez
 * potwierdzenia, więc użytkownik ma wiedzieć, czym ta seria będzie, zanim
 * stuknie — sama liczba tego nie mówi.
 */
const OPIS_ZRODLA = {
  plan: "wg planu",
  ostatnia_seria: "jak przed chwilą",
  poprzedni_trening: "jak ostatnio",
};

/** Cel z planu w jednej linii: „4 × 8". */
function celWTekscie(cwiczenie) {
  if (!cwiczenie.serie_cel && !cwiczenie.powt_cel) return "";
  return [cwiczenie.serie_cel ? `${cwiczenie.serie_cel} ×` : null, esc(cwiczenie.powt_cel ?? "")]
    .filter(Boolean)
    .join(" ");
}

function serieWKarcie(cwiczenie) {
  if (!cwiczenie.serie.length) return "";
  const rekordy = cwiczenie.rekordy ?? [];

  return `<div class="serie">${cwiczenie.serie
    .map((s) =>
      // Seria czekająca w kolejce nie ma jeszcze id w bazie, więc nie ma czego
      // poprawiać — zostaje etykietą do czasu wysłania.
      s.oczekuje
        ? `<span class="seria oczekuje">⏳ ${s.cale_cwiczenie ? "całe ćwiczenie" : esc(seriaWTekscie(s))}</span>`
        : `<button type="button" data-edytuj-serie="${s.id}"
             class="seria ${cwiczenie.slabsze_niz_poprzednio.includes(s.nr_serii) ? "slabsza" : ""} ${rekordy.includes(s.nr_serii) ? "rekord" : ""} ${s.id === edytowanaSeria ? "edytowana" : ""}">
             ${rekordy.includes(s.nr_serii) ? "★ " : ""}${esc(seriaWTekscie(s))}
           </button>`,
    )
    .join("")}</div>`;
}

/**
 * Formularz pełnego wyniku — droga na wypadek odstępstwa od propozycji.
 *
 * Wypełniony propozycją, ale bez RPE: trudność jest oceną tej konkretnej serii,
 * a podpowiedziana po cichu zapisałaby się jako prawdziwa.
 */
function formularzSerii(cwiczenie, idFormularza) {
  const zapas = cwiczenie.serie.at(-1) ?? cwiczenie.poprzednio.at(-1);
  const wartosci = wartosciSerii({ ...(cwiczenie.propozycja ?? zapas ?? {}), rpe: null });

  return `
    <form id="${idFormularza}" data-cwiczenie="${esc(cwiczenie.nazwa)}" hidden>
      <div class="pola">${polaSerii(cwiczenie.typ, wartosci)}</div>
      <div class="przyciski">
        <button class="przycisk glowny" type="submit">Zapisz serię</button>
        <button class="przycisk" type="button" data-anuluj="${idFormularza}">Anuluj</button>
      </div>
    </form>`;
}

function kartaCwiczenia(cwiczenie) {
  const idFormularza = `seria-${cwiczenie.cwiczenie_id}`;
  const wPoprawce = cwiczenie.serie.find((s) => s.id === edytowanaSeria);
  const propozycja = cwiczenie.propozycja ?? { zrodlo: "brak" };
  const mozna = propozycja.zrodlo !== "brak";
  const zostalo = cwiczenie.serie_cel ? cwiczenie.serie_cel - cwiczenie.serie_zrobione : null;
  const ostatnia = cwiczenie.serie.at(-1);

  // Zrobione ćwiczenie zwija się do jednej linii — na ekranie ma zostać to,
  // co jeszcze przed tobą, a nie to, co już za tobą.
  if (cwiczenie.ukonczone && !wPoprawce) {
    return `
      <div class="cwiczenie zrobione zwiniete">
        <div class="tytul">
          <button type="button" class="nazwa" data-cwiczenie-widok="${esc(cwiczenie.nazwa)}">
            ✓ ${esc(cwiczenie.nazwa)}
          </button>
          <span class="licznik">
            ${cwiczenie.serie_zrobione}${cwiczenie.serie_cel ? `/${cwiczenie.serie_cel}` : ""}${ostatnia ? ` · ${esc(seriaWTekscie(ostatnia))}` : ""}
          </span>
        </div>
        ${formularzSerii(cwiczenie, idFormularza)}
        <div class="przyciski">
          <button class="przycisk cichy pelny" data-pokaz="${idFormularza}">+ Jeszcze seria</button>
        </div>
      </div>`;
  }

  return `
    <div class="cwiczenie">
      <div class="tytul">
        <button type="button" class="nazwa" data-cwiczenie-widok="${esc(cwiczenie.nazwa)}">
          ${esc(cwiczenie.nazwa)}
        </button>
        ${kropkiSerii(cwiczenie)}
      </div>
      ${celWTekscie(cwiczenie) ? `<div class="cel-cwiczenia">${celWTekscie(cwiczenie)}</div>` : ""}

      ${serieWKarcie(cwiczenie)}
      ${wPoprawce ? formularzPoprawkiSerii(cwiczenie.typ, wPoprawce) : ""}

      ${
        cwiczenie.poprzednio.length
          ? `<div class="poprzednio">Poprzednio: ${esc(cwiczenie.poprzednio.map(seriaWTekscie).join(" · "))}</div>`
          : ""
      }

      ${formularzSerii(cwiczenie, idFormularza)}

      <div class="przyciski">
        ${
          mozna
            ? `<button class="przycisk glowny pelny duzy" data-odhacz-serie="${esc(cwiczenie.nazwa)}">
                 Odhacz serię ${cwiczenie.serie_zrobione + 1}${cwiczenie.serie_cel ? `/${cwiczenie.serie_cel}` : ""} — ${esc(seriaWTekscie(propozycja))}
                 <small>${OPIS_ZRODLA[propozycja.zrodlo]}</small>
               </button>`
            : `<button class="przycisk pelny" data-pokaz="${idFormularza}">+ Seria</button>`
        }
      </div>
      ${
        mozna
          ? `<div class="drobne">
               <button type="button" class="lacze" data-pokaz="${idFormularza}">inny wynik</button>
               ${
                 zostalo === null || zostalo >= 2
                   ? `<button type="button" class="lacze" data-odhacz-cwiczenie="${esc(cwiczenie.nazwa)}"
                        ${zostalo === null ? 'data-bez-celu="1"' : ""}>odhacz całe ćwiczenie</button>`
                   : ""
               }
             </div>`
          : ""
      }
    </div>`;
}

/**
 * Miara postępu ćwiczenia: to, co w danym typie w ogóle rośnie. Przy masie
 * własnej ciężaru nie ma, więc rosną powtórzenia.
 */
function miaraSesji(typ, serie) {
  const maks = (pole) => Math.max(0, ...serie.map((s) => s[pole] ?? 0));

  if (typ === "cardio") {
    const dystans = maks("dystans_m");
    return dystans > 0
      ? { wartosc: dystans, opis: `${(dystans / 1000).toFixed(2)} km` }
      : { wartosc: maks("czas_s"), opis: `${maks("czas_s")} s` };
  }

  if (typ === "na_czas") return { wartosc: maks("czas_s"), opis: `${maks("czas_s")} s` };

  const ciezar = maks("ciezar_kg");
  return ciezar > 0
    ? { wartosc: ciezar, opis: `${ciezar} kg` }
    : { wartosc: maks("powtorzenia"), opis: `${maks("powtorzenia")} powt.` };
}

/** Najlepszy wynik w kolejnych sesjach, jako słupki. Ten sam wzorzec co wykres kalorii. */
function wykresCwiczenia(historia) {
  const punkty = [...historia.sesje]
    .reverse()
    .map((s) => ({ data: s.data, ...miaraSesji(historia.typ, s.serie) }));

  if (punkty.length < 2) return "";

  const maks = Math.max(...punkty.map((p) => p.wartosc), 1);
  const szerokosc = SZER / punkty.length;

  const slupki = punkty
    .map((p, i) => {
      const wysokosc = (p.wartosc / maks) * WYS;
      return `<rect x="${(i * szerokosc + szerokosc * 0.15).toFixed(1)}" y="${(WYS - wysokosc).toFixed(1)}"
                width="${(szerokosc * 0.7).toFixed(1)}" height="${wysokosc.toFixed(1)}"
                class="slupek"><title>${esc(p.data)}: ${esc(p.opis)}</title></rect>`;
    })
    .join("");

  return `
    <svg class="wykres" viewBox="0 -8 ${SZER} ${WYS + 16}" role="img"
         aria-label="Najlepszy wynik w ${punkty.length} ostatnich sesjach">${slupki}</svg>
    <div class="podpis">
      <span>${esc(punkty[0].data)}</span>
      <span>najlepsze: ${esc(punkty.at(-1).opis)}</span>
      <span>${esc(punkty.at(-1).data)}</span>
    </div>`;
}

/**
 * Trzeci poziom: jedno ćwiczenie na pełnym ekranie.
 *
 * Na siłowni pierwsze pytanie brzmi „ile brałem ostatnio i jak to szło" —
 * na liście mieści się tylko jedna poprzednia sesja.
 */
function ekranCwiczenie(cwiczenie, historia) {
  const rekord = historia?.rekord_ciezar
    ? `${historia.rekord_ciezar} kg`
    : historia?.rekord_powtorzenia
      ? `${historia.rekord_powtorzenia} powt.`
      : null;

  return `
    <div class="przyciski">
      <button class="przycisk pelny" data-zamknij-cwiczenie>← Wróć do treningu</button>
    </div>

    <section class="karta">
      ${kartaCwiczenia({ ...cwiczenie, ukonczone: false })}
    </section>

    <section class="karta">
      <h2>Historia</h2>
      ${rekord ? `<div class="teraz">${esc(rekord)} <span class="cel">rekord</span></div>` : ""}
      ${
        historia?.sesje?.length
          ? `${wykresCwiczenia(historia)}
             <div class="historia">${historia.sesje
               .map(
                 (s) => `<div class="wpis-historii">
                   <span class="data">${esc(s.data)}</span>
                   <span class="wyniki">${esc(s.serie.map(seriaWTekscie).join(" · "))}</span>
                 </div>`,
               )
               .join("")}</div>`
          : '<div class="pusto">To pierwszy raz — historia pojawi się przy kolejnym treningu.</div>'
      }
    </section>`;
}

function ekranTrening(trening, plan, dzisiajKod) {
  if (!trening.sesja) return kartaBezSesji(plan, dzisiajKod);

  return `
    <section class="karta">
      <h2>${esc(trening.sesja.dzien_kod ?? "Trening")} — ${esc(trening.sesja.dzien_nazwa ?? "bez planu")}</h2>
      ${pasekMakro("Ćwiczenia", trening.ukonczone_cwiczen, trening.wszystkich_cwiczen || 1, "")}
      ${
        trening.pozostalo.length
          ? `<div class="poprzednio" style="margin-top:12px">Zostało: ${esc(trening.pozostalo.join(", "))}</div>`
          : '<div class="poprzednio" style="margin-top:12px">Plan wykonany.</div>'
      }
    </section>

    <section class="karta">
      ${[...trening.wg_planu, ...trening.poza_planem].map(kartaCwiczenia).join("")}
    </section>

    <section class="karta">
      <h2>Coś jeszcze</h2>
      <!-- Ćwiczenie spoza planu pojawia się w stanie treningu dopiero razem
           z pierwszą serią, więc formularz od razu pyta o wynik. -->
      <form id="nowe-cwiczenie" hidden>
        <div class="pola">
          <div class="szeroko">
            <label for="nowe-nazwa">Ćwiczenie</label>
            <input id="nowe-nazwa" name="cwiczenie" required autocomplete="off" />
          </div>
          <div class="szeroko">
            <label for="nowe-typ">Rodzaj</label>
            <select id="nowe-typ" name="typ">
              <option value="silowe">siłowe</option>
              <option value="cardio">cardio</option>
              <option value="na_czas">na czas</option>
            </select>
          </div>
        </div>
        <div class="pola" id="nowe-pola">${polaSerii("silowe", wartosciSerii())}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Dodaj i zapisz serię</button>
          <button class="przycisk" type="button" data-anuluj="nowe-cwiczenie">Anuluj</button>
        </div>
      </form>
      <div class="przyciski">
        <button class="przycisk pelny" data-pokaz="nowe-cwiczenie">+ Ćwiczenie spoza planu</button>
      </div>
    </section>

    <div class="przyciski">
      <button class="przycisk pelny duzy" id="zakoncz-trening">Zakończ trening</button>
    </div>`;
}

// === Ekran: Postępy =====================================================

// Rysujemy wprost w SVG, bez biblioteki: dwa wykresy nie są wart 100 kB
// zależności doładowywanej na telefonie przez komórkową transmisję.
const SZER = 320;
const WYS = 120;

/**
 * Wykres wagi: surowe pomiary jako punkty, średnia krocząca jako linia.
 *
 * Linia rysowana jest ze średniej 7-dniowej liczonej po stronie serwera —
 * waga dzienna waha się o kilogram i wykres surowych pomiarów mówi więcej
 * o nawodnieniu niż o postępie.
 */
function wykresWagi(trend) {
  if (trend.length < 2) return '<div class="pusto">Za mało pomiarów na wykres.</div>';

  const wartosci = trend.flatMap((p) => [p.kg, p.srednia_7d]);
  const min = Math.min(...wartosci);
  const maks = Math.max(...wartosci);
  const rozpietosc = maks - min || 1;

  const x = (i) => (i / (trend.length - 1)) * SZER;
  const y = (v) => WYS - ((v - min) / rozpietosc) * WYS;

  const linia = trend.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.srednia_7d).toFixed(1)}`).join(" ");
  const punkty = trend
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="2.5" class="punkt" />`)
    .join("");

  return `
    <svg class="wykres" viewBox="-4 -8 ${SZER + 8} ${WYS + 16}" role="img"
         aria-label="Wykres wagi, od ${esc(trend[0].data)} do ${esc(trend.at(-1).data)}">
      <path d="${linia}" class="linia" />
      ${punkty}
    </svg>
    <div class="podpis">
      <span>${esc(trend[0].data)}</span>
      <span>${min.toFixed(1)}–${maks.toFixed(1)} kg</span>
      <span>${esc(trend.at(-1).data)}</span>
    </div>`;
}

/** Kalorie dzienne jako słupki, z celem zaznaczonym linią. */
function wykresKalorii(dni) {
  if (!dni.length) return '<div class="pusto">Brak danych.</div>';

  const maks = Math.max(...dni.map((d) => Math.max(d.kcal, d.cel_kcal ?? 0)), 1);
  const szerokosc = SZER / dni.length;

  const slupki = dni
    .map((d, i) => {
      const wysokosc = (d.kcal / maks) * WYS;
      const przekroczony = d.cel_kcal && d.kcal > d.cel_kcal;
      return `<rect x="${(i * szerokosc + szerokosc * 0.15).toFixed(1)}" y="${(WYS - wysokosc).toFixed(1)}"
                width="${(szerokosc * 0.7).toFixed(1)}" height="${wysokosc.toFixed(1)}"
                class="slupek ${przekroczony ? "ponad" : ""}"><title>${esc(d.data)}: ${zaokr(d.kcal)} kcal</title></rect>`;
    })
    .join("");

  // Cel bierzemy z ostatniego dnia — zmiana celu w środku okresu i tak
  // przesunęłaby linię, a jedna wartość czyta się jednoznacznie.
  const cel = dni.at(-1)?.cel_kcal;
  const liniaCelu = cel
    ? `<line x1="0" x2="${SZER}" y1="${(WYS - (cel / maks) * WYS).toFixed(1)}" y2="${(WYS - (cel / maks) * WYS).toFixed(1)}" class="cel-linia" />`
    : "";

  return `
    <svg class="wykres" viewBox="0 -8 ${SZER} ${WYS + 16}" role="img"
         aria-label="Wykres kalorii dziennych, ${dni.length} dni">
      ${slupki}${liniaCelu}
    </svg>
    <div class="podpis">
      <span>${esc(dni[0].data)}</span>
      <span>${cel ? `cel ${zaokr(cel)} kcal` : "bez celu"}</span>
      <span>${esc(dni.at(-1).data)}</span>
    </div>`;
}

function ekranPostepy(postepy, waga) {
  const ostatnia = waga.ostatnia;

  return `
    ${panelTygodnia(postepy.tydzien)}

    <section class="karta">
      <h2>Waga</h2>
      <form id="formularz-wagi">
        <div class="pola">
          <div>
            <label for="kg">Dzisiejszy pomiar (kg)</label>
            <input id="kg" name="kg" inputmode="decimal" placeholder="${ostatnia ? ostatnia.kg : "np. 81,4"}" />
          </div>
          <div style="display:flex; align-items:flex-end">
            <button class="przycisk glowny pelny" type="submit">Zapisz</button>
          </div>
        </div>
      </form>
      ${
        ostatnia
          ? `<div class="teraz">${ostatnia.kg} kg <span class="cel">ostatni pomiar ${esc(ostatnia.data_lokalna)}</span></div>`
          : ""
      }
      ${wykresWagi(waga.trend)}
    </section>

    <section class="karta">
      <h2>Kalorie — 30 dni</h2>
      ${wykresKalorii(postepy.dni)}
    </section>`;
}

// === Renderowanie i odświeżanie ========================================

const TYTULY = { dzis: "Dziś", trening: "Trening", postepy: "Postępy", raporty: "Raporty" };

async function odswiez() {
  tytulEkranu.textContent = TYTULY[ekran];
  const kolejka = await pokazStanSieci();

  if (ekran === "dzis") {
    const zapytanie = wybranaData ? `?data=${wybranaData}` : "";
    const [dzien, czeste] = await Promise.all([
      api(`/dzien${zapytanie}`),
      // Podpowiedzi są dodatkiem — ich brak (np. bez sieci) nie może zablokować
      // całego ekranu.
      api("/posilki/czeste?dni=30&limit=6").catch(() => []),
    ]);

    if (!wybranaData) dzisiajData = dzien.data;

    stan.dzien = nalozNaDzien(dzien, kolejka);
    stan.czeste = czeste;
    dataEkranu.textContent = stan.dzien.data;
    widok.innerHTML = ekranDzis(stan.dzien, czeste);
    return;
  }

  if (ekran === "trening") {
    const [trening, plan, zdrowie] = await Promise.all([
      api("/trening"),
      api("/plan"),
      fetch("/zdrowie").then((o) => o.json()),
    ]);

    // Dzień tygodnia liczony z daty serwera, żeby nie zależeć od zegara telefonu.
    const numerDnia = ((new Date(`${zdrowie.dzisiaj}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const dzisiajKod = plan.find((d) => d.dzien_tygodnia === numerDnia)?.kod;

    const stanTreningu = nalozNaTrening(trening, kolejka, plan);
    const wszystkie = [...stanTreningu.wg_planu, ...stanTreningu.poza_planem];

    propozycje.clear();
    for (const c of wszystkie) {
      if (c.propozycja) propozycje.set(c.nazwa, c.propozycja);
    }

    dataEkranu.textContent = zdrowie.dzisiaj;

    const otwarte = otwarteCwiczenie && wszystkie.find((c) => c.nazwa === otwarteCwiczenie);
    if (otwarte) {
      // Historia bywa niedostępna bez zasięgu — widok ma się wtedy otworzyć
      // i tak, z samym ćwiczeniem. Service worker poda ostatnią zapamiętaną.
      const historia = await api(`/historia/${encodeURIComponent(otwarte.nazwa)}?sesje=5`).catch(
        () => null,
      );
      widok.innerHTML = ekranCwiczenie(otwarte, historia);
      return;
    }

    otwarteCwiczenie = null;
    widok.innerHTML = ekranTrening(stanTreningu, plan, dzisiajKod);

    // Tylko po odhaczeniu: przewijanie przy każdym odświeżeniu wyrywałoby ekran
    // spod palca również wtedy, gdy użytkownik tylko czyta.
    if (przewinDoNastepnego) {
      przewinDoNastepnego = false;
      widok
        .querySelector(".cwiczenie:not(.zrobione)")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }

  if (ekran === "raporty") {
    stan.raporty = await api("/raporty");
    dataEkranu.textContent = stan.raporty.length ? `${stan.raporty.length} tyg.` : "";
    widok.innerHTML = ekranRaporty(stan.raporty, wybranyRaport);
    return;
  }

  const [postepy, waga] = await Promise.all([api("/postepy?dni=30"), api("/waga?dni=30")]);
  dataEkranu.textContent = "30 dni";
  widok.innerHTML = ekranPostepy(postepy, waga);
}

// === Obsługa zdarzeń ====================================================

function przejdzDo(nowyEkran) {
  ekran = nowyEkran;
  // Wyjście z zakładki zamyka też widok pojedynczego ćwiczenia — inaczej powrót
  // na Trening otwierałby ćwiczenie sprzed kwadransa zamiast listy.
  otwarteCwiczenie = null;

  // Raporty żyją w bocznym menu, nie w dolnym pasku — wtedy żaden przycisk
  // paska nie jest bieżący i wszystkie muszą stracić zaznaczenie.
  document.querySelectorAll("nav button").forEach((przycisk) => {
    if (przycisk.dataset.ekran === nowyEkran) przycisk.setAttribute("aria-current", "page");
    else przycisk.removeAttribute("aria-current");
  });

  odswiez().catch((blad) => komunikat(blad.message, true));
}

document.querySelector("nav")?.addEventListener("click", (zdarzenie) => {
  const przycisk = zdarzenie.target.closest("button[data-ekran]");
  if (przycisk) przejdzDo(przycisk.dataset.ekran);
});

// === Boczne menu ========================================================

const menu = document.getElementById("menu");
const przyciskMenu = document.getElementById("przycisk-menu");

function przelaczMenu(otwarte) {
  menu.hidden = !otwarte;
  przyciskMenu.setAttribute("aria-expanded", String(otwarte));
}

przyciskMenu?.addEventListener("click", () => przelaczMenu(menu.hidden));

menu?.addEventListener("click", async (zdarzenie) => {
  // Kliknięcie w przyciemnione tło zamyka szufladę — na telefonie to
  // szybsze niż celowanie w mały krzyżyk.
  if (zdarzenie.target === menu) return przelaczMenu(false);

  const przycisk = zdarzenie.target.closest("button[data-ekran], button[data-akcja]");
  if (!przycisk) return;

  przelaczMenu(false);

  if (przycisk.dataset.ekran) {
    wybranyRaport = null;
    przejdzDo(przycisk.dataset.ekran);
    return;
  }

  if (przycisk.dataset.akcja === "wyloguj") {
    // Nieudane wylogowanie i tak kończy się ekranem logowania: ciasteczko
    // wygaśnie samo, a użytkownik nie ma co robić z komunikatem o błędzie.
    await api("/wylogowanie", { method: "POST", kolejkuj: false, bezPrzekierowania: true }).catch(
      () => {},
    );
    przejdzDo("dzis");
    pokazLogowanie();
  }
});

document.addEventListener("keydown", (zdarzenie) => {
  if (zdarzenie.key === "Escape" && menu && !menu.hidden) przelaczMenu(false);
});

widok.addEventListener("click", (zdarzenie) => {
  const cel = zdarzenie.target;

  // Rozwinięcie raportu przerysowuje listę z pamięci, bez ponownego żądania —
  // archiwum przyszło w całości jednym zapytaniem.
  const naglowekRaportu = cel.closest("[data-raport]");
  if (naglowekRaportu) {
    wybranyRaport = naglowekRaportu.dataset.raport;
    widok.innerHTML = ekranRaporty(stan.raporty ?? [], wybranyRaport);
    return;
  }

  const pokaz = cel.closest("[data-pokaz]");
  if (pokaz) {
    const formularz = document.getElementById(pokaz.dataset.pokaz);
    formularz.hidden = false;
    pokaz.parentElement.hidden = true;
    formularz.querySelector("input")?.focus();
    return;
  }

  const anuluj = cel.closest("[data-anuluj]");
  if (anuluj) {
    const id = anuluj.dataset.anuluj;
    document.getElementById(id).hidden = true;

    // Ten sam formularz otwierają dwa przyciski — „Odhacz serię" obok „+ Seria"
    // oraz „inny wynik" — a każdy chowa własnego rodzica. Przy anulowaniu
    // wracają wszystkie: przywracanie samego sąsiada formularza zostawiało
    // „odhacz całe ćwiczenie" ukryte aż do następnego odświeżenia.
    // Porównanie zamiast selektora, bo id ćwiczenia z kolejki niesie nazwę
    // i potrafi zawierać spacje.
    for (const otwierajacy of document.querySelectorAll("[data-pokaz]")) {
      if (otwierajacy.dataset.pokaz === id) otwierajacy.parentElement.hidden = false;
    }
    return;
  }

  // Krok ciężaru: działa na polu leżącym w tym samym kontenerze co przycisk.
  const krok = cel.closest("[data-krok]");
  if (krok) {
    const pole = krok.parentElement.querySelector("input");
    const teraz = Number(String(pole.value).replace(",", ".")) || 0;
    const po = Math.max(0, teraz + Number(krok.dataset.krok));
    pole.value = Number.isInteger(po) ? String(po) : po.toFixed(1);
    return;
  }

  const widokCwiczenia = cel.closest("[data-cwiczenie-widok]");
  if (widokCwiczenia) {
    otwarteCwiczenie = widokCwiczenia.dataset.cwiczenieWidok;
    edytowanaSeria = null;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  if (cel.closest("[data-zamknij-cwiczenie]")) {
    otwarteCwiczenie = null;
    edytowanaSeria = null;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const odhaczSerie = cel.closest("[data-odhacz-serie]");
  if (odhaczSerie) {
    const nazwa = odhaczSerie.dataset.odhaczSerie;
    const wynik = propozycje.get(nazwa);
    if (!wynik) return komunikat("Nie wiadomo, co zapisać — użyj „inny wynik”", true);

    przewinDoNastepnego = !otwarteCwiczenie;
    akcjaPrzycisku(odhaczSerie, async () => {
      await api("/trening/seria", {
        method: "POST",
        dane: {
          cwiczenie: nazwa,
          powtorzenia: wynik.powtorzenia ?? undefined,
          ciezar_kg: wynik.ciezar_kg ?? undefined,
          czas_s: wynik.czas_s ?? undefined,
          dystans_m: wynik.dystans_m ?? undefined,
        },
      });
      startujPrzerwe();
    });
    return;
  }

  const odhaczCale = cel.closest("[data-odhacz-cwiczenie]");
  if (odhaczCale) {
    const nazwa = odhaczCale.dataset.odhaczCwiczenie;

    // Ćwiczenie spoza planu nie ma celu serii, więc liczbę trzeba podać.
    // Zwykły prompt zamiast własnego okna: to jedyne miejsce, które o coś pyta.
    const ile = odhaczCale.dataset.bezCelu
      ? Number(prompt(`Ile serii ćwiczenia „${nazwa}” zrobiłeś?`, "3"))
      : null;
    if (odhaczCale.dataset.bezCelu && !(ile > 0)) return;

    przewinDoNastepnego = !otwarteCwiczenie;
    akcjaPrzycisku(
      odhaczCale,
      // Bez timera przerwy — całe ćwiczenie jest już za tobą, nie w połowie.
      () =>
        api("/trening/cwiczenie/odhacz", {
          method: "POST",
          dane: { cwiczenie: nazwa, ...(ile ? { ile } : {}) },
        }),
      "Odhaczono ćwiczenie",
    );
    return;
  }

  const edytuj = cel.closest("[data-edytuj-serie]");
  if (edytuj) {
    const id = Number(edytuj.dataset.edytujSerie);
    // Ponowne stuknięcie w tę samą serię zamyka poprawkę.
    edytowanaSeria = edytowanaSeria === id ? null : id;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  if (cel.closest("[data-anuluj-edycji]")) {
    edytowanaSeria = null;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const usunSerie = cel.closest("[data-usun-serie]");
  if (usunSerie) {
    const id = Number(usunSerie.dataset.usunSerie);
    edytowanaSeria = null;
    akcja(
      () => api("/wpis", { method: "POST", dane: { typ: "seria", id, akcja: "usun" } }),
      "Usunięto serię",
    );
    return;
  }

  if (cel.closest("[data-start-bez-planu]")) {
    akcja(() => api("/trening/start", { method: "POST", dane: { bez_planu: true } }));
    return;
  }

  const start = cel.closest("[data-start]");
  if (start) {
    akcja(() => api("/trening/start", { method: "POST", dane: { kod: start.dataset.start } }));
    return;
  }

  const zmianaDnia = cel.closest("[data-dzien]");
  if (zmianaDnia) {
    const nowa = przesunDate(stan.dzien?.data ?? dzisiajData, Number(zmianaDnia.dataset.dzien));
    // Powrót na dzisiaj kasuje wybór, żeby ekran znów podążał za zmianą doby.
    wybranaData = dzisiajData && nowa >= dzisiajData ? null : nowa;
    edytowanyPosilek = null;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const czesty = cel.closest("[data-czesty]");
  if (czesty) {
    const dane = JSON.parse(czesty.dataset.czesty);
    const formularz = document.getElementById("formularz-posilku");
    formularz.elements.opis.value = dane.opis;
    formularz.elements.kcal.value = zaokr(dane.kcal);
    formularz.elements.bialko_g.value = zaokr(dane.bialko_g);
    formularz.elements.wegle_g.value = zaokr(dane.wegle_g);
    formularz.elements.tluszcz_g.value = zaokr(dane.tluszcz_g);
    formularz.elements.kcal.focus();
    return;
  }

  const edytujPosilek = cel.closest("[data-edytuj-posilek]");
  if (edytujPosilek) {
    const id = Number(edytujPosilek.dataset.edytujPosilek);
    edytowanyPosilek = edytowanyPosilek === id ? null : id;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  if (cel.closest("[data-anuluj-posilku]")) {
    edytowanyPosilek = null;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const usun = cel.closest("[data-usun-posilek]");
  if (usun) {
    const id = Number(usun.dataset.usunPosilek);
    // Zapamiętujemy treść przed skasowaniem — inaczej „Cofnij" nie miałoby
    // czego przywrócić. Wpis wraca z nowym id; miękkie usuwanie wymagałoby
    // migracji i nie jest tego warte.
    ostatnioUsuniety = stan.dzien?.posilki.find((p) => p.id === id) ?? null;
    edytowanyPosilek = null;

    akcja(async () => {
      await api("/wpis", { method: "POST", dane: { typ: "posilek", id, akcja: "usun" } });
      const wrocDo = ostatnioUsuniety;
      if (wrocDo) {
        komunikat(`Usunięto „${wrocDo.opis}”`, false, () =>
          akcja(
            () =>
              api("/posilki", {
                method: "POST",
                dane: {
                  opis: wrocDo.opis,
                  kcal: wrocDo.kcal,
                  bialko_g: wrocDo.bialko_g,
                  wegle_g: wrocDo.wegle_g,
                  tluszcz_g: wrocDo.tluszcz_g,
                  czas: `${wrocDo.data_lokalna} ${wrocDo.godzina}`,
                },
              }),
            "Przywrócono",
          ),
        );
      }
    });
    return;
  }

  if (cel.closest("#zakoncz-trening")) {
    akcja(() => api("/trening/koniec", { method: "POST", dane: {} }), "Trening zakończony");
  }
});

// Zmiana rodzaju ćwiczenia przestawia pola wyniku — cardio nie pyta
// o powtórzenia, siłowe nie pyta o dystans.
widok.addEventListener("change", (zdarzenie) => {
  if (zdarzenie.target.id !== "nowe-typ") return;
  document.getElementById("nowe-pola").innerHTML = polaSerii(
    zdarzenie.target.value,
    wartosciSerii(),
  );
});

widok.addEventListener("submit", (zdarzenie) => {
  zdarzenie.preventDefault();
  const formularz = zdarzenie.target;

  // Zapis już trwa — drugie wysłanie zapisałoby ten sam wpis po raz drugi.
  if (formularz.dataset.zapisuje === "1") return;

  if (formularz.id === "formularz-posilku") {
    akcja(
      () =>
        api("/posilki", {
          method: "POST",
          dane: { ...makroZFormularza(formularz), czas: czasPosilku(formularz) },
        }),
      "Zapisano posiłek",
      formularz,
    );
    return;
  }

  if (formularz.id.startsWith("edycja-posilku-")) {
    const id = Number(formularz.dataset.posilek);
    edytowanyPosilek = null;
    akcja(
      () =>
        api("/wpis", {
          method: "POST",
          dane: { typ: "posilek", id, akcja: "popraw", dane: makroZFormularza(formularz) },
        }),
      "Poprawiono posiłek",
      formularz,
    );
    return;
  }

  if (formularz.id.startsWith("seria-")) {
    akcja(
      async () => {
        await api("/trening/seria", {
          method: "POST",
          dane: { cwiczenie: formularz.dataset.cwiczenie, ...wynikZFormularza(formularz) },
        });
        startujPrzerwe();
      },
      undefined,
      formularz,
    );
    return;
  }

  if (formularz.id.startsWith("edycja-serii-")) {
    const id = Number(formularz.dataset.seria);
    edytowanaSeria = null;
    akcja(
      () =>
        api("/wpis", {
          method: "POST",
          dane: { typ: "seria", id, akcja: "popraw", dane: wynikZFormularza(formularz) },
        }),
      "Poprawiono serię",
      formularz,
    );
    return;
  }

  if (formularz.id === "nowe-cwiczenie") {
    const nazwa = formularz.elements.cwiczenie.value.trim();
    if (!nazwa) return komunikat("Podaj nazwę ćwiczenia", true);

    akcja(
      async () => {
        await api("/trening/seria", {
          method: "POST",
          dane: {
            cwiczenie: nazwa,
            typ: formularz.elements.typ.value,
            ...wynikZFormularza(formularz),
          },
        });
        startujPrzerwe();
      },
      "Dodano ćwiczenie",
      formularz,
    );
    return;
  }

  if (formularz.id === "formularz-wagi") {
    const kg = liczbaZPola(formularz, "kg");
    if (!kg) return komunikat("Podaj wagę", true);
    akcja(() => api("/waga", { method: "POST", dane: { kg } }), "Zapisano wagę", formularz);
  }
});

// === Logowanie ==========================================================

function pokazLogowanie() {
  ekranLogowania.hidden = false;
  aplikacja.hidden = true;
}

document.getElementById("formularz-logowania")?.addEventListener("submit", async (zdarzenie) => {
  zdarzenie.preventDefault();

  const pole = document.getElementById("haslo");
  const przycisk = document.getElementById("przycisk-zaloguj");
  const blad = document.getElementById("blad-logowania");
  const haslo = pole.value.trim();

  const pokazBlad = (tekst) => {
    blad.textContent = tekst;
    blad.hidden = false;
  };

  blad.hidden = true;

  if (!haslo) return pokazBlad("Wpisz hasło.");

  // Widoczna informacja, że coś się dzieje — bez tego przy wolnej sieci
  // przycisk sprawia wrażenie martwego.
  przycisk.disabled = true;
  przycisk.textContent = "Logowanie…";

  try {
    // Logowania nie kolejkujemy: hasło wysłane za godzinę jest bezużyteczne,
    // a użytkownik musi od razu wiedzieć, że nie ma połączenia.
    await api("/logowanie", {
      method: "POST",
      dane: { haslo },
      bezPrzekierowania: true,
      kolejkuj: false,
    });
    ekranLogowania.hidden = true;
    aplikacja.hidden = false;
    await odswiez();
  } catch (problem) {
    pokazBlad(
      problem.status === 401
        ? "Nieprawidłowe hasło. Sprawdź wielkość liter."
        : (problem.message ?? "Nie udało się zalogować"),
    );
    pole.select?.();
  } finally {
    przycisk.disabled = false;
    przycisk.textContent = "Zaloguj";
  }
});

// === Start ==============================================================

// Rejestracja service workera nie może blokować startu: bez niego aplikacja
// nadal działa, tyle że wymaga sieci.
navigator.serviceWorker?.register("/sw.js").catch(() => {
  /* np. przeglądarka bez obsługi albo strona po http */
});

(async () => {
  try {
    await api("/dzien");
    aplikacja.hidden = false;
    await odswiez();
    void wyslijCzekajace();
  } catch (blad) {
    // Brak sieci to nie to samo co brak sesji. Przy pustej kolejce i tak nie ma
    // co pokazać, ale z zaległymi wpisami wyrzucenie na logowanie skasowałoby
    // widok treningu, który użytkownik właśnie wypełnił bez zasięgu.
    if (blad.status === 0 && (await wpisyKolejki()).length > 0) {
      aplikacja.hidden = false;
      await odswiez().catch(() => pokazLogowanie());
      return;
    }
    pokazLogowanie();
  }
})();
