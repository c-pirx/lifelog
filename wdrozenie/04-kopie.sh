#!/usr/bin/env bash
#
# Codzienne kopie zapasowe bazy. Uruchamiać na serwerze: bash 04-kopie.sh

set -euo pipefail

echo "==> Instalacja skryptu kopii"
sudo install -m 755 "$(dirname "$0")/kopia-zapasowa.sh" /usr/local/bin/asystent-kopia

echo "==> Usługa i harmonogram"
sudo tee /etc/systemd/system/asystent-kopia.service >/dev/null <<'KONIEC'
[Unit]
Description=Kopia zapasowa bazy asystenta
After=asystent.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/asystent-kopia
StandardOutput=journal
StandardError=journal
SyslogIdentifier=asystent-kopia
KONIEC

sudo tee /etc/systemd/system/asystent-kopia.timer >/dev/null <<'KONIEC'
[Unit]
Description=Codzienna kopia zapasowa asystenta

[Timer]
OnCalendar=*-*-* 03:30:00
# Jeśli serwer był wyłączony o wyznaczonej porze, kopia wykona się po starcie.
Persistent=true
# Rozrzut w czasie, żeby nie startować dokładnie co do sekundy.
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
KONIEC

sudo systemctl daemon-reload
sudo systemctl enable --now asystent-kopia.timer >/dev/null

echo "==> Pierwsza kopia (test)"
sudo systemctl start asystent-kopia.service
sleep 2
sudo journalctl -u asystent-kopia -n 3 --no-pager | tail -2

echo
echo "==> Harmonogram:"
systemctl list-timers asystent-kopia.timer --no-pager | head -3
