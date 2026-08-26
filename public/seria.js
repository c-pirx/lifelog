/**
 * Seria w tekście — wspólna dla ekranu Trening i zakładki Aktywności.
 *
 * Moduł istnieje z jednego powodu: obie zakładki muszą czytać serię
 * IDENTYCZNIE. Dwie kopie tej samej funkcji rozjechałyby się przy pierwszej
 * poprawce, a użytkownik zobaczyłby ten sam wynik zapisany na dwa sposoby.
 *
 * Czysty, bez DOM i bez sieci — jak posilek.js.
 */

/** „10×60 kg", „30 powt.", „1200 s", „5.20 km" — tylko pola, które seria zna. */
export function seriaWTekscie(seria) {
  const czesci = [];

  if (seria.powtorzenia != null) {
    czesci.push(
      seria.ciezar_kg ? `${seria.powtorzenia}×${seria.ciezar_kg} kg` : `${seria.powtorzenia} powt.`,
    );
  }
  if (seria.czas_s != null) czesci.push(`${seria.czas_s} s`);
  if (seria.dystans_m != null) czesci.push(`${(seria.dystans_m / 1000).toFixed(2)} km`);

  return czesci.join(", ") || "—";
}

/**
 * Serie pod rząd o tym samym wyniku zwijają się w „10×60 kg ×3".
 *
 * Zwijamy tylko sąsiadów, nie wszystkie równe: kolejność serii niesie przebieg
 * treningu, a „60, 70, 60" nie jest tym samym co „60 ×2, 70".
 */
export function serieZgrupowane(serie) {
  const grupy = [];

  for (const s of serie) {
    const opis = seriaWTekscie(s);
    const ostatnia = grupy.at(-1);
    if (ostatnia && ostatnia.opis === opis) ostatnia.ile += 1;
    else grupy.push({ opis, ile: 1 });
  }

  return grupy.map((g) => (g.ile > 1 ? `${g.opis} ×${g.ile}` : g.opis)).join(" · ");
}
