import pg from "pg";
import { config } from "./config.js";

// bigint (int8) llega como texto por defecto; los ids caben de sobra en un número de JS.
pg.types.setTypeParser(20, v => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
