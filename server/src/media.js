import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { config } from "./config.js";
import { bad } from "./http.js";

// Límite de píxeles para que una imagen gigante no tumbe el servidor.
sharp.cache(false);
const LIMIT_PIXELS = 120_000_000;
const ACCEPTED = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 8 },
});

const pub = (...p) => path.join(config.mediaDir, "public", ...p);
const priv = (...p) => path.join(config.mediaDir, "private", ...p);
const rand = () => crypto.randomBytes(12).toString("hex");

async function inspect(buffer) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: LIMIT_PIXELS }).metadata();
  } catch {
    throw bad("bad_image", "El archivo no es una imagen válida.");
  }
  if (!ACCEPTED.has(meta.format)) throw bad("bad_image", "Formato de imagen no admitido.");
  return meta;
}

// rotate() aplica la orientación EXIF; como no se llama a withMetadata(), sharp descarta todos los
// metadatos (GPS, cámara, fecha) al escribir el WebP.
const base = (buffer, animated) => sharp(buffer, { limitInputPixels: LIMIT_PIXELS, animated }).rotate();

async function webp(buffer, file, { width, height, fit = "inside", quality = 82, animated = false, blur = 0 }) {
  let img = base(buffer, animated).resize({ width, height, fit, withoutEnlargement: fit === "inside" });
  if (blur) img = img.blur(blur);
  const info = await img.webp({ quality, effort: 4 }).toFile(file);
  return info;
}

// Obra: tres tamaños + imagen para redes (difuminada si es +18).
export async function saveWorkImage(buffer, { nsfw }) {
  const meta = await inspect(buffer);
  const animated = (meta.pages || 1) > 1;
  const dir = rand();
  await fs.mkdir(pub("works", dir), { recursive: true });
  const full = await webp(buffer, pub("works", dir, "full.webp"), { width: 2400, height: 2400, quality: 86, animated });
  await webp(buffer, pub("works", dir, "medium.webp"), { width: 1280, height: 1280, animated });
  await webp(buffer, pub("works", dir, "thumb.webp"), { width: 560, height: 700, fit: "cover", quality: 78 });
  await writeOg(buffer, dir, nsfw);
  return { dir, w: full.width, h: full.height };
}

export async function writeOg(buffer, dir, nsfw) {
  await webp(buffer, pub("works", dir, "og.webp"), { width: 1200, height: 630, fit: "cover", quality: 80, blur: nsfw ? 40 : 0 });
}

// Si cambia la marca +18 hay que rehacer la vista previa para redes a partir del archivo grande.
export async function refreshOg(image, nsfw) {
  const src = await fs.readFile(pub("works", image.dir, "full.webp"));
  await writeOg(src, image.dir, nsfw);
}

export const workImageUrls = image => image && {
  thumb: `/media/works/${image.dir}/thumb.webp`,
  medium: `/media/works/${image.dir}/medium.webp`,
  full: `/media/works/${image.dir}/full.webp`,
  og: `/media/works/${image.dir}/og.webp`,
  w: image.w,
  h: image.h,
};

export async function removeWorkImage(image) {
  if (image?.dir && /^[a-f0-9]+$/.test(image.dir)) await fs.rm(pub("works", image.dir), { recursive: true, force: true });
}

export async function saveAvatar(buffer) {
  await inspect(buffer);
  await fs.mkdir(pub("avatars"), { recursive: true });
  const name = `${rand()}.webp`;
  await webp(buffer, pub("avatars", name), { width: 256, height: 256, fit: "cover", quality: 82 });
  return name;
}

export async function removeAvatar(name) {
  if (name && /^[a-f0-9]+\.webp$/.test(name)) await fs.rm(pub("avatars", name), { force: true });
}

// Adjuntos privados (chat y encargos). Se guardan fuera de la carpeta pública.
export async function savePrivateImage(buffer) {
  const meta = await inspect(buffer);
  await fs.mkdir(priv(), { recursive: true });
  const id = crypto.randomUUID();
  const info = await webp(buffer, priv(`${id}.webp`), { width: 2400, height: 2400, quality: 84, animated: (meta.pages || 1) > 1 });
  return { id, path: `${id}.webp`, w: info.width, h: info.height };
}

export const privatePath = name => priv(path.basename(name));
export const fileUrl = f => ({ id: f.id, url: `/api/files/${f.id}`, w: f.w, h: f.h });

export async function ensureMediaDirs() {
  await fs.mkdir(pub("works"), { recursive: true });
  await fs.mkdir(pub("avatars"), { recursive: true });
  await fs.mkdir(priv(), { recursive: true });
}
