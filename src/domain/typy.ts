/** Typy współdzielone przez całą warstwę domenową. */

export type Pora = "sniadanie" | "obiad" | "kolacja" | "przekaska";
export type ZrodloWpisu = "czat" | "zdjecie" | "apka";
export type Pewnosc = "dokladne" | "szacowane" | "niepewne";
export type TypCwiczenia = "silowe" | "cardio" | "na_czas";
export type StatusSesji = "aktywna" | "zakonczona" | "porzucona";

export const PORY: readonly Pora[] = ["sniadanie", "obiad", "kolacja", "przekaska"];
export const PEWNOSCI: readonly Pewnosc[] = ["dokladne", "szacowane", "niepewne"];
export const TYPY_CWICZEN: readonly TypCwiczenia[] = ["silowe", "cardio", "na_czas"];

/** Cztery liczby opisujące wartość odżywczą. */
export type Makro = {
  kcal: number;
  bialko_g: number;
  wegle_g: number;
  tluszcz_g: number;
};

export const MAKRO_ZERO: Makro = { kcal: 0, bialko_g: 0, wegle_g: 0, tluszcz_g: 0 };

export function dodajMakro(a: Makro, b: Makro): Makro {
  return {
    kcal: a.kcal + b.kcal,
    bialko_g: a.bialko_g + b.bialko_g,
    wegle_g: a.wegle_g + b.wegle_g,
    tluszcz_g: a.tluszcz_g + b.tluszcz_g,
  };
}

export function odejmijMakro(a: Makro, b: Makro): Makro {
  return {
    kcal: a.kcal - b.kcal,
    bialko_g: a.bialko_g - b.bialko_g,
    wegle_g: a.wegle_g - b.wegle_g,
    tluszcz_g: a.tluszcz_g - b.tluszcz_g,
  };
}

// === DIETA ==============================================================

export type PozycjaPosilku = {
  id: number;
  nazwa: string;
  ilosc_g: number | null;
  kcal: number | null;
  bialko_g: number | null;
  wegle_g: number | null;
  tluszcz_g: number | null;
};

export type NowaPozycja = {
  nazwa: string;
  ilosc_g?: number;
  kcal?: number;
  bialko_g?: number;
  wegle_g?: number;
  tluszcz_g?: number;
};

export type Posilek = Makro & {
  id: number;
  ts: string;
  data_lokalna: string;
  godzina: string;
  pora: Pora;
  opis: string;
  zrodlo: ZrodloWpisu;
  pewnosc: Pewnosc;
  surowe_wejscie: string | null;
  pozycje: PozycjaPosilku[];
};

export type NowyPosilek = Partial<Makro> & {
  opis: string;
  kcal: number;
  /** Chwila spożycia w UTC ISO. Domyślnie teraz. */
  ts?: string;
  /** Domyślnie wnioskowana z godziny. */
  pora?: Pora;
  zrodlo?: ZrodloWpisu;
  pewnosc?: Pewnosc;
  surowe_wejscie?: string;
  pozycje?: NowaPozycja[];
};

/**
 * W którą stronę system ma się odzywać o kaloriach.
 *
 * Wąsko i wyłącznie dla powiadomień: „za mało" przy budowaniu masy jest
 * ostrzeżeniem, przy redukcji sukcesem. Ocena tygodnia i raporty trybu NIE
 * czytają — tam dalej obowiązuje zasada, że system nie zna zamiaru użytkownika
 * i mierzy wyłącznie trafienia w cel.
 *
 * Zamknięty w TypeScripcie, nie w SQL — jak KATEGORIE_NOTATEK i z tego samego
 * powodu: więz CHECK unieruchomiłby listę do czasu przepisania tabeli.
 */
export type TrybCelu = "redukcja" | "utrzymanie" | "masa";

export const TRYBY_CELU: readonly TrybCelu[] = ["redukcja", "utrzymanie", "masa"];

/** Bez deklaracji nie zgadujemy — brak trybu znaczy „nie odzywaj się o kierunku". */
export const TRYB_DOMYSLNY: TrybCelu = "utrzymanie";

export type Cele = Makro & {
  id: number;
  obowiazuje_od: string;
  opis: string | null;
  tryb: TrybCelu;
};

export type PodsumowanieDnia = {
  data: string;
  cele: Cele | null;
  spozyte: Makro;
  pozostalo: Makro | null;
  /** Ile procent celu kalorycznego zrealizowano; null gdy brak celów. */
  procent_kcal: number | null;
  posilki: Posilek[];
  /** Wpisy oparte na szacunku — wszystko poza `dokladne`. */
  ile_szacowanych: number;
  /** Podzbiór szacowanych: wpisy z najniższą pewnością. */
  ile_niepewnych: number;
};

// === TRENING ============================================================

export type Cwiczenie = {
  id: number;
  nazwa: string;
  typ: TypCwiczenia;
  partia: string | null;
};

