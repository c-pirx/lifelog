/**
 * Aplikacja webowa — trzy ekrany, bez frameworka.
 *
 * Priorytet ekranu treningu: wszystko ma być osiągalne kciukiem jedną ręką,
 * a dopisanie serii ma kosztować jedno stuknięcie plus ewentualną korektę
 * ciężaru. Dlatego formularz serii jest wstępnie wypełniony poprzednim wynikiem.
 */

import { dodajDoKolejki, wpisyKolejki, wyslijKolejke } from "./kolejka.js";
import { nalozNaDzien, nalozNaTrening } from "./nakladka.js";

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

function komunikat(tekst, czyBlad = false) {
  document.querySelector(".komunikat")?.remove();
  clearTimeout(uchwytKomunikatu);

  const element = document.createElement("div");
  element.className = czyBlad ? "komunikat blad" : "komunikat";
  element.textContent = tekst;
  document.body.append(element);

  uchwytKomunikatu = setTimeout(() => element.remove(), czyBlad ? 5000 : 2500);
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

const liczbaZPola = (formularz, nazwa) => {
  const wartosc = formularz.elements[nazwa]?.value?.replace(",", ".").trim();
  return wartosc ? Number(wartosc) : undefined;
};

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

function ekranDzis(dzien) {
  const cele = dzien.cele;

  const posilki = dzien.posilki.length
    ? dzien.posilki
        .map(
          (p) => `
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
              // Wpis bez id z bazy nie ma czego usuwać — kasowanie wróci,
              // gdy kolejka go wyśle.
              p.oczekuje
                ? ""
                : `<button class="przycisk cichy" data-usun-posilek="${p.id}" aria-label="Usuń">✕</button>`
            }
          </div>`,
        )
        .join("")
    : '<div class="pusto">Nic jeszcze nie zapisano.</div>';

  return `
    <section class="karta">
      <h2>Bilans dnia</h2>
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
        <div class="pola">
          <div class="szeroko">
            <label for="opis">Co zjadłeś</label>
            <input id="opis" name="opis" required autocomplete="off" />
          </div>
          <div>
            <label for="kcal">Kalorie</label>
            <input id="kcal" name="kcal" inputmode="decimal" required />
          </div>
          <div>
            <label for="bialko">Białko (g)</label>
            <input id="bialko" name="bialko_g" inputmode="decimal" />
          </div>
          <div>
            <label for="wegle">Węgle (g)</label>
            <input id="wegle" name="wegle_g" inputmode="decimal" />
          </div>
          <div>
            <label for="tluszcz">Tłuszcz (g)</label>
            <input id="tluszcz" name="tluszcz_g" inputmode="decimal" />
          </div>
        </div>
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

function kartaCwiczenia(cwiczenie) {
  const ostatnia = cwiczenie.serie.at(-1) ?? cwiczenie.poprzednio.at(-1);
  const idFormularza = `seria-${cwiczenie.cwiczenie_id}`;
  const wPoprawce = cwiczenie.serie.find((s) => s.id === edytowanaSeria);

  return `
    <div class="cwiczenie ${cwiczenie.ukonczone ? "zrobione" : ""}">
      <div class="tytul">
        <span class="nazwa">${cwiczenie.ukonczone ? "✓ " : ""}${esc(cwiczenie.nazwa)}</span>
        <span class="licznik">
          ${cwiczenie.serie_zrobione}${cwiczenie.serie_cel ? `/${cwiczenie.serie_cel}` : ""}
          ${cwiczenie.powt_cel ? ` × ${esc(cwiczenie.powt_cel)}` : ""}
        </span>
      </div>

      ${
        cwiczenie.serie.length
          ? `<div class="serie">${cwiczenie.serie
              .map((s) =>
                // Seria czekająca w kolejce nie ma jeszcze id w bazie, więc nie
                // ma czego poprawiać — zostaje etykietą do czasu wysłania.
                s.oczekuje
                  ? `<span class="seria oczekuje">⏳ ${esc(seriaWTekscie(s))}</span>`
                  : `<button type="button" data-edytuj-serie="${s.id}"
                       class="seria ${cwiczenie.slabsze_niz_poprzednio.includes(s.nr_serii) ? "slabsza" : ""} ${s.id === edytowanaSeria ? "edytowana" : ""}">
                       ${esc(seriaWTekscie(s))}
                     </button>`,
              )
              .join("")}</div>`
          : ""
      }

      ${wPoprawce ? formularzPoprawkiSerii(cwiczenie.typ, wPoprawce) : ""}

      ${
        cwiczenie.poprzednio.length
          ? `<div class="poprzednio">Poprzednio: ${esc(cwiczenie.poprzednio.map(seriaWTekscie).join(" · "))}</div>`
          : ""
      }

      <form id="${idFormularza}" data-cwiczenie="${esc(cwiczenie.nazwa)}" hidden>
        <!-- Ciężar i powtórzenia z poprzedniej serii, ale RPE już nie:
             trudność jest oceną tej konkretnej serii, a podpowiedziana
             po cichu zapisałaby się jako prawdziwa. -->
        <div class="pola">${polaSerii(cwiczenie.typ, wartosciSerii({ ...ostatnia, rpe: null }))}</div>
        <div class="przyciski">
          <button class="przycisk glowny" type="submit">Zapisz serię</button>
          <button class="przycisk" type="button" data-anuluj="${idFormularza}">Anuluj</button>
        </div>
      </form>
      <div class="przyciski">
        <button class="przycisk pelny" data-pokaz="${idFormularza}">+ Seria</button>
      </div>
    </div>`;
}

function ekranTrening(trening, plan, dzisiajKod) {
  if (!trening.sesja) return kartaBezSesji(plan, dzisiajKod);

  const wszystkie = [...trening.wg_planu, ...trening.poza_planem];

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
      ${wszystkie.map(kartaCwiczenia).join("")}
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

function ekranPostepy(postepy, waga) {
  const ostatnia = waga.ostatnia;
  const trend = waga.trend.slice(-14).reverse();

  const dni = postepy.dni.slice(-14).reverse();
  const maks = Math.max(...dni.map((d) => Math.max(d.kcal, d.cel_kcal ?? 0)), 1);

  return `
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
        trend.length
          ? `<div style="margin-top:14px">${trend
              .map(
                (p) => `
              <div class="wpis">
                <div class="tresc">
                  <div class="naglowek">
                    <span class="godzina">${esc(p.data)}</span>
                    <span class="opis">${p.kg} kg</span>
                  </div>
                  <div class="szczegoly">średnia 7 dni: ${p.srednia_7d} kg</div>
                </div>
              </div>`,
              )
              .join("")}</div>`
          : '<div class="pusto">Brak pomiarów.</div>'
      }
    </section>

    <section class="karta">
      <h2>Kalorie — ostatnie dni</h2>
      ${
        dni.length
          ? dni
              .map(
                (d) => `
          <div class="makro">
            <div class="etykieta">
              <span>${esc(d.data)}</span>
              <span><b>${zaokr(d.kcal)}</b> <span class="cel">/ ${d.cel_kcal ? zaokr(d.cel_kcal) : "—"} kcal</span></span>
            </div>
            <div class="pasek ${d.cel_kcal && d.kcal > d.cel_kcal ? "przekroczony" : ""}">
              <span style="width:${Math.min(100, (d.kcal / maks) * 100)}%"></span>
            </div>
          </div>`,
              )
              .join("")
          : '<div class="pusto">Brak danych.</div>'
      }
    </section>`;
}

// === Renderowanie i odświeżanie ========================================

const TYTULY = { dzis: "Dziś", trening: "Trening", postepy: "Postępy" };

async function odswiez() {
  tytulEkranu.textContent = TYTULY[ekran];
  const kolejka = await pokazStanSieci();

  if (ekran === "dzis") {
    stan.dzien = nalozNaDzien(await api("/dzien"), kolejka);
    dataEkranu.textContent = stan.dzien.data;
    widok.innerHTML = ekranDzis(stan.dzien);
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

    dataEkranu.textContent = zdrowie.dzisiaj;
    widok.innerHTML = ekranTrening(nalozNaTrening(trening, kolejka, plan), plan, dzisiajKod);
    return;
  }

  const [postepy, waga] = await Promise.all([api("/postepy?dni=30"), api("/waga?dni=30")]);
  dataEkranu.textContent = "30 dni";
  widok.innerHTML = ekranPostepy(postepy, waga);
}

// === Obsługa zdarzeń ====================================================

document.querySelector("nav")?.addEventListener("click", (zdarzenie) => {
  const przycisk = zdarzenie.target.closest("button[data-ekran]");
  if (!przycisk) return;

  ekran = przycisk.dataset.ekran;
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.removeAttribute("aria-current"));
  przycisk.setAttribute("aria-current", "page");

  odswiez().catch((blad) => komunikat(blad.message, true));
});

widok.addEventListener("click", (zdarzenie) => {
  const cel = zdarzenie.target;

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
    const formularz = document.getElementById(anuluj.dataset.anuluj);
    formularz.hidden = true;
    formularz.nextElementSibling.hidden = false;
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

  const usun = cel.closest("[data-usun-posilek]");
  if (usun) {
    akcja(
      () =>
        api("/wpis", {
          method: "POST",
          dane: { typ: "posilek", id: Number(usun.dataset.usunPosilek), akcja: "usun" },
        }),
      "Usunięto",
    );
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
          dane: {
            opis: formularz.elements.opis.value,
            kcal: liczbaZPola(formularz, "kcal") ?? 0,
            bialko_g: liczbaZPola(formularz, "bialko_g"),
            wegle_g: liczbaZPola(formularz, "wegle_g"),
            tluszcz_g: liczbaZPola(formularz, "tluszcz_g"),
          },
        }),
      "Zapisano posiłek",
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
