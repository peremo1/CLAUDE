import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

// Aplica en orden los .sql de migrations/ que aún no se hayan aplicado.
export async function migrate({ log = console.log } = {}) {
  await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await pool.query("select name from schema_migrations")).rows.map(r => r.name));
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await fs.readFile(path.join(dir, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      log(`migración aplicada: ${f}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`falló la migración ${f}: ${e.message}`);
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch(e => { console.error(e.message); process.exit(1); });
}
