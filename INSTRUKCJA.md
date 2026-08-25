# Instrukcja — konfiguracja i codzienne używanie

*[English version →](GUIDE.md)* · *[Powrót do README](README.pl.md)*

---

# Część 1. Co wybrać

Projekt da się używać na trzy sposoby. Różnią się tym, **gdzie** możesz
dyktować i **ile** to kosztuje.

| Wariant | Gdzie działa | Czego wymaga | Koszt |
|---|---|---|---|
| **A. Tylko komputer** | Claude Code, Claude Desktop | subskrypcja Claude | 0 zł |
| **B. Komputer + telefon** | dodatkowo aplikacja Claude na telefonie | serwer i własna domena | koszt VPS-a i domeny |
| **C. Sama aplikacja webowa** | przeglądarka | nic ponadto | 0 zł |

**Zacznij od wariantu A.** Działa w kwadrans, nic nie kosztuje i pozwala
sprawdzić, czy taki sposób zapisywania Ci odpowiada, zanim wydasz pieniądze na
serwer. Do wariantu B przejdziesz później bez przerabiania czegokolwiek.

## Dlaczego telefon wymaga serwera

To najczęstsze nieporozumienie, więc wyjaśnijmy je od razu.

Gdy używasz **Claude Code albo Claude Desktop**, program działa na Twoim
komputerze i sięga do bazy bezpośrednio — nic nie musi być w internecie.

Gdy używasz **aplikacji Claude na telefonie**, jest inaczej: Claude łączy się
z serwerem **z chmury Anthropic**, nie z Twojego telefonu. Serwer musi więc
mieć publiczny adres HTTPS. Dlatego wariant B wymaga VPS-a i domeny — nie da
się tego obejść.

---

# Część 2. Wariant A — na własnym komputerze

Potrzebujesz: **Node.js 20.12 lub nowszy**, **git** i **subskrypcji Claude**
(Pro albo Max). Sprawdź przez `node -v` — na starszym 20.x aplikacja przerywa
z komunikatem o konieczności aktualizacji.

## Krok 1. Pobranie i konfiguracja

```bash
git clone https://github.com/c-pirx/get-things-done
cd get-things-done
npm install
npm run setup
```

`npm run setup` tworzy plik `.env` z wygenerowanymi sekretami i wypisuje hasło
do aplikacji webowej. **Zapisz je** — będzie potrzebne przy pierwszym wejściu
na stronę.

## Krok 2. Zbudowanie i podłączenie do Claude

```bash
npm run build
```

Następnie, w zależności od tego, czego używasz:

### Claude Code

```bash
claude mcp add --scope user asystent-diety -- node <pełna-ścieżka>/dist/mcp/stdio.js
```

Sprawdzenie: `claude mcp list` powinno pokazać `✓ Connected`.

### Claude Desktop

```bash
npm run rozszerzenie
```

Powstanie plik `asystent.mcpb`. W Claude Desktop:
**Ustawienia → Extensions → Advanced settings → Extension Developer →
Install Extension…** i wskaż ten plik.

> **Narzędzia pojawią się dopiero w nowej rozmowie.** Serwery MCP wczytują się
> przy starcie sesji, więc otwórz nowy czat.

## Krok 3. Sprawdzenie

Napisz do Claude:

> pokaż podsumowanie dnia

Jeśli odpowie, że cele nie są ustawione i nie ma posiłków — działa. Przejdź do
części 4.

## Aplikacja webowa (opcjonalnie)

```bash
npm run dev
```

Otwórz http://localhost:3000 i zaloguj się hasłem z kroku 1. Serwer musi
działać tylko wtedy, gdy korzystasz z aplikacji webowej — Claude go nie
potrzebuje.

---

# Część 3. Wariant B — dostęp z telefonu

Dochodzą dwie rzeczy, których nie da się ominąć:

- **VPS** — wystarczy najmniejszy. Nasza aplikacja to jeden proces Node i plik
  SQLite; testowany na OVH VPS-1 (2 rdzenie, 4 GB, 40 GB), co jest i tak
  przesadą.
- **Domena albo subdomena**, którą kontrolujesz. Wystarczy dołożyć jeden
  rekord do domeny, którą już masz.

## Krok 1. Serwer i DNS

Zamów VPS z **Ubuntu 24.04 lub nowszym** i zapisz jego adres IPv4.

W panelu swojej domeny dodaj rekord:

```
asystent    A    <IP-twojego-serwera>
```

> **Na razie tylko rekord A, bez AAAA.** Let's Encrypt próbuje najpierw
> połączyć się po IPv6 i jeśli zapora tam nie przepuszcza ruchu, certyfikat
> nie zostanie wystawiony — a komunikat błędu nie wskaże przyczyny. To
> najczęstszy powód nieudanego wdrożenia.

## Krok 2. Dostęp kluczem SSH

