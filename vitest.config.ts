import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Każdy plik testowy dostaje własną bazę w pamięci, więc mogą biec równolegle,
    // ale w obrębie pliku testy dzielą jedno połączenie — stąd brak współbieżności w pliku.
    fileParallelism: true,
  },
});
