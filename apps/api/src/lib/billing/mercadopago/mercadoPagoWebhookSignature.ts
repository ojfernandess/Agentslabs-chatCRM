import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoWebhookSignatureInput = {
  secret: string;
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
};

/** Valida x-signature conforme documentação Mercado Pago (manifest HMAC-SHA256). */
export function verifyMercadoPagoWebhookSignature(input: MercadoPagoWebhookSignatureInput): boolean {
  const secret = input.secret.trim();
  if (!secret || !input.xSignature?.trim() || !input.xRequestId?.trim() || !input.dataId?.trim()) {
    return false;
  }

  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of input.xSignature.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }
  if (!ts || !v1) return false;

  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return expected === v1;
  }
}
