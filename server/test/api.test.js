// Pruebas de la API contra una PostgreSQL real. Necesitan TEST_DATABASE_URL (se borra entera en cada ejecución).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl) throw new Error("Define TEST_DATABASE_URL para ejecutar las pruebas (se borrará esa base de datos).");
process.env.DATABASE_URL = dbUrl;
process.env.MEDIA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "zaber-media-"));

const { default: request } = await import("supertest");
const { default: sharp } = await import("sharp");
const { pool } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { createApp } = await import("../src/app.js");
const { hashPassword } = await import("../src/auth.js");
const { ensureMediaDirs } = await import("../src/media.js");

let app;
const H = { "x-requested-with": "zaber" };
const agent = () => {
  const a = request.agent(app);
  // Todas las peticiones que cambian datos llevan la cabecera anti-CSRF.
  for (const m of ["post", "patch", "delete"]) { const orig = a[m].bind(a); a[m] = url => orig(url).set(H); }
  return a;
};

// JPEG con datos GPS para comprobar que el servidor los borra.
async function photo(color = "#a42fcb") {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: color } })
    .jpeg().withExif({ IFD0: { Make: "PhoneCam", Model: "Secret 9" }, GPS: { GPSLatitudeRef: "N", GPSLatitude: "40/1 25/1 0/1" } }).toBuffer();
}

let artist, fan, other, guest, workId;

before(async () => {
  await pool.query("drop schema public cascade; create schema public;");
  await migrate({ log: () => {} });
  await ensureMediaDirs();
  app = createApp();
  await pool.query("insert into users (email, password_hash, name, handle, role) values ('zaber@test.dev', $1, 'Zaber', 'zaber', 'artist')", [await hashPassword("artista123")]);
  artist = agent(); fan = agent(); other = agent(); guest = agent();
  await artist.post("/api/auth/login").send({ email: "zaber@test.dev", password: "artista123" }).expect(200);
});

after(async () => { await pool.end(); await fs.rm(process.env.MEDIA_DIR, { recursive: true, force: true }); });

test("rechaza cambios sin la cabecera anti-CSRF", async () => {
  await request(app).post("/api/auth/register").send({ email: "x@x.dev", password: "12345678", name: "X", handle: "xx" }).expect(403);
});

test("registro, sesión y errores de validación", async () => {
  const r = await fan.post("/api/auth/register").send({ email: "Mika@Test.dev", password: "mika12345", name: "Mika", handle: "@mika", adult: true }).expect(201);
  assert.equal(r.body.user.handle, "mika");
  assert.equal(r.body.user.email, "mika@test.dev");
  await other.post("/api/auth/register").send({ email: "lune@test.dev", password: "lune12345", name: "Lune", handle: "lune", adult: true }).expect(201);
  const dup = await guest.post("/api/auth/register").send({ email: "mika@test.dev", password: "otra12345", name: "M", handle: "otra", adult: true }).expect(400);
  assert.equal(dup.body.error, "email_taken");
  const shortPw = await guest.post("/api/auth/register").send({ email: "n@test.dev", password: "123", name: "N", handle: "nn", adult: true }).expect(400);
  const noAdult = await guest.post("/api/auth/register").send({ email: "n@test.dev", password: "12345678", name: "N", handle: "nn" }).expect(400);
  assert.ok(noAdult.body.fields.adult);
  assert.ok(shortPw.body.fields.password);
  await guest.post("/api/auth/login").send({ email: "mika@test.dev", password: "mal" }).expect(401);
  const me = await fan.get("/api/auth/me").expect(200);
  assert.equal(me.body.user.name, "Mika");
  assert.equal((await guest.get("/api/auth/me")).body.user, null);
});

