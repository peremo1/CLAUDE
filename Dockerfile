# Imagen de la aplicación (API + WebSocket). Nginx sirve la web y las imágenes por su cuenta.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src
COPY server/migrations ./migrations
COPY server/scripts ./scripts
COPY web /app/web

RUN mkdir -p /data/media && chown -R node:node /data
USER node

ENV PORT=3000 MEDIA_DIR=/data/media WEB_DIR=/app/web BEHIND_NGINX=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
