/** Como a organização usa telefonia Nvoip. */
export type NvoipPabxMode = "platform_webphone" | "external_pabx_trunk";

export const NVOIP_SIP_SERVER = "app.nvoip.com.br";
export const NVOIP_PANEL_URL = "https://painel.nvoip.com.br";
export const NVOIP_WEBPHONE_URL = "https://painel.nvoip.com.br/webphone";

export function parseNvoipPabxMode(raw: unknown): NvoipPabxMode {
  return raw === "external_pabx_trunk" ? "external_pabx_trunk" : "platform_webphone";
}

export function readNvoipPabxConfig(externalConfig: unknown): {
  mode: NvoipPabxMode;
  trunkSipPasswordEnc: string | null;
} {
  const c =
    externalConfig != null && typeof externalConfig === "object" && !Array.isArray(externalConfig)
      ? (externalConfig as Record<string, unknown>)
      : {};
  const enc =
    typeof c.trunkSipPasswordEnc === "string" && c.trunkSipPasswordEnc.trim()
      ? c.trunkSipPasswordEnc.trim()
      : null;
  return {
    mode: parseNvoipPabxMode(c.pabxMode),
    trunkSipPasswordEnc: enc,
  };
}
