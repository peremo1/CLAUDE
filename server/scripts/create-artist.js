// Crea la cuenta de la artista (o convierte una existente). Uso:
//   npm run create-artist -- --email zaber@ejemplo.com --name Zaber --handle zaber
// La contraseña se pide por teclado para que no quede en el historial de la terminal.
import readline from "node:readline";
import { hashPassword } from "../src/auth.js";
import { one, pool } from "../src/db.js";
import { migrate } from "../src/migrate.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => a.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
if (!args.email) {
  console.error("Falta --email. Ejemplo: npm run create-artist -- --email zaber@ejemplo.com --name Zaber --handle zaber");
  process.exit(1);
}

async function askHidden(prompt) {
  if (process.env.ARTIST_PASSWORD) return process.env.ARTIST_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (s.includes(prompt)) rl.output.write(s); };
  return new Promise(r => rl.question(prompt, a => { rl.close(); process.stdout.write("\n"); r(a); }));
}

await migrate({ log: () => {} });
const existing = await one("select * from users where lower(email) = lower($1)", [args.email]);
if (existing) {
  await one("update users set role = 'artist' where id = $1 returning id", [existing.id]);
  console.log(`La cuenta ${existing.email} ahora es la cuenta de artista.`);
} else {
  const pw = await askHidden("Contraseña (mínimo 8 caracteres): ");
  if (!pw || pw.length < 8) { console.error("La contraseña necesita al menos 8 caracteres."); process.exit(1); }
  const u = await one("insert into users (email, password_hash, name, handle, role) values ($1, $2, $3, $4, 'artist') returning id",
    [args.email, await hashPassword(pw), args.name || "Zaber", (args.handle || "zaber").replace(/^@/, "")]);
  console.log(`Cuenta de artista creada (id ${u.id}). Ya puedes entrar en la web con ese correo.`);
}
await pool.end();