export type CwiczenieWDniu = {
  id: number;
  cwiczenie_id: number;
  nazwa: string;
  typ: TypCwiczenia;
  kolejnosc: number;
  serie_cel: number | null;
  powt_cel: string | null;
  czas_cel_s: number | null;
  dystans_cel_m: number | null;
  /** Plan nie musi go znać — puste pole spada na wynik z poprzedniego treningu. */
  ciezar_cel_kg: number | null;
};

/**
 * Pojemnik na dni treningowe. Jeden plan jest domyślny — to on definiuje
 * harmonogram tygodnia; pozostałe zostają szablonami do odpalenia z ręki.
 */
export type Plan = {
  id: number;
  nazwa: string;
  opis: string | null;
  domyslny: boolean;
  dni: DzienPlanu[];
};

export type DzienPlanu = {
  id: number;
  plan_id: number;
  kod: string;
  nazwa: string;
  dzien_tygodnia: number | null;
  aktywny: boolean;
  cwiczenia: CwiczenieWDniu[];
};

export type Seria = {
  id: number;
  sesja_id: number;
  cwiczenie_id: number;
  nazwa: string;
  typ: TypCwiczenia;
  nr_serii: number;
  powtorzenia: number | null;
  ciezar_kg: number | null;
  czas_s: number | null;
  dystans_m: number | null;
  rpe: number | null;
  ts: string;
};

export type NowaSeria = {
  cwiczenie: string;
  /**
   * Typ używany tylko wtedy, gdy ćwiczenie trzeba dopiero utworzyć. Istniejące
   * ćwiczenie zachowuje swój typ — inaczej jedna pomyłka w aplikacji
   * przepisałaby historię wszystkich poprzednich serii.
   */
  typ?: TypCwiczenia;
  nr_serii?: number;
  powtorzenia?: number;
  ciezar_kg?: number;
  czas_s?: number;
  dystans_m?: number;
  rpe?: number;
  ts?: string;
};

export type Sesja = {
  id: number;
  dzien_id: number | null;
  dzien_kod: string | null;
  dzien_nazwa: string | null;
  start_ts: string;
  data_lokalna: string;
  koniec_ts: string | null;
  status: StatusSesji;
  notatki: string | null;
};

/** Skąd wzięły się liczby na przycisku „odhacz serię". */
export type ZrodloPropozycji = "ostatnia_seria" | "plan" | "poprzedni_trening" | "brak";

/**
 * Liczby proponowane do zapisania jednym stuknięciem. `zrodlo` równe „brak"
 * znaczy, że nie ma czego zapisać i aplikacja musi otworzyć formularz.
 */
export type Propozycja = {
  powtorzenia: number | null;
  ciezar_kg: number | null;
  czas_s: number | null;
  dystans_m: number | null;
  zrodlo: ZrodloPropozycji;
};

/** Postęp pojedynczego ćwiczenia w trwającej sesji. */
export type PostepCwiczenia = {
  cwiczenie_id: number;
  nazwa: string;
  typ: TypCwiczenia;
  serie_cel: number | null;
  powt_cel: string | null;
  serie_zrobione: number;
  serie: Seria[];
  /** Wyniki tego ćwiczenia z poprzedniej zakończonej sesji. */
  poprzednio: Seria[];
  /** Serie słabsze od najlepszej serii z poprzedniego razu. */
  slabsze_niz_poprzednio: number[];
  /** Serie lepsze od wszystkiego, co zapisano przed tą sesją. */
  rekordy: number[];
  /** Co zapisze przycisk „odhacz serię". */
  propozycja: Propozycja;
  ukonczone: boolean;
};

export type CwiczenieWSesji = {
  cwiczenie_id: number;
  nazwa: string;
  typ: TypCwiczenia;
  serie: Seria[];
};

/**
 * Odbyty trening z wynikami — kształt dla historii ruchu w aplikacji.
 *
 * Objętości w kilogramach tu nie ma świadomie: regułę „iloczyn tylko dla
 * ćwiczeń siłowych" wyraża SQL `repo.agregatSerii` na potrzeby raportu, a drugie
 * jej wyrażenie w TypeScripcie rozjechałoby się przy pierwszej zmianie. Liczba
 * serii i czas trwania wystarczą do nagłówka, a wyniki widać wprost w seriach.
 */
export type SesjaZWynikami = Sesja & {
  /** Godzina rozpoczęcia, HH:MM lokalnie. */
  godzina: string;
  /** null, gdy sesja nie ma `koniec_ts` — nie zgadujemy, ile trwała. */
  trwanie_s: number | null;
  serie_lacznie: number;
  cwiczenia: CwiczenieWSesji[];
};

export type StanTreningu = {
  sesja: Sesja | null;
  wg_planu: PostepCwiczenia[];
  /** Ćwiczenia zrobione mimo że nie ma ich w planie dnia. */
  poza_planem: PostepCwiczenia[];
  ukonczone_cwiczen: number;
  wszystkich_cwiczen: number;
  pozostalo: string[];
};

