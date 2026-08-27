/**
 * Aplikacja webowa — trzy ekrany, bez frameworka.
 *
 * Priorytet ekranu treningu: wszystko ma być osiągalne kciukiem jedną ręką,
 * a dopisanie serii ma kosztować jedno stuknięcie plus ewentualną korektę
 * ciężaru. Dlatego formularz serii jest wstępnie wypełniony poprzednim wynikiem.
 */

import { ekranAktywnosci, polaAktywnosci, wpisAktywnosci, wpisTreningu } from "./aktywnosci.js";
import { ekranDieta } from "./dieta.js";
import { etykietaDnia } from "./kalendarz.js";
import { dodajDoKolejki, wpisyKolejki, wyslijKolejke } from "./kolejka.js";
import {
  nalozNaAktywnosci,
  nalozNaDzien,
  nalozNaDzienRuchu,
  nalozNaNotatki,
  nalozNaTreningi,
  nalozNaTrening,
} from "./nakladka.js";
import { ekranNotatki } from "./notatki.js";
import { polaPosilku, szablonWiersza, wpisPosilku } from "./posilek.js";
import { czasWTekscie, stanPrzerwy, trwanieWTekscie } from "./przerwa.js";
import { ekranRaporty, panelTygodnia } from "./raporty.js";
import { seriaWTekscie, serieZgrupowane } from "./seria.js";

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

/** Rozwinięty dzień na zakładce Dieta; null znaczy „wszystkie zwinięte". */
let rozwinietyDzien = null;

/** Ile 14-dniowych okien historii diety pobrać. Rośnie od „Pokaż starsze". */
let stronDiety = 1;

/** Rozwinięty dzień na zakładce Aktywności; null znaczy „wszystkie zwinięte". */
let rozwinietyDzienAktywnosci = null;

/** Id aktywności otwartej do poprawki — wspólne dla ekranu Dziś i zakładki. */
let edytowanaAktywnosc = null;

/** Ile 14-dniowych okien historii aktywności pobrać. */
let stronAktywnosci = 1;

/** Ostatnio usunięta aktywność — materiał na „Cofnij" w komunikacie. */
let ostatnioUsunietaAktywnosc = null;

/** Otwarty folder notatek; null znaczy „lista folderów". */
let otwartyFolder = null;

/** Rozwinięta notatka. Id trzymamy tekstem, bo wpis z kolejki ma id „oczekuje-3". */
let otwartaNotatka = null;

/** Ile 30-notatkowych porcji pobrać z każdego folderu. Rośnie od „Pokaż starsze". */
let stronNotatek = 1;

/** Ostatnio usunięta notatka — materiał na „Cofnij" w komunikacie. */
let ostatnioUsunietaNotatka = null;

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
 * Czas liczymy od znacznika początku przerwy, a nie odejmując sekundy
 * w interwale: przeglądarka na wygaszonym ekranie dławi setInterval i licznik
 * oparty na dekrementacji zacząłby się spóźniać o kilkadziesiąt sekund. Przy
 * takim dławieniu wibracja potrafi przyjść z opóźnieniem, ale pokazany czas
 * jest zawsze prawdziwy.
 *
 * Reguła kafelków — całkowity czas przerwy zamiast dokładki — siedzi
 * w `przerwa.js`, bo jako jedyna część timera daje się objąć testami.
 */

const KROKI_PRZERWY = [90, 120, 180];
const DOMYSLNA_PRZERWA = 120;

const elementTimera = document.getElementById("timer");
const czasTimera = document.getElementById("timer-czas");
const wyborPrzerwy = elementTimera?.querySelector(".wybor");

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

/** Początek bieżącej przerwy; kafelki liczą swój czas właśnie od niego. */
let startPrzerwy = null;

/** Całkowity czas przerwy w sekundach — zmieniany kafelkiem, nie restartowany. */
let celPrzerwy = null;

/** Wibracja ma pójść raz, a nie przy każdym tiku po dojściu do zera. */
let zadzwonilo = false;

let tykanie;

function wybranaPrzerwa() {
  const zapisana = Number(zapamietane("przerwa_s"));
  return KROKI_PRZERWY.includes(zapisana) ? zapisana : DOMYSLNA_PRZERWA;
}

/**
 * Jednorazowe drżenie kafelka na koniec przerwy.
 *
 * Osobna klasa, a nie animacja doczepiona do `minela`: przy wydłużonej przerwie
 * kolor bywa zdejmowany i zakładany z powrotem, a przeglądarka **nie startuje
 * wtedy animacji od nowa** — kontynuuje zakończoną, więc drugie i trzecie
 * odliczenie mijało bez drgnięcia. Wymuszony reflow gwarantuje restart.
 */
function zadrzyj() {
  elementTimera.classList.remove("drzy");
  void elementTimera.offsetWidth;
  elementTimera.classList.add("drzy");
}

// Klasa schodzi zaraz po animacji, żeby kolejne drżenie zawsze zaczynało od
// czystego stanu, a nie od zakończonego przebiegu.
elementTimera?.addEventListener("animationend", () => elementTimera.classList.remove("drzy"));

function odswiezTimer() {
  const stan = stanPrzerwy(startPrzerwy, celPrzerwy, Date.now(), KROKI_PRZERWY);
  czasTimera.textContent = czasWTekscie(stan.pozostalo);

  let widocznych = 0;
  for (const kafelek of elementTimera.querySelectorAll("[data-przerwa]")) {
    const opis = stan.kafelki.find((k) => k.sekundy === Number(kafelek.dataset.przerwa));
    kafelek.hidden = !opis?.widoczny;
    kafelek.setAttribute("aria-pressed", String(Boolean(opis?.wybrany)));
    if (!kafelek.hidden) widocznych += 1;
  }
  if (wyborPrzerwy) wyborPrzerwy.hidden = widocznych === 0;

  if (!stan.gotowe) return;

  // Kolor zostaje aż do nowej przerwy albo wydłużenia bieżącej.
  elementTimera.classList.add("minela");

  if (!zadzwonilo) {
    zadzwonilo = true;
    navigator.vibrate?.([180, 90, 180]);
    zadrzyj();
  }

  // Odliczanie stoi, ale kafelki nadal się przeterminowują — interwał gasimy
  // dopiero wtedy, gdy nie ma już czego chować.
  if (widocznych === 0) {
    clearInterval(tykanie);
    tykanie = undefined;
  }
}

function tykaj() {
  clearInterval(tykanie);
  tykanie = setInterval(odswiezTimer, 250);
  odswiezTimer();
}

