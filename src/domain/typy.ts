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

export type Cele = Makro & {
  id: number;
  obowiazuje_od: string;
  opis: string | null;
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

export type StanTreningu = {
  sesja: Sesja | null;
  wg_planu: PostepCwiczenia[];
  /** Ćwiczenia zrobione mimo że nie ma ich w planie dnia. */
  poza_planem: PostepCwiczenia[];
  ukonczone_cwiczen: number;
  wszystkich_cwiczen: number;
  pozostalo: string[];
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