test("solo la artista sube obras; la imagen sale en WebP y sin metadatos", async () => {
  await fan.post("/api/works").field("title", JSON.stringify({ es: "x", en: "x" })).attach("image", await photo(), "a.jpg").expect(403);
  const r = await artist.post("/api/works")
    .field("title", JSON.stringify({ es: "Filtro violeta", en: "" }))
    .field("desc", JSON.stringify({ es: "Retrato", en: "Portrait" }))
    .field("tags", JSON.stringify(["oc", "Máscara"]))
    .field("nsfw", "false").field("featured", "true")
    .attach("image", await photo(), "foto.jpg").expect(201);
  const w = r.body.work;
  workId = w.id;
  assert.deepEqual(w.title, { es: "Filtro violeta", en: "Filtro violeta" });
  assert.deepEqual(w.tags, ["máscara", "oc"]);
  for (const size of ["thumb", "medium", "full", "og"]) {
    const res = await request(app).get(w.image[size]).buffer(true).parse((res, cb) => { const b = []; res.on("data", d => b.push(d)); res.on("end", () => cb(null, Buffer.concat(b))); }).expect(200);
    const meta = await sharp(res.body).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined, `${size} no debe llevar EXIF`);
  }
  const site = await guest.get("/api/site").expect(200);
  assert.equal(site.body.featuredWorkId, workId);
  assert.equal(site.body.artist.handle, "zaber");
});

test("me gusta, guardar y lista de obras", async () => {
  await guest.post(`/api/works/${workId}/like`).expect(401);
  const l = await fan.post(`/api/works/${workId}/like`).expect(200);
  assert.deepEqual([l.body.liked, l.body.likes], [true, 1]);
  await fan.post(`/api/works/${workId}/save`).expect(200);
  const list = await fan.get("/api/works").expect(200);
  assert.equal(list.body.works[0].liked, true);
  assert.equal(list.body.works[0].saved, true);
  const l2 = await fan.post(`/api/works/${workId}/like`).expect(200);
  assert.deepEqual([l2.body.liked, l2.body.likes], [false, 0]);
});

test("comentarios en hilo y avisos por respuesta y por @mención", async () => {
  const root = (await fan.post(`/api/works/${workId}/comments`).send({ text: "Me encanta" }).expect(201)).body.comment;
  const reply = (await artist.post(`/api/works/${workId}/comments`).send({ text: "@mika ¡gracias! @lune mira", parentId: root.id }).expect(201)).body.comment;
  // Responder a una respuesta cuelga del comentario raíz.
  const deep = (await other.post(`/api/works/${workId}/comments`).send({ text: "yo también", parentId: reply.id }).expect(201)).body.comment;
  assert.equal(reply.parentId, root.id);
  assert.equal(deep.parentId, root.id);
  const n = await fan.get("/api/notifications").expect(200);
  const types = n.body.notifications.map(x => x.type);
  assert.ok(types.includes("comment_reply"));
  assert.ok(types.includes("mention"));
  assert.ok((await other.get("/api/notifications")).body.notifications.some(x => x.type === "mention"));
  // Nadie puede borrar el comentario de otra persona, salvo la artista.
  await other.delete(`/api/comments/${root.id}`).expect(403);
  await artist.delete(`/api/comments/${deep.id}`).expect(200);
  const list = await guest.get(`/api/works/${workId}/comments`).expect(200);
  assert.equal(list.body.comments.length, 2);
});

test("comisión completa: pedido, presupuesto, boceto con aprobación y entrega", async () => {
  const created = await fan.post("/api/commissions").field("type", "0").field("description", "Mi OC con chaqueta de cuero y máscara").field("nsfw", "true").field("budget", "80 USD")
    .attach("files", await photo("#33aa77"), "ref.jpg").expect(201);
  const id = created.body.id;
  assert.equal(created.body.code, `C-${1000 + id}`);
  // Otra persona registrada no puede verla ni ver sus archivos.
  await other.get(`/api/commissions/${id}`).expect(404);
  const detail = (await fan.get(`/api/commissions/${id}`).expect(200)).body.commission;
  const refUrl = detail.updates[0].files[0].url;
  await other.get(refUrl).expect(404);
  await guest.get(refUrl).expect(401);
  await artist.get(refUrl).expect(200);
  // El estado solo avanza en el orden correcto.
  await artist.post(`/api/commissions/${id}/updates`).field("status", "sketch").expect(400);
  await fan.post(`/api/commissions/${id}/quote`).send({ price: "1 USD", days: 1 }).expect(403);
  await artist.post(`/api/commissions/${id}/quote`).send({ price: "90 USD", days: 14, note: "Con fondo de neón" }).expect(200);
  await fan.post(`/api/commissions/${id}/quote-response`).send({ accept: true }).expect(200);
  await artist.post(`/api/commissions/${id}/updates`).field("status", "sketch").field("askApproval", "true").field("text", "Aquí va el boceto @mika")
    .attach("files", await photo("#777777"), "boceto.png").expect(201);
  let c = (await fan.get(`/api/commissions/${id}`)).body.commission;
  assert.equal(c.status, "sketch");
  assert.equal(c.approval, "pending");
  await fan.post(`/api/commissions/${id}/approval`).send({ approve: true, note: "¡Perfecto!" }).expect(200);
  await artist.post(`/api/commissions/${id}/updates`).field("status", "color").expect(201);
  await artist.post(`/api/commissions/${id}/updates`).field("status", "sketch").expect(400);
  await artist.post(`/api/commissions/${id}/updates`).field("status", "done").field("text", "¡Entregado!").expect(201);
  c = (await fan.get(`/api/commissions/${id}`)).body.commission;
  assert.equal(c.status, "done");
  assert.equal(c.approval, "approved");
  assert.deepEqual(c.updates.map(u => u.status), ["requested", "quoted", "accepted", "sketch", null, "color", "done"]);
  await fan.post(`/api/commissions/${id}/updates`).field("text", "gracias").expect(400);
  const notes = (await fan.get("/api/notifications")).body.notifications.map(n => n.type);
  assert.ok(notes.includes("comm_quote") && notes.includes("comm_update"));
  const stats = (await artist.get("/api/admin/stats").expect(200)).body;
  assert.equal(stats.newRequests, 0);
  assert.equal((await fan.get("/api/commissions")).body.commissions.length, 1);
  assert.equal((await other.get("/api/commissions")).body.commissions.length, 0);
});

