-- Główny wyłącznik powiadomień — jeden przełącznik nad wszystkimi rodzajami.
--
-- Powód, dla którego nie wystarczy pusta kolumna `powiadomienia`: część rodzajów
-- (wisząca sesja, gotowy raport, cisza na wadze) świadomie NIE MA własnych
-- przełączników. Odhaczenie trzech szczegółowych ma znaczyć „nie chcę codziennych
-- przypomnień", a nie „nie chcę wiedzieć, że otwarta sesja blokuje mi trening".
-- To dwa różne życzenia i potrzebują dwóch różnych stanów.
--
-- Bez tego wyłącznika jedyną dźwignią dla kogoś zirytowanego byłaby blokada
-- powiadomień w ustawieniach przeglądarki — a ta zabiera WSZYSTKO, łącznie z tym,
-- co miało działać zawsze, i aplikacja nie ma jak jej cofnąć.
--
-- UPDATE jest konieczny, nie kosmetyczny: bez niego konta, które powiadomienia
-- mają już włączone, obudziłyby się po wdrożeniu z zerem i zamilkły. Niepusta
-- kolumna `powiadomienia` znaczy dziś dokładnie „ktoś przeszedł przez włączanie
-- w aplikacji", więc to wierne odwzorowanie stanu sprzed migracji.

ALTER TABLE uzytkownicy ADD COLUMN powiadomienia_wlaczone INTEGER NOT NULL DEFAULT 0;

UPDATE uzytkownicy SET powiadomienia_wlaczone = 1 WHERE powiadomienia != '';
