-- Lista oczekujących na premierę — trzecia dziedzina rejestru, obok kont.
--
-- Mieszka w rejestrze, a nie w dzienniku, bo wpis powstaje ZANIM istnieje
-- użytkownik: adres e-mail nie należy jeszcze do nikogo. Dzienniki zostają
-- nietknięte, a `test/izolacja.test.ts` dalej ma czego pilnować.
--
-- `kod_hasz` jest haszem, nie sekretem — tą samą zasadą, którą rządzi się
-- `token_hasz` w tabeli `uzytkownicy`: jawny kod zaproszenia istnieje wyłącznie
-- w wysłanym mailu, a po użyciu kolumna wraca do NULL. To zerowanie JEST
-- jednorazowością kodu.
--
-- Tokenu wypisu nie ma tu wcale: wyprowadza go HMAC z adresu (`podpiszTekst`
-- w auth.ts), więc link ze stopki działa bezterminowo, także w mailu wysłanym
-- pół roku po zapisie — czego kolumna z jednym haszem by nie udźwignęła,
-- bo każdy kolejny mail unieważniałby link z poprzedniego.
--
-- Bez więzu CHECK na `stan` — z tego samego powodu, dla którego nie ma go przy
-- kategoriach notatek: zamroziłby listę wartości do czasu przepisania tabeli,
-- a czwarty stan ma być jedną linią w TypeScripcie.
--
-- `email` z COLLATE NOCASE jak `login`: „Ania@…" i „ania@…" to jeden zapis.
-- Konwencje czasu jak wszędzie: kolumny czasu w UTC (ISO 8601).

CREATE TABLE lista_oczekujacych (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  imie           TEXT,
  zapisano       TEXT NOT NULL,
  zgoda_ts       TEXT NOT NULL,   -- moment zaznaczenia zgody przy zapisie
  stan           TEXT NOT NULL DEFAULT 'oczekuje',  -- oczekuje | zaproszony | zarejestrowany
  zaproszono     TEXT,
  wykorzystano   TEXT,
  uzytkownik_id  INTEGER,         -- konto powstałe z tego zaproszenia
  kod_hasz       TEXT UNIQUE,
  kod_wygasa     TEXT
);

CREATE INDEX idx_lista_stan ON lista_oczekujacych (stan, zapisano);
