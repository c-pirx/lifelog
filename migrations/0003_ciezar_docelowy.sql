-- Ciężar docelowy ćwiczenia w planie dnia.
--
-- Plan mówił dotąd ile serii i ile powtórzeń, ale nie mówił ilu kilogramów.
-- Odhaczenie serii jednym stuknięciem musi skądś wziąć liczbę — bez niej nie
-- policzymy tonażu ani nie oznaczymy słabszej serii.
--
-- Kolumna jest nullowalna świadomie: istniejące plany działają bez uzupełniania,
-- a propozycja spada wtedy na wynik z poprzedniego treningu.

ALTER TABLE cwiczenia_w_dniu ADD COLUMN ciezar_cel_kg REAL;
