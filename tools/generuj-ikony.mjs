/**
 * Generator ikon PWA. Uruchamiany ręcznie: `node tools/generuj-ikony.mjs`.
 *
 * Piszemy PNG bez zależności zewnętrznych — plik jest na tyle prosty, że
 * własny enkoder jest tańszy niż dokładanie biblioteki graficznej do projektu,
 * który poza tym nie przetwarza obrazów. iOS wymaga PNG dla apple-touch-icon,
 * więc sam SVG w manifeście by nie wystarczył.
 */

import { crc32, deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KATALOG = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const TLO = [15, 17, 21];
const AKCENT = [125, 211, 160];

function fragment(typ, dane) {
  const naglowek = Buffer.alloc(8);
  naglowek.writeUInt32BE(dane.length, 0);
  naglowek.write(typ, 4, "ascii");

  const doSumy = Buffer.concat([Buffer.from(typ, "ascii"), dane]);
  const suma = Buffer.alloc(4);
  suma.writeUInt32BE(crc32(doSumy) >>> 0, 0);

  return Buffer.concat([naglowek, dane, suma]);
}

function png(rozmiar, piksel) {
  // Każdy wiersz poprzedzony bajtem filtra 0 (brak filtrowania).
  const wiersze = Buffer.alloc(rozmiar * (1 + rozmiar * 3));
  let pozycja = 0;

  for (let y = 0; y < rozmiar; y += 1) {
    wiersze[pozycja] = 0;
    pozycja += 1;
    for (let x = 0; x < rozmiar; x += 1) {
      const [r, g, b] = piksel(x, y, rozmiar);
      wiersze[pozycja] = r;
      wiersze[pozycja + 1] = g;
      wiersze[pozycja + 2] = b;
      pozycja += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(rozmiar, 0);
  ihdr.writeUInt32BE(rozmiar, 4);
  ihdr[8] = 8; // głębia bitowa
  ihdr[9] = 2; // typ koloru: truecolor RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    fragment("IHDR", ihdr),
    fragment("IDAT", deflateSync(wiersze, { level: 9 })),
    fragment("IEND", Buffer.alloc(0)),
  ]);
}

/** Sztanga: gryf przez środek, po dwa talerze z każdej strony. */
function sztanga(x, y, rozmiar) {
  const u = rozmiar / 100;
  const srodekY = rozmiar / 2;
  const odSrodkaY = Math.abs(y - srodekY);
  const odSrodkaX = Math.abs(x - rozmiar / 2);

  const gryf = odSrodkaY <= 3 * u && odSrodkaX <= 34 * u;
  const talerzDuzy = odSrodkaX >= 22 * u && odSrodkaX <= 30 * u && odSrodkaY <= 18 * u;
  const talerzMaly = odSrodkaX >= 32 * u && odSrodkaX <= 38 * u && odSrodkaY <= 11 * u;

  return gryf || talerzDuzy || talerzMaly ? AKCENT : TLO;
}

mkdirSync(KATALOG, { recursive: true });

for (const rozmiar of [180, 192, 512]) {
  const plik = join(KATALOG, `ikona-${rozmiar}.png`);
  writeFileSync(plik, png(rozmiar, sztanga));
  console.log(`zapisano ${plik}`);
}