/**
 * Odpowiedź na jedyne pytanie, z jakim wchodzi się na ekran Trening: co dziś
 * przewiduje harmonogram i czy to już za nami.
 *
 * `dzien` równy null znaczy dzień wolny — plan nie przewiduje dziś treningu.
 * `zrealizowany` mówi wyłącznie o TYM dniu: trening bez planu ani inny dzień
 * odpalony ręcznie nie gaszą dzisiejszego zadania, bo go nie wykonały.
 */
export type PlanNaDzis = {
  data: string;
  dzien: DzienPlanu | null;
  zrealizowany: boolean;
};

// === AKTYWNOŚCI =========================================================

/**
 * Wysiłek poza planem treningowym: bieg, rower, spacer, basen.
 *
 * Nie jest sesją ani serią — nie ma numeru, nie ma celu, nie liczy się do
 * realizacji planu. System go zapisuje i pokazuje, ale niczego z niego nie
 * wnioskuje: żadnego „słabiej niż poprzednio", żadnych rekordów.
 */
export type Aktywnosc = {
  id: number;
  ts: string;
  data_lokalna: string;
  godzina: string;
  dyscyplina: string;
  dystans_m: number | null;
  czas_s: number | null;
  rpe: number | null;
  notatka: string | null;
  /** Zdjęcia tu nie ma — nie ma czego analizować. */
  zrodlo: "czat" | "apka";
};

export type NowaAktywnosc = {
  dyscyplina: string;
  dystans_m?: number;
  czas_s?: number;
  rpe?: number;
  notatka?: string;
  /** Chwila wysiłku w UTC ISO. Domyślnie teraz. */
  ts?: string;
  zrodlo?: Aktywnosc["zrodlo"];
};

/** Doba w historii ruchu: odbyte treningi i aktywności poza planem razem. */
export type DzienRuchu = {
  data: string;
  /** Sumy dotyczą wyłącznie aktywności — trening siłowy nie ma kilometrów. */
  dystans_m: number;
  czas_s: number;
  aktywnosci: Aktywnosc[];
  treningi: SesjaZWynikami[];
};

export type HistoriaRuchu = {
  od: string;
  do: string;
  dni: DzienRuchu[];
};

// === NOTATKI ============================================================

/**
 * Foldery zakładki Notatki. Lista jest zamknięta i ustala zarazem KOLEJNOŚĆ
 * folderów w aplikacji — „dziennik" i „praca" to dwa miejsca, do których się
 * wraca, „inne" jest workiem na resztę i tak też wygląda.
 *
 * Zamknięta w TypeScripcie, nie w SQL: więz CHECK na kolumnie unieruchomiłby ją
 * do czasu przepisania tabeli. Tu dołożenie folderu to jedna linia.
 */
export type KategoriaNotatki = "dziennik" | "praca" | "inne";

export const KATEGORIE_NOTATEK: readonly KategoriaNotatki[] = ["dziennik", "praca", "inne"];

export const KATEGORIA_DOMYSLNA: KategoriaNotatki = "inne";

/**
 * Notatka z dnia — myśl, ustalenie, obserwacja.
 *
 * `tresc` jest wersją oczyszczoną (model składa dyktowaną wypowiedź w zdania),
 * `surowe_wejscie` dokładną transkrypcją. Rozdział jest po to, żeby dało się
 * wrócić do oryginału, kiedy oczyszczanie przekłamie sens.
 */
export type Notatka = {
  id: number;
  ts: string;
  data_lokalna: string;
  godzina: string;
  kategoria: KategoriaNotatki;
  tytul: string | null;
  tresc: string;
  surowe_wejscie: string | null;
  zrodlo: "czat" | "apka";
};

export type NowaNotatka = {
  tresc: string;
  /** Pominięta spada na „inne" — zgadywanie za użytkownika byłoby gorsze. */
  kategoria?: KategoriaNotatki;
  tytul?: string;
  surowe_wejscie?: string;
  /** Chwila powstania notatki w UTC ISO. Domyślnie teraz. */
  ts?: string;
  zrodlo?: Notatka["zrodlo"];
};

/**
 * Folder z notatkami. `ile` liczy WSZYSTKIE notatki kategorii, także te poza
 * pobraną porcją — inaczej licznik na karcie mówiłby o oknie odczytu, a nie
 * o zawartości folderu.
 */
export type FolderNotatek = {
  kategoria: KategoriaNotatki;
  ile: number;
  /** Data ostatniej notatki albo null dla pustego folderu. */
  ostatnia: string | null;
  notatki: Notatka[];
};

export type HistoriaNotatek = {
  /** Ile najnowszych notatek pobrano z każdego folderu. */
  ile: number;
  foldery: FolderNotatek[];
};

// === POMIARY ============================================================

export type Waga = {
  id: number;
  ts: string;
  data_lokalna: string;
  kg: number;
  notatka: string | null;
};

export type PunktTrendu = {
  data: string;
  kg: number;
  /** Średnia krocząca z 7 dni — waga dzienna waha się zbyt mocno, by czytać ją wprost. */
  srednia_7d: number;
};
