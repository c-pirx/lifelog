/**
 * Widok tygodnia: panel na ekranie Postępy i archiwum raportów.
 *
 * Osobny plik, bo app.js robi już wystarczająco dużo — a te funkcje są czyste
 * (bez DOM, bez sieci), więc dają się objąć testami tak samo jak nakladka.js.
 *
 * Świadomie NIE liczą niczego domenowego. Werdykty „na kursie" i „idzie lepiej"
 * przychodzą gotowe z serwera (`domain/raporty.ts`) — tutaj zostaje wyłącznie
 * dobór słów i kolorów. Gdyby ocena powstawała tu, czat i aplikacja mogłyby
 * ocenić ten sam tydzień inaczej.
 */

const esc = (tekst) =>
  String(tekst ?? "").replace(
    /[&<>"']/g,
    (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z],
  );

const zaokr = (liczba) => Math.round(Number(liczba) || 0);

const zeZnakiem = (n) => (n > 0 ? `+${zaokr(n)}` : String(zaokr(n)));

const MIESIACE = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** „23 sierpnia" — data bez roku, bo tydzień zawsze jest niedaleko. */
function dzienIMiesiac(data) {
  const [, miesiac, dzien] = String(data).split("-");
  const nazwa = MIESIACE[Number(miesiac) - 1];
  return nazwa ? `${Number(dzien)} ${nazwa}` : esc(data);
}

export function zakresTygodnia(od, doDaty) {
  return `${dzienIMiesiac(od)} – ${dzienIMiesiac(doDaty)}`;
}

/** Polska odmiana po liczbie: 1 seria, 2 serie, 5 serii. Zero idzie z „wiele". */
function mnoga(n, jeden, kilka, wiele) {
  const ile = Math.abs(zaokr(n));
  if (ile === 1) return jeden;
  const reszta = ile % 100;
  const jednosci = ile % 10;
  return jednosci >= 2 && jednosci <= 4 && (reszta < 12 || reszta > 14) ? kilka : wiele;
}

/**
 * Kafelek liczby. Trzeci wiersz jest opcjonalny i mówi, skąd liczba się bierze
 * — bez niego „2/3" wymaga wiedzy, której użytkownik nie ma skąd wziąć.
 */
function kafelek(wartosc, podpis, wyjasnienie) {
  return `<li><b>${wartosc}</b><span>${esc(podpis)}</span>${
    wyjasnienie ? `<small>${esc(wyjasnienie)}</small>` : ""
  }</li>`;
}

/** Wiersz porównania z poprzednim tygodniem. Kolor bierze się z oceny serwera. */
function wierszZmiany(zmiana, podpis) {
  if (!zmiana) return "";

  const czesci = [
    `${zeZnakiem(zmiana.kcal_dziennie)} kcal dziennie`,
    `${zeZnakiem(zmiana.dni_w_celu)} ${mnoga(zmiana.dni_w_celu, "dzień", "dni", "dni")} w celu`,
    `${zeZnakiem(zmiana.serie)} ${mnoga(zmiana.serie, "seria", "serie", "serii")}`,
  ];
  if (zmiana.waga_kg !== null && zmiana.waga_kg !== undefined) {
    czesci.push(`${zmiana.waga_kg > 0 ? "+" : ""}${zmiana.waga_kg} kg`);
  }

  const strzalka = { lepiej: "▲", gorzej: "▼", podobnie: "▬" }[zmiana.ocena] ?? "▬";

  return `
    <p class="zmiana ${esc(zmiana.ocena)}">
      <span class="strzalka" aria-hidden="true">${strzalka}</span>
      <span><b>${esc(zmiana.ocena)}</b> ${esc(podpis)}: ${czesci.join(" · ")}</span>
    </p>`;
}

function pasekPrognozy(prognoza) {
  const cel = prognoza.cel_tygodnia?.kcal;
  if (!cel) return "";

  const procent = Math.min(140, (prognoza.na_koniec.kcal / cel) * 100);

  return `
    <div class="prognoza">
      <div class="etykieta">
        <span>Prognoza tygodnia</span>
        <span><b>${zaokr(prognoza.na_koniec.kcal)}</b> <span class="cel">/ ${zaokr(cel)} kcal</span></span>
      </div>
      <div class="pasek ${prognoza.na_kursie ? "na-kursie" : "poza-kursem"}">
        <span style="width:${Math.min(100, procent)}%"></span>
      </div>
    </div>`;
}

/** Zdanie werdyktu — to, po co użytkownik w ogóle wchodzi na ten ekran. */
function werdykt(prognoza, dniZamkniete) {
  if (!prognoza.cel_tygodnia) {
    return `<p class="werdykt">Przy tym tempie tydzień zamknie się na
      <b>${zaokr(prognoza.na_koniec.kcal)} kcal</b>. Ustaw cele, żeby zobaczyć, czy to dowozi plan.</p>`;
  }

  const roznica = zaokr(prognoza.roznica.kcal);
  const kierunek = roznica > 0 ? "ponad cel" : "poniżej celu";
  const zrodlo = `z ${dniZamkniete} ${dniZamkniete === 1 ? "zamkniętego dnia" : "zamkniętych dni"}`;

  return `
    <p class="werdykt ${prognoza.na_kursie ? "na-kursie" : "poza-kursem"}">
      ${
        prognoza.na_kursie
          ? "Tempo się trzyma."
          : `Przy tym tempie celu nie dowieziesz — ${Math.abs(roznica)} kcal ${kierunek}.`
      }
      Tydzień zamknie się na <b>${zaokr(prognoza.na_koniec.kcal)} kcal</b>
      wobec ${zaokr(prognoza.cel_tygodnia.kcal)} kcal celu <span class="cel">(${zrodlo})</span>.
    </p>`;
}

/**
 * Panel bieżącego tygodnia na ekranie Postępy.
 *
 * Stoi nad wykresami 30-dniowymi celowo: wykres mówi, dokąd zmierzasz przez
 * miesiąc, a ten panel — czy dzisiejszy tydzień jeszcze da się uratować.
 */
export function panelTygodnia(tydzien) {
  if (!tydzien) return "";

  const { dieta, trening, prognoza, zmiana, dni_zamkniete: zamkniete } = tydzien;

  // Odpowiedź spod cache'u service workera może być sprzed wdrożenia tych pól —
  // wtedy kafelki wracają do starej arytmetyki zamiast pokazać „undefined".
  const cel = tydzien.cel_kcal ?? { trafione: dieta.dni_w_celu, dni_za_nami: dieta.dni_z_zapisem };
  const plan = tydzien.plan ?? { zrobione: trening.sesje, zaplanowane: trening.sesje_w_planie };

  return `
    <section class="karta tydzien">
      <h2>Ten tydzień</h2>
      <p class="cel zakres">${zakresTygodnia(tydzien.tydzien_od, tydzien.tydzien_do)} ·
        ${cel.dni_za_nami} z 7 dni tygodnia</p>

      ${
        prognoza
          ? `${werdykt(prognoza, zamkniete)}${pasekPrognozy(prognoza)}`
          : `<p class="werdykt">${
              zamkniete === 0
                ? "Tydzień dopiero się zaczął — prognoza pojawi się po pierwszym zamkniętym dniu."
                : "Z zamkniętych dni tego tygodnia nie ma zapisów, więc nie ma z czego liczyć tempa."
            }</p>`
      }

      <ul class="liczby">
        ${kafelek(
          zaokr(dieta.srednie.kcal),
          "śr. kcal / dzień",
          `z ${zamkniete} ${mnoga(zamkniete, "zamkniętego dnia", "zamkniętych dni", "zamkniętych dni")}`,
        )}
        ${kafelek(`${cel.trafione}/${cel.dni_za_nami}`, "dni w celu", "±5% od celu kcal")}
        ${kafelek(
          `${plan.zrobione}/${plan.zaplanowane}`,
          "treningi z planu",
          "dni planu do dziś",
        )}
        ${kafelek(zaokr(trening.objetosc_kg), "kg objętości", "powtórzenia × ciężar")}
      </ul>

      ${wierszZmiany(zmiana, "niż o tej porze tydzień temu")}

      ${
        prognoza && prognoza.dzis.kcal > 0
          ? `<p class="cel">Dzisiaj w toku: ${zaokr(prognoza.dzis.kcal)} kcal —
             do dni w celu liczy się już teraz, do średniej i prognozy wejdzie jutro.</p>`
          : ""
      }
    </section>`;
}

function kartaRaportu(raport, rozwiniety) {
  const { dieta, waga, trening } = raport;

  const szczegoly = `
    <ul class="liczby">
      ${kafelek(zaokr(dieta.srednie.kcal), "kcal / dzień")}
      ${kafelek(`${dieta.dni_w_celu}/${dieta.dni_z_zapisem}`, "dni w celu")}
      ${kafelek(`${trening.sesje}${trening.sesje_w_planie ? `/${trening.sesje_w_planie}` : ""}`, "sesje")}
      ${kafelek(zaokr(trening.objetosc_kg), "kg objętości")}
    </ul>
    ${
      waga.start !== null && waga.koniec !== null
        ? `<p class="cel">Waga (średnia krocząca): ${waga.start} → ${waga.koniec} kg${
            waga.zmiana_kg !== null ? ` (${waga.zmiana_kg > 0 ? "+" : ""}${waga.zmiana_kg} kg)` : ""
          }</p>`
        : ""
    }
    ${wierszZmiany(raport.zmiana, "niż tydzień wcześniej")}
    ${
      raport.komentarz
        ? `<blockquote class="komentarz">${esc(raport.komentarz)}</blockquote>`
        : `<p class="cel">Bez komentarza — Claude dopisze go przy najbliższym podsumowaniu.</p>`
    }`;

  return `
    <section class="karta raport ${rozwiniety ? "otwarty" : ""}">
      <button class="naglowek-raportu" data-raport="${esc(raport.tydzien_od)}" aria-expanded="${rozwiniety}">
        <span>${zakresTygodnia(raport.tydzien_od, raport.tydzien_do)}</span>
        <span class="cel">${zaokr(raport.dieta.srednie.kcal)} kcal/dzień${
          raport.komentarz ? " · z komentarzem" : ""
        }</span>
      </button>
      ${rozwiniety ? szczegoly : ""}
    </section>`;
}

/**
 * Archiwum raportów. Rozwinięty jest wskazany tydzień, a gdy nic nie wskazano —
 * najnowszy: po wejściu w zakładkę ma być co czytać bez dodatkowego stuknięcia.
 */
export function ekranRaporty(lista, wybrany = null) {
  if (!lista || lista.length === 0) {
    return `
      <section class="karta">
        <h2>Raporty</h2>
        <p class="cel">Pierwszy raport powstanie w niedzielę o 9:00, po zamknięciu pełnego
        tygodnia niedziela–sobota. Claude przyśle wtedy powiadomienie i dopisze komentarz.</p>
      </section>`;
  }

  const otwarty = wybrany ?? lista[0].tydzien_od;
  return lista.map((r) => kartaRaportu(r, r.tydzien_od === otwarty)).join("");
}
