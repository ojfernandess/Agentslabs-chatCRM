import { config } from "../config.js";

/** Domínio SIP para URI/registro (ramais secundários Nvoip). */
export function nvoipEmbeddedSipDomain(): string {
  return config.nvoipSipDomain;
}

/** URL WebSocket seguro para JsSIP no browser. */
export function nvoipEmbeddedSipWssUrl(): string {
  const explicit = config.nvoipSipWssUrl.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = config.nvoipSipWssPort.trim() || "6443";
  return `wss://${nvoipEmbeddedSipDomain()}:${port}`;
}

export type NvoipEmbeddedSipClientConfig = {
  sipDomain: string;
  wssUrl: string;
  sipUser: string;
  sipPassword: string;
  displayName: string | null;
};
