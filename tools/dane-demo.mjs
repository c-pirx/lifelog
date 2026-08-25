/**
 * Wypełnia lokalną bazę danymi poglądowymi — do oglądania ekranów podczas pracy.
 * Uruchomienie: `node tools/dane-demo.mjs [adres]`
 *
 * Idzie przez REST, a nie prosto do bazy, więc przy okazji sprawdza, czy API
 * faktycznie działa. Świadomie NIE używamy tu curla: powłoka Windows potrafi
 * zepsuć polskie znaki po drodze, a `fetch` w Node przesyła je poprawnie.
 */

const ADRES = process.argv[2] ?? "http://localhost:3100";
const HASLO = process.env.APP_PASSWORD ?? "lokalne-haslo-do-zmiany";

let ciasteczko = "";

async function wyslij(sciezka, dane, metoda = "POST") {
  const odpowiedz = await fetch(`${ADRES}${sciezka}`, {
    method: metoda,
    headers: { "content-type": "application/json", ...(ciasteczko ? { cookie: ciasteczko } : {}) },
    body: dane === undefined ? undefined : JSON.stringify(dane),
  });

  if (!odpowiedz.ok) {
    const tresc = await odpowiedz.text();
    throw new Error(`${metoda} ${sciezka} → ${odpowiedz.status}: ${tresc}`);
  }

  return odpowiedz;
}

const logowanie = await wyslij("/api/logowanie", { haslo: HASLO });
ciasteczko = (logowanie.headers.get("set-cookie") ?? "").split(";")[0];

// Czyścimy poprzednie dane poglądowe, żeby wielokrotne uruchomienie nie mnożyło wpisów.
const dzien = await (await wyslij("/api/dzien?data=2026-08-25", undefined, "GET")).json();
for (const posilek of dzien.posilki) {
  await wyslij("/api/wpis", { typ: "posilek", id: posilek.id, akcja: "usun" });
}

await wyslij("/api/cele", {
  kcal: 2600,
  bialko_g: 180,
  wegle_g: 280,
  tluszcz_g: 85,
  obowiazuje_od: "2026-08-01",
  opis: "budowa masy",
});

const posilki = [
  ["owsianka z bananem i masłem orzechowym", 560, 22, 72, 18, "08:15"],
  ["kurczak z ryżem i brokułami", 720, 58, 85, 12, "13:30"],
  ["jogurt grecki z orzechami", 310, 20, 14, 19, "16:45"],
];

for (const [opis, kcal, bialko_g, wegle_g, tluszcz_g, godzina] of posilki) {
  await wyslij("/api/posilki", {
    opis,
    kcal,
    bialko_g,
    wegle_g,
    tluszcz_g,
    czas: `2026-08-25 ${godzina}`,
  });
}

await wyslij("/api/plan", {
  kod: "A",
  nazwa: "Nogi i klatka",
  dzien_tygodnia: 1,
  cwiczenia: [
    { nazwa: "przysiad ze sztangą", typ: "silowe", serie_cel: 5, powt_cel: "5" },
    { nazwa: "wyciskanie leżąc", typ: "silowe", serie_cel: 3, powt_cel: "8" },
    { nazwa: "deska", typ: "na_czas", serie_cel: 2, czas_cel_s: 60 },
  ],
});

await wyslij("/api/plan", {
  kod: "B",
  nazwa: "Plecy i barki",
  dzien_tygodnia: 4,
  cwiczenia: [
    { nazwa: "martwy ciąg", typ: "silowe", serie_cel: 3, powt_cel: "5" },
    { nazwa: "wiosłowanie sztangą", typ: "silowe", serie_cel: 4, powt_cel: "10" },
  ],
});

for (const [data, kg] of [
  ["2026-08-19", 82.1],
  ["2026-08-21", 81.8],
  ["2026-08-23", 81.6],
  ["2026-08-24", 81.2],
  ["2026-08-25", 81.4],
]) {
  await wyslij("/api/waga", { kg, czas: `${data} 07:00` });
}

console.log("Dane poglądowe wprowadzone.");
