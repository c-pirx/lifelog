-- Plan treningowy jako pojemnik na dni.
--
-- Dotąd dni planu były jednym workiem bez nazwy: dzień A, dzień B i dzień
-- testowy leżały obok siebie, a harmonogram tygodniowy brał pierwszy pasujący
-- do dzisiejszego dnia tygodnia. Wystarczało przy jednym planie i przestaje
-- wystarczać, gdy użytkownik zbiera plany jako szablony.
--
-- Jeden plan jest domyślny — to on definiuje harmonogram. Pilnuje tego indeks
-- częściowy, a nie kod aplikacji, tym samym wzorcem, którym schemat pilnuje
-- jednej aktywnej sesji.
--
-- Kod dnia przestaje być unikalny globalnie, a staje się unikalny w obrębie
-- planu: przy zbieraniu szablonów kolizje („A", „Push") są nieuniknione.
-- Ponieważ UNIQUE stoi w SQLite przy kolumnie, w niejawnym i nieusuwalnym
-- indeksie, jedyną drogą jest przebudowa tabeli. Migracje biegną w tym celu
-- z wyłączonym kluczem obcym — patrz `uruchomMigracje`.

CREATE TABLE plany (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa     TEXT NOT NULL UNIQUE,   -- po niej Claude adresuje plan w rozmowie
  opis      TEXT,
  domyslny  INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_plan_domyslny ON plany (domyslny) WHERE domyslny = 1;

-- Wszystko, co już jest w bazie, składa się na plan, którym użytkownik trenuje.
INSERT INTO plany (nazwa, domyslny)
SELECT 'Mój plan', 1 WHERE EXISTS (SELECT 1 FROM dni_planu);

CREATE TABLE dni_planu_nowe (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id         INTEGER NOT NULL REFERENCES plany (id) ON DELETE CASCADE,
  kod             TEXT NOT NULL,          -- 'A', 'B', 'push' — w obrębie planu
  nazwa           TEXT NOT NULL,
  dzien_tygodnia  INTEGER CHECK (dzien_tygodnia BETWEEN 1 AND 7),  -- 1 = poniedziałek
  aktywny         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (plan_id, kod)
);

-- Kopia zachowuje `id`, więc sesje i ćwiczenia w dniu dalej mają na co wskazywać.
INSERT INTO dni_planu_nowe (id, plan_id, kod, nazwa, dzien_tygodnia, aktywny)
SELECT id, (SELECT id FROM plany WHERE domyslny = 1), kod, nazwa, dzien_tygodnia, aktywny
FROM dni_planu;

DROP TABLE dni_planu;
ALTER TABLE dni_planu_nowe RENAME TO dni_planu;
