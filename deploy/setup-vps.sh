#!/usr/bin/env bash
# Prepara un VPS recién creado con Ubuntu 24.04 o Debian 12. Ejecutar como root una sola vez:
#   bash deploy/setup-vps.sh
# Instala Docker, cortafuegos, bloqueo de IPs que fuerzan contraseñas, actualizaciones automáticas,
# restic para copias y 2 GB de memoria de intercambio (útil en VPS de 1–2 GB al procesar imágenes).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root (sudo bash deploy/setup-vps.sh)"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl ufw fail2ban unattended-upgrades restic git

if ! command -v docker >/dev/null; then
  if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt-get -y install docker.io docker-compose-v2
  else
    apt-get -y install docker.io docker-compose-plugin || apt-get -y install docker.io docker-compose
  fi
  systemctl enable --now docker
fi

# Cortafuegos: solo SSH, HTTP y HTTPS.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Bloquea durante 1 hora las IPs que fallan 5 veces la contraseña de SSH.
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# Parches de seguridad automáticos.
dpkg-reconfigure -f noninteractive unattended-upgrades

# Memoria de intercambio de 2 GB si no hay.
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo
echo "VPS preparado. Revisa el README (sección 'Seguridad del acceso SSH') para desactivar"
echo "las contraseñas y entrar solo con llave SSH: no se hace automáticamente para no dejarte fuera."
