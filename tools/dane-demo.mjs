/**
 * Wypełnia lokalną bazę danymi poglądowymi — do oglądania ekranów podczas pracy.
 * Uruchomienie: `npm run demo` (serwer musi działać: `npm run dev`)
 *
 * Idzie przez REST, a nie prosto do bazy, więc przy okazji sprawdza, czy API
 * faktycznie działa. Świadomie NIE używamy tu curla: powłoka Windows potrafi
 * zepsuć polskie znaki po drodze, a `fetch` w Node przesyła je poprawnie.
 *
 * Adres i hasło biorą się z pliku .env — npm NIE wczytuje go sam, więc robimy
 * to jawnie. Wcześniej skrypt miał port i hasło wpisane na sztywno i przez to
 * nie działał u nikogo poza autorem.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLIK_ENV = join(KORZEN, ".env");

if (existsSync(PLIK_ENV)) {
  process.loadEnvFile(PLIK_ENV);
} else {
  console.error("Brak pliku .env — uruchom najpierw: npm run setup");
  process.exit(1);
}

const ADRES = process.argv[2] ?? `http://localhost:${process.env.PORT || 3000}`;
const HASLO = process.env.APP_PASSWORD;

if (!HASLO) {
  console.error("APP_PASSWORD jest puste w .env — uruchom: npm run setup");
  process.exit(1);
}

let ciasteczko = "";

async function wyslij(sciezka, dane, metoda = "POST") {
  let odpowiedz;
  try {
    odpowiedz = await fetch(`${ADRES}${sciezka}`, {
      method: metoda,
      headers: { "content-type": "application/json", ...(ciasteczko ? { cookie: ciasteczko } : {}) },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
  } catch {
    // Stos wywołań z `fetch` nic tu nie wnosi, a przykrywa jedyną istotną
    // informację: serwer nie działa.
    console.error(`Nie mogę połączyć się z ${ADRES}`);
    console.error("Uruchom serwer w drugim oknie: npm run dev");
    process.exit(1);
  }

  if (odpowiedz.status === 401) {
    console.error("Serwer odrzucił hasło z .env. Czy działa serwer z tego samego katalogu?");
    process.exit(1);
  }

  if (!odpowiedz.ok) {
    const tresc = await odpowiedz.text();
    throw new Error(`${metoda} ${sciezka} → ${odpowiedz.status}: ${tresc}`);
  }

  return odpowiedz;
}

/**
 * Odejmuje dni od daty `YYYY-MM-DD`. Arytmetyka w UTC na samej dacie, bez
 * godzin — strefy nie mają tu czego popsuć.
 */
function przedDniami(data, dni) {
  const znacznik = Date.parse(`${data}T00:00:00Z`) - dni * 86_400_000;
  return new Date(znacznik).toISOString().slice(0, 10);
}

// Dzisiejszą datę bierzemy z serwera, a nie liczymy u siebie: to serwer zna
// strefę aplikacji i tylko jego odpowiedź na pewno zgadza się z tym, co
// pokażą ekrany. Zasada „konwersje czasu tylko przez lib/time.ts" zostaje
// nienaruszona — tu nie ma żadnej konwersji, jest zapytanie o gotowy wynik.
const zdrowie = await (await wyslij("/zdrowie", undefined, "GET")).json();
const DZIS = zdrowie.dzisiaj;

const logowanie = await wyslij("/api/logowanie", { haslo: HASLO });
ciasteczko = (logowanie.headers.get("set-cookie") ?? "").split(";")[0];

// Czyścimy poprzednie dane poglądowe, żeby wielokrotne uruchomienie nie mnożyło wpisów.
const dzien = await (await wyslij(`/api/dzien?data=${DZIS}`, undefined, "GET")).json();
for (const posilek of dzien.posilki) {
  await wyslij("/api/wpis", { typ: "posilek", id: posilek.id, akcja: "usun" });
}

await wyslij("/api/cele", {
  kcal: 2600,
  bialko_g: 180,
  wegle_g: 280,
  tluszcz_g: 85,
  obowiazuje_od: przedDniami(DZIS, 24),
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
    czas: `${DZIS} ${godzina}`,
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

for (const [ileDniTemu, kg] of [
  [6, 82.1],
  [4, 81.8],
  [2, 81.6],
  [1, 81.2],
  [0, 81.4],
]) {
  await wyslij("/api/waga", { kg, czas: `${przedDniami(DZIS, ileDniTemu)} 07:00` });
}

console.log(`Dane poglądowe wprowadzone (dzień ${DZIS}).`);
console.log(`Otwórz ${ADRES}`);
