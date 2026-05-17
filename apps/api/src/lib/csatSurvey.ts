import { randomBytes } from "node:crypto";
import { getWebAppPublicOrigin } from "../config.js";

export function newCsatSurveyToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Texto pré-WhatsApp quando `Settings.csatSurveyMessage` está vazio. */
export function defaultCsatSurveyIntro(): string {
  return "Obrigado pelo contato! Como você avalia nosso atendimento? Toque no link para deixar sua avaliação (de 1 a 5).";
}

export function csatSurveyPageUrl(token: string): string {
  return `${getWebAppPublicOrigin()}/csat/${encodeURIComponent(token)}`;
}

export function buildCsatWhatsAppBody(intro: string, token: string): string {
  const line = intro.trim() || defaultCsatSurveyIntro();
  return `${line}\n\n${csatSurveyPageUrl(token)}`;
}
