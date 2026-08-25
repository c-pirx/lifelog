-- Raporty tygodniowe.
--
-- Raport jest MIGAWKĄ, nie widokiem: liczby zapisujemy raz i już ich nie
-- przeliczamy. Poprawka posiłku sprzed miesiąca (`zmien_wpis` na to pozwala)
-- nie może po cichu zmienić raportu, który użytkownik przeczytał i skomentował.
--
-- Tydzień biegnie od niedzieli do soboty. Raport za niego powstaje w kolejną
-- niedzielę o 9:00 czasu lokalnego — wtedy wszystkie siedem dni jest zamknięte.

CREATE TABLE raporty_tygodniowe (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tydzien_od    TEXT NOT NULL UNIQUE,   -- niedziela, YYYY-MM-DD
  tydzien_do    TEXT NOT NULL,          -- sobota, YYYY-MM-DD
  dane          TEXT NOT NULL,          -- migawka liczb jako JSON
  komentarz     TEXT,                   -- dopisywany przez Claude po odczycie
  komentarz_ts  TEXT,
  utworzono     TEXT NOT NULL
);

-- UNIQUE na tydzien_od daje idempotencję generowania na poziomie bazy:
-- wystarczy INSERT OR IGNORE, bez sprawdzania w kodzie.
CREATE INDEX idx_raporty_od ON raporty_tygodniowe (tydzien_od DESC);