Na swoim komputerze:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/asystent_vps -N ""
cat ~/.ssh/asystent_vps.pub
```

Wgraj wypisany klucz publiczny na serwer — najprościej przy zamawianiu albo
reinstalacji VPS-a, gdzie jest pole na klucz. Jeśli już masz dostęp hasłem,
zaloguj się i wykonaj na serwerze:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<tu-wklej-swój-klucz-publiczny>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Dodaj skrót w `~/.ssh/config` na swoim komputerze:

```
Host asystent
    HostName <IP-twojego-serwera>
    User ubuntu
    IdentityFile ~/.ssh/asystent_vps
    IdentitiesOnly yes
```

Od teraz wystarczy `ssh asystent`.

## Krok 3. Wdrożenie

Cztery skrypty, po kolei:

```bash
# 1. Zabezpieczenie serwera: zapora, tylko klucze SSH, fail2ban, aktualizacje
bash wdrozenie/wyslij.sh asystent
ssh asystent 'bash /opt/asystent/wdrozenie/01-zabezpiecz.sh'

# 2. Node, aplikacja, usługa systemd, wygenerowane sekrety produkcyjne
ssh asystent 'bash /opt/asystent/wdrozenie/02-aplikacja.sh'

# 3. nginx i certyfikat Let's Encrypt
ssh asystent 'bash /opt/asystent/wdrozenie/03-https.sh asystent.twojadomena.pl'

# 4. Codzienne kopie zapasowe bazy
ssh asystent 'bash /opt/asystent/wdrozenie/04-kopie.sh'
```

> **Skrypt 01 wyłącza logowanie hasłem.** Upewnij się wcześniej, że
> `ssh asystent` działa. Awaryjnie zostaje konsola KVM w panelu dostawcy.

## Krok 4. Podłączenie konektora

Odczytaj adres konektora z serwera:

```bash
ssh asystent 'echo https://asystent.twojadomena.pl/mcp/$(sudo grep "^MCP_TOKEN=" /etc/asystent/env | cut -d= -f2)'
```

Na **claude.ai w przeglądarce** (raz, z komputera):
**Customize → Connectors → + → Add custom connector** i wklej ten adres.

Od tej chwili narzędzia działają też w aplikacji Claude na telefonie.

Hasło do aplikacji webowej odczytasz tak:

```bash
ssh asystent 'sudo grep "^APP_PASSWORD=" /etc/asystent/env'
```

## Krok 5. Aplikacja na ekranie głównym telefonu

Otwórz `https://asystent.twojadomena.pl` w Safari (iPhone) lub Chrome
(Android), zaloguj się i wybierz **Udostępnij → Do ekranu początkowego**.
Będzie się zachowywać jak zwykła aplikacja, bez paska przeglądarki.

---

# Część 4. Codzienne używanie

## Ustawienia początkowe (raz)

**Cele:**

> ustaw cele: 2600 kcal, 180 g białka, 280 g węgli, 85 g tłuszczu

**Plan treningowy** — podyktuj go zwykłym zdaniem, Claude zapisze:

> Mój plan: dzień A w poniedziałki — przysiad ze sztangą 5 serii po 5,
> wyciskanie leżąc 3 serie po 8, deska 2 serie po 60 sekund.
> Dzień B w czwartki — martwy ciąg 3 serie po 5, wiosłowanie sztangą 4 po 10.

Sprawdzenie:

> pokaż mój plan treningowy

## Zapisywanie posiłków

Najprościej — po prostu powiedz, co jesz:

> zjadłem 200 g piersi z kurczaka z ryżem, jakieś 15 minut temu

Claude oszacuje makro i zapisze od razu, podając przyjęte wartości. Jeśli opis
jest ogólnikowy, **dopyta o wielkość porcji** zamiast zgadywać:

> **Ty:** zjadłem obiad u mamy
> **Claude:** Co dokładnie było i mniej więcej ile? Bez tego oszacowanie
> będzie zgadywaniem.

Możesz podać godzinę zwyczajnie:

> na śniadanie o 8:15 owsianka z bananem i masłem orzechowym

albo wpisać coś wstecz:

> wczoraj o 20:30 zjadłem pizzę, jakieś dwie trzecie dużej

**Zdjęcie posiłku** działa bez żadnej dodatkowej konfiguracji — zrób fotkę
w aplikacji Claude i napisz „zapisz ten posiłek".

## Sprawdzanie bilansu

> ile mi zostało dziś białka?

> pokaż podsumowanie dnia

> co jadłem wczoraj?

## Poprawianie błędów

Podsumowanie dnia pokazuje identyfikatory wpisów, ale zwykle wystarczy
powiedzieć, o co chodzi:

> ten obiad miał raczej 900 kcal, popraw

> usuń ostatni posiłek

## Trening

**Na siłowni najwygodniej użyć aplikacji webowej** — między seriami stuknięcie
w ekran jest szybsze niż formułowanie zdania. Ale oba wejścia działają
równocześnie i widzą to samo, więc możesz je mieszać dowolnie.

Rozmową:

> zaczynam trening A

