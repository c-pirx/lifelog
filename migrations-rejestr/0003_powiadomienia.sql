-- Powiadomienia push — czwarta dziedzina rejestru, obok kont i listy oczekujących.
--
-- Wszystko siedzi TUTAJ, a nie w dzienniku, bo subskrypcja przeglądarki jest
-- daną konta, nie daną dziennika. Dziennik świadomie nie zna pojęcia
-- użytkownika: kolumny `uzytkownik_id` nie ma tam ani razu i pojawić się nie
-- może. Tik harmonogramu i tak przechodzi po rejestrze po listę kont.
--
-- === Subskrypcje ========================================================
--
-- `endpoint` jest UNIQUE i to on, a nie para (konto, urządzenie), identyfikuje
-- odbiorcę — tak samo widzi to przeglądarka. Zapis idzie przez UPSERT
-- z przepięciem `uzytkownik_id`, bo dwa scenariusze są całkiem zwyczajne:
-- przeglądarka rotuje klucze zachowując adres, a jeden telefon obsługuje dwa
-- konta domowników. Bez przepięcia powiadomienia jednego trafiałyby do drugiego.
--
-- Kaskada przy usunięciu konta: `npm run konta -- usun` ma zabierać ze sobą
-- subskrypcje, inaczej tik wysyłałby w adresy po nieistniejących ludziach.
--
-- === Ślad wysyłki =======================================================
--
-- UNIQUE (konto, dzień, rodzaj) to CAŁA idempotencja tej funkcji — ten sam
-- chwyt, co UNIQUE (tydzien_od) przy raportach. Dzięki niemu tik nie musi
-- trafiać w pełną godzinę: pyta „minęła osiemnasta i dziś jeszcze nie poszło",
-- a nie „czy jest dokładnie 18:00". To istotne, bo interwał liczy się od startu
-- procesu — restart o 8:37 przesunąłby tik na 9:37, 10:37 i osiemnasta nie
-- wypadłaby nigdy.
--
-- `data_lokalna` jest w STREFIE UŻYTKOWNIKA, jak wszędzie indziej w projekcie.
-- Dwie osoby w różnych strefach mają własne doby i własne ślady.
--
-- === Przełączniki =======================================================
--
-- Rodzaje po przecinku w jednej kolumnie tekstowej, nie trzy kolumny boolowskie:
-- czwarty rodzaj ma być jedną linią w TypeScripcie (RODZAJE_POWIADOMIEN),
-- a nie kolejną migracją. Pusto = powiadomienia wyłączone, i to jest domyślne —
-- zgoda przeglądarki nie może zapaść za plecami użytkownika.

CREATE TABLE subskrypcje_push (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uzytkownik_id  INTEGER NOT NULL REFERENCES uzytkownicy(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL UNIQUE,
  p256dh         TEXT NOT NULL,   -- klucz publiczny przeglądarki (base64url)
  auth           TEXT NOT NULL,   -- sekret uwierzytelniający (base64url)
  utworzono      TEXT NOT NULL
);

CREATE INDEX idx_subskrypcje_uzytkownik ON subskrypcje_push (uzytkownik_id);

CREATE TABLE wyslane_powiadomienia (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uzytkownik_id  INTEGER NOT NULL REFERENCES uzytkownicy(id) ON DELETE CASCADE,
  data_lokalna   TEXT NOT NULL,   -- YYYY-MM-DD w strefie użytkownika
  rodzaj         TEXT NOT NULL,
  wyslano        TEXT NOT NULL,
  UNIQUE (uzytkownik_id, data_lokalna, rodzaj)
);

ALTER TABLE uzytkownicy ADD COLUMN powiadomienia TEXT NOT NULL DEFAULT '';