/** Nowa przerwa — po zapisaniu serii. */
function startujPrzerwe(sekundy = wybranaPrzerwa()) {
  startPrzerwy = Date.now();
  celPrzerwy = sekundy;
  zadzwonilo = false;

  elementTimera.hidden = false;
  elementTimera.classList.remove("minela", "drzy");
  tykaj();
}

/**
 * Kafelek wydłuża trwającą przerwę, a nie zaczyna nowej: po 90 sekundach
 * stuknięcie w 120 daje pozostałe 30, nie kolejne dwie minuty. Wybór
 * zapamiętujemy, żeby następna seria zaczynała od tego samego kroku.
 */
function zmienCelPrzerwy(sekundy) {
  zapamietaj("przerwa_s", String(sekundy));
  if (startPrzerwy === null) return startujPrzerwe(sekundy);

  celPrzerwy = sekundy;
  zadzwonilo = false;
  elementTimera.classList.remove("minela", "drzy");
  tykaj();
}

function zatrzymajPrzerwe() {
  clearInterval(tykanie);
  tykanie = undefined;
  startPrzerwy = null;
  celPrzerwy = null;
  zadzwonilo = false;
  elementTimera.hidden = true;
  elementTimera.classList.remove("minela", "drzy");
}

elementTimera?.addEventListener("click", (zdarzenie) => {
  const wybor = zdarzenie.target.closest("[data-przerwa]");
  if (wybor) return zmienCelPrzerwy(Number(wybor.dataset.przerwa));
  if (zdarzenie.target.closest("#timer-zamknij")) zatrzymajPrzerwe();
});

// === Czas trwania treningu ==============================================

/** Sekundy od znacznika. Ujemne przycina dopiero `trwanieWTekscie`. */
const sekundOd = (znacznik) => Math.floor((Date.now() - Date.parse(znacznik)) / 1000);

/**
 * Licznik czasu sesji.
 *
 * Kafelek żyje wewnątrz `#widok`, który `odswiez()` podmienia w całości, więc
 * odliczanie nie może trzymać się jego referencji — przy każdym tiku szukamy go
 * od nowa i milczymy, gdy go nie ma. Dzięki temu ten sam interwał obsługuje
 * każde przerysowanie widoku i nie trzeba go nigdzie restartować.
 */
function odswiezCzasTreningu() {
  const kafelek = document.querySelector("[data-start-treningu]");
  const napis = kafelek?.querySelector(".odliczanie");
  if (napis) napis.textContent = trwanieWTekscie(sekundOd(kafelek.dataset.startTreningu));
}

setInterval(odswiezCzasTreningu, 1000);

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

/**
 * Godzina z formularza edycji posiłku — wysyłana tylko wtedy, gdy użytkownik
 * ją ZMIENIŁ; inaczej każda poprawka makro zerowałaby sekundy znacznika czasu.
 * Zawsze z jawną datą dnia wpisu, żeby edycja wczorajszego obiadu nie
 * przeniosła go po cichu na dzisiaj.
 */
function czasEdycji(formularz) {
  const godzina = formularz.elements.godzina?.value?.trim();
  if (!godzina) return undefined;

  const dopasowanie = /^(\d{1,2})[:.]?(\d{2})$/.exec(godzina);
  if (!dopasowanie) return undefined;

  const znormalizowana = `${dopasowanie[1].padStart(2, "0")}:${dopasowanie[2]}`;
  if (znormalizowana === formularz.dataset.godzina) return undefined;

  // Atrybut nazywa się dzien-wpisu, nie dzien — goły data-dzien na formularzu
  // wpadałby w delegowany handler paska dat przy każdym stuknięciu w pole.
  return `${formularz.dataset.dzienWpisu} ${znormalizowana}`;
}

/**
 * Aktywność z formularza. Kilometry i minuty są jednostkami człowieka, metry
 * i sekundy jednostkami bazy — przeliczenie siedzi w jednym miejscu, żeby
 * dodawanie i poprawka nie umiały zrobić tego inaczej.
 */
function daneAktywnosci(formularz) {
  const km = liczbaZPola(formularz, "dystans_km");
  const minuty = liczbaZPola(formularz, "czas_min");
  const notatka = formularz.elements.notatka?.value?.trim();

  return {
    dyscyplina: formularz.elements.dyscyplina.value.trim(),
    dystans_m: km ? Math.round(km * 1000) : undefined,
    czas_s: minuty ? Math.round(minuty * 60) : undefined,
    ...(notatka ? { notatka } : {}),
  };
}

/**
 * Moment aktywności. Pusta godzina przy dzisiaj znaczy „teraz" i zostaje
 * serwerowi; przy innym dniu data musi jechać wprost, inaczej wpis wylądowałby
 * pod dzisiejszą dobą.
 */
function czasAktywnosci(formularz, dzien, wymuszDate) {
  const godzina = formularz.elements.godzina?.value?.trim();
  const dopasowanie = godzina ? /^(\d{1,2})[:.]?(\d{2})$/.exec(godzina) : null;

  if (!dopasowanie || !dzien) return wymuszDate && dzien ? `${dzien} 12:00` : undefined;
  return `${dzien} ${dopasowanie[1].padStart(2, "0")}:${dopasowanie[2]}`;
}

/**
 * Pola aktywności, które użytkownik faktycznie ZMIENIŁ. Ten sam powód co przy
 * posiłku: formularz prefillowany obecnymi wartościami wysyłałby przy każdej
 * poprawce komplet, a wtedy nietknięta godzina przepisywałaby znacznik czasu.
 */
function zmienioneAktywnosci(formularz) {
  const dane = {};
  const zmienione = (nazwa) => {
    const pole = formularz.elements[nazwa];
    return pole && pole.value !== pole.defaultValue;
  };

  const wszystko = daneAktywnosci(formularz);
  if (zmienione("dyscyplina")) dane.dyscyplina = wszystko.dyscyplina;
  if (zmienione("dystans_km")) dane.dystans_m = wszystko.dystans_m ?? null;
  if (zmienione("czas_min")) dane.czas_s = wszystko.czas_s ?? null;
  if (zmienione("notatka")) dane.notatka = wszystko.notatka ?? null;

  const czas = czasEdycji(formularz);
  if (czas) dane.czas = czas;

  return dane;
}

/**
 * Pola posiłku, które użytkownik faktycznie ZMIENIŁ (porównanie
 * z defaultValue). Formularz edycji nie może wysyłać pól nietkniętych:
 * jawnie podane kcal wygrywa z auto-sumą pozycji po stronie serwera,
 * więc prefill z obecną wartością blokowałby przeliczanie na zawsze.
 */
