-- Schemat początkowy: dieta, trening, pomiary.
--
-- Konwencje czasu:
--   ts            – znacznik UTC w ISO 8601 (np. 2026-08-25T07:00:00.000Z)
--   data_lokalna  – YYYY-MM-DD wyliczone w strefie aplikacji (Europe/Warsaw)
-- Denormalizacja data_lokalna jest celowa: pozwala pytać o dzień jednym
-- porównaniem tekstu zamiast liczyć strefy czasowe w SQL.

PRAGMA foreign_keys = ON;

-- === CELE ===============================================================

CREATE TABLE cele (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  obowiazuje_od  TEXT NOT NULL,          -- YYYY-MM-DD
  kcal           REAL NOT NULL,
  bialko_g       REAL NOT NULL,
  wegle_g        REAL NOT NULL,
  tluszcz_g      REAL NOT NULL,
  opis           TEXT,
  utworzono      TEXT NOT NULL
);

CREATE INDEX idx_cele_od ON cele (obowiazuje_od);

-- === DIETA ==============================================================

CREATE TABLE posilki (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  data_lokalna    TEXT NOT NULL,
  pora            TEXT NOT NULL CHECK (pora IN ('sniadanie', 'obiad', 'kolacja', 'przekaska')),
  opis            TEXT NOT NULL,
  kcal            REAL NOT NULL,
  bialko_g        REAL NOT NULL,
  wegle_g         REAL NOT NULL,
  tluszcz_g       REAL NOT NULL,
  zrodlo          TEXT NOT NULL CHECK (zrodlo IN ('czat', 'zdjecie', 'apka')),
  pewnosc         TEXT NOT NULL CHECK (pewnosc IN ('dokladne', 'szacowane')),
  surowe_wejscie  TEXT,
  utworzono       TEXT NOT NULL
);

CREATE INDEX idx_posilki_data ON posilki (data_lokalna);

-- Pozycje są opcjonalne. Suma w nagłówku posiłku pozostaje źródłem prawdy
-- dla podsumowań, żeby posiłki z rozbiciem i bez liczyły się tak samo.
CREATE TABLE pozycje_posilku (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  posilek_id  INTEGER NOT NULL REFERENCES posilki (id) ON DELETE CASCADE,
  nazwa       TEXT NOT NULL,
  ilosc_g     REAL,
  kcal        REAL,
  bialko_g    REAL,
  wegle_g     REAL,
  tluszcz_g   REAL
);

CREATE INDEX idx_pozycje_posilek ON pozycje_posilku (posilek_id);

-- === TRENING ============================================================

CREATE TABLE cwiczenia (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa   TEXT NOT NULL UNIQUE,
  typ     TEXT NOT NULL CHECK (typ IN ('silowe', 'cardio', 'na_czas')),
  partia  TEXT
);

CREATE TABLE dni_planu (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kod             TEXT NOT NULL UNIQUE,   -- 'A', 'B', 'push'
  nazwa           TEXT NOT NULL,
  dzien_tygodnia  INTEGER CHECK (dzien_tygodnia BETWEEN 1 AND 7),  -- 1 = poniedziałek
  aktywny         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cwiczenia_w_dniu (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dzien_id       INTEGER NOT NULL REFERENCES dni_planu (id) ON DELETE CASCADE,
  cwiczenie_id   INTEGER NOT NULL REFERENCES cwiczenia (id),
  kolejnosc      INTEGER NOT NULL,
  serie_cel      INTEGER,
  powt_cel       TEXT,      -- '5' albo zakres '8-12'
  czas_cel_s     INTEGER,
  dystans_cel_m  REAL,
  UNIQUE (dzien_id, kolejnosc)
);

CREATE TABLE sesje (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dzien_id      INTEGER REFERENCES dni_planu (id),
  start_ts      TEXT NOT NULL,
  data_lokalna  TEXT NOT NULL,
  koniec_ts     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('aktywna', 'zakonczona', 'porzucona')),
  notatki       TEXT
);

CREATE INDEX idx_sesje_data ON sesje (data_lokalna);

-- Najwyżej jedna sesja aktywna naraz — pilnuje tego baza, nie kod aplikacji.
CREATE UNIQUE INDEX idx_sesja_aktywna ON sesje (status) WHERE status = 'aktywna';

CREATE TABLE serie (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sesja_id      INTEGER NOT NULL REFERENCES sesje (id) ON DELETE CASCADE,
  cwiczenie_id  INTEGER NOT NULL REFERENCES cwiczenia (id),
  nr_serii      INTEGER NOT NULL,
  powtorzenia   INTEGER,   -- wypełniane dla typu 'silowe'
  ciezar_kg     REAL,      -- wypełniane dla typu 'silowe'
  czas_s        INTEGER,   -- 'cardio' i 'na_czas'
  dystans_m     REAL,      -- 'cardio'
  rpe           REAL,
  ts            TEXT NOT NULL,
  UNIQUE (sesja_id, cwiczenie_id, nr_serii)
);

CREATE INDEX idx_serie_sesja ON serie (sesja_id);
CREATE INDEX idx_serie_cwiczenie ON serie (cwiczenie_id);

-- === POMIARY ============================================================

-- Jeden pomiar na dobę. Ponowny zapis tego samego dnia nadpisuje poprzedni,
-- dzięki czemu wykres trendu nie ma po kilka punktów dziennie.
CREATE TABLE waga_ciala (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  data_lokalna  TEXT NOT NULL UNIQUE,
  kg            REAL NOT NULL,
  notatka       TEXT
);
