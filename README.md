# Zaber

Web propia de Zaber (ilustración 2D, contenido +18): galería, me gusta, guardados, comentarios en hilo con @menciones, encargos con seguimiento y aprobación de bocetos, chat privado con archivos, avisos en tiempo real y un panel para que la artista lo gestione todo.

Está pensada para un VPS propio, sin servicios de terceros: ni Cloudflare, ni Google Fonts, ni CDNs. Todo (base de datos, imágenes, fuentes, scripts) vive en el servidor.

## Estructura

```
web/        La web: index.html, styles.css, app.js (lógica), i18n.js (textos ES/EN), fuentes y GSAP
server/     API en Node.js + Express + PostgreSQL, WebSocket para el chat, procesado de imágenes
deploy/     Nginx, HTTPS, copias de seguridad y preparación del VPS
Dockerfile, docker-compose.yml   Todo el sitio en contenedores
```

Qué hace el servidor con las imágenes: las convierte a WebP en tres tamaños, **borra todos los metadatos** (GPS, modelo de cámara, fecha) y crea una vista previa para redes, que sale difuminada si la obra es +18. Los adjuntos del chat y de los encargos se guardan aparte y solo los ven las dos personas implicadas.

## Probar en tu ordenador

Necesitas Node.js 22 y PostgreSQL 16.

```bash
cd server
npm ci
createdb zaber
export DATABASE_URL=postgres://TU_USUARIO@localhost:5432/zaber
npm run seed:demo      # datos de ejemplo (solo para local)
npm run dev            # http://localhost:3000
```

Cuentas de ejemplo: artista `demo@zaber.local` / `zaber-demo-1` y persona registrada `mika@zaber.local` / `mika-demo-1`.

Pruebas automáticas (borran por completo la base de datos indicada):

```bash
createdb zaber_test
TEST_DATABASE_URL=postgres://TU_USUARIO@localhost:5432/zaber_test npm test
```

## Desplegar en el VPS

### 1. Lo que necesitas
- Un VPS con **Ubuntu 24.04** (o Debian 12), **2 GB de RAM** y al menos 40 GB de disco. Mejor si el proveedor incluye protección DDoS, porque no hay Cloudflare delante.
- El dominio. En el panel DNS de Njalla crea dos registros **A** apuntando a la IP del VPS: uno para `@` y otro para `www`. Si el VPS tiene IPv6, añade también los **AAAA**.

### 2. Preparar el servidor
Entra por SSH y descarga el proyecto:

```bash
ssh root@IP_DEL_VPS
git clone https://github.com/peremo1/claude.git zaber && cd zaber
bash deploy/setup-vps.sh
```

Si el repositorio es privado, GitHub pedirá usuario y un token de acceso (Settings → Developer settings → Personal access tokens) en lugar de la contraseña. También puedes copiar la carpeta desde tu ordenador con `scp -r`.

`setup-vps.sh` instala Docker y deja el cortafuegos abierto solo para SSH, HTTP y HTTPS. También bloquea las IPs que intentan adivinar la contraseña, activa los parches de seguridad automáticos e instala restic para las copias.

### 3. Configurar
```bash
cp .env.example .env
openssl rand -hex 32     # copia el resultado en POSTGRES_PASSWORD
nano .env                # rellena DOMAIN, LETSENCRYPT_EMAIL y POSTGRES_PASSWORD
```

### 4. Arrancar con HTTPS
```bash
./deploy/init-ssl.sh
```
Construye la aplicación, pide el certificado a Let's Encrypt y arranca todo. La renovación del certificado es automática. Si quieres hacer antes una prueba sin gastar intentos de Let's Encrypt, usa `STAGING=1 ./deploy/init-ssl.sh` (el navegador avisará de que el certificado no es válido) y después ejecuta el script normal.

### 5. Crear la cuenta de Zaber
```bash
docker compose exec app npm run create-artist -- --email CORREO_DE_ZABER --name Zaber --handle zaber
```
Pedirá la contraseña por teclado. Después, Zaber entra en la web con ese correo y tiene el panel completo.

### 6. Copias de seguridad
Programa la copia diaria:
```bash
echo "17 4 * * * root $(pwd)/deploy/backup.sh >> /var/log/zaber-backup.log 2>&1" | sudo tee /etc/cron.d/zaber-backup
```
Sin más configuración, la copia se queda en el propio VPS (`/var/backups/zaber`, últimos 7 días). Eso no protege si el VPS desaparece. Para tener una copia cifrada en otro sitio, contrata un segundo servidor pequeño en otro proveedor, copia `deploy/backup.env.example` como `deploy/backup.env` y rellénalo. **Guarda la contraseña de restic en un lugar seguro**: sin ella las copias no se pueden abrir.

### 7. Seguridad del acceso SSH (muy recomendable)
1. En tu ordenador: `ssh-keygen -t ed25519` y después `ssh-copy-id root@IP_DEL_VPS`.
2. Comprueba que entras sin contraseña: `ssh root@IP_DEL_VPS`.
3. Solo entonces, en el VPS, edita `/etc/ssh/sshd_config`, pon `PasswordAuthentication no` y ejecuta `systemctl restart ssh`.

## Mantenimiento

| Tarea | Comando |
|---|---|
| Actualizar a una versión nueva | `git pull && docker compose up -d --build` |
| Ver si todo está en marcha | `docker compose ps` |
| Ver errores de la aplicación | `docker compose logs app --tail 100` |
| Reiniciar todo | `docker compose restart` |
| Hacer una copia ahora | `./deploy/backup.sh` |

**Restaurar una copia** (por ejemplo, en un VPS nuevo ya preparado con los pasos 2–4):
```bash
docker compose exec -T db pg_restore -U zaber -d zaber --clean --if-exists < /var/backups/zaber/db-FECHA.dump
docker compose exec -T app sh -c "tar xzf - -C /data/media" < /var/backups/zaber/media-FECHA.tar.gz
```
Si la copia está en restic: `restic restore latest --target /tmp/restaurar` y usa los archivos que aparezcan ahí.

## Correo
Sin servidor de correo configurado, la web funciona igual. Los correos (recuperar contraseña, avisos de encargos y mensajes) no se envían: se escriben en el registro (`docker compose logs app`). Para enviarlos de verdad, rellena las variables `SMTP_*` de `.env` con un proveedor que acepte este tipo de sitio y ejecuta `docker compose up -d`.

## Privacidad y seguridad
- Contraseñas guardadas con argon2. Sesiones en cookie `HttpOnly`, `Secure` y `SameSite`, con protección contra peticiones falsificadas desde otras webs (CSRF).
- Límite de intentos en el inicio de sesión (en Nginx y en la aplicación) y en las subidas.
- Nginx no guarda registro de las IPs de quien visita.
- Las imágenes pierden sus metadatos al subirse. Los adjuntos privados no tienen enlace público.
- La base de datos no está expuesta a internet: solo la aplicación llega a ella.
- El registro exige confirmar la mayoría de edad. La web muestra además un aviso de edad al entrar.

## Pendiente para más adelante
- Pagos y monetización.
- Verificar el correo al registrarse.
- Moderación: denunciar comentarios y bloquear cuentas.
- Vídeos.
