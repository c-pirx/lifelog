/**
 * Nakładka wpisów czekających w kolejce na stan pobrany z serwera.
 *
 * Bez niej trening bez zasięgu wyglądałby tak, jakby nic się nie zapisywało:
 * seria trafia do kolejki, ale ekran nadal pokazuje stan sprzed niej.
 *
 * Świadomie NIE liczy niczego domenowego. Nie ocenia, czy seria była słabsza
 * niż poprzednio, nie wnioskuje pory posiłku, nie przelicza celów. To wszystko
 * należy do src/domain/ i pojawi się dopiero wtedy, gdy serwer przyjmie wpis.
 * Jedyna arytmetyka tutaj to dodanie makro do sum dnia — bez tego pasek bilansu
 * stałby w miejscu mimo zapisanego posiłku.
 *
 * Moduł jest czysty (bez DOM, bez sieci, bez IndexedDB) właśnie po to, żeby dało
 * się go objąć testami — reszta warstwy offline sprawdzalna jest tylko ręcznie.
 */

/** Godzina HH:MM ze znacznika ISO, w strefie przeglądarki. */
function godzina(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "--:--";
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

const dopasujSciezke = (wpis, sciezka) => wpis.sciezka === sciezka;

/**
 * Data lokalna, do której należy wpis z kolejki.
 *
 * Gdy wpis niesie własny czas (posiłek dopisany do wczoraj), bierzemy datę
 * wprost z niego. Bez tego wpis wylądowałby wizualnie w dniu wysyłki.
 */
function dataWpisu(wpis) {
  const podany = wpis.dane?.czas ?? wpis.czas_lokalny ?? "";
  const jawnaData = /^(\d{4}-\d{2}-\d{2})/.exec(podany);
  if (jawnaData && !podany.endsWith("Z")) return jawnaData[1];

  const data = new Date(podany);
  if (Number.isNaN(data.getTime())) return jawnaData?.[1] ?? "";
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

/**
 * Podsumowanie dnia z doliczonymi posiłkami z kolejki i bez tych, których
 * usunięcie czeka na wysłanie.
 */
export function nalozNaDzien(dzien, kolejka = []) {
  // Tylko wpisy z oglądanego dnia — przy cofnięciu się na wczoraj dzisiejsza
  // kolejka nie ma tam czego szukać.
  const dodane = kolejka
    .filter((w) => dopasujSciezke(w, "/posilki"))
    .filter((w) => dataWpisu(w) === dzien.data);
  const usuwane = new Set(
    kolejka
      .filter((w) => dopasujSciezke(w, "/wpis"))
      .filter((w) => w.dane?.typ === "posilek" && w.dane?.akcja === "usun")
      .map((w) => w.dane.id),
  );
  const poprawki = kolejka
    .filter((w) => dopasujSciezke(w, "/wpis"))
    .filter((w) => w.dane?.typ === "posilek" && w.dane?.akcja === "popraw" && w.dane?.dane);

  if (dodane.length === 0 && usuwane.size === 0 && poprawki.length === 0) return dzien;

  // Poprawka nakłada tylko pola widoczne na liście. `czas` zostaje serwerowi —
  // przenoszenie wpisu między dniami to robota domeny, nie kosmetyka — więc do
  // wysyłki wpis stoi pod starą godziną. `pozycje` z tego samego powodu.
  const POLA_POPRAWKI = ["opis", "kcal", "bialko_g", "wegle_g", "tluszcz_g", "pora", "pewnosc"];
  const zostajace = dzien.posilki
    .filter((p) => !usuwane.has(p.id))
    .map((p) => {
      const moje = poprawki.filter((w) => w.dane.id === p.id);
      if (moje.length === 0) return p;

      const nalozony = { ...p, oczekujaca_zmiana: true };
      // W kolejności kolejki — druga poprawka tego samego wpisu na pierwszej,
      // dokładnie tak, jak zapisze je serwer.
      for (const w of moje) {
        for (const pole of POLA_POPRAWKI) {
          if (w.dane.dane[pole] !== undefined) nalozony[pole] = w.dane.dane[pole];
        }
      }
      return nalozony;
    });

  const oczekujace = dodane.map((wpis) => ({
    id: `oczekuje-${wpis.id}`,
    oczekuje: true,
    godzina: godzina(wpis.dane.czas ?? wpis.czas_lokalny),
    opis: wpis.dane.opis,
    kcal: wpis.dane.kcal ?? 0,
    bialko_g: wpis.dane.bialko_g ?? 0,
    wegle_g: wpis.dane.wegle_g ?? 0,
    tluszcz_g: wpis.dane.tluszcz_g ?? 0,
    // Pora zostaje pusta: wnioskuje ją domena, nie my.
    pora: null,
    pewnosc: "dokladne",
  }));

  const posilki = [...zostajace, ...oczekujace];
  const suma = (pole) => posilki.reduce((s, p) => s + (Number(p[pole]) || 0), 0);

  return {
    ...dzien,
    posilki,
    spozyte: {
      kcal: suma("kcal"),
      bialko_g: suma("bialko_g"),
      wegle_g: suma("wegle_g"),
      tluszcz_g: suma("tluszcz_g"),
    },
  };
}

/**
 * Sesja udawana na czas, w którym jej rozpoczęcie czeka w kolejce.
 *
 * Dzień szukany po id, bo kod przestał być jednoznaczny — dwa plany mogą mieć
 * własne „A". Aplikacja wysyła id, czat kod; ten drugi zostaje jako zapas.
 */
function sesjaZKolejki(wpis, dni) {
  const szukaj = (warunek) => dni.find(warunek) ?? null;
  const dzien =
    wpis.dane?.dzien_id != null
      ? szukaj((d) => d.id === wpis.dane.dzien_id)
      : wpis.dane?.kod
        ? szukaj((d) => d.kod === wpis.dane.kod)
        : null;

  return {
    id: null,
    oczekuje: true,
    dzien_id: dzien?.id ?? null,
    dzien_kod: dzien?.kod ?? null,
    dzien_nazwa: dzien?.nazwa ?? null,
    start_ts: wpis.czas_lokalny,
    data_lokalna: (wpis.czas_lokalny ?? "").slice(0, 10),
    koniec_ts: null,
    status: "aktywna",
    notatki: null,
  };
}

/** Karta ćwiczenia zbudowana wyłącznie z serii czekających w kolejce. */
function postepZKolejki(nazwa, typ) {
  return {
    cwiczenie_id: `oczekuje-${nazwa}`,
    nazwa,
    typ: typ ?? "silowe",
    serie_cel: null,
    powt_cel: null,
    serie_zrobione: 0,
    serie: [],
    poprzednio: [],
    slabsze_niz_poprzednio: [],
    rekordy: [],
    // Bez zasięgu nie wiemy, co proponować — ocenę zostawiamy serwerowi,
    // a aplikacja pokazuje wtedy zwykły formularz.
    propozycja: { powtorzenia: null, ciezar_kg: null, czas_s: null, dystans_m: null, zrodlo: "brak" },
    ukonczone: false,
  };
}

/**
 * Stan treningu z doliczonymi seriami z kolejki. `dni` to dni ze wszystkich
 * planów — służą tylko do nazwania dnia w sesji odtworzonej z kolejki.
 */
export function nalozNaTrening(trening, kolejka = [], dni = []) {
  // Zakończenie treningu czekające w kolejce zamyka sesję także na ekranie —
  // inaczej przycisk „Zakończ" kusiłby do drugiego kliknięcia.
  if (kolejka.some((w) => dopasujSciezke(w, "/trening/koniec"))) {
    return { ...trening, sesja: null, wg_planu: [], poza_planem: [] };
  }

  const start = kolejka.find((w) => dopasujSciezke(w, "/trening/start"));
  const serie = kolejka.filter((w) => dopasujSciezke(w, "/trening/seria"));
  const odhaczone = kolejka.filter((w) => dopasujSciezke(w, "/trening/cwiczenie/odhacz"));

  if (!start && serie.length === 0 && odhaczone.length === 0) return trening;

  const sesja = trening.sesja ?? (start ? sesjaZKolejki(start, dni) : null);
  if (!sesja) return trening;

  const wgPlanu = trening.wg_planu.map((c) => ({ ...c, serie: [...c.serie] }));
  const pozaPlanem = trening.poza_planem.map((c) => ({ ...c, serie: [...c.serie] }));

  const znajdz = (nazwa) => {
    const szukana = nazwa.trim().toLowerCase();
    const pasuje = (c) => c.nazwa.trim().toLowerCase() === szukana;
    return wgPlanu.find(pasuje) ?? pozaPlanem.find(pasuje);
  };

  for (const wpis of serie) {
    const nazwa = wpis.dane?.cwiczenie ?? "";
    let cwiczenie = znajdz(nazwa);

    if (!cwiczenie) {
      cwiczenie = postepZKolejki(nazwa, wpis.dane?.typ);
      pozaPlanem.push(cwiczenie);
    }

    cwiczenie.serie.push({
      id: `oczekuje-${wpis.id}`,
      oczekuje: true,
      nr_serii: cwiczenie.serie.length + 1,
      powtorzenia: wpis.dane?.powtorzenia ?? null,
      ciezar_kg: wpis.dane?.ciezar_kg ?? null,
      czas_s: wpis.dane?.czas_s ?? null,
      dystans_m: wpis.dane?.dystans_m ?? null,
      rpe: wpis.dane?.rpe ?? null,
      ts: wpis.dane?.czas ?? wpis.czas_lokalny,
    });
  }

  // Ile serii dopisze odhaczenie całego ćwiczenia — wie serwer, bo to on zna
  // cel z planu. Nakładka stawia więc jeden znacznik, zamiast zgadywać liczby.
  for (const wpis of odhaczone) {
    const nazwa = wpis.dane?.cwiczenie ?? "";
    let cwiczenie = znajdz(nazwa);

    if (!cwiczenie) {
      cwiczenie = postepZKolejki(nazwa);
      pozaPlanem.push(cwiczenie);
    }

    cwiczenie.serie.push({
      id: `oczekuje-${wpis.id}`,
      oczekuje: true,
      cale_cwiczenie: true,
      nr_serii: null,
      powtorzenia: null,
      ciezar_kg: null,
      czas_s: null,
      dystans_m: null,
      rpe: null,
      ts: wpis.dane?.czas ?? wpis.czas_lokalny,
    });
  }

  // Znacznik całego ćwiczenia nie ma liczby serii, więc nie może podbić licznika
  // ani zamknąć ćwiczenia — jedno i drugie rozstrzygnie się po wysłaniu.
  const przelicz = (c) => {
    const policzalne = c.serie.filter((s) => !s.cale_cwiczenie);
    return {
      ...c,
      serie_zrobione: policzalne.length,
      ukonczone: c.serie_cel ? policzalne.length >= c.serie_cel : policzalne.length > 0,
    };
  };

  const gotowePlan = wgPlanu.map(przelicz);

  return {
    ...trening,
    sesja,
    wg_planu: gotowePlan,
    poza_planem: pozaPlanem.map(przelicz),
    ukonczone_cwiczen: gotowePlan.filter((c) => c.ukonczone).length,
    wszystkich_cwiczen: gotowePlan.length,
    pozostalo: gotowePlan.filter((c) => !c.ukonczone).map((c) => c.nazwa),
  };
}

/**
 * Aktywności jednego dnia z doliczonymi wpisami z kolejki.
 *
 * Ta sama polityka co przy posiłkach: dodania, usunięcia i poprawki widać od
 * razu, ale `czas` z poprawki zostaje serwerowi — przeniesienie wpisu między
 * dniami to robota domeny, nie kosmetyka na liście.
 */
export function nalozNaAktywnosci(aktywnosci = [], kolejka = [], data) {
  const dodane = kolejka
    .filter((w) => dopasujSciezke(w, "/aktywnosci"))
    .filter((w) => dataWpisu(w) === data);

  const wpisy = kolejka.filter((w) => dopasujSciezke(w, "/wpis") && w.dane?.typ === "aktywnosc");
  const usuwane = new Set(
    wpisy.filter((w) => w.dane?.akcja === "usun").map((w) => w.dane.id),
  );
  const poprawki = wpisy.filter((w) => w.dane?.akcja === "popraw" && w.dane?.dane);

  if (dodane.length === 0 && usuwane.size === 0 && poprawki.length === 0) return aktywnosci;

  const POLA_POPRAWKI = ["dyscyplina", "dystans_m", "czas_s", "rpe", "notatka"];
  const zostajace = aktywnosci
    .filter((a) => !usuwane.has(a.id))
    .map((a) => {
      const moje = poprawki.filter((w) => w.dane.id === a.id);
      if (moje.length === 0) return a;

      const nalozony = { ...a, oczekujaca_zmiana: true };
      // W kolejności kolejki — druga poprawka tego samego wpisu na pierwszej,
      // dokładnie tak, jak zapisze je serwer.
      for (const w of moje) {
        for (const pole of POLA_POPRAWKI) {
          if (w.dane.dane[pole] !== undefined) nalozony[pole] = w.dane.dane[pole];
        }
      }
      return nalozony;
    });

  const oczekujace = dodane.map((wpis) => ({
    id: `oczekuje-${wpis.id}`,
    oczekuje: true,
    godzina: godzina(wpis.dane.czas ?? wpis.czas_lokalny),
    data_lokalna: data,
    dyscyplina: wpis.dane.dyscyplina,
    dystans_m: wpis.dane.dystans_m ?? null,
    czas_s: wpis.dane.czas_s ?? null,
    rpe: wpis.dane.rpe ?? null,
    notatka: wpis.dane.notatka ?? null,
  }));

  return [...zostajace, ...oczekujace];
}

/**
 * Treningi dnia z uwzględnieniem usunięć czekających w kolejce.
 *
 * Trening znika z listy od razu, zamiast wisieć do odzyskania zasięgu —
 * inaczej użytkownik stuknąłby „usuń" drugi raz, sądząc, że pierwszy nie zadziałał.
 */
export function nalozNaTreningi(treningi = [], kolejka = []) {
  const usuwane = new Set(
    kolejka
      .filter((w) => dopasujSciezke(w, "/wpis"))
      .filter((w) => w.dane?.typ === "sesja" && w.dane?.akcja === "usun")
      .map((w) => w.dane.id),
  );

  if (usuwane.size === 0) return treningi;
  return treningi.filter((t) => !usuwane.has(t.id));
}

/** Cały dzień z zakładki — sumy aktywności trzeba przeliczyć po nałożeniu. */
export function nalozNaDzienRuchu(dzien, kolejka = []) {
  const aktywnosci = nalozNaAktywnosci(dzien.aktywnosci, kolejka, dzien.data);
  const treningi = nalozNaTreningi(dzien.treningi ?? [], kolejka);

  if (aktywnosci === dzien.aktywnosci && treningi === (dzien.treningi ?? [])) return dzien;

  const suma = (pole) => aktywnosci.reduce((s, a) => s + (Number(a[pole]) || 0), 0);
  return { ...dzien, aktywnosci, treningi, dystans_m: suma("dystans_m"), czas_s: suma("czas_s") };
}
