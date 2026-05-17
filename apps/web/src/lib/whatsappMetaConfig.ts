/** Campos extras da caixa WhatsApp (Meta Cloud API), guardados em `inbox.channelConfig`. */
export type WhatsAppMetaChannelConfig = {
  whatsappDisplayPhone?: string;
  whatsappBusinessAccountId?: string;
};

export function whatsappMetaFromChannelConfig(cfg: unknown): WhatsAppMetaChannelConfig {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return {};
  const c = cfg as Record<string, unknown>;
  return {
    whatsappDisplayPhone:
      typeof c.whatsappDisplayPhone === "string" ? c.whatsappDisplayPhone : undefined,
    whatsappBusinessAccountId:
      typeof c.whatsappBusinessAccountId === "string" ? c.whatsappBusinessAccountId : undefined,
  };
}

export function mergeWhatsappMetaChannelConfig(
  cfg: unknown,
  patch: WhatsAppMetaChannelConfig,
): Record<string, unknown> {
  const base =
    cfg && typeof cfg === "object" && !Array.isArray(cfg) ? { ...(cfg as Record<string, unknown>) } : {};
  const phone = patch.whatsappDisplayPhone?.trim();
  const waba = patch.whatsappBusinessAccountId?.trim();
  if (phone) base.whatsappDisplayPhone = phone;
  else delete base.whatsappDisplayPhone;
  if (waba) base.whatsappBusinessAccountId = waba;
  else delete base.whatsappBusinessAccountId;
  return base;
}

export function isWhatsAppCloudApiProvider(provider: string): boolean {
  return provider === "meta" || provider === "360dialog";
}
