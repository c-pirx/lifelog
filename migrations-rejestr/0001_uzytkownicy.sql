-- Rejestr użytkowników — druga baza obok dzienników.
--
-- Dzienniki żyją w osobnych plikach (uzytkownicy/<id>.db), po jednym na osobę;
-- tu jest wyłącznie to, co wspólne: kto istnieje, jak się loguje i którym
-- tokenem podpięty jest jego konektor. Dzięki temu schemat dziennika zostaje
-- nietknięty, a usunięcie konta to skasowanie jednego pliku.
--
-- Dwie decyzje bezpieczeństwa, obie widoczne w kolumnach:
--   `hasz_hasla` + `sol` – scrypt z node:crypto, sól na użytkownika; jawnego
--                          hasła nie ma nigdzie, także w kopiach zapasowych;
--   `token_hasz`         – SHA-256 tokenu konektora, nigdy sam token. Wyciek
--                          rejestru nie daje wtedy działających adresów,
--                          a lookup po indeksie UNIQUE nie ma wycieku
--                          czasowego, który przy jawnym tokenie trzeba było
--                          neutralizować ręcznym porównaniem.
--
-- `login` z COLLATE NOCASE tą samą zasadą, co dyscypliny aktywności:
-- „Ania" i „ania" to jedno konto, nie dwa.
--
-- Konwencje czasu jak wszędzie: kolumny czasu w UTC (ISO 8601).

CREATE TABLE uzytkownicy (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  login                      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hasz_hasla                 TEXT NOT NULL,
  sol                        TEXT NOT NULL,
  token_hasz                 TEXT NOT NULL UNIQUE,
  strefa                     TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  zgoda_ts                   TEXT NOT NULL,   -- moment zaznaczenia zgody przy rejestracji
  utworzono                  TEXT NOT NULL,
  ostatnie_uzycie_konektora  TEXT,            -- zasila wskaźnik „✓ połączono" w aplikacji
  aktywny                    INTEGER NOT NULL DEFAULT 1
);