> przysiad 5 powtórzeń 100 kg

> co mi jeszcze zostało?

> kończę trening

W aplikacji: zakładka **Trening** → przycisk dnia planu → przy każdym
ćwiczeniu **+ Seria**. Formularz jest wstępnie wypełniony poprzednim wynikiem,
więc zwykle wystarczy zatwierdzić.

**System pokazuje, co robiłeś ostatnio, i oznacza serie słabsze niż poprzednio
— ale nie mówi Ci, ile masz dołożyć.** Ta decyzja należy do Ciebie. Jeśli
chcesz opinii, zapytaj:

> jak szedł mi przysiad przez ostatni miesiąc? powinienem dołożyć?

## Waga

> zważyłem się, 81,4

Odpowiedź zawiera średnią kroczącą z 7 dni — dzienne wahania wody potrafią
przykryć rzeczywisty trend, więc to ona jest miarodajna, nie pojedynczy odczyt.

---

# Część 5. Gdy coś nie działa

**`npm install` przerywa na `better-sqlite3`.**
To natywny moduł SQLite. Zwykle npm pobiera gotowe binarium; jeśli dla Twojego
systemu i wersji Node'a go nie ma, próbuje kompilować i potrzebuje narzędzi
C++ — `sudo apt install build-essential python3` na Debianie/Ubuntu, Xcode
Command Line Tools na macOS, albo pakiet „Programowanie aplikacji klasycznych
w C++" z Visual Studio Build Tools na Windowsie. Często wystarczy przejść na
aktualne Node LTS, bo dla niego gotowe binaria istnieją.

**Aplikacja twierdzi, że brakuje zmiennych środowiskowych, choć `.env` jest.**
Masz Node starszy niż 20.12 i nie potrafi on sam czytać `.env`. Sprawdź
`node -v` i zaktualizuj.

**Claude nie widzi narzędzi.**
Otwórz **nową rozmowę** — serwery MCP wczytują się przy starcie sesji.
Jeśli dalej nic, sprawdź `claude mcp list`.

**`claude mcp list` pokazuje `✗ Failed to connect`.**
Przy wariancie stdio prawie zawsze znaczy to, że brakuje zbudowanej wersji —
uruchom `npm run build`. Po każdej zmianie w kodzie serwera też trzeba
przebudować, bo Claude uruchamia to, co jest w `dist/`.

**Konektor na telefonie przestał działać.**
Sprawdź, czy serwer żyje: `ssh asystent 'systemctl status asystent'`.
Jeśli działa, a konektor nie — możliwe, że Anthropic zmienił zakresy adresów,
z których łączą się konektory. W logu zobaczysz odrzucone żądania:
`ssh asystent "sudo grep ' 403 ' /var/log/nginx/asystent-dostep.log | tail"`.
Aktualne zakresy: https://platform.claude.com/docs/en/api/ip-addresses

**Aplikacja webowa pokazuje starą wersję.**
Zamknij kartę i otwórz ponownie. Od wersji z nagłówkami `no-cache` nie
powinno się to zdarzać.

**Nie pamiętam hasła do aplikacji.**
Lokalnie: zajrzyj do `.env`. Na serwerze:
`ssh asystent 'sudo grep APP_PASSWORD /etc/asystent/env'`.

**Chcę wymienić token konektora.**

```bash
ssh asystent
NOWY=$(openssl rand -hex 32)
sudo sed -i "s/^MCP_TOKEN=.*/MCP_TOKEN=$NOWY/" /etc/asystent/env
sudo systemctl restart asystent
echo "https://asystent.twojadomena.pl/mcp/$NOWY"
```

Potem podmień adres konektora na claude.ai.

**Chcę zacząć z czystą bazą.**
Lokalnie: `npm run reset -- --tak`. Na serwerze zatrzymaj usługę, usuń
`/var/lib/asystent/asystent.db` i uruchom ponownie — schemat utworzy się sam.

---

# Część 6. Ograniczenia, o których warto wiedzieć

**Tryb rozmowy głosowej nie wywołuje narzędzi.** Dyktuj mikrofonem
z klawiatury do pola tekstowego — to działa i po polsku, i po angielsku.

**Szacunki makro to szacunki.** Claude oszacuje kalorie z opisu słownego
z dokładnością, jakiej można oczekiwać od kogoś, kto patrzy na talerz. Wpisy,
przy których musiał zgadywać, są oznaczone jako szacowane — dzięki temu widać,
ile Twoich danych jest miękkich.

**Jeden użytkownik.** Nie ma kont ani rozdziału danych. Kto zna hasło albo
token, widzi wszystko.

**Uwierzytelnianie tokenem w adresie URL nie jest metodą zalecaną przez
specyfikację MCP** — zalecany jest OAuth. Użyto go, bo konektory claude.ai
przyjmują wyłącznie adres URL. Obroną jest lista dozwolonych adresów IP.
Jeśli miałbyś przechowywać dane więcej niż jednej osoby, zaimplementuj OAuth.