function zmienioneMakro(formularz) {
  const dane = {};
  const zmienione = (nazwa) => {
    const pole = formularz.elements[nazwa];
    return pole && pole.value !== pole.defaultValue;
  };

  if (zmienione("opis") && formularz.elements.opis.value.trim()) {
    dane.opis = formularz.elements.opis.value;
  }
  for (const nazwa of ["kcal", "bialko_g", "wegle_g", "tluszcz_g"]) {
    if (!zmienione(nazwa)) continue;
    const wartosc = liczbaZPola(formularz, nazwa);
    if (wartosc !== undefined) dane[nazwa] = wartosc;
  }
  return dane;
}

/**
 * Pozycje z wierszy formularza edycji. Granica „wyczyść vs nie ruszaj" leży
 * na obecności klucza w żądaniu: undefined = rozbicia nie tykamy, [] = posiłek
 * miał pozycje i użytkownik skasował wszystkie wiersze.
 *
 * Nietknięty edytor nie wysyła klucza wcale — zastąpienie identyczną listą
 * uruchomiłoby auto-sumę i po cichu przepisało nagłówek przy poprawce
 * samego opisu.
 */
function pozycjeZFormularza(formularz) {
  const wiersze = [...formularz.querySelectorAll("[data-wiersz]")];

  const nietkniety =
    String(wiersze.length) === formularz.dataset.ilePozycji &&
    wiersze.every((w) =>
      [...w.querySelectorAll("input")].every((pole) => pole.value === pole.defaultValue),
    );
  if (nietkniety) return undefined;

  const liczba = (pole) => {
    const wartosc = pole?.value?.replace(",", ".").trim();
    return wartosc ? Number(wartosc) : undefined;
  };

  const pozycje = [];
  for (const wiersz of wiersze) {
    const nazwa = wiersz.querySelector('[name="poz-nazwa"]')?.value?.trim();
    // Wiersz bez nazwy to niedokończony dodatek, nie składnik.
    if (!nazwa) continue;
    pozycje.push({
      nazwa,
      ilosc_g: liczba(wiersz.querySelector('[name="poz-ilosc"]')),
      kcal: liczba(wiersz.querySelector('[name="poz-kcal"]')),
      bialko_g: liczba(wiersz.querySelector('[name="poz-bialko"]')),
      wegle_g: liczba(wiersz.querySelector('[name="poz-wegle"]')),
      tluszcz_g: liczba(wiersz.querySelector('[name="poz-tluszcz"]')),
    });
  }

  return pozycje;
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

// Renderer wpisu i pól posiłku mieszka w posilek.js — wspólny z zakładką
// Dieta, żeby edycja działała identycznie na obu ekranach.

function ekranDzis(dzien, czeste = []) {
  const cele = dzien.cele;

  const posilki = dzien.posilki.length
    ? dzien.posilki.map((p) => wpisPosilku(p, edytowanyPosilek)).join("")
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
        <span class="etykieta-daty ${wybranaData ? "" : "dzis"}">${esc(etykietaDnia(dzien.data, dzisiajData))}</span>
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
    </section>

    ${sekcjaAktywnosci(dzien.aktywnosci ?? [], dzien.treningi ?? [])}`;
}

/**
 * Ruch dnia na ekranie Dziś — treningi i aktywności razem, po to żeby wyjazd
 * podyktowany Claude'owi było widać tam, gdzie użytkownik i tak patrzy.
 * Pełna historia mieszka w zakładce; tutaj jest tylko dzisiaj.
 */
function sekcjaAktywnosci(aktywnosci, treningi) {
  const wpisy =
    treningi.map((t) => wpisTreningu(t)).join("") +
    aktywnosci.map((a) => wpisAktywnosci(a, edytowanaAktywnosc)).join("");

  const lista = wpisy || '<div class="pusto">Nic dziś nie zapisano.</div>';

  return `
    <section class="karta">
      <h2>Ruch</h2>
      ${lista}
      <form id="formularz-aktywnosci" hidden>
        <div class="pola">${polaAktywnosci()}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Zapisz</button>
          <button class="przycisk" type="button" data-anuluj="formularz-aktywnosci">Anuluj</button>
        </div>
      </form>
      <div class="przyciski" id="dodaj-aktywnosc-wrapper">
        <button class="przycisk pelny" data-pokaz="formularz-aktywnosci">+ Dodaj aktywność</button>
      </div>
    </section>`;
}

// === Ekran: Trening =====================================================

/** Księżyc — dzień wolny to odpoczynek, a nie dziura w planie. */
const ZNAK_ODPOCZYNKU = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>`;

const przyciskDnia = (dzien, klasy = "przycisk pelny") =>
  `<div class="przyciski"><button class="${klasy}" data-start-dzien="${dzien.id}">
     ${esc(dzien.kod)} — ${esc(dzien.nazwa)}
   </button></div>`;

/**
 * Ekran przed rozpoczęciem treningu, w trzech poziomach widoczności.
 *
 * 1. Dzień, który harmonogram przewiduje na dziś — albo wprost napisane, że
 *    dziś nic nie przewiduje. To jedyne pytanie, z jakim się tu wchodzi.
 * 2. Reszta planu domyślnego — nadal twój plan, tylko nie na dzisiaj.
 * 3. Dni z pozostałych planów, pod kreską i przygaszone: szablony, nie plan.
 *
 * Trzeci poziom jest osobny, bo szablon sprzed miesiąca i dzień z bieżącego
 * planu to nie to samo, choć jedno i drugie da się odpalić stuknięciem.
 */
function kartaBezSesji(plany, dzisiajDzienTygodnia) {
  const domyslny = plany.find((p) => p.domyslny);
  const naDzis = domyslny?.dni.find((d) => d.dzien_tygodnia === dzisiajDzienTygodnia);
  const resztaPlanu = (domyslny?.dni ?? []).filter((d) => d.id !== naDzis?.id);
  const szablony = plany.filter((p) => !p.domyslny && p.dni.length);

  const bezPlanu = `
    <div class="przyciski">
      <button class="przycisk pelny" data-start-bez-planu>Trening bez planu</button>
    </div>`;

  if (!plany.length) {
    return `<section class="karta">
      <h2>Trening</h2>
      <div class="pusto">Nie masz jeszcze planu. Podyktuj go Claude'owi — zapisze go sam.</div>
      ${bezPlanu}
    </section>`;
  }

  return `
    <section class="karta">
      <h2>Zacznij trening</h2>
      ${
        // Jedno miejsce, dwa stany: albo dzień do zrobienia, albo dzień wolny.
        // Wolny ma ten sam ciężar w układzie co przycisk, bo to równoprawna
        // odpowiedź na pytanie „co dziś", a nie brak odpowiedzi.
        naDzis
          ? `<button class="przycisk glowny pelny duzy" data-start-dzien="${naDzis.id}">
               ${esc(naDzis.kod)} — ${esc(naDzis.nazwa)}
             </button>
             <div class="pusto">Dzisiejszy dzień wg planu „${esc(domyslny.nazwa)}".</div>`
          : `<div class="dzien-wolny">
               <span class="znak" aria-hidden="true">${ZNAK_ODPOCZYNKU}</span>
               Dziś rest day, bro :)
             </div>
             <div class="pusto">Plan nie przewiduje na dziś treningu.</div>`
      }
      ${resztaPlanu.map((d) => przyciskDnia(d)).join("")}

      ${
        szablony.length
          ? `<div class="rozdzielnik"><span>Inne plany</span></div>
             <div class="szablony">
               ${szablony
                 .map(
                   (p) => `<div class="szablon">
                     <span class="nazwa-planu">${esc(p.nazwa)}</span>
                     ${p.dni.map((d) => przyciskDnia(d, "przycisk pelny cichy")).join("")}
                   </div>`,
                 )
                 .join("")}
             </div>`
          : ""
      }
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

/**
 * Kropki postępu: pełna — seria zrobiona, obrys — została. SVG zamiast znaków
 * ●○, bo font rysuje te glify w różnych rozmiarach zależnie od telefonu
 * i pełne kółka wychodziły większe od pustych. Bez celu serii nie ma czego
 * rysować.
 */
function kropkiSerii(cwiczenie) {
  if (!cwiczenie.serie_cel) return "";

  const zrobione = Math.min(cwiczenie.serie_zrobione, 12);
  const zostalo = Math.min(Math.max(0, cwiczenie.serie_cel - cwiczenie.serie_zrobione), 12);
  const ile = zrobione + zostalo;

  // Promień 4 plus obrys 1.5 mieści się w wierszu o wysokości 12; odstęp 13
  // trzyma kropki bliżej siebie niż litery z odstępem, którymi były wcześniej.
  const kola = Array.from({ length: ile }, (_, i) =>
    `<circle cx="${6 + i * 13}" cy="6" r="4" class="${i < zrobione ? "pelna" : "pusta"}" />`,
  ).join("");

  return `<svg class="kropki" width="${ile * 13 - 1}" height="12"
       viewBox="0 0 ${ile * 13 - 1} 12" aria-hidden="true">${kola}</svg>`;
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

/**
 * Strzałka przy nazwie ćwiczenia. Nazwa otwiera pełny widok z historią
 * i rekordami, ale sama z siebie wygląda jak nagłówek — bez tego znaku
 * funkcję można nigdy nie odkryć.
 */
const ZNAK_DALEJ = `<svg class="dalej" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 5.5l6.5 6.5L9 18.5" />
  </svg>`;

const przyciskNazwy = (cwiczenie, przedrostek = "") =>
  `<button type="button" class="nazwa" data-cwiczenie-widok="${esc(cwiczenie.nazwa)}">
     ${przedrostek}${esc(cwiczenie.nazwa)}${ZNAK_DALEJ}
   </button>`;

/** Cel z planu w jednej linii: „Cel: 4 × 8" — etykieta równolegle do „Poprzednio:". */
function celWTekscie(cwiczenie) {
  if (!cwiczenie.serie_cel && !cwiczenie.powt_cel) return "";
  const liczby = [cwiczenie.serie_cel ? `${cwiczenie.serie_cel} ×` : null, esc(cwiczenie.powt_cel ?? "")]
    .filter(Boolean)
    .join(" ");
  return `Cel: ${liczby}`;
}

/** „2 serie", ale „5 serii" — napis na łączu zbiorczego odhaczenia. */
const odmianaSerii = (ile) => (ile < 5 ? "serie" : "serii");

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
          ${przyciskNazwy(cwiczenie, "✓ ")}
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
        ${przyciskNazwy(cwiczenie)}
        ${kropkiSerii(cwiczenie)}
      </div>
      ${celWTekscie(cwiczenie) ? `<div class="cel-cwiczenia">${celWTekscie(cwiczenie)}</div>` : ""}

      ${serieWKarcie(cwiczenie)}
      ${wPoprawce ? formularzPoprawkiSerii(cwiczenie.typ, wPoprawce) : ""}

      ${
        cwiczenie.poprzednio.length
          ? `<div class="poprzednio">Poprzednio: ${esc(serieZgrupowane(cwiczenie.poprzednio))}</div>`
          : ""
      }

      ${formularzSerii(cwiczenie, idFormularza)}

      <div class="przyciski">
        ${
          // Po osiągnięciu celu licznik gubi mianownik („5/3" to absurd),
          // a przycisk cichnie: wielki zielony klawisz namawiający na piątą
          // serię przy celu trzech byłby narzucaniem progresji, której system
          // świadomie nie narzuca.
          mozna
            ? `<button class="przycisk ${zostalo === null || zostalo > 0 ? "glowny duzy" : ""} pelny"
                 data-odhacz-serie="${esc(cwiczenie.nazwa)}">
                 Odhacz serię ${cwiczenie.serie_zrobione + 1}${cwiczenie.serie_cel && zostalo > 0 ? `/${cwiczenie.serie_cel}` : ""} — ${esc(seriaWTekscie(propozycja))}
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
                 // Łącze mówi, ile serii zapisze — jak przycisk główny, i z tego
                 // samego powodu: zapis idzie bez potwierdzenia. Wielokropek przy
                 // braku celu zapowiada, że najpierw padnie pytanie o liczbę.
                 zostalo === null || zostalo >= 2
                   ? `<button type="button" class="lacze" data-odhacz-cwiczenie="${esc(cwiczenie.nazwa)}"
                        ${zostalo === null ? 'data-bez-celu="1"' : ""}>${
                          zostalo === null
                            ? "odhacz całe ćwiczenie…"
                            : `odhacz pozostałe ${zostalo} ${odmianaSerii(zostalo)}`
                        }</button>`
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
    <div class="przyciski powrot">
      <button class="przycisk pelny" data-zamknij-cwiczenie>← Wróć do treningu</button>
    </div>

    <section class="karta">
      <!-- Bez linii „Poprzednio": sekcja Historia niżej zaczyna się od tej
           samej sesji i karta powtarzałaby ją słowo w słowo. -->
      ${kartaCwiczenia({ ...cwiczenie, ukonczone: false, poprzednio: [] })}
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
                   <span class="wyniki">${esc(serieZgrupowane(s.serie))}</span>
                 </div>`,
               )
               .join("")}</div>`
          : '<div class="pusto">To pierwszy raz — historia pojawi się przy kolejnym treningu.</div>'
      }
    </section>`;
}

function ekranTrening(trening, plany, dzisiajDzienTygodnia) {
  if (!trening.sesja) return kartaBezSesji(plany, dzisiajDzienTygodnia);

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

    <!-- Licznik od rozpoczęcia sesji. Stoi tuż nad „Zakończ trening", bo to
         jedyna chwila, w której czas trwania coś zmienia. Tekst odświeża
         osobny interwał — tutaj zostaje sam znacznik startu, żeby
         przerysowanie widoku nie gubiło odliczania. -->
    <section class="karta czas-treningu" data-start-treningu="${esc(trening.sesja.start_ts)}">
      <span class="etykieta">Czas treningu</span>
      <span class="odliczanie">${trwanieWTekscie(sekundOd(trening.sesja.start_ts))}</span>
    </section>

    <div class="przyciski">
      <button class="przycisk pelny duzy" id="zakoncz-trening">Zakończ trening</button>
    </div>`;
}

// === Ekran: Plany treningowe ============================================

const DNI_TYGODNIA = [
  "",
  "poniedziałek",
  "wtorek",
  "środa",
  "czwartek",
  "piątek",
  "sobota",
  "niedziela",
];

/** Cel ćwiczenia w planie: „3 serie po 10 @ 60 kg". */
function celCwiczeniaWPlanie(c) {
  return [
    c.serie_cel ? `${c.serie_cel} serie` : null,
    c.powt_cel ? `po ${esc(c.powt_cel)}` : null,
    c.czas_cel_s ? `${c.czas_cel_s} s` : null,
    c.dystans_cel_m ? `${(c.dystans_cel_m / 1000).toFixed(2)} km` : null,
    c.ciezar_cel_kg ? `@ ${c.ciezar_cel_kg} kg` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function dzienWPlanie(dzien) {
  const cwiczenia = dzien.cwiczenia.length
    ? `<ol>${dzien.cwiczenia
        .map((c) => {
          const cel = celCwiczeniaWPlanie(c);
          return `<li>${esc(c.nazwa)}${cel ? ` <span class="cel">— ${cel}</span>` : ""}</li>`;
        })
        .join("")}</ol>`
    : '<div class="pusto">Dzień bez ćwiczeń.</div>';

  return `
    <div class="dzien-planu">
      <div class="tytul">
        <span class="nazwa">${esc(dzien.kod)} — ${esc(dzien.nazwa)}</span>
        <span class="kiedy">${dzien.dzien_tygodnia ? DNI_TYGODNIA[dzien.dzien_tygodnia] : "bez stałego dnia"}</span>
      </div>
      ${cwiczenia}
    </div>`;
}

/**
 * Zakładka z planami. Tylko do czytania i do przełączania domyślnego —
 * plany dyktuje się Claude'owi jednym zdaniem, więc edycja z telefonu
 * kosztowałaby więcej, niż daje.
 */
function ekranPlany(plany) {
  if (!plany.length) {
    return `<section class="karta">
      <h2>Plany treningowe</h2>
      <div class="pusto">
        Nie masz jeszcze żadnego planu. Podyktuj go Claude'owi — zapisze go sam.
      </div>
    </section>`;
  }

  return plany
    .map(
      (p) => `
      <section class="karta">
        <div class="plan-naglowek">
          <span class="nazwa">${esc(p.nazwa)}</span>
          ${p.domyslny ? '<span class="odznaka">domyślny</span>' : ""}
        </div>
        ${p.opis ? `<div class="poprzednio">${esc(p.opis)}</div>` : ""}
        ${
          p.dni.length
            ? p.dni.map(dzienWPlanie).join("")
            : '<div class="pusto">Plan bez dni treningowych.</div>'
        }
        ${
          p.domyslny
            ? '<div class="pusto">Ten plan rządzi harmonogramem tygodnia.</div>'
            : `<div class="przyciski">
                 <button class="przycisk pelny" data-plan-domyslny="${esc(p.nazwa)}">
                   Ustaw jako domyślny
                 </button>
               </div>`
        }
      </section>`,
    )
    .join("");
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

const TYTULY = {
  dzis: "Dziś",
  trening: "Trening",
  postepy: "Postępy",
  raporty: "Raporty",
  plany: "Plany",
  dieta: "Dieta",
  aktywnosci: "Aktywności",
  notatki: "Notatki",
};

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
    // Ruch przyszedł razem z dniem jedną odpowiedzią, ale nakładka jest osobna —
    // sumy makro i sumy kilometrów nie mają ze sobą nic wspólnego.
    stan.dzien.aktywnosci = nalozNaAktywnosci(dzien.aktywnosci ?? [], kolejka, dzien.data);
    stan.dzien.treningi = nalozNaTreningi(dzien.treningi ?? [], kolejka);
    stan.czeste = czeste;
    dataEkranu.textContent = stan.dzien.data;
    widok.innerHTML = ekranDzis(stan.dzien, czeste);
    return;
  }

  if (ekran === "trening") {
    const [trening, plany, zdrowie] = await Promise.all([
      api("/trening"),
      api("/plany"),
      fetch("/zdrowie").then((o) => o.json()),
    ]);

    // Dzień tygodnia liczony z daty serwera, żeby nie zależeć od zegara telefonu.
    const numerDnia = ((new Date(`${zdrowie.dzisiaj}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

    // Nakładka szuka dnia po id, więc dostaje dni ze wszystkich planów naraz.
    const wszystkieDni = plany.flatMap((p) => p.dni);
    const stanTreningu = nalozNaTrening(trening, kolejka, wszystkieDni);
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
    widok.innerHTML = ekranTrening(stanTreningu, plany, numerDnia);

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

  if (ekran === "plany") {
    const plany = await api("/plany");
    dataEkranu.textContent = plany.length ? `${plany.length} pl.` : "";
    widok.innerHTML = ekranPlany(plany);
    return;
  }

  if (ekran === "dieta") {
    // Rosnące okno zamiast doklejania stron: odswiez() po każdej akcji
    // odtwarza cały widok i doklejone strony by przepadały — a edycja posiłku
    // sprzed trzech tygodni zwijałaby listę z powrotem do pierwszej.
    const historia = await api(`/dieta?dni=${14 * stronDiety}`);
    // Nakładka per dzień: poprawki i usunięcia z kolejki widać jak na Dziś.
    // Posiłek dodany offline do dnia bez żadnego wpisu z serwera pojawi się
    // tu dopiero po wysyłce — ekran Dziś pokazuje go od razu.
    stan.dieta = { ...historia, dni: historia.dni.map((d) => nalozNaDzien(d, kolejka)) };
    dataEkranu.textContent = `${14 * stronDiety} dni`;
    widok.innerHTML = ekranDieta(stan.dieta, rozwinietyDzien, edytowanyPosilek, dzisiajData);
    return;
  }

  if (ekran === "aktywnosci") {
    // Rosnące okno jak przy diecie — doklejane strony przepadałyby przy każdym
    // odswiez(), a poprawka wpisu sprzed miesiąca zwijałaby listę do początku.
    const historia = await api(`/aktywnosci?dni=${14 * stronAktywnosci}`);
    stan.aktywnosci = {
      ...historia,
      dni: historia.dni.map((d) => nalozNaDzienRuchu(d, kolejka)),
    };
    dataEkranu.textContent = `${14 * stronAktywnosci} dni`;
    widok.innerHTML = ekranAktywnosci(
      stan.aktywnosci,
      rozwinietyDzienAktywnosci,
      edytowanaAktywnosc,
      dzisiajData,
    );
    return;
  }

  if (ekran === "notatki") {
    // Komplet folderów jednym żądaniem — porcja rośnie od „Pokaż starsze",
    // tak jak okno diety, i z tego samego powodu: odswiez() po każdej akcji
    // odtwarza widok od zera, więc doklejane strony by przepadały.
    const historia = await api(`/notatki?ile=${30 * stronNotatek}`);
    stan.notatki = { ...historia, foldery: nalozNaNotatki(historia.foldery, kolejka) };

    const wszystkich = stan.notatki.foldery.reduce((suma, f) => suma + f.ile, 0);
    dataEkranu.textContent = wszystkich ? `${wszystkich} szt.` : "";
    widok.innerHTML = ekranNotatki(stan.notatki, otwartyFolder, otwartaNotatka, dzisiajData);
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
  // na Trening otwierałby ćwiczenie sprzed kwadransa zamiast listy. Z folderem
  // notatek jest dokładnie tak samo.
  otwarteCwiczenie = null;
  otwartyFolder = null;
  otwartaNotatka = null;

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
    // Wejście z menu zaczyna zakładkę od stanu wyjściowego — rozwinięcia
    // i otwarte formularze sprzed kwadransa byłyby tylko zaskoczeniem.
    wybranyRaport = null;
    rozwinietyDzien = null;
    stronDiety = 1;
    edytowanyPosilek = null;
    rozwinietyDzienAktywnosci = null;
    stronAktywnosci = 1;
    edytowanaAktywnosc = null;
    stronNotatek = 1;
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

// Szuflada słucha też palca: pociągnięcie od lewej krawędzi wysuwa ją,
// pociągnięcie w lewo na otwartej — chowa. Panel podąża za palcem,
// a o wyniku rozstrzyga, czy minął jedną trzecią swojej szerokości.

const panelMenu = menu?.querySelector("aside");
const KRAWEDZ_GESTU = 32;
let gest = null;

function przesunPanel(przesuniecie, szerokosc) {
  panelMenu.style.transform = `translateX(${przesuniecie}px)`;
  menu.style.opacity = String(1 + przesuniecie / szerokosc);
}

function dosunPanel(otworzyc, szerokosc) {
  menu.classList.remove("przeciaganie");

  if (otworzyc) {
    panelMenu.style.transform = "";
    menu.style.opacity = "";
    przelaczMenu(true);
    return;
  }

  // hidden dopiero po dojechaniu panelu do krawędzi — natychmiastowe
  // schowanie ucinałoby animację w miejscu, w którym palec puścił.
  let sprzatniete = false;
  const sprzatnij = () => {
    if (sprzatniete) return;
    sprzatniete = true;
    przelaczMenu(false);
    panelMenu.style.transform = "";
    menu.style.opacity = "";
  };
  panelMenu.addEventListener("transitionend", sprzatnij, { once: true });
  // Panel stojący już u celu nie wyśle transitionend — bez zapasowego
  // timera niewidoczne tło zostałoby na wierzchu i łapało stuknięcia.
  setTimeout(sprzatnij, 300);
  requestAnimationFrame(() => przesunPanel(-szerokosc, szerokosc));
}

document.addEventListener(
  "touchstart",
  (zdarzenie) => {
    if (!menu || !panelMenu || zdarzenie.touches.length !== 1) return;
    const { clientX, clientY } = zdarzenie.touches[0];
    const otwieranie = menu.hidden;
    if (otwieranie && clientX > KRAWEDZ_GESTU) return;
    gest = { startX: clientX, startY: clientY, otwieranie, aktywny: false, szerokosc: 0 };
  },
  { passive: true },
);

document.addEventListener(
  "touchmove",
  (zdarzenie) => {
    if (!gest) return;
    const { clientX, clientY } = zdarzenie.touches[0];
    const dx = clientX - gest.startX;

    if (!gest.aktywny) {
      const dy = clientY - gest.startY;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Ruch bardziej pionowy to przewijanie, a poziomy w złą stronę
      // to nie gest szuflady — oba oddajemy przeglądarce.
      const zlyKierunek = gest.otwieranie ? dx <= 0 : dx >= 0;
      if (Math.abs(dy) > Math.abs(dx) || zlyKierunek) {
        gest = null;
        return;
      }
      if (gest.otwieranie) menu.hidden = false;
      menu.classList.add("przeciaganie");
      gest.aktywny = true;
      gest.szerokosc = panelMenu.offsetWidth;
    }

    // Bez tego strona przewijałaby się równolegle z ciągniętą szufladą.
    zdarzenie.preventDefault();
    const cel = gest.otwieranie ? dx - gest.szerokosc : dx;
    przesunPanel(Math.min(0, Math.max(-gest.szerokosc, cel)), gest.szerokosc);
  },
  { passive: false },
);

function zakonczGest(zdarzenie) {
  if (!gest) return;
  const { startX, otwieranie, aktywny, szerokosc } = gest;
  gest = null;
  if (!aktywny) return;

  const dx = zdarzenie.changedTouches[0].clientX - startX;
  dosunPanel(otwieranie ? dx > szerokosc / 3 : dx > -szerokosc / 3, szerokosc);
}

document.addEventListener("touchend", zakonczGest);
document.addEventListener("touchcancel", zakonczGest);

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

  // Ten sam wzorzec dla dnia diety: przerysowanie z pamięci, ponowne
  // stuknięcie zwija.
  const naglowekDnia = cel.closest("[data-dzien-diety]");
  if (naglowekDnia) {
    const data = naglowekDnia.dataset.dzienDiety;
    rozwinietyDzien = rozwinietyDzien === data ? null : data;
    edytowanyPosilek = null;
    widok.innerHTML = ekranDieta(stan.dieta, rozwinietyDzien, edytowanyPosilek, dzisiajData);
    return;
  }

  const starszeDiety = cel.closest("[data-starsze-diety]");
  if (starszeDiety) {
    stronDiety += 1;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  // Atrybut nazywa się dzien-aktywnosci, nie dzien — goły data-dzien wpadałby
  // w handler paska dat z ekranu Dziś i sypał RangeError z przesunDate.
  const naglowekAktywnosci = cel.closest("[data-dzien-aktywnosci]");
  if (naglowekAktywnosci) {
    const data = naglowekAktywnosci.dataset.dzienAktywnosci;
    rozwinietyDzienAktywnosci = rozwinietyDzienAktywnosci === data ? null : data;
    edytowanaAktywnosc = null;
    widok.innerHTML = ekranAktywnosci(
      stan.aktywnosci,
      rozwinietyDzienAktywnosci,
      edytowanaAktywnosc,
      dzisiajData,
    );
    return;
  }

  const starszeAktywnosci = cel.closest("[data-starsze-aktywnosci]");
  if (starszeAktywnosci) {
    stronAktywnosci += 1;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const edytujAktywnosc = cel.closest("[data-edytuj-aktywnosc]");
  if (edytujAktywnosc) {
    const id = Number(edytujAktywnosc.dataset.edytujAktywnosc);
    edytowanaAktywnosc = edytowanaAktywnosc === id ? null : id;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  if (cel.closest("[data-anuluj-aktywnosci]")) {
    edytowanaAktywnosc = null;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const usunSesje = cel.closest("[data-usun-sesje]");
  if (usunSesje) {
    const id = Number(usunSesje.dataset.usunSesje);
    const trening =
      stan.dzien?.treningi?.find((t) => t.id === id) ??
      stan.aktywnosci?.dni.flatMap((d) => d.treningi ?? []).find((t) => t.id === id);

    // Jedyne miejsce poza odhaczaniem całego ćwiczenia, które o coś pyta —
    // i jedyne bez „Cofnij": odtworzenie sesji razem z seriami byłoby osobną
    // ścieżką zapisu, a stuknięcie kasuje naraz cały trening.
    const ile = trening?.serie_lacznie ?? 0;
    const seriami = ile === 1 ? "1 zapisaną serią" : `${ile} zapisanymi seriami`;
    if (!confirm(`Usunąć ten trening razem z ${seriami}? Tego nie da się cofnąć.`)) return;

    akcjaPrzycisku(
      usunSesje,
      () => api("/wpis", { method: "POST", dane: { typ: "sesja", id, akcja: "usun" } }),
      "Usunięto trening",
    );
    return;
  }

  const usunAktywnosc = cel.closest("[data-usun-aktywnosc]");
  if (usunAktywnosc) {
    const id = Number(usunAktywnosc.dataset.usunAktywnosc);
    // Treść zapamiętana przed skasowaniem — inaczej „Cofnij" nie miałoby czego
    // przywrócić. Wpis wraca z nowym id, jak przy posiłku.
    ostatnioUsunietaAktywnosc =
      stan.dzien?.aktywnosci?.find((a) => a.id === id) ??
      stan.aktywnosci?.dni.flatMap((d) => d.aktywnosci).find((a) => a.id === id) ??
      null;
    edytowanaAktywnosc = null;

    akcja(async () => {
      await api("/wpis", { method: "POST", dane: { typ: "aktywnosc", id, akcja: "usun" } });
      const wrocDo = ostatnioUsunietaAktywnosc;
      if (!wrocDo) return;

      komunikat(`Usunięto „${wrocDo.dyscyplina}”`, false, () =>
        akcja(
          () =>
            api("/aktywnosci", {
              method: "POST",
              dane: {
                dyscyplina: wrocDo.dyscyplina,
                dystans_m: wrocDo.dystans_m ?? undefined,
                czas_s: wrocDo.czas_s ?? undefined,
                rpe: wrocDo.rpe ?? undefined,
                notatka: wrocDo.notatka ?? undefined,
                czas: `${wrocDo.data_lokalna} ${wrocDo.godzina}`,
              },
            }),
          "Przywrócono",
        ),
      );
    });
    return;
  }

  // Wejście do folderu i rozwinięcie notatki przerysowują widok z pamięci,
  // bez żądania — cała porcja przyszła jednym zapytaniem, więc czytanie
  // dziennika działa też bez zasięgu.
  const folder = cel.closest("[data-folder]");
  if (folder) {
    otwartyFolder = folder.dataset.folder;
    otwartaNotatka = null;
    widok.innerHTML = ekranNotatki(stan.notatki, otwartyFolder, otwartaNotatka, dzisiajData);
    return;
  }

  if (cel.closest("[data-zamknij-folder]")) {
    otwartyFolder = null;
    otwartaNotatka = null;
    widok.innerHTML = ekranNotatki(stan.notatki, otwartyFolder, otwartaNotatka, dzisiajData);
    return;
  }

  const notatka = cel.closest("[data-notatka]");
  if (notatka) {
    // Id tekstem, nie liczbą: notatka czekająca w kolejce ma id „oczekuje-3".
    const id = notatka.dataset.notatka;
    otwartaNotatka = otwartaNotatka === id ? null : id;
    widok.innerHTML = ekranNotatki(stan.notatki, otwartyFolder, otwartaNotatka, dzisiajData);
    return;
  }

  const starszeNotatek = cel.closest("[data-starsze-notatek]");
  if (starszeNotatek) {
    stronNotatek += 1;
    odswiez().catch((blad) => komunikat(blad.message, true));
    return;
  }

  const usunNotatke = cel.closest("[data-usun-notatke]");
  if (usunNotatke) {
    const id = Number(usunNotatke.dataset.usunNotatke);
    // Treść zapamiętana przed skasowaniem — inaczej „Cofnij" nie miałoby czego
    // przywrócić. Wraca też surowa transkrypcja: to ona jest zapisem prawdy
    // i omyłkowe stuknięcie w ✕ nie może jej zabrać.
    ostatnioUsunietaNotatka =
      stan.notatki?.foldery.flatMap((f) => f.notatki).find((n) => n.id === id) ?? null;
    otwartaNotatka = null;

    akcja(async () => {
      await api("/wpis", { method: "POST", dane: { typ: "notatka", id, akcja: "usun" } });
      const wrocDo = ostatnioUsunietaNotatka;
      if (!wrocDo) return;

      komunikat("Usunięto notatkę", false, () =>
        akcja(
          () =>
            api("/notatki", {
              method: "POST",
              dane: {
                tresc: wrocDo.tresc,
                kategoria: wrocDo.kategoria,
                tytul: wrocDo.tytul ?? undefined,
                surowe_wejscie: wrocDo.surowe_wejscie ?? undefined,
                czas: `${wrocDo.data_lokalna} ${wrocDo.godzina}`,
              },
            }),
          "Przywrócono",
        ),
      );
    });
    return;
  }

  // Edytor składników: wiersze dodaje i usuwa się lokalnie, bez wysyłki —
  // zapis idzie dopiero z całym formularzem poprawki.
  const dodajWiersz = cel.closest("[data-dodaj-wiersz]");
  if (dodajWiersz) {
    dodajWiersz.insertAdjacentHTML("beforebegin", szablonWiersza());
    return;
  }

  const usunWiersz = cel.closest("[data-usun-wiersz]");
  if (usunWiersz) {
    usunWiersz.closest("[data-wiersz]")?.remove();
    return;
  }

  const pokaz = cel.closest("[data-pokaz]");
  if (pokaz) {
    const formularz = document.getElementById(pokaz.dataset.pokaz);
    formularz.hidden = false;
    pokaz.parentElement.hidden = true;
    // Także textarea: formularz notatki nie ma ani jednego pola input,
    // a kursor ma stanąć od razu tam, gdzie się pisze.
    formularz.querySelector("input, textarea")?.focus();
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

  const planDomyslny = cel.closest("[data-plan-domyslny]");
  if (planDomyslny) {
    akcjaPrzycisku(
      planDomyslny,
      () =>
        api("/plan/domyslny", {
          method: "POST",
          dane: { plan: planDomyslny.dataset.planDomyslny },
        }),
      "Zmieniono plan domyślny",
    );
    return;
  }

  if (cel.closest("[data-start-bez-planu]")) {
    akcja(() => api("/trening/start", { method: "POST", dane: { bez_planu: true } }));
    return;
  }

  const start = cel.closest("[data-start-dzien]");
  if (start) {
    // Po id, nie po kodzie: dwa plany mogą mieć własny dzień „A".
    const dzienId = Number(start.dataset.startDzien);
    akcja(() => api("/trening/start", { method: "POST", dane: { dzien_id: dzienId } }));
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
    // czego przywrócić. Wpis wraca z nowym id, bez pozycji i pewności;
    // miękkie usuwanie wymagałoby migracji i nie jest tego warte.
    // Na zakładce Dieta wpis szukany jest w historii, nie w dzisiejszym dniu.
    ostatnioUsuniety =
      stan.dzien?.posilki.find((p) => p.id === id) ??
      stan.dieta?.dni.flatMap((d) => d.posilki).find((p) => p.id === id) ??
      null;
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

  if (formularz.id === "formularz-aktywnosci") {
    const dane = daneAktywnosci(formularz);
    if (!dane.dyscyplina) return komunikat("Podaj, co robiłeś", true);
    if (dane.dystans_m === undefined && dane.czas_s === undefined) {
      return komunikat("Podaj dystans albo czas", true);
    }

    // Na ekranie Dziś wpis należy do oglądanego dnia — także wtedy, gdy
    // użytkownik cofnął się paskiem dat. W zakładce zawsze do dzisiaj, a datę
    // bierzemy z serwera, nie z zegara telefonu.
    const zZakladki = ekran === "aktywnosci";
    const dzien = zZakladki ? (stan.aktywnosci?.do ?? dzisiajData) : stan.dzien?.data;
    const wymuszDate = !zZakladki && Boolean(wybranaData);

    akcja(
      () =>
        api("/aktywnosci", {
          method: "POST",
          dane: { ...dane, czas: czasAktywnosci(formularz, dzien, wymuszDate) },
        }),
      "Zapisano aktywność",
      formularz,
    );
    return;
  }

  if (formularz.id === "formularz-notatki") {
    const tresc = formularz.elements.tresc.value.trim();
    if (!tresc) return komunikat("Napisz coś w notatce", true);

    // Bez `czas`: notatka wpisana z ręki powstaje teraz. Gdy leci przez kolejkę,
    // godzinę powstania dokłada sama wysyłka.
    akcja(
      () =>
        api("/notatki", {
          method: "POST",
          dane: { tresc, kategoria: formularz.elements.kategoria.value },
        }),
      "Zapisano notatkę",
      formularz,
    );
    return;
  }

  if (formularz.id.startsWith("edycja-aktywnosci-")) {
    const id = Number(formularz.dataset.aktywnosc);
    const dane = zmienioneAktywnosci(formularz);
    edytowanaAktywnosc = null;

    // Nic nie zmieniono — zamykamy formularz bez żądania, zamiast łapać
    // od serwera błąd „brak zmian".
    if (Object.keys(dane).length === 0) {
      odswiez().catch((blad) => komunikat(blad.message, true));
      return;
    }

    akcja(
      () =>
        api("/wpis", {
          method: "POST",
          dane: { typ: "aktywnosc", id, akcja: "popraw", dane },
        }),
      "Poprawiono aktywność",
      formularz,
    );
    return;
  }

  if (formularz.id.startsWith("edycja-posilku-")) {
    const id = Number(formularz.dataset.posilek);
    const dane = zmienioneMakro(formularz);
    const czas = czasEdycji(formularz);
    if (czas) dane.czas = czas;
    const pozycje = pozycjeZFormularza(formularz);
    if (pozycje !== undefined) dane.pozycje = pozycje;

    edytowanyPosilek = null;

    // Nic nie zmieniono — zamykamy formularz bez żądania, zamiast łapać
    // od serwera błąd „brak zmian".
    if (Object.keys(dane).length === 0) {
      odswiez().catch((blad) => komunikat(blad.message, true));
      return;
    }

    akcja(
      () =>
        api("/wpis", {
          method: "POST",
          dane: { typ: "posilek", id, akcja: "popraw", dane },
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
