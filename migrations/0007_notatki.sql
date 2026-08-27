-- Notatki: dziennik myśli i spraw roboczych, dyktowany do Claude'a.
--
-- Dwie kolumny na ten sam tekst, i to jest sedno tabeli:
--   `tresc`           – wersja oczyszczona przez model, tę widzi użytkownik;
--   `surowe_wejscie`  – dokładna transkrypcja, nigdy nietykana.
-- Rozpoznawanie mowy gubi słowa i skleja zdania, więc zapis słowo w słowo byłby
-- po roku nieczytelny. Ale to surowe wejście jest zapisem prawdy: tylko z niego
-- da się notatkę odtworzyć, gdyby model przekłamał sens. Dlatego poprawki
-- (`zmien_wpis`) świadomie go nie ruszają.
--
-- `kategoria` celowo BEZ więzu CHECK, choć `posilki.pora` taki ma. Zmiana CHECK
-- w SQLite wymaga przepisania całej tabeli (nowa obok, kopia, DROP, RENAME) —
-- dokładnie ta pułapka, która kosztowała czas przy 0005_pewnosc_niepewne.sql.
-- Dołożenie czwartego folderu ma być jedną linią w KATEGORIE_NOTATEK, a listy
-- pilnuje domena.
--
-- Konwencje czasu jak wszędzie: `ts` w UTC, `data_lokalna` gotowe YYYY-MM-DD
-- wyliczone w strefie aplikacji.

CREATE TABLE notatki (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  data_lokalna    TEXT NOT NULL,
  kategoria       TEXT NOT NULL,          -- 'dziennik', 'praca', 'inne'
  tytul           TEXT,                   -- brak = lista bierze początek treści
  tresc           TEXT NOT NULL,
  surowe_wejscie  TEXT,
  zrodlo          TEXT NOT NULL CHECK (zrodlo IN ('czat', 'apka')),
  utworzono       TEXT NOT NULL
);

-- Zakładka czyta „najnowsze w folderze", więc indeks obejmuje od razu sortowanie.
CREATE INDEX idx_notatki_kategoria ON notatki (kategoria, ts DESC);
CREATE INDEX idx_notatki_data ON notatki (data_lokalna);
