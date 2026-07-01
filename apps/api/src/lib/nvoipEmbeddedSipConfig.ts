import { config } from "../config.js";

/** Domínio SIP para URI/registro de ramais secundários Nvoip (webphone / JsSIP). */
export function nvoipEmbeddedSipDomain(): string {
  return config.nvoipSipDomain;
}

/** URL WebSocket seguro primária para JsSIP no browser. */
export function nvoipEmbeddedSipWssUrl(): string {
  const explicit = config.nvoipSipWssUrl.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = config.nvoipSipWssPort.trim() || "6443";
  return `wss://${nvoipEmbeddedSipDomain()}:${port}`;
}

/** URLs WSS alternativas (fallback) quando a primária falha. */
export function nvoipEmbeddedSipWssAlternates(): string[] {
  const primary = nvoipEmbeddedSipWssUrl();
  const port = config.nvoipSipWssPort.trim() || "6443";
  const domain = nvoipEmbeddedSipDomain();
  const candidates = [
    `wss://app.nvoip.com.br:${port}`,
    `wss://sip.nvoip.com.br:${port}`,
  ];
  if (domain !== "app.nvoip.com.br") {
    candidates.unshift(`wss://${domain}:${port}`);
  }
  return [...new Set(candidates.filter((u) => u !== primary))];
}

export type NvoipEmbeddedSipClientConfig = {
  sipDomain: string;
  wssUrl: string;
  wssUrlAlternates: string[];
  sipUser: string;
  sipPassword: string;
  displayName: string | null;
};
