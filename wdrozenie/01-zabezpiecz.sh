#!/usr/bin/env bash
#
# Zabezpieczenie świeżego serwera Ubuntu/Debian.
# Uruchamiać na serwerze jako użytkownik z sudo: bash 01-zabezpiecz.sh
#
# Skrypt jest idempotentny — ponowne uruchomienie niczego nie psuje.
#
# UWAGA: wyłącza logowanie hasłem. Przed uruchomieniem upewnij się, że
# logowanie kluczem SSH działa, inaczej odetniesz sobie dostęp. Awaryjnie
# zostaje konsola KVM w panelu OVH, która działa niezależnie od SSH.

set -euo pipefail

echo "==> Aktualizacja listy pakietów"
sudo apt-get update -qq

echo "==> Instalacja pakietów podstawowych"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ufw fail2ban unattended-upgrades sqlite3 rsync curl ca-certificates

# --- Swap ------------------------------------------------------------------
# 4 GB RAM wystarcza z zapasem na samą aplikację, ale kompilacja natywnego
# modułu SQLite potrafi chwilowo zjeść dużo pamięci. Swap jest tanim
# ubezpieczeniem od zabicia procesu przez OOM killer.
if [ "$(free -m | awk '/^Swap:/ {print $2}')" -eq 0 ]; then
  echo "==> Tworzenie pliku swap 2 GB"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # Swap ma być ostatnią deską ratunku, nie codziennym mechanizmem.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
  sudo sysctl -q -w vm.swappiness=10
else
  echo "==> Swap już istnieje, pomijam"
fi

# --- Zapora ----------------------------------------------------------------
# Port 80 musi zostać otwarty na stałe, nie tylko na czas wystawienia
# certyfikatu — Let's Encrypt używa go również przy odnowieniach co 60 dni.
echo "==> Konfiguracja zapory"
# `reset` zwraca kod błędu, gdy zapora jest jeszcze nieaktywna — przy
# `set -e` przerwałoby to cały skrypt na świeżej maszynie.
sudo ufw --force reset >/dev/null 2>&1 || true
sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
sudo ufw allow 22/tcp comment 'SSH' >/dev/null
sudo ufw allow 80/tcp comment 'HTTP - Let'"'"'s Encrypt' >/dev/null
sudo ufw allow 443/tcp comment 'HTTPS' >/dev/null
sudo ufw --force enable >/dev/null

# --- SSH -------------------------------------------------------------------
echo "==> Utwardzanie SSH"
# Nazwa zaczyna się od 00, a nie od 99, i to jest istotne: w SSH wygrywa
# PIERWSZE wystąpienie ustawienia, a obrazy chmurowe Ubuntu mają
# 50-cloud-init.conf z `PasswordAuthentication yes`. Plik o wyższym numerze
# zostałby przez niego przesłonięty i hasła nadal by działały.
sudo rm -f /etc/ssh/sshd_config.d/99-utwardzenie.conf
sudo tee /etc/ssh/sshd_config.d/00-utwardzenie.conf >/dev/null <<'KONIEC'
# Tylko klucze — hasła są podatne na zgadywanie i wyciekają przez ludzi.
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes

# Root nie loguje się bezpośrednio; do zadań administracyjnych służy sudo,
# dzięki czemu w logach widać, kto co zrobił.
PermitRootLogin no

# Portu SSH nie zmieniamy: przenosiny na niestandardowy port to iluzja
# bezpieczeństwa, a utrudniają diagnostykę. Robotę robi fail2ban.
MaxAuthTries 3
LoginGraceTime 30
KONIEC

# Składnia zanim przeładujemy usługę — błąd tutaj oznaczałby utratę dostępu.
sudo sshd -t
sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd

# --- fail2ban --------------------------------------------------------------
echo "==> Konfiguracja fail2ban"
sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'KONIEC'
[sshd]
enabled = true
backend = systemd
maxretry = 4
findtime = 10m
bantime = 1h
KONIEC
sudo systemctl enable --now fail2ban >/dev/null
sudo systemctl restart fail2ban

# --- Aktualizacje bezpieczeństwa -------------------------------------------
echo "==> Włączanie automatycznych aktualizacji bezpieczeństwa"
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'KONIEC'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
KONIEC
sudo systemctl enable --now unattended-upgrades >/dev/null

echo
echo "==> Gotowe. Stan:"
sudo ufw status | head -8
echo "--- fail2ban ---"
sudo fail2ban-client status sshd 2>/dev/null | head -4 || echo "(fail2ban się uruchamia)"
echo "--- swap ---"
free -h | awk '/^Swap:/ {print "swap: "$2}'
