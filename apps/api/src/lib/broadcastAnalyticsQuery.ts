import { z } from "zod";

const channelEnum = z.enum([
  "WHATSAPP",
  "EMAIL",
  "SMS",
  "TELEGRAM",
  "INSTAGRAM",
  "MESSENGER",
  "PUSH",
  "WEBHOOK",
  "VOICE",
]);

export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  campaignKind: z.enum(["all", "followup", "broadcast", "ai", "flow"]).default("all"),
  status: z.enum(["ALL", "PENDING", "SENT", "FAILED"]).default("ALL"),
  channel: channelEnum.optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  campaignId: z.string().uuid().optional(),
});

export type ParsedAnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export function parseAnalyticsQuery(input: Record<string, unknown>): ParsedAnalyticsQuery {
  return analyticsQuerySchema.parse(input);
}

export function defaultAnalyticsDateRange(): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export function resolveAnalyticsDateRange(query: ParsedAnalyticsQuery): { from: Date; to: Date } {
  const defaults = defaultAnalyticsDateRange();
  const from = query.from ? new Date(query.from) : defaults.from;
  const to = query.to ? new Date(query.to) : defaults.to;
  return { from, to };
}
