import http from "node:http";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import { ensureMediaDirs } from "./media.js";
import { attachRealtime } from "./realtime.js";
import { pool } from "./db.js";

await migrate();
await ensureMediaDirs();

const server = http.createServer(createApp());
attachRealtime(server);
server.listen(config.port, () => console.log(`Zaber escuchando en el puerto ${config.port} (${config.isProd ? "producción" : "desarrollo"})`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
