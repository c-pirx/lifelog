/**
 * Próg wersji Node żyje w dwóch miejscach: `engines.node` w package.json
 * (czyta go npm i narzędzia w `tools/`) oraz `WYMAGANY_NODE` w konfiguracji
 * (czyta go aplikacja). Rozjazd między nimi jest cichy i wychodzi dopiero
 * u kogoś, kto ma starszego Node — czyli u nowego użytkownika, nie u nas.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { WYMAGANY_NODE } from "../src/config.js";

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), "..");

function packageJson(): { engines: { node: string } } {
  return JSON.parse(readFileSync(join(KORZEN, "package.json"), "utf8"));
}

describe("próg wersji Node", () => {
  it("engines.node zgadza się z WYMAGANY_NODE", () => {
    expect(packageJson().engines.node).toBe(`>=${WYMAGANY_NODE}`);
  });

  it("jest podany z dokładnością do wersji łatki", () => {
    // `>=20` przepuściłoby Node 20.5, na którym `process.loadEnvFile` jeszcze
    // nie istnieje. Trzy człony to nie pedanteria, tylko warunek poprawności.
    expect(WYMAGANY_NODE).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
