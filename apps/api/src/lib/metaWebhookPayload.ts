export function extractMetaWebhookPhoneNumberId(body: unknown): string | null {
  const b = body as {
    entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[];
  };
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id && typeof id === "string") return id.trim();
    }
  }
  return null;
}

export function isMetaCloudWebhookPayload(body: unknown): boolean {
  return Boolean(extractMetaWebhookPhoneNumberId(body));
}