test("con comisiones cerradas no se pueden pedir nuevas", async () => {
  await artist.patch("/api/site").send({ open: false }).expect(200);
  await fan.post("/api/commissions").field("type", "1").field("description", "Otra idea distinta").expect(403);
  await artist.patch("/api/site").send({ open: true }).expect(200);
});

test("mensajes privados entre la artista y cada persona", async () => {
  const fanId = (await fan.get("/api/auth/me")).body.user.id;
  const conv0 = (await fan.get("/api/conversations").expect(200)).body.conversations;
  assert.equal(conv0[0].user.handle, "zaber");
  await fan.post("/api/messages").field("text", "Hola Zaber").attach("files", await photo("#ffd10b"), "x.jpg").expect(201);
  await artist.post("/api/messages").field("to", String(fanId)).field("text", "¡Hola!").expect(201);
  const convA = (await artist.get("/api/conversations")).body.conversations;
  assert.equal(convA[0].user.handle, "mika");
  const thread = (await fan.get("/api/messages").expect(200)).body.messages;
  assert.deepEqual(thread.map(m => m.text), ["Hola Zaber", "¡Hola!"]);
  // Lune no puede ver la foto que Mika mandó a Zaber.
  await other.get(thread[0].files[0].url).expect(404);
  await artist.get(thread[0].files[0].url).expect(200);
  // Una persona registrada no puede escribir a otra que no sea la artista.
  const loneThread = (await other.get("/api/messages")).body;
  assert.equal(loneThread.user.handle, "zaber");
});

test("perfil: datos, contraseña, foto y preferencias", async () => {
  const r = await fan.patch("/api/me").send({ name: "Mika R", bio: "hola", prefs: { blur: false } }).expect(200);
  assert.equal(r.body.user.prefs.blur, false);
  assert.equal(r.body.user.prefs.mail, true);
  await fan.patch("/api/me").send({ handle: "lune" }).expect(400);
  await fan.patch("/api/me/password").send({ current: "mal", next: "nueva12345" }).expect(400);
  await fan.patch("/api/me/password").send({ current: "mika12345", next: "nueva12345" }).expect(200);
  await guest.post("/api/auth/login").send({ email: "mika@test.dev", password: "nueva12345" }).expect(200);
  const av = await fan.post("/api/me/avatar").attach("avatar", await photo(), "yo.jpg").expect(200);
  assert.match(av.body.user.avatar, /^\/media\/avatars\/[a-f0-9]+\.webp$/);
  const users = await fan.get("/api/users?q=lu").expect(200);
  assert.deepEqual(users.body.users.map(u => u.handle), ["lune"]);
});

