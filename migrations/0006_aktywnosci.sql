-- Aktywności poza planem: bieg, rower, spacer, basen.
--
-- Osobna tabela, a nie sesja z jedną serią. Trzy powody, każdy wystarczający:
--   * `idx_sesja_aktywna` dopuszcza jedną otwartą sesję — niedomknięta
--     przejażdżka zablokowałaby start wieczornego treningu;
--   * raport tygodniowy zestawia `sesje` z `sesje_w_planie` i liczy serie —
--     spacer po cichu podbiłby realizację planu siłowego;
--   * „słabsza niż poprzednio" i „rekord" nie mają sensu dla losowego wyjazdu.
--
-- Konwencje czasu jak wszędzie: `ts` w UTC, `data_lokalna` gotowe YYYY-MM-DD
-- wyliczone w strefie aplikacji.

CREATE TABLE aktywnosci (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  data_lokalna  TEXT NOT NULL,
  dyscyplina    TEXT NOT NULL,          -- 'rower', 'bieg', 'spacer'
  dystans_m     REAL,
  czas_s        INTEGER,
  rpe           REAL,
  notatka       TEXT,
  zrodlo        TEXT NOT NULL CHECK (zrodlo IN ('czat', 'apka')),
  utworzono     TEXT NOT NULL
);

CREATE INDEX idx_aktywnosci_data ON aktywnosci (data_lokalna);
