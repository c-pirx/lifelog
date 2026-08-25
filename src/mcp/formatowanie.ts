/**
 * Zamiana obiektów domenowych na zwięzły tekst dla Claude'a.
 *
 * To, co zwrócą te funkcje, użytkownik zobaczy w rozmowie prawie dosłownie —
 * dlatego zdania są krótkie, liczby zaokrąglone, a jednostki zawsze widoczne.
 */

import type { HistoriaCwiczenia } from "../domain/workouts.js";
import type {
  DzienPlanu,
  Makro,
  PodsumowanieDnia,
  Posilek,
  PostepCwiczenia,
  Seria,
  StanTreningu,
} from "../domain/typy.js";

const liczba = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

export function makroWTekscie(m: Makro): string {
  return `${liczba(m.kcal)} kcal · B ${liczba(m.bialko_g)} g · W ${liczba(m.wegle_g)} g · T ${liczba(m.tluszcz_g)} g`;
}

export function posilekWTekscie(p: Posilek): string {
  const znacznik = p.pewnosc === "szacowane" ? " (szacunek)" : "";
  return `#${p.id} ${p.godzina} ${p.pora}: ${p.opis} — ${makroWTekscie(p)}${znacznik}`;
}

export function podsumowanieWTekscie(d: PodsumowanieDnia): string {
  const linie = [`Podsumowanie ${d.data}`, `Zjedzone: ${makroWTekscie(d.spozyte)}`];

  if (d.cele && d.pozostalo) {
    linie.push(`Cel: ${makroWTekscie(d.cele)}`);
    const przekroczone = d.pozostalo.kcal < 0;
    linie.push(
      przekroczone
        ? `Przekroczone o: ${makroWTekscie({
            kcal: -d.pozostalo.kcal,
            bialko_g: -d.pozostalo.bialko_g,
            wegle_g: -d.pozostalo.wegle_g,
            tluszcz_g: -d.pozostalo.tluszcz_g,
          })}`
        : `Zostało: ${makroWTekscie(d.pozostalo)}`,
    );
    linie.push(`Realizacja kalorii: ${d.procent_kcal}%`);
  } else {
    linie.push("Cele nie są ustawione — użyj narzędzia ustaw_cele.");
  }

  if (d.posilki.length === 0) {
    linie.push("Brak posiłków tego dnia.");
  } else {
    linie.push("", "Posiłki:");
    linie.push(...d.posilki.map((p) => `  ${posilekWTekscie(p)}`));
  }

  if (d.ile_szacowanych > 0) {
    linie.push("", `Wpisów opartych na szacunku: ${d.ile_szacowanych}.`);
  }

  return linie.join("\n");
}

export function seriaWTekscie(s: Seria): string {
  const czesci: string[] = [];

  if (s.powtorzenia != null) {
    czesci.push(s.ciezar_kg != null ? `${s.powtorzenia}×${liczba(s.ciezar_kg)} kg` : `${s.powtorzenia} powt.`);
  }
  if (s.czas_s != null) czesci.push(`${s.czas_s} s`);
  if (s.dystans_m != null) czesci.push(`${liczba(s.dystans_m / 1000)} km`);
  if (s.rpe != null) czesci.push(`RPE ${liczba(s.rpe)}`);

  return czesci.join(", ") || "brak danych";
}

function postepWTekscie(c: PostepCwiczenia): string {
  const cel = c.serie_cel ? `${c.serie_zrobione}/${c.serie_cel}` : `${c.serie_zrobione}`;
  const status = c.ukonczone ? "✓" : "○";
  const linie = [`  ${status} ${c.nazwa} — serie ${cel}`];

  if (c.serie.length > 0) {
    linie.push(`      zrobione: ${c.serie.map(seriaWTekscie).join(" | ")}`);
  }
  if (c.poprzednio.length > 0) {
    linie.push(`      poprzednio: ${c.poprzednio.map(seriaWTekscie).join(" | ")}`);
  }
  if (c.slabsze_niz_poprzednio.length > 0) {
    linie.push(`      słabsze niż poprzednio: seria ${c.slabsze_niz_poprzednio.join(", ")}`);
  }

  return linie.join("\n");
}

export function stanTreninguWTekscie(s: StanTreningu): string {
  if (!s.sesja) {
    return "Nie ma otwartej sesji treningowej. Zacznij treningiem przez rozpocznij_trening.";
  }

  const naglowek = s.sesja.dzien_kod
    ? `Trening ${s.sesja.dzien_kod} (${s.sesja.dzien_nazwa}) — ${s.sesja.data_lokalna}`
    : `Trening bez planu — ${s.sesja.data_lokalna}`;

  const linie = [naglowek, `Postęp: ${s.ukonczone_cwiczen}/${s.wszystkich_cwiczen} ćwiczeń`];

  if (s.wg_planu.length > 0) {
    linie.push("", "Z planu:");
    linie.push(...s.wg_planu.map(postepWTekscie));
  }

  if (s.poza_planem.length > 0) {
    linie.push("", "Poza planem:");
    linie.push(...s.poza_planem.map(postepWTekscie));
  }

  linie.push(
    "",
    s.pozostalo.length > 0 ? `Zostało: ${s.pozostalo.join(", ")}` : "Plan wykonany w całości.",
  );

  return linie.join("\n");
}

const DNI_TYGODNIA = ["", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];

export function planWTekscie(dni: DzienPlanu[]): string {
  if (dni.length === 0) {
    return "Plan treningowy jest pusty. Dodaj dni przez zarzadzaj_planem z akcją zapisz_dzien.";
  }

  return dni
    .map((d) => {
      const kiedy = d.dzien_tygodnia ? DNI_TYGODNIA[d.dzien_tygodnia] : "bez stałego dnia";
      const cwiczenia =
        d.cwiczenia.length > 0
          ? d.cwiczenia
              .map((c) => {
                const cel = [
                  c.serie_cel ? `${c.serie_cel} serie` : null,
                  c.powt_cel ? `po ${c.powt_cel}` : null,
                  c.czas_cel_s ? `${c.czas_cel_s} s` : null,
                  c.dystans_cel_m ? `${liczba(c.dystans_cel_m / 1000)} km` : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                return `  ${c.kolejnosc}. ${c.nazwa}${cel ? ` — ${cel}` : ""}`;
              })
              .join("\n")
          : "  (brak ćwiczeń)";

      return `${d.kod} — ${d.nazwa} (${kiedy})\n${cwiczenia}`;
    })
    .join("\n\n");
}

export function historiaWTekscie(h: HistoriaCwiczenia): string {
  if (h.sesje.length === 0) {
    return `Brak zapisanych serii dla ćwiczenia „${h.nazwa}".`;
  }

  const linie = [`Historia: ${h.nazwa} (${h.typ})`];

  if (h.rekord_ciezar != null) {
    linie.push(`Rekord ciężaru: ${liczba(h.rekord_ciezar)} kg`);
  }

  linie.push("");
  linie.push(
    ...h.sesje.map((s) => `${s.data}: ${s.serie.map(seriaWTekscie).join(" | ")}`),
  );

  return linie.join("\n");
}