test("recuperar contraseña con enlace de un solo uso", async () => {
  const logs = [];
  const orig = console.log; console.log = (...a) => logs.push(a.join(" "));
  await guest.post("/api/auth/forgot").send({ email: "lune@test.dev" }).expect(200);
  await guest.post("/api/auth/forgot").send({ email: "nadie@test.dev" }).expect(200);
  console.log = orig;
  const token = logs.join("\n").match(/#reset-([\w-]+)/)[1];
  await guest.post("/api/auth/reset").send({ token, password: "lune-nueva-1" }).expect(200);
  await guest.post("/api/auth/reset").send({ token, password: "otra-vez-12" }).expect(400);
  await request(app).post("/api/auth/login").set(H).send({ email: "lune@test.dev", password: "lune-nueva-1" }).expect(200);
});

test("panel: colecciones, etiquetas, eventos, redes y edición de obras", async () => {
  const col = (await artist.post("/api/collections").send({ name: { es: "Bocetos", en: "" } }).expect(201)).body.collection;
  assert.equal(col.name.en, "Bocetos");
  await artist.patch(`/api/collections/${col.id}`).send({ name: { en: "Sketches" } }).expect(200);
  await artist.patch(`/api/works/${workId}`).field("collectionId", String(col.id)).field("tags", JSON.stringify(["boceto"])).field("nsfw", "true").expect(200);
  const cols = (await guest.get("/api/collections")).body.collections;
  assert.deepEqual([cols[0].name, cols[0].count], [{ es: "Bocetos", en: "Sketches" }, 1]);
  const w = (await guest.get(`/api/works/${workId}`)).body.work;
  assert.deepEqual([w.nsfw, w.tags, w.collectionId], [true, ["boceto"], col.id]);
  await artist.patch(`/api/works/${workId}`).field("collectionId", "").expect(200);
  assert.equal((await guest.get(`/api/works/${workId}`)).body.work.collectionId, null);
  await artist.patch(`/api/works/${workId}`).field("collectionId", String(col.id)).expect(200);
  await artist.delete(`/api/collections/${col.id}`).expect(200);
  assert.equal((await guest.get(`/api/works/${workId}`)).body.work.collectionId, null);

  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const ev = (await artist.post("/api/events").send({ title: { es: "Serie de neón 3", en: "Neon 3" }, startsAt: soon, teaserWorkId: workId }).expect(201)).body;
  await artist.post("/api/events").send({ title: { es: "Oculto", en: "" }, startsAt: soon, visible: false }).expect(201);
  assert.equal((await guest.get("/api/events")).body.events.length, 1);
  assert.equal((await artist.get("/api/events?all=1")).body.events.length, 2);
  assert.equal((await fan.post(`/api/events/${ev.id}/notify`).expect(200)).body.notify, true);

  await artist.patch("/api/site").send({ socials: [{ id: "x", on: true, url: "javascript:alert(1)" }] }).expect(400);
  await artist.patch("/api/site").send({ about: { es: "Ilustradora 2D", en: "2D illustrator" }, socials: [{ id: "x", on: true, url: "https://x.com/zaber" }] }).expect(200);
  const site = (await guest.get("/api/site")).body;
  assert.equal(site.socials.find(s => s.id === "x").url, "https://x.com/zaber");
  assert.equal(site.about.es, "Ilustradora 2D");
  await fan.patch("/api/site").send({ open: false }).expect(403);
});

test("enlace compartible de una obra con vista previa para redes", async () => {
  const r = await request(app).get(`/obra/${workId}`).expect(200);
  assert.match(r.text, /og:image" content="[^"]+\/og\.webp"/);
  assert.match(r.text, /<meta name="rating" content="adult">/);
});

test("borrar la cuenta conserva sus encargos para la artista", async () => {
  await fan.delete("/api/me").send({ password: "mala" }).expect(400);
  await fan.delete("/api/me").send({ password: "nueva12345" }).expect(200);
  await fan.get("/api/notifications").expect(401);
  const list = (await artist.get("/api/commissions")).body.commissions;
  assert.equal(list.length, 1);
  assert.equal(list[0].client, null);
  await artist.delete("/api/me").send({ password: "artista123" }).expect(400);
});

test("borrar una obra elimina sus archivos", async () => {
  const w = (await guest.get(`/api/works/${workId}`)).body.work;
  await artist.delete(`/api/works/${workId}`).expect(200);
  await request(app).get(w.image.full).expect(404);
  await guest.get(`/api/works/${workId}`).expect(404);
});
