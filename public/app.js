/**
 * Aplikacja webowa — trzy ekrany, bez frameworka.
 *
 * Priorytet ekranu treningu: wszystko ma być osiągalne kciukiem jedną ręką,
 * a dopisanie serii ma kosztować jedno stuknięcie plus ewentualną korektę
 * ciężaru. Dlatego formularz serii jest wstępnie wypełniony poprzednim wynikiem.
 */

const widok = document.getElementById("widok");
const tytulEkranu = document.getElementById("tytul-ekranu");
const dataEkranu = document.getElementById("data-ekranu");
const ekranLogowania = document.getElementById("logowanie");
const aplikacja = document.getElementById("aplikacja");

let ekran = "dzis";
let stan = {};

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

/** Opakowanie akcji: pokazuje błąd zamiast cichej porażki i odświeża widok. */
async function akcja(wykonaj, potwierdzenie) {
  try {
    await wykonaj();
    if (potwierdzenie) komunikat(potwierdzenie);
    await odswiez();
  } catch (blad) {
    komunikat(blad.message, true);
  }
}

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

// === Ekran: Dziś ========================================================

function ekranDzis(dzien) {
  const cele = dzien.cele;

  const posilki = dzien.posilki.length
    ? dzien.posilki
        .map(
          (p) => `
          <div class="wpis">
            <div class="tresc">
              <div class="naglowek">
                <span class="godzina">${esc(p.godzina)}</span>
                <span class="opis">${esc(p.opis)}</span>
                ${p.pewnosc === "szacowane" ? '<span class="znacznik">szacunek</span>' : ""}
              </div>
              <div class="szczegoly">
                ${zaokr(p.kcal)} kcal · B ${zaokr(p.bialko_g)} · W ${zaokr(p.wegle_g)} · T ${zaokr(p.tluszcz_g)}
              </div>
            </div>
            <button class="przycisk cichy" data-usun-posilek="${p.id}" aria-label="Usuń">✕</button>
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

  if (!plan.length) {
    return `<section class="karta">
      <h2>Trening</h2>
      <div class="pusto">Plan jest pusty. Podyktuj go Claude'owi — zapisze go sam.</div>
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
    </section>`;
}

function kartaCwiczenia(cwiczenie) {
  const ostatnia = cwiczenie.serie.at(-1) ?? cwiczenie.poprzednio.at(-1);
  const prefill = {
    powtorzenia: ostatnia?.powtorzenia ?? "",
    ciezar_kg: ostatnia?.ciezar_kg ?? "",
    czas_s: ostatnia?.czas_s ?? "",
    dystans_m: ostatnia?.dystans_m ?? "",
  };

  const polaTypu =
    cwiczenie.typ === "silowe"
      ? `<div><label>Powtórzenia</label><input name="powtorzenia" inputmode="numeric" value="${prefill.powtorzenia}" /></div>
         <div><label>Ciężar (kg)</label><input name="ciezar_kg" inputmode="decimal" value="${prefill.ciezar_kg}" /></div>`
      : cwiczenie.typ === "cardio"
        ? `<div><label>Czas (s)</label><input name="czas_s" inputmode="numeric" value="${prefill.czas_s}" /></div>
           <div><label>Dystans (m)</label><input name="dystans_m" inputmode="numeric" value="${prefill.dystans_m}" /></div>`
        : `<div class="szeroko"><label>Czas (s)</label><input name="czas_s" inputmode="numeric" value="${prefill.czas_s}" /></div>`;

  const idFormularza = `seria-${cwiczenie.cwiczenie_id}`;

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
              .map(
                (s) =>
                  `<span class="seria ${cwiczenie.slabsze_niz_poprzednio.includes(s.nr_serii) ? "slabsza" : ""}">
                     ${esc(seriaWTekscie(s))}
                   </span>`,
              )
              .join("")}</div>`
          : ""
      }

      ${
        cwiczenie.poprzednio.length
          ? `<div class="poprzednio">Poprzednio: ${esc(cwiczenie.poprzednio.map(seriaWTekscie).join(" · "))}</div>`
          : ""
      }

      <form id="${idFormularza}" data-cwiczenie="${esc(cwiczenie.nazwa)}" hidden>
        <div class="pola">${polaTypu}</div>
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

  if (ekran === "dzis") {
    stan.dzien = await api("/dzien");
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
    widok.innerHTML = ekranTrening(trening, plan, dzisiajKod);
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

widok.addEventListener("submit", (zdarzenie) => {
  zdarzenie.preventDefault();
  const formularz = zdarzenie.target;

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
    );
    return;
  }

  if (formularz.id.startsWith("seria-")) {
    akcja(() =>
      api("/trening/seria", {
        method: "POST",
        dane: {
          cwiczenie: formularz.dataset.cwiczenie,
          powtorzenia: liczbaZPola(formularz, "powtorzenia"),
          ciezar_kg: liczbaZPola(formularz, "ciezar_kg"),
          czas_s: liczbaZPola(formularz, "czas_s"),
          dystans_m: liczbaZPola(formularz, "dystans_m"),
        },
      }),
    );
    return;
  }

  if (formularz.id === "formularz-wagi") {
    const kg = liczbaZPola(formularz, "kg");
    if (!kg) return komunikat("Podaj wagę", true);
    akcja(() => api("/waga", { method: "POST", dane: { kg } }), "Zapisano wagę");
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
    await api("/logowanie", { method: "POST", dane: { haslo }, bezPrzekierowania: true });
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

(async () => {
  try {
    await api("/dzien");
    aplikacja.hidden = false;
    await odswiez();
  } catch {
    pokazLogowanie();
  }
})();
