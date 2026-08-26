-- Trzeci poziom pewności estymacji: dokladne (gramatura/etykieta),
-- szacowane (konkretny opis bez wag), niepewne (ogólnik, zdjęcie bez
-- szczegółów). Dwustopniowa skala zlewała „opis konkretny, wagi zgadnięte"
-- z „nie wiadomo nawet, co było na talerzu" — a raport tygodniowy traktował
-- oba tak samo. CHECK przy kolumnie wymaga przebudowy tabeli; migracje
-- biegną z wyłączonym kluczem obcym — patrz `uruchomMigracje`.

CREATE TABLE posilki_nowe (
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
  pewnosc         TEXT NOT NULL CHECK (pewnosc IN ('dokladne', 'szacowane', 'niepewne')),
  surowe_wejscie  TEXT,
  utworzono       TEXT NOT NULL
);

-- Kopia zachowuje `id` — pozycje_posilku wskazują na posiłki po id.
-- Kolumny wyliczone jawnie, żeby cicha zmiana kolejności nie pomieszała danych.
INSERT INTO posilki_nowe (id, ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g,
                          tluszcz_g, zrodlo, pewnosc, surowe_wejscie, utworzono)
SELECT id, ts, data_lokalna, pora, opis, kcal, bialko_g, wegle_g,
       tluszcz_g, zrodlo, pewnosc, surowe_wejscie, utworzono
FROM posilki;

DROP TABLE posilki;
ALTER TABLE posilki_nowe RENAME TO posilki;

-- DROP TABLE zabrał indeks razem ze starą tabelą.
CREATE INDEX idx_posilki_data ON posilki (data_lokalna);
