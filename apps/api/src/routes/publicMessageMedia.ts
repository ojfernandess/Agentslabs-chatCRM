import type { FastifyInstance } from "fastify";
import { openMessageMediaReadStream, readMessageMediaFile } from "../lib/mediaStorage.js";
import { MESSAGE_MEDIA_FILENAME_RE } from "../lib/messageMediaFilename.js";

function contentTypeForFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    webm: "audio/webm",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    mp4: "video/mp4",
    m4a: "audio/mp4",
    mov: "video/quicktime",
    amr: "audio/amr",
    wav: "audio/wav",
    wave: "audio/wav",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Leitura pública para o WhatsApp (Cloud API / parceiros) obterem o ficheiro do `link` JSON.
 * Não usar autenticação — os servidores da Meta fazem GET anónimo. O nome do ficheiro é um segredo de alta entropia.
 * Com MinIO activo, faz proxy do objecto (ou redirecciona se `MINIO_PUBLIC_BASE_URL` estiver definido noutro fluxo).
 */
export async function publicMessageMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>("/api/v1/messages/media/:name", async (request, reply) => {
    const name = request.params.name;
    if (!MESSAGE_MEDIA_FILENAME_RE.test(name)) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid media name", statusCode: 400 });
    }

    const opened = await openMessageMediaReadStream(name);
    if (opened) {
      reply.header("Cache-Control", "private, max-age=3600");
      return reply
        .type(opened.contentType !== "application/octet-stream" ? opened.contentType : contentTypeForFilename(name))
        .send(opened.stream);
    }

    const buf = await readMessageMediaFile(name);
    if (!buf || buf.length < 1) {
      return reply.status(404).send({ error: "Not Found", message: "Media not found", statusCode: 404 });
    }
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.type(contentTypeForFilename(name)).send(buf);
  });
}
