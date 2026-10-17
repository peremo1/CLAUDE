// Datos de ejemplo SOLO para probar en local. No lo ejecutes en el servidor real.
// Crea la artista (demo@zaber.local / zaber-demo-1) y una persona registrada (mika@zaber.local / mika-demo-1),
// obras hechas a partir de la foto de perfil, colecciones, un evento, comentarios y un encargo.
import fs from "node:fs/promises";
import sharp from "sharp";
import { hashPassword } from "../src/auth.js";
import { config } from "../src/config.js";
import { one, pool, q } from "../src/db.js";
import { ensureMediaDirs, saveWorkImage } from "../src/media.js";
import { migrate } from "../src/migrate.js";

if (config.isProd) { console.error("seed-demo no se ejecuta en producción."); process.exit(1); }
await migrate({ log: () => {} });
await ensureMediaDirs();
if (await one("select 1 from works limit 1")) { console.log("Ya hay obras; no se añade nada."); process.exit(0); }

const src = await fs.readFile(new URL("../../web/assets/zaber.jpg", import.meta.url));
const user = async (email, pw, name, handle, role) =>
  (await one("select id from users where email = $1", [email]))?.id ||
  (await one("insert into users (email, password_hash, name, handle, role) values ($1, $2, $3, $4, $5) returning id", [email, await hashPassword(pw), name, handle, role])).id;

const artistId = await user("demo@zaber.local", "zaber-demo-1", "Zaber", "zaber", "artist");
const fanId = await user("mika@zaber.local", "mika-demo-1", "Mika", "mika", "fan");
const luneId = await user("lune@zaber.local", "lune-demo-1", "Lune", "lune", "fan");

const cols = {};
for (const [k, es, en] of [["oc", "Mi personaje", "My character"], ["com", "Comisiones", "Commissions"], ["sk", "Bocetos", "Sketches"]]) {
  cols[k] = (await one("insert into collections (name, position) values ($1, (select count(*) from collections)) returning id", [{ es, en }])).id;
}

// Variaciones de la foto para rellenar la galería: recortes, tonos y versiones en gris.
const variants = [
  ["Filtro violeta", "Violet filter", false, "oc", ["oc", "máscara"], img => img],
  ["Después del turno", "After the shift", true, "com", ["comisión"], img => img.extract({ left: 60, top: 120, width: 280, height: 280 }).modulate({ hue: -20 })],
  ["Estudio de pelo", "Hair study", false, "sk", ["boceto"], img => img.extract({ left: 40, top: 0, width: 300, height: 300 }).grayscale()],
  ["Neón en la bañera", "Neon bathtub", true, "oc", ["oc", "neón"], img => img.extract({ left: 100, top: 140, width: 240, height: 240 }).modulate({ hue: 30, saturation: 1.3 })],
  ["Azotea", "Rooftop", false, "com", ["comisión", "escena"], img => img.modulate({ hue: -40 })],
  ["Ficha de personaje", "Character sheet", false, "sk", ["boceto", "oc"], img => img.grayscale().linear(1.2, -10)],
  ["Sin máscara", "Unmasked", true, "oc", ["oc", "máscara"], img => img.extract({ left: 110, top: 150, width: 200, height: 200 }).modulate({ hue: 15 })],
];
const ids = [];
for (let i = 0; i < variants.length; i++) {
  const [es, en, nsfw, col, tags, fx] = variants[i];
  const buf = await fx(sharp(src)).resize(1200, 1500, { fit: "cover" }).jpeg().toBuffer();
  const image = await saveWorkImage(buf, { nsfw });
  const w = await one(`insert into works (title, description, nsfw, collection_id, image, created_at) values ($1, $2, $3, $4, $5, now() - make_interval(days => $6)) returning id`,
    [{ es, en }, { es: "Obra de ejemplo para probar la web.", en: "Sample work to test the site." }, nsfw, cols[col], image, i * 5 + 1]);
  for (const tag of tags) { await q("insert into tags values ($1) on conflict do nothing", [tag]); await q("insert into work_tags values ($1, $2)", [w.id, tag]); }
  ids.push(w.id);
}
await q("update site_settings set featured_work_id = $1, about = $2, socials = $3", [ids[0],
  { es: "Ilustradora 2D. Dibujo personajes con mucha actitud, propios y por encargo.", en: "2D illustrator. I draw characters with attitude, my own and on commission." },
  JSON.stringify([{ id: "x", on: true, url: "https://x.com/" }, { id: "bsky", on: true, url: "https://bsky.app/" }])]);
await q("insert into events (title, starts_at, teaser_work_id) values ($1, now() + interval '2 days 14 hours', $2)", [{ es: "Serie de neón, parte 3", en: "Neon series, part 3" }, ids[3]]);
for (const id of ids.slice(0, 4)) await q("insert into likes (user_id, work_id) values ($1, $2), ($3, $2)", [fanId, id, luneId]);
const c1 = await one("insert into comments (work_id, user_id, body) values ($1, $2, 'Esos ojos amarillos con la máscara… perfecto.') returning id", [ids[0], fanId]);
await q("insert into comments (work_id, user_id, parent_id, body) values ($1, $2, $3, '@mika ¡gracias! Es mi personaje favorito.')", [ids[0], artistId, c1.id]);
const com = await one(`insert into commissions (client_id, type, nsfw, budget, description, status, quote_price, quote_days)
  values ($1, 0, true, '80 USD', 'Mi OC Rin con chaqueta de cuero y máscara de gas, sentada en una moto. Ambiente de noche con neón.', 'accepted', '90 USD', 14) returning id`, [fanId]);
await q(`insert into commission_updates (commission_id, author_id, by_artist, status, body, created_at) values
  ($1, $2, false, 'requested', '', now() - interval '3 days'), ($1, $3, true, 'quoted', 'Te propongo 90 USD con fondo de neón.', now() - interval '2 days'),
  ($1, $2, false, 'accepted', '', now() - interval '1 day')`, [com.id, fanId, artistId]);
await q("insert into messages (sender_id, recipient_id, body) values ($1, $2, '¡Hola! ¿Viste mi pedido?')", [fanId, artistId]);
console.log("Datos de ejemplo creados.\n  Artista: demo@zaber.local / zaber-demo-1\n  Persona registrada: mika@zaber.local / mika-demo-1");
await pool.end();
