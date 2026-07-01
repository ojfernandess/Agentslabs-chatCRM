import type { NvoipAccount } from "@prisma/client";
import { decryptNvoipSecret, MASKED_NVOIP_SECRET } from "./nvoipConfig.js";
import {
  NVOIP_PANEL_URL,
  NVOIP_SIP_SERVER,
  NVOIP_WEBPHONE_URL,
  readNvoipPabxConfig,
  type NvoipPabxMode,
} from "./nvoipPabxConfig.js";
import { listNvoipWebphoneUsers } from "./nvoipTrunks.js";
import {
  buildNvoipCallWebhookUrl,
  ensureNvoipCallWebhookSecretForAccount,
} from "./nvoipWebhookSecret.js";

export type NvoipPabxTrunkClientInfo = {
  mode: NvoipPabxMode;
  sipServer: string;
  sipPort: number;
  transport: "UDP" | "TCP" | "TLS";
  sipUser: string;
  sipPassword: string | null;
  sipPasswordConfigured: boolean;
  webhookUrl: string | null;
  webphonePanelUrl: string;
  nvoipPanelUrl: string;
  capabilities: {
    clickToCall: true;
    inboundHistorySync: true;
    inboundWebhooks: boolean;
    browserWebphone: boolean;
    externalPabxTrunk: true;
    webrtcInCrm: false;
  };
  webphoneExtensions: { numbersip: string; caller: string | null; name: string | null }[];
  notes: {
    platform: string;
    external: string;
    webrtcLimit: string;
  };
};

export async function buildNvoipPabxTrunkInfo(account: NvoipAccount): Promise<NvoipPabxTrunkClientInfo> {
  const pabx = readNvoipPabxConfig(account.externalConfig);
  const ensured = await ensureNvoipCallWebhookSecretForAccount({
    accountId: account.id,
    externalConfig: account.externalConfig,
  });
  const webhookUrl = buildNvoipCallWebhookUrl(account.organizationId, ensured.secret);
  const storedPassword = pabx.trunkSipPasswordEnc
    ? decryptNvoipSecret(pabx.trunkSipPasswordEnc)
    : null;

  const webphoneExtensions = await listNvoipWebphoneUsers(account.id);

  return {
    mode: pabx.mode,
    sipServer: NVOIP_SIP_SERVER,
    sipPort: 5060,
    transport: "UDP",
    sipUser: account.numbersip,
    sipPassword: storedPassword,
    sipPasswordConfigured: Boolean(storedPassword?.trim()),
    webhookUrl,
    webphonePanelUrl: NVOIP_WEBPHONE_URL,
    nvoipPanelUrl: NVOIP_PANEL_URL,
    capabilities: {
      clickToCall: true,
      inboundHistorySync: true,
      inboundWebhooks: Boolean(webhookUrl),
      browserWebphone: webphoneExtensions.length > 0,
      externalPabxTrunk: true,
      webrtcInCrm: false,
    },
    webphoneExtensions,
    notes: {
      platform:
        "Modo plataforma: ramais com webphone no painel Nvoip + click-to-call no CRM. Entrada via sync de histórico e webhooks.",
      external:
        "Modo PABX externo: registe o trunk SIP (usuário NumberSIP) no FreePBX/Asterisk apontando para app.nvoip.com.br.",
      webrtcLimit:
        "A API Nvoip v2 não expõe WebRTC/SIP no browser do CRM. Áudio directo na plataforma usa webphone Nvoip ou softphone externo.",
    },
  };
}

export function maskNvoipTrunkPasswordForClient(info: NvoipPabxTrunkClientInfo): NvoipPabxTrunkClientInfo {
  if (!info.sipPasswordConfigured) return { ...info, sipPassword: null };
  return { ...info, sipPassword: MASKED_NVOIP_SECRET };
}
