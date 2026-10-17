#!/usr/bin/env bash
# Copia de seguridad diaria: base de datos + imágenes.
#  - Siempre guarda una copia local en /var/backups/zaber (últimos 7 días).
#  - Si hay un repositorio de restic configurado en deploy/backup.env, sube además una copia
#    cifrada a otro servidor (otro proveedor, otro país). Eso es lo que te salva si el VPS desaparece.
# Programar a las 4:17 cada día:  echo "17 4 * * * root /ruta/al/proyecto/deploy/backup.sh" | sudo tee /etc/cron.d/zaber-backup
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=/var/backups/zaber
STAMP=$(date +%F)
mkdir -p "$OUT"
chmod 700 "$OUT"

echo "[$(date)] Copiando la base de datos…"
docker compose exec -T db pg_dump -U zaber -d zaber --format=custom > "$OUT/db-$STAMP.dump"

echo "[$(date)] Copiando las imágenes…"
docker compose exec -T app tar czf - -C /data/media . > "$OUT/media-$STAMP.tar.gz"

# Solo se guardan 7 días en el propio VPS.
find "$OUT" -name 'db-*.dump' -mtime +7 -delete
find "$OUT" -name 'media-*.tar.gz' -mtime +7 -delete

if [ -f deploy/backup.env ]; then
  set -a; . deploy/backup.env; set +a
  if [ -n "${RESTIC_REPOSITORY:-}" ]; then
    echo "[$(date)] Subiendo copia cifrada a $RESTIC_REPOSITORY…"
    restic snapshots >/dev/null 2>&1 || restic init
    restic backup "$OUT/db-$STAMP.dump" "$OUT/media-$STAMP.tar.gz" --tag zaber
    restic forget --tag zaber --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
  fi
else
  echo "Aviso: no hay deploy/backup.env; la copia solo está en este mismo VPS."
fi
echo "[$(date)] Copia terminada."
