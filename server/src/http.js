import { z } from "zod";

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const bad = (code, message, details) => new HttpError(400, code, message, details);
export const forbidden = (code = "forbidden", message = "No tienes permiso para esto.") => new HttpError(403, code, message);
export const notFound = (code = "not_found", message = "No existe.") => new HttpError(404, code, message);

// Express 4 no captura errores de funciones async; esto los pasa al manejador de errores.
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = {};
    for (const i of r.error.issues) fields[i.path.join(".") || "_"] = i.message;
    throw bad("invalid", "Revisa los datos enviados.", fields);
  }
  return r.data;
}

export const idParam = req => {
  const n = Number(req.params.id);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
};

// Campos de formularios multipart llegan como texto; estos esquemas los convierten.
export const zBool = z.preprocess(v => v === true || v === "true" || v === "1" || v === "on", z.boolean());
export const zIntish = z.preprocess(v => (v === "" || v == null ? undefined : Number(v)), z.number().int());
export const zI18n = (max = 200) => z.object({ es: z.string().trim().max(max), en: z.string().trim().max(max) });
export const zJson = schema => z.preprocess(v => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}, schema);

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, fields: err.details });
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "file_too_large", message: "El archivo es demasiado grande." });
  if (err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "too_many_files", message: "Demasiados archivos." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_json", message: "El cuerpo de la petición no es JSON válido." });
  console.error(err);
  res.status(500).json({ error: "server_error", message: "Algo falló en el servidor." });
}
